//! Bounded, host-driven arbitration for one physical pump station.
//!
//! This module deliberately does not drive GPIO, execute control text, or own a
//! wall clock.  The host supplies a trusted local-day window and reports driver
//! application with a monotonic timestamp.  A caller must persist the bytes
//! returned by a `prepare_*` method, then call the corresponding `commit_*`
//! method with its token before it can receive a start or output grant.

use core::fmt;

const MAGIC: &[u8; 4] = b"GFS1";
const FORMAT_VERSION: u8 = 3;
const HARD_MAX_VALVES: u8 = 64;
const HARD_MAX_LEDGER: usize = 256;
const HARD_MAX_SEEN: usize = 256;

pub type RequestId = u64;
pub type SessionId = u64;
pub type OwnerId = u64;
pub type OccurrenceId = u64;
pub type ValveMask = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StationError {
    InvalidConfig(&'static str),
    InvalidRequest(&'static str),
    Unsupported(&'static str),
    NotStopped,
    Stopping,
    ModeMismatch,
    AlreadyOwned,
    StaleRevision,
    StaleStopGeneration,
    DuplicateRequest,
    DuplicateOccurrence,
    ConflictingModeRequests,
    PendingPersistence,
    NoPendingPersistence,
    PersistenceTokenMismatch,
    PersistenceNotAcknowledged,
    LedgerFull,
    SeenRequestLedgerFull,
    QuotaExceeded,
    LeaseExpired,
    ClockUntrusted,
    ClockBackward,
    ClockJump,
    DayNotSynchronized,
    CrossesDayBoundary,
    MonotonicBackward,
    CapacityRequired,
    RecoveryHold,
    SessionMismatch,
    OutputNotAuthorized,
    UnsafeOutput,
    StopNotRequested,
    OutputStillApplied,
    Snapshot(&'static str),
    Overflow,
}

impl fmt::Display for StationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use StationError::*;
        let text = match self {
            InvalidConfig(v) => v,
            InvalidRequest(v) => v,
            Unsupported(v) => v,
            NotStopped => "station is not stopped",
            Stopping => "station stop is in progress",
            ModeMismatch => "request does not match active station mode",
            AlreadyOwned => "the station pump is already owned by a session",
            StaleRevision => "request was made against an old configuration revision",
            StaleStopGeneration => "request was made before the current stop generation",
            DuplicateRequest => "request id was already accepted",
            DuplicateOccurrence => "occurrence id was already accepted or terminal",
            ConflictingModeRequests => "conflicting mode entries in one atomic batch",
            PendingPersistence => "a durable transition is awaiting commit or abort",
            NoPendingPersistence => "there is no matching prepared transition",
            PersistenceTokenMismatch => "persistence acknowledgement token does not match",
            PersistenceNotAcknowledged => "durable acknowledgement is required before a grant",
            LedgerFull => "bounded occurrence ledger is full; new starts fail closed",
            SeenRequestLedgerFull => "bounded request ledger is full; new request fails closed",
            QuotaExceeded => "daily physical-pump time quota would be exceeded",
            LeaseExpired => "session lease or trusted day window has expired",
            ClockUntrusted => "local day is not trusted; starts are held",
            ClockBackward => "local day moved backward; starts are held",
            ClockJump => "untrusted forward local-day jump; starts are held",
            DayNotSynchronized => "a trusted local-day window is required",
            CrossesDayBoundary => "finite start budget crosses the trusted day boundary",
            MonotonicBackward => "monotonic time moved backward",
            CapacityRequired => "required pump capacity check was not Pass",
            RecoveryHold => "recovered uncertain reservation requires safe-output acknowledgement",
            SessionMismatch => "session does not own this station",
            OutputNotAuthorized => "output was not authorized by an active durable grant",
            UnsafeOutput => "output violates station pump or valve safety constraints",
            StopNotRequested => "explicit stop request is required before confirmation",
            OutputStillApplied => "driver has not reported pump and valves safely off",
            Snapshot(v) => v,
            Overflow => "bounded time or counter calculation overflowed",
        };
        f.write_str(text)
    }
}

impl std::error::Error for StationError {}

pub type Result<T> = std::result::Result<T, StationError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Stopped,
    Auto,
    Manual,
    Configure,
}

impl Mode {
    fn byte(self) -> u8 {
        match self {
            Self::Stopped => 0,
            Self::Auto => 1,
            Self::Manual => 2,
            Self::Configure => 3,
        }
    }
    fn from_byte(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::Stopped),
            1 => Ok(Self::Auto),
            2 => Ok(Self::Manual),
            3 => Ok(Self::Configure),
            _ => Err(StationError::Snapshot("invalid mode in station snapshot")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopProof {
    /// The driver applied its configured safe command; no physical feedback was required.
    Commanded,
    /// The driver applied the safe command and verified installed feedback.
    Verified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapacityCheck {
    Pass,
    Violation,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CapacityObservation {
    /// Optional profile flow capacity in a single, host-selected unit.
    pub available_flow: Option<u32>,
    /// Optional demand for this complete session in the same unit.
    pub requested_flow: Option<u32>,
}

impl CapacityObservation {
    pub fn check(self) -> Result<CapacityCheck> {
        match (self.available_flow, self.requested_flow) {
            (None, _) | (_, None) => Ok(CapacityCheck::Unknown),
            (Some(0), _) | (_, Some(0)) => Err(StationError::InvalidRequest(
                "capacity values must be positive when supplied",
            )),
            (Some(available), Some(requested)) if requested <= available => Ok(CapacityCheck::Pass),
            (Some(_), Some(_)) => Ok(CapacityCheck::Violation),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StationConfig {
    pub valve_count: u8,
    /// Maximum simultaneously applied valves, not the size of a session's permitted set.
    pub max_open_valves: u8,
    pub daily_quota_ms: u64,
    /// Every request reserves this finite upper bound before an output grant.
    pub max_start_budget_ms: u64,
    pub max_occurrence_records: usize,
    pub max_seen_request_ids: usize,
    /// A larger host wall-clock jump puts scheduling into a fail-closed hold.
    pub max_forward_day_jump: u32,
    /// Off by default: optional capacity data is advisory only.
    pub require_capacity_pass: bool,
}

impl Default for StationConfig {
    fn default() -> Self {
        Self {
            valve_count: 8,
            max_open_valves: 2,
            daily_quota_ms: 60 * 60 * 1000,
            max_start_budget_ms: 30 * 60 * 1000,
            max_occurrence_records: 64,
            max_seen_request_ids: 64,
            max_forward_day_jump: 2,
            require_capacity_pass: false,
        }
    }
}

impl StationConfig {
    pub fn validate(&self) -> Result<()> {
        if self.valve_count == 0 || self.valve_count > HARD_MAX_VALVES {
            return Err(StationError::InvalidConfig("valve_count must be 1..=64"));
        }
        if self.max_open_valves == 0 || self.max_open_valves > self.valve_count {
            return Err(StationError::InvalidConfig(
                "max_open_valves must be within valve_count",
            ));
        }
        if self.daily_quota_ms == 0 || self.max_start_budget_ms == 0 {
            return Err(StationError::InvalidConfig(
                "quota and start budget must be finite and non-zero",
            ));
        }
        if self.max_occurrence_records == 0 || self.max_occurrence_records > HARD_MAX_LEDGER {
            return Err(StationError::InvalidConfig(
                "occurrence ledger bound must be 1..=256",
            ));
        }
        if self.max_seen_request_ids == 0 || self.max_seen_request_ids > HARD_MAX_SEEN {
            return Err(StationError::InvalidConfig(
                "request ledger bound must be 1..=256",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Claim {
    pub revision: u64,
    pub stop_generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnterRequest {
    pub request_id: RequestId,
    pub claim: Claim,
    pub mode: Mode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StopRequest {
    pub request_id: RequestId,
    pub claim: Claim,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartRequest {
    pub request_id: RequestId,
    pub claim: Claim,
    pub session_id: SessionId,
    pub owner_id: OwnerId,
    pub mode: Mode,
    /// Valves this session may use across its lifetime. Every applied output is separately
    /// checked against max_open_valves; this mask itself is never an output command.
    pub valves: ValveMask,
    /// The required finite pump-ON upper bound, including any intended lease extension.
    pub budget_ms: u64,
    pub occurrence_id: Option<OccurrenceId>,
    pub capacity: CapacityObservation,
    /// Host monotonic time at which the lease begins after persistence commits.
    pub now_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApplyRequest {
    pub request_id: RequestId,
    pub claim: Claim,
    /// Revision must be exactly the active revision plus one; no implicit reinterpretation.
    pub next_revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputState {
    pub pump_on: bool,
    pub valves: ValveMask,
}

impl OutputState {
    pub const SAFE: Self = Self {
        pump_on: false,
        valves: 0,
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputGrant {
    pub session_id: SessionId,
    pub output: OutputState,
    pub lease_deadline_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartGrant {
    pub session_id: SessionId,
    pub owner_id: OwnerId,
    pub valves: ValveMask,
    pub lease_deadline_ms: u64,
    pub capacity: CapacityCheck,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SafetyDirective {
    pub force_safe_output: bool,
    pub reason: Option<StationError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinishOutcome {
    Completed,
    Cancelled,
    SkippedByStop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OccurrenceRecord {
    id: OccurrenceId,
    day: u32,
    status: OccurrenceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OccurrenceStatus {
    Reserved,
    Completed,
    Cancelled,
    SkippedByStop,
}

impl OccurrenceStatus {
    fn byte(self) -> u8 {
        match self {
            Self::Reserved => 0,
            Self::Completed => 1,
            Self::Cancelled => 2,
            Self::SkippedByStop => 3,
        }
    }
    fn from_byte(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::Reserved),
            1 => Ok(Self::Completed),
            2 => Ok(Self::Cancelled),
            3 => Ok(Self::SkippedByStop),
            _ => Err(StationError::Snapshot("invalid occurrence status")),
        }
    }
    fn from_finish(outcome: FinishOutcome) -> Self {
        match outcome {
            FinishOutcome::Completed => Self::Completed,
            FinishOutcome::Cancelled => Self::Cancelled,
            FinishOutcome::SkippedByStop => Self::SkippedByStop,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DayWindow {
    day: u32,
    deadline_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ActiveSession {
    session_id: SessionId,
    owner_id: OwnerId,
    mode: Mode,
    valves: ValveMask,
    reserved_ms: u64,
    actual_on_ms: u64,
    lease_deadline_ms: u64,
    occurrence_id: Option<OccurrenceId>,
    last_authorized: OutputState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PendingKind {
    Start {
        request: StartRequest,
        capacity: CapacityCheck,
        lease_deadline_ms: u64,
    },
    Finish {
        session_id: SessionId,
        outcome: FinishOutcome,
        actual_on_ms: u64,
    },
    Apply {
        request_id: RequestId,
        next_revision: u64,
    },
    Stop {
        request_id: RequestId,
        next_stop_generation: u64,
        skipped_occurrences: Vec<OccurrenceId>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Pending {
    token: u64,
    kind: PendingKind,
}

/// Bytes must be durably written before `commit_*` accepts the matching token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedPersistence {
    token: u64,
    bytes: Vec<u8>,
}

impl PreparedPersistence {
    pub fn token(&self) -> u64 {
        self.token
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

/// Explicit acknowledgement supplied only after the host has made the bytes durable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DurableAck {
    token: u64,
}

impl DurableAck {
    pub fn new(token: u64) -> Self {
        Self { token }
    }
    pub fn token(self) -> u64 {
        self.token
    }
}

/// One bounded station manages exactly one physical pump and its valve set.
#[derive(Debug, Clone)]
pub struct Station {
    config: StationConfig,
    revision: u64,
    stop_generation: u64,
    mode: Mode,
    stopping: bool,
    day: Option<DayWindow>,
    day_watermark: Option<u32>,
    clock_held: bool,
    // A bounded audit record could not be retained. This is distinct from an
    // untrusted clock and remains latched across a later day synchronization.
    audit_hold: bool,
    daily_used_ms: u64,
    reserved_ms: u64,
    occurrences: Vec<OccurrenceRecord>,
    seen_requests: Vec<RequestId>,
    active: Option<ActiveSession>,
    pending: Option<Pending>,
    actual_output: OutputState,
    last_monotonic_ms: Option<u64>,
    recovery_hold: bool,
    next_token: u64,
}

impl Station {
    pub fn new(config: StationConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            config,
            revision: 0,
            stop_generation: 0,
            mode: Mode::Stopped,
            stopping: false,
            day: None,
            day_watermark: None,
            clock_held: false,
            audit_hold: false,
            daily_used_ms: 0,
            reserved_ms: 0,
            occurrences: Vec::new(),
            seen_requests: Vec::new(),
            active: None,
            pending: None,
            actual_output: OutputState::SAFE,
            last_monotonic_ms: None,
            recovery_hold: false,
            next_token: 1,
        })
    }

    pub fn config(&self) -> &StationConfig {
        &self.config
    }
    pub fn mode(&self) -> Mode {
        self.mode
    }
    pub fn stopping(&self) -> bool {
        self.stopping
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn stop_generation(&self) -> u64 {
        self.stop_generation
    }
    pub fn daily_used_ms(&self) -> u64 {
        self.daily_used_ms
    }
    pub fn reserved_ms(&self) -> u64 {
        self.reserved_ms
    }
    pub fn actual_output(&self) -> OutputState {
        self.actual_output
    }
    pub fn recovery_hold(&self) -> bool {
        self.recovery_hold
    }
    pub fn active_session(&self) -> Option<SessionId> {
        self.active.map(|v| v.session_id)
    }
    pub fn pending_token(&self) -> Option<u64> {
        self.pending.as_ref().map(|pending| pending.token)
    }
    pub fn claim(&self) -> Claim {
        Claim {
            revision: self.revision,
            stop_generation: self.stop_generation,
        }
    }

    /// Set the trusted local calendar day and its next-midnight monotonic deadline.
    /// A backward or excessive forward change latches a hold; it is never treated as a new quota.
    pub fn synchronize_day(
        &mut self,
        day: u32,
        now_ms: u64,
        next_day_deadline_ms: u64,
        trusted: bool,
    ) -> Result<()> {
        // A prepared start image includes a specific day window and reservation.  Letting a
        // host mutate that window before its durable transition resolves would let a later
        // commit mean something different from the bytes that were acknowledged.
        self.ensure_no_pending()?;
        self.note_monotonic(now_ms)?;
        if !trusted {
            self.clock_held = true;
            return Err(StationError::ClockUntrusted);
        }
        if next_day_deadline_ms <= now_ms {
            return Err(StationError::InvalidRequest(
                "day deadline must be after current monotonic time",
            ));
        }
        if let Some(watermark) = self.day_watermark {
            if day < watermark {
                self.clock_held = true;
                return Err(StationError::ClockBackward);
            }
            if day > watermark && day - watermark > self.config.max_forward_day_jump {
                self.clock_held = true;
                return Err(StationError::ClockJump);
            }
        }
        if let Some(old) = self.day {
            if day < old.day {
                self.clock_held = true;
                return Err(StationError::ClockBackward);
            }
            if day > old.day {
                if self.active.is_some() {
                    return Err(StationError::AlreadyOwned);
                }
                self.daily_used_ms = 0;
                self.reserved_ms = 0;
            }
        } else if let Some(watermark) = self.day_watermark {
            // After restore, a newer trusted calendar day starts a new daily budget.  Any
            // old reservation remains terminal/deduplicated in the occurrence ledger.
            if day > watermark {
                self.daily_used_ms = 0;
                self.reserved_ms = 0;
            }
        }
        self.day = Some(DayWindow {
            day,
            deadline_ms: next_day_deadline_ms,
        });
        self.day_watermark = Some(self.day_watermark.map_or(day, |old| old.max(day)));
        self.clock_held = self.audit_hold;
        Ok(())
    }

    /// Clears a recovery hold only after the host reports its safe driver sequence.
    pub fn acknowledge_recovery_safe_output(
        &mut self,
        proof: StopProof,
        now_ms: u64,
    ) -> Result<()> {
        self.note_monotonic(now_ms)?;
        if self.actual_output != OutputState::SAFE {
            return Err(StationError::OutputStillApplied);
        }
        let _ = proof; // Commanded and Verified are both valid, but remain distinguishable to the host trace.
        self.recovery_hold = false;
        Ok(())
    }

    /// Entering Auto, Manual, or Configure is only allowed from confirmed Stopped.
    /// Multiple different entries are rejected without changing the station.
    pub fn enter_batch(&mut self, requests: &[EnterRequest]) -> Result<Mode> {
        self.ensure_no_pending()?;
        if requests.is_empty() {
            return Err(StationError::InvalidRequest("empty entry batch"));
        }
        let requested = requests[0].mode;
        if requested == Mode::Stopped {
            return Err(StationError::Unsupported(
                "Stopped is reached only by explicit stop confirmation",
            ));
        }
        for (index, request) in requests.iter().enumerate() {
            self.validate_claim(request.claim)?;
            if request.mode == Mode::Stopped {
                return Err(StationError::Unsupported(
                    "Stopped is reached only by explicit stop confirmation",
                ));
            }
            if request.mode != requested {
                return Err(StationError::ConflictingModeRequests);
            }
            if requests[..index]
                .iter()
                .any(|previous| previous.request_id == request.request_id)
            {
                return Err(StationError::DuplicateRequest);
            }
            self.ensure_new_request(request.request_id)?;
        }
        if self.mode != Mode::Stopped
            || self.stopping
            || self.active.is_some()
            || self.recovery_hold
        {
            return Err(StationError::NotStopped);
        }
        if self
            .seen_requests
            .len()
            .checked_add(requests.len())
            .ok_or(StationError::Overflow)?
            > self.config.max_seen_request_ids
        {
            return Err(StationError::SeenRequestLedgerFull);
        }
        for request in requests {
            self.remember_request(request.request_id)?;
        }
        self.mode = requested;
        Ok(self.mode)
    }

    pub fn enter(&mut self, request: EnterRequest) -> Result<Mode> {
        self.enter_batch(core::slice::from_ref(&request))
    }

    /// Immediate emergency Stop. This never waits for storage: a pending Start is converted into a
    /// conservative reservation/occurrence record, its token is discarded, and later `commit_start`
    /// cannot grant output. The host should persist `snapshot_bytes()` soon afterwards, but safety
    /// output must be applied from the returned directive even when that persistence fails.
    pub fn request_stop(&mut self, request: StopRequest) -> Result<SafetyDirective> {
        self.request_stop_with_occurrences(request, &[])
    }

    /// Immediate Stop variant for same-tick schedule arrivals. Every supplied occurrence is terminal
    /// `SkippedByStop` in the next snapshot. Existing reserved occurrences are also terminalized;
    /// their reserved budget remains charged until a new trusted calendar day.
    pub fn request_stop_with_occurrences(
        &mut self,
        request: StopRequest,
        skipped_occurrences: &[OccurrenceId],
    ) -> Result<SafetyDirective> {
        self.validate_claim(request.claim)?;
        // The stop barrier is deliberately first.  A full bounded audit ledger must never make a
        // valid, current STOP leave a pump commandable while its diagnostics are being recorded.
        // A later start is fail-closed by `stopping` (and, on ledger exhaustion, `clock_held`).
        let mut diagnostic = self.latch_stop_barrier();
        if diagnostic.is_none() {
            diagnostic = self.validate_immediate_skips(skipped_occurrences).err();
        }
        if diagnostic.is_none() {
            diagnostic = self.cancel_pending_for_stop(request.request_id).err();
        } else {
            // A pending start can no longer be granted after the barrier.  Discard it and retain
            // its reservation best-effort; an audit failure remains fail-closed below.
            diagnostic = self
                .cancel_pending_for_stop(request.request_id)
                .err()
                .or(diagnostic);
        }
        if diagnostic.is_none() && !self.seen_requests.contains(&request.request_id) {
            diagnostic = self
                .ensure_new_request(request.request_id)
                .and_then(|_| self.remember_request(request.request_id))
                .err();
        }
        if diagnostic.is_none() {
            diagnostic = self.record_immediate_skips(skipped_occurrences).err();
        }
        if let Some(error) = diagnostic {
            self.fail_closed_after_stop_diagnostic(error);
            return Ok(SafetyDirective {
                force_safe_output: true,
                reason: Some(error),
            });
        }
        Ok(SafetyDirective {
            force_safe_output: true,
            reason: None,
        })
    }

    /// Durable Stop-first arbitration for a tick that also received schedule occurrences.  The returned
    /// image records every supplied occurrence as `SkippedByStop`; callers must commit it before they
    /// accept a later occurrence with the same id.  While it is pending, no start can receive a grant.
    pub fn prepare_stop(
        &mut self,
        request: StopRequest,
        skipped_occurrences: &[OccurrenceId],
    ) -> Result<PreparedPersistence> {
        self.ensure_no_pending()?;
        self.validate_claim(request.claim)?;
        self.ensure_new_request(request.request_id)?;
        self.ready_day()?;
        if self
            .occurrences
            .len()
            .checked_add(skipped_occurrences.len())
            .ok_or(StationError::Overflow)?
            > self.config.max_occurrence_records
        {
            return Err(StationError::LedgerFull);
        }
        for (index, id) in skipped_occurrences.iter().enumerate() {
            if *id == 0 {
                return Err(StationError::InvalidRequest(
                    "occurrence id must be non-zero",
                ));
            }
            if self.occurrences.iter().any(|record| record.id == *id)
                || skipped_occurrences[..index].contains(id)
            {
                return Err(StationError::DuplicateOccurrence);
            }
        }
        let next_stop_generation = self
            .stop_generation
            .checked_add(1)
            .ok_or(StationError::Overflow)?;
        let token = self.next_token()?;
        let pending = Pending {
            token,
            kind: PendingKind::Stop {
                request_id: request.request_id,
                next_stop_generation,
                skipped_occurrences: skipped_occurrences.to_vec(),
            },
        };
        let bytes = self.encode_projected(&pending)?;
        self.pending = Some(pending);
        Ok(PreparedPersistence { token, bytes })
    }

    /// Confirm a stop when the station never held a session (for example Auto was waiting for a slot).
    pub fn confirm_stopped(&mut self, proof: StopProof, now_ms: u64) -> Result<()> {
        self.ensure_no_pending()?;
        self.note_monotonic(now_ms)?;
        if !self.stopping {
            return Err(StationError::StopNotRequested);
        }
        if self.active.is_some() {
            return Err(StationError::InvalidRequest(
                "active session needs durable prepare_finish",
            ));
        }
        if self.actual_output != OutputState::SAFE {
            return Err(StationError::OutputStillApplied);
        }
        let _ = proof;
        self.mode = Mode::Stopped;
        self.stopping = false;
        Ok(())
    }

    /// Select one request from a same-tick snapshot.  The lowest request id wins deterministically;
    /// the caller receives no grant for all other candidates and may retry them in a later tick.
    pub fn prepare_start_batch(
        &mut self,
        requests: &[StartRequest],
    ) -> Result<(usize, PreparedPersistence)> {
        if requests.is_empty() {
            return Err(StationError::InvalidRequest("empty start batch"));
        }
        let mut winner = 0usize;
        for index in 1..requests.len() {
            if requests[index].request_id < requests[winner].request_id {
                winner = index;
            }
        }
        let prepared = self.prepare_start(requests[winner])?;
        Ok((winner, prepared))
    }

    /// Validates and serializes an atomic reservation.  It does not create a start grant.
    pub fn prepare_start(&mut self, request: StartRequest) -> Result<PreparedPersistence> {
        self.ensure_no_pending()?;
        self.validate_claim(request.claim)?;
        self.ensure_new_request(request.request_id)?;
        self.validate_start_request(request)?;
        if self.recovery_hold {
            return Err(StationError::RecoveryHold);
        }
        if self.stopping {
            return Err(StationError::Stopping);
        }
        if self.mode != request.mode || !matches!(request.mode, Mode::Auto | Mode::Manual) {
            return Err(StationError::ModeMismatch);
        }
        if self.active.is_some() {
            return Err(StationError::AlreadyOwned);
        }
        let day = self.ready_day()?;
        if request.now_ms >= day.deadline_ms
            || request
                .now_ms
                .checked_add(request.budget_ms)
                .ok_or(StationError::Overflow)?
                > day.deadline_ms
        {
            return Err(StationError::CrossesDayBoundary);
        }
        if let Some(last) = self.last_monotonic_ms {
            if request.now_ms < last {
                return Err(StationError::MonotonicBackward);
            }
        }
        if let Some(occurrence) = request.occurrence_id {
            if self
                .occurrences
                .iter()
                .any(|record| record.id == occurrence)
            {
                return Err(StationError::DuplicateOccurrence);
            }
            if self.occurrences.len() >= self.config.max_occurrence_records {
                return Err(StationError::LedgerFull);
            }
        }
        let capacity = request.capacity.check()?;
        if self.config.require_capacity_pass && capacity != CapacityCheck::Pass {
            return Err(StationError::CapacityRequired);
        }
        let reserved_after = self
            .reserved_ms
            .checked_add(request.budget_ms)
            .ok_or(StationError::Overflow)?;
        if self
            .daily_used_ms
            .checked_add(reserved_after)
            .ok_or(StationError::Overflow)?
            > self.config.daily_quota_ms
        {
            return Err(StationError::QuotaExceeded);
        }
        let lease_deadline_ms = request
            .now_ms
            .checked_add(request.budget_ms)
            .ok_or(StationError::Overflow)?;
        let token = self.next_token()?;
        let pending = Pending {
            token,
            kind: PendingKind::Start {
                request,
                capacity,
                lease_deadline_ms,
            },
        };
        let bytes = self.encode_projected(&pending)?;
        self.pending = Some(pending);
        Ok(PreparedPersistence { token, bytes })
    }

    /// Creates a durable, all-or-nothing configuration revision transition.
    pub fn prepare_apply(&mut self, request: ApplyRequest) -> Result<PreparedPersistence> {
        self.ensure_no_pending()?;
        self.validate_claim(request.claim)?;
        self.ensure_new_request(request.request_id)?;
        if self.mode != Mode::Configure
            || self.stopping
            || self.active.is_some()
            || self.actual_output != OutputState::SAFE
            || self.recovery_hold
        {
            return Err(StationError::NotStopped);
        }
        if request.next_revision != self.revision.checked_add(1).ok_or(StationError::Overflow)? {
            return Err(StationError::InvalidRequest(
                "next revision must be current revision plus one",
            ));
        }
        let token = self.next_token()?;
        let pending = Pending {
            token,
            kind: PendingKind::Apply {
                request_id: request.request_id,
                next_revision: request.next_revision,
            },
        };
        let bytes = self.encode_projected(&pending)?;
        self.pending = Some(pending);
        Ok(PreparedPersistence { token, bytes })
    }

    /// Outputs must be already reported safe.  Settlement returns unused reserved budget only in the
    /// same prepared durable image that records the terminal occurrence.
    pub fn prepare_finish(
        &mut self,
        session_id: SessionId,
        outcome: FinishOutcome,
        now_ms: u64,
    ) -> Result<PreparedPersistence> {
        self.ensure_no_pending()?;
        self.note_monotonic(now_ms)?;
        let active = self.active.ok_or(StationError::SessionMismatch)?;
        if active.session_id != session_id {
            return Err(StationError::SessionMismatch);
        }
        if self.actual_output != OutputState::SAFE {
            return Err(StationError::OutputStillApplied);
        }
        let token = self.next_token()?;
        let pending = Pending {
            token,
            kind: PendingKind::Finish {
                session_id,
                outcome,
                actual_on_ms: active.actual_on_ms,
            },
        };
        let bytes = self.encode_projected(&pending)?;
        self.pending = Some(pending);
        Ok(PreparedPersistence { token, bytes })
    }

    pub fn abort_prepared(&mut self, token: u64) -> Result<()> {
        let pending = self
            .pending
            .as_ref()
            .ok_or(StationError::NoPendingPersistence)?;
        if pending.token != token {
            return Err(StationError::PersistenceTokenMismatch);
        }
        self.pending = None;
        Ok(())
    }

    /// Host code calls this only after a successful durable write of `PreparedPersistence::bytes()`.
    pub fn commit_start(&mut self, ack: DurableAck) -> Result<StartGrant> {
        let pending = self.take_pending(ack)?;
        let PendingKind::Start {
            request,
            capacity,
            lease_deadline_ms,
        } = pending.kind
        else {
            self.pending = Some(pending);
            return Err(StationError::NoPendingPersistence);
        };
        // Time is allowed to advance while a host write is pending. Never roll it back to
        // request.now_ms: an expired persisted grant is rejected and conservatively retained.
        let current_now = self.last_monotonic_ms.unwrap_or(request.now_ms);
        let invalid = self.stopping
            || self.active.is_some()
            || self.mode != request.mode
            || self.recovery_hold
            || self.validate_claim(request.claim).is_err()
            || self.validate_start_request(request).is_err()
            || self
                .ready_day()
                .map_or(true, |day| current_now >= day.deadline_ms)
            || current_now >= lease_deadline_ms;
        if invalid {
            self.conserve_uncommitted_start(request)?;
            return Err(if current_now >= lease_deadline_ms {
                StationError::LeaseExpired
            } else {
                StationError::PersistenceNotAcknowledged
            });
        }
        self.conserve_uncommitted_start(request)?;
        self.active = Some(ActiveSession {
            session_id: request.session_id,
            owner_id: request.owner_id,
            mode: request.mode,
            valves: request.valves,
            reserved_ms: request.budget_ms,
            actual_on_ms: 0,
            lease_deadline_ms,
            occurrence_id: request.occurrence_id,
            last_authorized: OutputState::SAFE,
        });
        self.last_monotonic_ms = Some(current_now.max(request.now_ms));
        Ok(StartGrant {
            session_id: request.session_id,
            owner_id: request.owner_id,
            valves: request.valves,
            lease_deadline_ms,
            capacity,
        })
    }

    pub fn commit_apply(&mut self, ack: DurableAck) -> Result<u64> {
        let pending = self.take_pending(ack)?;
        let PendingKind::Apply {
            request_id,
            next_revision,
        } = pending.kind
        else {
            self.pending = Some(pending);
            return Err(StationError::NoPendingPersistence);
        };
        if self.mode != Mode::Configure || self.stopping || self.active.is_some() {
            return Err(StationError::PersistenceNotAcknowledged);
        }
        self.revision = next_revision;
        self.remember_request(request_id)?;
        // Request ids are retained after all state changes, including active revision replacement.
        // This prevents a duplicated Apply request from silently applying a second revision.
        Ok(self.revision)
    }

    /// Commits an explicit Stop and all same-tick skipped occurrence terminals after their image is durable.
    pub fn commit_stop(&mut self, ack: DurableAck) -> Result<SafetyDirective> {
        let pending = self.take_pending(ack)?;
        let PendingKind::Stop {
            request_id,
            next_stop_generation,
            skipped_occurrences,
        } = pending.kind
        else {
            self.pending = Some(pending);
            return Err(StationError::NoPendingPersistence);
        };
        let day = self.ready_day()?.day;
        self.remember_request(request_id)?;
        for id in skipped_occurrences {
            self.occurrences.push(OccurrenceRecord {
                id,
                day,
                status: OccurrenceStatus::SkippedByStop,
            });
        }
        self.stop_generation = next_stop_generation;
        self.stopping = true;
        Ok(SafetyDirective {
            force_safe_output: true,
            reason: None,
        })
    }

    pub fn commit_finish(&mut self, ack: DurableAck) -> Result<()> {
        let pending = self.take_pending(ack)?;
        let PendingKind::Finish {
            session_id,
            outcome,
            actual_on_ms,
        } = pending.kind
        else {
            self.pending = Some(pending);
            return Err(StationError::NoPendingPersistence);
        };
        let active = self.active.ok_or(StationError::SessionMismatch)?;
        if active.session_id != session_id || self.actual_output != OutputState::SAFE {
            return Err(StationError::PersistenceNotAcknowledged);
        }
        self.reserved_ms = self
            .reserved_ms
            .checked_sub(active.reserved_ms)
            .ok_or(StationError::Overflow)?;
        self.daily_used_ms = self
            .daily_used_ms
            .checked_add(actual_on_ms)
            .ok_or(StationError::Overflow)?;
        if let Some(occurrence_id) = active.occurrence_id {
            if let Some(record) = self
                .occurrences
                .iter_mut()
                .find(|record| record.id == occurrence_id)
            {
                record.status = OccurrenceStatus::from_finish(outcome);
            }
        }
        self.active = None;
        if self.stopping {
            self.mode = Mode::Stopped;
            self.stopping = false;
        }
        Ok(())
    }

    /// Grants a desired pump/valve command only to the session that already committed a reservation.
    pub fn authorize_output(
        &mut self,
        session_id: SessionId,
        output: OutputState,
        now_ms: u64,
    ) -> Result<OutputGrant> {
        self.ensure_no_pending()?;
        self.note_monotonic(now_ms)?;
        let active = self.active.ok_or(StationError::SessionMismatch)?;
        if active.session_id != session_id {
            return Err(StationError::SessionMismatch);
        }
        if self.stopping || self.recovery_hold {
            return Err(StationError::Stopping);
        }
        if now_ms >= active.lease_deadline_ms
            || self.day.map_or(true, |day| now_ms >= day.deadline_ms)
        {
            return Err(StationError::LeaseExpired);
        }
        self.validate_output_for(active, output)?;
        let active = self.active.as_mut().expect("checked active");
        active.last_authorized = output;
        Ok(OutputGrant {
            session_id,
            output,
            lease_deadline_ms: active.lease_deadline_ms,
        })
    }

    /// The host reports what its Driver actually applied. Time spent ON is accounted globally here,
    /// including a driver overrun, so an overrun cannot be hidden by treating it as zero usage.
    pub fn report_applied(
        &mut self,
        session_id: SessionId,
        output: OutputState,
        now_ms: u64,
    ) -> Result<()> {
        let active = self.active.ok_or(StationError::SessionMismatch)?;
        if active.session_id != session_id {
            return Err(StationError::SessionMismatch);
        }
        self.note_monotonic(now_ms)?;
        let active = self
            .active
            .expect("checked active before monotonic accounting");
        if output != OutputState::SAFE && output != active.last_authorized {
            return Err(StationError::OutputNotAuthorized);
        }
        self.validate_output_for(active, output)?;
        if self.stopping && output != OutputState::SAFE {
            return Err(StationError::UnsafeOutput);
        }
        self.actual_output = output;
        Ok(())
    }

    /// Advance accounting even if the host has no new desired output.  At a lease or trusted-day
    /// deadline the caller receives a safe-output directive while the owner remains exclusive until finish.
    pub fn advance(&mut self, now_ms: u64) -> Result<SafetyDirective> {
        self.note_monotonic(now_ms)?;
        let force = self.active.map_or(false, |active| {
            now_ms >= active.lease_deadline_ms
                || self.day.map_or(true, |day| now_ms >= day.deadline_ms)
        });
        Ok(SafetyDirective {
            force_safe_output: force,
            reason: force.then_some(StationError::LeaseExpired),
        })
    }

    /// Host may report safe output before an idle stop confirmation or recovery acknowledgement.
    pub fn report_safe_output_without_session(&mut self, now_ms: u64) -> Result<()> {
        if self.active.is_some() {
            return Err(StationError::SessionMismatch);
        }
        self.note_monotonic(now_ms)?;
        self.actual_output = OutputState::SAFE;
        Ok(())
    }

    /// Returns a minimal committed snapshot. Prepared transition bytes are intentionally supplied by
    /// each `prepare_*` result instead, because those are the exact images that must be made durable.
    pub fn snapshot_bytes(&self) -> Result<Vec<u8>> {
        self.encode_state(None)
    }

    /// Restoring never resumes physical output. Any recovered active/prepared reservation stays charged,
    /// keeps its occurrence deduplicated, and blocks new starts until safe output is explicitly acknowledged.
    pub fn restore(config: StationConfig, bytes: &[u8]) -> Result<Self> {
        config.validate()?;
        let mut reader = Reader::new(bytes);
        if reader.bytes(4)? != MAGIC {
            return Err(StationError::Snapshot("station snapshot magic mismatch"));
        }
        if reader.u8()? != FORMAT_VERSION {
            return Err(StationError::Snapshot(
                "unsupported station snapshot version",
            ));
        }
        let valve_count = reader.u8()?;
        let max_open = reader.u8()?;
        let quota = reader.u64()?;
        let max_start_budget = reader.u64()?;
        let max_occurrences = reader.u16()? as usize;
        let max_seen = reader.u16()? as usize;
        let max_forward_day_jump = reader.u32()?;
        let require_capacity_pass =
            reader.flag("invalid require-capacity flag in station snapshot")?;
        if valve_count != config.valve_count
            || max_open != config.max_open_valves
            || quota != config.daily_quota_ms
            || max_start_budget != config.max_start_budget_ms
            || max_occurrences != config.max_occurrence_records
            || max_seen != config.max_seen_request_ids
            || max_forward_day_jump != config.max_forward_day_jump
            || require_capacity_pass != config.require_capacity_pass
        {
            return Err(StationError::Snapshot(
                "snapshot safety configuration does not match station configuration",
            ));
        }
        let revision = reader.u64()?;
        let stop_generation = reader.u64()?;
        let persisted_mode = Mode::from_byte(reader.u8()?)?;
        let persisted_stopping = reader.flag("invalid stopping flag in station snapshot")?;
        let watermark = if reader.flag("invalid day-watermark presence flag in station snapshot")? {
            Some(reader.u32()?)
        } else {
            None
        };
        let budget_day = if reader.flag("invalid budget-day presence flag in station snapshot")? {
            Some(reader.u32()?)
        } else {
            None
        };
        let daily_used_ms = reader.u64()?;
        let reserved_ms = reader.u64()?;
        let had_unsettled = reader.flag("invalid unsettled flag in station snapshot")?;
        let audit_hold = reader.flag("invalid audit-hold flag in station snapshot")?;
        let occurrence_count = reader.u16()? as usize;
        if occurrence_count > config.max_occurrence_records {
            return Err(StationError::Snapshot(
                "snapshot occurrence ledger exceeds configured bound",
            ));
        }
        let mut occurrences = Vec::with_capacity(occurrence_count);
        for _ in 0..occurrence_count {
            let id = reader.u64()?;
            if id == 0
                || occurrences
                    .iter()
                    .any(|record: &OccurrenceRecord| record.id == id)
            {
                return Err(StationError::Snapshot(
                    "invalid or duplicate occurrence id in station snapshot",
                ));
            }
            occurrences.push(OccurrenceRecord {
                id,
                day: reader.u32()?,
                status: OccurrenceStatus::from_byte(reader.u8()?)?,
            });
        }
        let seen_count = reader.u16()? as usize;
        if seen_count > config.max_seen_request_ids {
            return Err(StationError::Snapshot(
                "snapshot request ledger exceeds configured bound",
            ));
        }
        let mut seen_requests = Vec::with_capacity(seen_count);
        for _ in 0..seen_count {
            let id = reader.u64()?;
            if id == 0 || seen_requests.contains(&id) {
                return Err(StationError::Snapshot(
                    "invalid or duplicate request id in station snapshot",
                ));
            }
            seen_requests.push(id);
        }
        if !reader.finished() {
            return Err(StationError::Snapshot("trailing station snapshot bytes"));
        }
        if watermark != budget_day {
            return Err(StationError::Snapshot(
                "budget day and day watermark must agree",
            ));
        }
        if budget_day.is_none() && (daily_used_ms != 0 || reserved_ms != 0) {
            return Err(StationError::Snapshot(
                "station budget counters require a trusted budget day",
            ));
        }
        if reserved_ms != 0 && !had_unsettled {
            return Err(StationError::Snapshot(
                "reserved budget requires an unsettled snapshot marker",
            ));
        }
        if daily_used_ms
            .checked_add(reserved_ms)
            .ok_or(StationError::Overflow)?
            > config.daily_quota_ms
            && !had_unsettled
        {
            return Err(StationError::Snapshot(
                "settled snapshot exceeds daily quota",
            ));
        }
        Ok(Self {
            config,
            revision,
            stop_generation,
            mode: if had_unsettled {
                Mode::Stopped
            } else {
                persisted_mode
            },
            stopping: false,
            day: budget_day.map(|day| DayWindow {
                day,
                deadline_ms: 0,
            }),
            day_watermark: watermark,
            clock_held: true,
            audit_hold,
            daily_used_ms,
            reserved_ms,
            occurrences,
            seen_requests,
            active: None,
            pending: None,
            actual_output: OutputState::SAFE,
            last_monotonic_ms: None,
            recovery_hold: had_unsettled || persisted_stopping,
            next_token: 1,
        })
    }

    fn validate_claim(&self, claim: Claim) -> Result<()> {
        if claim.revision != self.revision {
            return Err(StationError::StaleRevision);
        }
        if claim.stop_generation != self.stop_generation {
            return Err(StationError::StaleStopGeneration);
        }
        Ok(())
    }

    fn ensure_no_pending(&self) -> Result<()> {
        if self.pending.is_some() {
            Err(StationError::PendingPersistence)
        } else {
            Ok(())
        }
    }
    fn ensure_new_request(&self, request_id: RequestId) -> Result<()> {
        if request_id == 0 {
            return Err(StationError::InvalidRequest("request id must be non-zero"));
        }
        if self.seen_requests.contains(&request_id)
            || self
                .pending
                .as_ref()
                .map_or(false, |pending| match &pending.kind {
                    PendingKind::Start { request, .. } => request.request_id == request_id,
                    _ => false,
                })
        {
            return Err(StationError::DuplicateRequest);
        }
        if self.seen_requests.len() >= self.config.max_seen_request_ids {
            return Err(StationError::SeenRequestLedgerFull);
        }
        Ok(())
    }
    fn remember_request(&mut self, request_id: RequestId) -> Result<()> {
        if self.seen_requests.len() >= self.config.max_seen_request_ids {
            return Err(StationError::SeenRequestLedgerFull);
        }
        self.seen_requests.push(request_id);
        Ok(())
    }
    fn ready_day(&self) -> Result<DayWindow> {
        if self.clock_held {
            return Err(StationError::ClockUntrusted);
        }
        self.day.ok_or(StationError::DayNotSynchronized)
    }
    fn ledger_day(&self) -> u32 {
        self.day
            .map(|day| day.day)
            .or(self.day_watermark)
            .unwrap_or(0)
    }
    fn validate_immediate_skips(&self, skipped_occurrences: &[OccurrenceId]) -> Result<()> {
        let pending_start = self
            .pending
            .as_ref()
            .and_then(|pending| match &pending.kind {
                PendingKind::Start { request, .. } => request.occurrence_id,
                _ => None,
            });
        let pending_stop = self
            .pending
            .as_ref()
            .and_then(|pending| match &pending.kind {
                PendingKind::Stop {
                    skipped_occurrences,
                    ..
                } => Some(skipped_occurrences.as_slice()),
                _ => None,
            });
        let mut additions = usize::from(
            pending_start.is_some() && !skipped_occurrences.contains(&pending_start.unwrap()),
        );
        if let Some(pending_stop) = pending_stop {
            for id in pending_stop {
                if !self.occurrences.iter().any(|record| record.id == *id)
                    && !skipped_occurrences.contains(id)
                {
                    additions = additions.checked_add(1).ok_or(StationError::Overflow)?;
                }
            }
        }
        for (index, id) in skipped_occurrences.iter().enumerate() {
            if *id == 0 {
                return Err(StationError::InvalidRequest(
                    "occurrence id must be non-zero",
                ));
            }
            if skipped_occurrences[..index].contains(id) {
                return Err(StationError::DuplicateOccurrence);
            }
            if let Some(record) = self.occurrences.iter().find(|record| record.id == *id) {
                if record.status != OccurrenceStatus::Reserved {
                    return Err(StationError::DuplicateOccurrence);
                }
            } else if Some(*id) != pending_start
                && !pending_stop.map_or(false, |ids| ids.contains(id))
            {
                additions = additions.checked_add(1).ok_or(StationError::Overflow)?;
            }
        }
        if self
            .occurrences
            .len()
            .checked_add(additions)
            .ok_or(StationError::Overflow)?
            > self.config.max_occurrence_records
        {
            return Err(StationError::LedgerFull);
        }
        Ok(())
    }
    fn record_immediate_skips(&mut self, skipped_occurrences: &[OccurrenceId]) -> Result<()> {
        let day = self.ledger_day();
        for id in skipped_occurrences {
            if let Some(record) = self.occurrences.iter_mut().find(|record| record.id == *id) {
                record.status = OccurrenceStatus::SkippedByStop;
            } else {
                self.occurrences.push(OccurrenceRecord {
                    id: *id,
                    day,
                    status: OccurrenceStatus::SkippedByStop,
                });
            }
        }
        Ok(())
    }
    /// Latches the physical safety barrier without any bounded-ledger allocation.  Overflow is
    /// reported as a directive diagnostic, but the `stopping` barrier still prevents new grants.
    fn latch_stop_barrier(&mut self) -> Option<StationError> {
        if self.stopping {
            return None;
        }
        self.stopping = true;
        match self.stop_generation.checked_add(1) {
            Some(next) => {
                self.stop_generation = next;
                None
            }
            None => Some(StationError::Overflow),
        }
    }
    fn fail_closed_after_stop_diagnostic(&mut self, error: StationError) {
        if matches!(
            error,
            StationError::LedgerFull | StationError::SeenRequestLedgerFull | StationError::Overflow
        ) {
            // The immutable snapshot may not contain every terminal audit entry.  Do not permit a
            // subsequent start merely because the host later synchronizes a fresh calendar day.
            self.clock_held = true;
            self.audit_hold = true;
        }
    }
    /// Retain a prepared start as a conservative reservation when it cannot receive a grant.
    /// Reservation is charged before bounded audit records, so a full ledger cannot erase a
    /// prepared budget.  A caller that receives an error must remain fail-closed.
    fn conserve_uncommitted_start(&mut self, request: StartRequest) -> Result<()> {
        self.reserved_ms = self
            .reserved_ms
            .checked_add(request.budget_ms)
            .ok_or(StationError::Overflow)?;
        if let Some(id) = request.occurrence_id {
            if !self.occurrences.iter().any(|record| record.id == id) {
                if self.occurrences.len() >= self.config.max_occurrence_records {
                    return Err(StationError::LedgerFull);
                }
                self.occurrences.push(OccurrenceRecord {
                    id,
                    day: self.ledger_day(),
                    status: OccurrenceStatus::Reserved,
                });
            }
        }
        if !self.seen_requests.contains(&request.request_id) {
            self.remember_request(request.request_id)?;
        }
        Ok(())
    }
    /// Cancels non-durable transitions without allowing a Start to disappear from its budget or
    /// occurrence ledger. Returns true when the immediate request matched a prepared Stop request.
    fn cancel_pending_for_stop(&mut self, request_id: RequestId) -> Result<bool> {
        let Some(pending) = self.pending.take() else {
            return Ok(false);
        };
        match pending.kind {
            PendingKind::Start { request, .. } => {
                self.conserve_uncommitted_start(request)?;
                Ok(false)
            }
            PendingKind::Stop {
                request_id: prepared_id,
                next_stop_generation,
                skipped_occurrences,
            } => {
                self.remember_request(prepared_id)?;
                self.record_immediate_skips(&skipped_occurrences)?;
                self.stop_generation = self.stop_generation.max(next_stop_generation);
                self.stopping = true;
                Ok(prepared_id == request_id)
            }
            // Apply was never committed and Finish keeps its active reservation. Both are safe to
            // abandon so the immediate Stop can proceed and later final settlement can be prepared.
            PendingKind::Apply { .. } | PendingKind::Finish { .. } => Ok(false),
        }
    }
    fn validate_start_request(&self, request: StartRequest) -> Result<()> {
        if request.session_id == 0 || request.owner_id == 0 {
            return Err(StationError::InvalidRequest(
                "session and owner ids must be non-zero",
            ));
        }
        if request.valves == 0 || request.valves & !self.valid_valve_mask() != 0 {
            return Err(StationError::InvalidRequest(
                "valve mask is empty or outside station valve_count",
            ));
        }
        if request.budget_ms == 0 || request.budget_ms > self.config.max_start_budget_ms {
            return Err(StationError::InvalidRequest(
                "start budget must be finite and within station maximum",
            ));
        }
        Ok(())
    }
    fn validate_output_for(&self, active: ActiveSession, output: OutputState) -> Result<()> {
        if output.valves & !active.valves != 0 || output.valves & !self.valid_valve_mask() != 0 {
            return Err(StationError::UnsafeOutput);
        }
        if output.valves.count_ones() > self.config.max_open_valves as u32 {
            return Err(StationError::UnsafeOutput);
        }
        if output.pump_on && output.valves == 0 {
            return Err(StationError::UnsafeOutput);
        }
        Ok(())
    }
    fn valid_valve_mask(&self) -> ValveMask {
        if self.config.valve_count == 64 {
            u64::MAX
        } else {
            (1u64 << self.config.valve_count) - 1
        }
    }
    fn next_token(&mut self) -> Result<u64> {
        let token = self.next_token;
        self.next_token = self
            .next_token
            .checked_add(1)
            .ok_or(StationError::Overflow)?;
        Ok(token)
    }
    fn take_pending(&mut self, ack: DurableAck) -> Result<Pending> {
        let pending = self
            .pending
            .take()
            .ok_or(StationError::NoPendingPersistence)?;
        if pending.token != ack.token {
            self.pending = Some(pending);
            return Err(StationError::PersistenceTokenMismatch);
        }
        Ok(pending)
    }
    fn note_monotonic(&mut self, now_ms: u64) -> Result<()> {
        if let Some(last) = self.last_monotonic_ms {
            if now_ms < last {
                return Err(StationError::MonotonicBackward);
            }
            if self.actual_output.pump_on {
                let elapsed = now_ms - last;
                let active = self
                    .active
                    .as_mut()
                    .ok_or(StationError::OutputNotAuthorized)?;
                active.actual_on_ms = active
                    .actual_on_ms
                    .checked_add(elapsed)
                    .ok_or(StationError::Overflow)?;
            }
        }
        self.last_monotonic_ms = Some(now_ms);
        Ok(())
    }

    fn encode_projected(&self, pending: &Pending) -> Result<Vec<u8>> {
        self.encode_state(Some(pending))
    }
    fn encode_state(&self, pending: Option<&Pending>) -> Result<Vec<u8>> {
        let mut revision = self.revision;
        let mut mode = self.mode;
        let mut stopping = self.stopping;
        let mut used = self.daily_used_ms;
        let mut reserved = self.reserved_ms;
        let mut occurrences = self.occurrences.clone();
        let mut seen = self.seen_requests.clone();
        let mut had_unsettled = self.active.is_some() || self.reserved_ms != 0;
        let mut stop_generation = self.stop_generation;
        if let Some(pending) = pending {
            match &pending.kind {
                PendingKind::Start { request, .. } => {
                    reserved = reserved
                        .checked_add(request.budget_ms)
                        .ok_or(StationError::Overflow)?;
                    if let Some(id) = request.occurrence_id {
                        occurrences.push(OccurrenceRecord {
                            id,
                            day: self.ready_day()?.day,
                            status: OccurrenceStatus::Reserved,
                        });
                    }
                    seen.push(request.request_id);
                    had_unsettled = true;
                }
                PendingKind::Finish {
                    session_id,
                    outcome,
                    actual_on_ms,
                } => {
                    let active = self.active.ok_or(StationError::SessionMismatch)?;
                    if active.session_id != *session_id {
                        return Err(StationError::SessionMismatch);
                    }
                    reserved = reserved
                        .checked_sub(active.reserved_ms)
                        .ok_or(StationError::Overflow)?;
                    used = used
                        .checked_add(*actual_on_ms)
                        .ok_or(StationError::Overflow)?;
                    if let Some(id) = active.occurrence_id {
                        if let Some(record) = occurrences.iter_mut().find(|record| record.id == id)
                        {
                            record.status = OccurrenceStatus::from_finish(*outcome);
                        }
                    }
                    had_unsettled = false;
                    if stopping {
                        mode = Mode::Stopped;
                        stopping = false;
                    }
                }
                PendingKind::Apply {
                    request_id,
                    next_revision,
                } => {
                    revision = *next_revision;
                    seen.push(*request_id);
                }
                PendingKind::Stop {
                    request_id,
                    next_stop_generation,
                    skipped_occurrences,
                } => {
                    stop_generation = *next_stop_generation;
                    stopping = true;
                    seen.push(*request_id);
                    let day = self.ready_day()?.day;
                    for id in skipped_occurrences {
                        occurrences.push(OccurrenceRecord {
                            id: *id,
                            day,
                            status: OccurrenceStatus::SkippedByStop,
                        });
                    }
                }
            }
        }
        if occurrences.len() > self.config.max_occurrence_records
            || seen.len() > self.config.max_seen_request_ids
        {
            return Err(StationError::LedgerFull);
        }
        let mut writer = Writer::new();
        writer.bytes(MAGIC);
        writer.u8(FORMAT_VERSION);
        writer.u8(self.config.valve_count);
        writer.u8(self.config.max_open_valves);
        writer.u64(self.config.daily_quota_ms);
        writer.u64(self.config.max_start_budget_ms);
        writer.u16(self.config.max_occurrence_records as u16);
        writer.u16(self.config.max_seen_request_ids as u16);
        writer.u32(self.config.max_forward_day_jump);
        writer.u8(self.config.require_capacity_pass as u8);
        writer.u64(revision);
        writer.u64(stop_generation);
        writer.u8(mode.byte());
        writer.u8(stopping as u8);
        match self.day_watermark {
            Some(day) => {
                writer.u8(1);
                writer.u32(day);
            }
            None => writer.u8(0),
        }
        match self.day {
            Some(day) => {
                writer.u8(1);
                writer.u32(day.day);
            }
            None => writer.u8(0),
        }
        writer.u64(used);
        writer.u64(reserved);
        writer.u8(had_unsettled as u8);
        writer.u8(self.audit_hold as u8);
        writer.u16(occurrences.len() as u16);
        for record in occurrences {
            writer.u64(record.id);
            writer.u32(record.day);
            writer.u8(record.status.byte());
        }
        writer.u16(seen.len() as u16);
        for id in seen {
            writer.u64(id);
        }
        Ok(writer.finish())
    }
}

struct Writer {
    bytes: Vec<u8>,
}
impl Writer {
    fn new() -> Self {
        Self { bytes: Vec::new() }
    }
    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }
    fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    fn bytes(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    fn finished(&self) -> bool {
        self.at == self.bytes.len()
    }
    fn bytes(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(StationError::Snapshot("truncated station snapshot"))?;
        let value = &self.bytes[self.at..end];
        self.at = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(
            self.bytes(2)?
                .try_into()
                .map_err(|_| StationError::Snapshot("invalid u16"))?,
        ))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.bytes(4)?
                .try_into()
                .map_err(|_| StationError::Snapshot("invalid u32"))?,
        ))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(
            self.bytes(8)?
                .try_into()
                .map_err(|_| StationError::Snapshot("invalid u64"))?,
        ))
    }
    fn flag(&mut self, message: &'static str) -> Result<bool> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(StationError::Snapshot(message)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> StationConfig {
        StationConfig {
            valve_count: 4,
            max_open_valves: 2,
            daily_quota_ms: 1_000,
            max_start_budget_ms: 800,
            max_occurrence_records: 8,
            max_seen_request_ids: 16,
            max_forward_day_jump: 2,
            require_capacity_pass: false,
        }
    }
    fn station() -> Station {
        let mut station = Station::new(config()).unwrap();
        station.synchronize_day(100, 0, 10_000, true).unwrap();
        station
    }
    fn claim(station: &Station) -> Claim {
        station.claim()
    }
    fn enter(station: &mut Station, mode: Mode, request_id: u64) {
        station
            .enter(EnterRequest {
                request_id,
                claim: claim(station),
                mode,
            })
            .unwrap();
    }
    fn start_request(
        station: &Station,
        request_id: u64,
        occurrence: Option<u64>,
        now: u64,
        budget: u64,
    ) -> StartRequest {
        StartRequest {
            request_id,
            claim: claim(station),
            session_id: 77,
            owner_id: 88,
            mode: Mode::Auto,
            valves: 0b11,
            budget_ms: budget,
            occurrence_id: occurrence,
            capacity: CapacityObservation::default(),
            now_ms: now,
        }
    }
    fn commit_start(station: &mut Station, request: StartRequest) -> StartGrant {
        let prepared = station.prepare_start(request).unwrap();
        station
            .commit_start(DurableAck::new(prepared.token()))
            .unwrap()
    }
    fn stop_and_finish(station: &mut Station, now: u64) {
        station
            .request_stop(StopRequest {
                request_id: 900,
                claim: claim(station),
            })
            .unwrap();
        station.report_applied(77, OutputState::SAFE, now).unwrap();
        let prepared = station
            .prepare_finish(77, FinishOutcome::Cancelled, now)
            .unwrap();
        station
            .commit_finish(DurableAck::new(prepared.token()))
            .unwrap();
    }

    #[test]
    fn entry_requires_confirmed_stopped_and_explicit_stop_path() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        assert_eq!(
            s.enter(EnterRequest {
                request_id: 2,
                claim: claim(&s),
                mode: Mode::Manual
            }),
            Err(StationError::NotStopped)
        );
        s.request_stop(StopRequest {
            request_id: 3,
            claim: claim(&s),
        })
        .unwrap();
        assert_eq!(
            s.enter(EnterRequest {
                request_id: 4,
                claim: claim(&s),
                mode: Mode::Manual
            }),
            Err(StationError::NotStopped)
        );
        s.confirm_stopped(StopProof::Commanded, 1).unwrap();
        enter(&mut s, Mode::Manual, 5);
        assert_eq!(s.mode(), Mode::Manual);
    }

    #[test]
    fn conflicting_mode_batch_is_atomic() {
        let mut s = station();
        let before = s.claim();
        let result = s.enter_batch(&[
            EnterRequest {
                request_id: 1,
                claim: before,
                mode: Mode::Auto,
            },
            EnterRequest {
                request_id: 2,
                claim: before,
                mode: Mode::Manual,
            },
        ]);
        assert_eq!(result, Err(StationError::ConflictingModeRequests));
        assert_eq!(s.mode(), Mode::Stopped);
        assert_eq!(s.claim(), before);
    }

    #[test]
    fn duplicate_mode_request_in_a_batch_is_not_processed_twice() {
        let mut s = station();
        let current = claim(&s);
        assert_eq!(
            s.enter_batch(&[
                EnterRequest {
                    request_id: 1,
                    claim: current,
                    mode: Mode::Auto
                },
                EnterRequest {
                    request_id: 1,
                    claim: current,
                    mode: Mode::Auto
                },
            ]),
            Err(StationError::DuplicateRequest)
        );
        assert_eq!(s.mode(), Mode::Stopped);
    }

    #[test]
    fn output_needs_durable_start_commit() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let p = s
            .prepare_start(start_request(&s, 2, None, 10, 100))
            .unwrap();
        assert_eq!(
            s.authorize_output(
                77,
                OutputState {
                    pump_on: true,
                    valves: 1
                },
                10
            ),
            Err(StationError::PendingPersistence)
        );
        s.commit_start(DurableAck::new(p.token())).unwrap();
        assert!(s
            .authorize_output(
                77,
                OutputState {
                    pump_on: true,
                    valves: 1
                },
                10
            )
            .is_ok());
    }

    #[test]
    fn immediate_stop_cancels_pending_start_but_keeps_its_reservation_and_occurrence() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let prepared = s
            .prepare_start(start_request(&s, 2, Some(333), 10, 100))
            .unwrap();
        let directive = s
            .request_stop(StopRequest {
                request_id: 3,
                claim: claim(&s),
            })
            .unwrap();
        assert!(directive.force_safe_output);
        assert!(s.stopping());
        assert_eq!(s.reserved_ms(), 100);
        assert_eq!(
            s.commit_start(DurableAck::new(prepared.token())),
            Err(StationError::NoPendingPersistence)
        );
        s.confirm_stopped(StopProof::Commanded, 11).unwrap();
        enter(&mut s, Mode::Auto, 4);
        assert_eq!(
            s.prepare_start(start_request(&s, 5, Some(333), 12, 100)),
            Err(StationError::DuplicateOccurrence)
        );
    }

    #[test]
    fn day_sync_and_entry_batch_do_not_partially_mutate_a_pending_transition() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let prepared = s
            .prepare_start(start_request(&s, 2, None, 10, 100))
            .unwrap();
        assert_eq!(
            s.synchronize_day(101, 10, 20_000, true),
            Err(StationError::PendingPersistence)
        );
        assert!(!s.advance(10).unwrap().force_safe_output);
        assert_eq!(s.pending_token(), Some(prepared.token()));
        s.abort_prepared(prepared.token()).unwrap();
        let mut limited = config();
        limited.max_seen_request_ids = 1;
        let mut atomic = Station::new(limited).unwrap();
        atomic.synchronize_day(100, 0, 10_000, true).unwrap();
        let original = atomic.claim();
        assert_eq!(
            atomic.enter_batch(&[
                EnterRequest {
                    request_id: 1,
                    claim: original,
                    mode: Mode::Auto
                },
                EnterRequest {
                    request_id: 2,
                    claim: original,
                    mode: Mode::Auto
                },
            ]),
            Err(StationError::SeenRequestLedgerFull)
        );
        assert_eq!(atomic.mode(), Mode::Stopped);
        assert_eq!(atomic.seen_requests.len(), 0);
    }

    #[test]
    fn pending_start_expiry_is_conservatively_charged_without_rewinding_monotonic_time() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let prepared = s
            .prepare_start(start_request(&s, 2, Some(44), 10, 100))
            .unwrap();
        // Storage can be slow while the host's monotonic scheduler keeps advancing.
        assert!(!s.advance(110).unwrap().force_safe_output);
        assert_eq!(
            s.commit_start(DurableAck::new(prepared.token())),
            Err(StationError::LeaseExpired)
        );
        assert_eq!(s.reserved_ms(), 100);
        assert_eq!(s.active_session(), None);
        assert_eq!(s.advance(109), Err(StationError::MonotonicBackward));
        assert_eq!(
            s.prepare_start(start_request(&s, 3, Some(44), 111, 100)),
            Err(StationError::DuplicateOccurrence)
        );
    }

    #[test]
    fn ledger_exhaustion_cannot_prevent_an_immediate_stop_barrier() {
        let mut request_limited = config();
        request_limited.max_seen_request_ids = 1;
        let mut request_station = Station::new(request_limited).unwrap();
        request_station
            .synchronize_day(100, 0, 10_000, true)
            .unwrap();
        enter(&mut request_station, Mode::Auto, 1);
        let directive = request_station
            .request_stop(StopRequest {
                request_id: 2,
                claim: claim(&request_station),
            })
            .unwrap();
        assert_eq!(directive.reason, Some(StationError::SeenRequestLedgerFull));
        assert!(directive.force_safe_output && request_station.stopping());
        assert_eq!(
            request_station.prepare_start(start_request(&request_station, 3, None, 10, 100)),
            Err(StationError::SeenRequestLedgerFull)
        );

        let mut occurrence_limited = config();
        occurrence_limited.max_occurrence_records = 1;
        let mut occurrence_station = Station::new(occurrence_limited).unwrap();
        occurrence_station
            .synchronize_day(100, 0, 10_000, true)
            .unwrap();
        enter(&mut occurrence_station, Mode::Auto, 10);
        let directive = occurrence_station
            .request_stop_with_occurrences(
                StopRequest {
                    request_id: 11,
                    claim: claim(&occurrence_station),
                },
                &[91, 92],
            )
            .unwrap();
        assert_eq!(directive.reason, Some(StationError::LedgerFull));
        assert!(directive.force_safe_output && occurrence_station.stopping());
        occurrence_station
            .synchronize_day(100, 1, 10_000, true)
            .unwrap();
        occurrence_station
            .confirm_stopped(StopProof::Commanded, 2)
            .unwrap();
        enter(&mut occurrence_station, Mode::Auto, 12);
        assert_eq!(
            occurrence_station.prepare_start(start_request(&occurrence_station, 13, None, 10, 100)),
            Err(StationError::ClockUntrusted)
        );
    }

    #[test]
    fn owner_is_exclusive_while_pump_is_off_between_steps() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let request = start_request(&s, 2, None, 10, 100);
        commit_start(&mut s, request);
        s.authorize_output(
            77,
            OutputState {
                pump_on: false,
                valves: 1,
            },
            11,
        )
        .unwrap();
        s.report_applied(
            77,
            OutputState {
                pump_on: false,
                valves: 1,
            },
            11,
        )
        .unwrap();
        assert_eq!(
            s.prepare_start(start_request(&s, 3, None, 12, 100)),
            Err(StationError::AlreadyOwned)
        );
    }

    #[test]
    fn global_actual_on_time_is_settled_from_monotonic_reports() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let request = start_request(&s, 2, Some(42), 10, 500);
        commit_start(&mut s, request);
        s.authorize_output(
            77,
            OutputState {
                pump_on: true,
                valves: 1,
            },
            10,
        )
        .unwrap();
        s.report_applied(
            77,
            OutputState {
                pump_on: true,
                valves: 1,
            },
            10,
        )
        .unwrap();
        s.report_applied(77, OutputState::SAFE, 110).unwrap();
        stop_and_finish(&mut s, 110);
        assert_eq!(s.daily_used_ms(), 100);
        assert_eq!(s.reserved_ms(), 0);
        assert_eq!(s.mode(), Mode::Stopped);
    }

    #[test]
    fn finite_budget_quota_and_day_boundary_fail_closed() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        assert_eq!(
            s.prepare_start(start_request(&s, 2, None, 9_500, 600)),
            Err(StationError::CrossesDayBoundary)
        );
        let mut strict = config();
        strict.daily_quota_ms = 500;
        let mut quota_station = Station::new(strict).unwrap();
        quota_station.synchronize_day(100, 0, 10_000, true).unwrap();
        enter(&mut quota_station, Mode::Auto, 10);
        assert_eq!(
            quota_station.prepare_start(start_request(&quota_station, 11, None, 10, 600)),
            Err(StationError::QuotaExceeded)
        );
    }

    #[test]
    fn optional_capacity_is_advisory_but_required_capacity_blocks_unknown() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let request = start_request(&s, 2, None, 10, 100);
        let grant = commit_start(&mut s, request);
        assert_eq!(grant.capacity, CapacityCheck::Unknown);
        let mut required = config();
        required.require_capacity_pass = true;
        let mut r = Station::new(required).unwrap();
        r.synchronize_day(100, 0, 10_000, true).unwrap();
        enter(&mut r, Mode::Auto, 10);
        assert_eq!(
            r.prepare_start(start_request(&r, 11, None, 10, 100)),
            Err(StationError::CapacityRequired)
        );
    }

    #[test]
    fn occurrence_dedup_is_bounded_and_persisted_before_grant() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let p = s
            .prepare_start(start_request(&s, 2, Some(99), 10, 100))
            .unwrap();
        let restored = Station::restore(config(), p.bytes()).unwrap();
        assert!(restored.recovery_hold());
        s.commit_start(DurableAck::new(p.token())).unwrap();
        stop_and_finish(&mut s, 20);
        enter(&mut s, Mode::Auto, 4);
        assert_eq!(
            s.prepare_start(start_request(&s, 3, Some(99), 30, 100)),
            Err(StationError::DuplicateOccurrence)
        );
    }

    #[test]
    fn restore_rejects_safety_config_and_malformed_bounded_ledgers() {
        let s = station();
        let bytes = s.snapshot_bytes().unwrap();
        let mut incompatible = config();
        incompatible.max_start_budget_ms = 799;
        assert_eq!(
            Station::restore(incompatible, &bytes).unwrap_err(),
            StationError::Snapshot(
                "snapshot safety configuration does not match station configuration"
            )
        );

        // GFS1/v3 has require_capacity_pass at byte 31. Boolean markers are never permissive.
        let mut bad_flag = bytes.clone();
        bad_flag[31] = 2;
        assert_eq!(
            Station::restore(config(), &bad_flag).unwrap_err(),
            StationError::Snapshot("invalid require-capacity flag in station snapshot")
        );

        let mut with_occurrence = station();
        enter(&mut with_occurrence, Mode::Auto, 1);
        let prepared = with_occurrence
            .prepare_start(start_request(&with_occurrence, 2, Some(51), 10, 100))
            .unwrap();
        let mut zero_occurrence = prepared.bytes().to_vec();
        // Fixed header is 80 bytes; the first occurrence id begins immediately after it.
        zero_occurrence[80..88].fill(0);
        assert_eq!(
            Station::restore(config(), &zero_occurrence).unwrap_err(),
            StationError::Snapshot("invalid or duplicate occurrence id in station snapshot")
        );

        let mut with_requests = station();
        enter(&mut with_requests, Mode::Auto, 1);
        with_requests
            .request_stop(StopRequest {
                request_id: 2,
                claim: claim(&with_requests),
            })
            .unwrap();
        let mut duplicate_request = with_requests.snapshot_bytes().unwrap();
        // No occurrence records: request ids begin at byte 82 and there are two entries.
        let first = duplicate_request[82..90].to_vec();
        duplicate_request[90..98].copy_from_slice(&first);
        assert_eq!(
            Station::restore(config(), &duplicate_request).unwrap_err(),
            StationError::Snapshot("invalid or duplicate request id in station snapshot")
        );

        let mut mismatched_day = bytes;
        mismatched_day[55] = 0;
        mismatched_day.drain(56..60);
        assert_eq!(
            Station::restore(config(), &mismatched_day).unwrap_err(),
            StationError::Snapshot("budget day and day watermark must agree")
        );
    }

    #[test]
    fn backward_or_untrusted_day_holds_new_starts() {
        let mut s = station();
        assert_eq!(
            s.synchronize_day(99, 1, 10_000, true),
            Err(StationError::ClockBackward)
        );
        assert_eq!(
            s.synchronize_day(100, 2, 10_000, false),
            Err(StationError::ClockUntrusted)
        );
        enter(&mut s, Mode::Auto, 1);
        assert_eq!(
            s.prepare_start(start_request(&s, 2, None, 10, 100)),
            Err(StationError::ClockUntrusted)
        );
    }

    #[test]
    fn config_apply_is_only_configure_and_stopped_then_revisions_reject_old_claims() {
        let mut s = station();
        assert_eq!(
            s.prepare_apply(ApplyRequest {
                request_id: 1,
                claim: claim(&s),
                next_revision: 1
            }),
            Err(StationError::NotStopped)
        );
        enter(&mut s, Mode::Configure, 2);
        let old = claim(&s);
        let p = s
            .prepare_apply(ApplyRequest {
                request_id: 3,
                claim: old,
                next_revision: 1,
            })
            .unwrap();
        s.commit_apply(DurableAck::new(p.token())).unwrap();
        assert_eq!(
            s.enter(EnterRequest {
                request_id: 4,
                claim: old,
                mode: Mode::Auto
            }),
            Err(StationError::StaleRevision)
        );
    }

    #[test]
    fn old_stop_generation_cannot_start_after_stop() {
        let mut s = station();
        let old = claim(&s);
        enter(&mut s, Mode::Auto, 1);
        s.request_stop(StopRequest {
            request_id: 2,
            claim: claim(&s),
        })
        .unwrap();
        s.confirm_stopped(StopProof::Commanded, 1).unwrap();
        enter(&mut s, Mode::Auto, 3);
        let mut request = start_request(&s, 4, None, 2, 100);
        request.claim = old;
        assert_eq!(
            s.prepare_start(request),
            Err(StationError::StaleStopGeneration)
        );
    }

    #[test]
    fn sequential_valve_set_retains_one_owner_and_simultaneous_limit() {
        let mut profile = config();
        profile.max_open_valves = 1;
        let mut s = Station::new(profile).unwrap();
        s.synchronize_day(100, 0, 10_000, true).unwrap();
        enter(&mut s, Mode::Auto, 1);
        let mut request = start_request(&s, 2, Some(1001), 10, 600);
        request.valves = 0b111;
        commit_start(&mut s, request);
        assert_eq!(s.active_session(), Some(77));
        assert_eq!(s.reserved_ms(), 600);
        for (now, valves) in [(10, 1), (210, 2), (410, 4)] {
            let output = OutputState {
                pump_on: true,
                valves,
            };
            s.authorize_output(77, output, now).unwrap();
            s.report_applied(77, output, now).unwrap();
            assert_eq!(s.active_session(), Some(77));
        }
        for valves in [0b11, 0b1000] {
            assert_eq!(
                s.authorize_output(
                    77,
                    OutputState {
                        pump_on: true,
                        valves
                    },
                    410
                ),
                Err(StationError::UnsafeOutput)
            );
        }
        s.report_applied(77, OutputState::SAFE, 410).unwrap();
        let mut other = start_request(&s, 3, None, 410, 100);
        other.session_id = 78;
        other.owner_id = 89;
        other.valves = 1;
        assert_eq!(s.prepare_start(other), Err(StationError::AlreadyOwned));
        assert_eq!(s.reserved_ms(), 600);
        s.report_applied(77, OutputState::SAFE, 610).unwrap();
        let prepared = s.prepare_finish(77, FinishOutcome::Completed, 610).unwrap();
        s.commit_finish(DurableAck::new(prepared.token())).unwrap();
        assert_eq!(s.reserved_ms(), 0);
        assert_eq!(s.daily_used_ms(), 400);
    }

    #[test]
    fn output_safety_rejects_pump_without_valve_and_too_many_valves() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let request = start_request(&s, 2, None, 10, 100);
        commit_start(&mut s, request);
        assert_eq!(
            s.authorize_output(
                77,
                OutputState {
                    pump_on: true,
                    valves: 0
                },
                10
            ),
            Err(StationError::UnsafeOutput)
        );
        assert_eq!(
            s.authorize_output(
                77,
                OutputState {
                    pump_on: true,
                    valves: 0b111
                },
                10
            ),
            Err(StationError::UnsafeOutput)
        );
    }

    #[test]
    fn lease_expiry_forces_safe_output_but_does_not_release_owner() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let request = start_request(&s, 2, None, 10, 100);
        commit_start(&mut s, request);
        assert!(s.advance(110).unwrap().force_safe_output);
        assert_eq!(s.active_session(), Some(77));
        assert_eq!(
            s.authorize_output(
                77,
                OutputState {
                    pump_on: true,
                    valves: 1
                },
                110
            ),
            Err(StationError::LeaseExpired)
        );
    }

    #[test]
    fn recovered_unsettled_reservation_is_conservative_until_safe_ack() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let p = s
            .prepare_start(start_request(&s, 2, Some(9), 10, 200))
            .unwrap();
        let mut restored = Station::restore(config(), p.bytes()).unwrap();
        restored.synchronize_day(100, 1, 10_000, true).unwrap();
        assert_eq!(
            restored.enter(EnterRequest {
                request_id: 3,
                claim: claim(&restored),
                mode: Mode::Auto
            }),
            Err(StationError::NotStopped)
        );
        restored
            .acknowledge_recovery_safe_output(StopProof::Commanded, 2)
            .unwrap();
        enter(&mut restored, Mode::Auto, 4);
        assert_eq!(
            restored.prepare_start(start_request(&restored, 5, Some(9), 10, 200)),
            Err(StationError::DuplicateOccurrence)
        );
    }

    #[test]
    fn durable_stop_records_same_tick_occurrences_before_a_later_start() {
        let mut s = station();
        enter(&mut s, Mode::Auto, 1);
        let prepared = s
            .prepare_stop(
                StopRequest {
                    request_id: 2,
                    claim: claim(&s),
                },
                &[501],
            )
            .unwrap();
        assert_eq!(
            s.prepare_start(start_request(&s, 3, Some(501), 10, 100)),
            Err(StationError::PendingPersistence)
        );
        s.commit_stop(DurableAck::new(prepared.token())).unwrap();
        s.confirm_stopped(StopProof::Commanded, 1).unwrap();
        enter(&mut s, Mode::Auto, 4);
        assert_eq!(
            s.prepare_start(start_request(&s, 5, Some(501), 10, 100)),
            Err(StationError::DuplicateOccurrence)
        );
    }
}
