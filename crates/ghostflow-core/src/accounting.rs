//! Bounded ledger primitives for caller-validated physical and event evidence.
//!
//! The caller supplies intervals already split at trusted local-day boundaries.
//! Persistence writes are owned by the host. The host must persist a snapshot
//! before treating a mutation as durable or using it to authorize protected work.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountingConfig {
    pub max_intervals: usize,
    pub max_events: usize,
    pub max_reservations: usize,
    pub max_rolling_window_ms: u64,
}

impl AccountingConfig {
    fn validate(self) -> Result<Self, AccountingError> {
        if self.max_intervals == 0
            || self.max_events == 0
            || self.max_reservations == 0
            || self.max_rolling_window_ms == 0
            || self.max_intervals > u32::MAX as usize
            || self.max_events > u32::MAX as usize
            || self.max_reservations > u32::MAX as usize
        {
            return Err(AccountingError::InvalidConfig);
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountingError {
    InvalidConfig,
    InvalidIdentity,
    InvalidInterval,
    InvalidReservation,
    EvidenceMissing,
    Capacity,
    LimitExceeded,
    IdentityCollision,
    UnknownLedger,
    InvalidSnapshot,
}

impl std::fmt::Display for AccountingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidConfig => "invalid accounting ledger configuration",
            Self::InvalidIdentity => "accounting identity must be non-zero",
            Self::InvalidInterval => "applied interval must have a positive duration",
            Self::InvalidReservation => "invalid accounting reservation",
            Self::EvidenceMissing => "accounting settlement evidence is missing",
            Self::Capacity => "accounting ledger capacity is exhausted",
            Self::LimitExceeded => "accounting rolling limit would be exceeded",
            Self::IdentityCollision => "accounting identity was reused with different evidence",
            Self::UnknownLedger => "accounting ledger state is unknown",
            Self::InvalidSnapshot => "invalid accounting ledger snapshot",
        })
    }
}

impl std::error::Error for AccountingError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerRead<T> {
    Known(T),
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordResult {
    Inserted,
    Duplicate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionResult {
    Reserved,
    Duplicate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AppliedSegment {
    receipt_id: [u8; 16],
    reservation_id: Option<[u8; 16]>,
    resource_id: u32,
    start_ms: u64,
    end_ms: u64,
    local_day: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CountedEvent {
    event_id: [u8; 16],
    event_type: u32,
    local_day: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RollingReservation {
    reservation_id: [u8; 16],
    resource_id: u32,
    admitted_at_ms: u64,
    window_ms: u64,
    limit_ms: u64,
    reserve_ms: u64,
    state: ReservationState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReservationState {
    Outstanding,
    Settled([u8; 16]),
    Cancelled([u8; 16]),
}

/// A bounded persistent ledger for applied ON segments and identified events.
///
/// `new` creates an explicitly empty ledger for initialization. A runtime must
/// call `restore` with durable bytes, or `unknown` when durable bytes are
/// missing or invalid. `record_applied_segment` accepts only caller-validated
/// monotonic intervals that do not cross a local-day boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountingLedger {
    config: AccountingConfig,
    known: bool,
    intervals: Vec<AppliedSegment>,
    events: Vec<CountedEvent>,
    reservations: Vec<RollingReservation>,
}

impl AccountingLedger {
    pub fn new(config: AccountingConfig) -> Result<Self, AccountingError> {
        let config = config.validate()?;
        Ok(Self {
            config,
            known: true,
            intervals: Vec::new(),
            events: Vec::new(),
            reservations: Vec::new(),
        })
    }

    /// Construct a fail-closed view when durable state is missing or corrupt.
    pub fn unknown(config: AccountingConfig) -> Result<Self, AccountingError> {
        let mut ledger = Self::new(config)?;
        ledger.known = false;
        Ok(ledger)
    }

    pub fn is_known(&self) -> bool {
        self.known
    }

    /// Fail closed after the caller detects an evidence or persistence fault.
    pub fn mark_unknown(&mut self) {
        self.known = false;
    }

    /// Record one applied interval segment from a single merged physical resource.
    /// Segments crossing local midnight must be split by the trusted clock producer.
    pub fn record_applied_segment(
        &mut self,
        receipt_id: [u8; 16],
        resource_id: u32,
        start_ms: u64,
        end_ms: u64,
        local_day: i32,
    ) -> Result<RecordResult, AccountingError> {
        self.record_applied_segment_inner(
            None,
            receipt_id,
            resource_id,
            start_ms,
            end_ms,
            local_day,
        )
    }

    /// Record applied evidence explicitly correlated to one outstanding reservation.
    pub fn record_reserved_applied_segment(
        &mut self,
        reservation_id: [u8; 16],
        receipt_id: [u8; 16],
        resource_id: u32,
        start_ms: u64,
        end_ms: u64,
        local_day: i32,
    ) -> Result<RecordResult, AccountingError> {
        if !self.known {
            return Err(AccountingError::UnknownLedger);
        }
        let Some(reservation) = self
            .reservations
            .iter()
            .find(|entry| {
                entry.reservation_id == reservation_id
                    && entry.resource_id == resource_id
                    && matches!(entry.state, ReservationState::Outstanding)
            })
            .copied()
        else {
            return Err(AccountingError::InvalidReservation);
        };
        if reservation_id == [0; 16]
            || start_ms < reservation.admitted_at_ms
            || end_ms
                .checked_sub(start_ms)
                .is_none_or(|duration| duration > reservation.reserve_ms)
        {
            return Err(AccountingError::InvalidReservation);
        }
        if self.intervals.iter().any(|entry| {
            entry.reservation_id == Some(reservation_id) && entry.receipt_id != receipt_id
        }) {
            return Err(AccountingError::InvalidReservation);
        }
        self.record_applied_segment_inner(
            Some(reservation_id),
            receipt_id,
            resource_id,
            start_ms,
            end_ms,
            local_day,
        )
    }

    fn record_applied_segment_inner(
        &mut self,
        reservation_id: Option<[u8; 16]>,
        receipt_id: [u8; 16],
        resource_id: u32,
        start_ms: u64,
        end_ms: u64,
        local_day: i32,
    ) -> Result<RecordResult, AccountingError> {
        if !self.known {
            return Err(AccountingError::UnknownLedger);
        }
        if receipt_id == [0; 16] || resource_id == 0 {
            return Err(AccountingError::InvalidIdentity);
        }
        if start_ms >= end_ms {
            return Err(AccountingError::InvalidInterval);
        }
        let incoming = AppliedSegment {
            receipt_id,
            reservation_id,
            resource_id,
            start_ms,
            end_ms,
            local_day,
        };
        if let Some(existing) = self
            .intervals
            .iter()
            .find(|entry| entry.resource_id == resource_id && entry.receipt_id == receipt_id)
        {
            return if *existing == incoming {
                Ok(RecordResult::Duplicate)
            } else {
                Err(AccountingError::IdentityCollision)
            };
        }
        if self.intervals.len() == self.config.max_intervals {
            return Err(AccountingError::Capacity);
        }
        self.intervals
            .try_reserve(1)
            .map_err(|_| AccountingError::Capacity)?;
        self.intervals.push(incoming);
        Ok(RecordResult::Inserted)
    }

    /// Record one typed event. Redelivery of the same identity is idempotent.
    pub fn record_event(
        &mut self,
        event_id: [u8; 16],
        event_type: u32,
        local_day: i32,
    ) -> Result<RecordResult, AccountingError> {
        if !self.known {
            return Err(AccountingError::UnknownLedger);
        }
        if event_id == [0; 16] || event_type == 0 {
            return Err(AccountingError::InvalidIdentity);
        }
        let incoming = CountedEvent {
            event_id,
            event_type,
            local_day,
        };
        if let Some(existing) = self
            .events
            .iter()
            .find(|entry| entry.event_id == event_id && entry.event_type == event_type)
        {
            return if *existing == incoming {
                Ok(RecordResult::Duplicate)
            } else {
                Err(AccountingError::IdentityCollision)
            };
        }
        if self.events.len() == self.config.max_events {
            return Err(AccountingError::Capacity);
        }
        self.events
            .try_reserve(1)
            .map_err(|_| AccountingError::Capacity)?;
        self.events.push(incoming);
        Ok(RecordResult::Inserted)
    }

    pub fn used_rolling(&self, resource_id: u32, now_ms: u64, window_ms: u64) -> LedgerRead<u64> {
        if !self.known
            || resource_id == 0
            || window_ms == 0
            || window_ms > self.config.max_rolling_window_ms
        {
            return LedgerRead::Unknown;
        }
        let start = now_ms.saturating_sub(window_ms);
        let overlaps = self.intervals.iter().filter_map(|segment| {
            if segment.resource_id != resource_id
                || segment.start_ms >= now_ms
                || segment.end_ms <= start
            {
                return None;
            }
            Some((segment.start_ms.max(start), segment.end_ms.min(now_ms)))
        });
        match union_duration(overlaps) {
            Some(used) => LedgerRead::Known(used),
            None => LedgerRead::Unknown,
        }
    }

    pub fn used_local_day(&self, resource_id: u32, local_day: i32) -> LedgerRead<u64> {
        if !self.known || resource_id == 0 {
            return LedgerRead::Unknown;
        }
        let segments = self
            .intervals
            .iter()
            .filter(|segment| segment.resource_id == resource_id && segment.local_day == local_day)
            .map(|segment| (segment.start_ms, segment.end_ms));
        match union_duration(segments) {
            Some(used) => LedgerRead::Known(used),
            None => LedgerRead::Unknown,
        }
    }

    pub fn event_count(&self, event_type: u32, local_day: i32) -> LedgerRead<u64> {
        if !self.known || event_type == 0 {
            return LedgerRead::Unknown;
        }
        LedgerRead::Known(
            self.events
                .iter()
                .filter(|event| event.event_type == event_type && event.local_day == local_day)
                .count() as u64,
        )
    }

    /// Atomically reserve finite future usage against an observed rolling limit.
    /// Outstanding reservations for the same physical resource are charged
    /// conservatively in addition to the union of applied intervals.
    pub fn reserve_rolling(
        &mut self,
        reservation_id: [u8; 16],
        resource_id: u32,
        admitted_at_ms: u64,
        window_ms: u64,
        limit_ms: u64,
        reserve_ms: u64,
    ) -> Result<AdmissionResult, AccountingError> {
        if !self.known {
            return Err(AccountingError::UnknownLedger);
        }
        if reservation_id == [0; 16]
            || resource_id == 0
            || window_ms == 0
            || window_ms > self.config.max_rolling_window_ms
            || limit_ms == 0
            || reserve_ms == 0
        {
            return Err(AccountingError::InvalidReservation);
        }
        let incoming = RollingReservation {
            reservation_id,
            resource_id,
            admitted_at_ms,
            window_ms,
            limit_ms,
            reserve_ms,
            state: ReservationState::Outstanding,
        };
        if let Some(existing) = self
            .reservations
            .iter()
            .find(|entry| entry.reservation_id == reservation_id)
        {
            return if *existing == incoming {
                Ok(AdmissionResult::Duplicate)
            } else {
                Err(AccountingError::IdentityCollision)
            };
        }
        let LedgerRead::Known(applied_ms) =
            self.used_rolling(resource_id, admitted_at_ms, window_ms)
        else {
            return Err(AccountingError::UnknownLedger);
        };
        let committed_ms = self
            .reservations
            .iter()
            .filter(|entry| {
                entry.resource_id == resource_id
                    && matches!(entry.state, ReservationState::Outstanding)
            })
            .try_fold(applied_ms, |total, entry| {
                total.checked_add(entry.reserve_ms)
            })
            .ok_or(AccountingError::LimitExceeded)?;
        if committed_ms
            .checked_add(reserve_ms)
            .filter(|total| *total <= limit_ms)
            .is_none()
        {
            return Err(AccountingError::LimitExceeded);
        }
        if self.reservations.len() == self.config.max_reservations {
            return Err(AccountingError::Capacity);
        }
        self.reservations
            .try_reserve(1)
            .map_err(|_| AccountingError::Capacity)?;
        self.reservations.push(incoming);
        Ok(AdmissionResult::Reserved)
    }

    /// Settle a reservation only after its applied interval evidence is present.
    pub fn settle_rolling(
        &mut self,
        reservation_id: [u8; 16],
        applied_receipt_id: [u8; 16],
    ) -> Result<RecordResult, AccountingError> {
        if !self.known {
            return Err(AccountingError::UnknownLedger);
        }
        if reservation_id == [0; 16] || applied_receipt_id == [0; 16] {
            return Err(AccountingError::InvalidIdentity);
        }
        let index = self
            .reservations
            .iter()
            .position(|entry| entry.reservation_id == reservation_id)
            .ok_or(AccountingError::EvidenceMissing)?;
        let reservation = self.reservations[index];
        match reservation.state {
            ReservationState::Settled(existing) if existing == applied_receipt_id => {
                return Ok(RecordResult::Duplicate);
            }
            ReservationState::Outstanding => {}
            ReservationState::Settled(_) | ReservationState::Cancelled(_) => {
                return Err(AccountingError::IdentityCollision);
            }
        }
        if !self.intervals.iter().any(|entry| {
            entry.resource_id == reservation.resource_id
                && entry.receipt_id == applied_receipt_id
                && entry.reservation_id == Some(reservation_id)
        }) {
            return Err(AccountingError::EvidenceMissing);
        }
        self.reservations[index].state = ReservationState::Settled(applied_receipt_id);
        Ok(RecordResult::Inserted)
    }

    /// Release a reservation using an identified caller-validated cancellation record.
    pub fn cancel_rolling(
        &mut self,
        reservation_id: [u8; 16],
        cancellation_evidence_id: [u8; 16],
    ) -> Result<RecordResult, AccountingError> {
        if !self.known {
            return Err(AccountingError::UnknownLedger);
        }
        if reservation_id == [0; 16] || cancellation_evidence_id == [0; 16] {
            return Err(AccountingError::InvalidIdentity);
        }
        let reservation = self
            .reservations
            .iter_mut()
            .find(|entry| entry.reservation_id == reservation_id)
            .ok_or(AccountingError::EvidenceMissing)?;
        match reservation.state {
            ReservationState::Cancelled(existing) if existing == cancellation_evidence_id => {
                Ok(RecordResult::Duplicate)
            }
            ReservationState::Outstanding => {
                reservation.state = ReservationState::Cancelled(cancellation_evidence_id);
                Ok(RecordResult::Inserted)
            }
            ReservationState::Settled(_) | ReservationState::Cancelled(_) => {
                Err(AccountingError::IdentityCollision)
            }
        }
    }

    /// Encode a canonical bounded checkpoint. The host owns writing it durably.
    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, AccountingError> {
        let capacity = self
            .intervals
            .len()
            .checked_mul(56)
            .and_then(|size| size.checked_add(self.events.len().checked_mul(24)?))
            .and_then(|size| size.checked_add(self.reservations.len().checked_mul(69)?))
            .and_then(|size| size.checked_add(39))
            .ok_or(AccountingError::Capacity)?;
        let mut out = Vec::new();
        out.try_reserve_exact(capacity)
            .map_err(|_| AccountingError::Capacity)?;
        out.extend_from_slice(b"GFAC");
        out.extend_from_slice(&3u16.to_le_bytes());
        out.push(u8::from(self.known));
        out.extend_from_slice(&(self.config.max_intervals as u32).to_le_bytes());
        out.extend_from_slice(&(self.config.max_events as u32).to_le_bytes());
        out.extend_from_slice(&(self.config.max_reservations as u32).to_le_bytes());
        out.extend_from_slice(&self.config.max_rolling_window_ms.to_le_bytes());
        out.extend_from_slice(&(self.intervals.len() as u32).to_le_bytes());
        for item in &self.intervals {
            out.extend_from_slice(&item.receipt_id);
            out.extend_from_slice(&item.reservation_id.unwrap_or([0; 16]));
            out.extend_from_slice(&item.resource_id.to_le_bytes());
            out.extend_from_slice(&item.start_ms.to_le_bytes());
            out.extend_from_slice(&item.end_ms.to_le_bytes());
            out.extend_from_slice(&item.local_day.to_le_bytes());
        }
        out.extend_from_slice(&(self.events.len() as u32).to_le_bytes());
        for item in &self.events {
            out.extend_from_slice(&item.event_id);
            out.extend_from_slice(&item.event_type.to_le_bytes());
            out.extend_from_slice(&item.local_day.to_le_bytes());
        }
        out.extend_from_slice(&(self.reservations.len() as u32).to_le_bytes());
        for item in &self.reservations {
            out.extend_from_slice(&item.reservation_id);
            out.extend_from_slice(&item.resource_id.to_le_bytes());
            out.extend_from_slice(&item.admitted_at_ms.to_le_bytes());
            out.extend_from_slice(&item.window_ms.to_le_bytes());
            out.extend_from_slice(&item.limit_ms.to_le_bytes());
            out.extend_from_slice(&item.reserve_ms.to_le_bytes());
            match item.state {
                ReservationState::Outstanding => {
                    out.push(0);
                    out.extend_from_slice(&[0; 16]);
                }
                ReservationState::Settled(evidence_id) => {
                    out.push(1);
                    out.extend_from_slice(&evidence_id);
                }
                ReservationState::Cancelled(evidence_id) => {
                    out.push(2);
                    out.extend_from_slice(&evidence_id);
                }
            }
        }
        let checksum = crc32(&out);
        out.extend_from_slice(&checksum.to_le_bytes());
        Ok(out)
    }

    pub fn restore(config: AccountingConfig, bytes: &[u8]) -> Result<Self, AccountingError> {
        let config = config.validate()?;
        if bytes.len() < 4 {
            return Err(AccountingError::InvalidSnapshot);
        }
        let (payload, checksum_bytes) = bytes.split_at(bytes.len() - 4);
        let checksum = u32::from_le_bytes(
            checksum_bytes
                .try_into()
                .map_err(|_| AccountingError::InvalidSnapshot)?,
        );
        if crc32(payload) != checksum {
            return Err(AccountingError::InvalidSnapshot);
        }
        let mut reader = Reader {
            bytes: payload,
            offset: 0,
        };
        if reader.take(4)? != b"GFAC" || reader.u16()? != 3 {
            return Err(AccountingError::InvalidSnapshot);
        }
        let known = match reader.u8()? {
            0 => false,
            1 => true,
            _ => return Err(AccountingError::InvalidSnapshot),
        };
        if reader.u32()? as usize != config.max_intervals
            || reader.u32()? as usize != config.max_events
            || reader.u32()? as usize != config.max_reservations
            || reader.u64()? != config.max_rolling_window_ms
        {
            return Err(AccountingError::InvalidSnapshot);
        }
        let interval_count = reader.u32()? as usize;
        if interval_count > config.max_intervals {
            return Err(AccountingError::InvalidSnapshot);
        }
        let mut intervals = Vec::new();
        intervals
            .try_reserve_exact(interval_count)
            .map_err(|_| AccountingError::Capacity)?;
        for _ in 0..interval_count {
            let receipt_id = reader.array16()?;
            let raw_reservation_id = reader.array16()?;
            let reservation_id = (raw_reservation_id != [0; 16]).then_some(raw_reservation_id);
            let resource_id = reader.u32()?;
            let start_ms = reader.u64()?;
            let end_ms = reader.u64()?;
            let local_day = reader.i32()?;
            if receipt_id == [0; 16]
                || resource_id == 0
                || start_ms >= end_ms
                || intervals.iter().any(|entry: &AppliedSegment| {
                    entry.resource_id == resource_id && entry.receipt_id == receipt_id
                })
            {
                return Err(AccountingError::InvalidSnapshot);
            }
            intervals.push(AppliedSegment {
                receipt_id,
                reservation_id,
                resource_id,
                start_ms,
                end_ms,
                local_day,
            });
        }
        let event_count = reader.u32()? as usize;
        if event_count > config.max_events {
            return Err(AccountingError::InvalidSnapshot);
        }
        let mut events = Vec::new();
        events
            .try_reserve_exact(event_count)
            .map_err(|_| AccountingError::Capacity)?;
        for _ in 0..event_count {
            let event_id = reader.array16()?;
            let event_type = reader.u32()?;
            let local_day = reader.i32()?;
            if event_id == [0; 16]
                || event_type == 0
                || events.iter().any(|entry: &CountedEvent| {
                    entry.event_id == event_id && entry.event_type == event_type
                })
            {
                return Err(AccountingError::InvalidSnapshot);
            }
            events.push(CountedEvent {
                event_id,
                event_type,
                local_day,
            });
        }
        let reservation_count = reader.u32()? as usize;
        if reservation_count > config.max_reservations {
            return Err(AccountingError::InvalidSnapshot);
        }
        let mut reservations = Vec::new();
        reservations
            .try_reserve_exact(reservation_count)
            .map_err(|_| AccountingError::Capacity)?;
        for _ in 0..reservation_count {
            let reservation_id = reader.array16()?;
            let resource_id = reader.u32()?;
            let admitted_at_ms = reader.u64()?;
            let window_ms = reader.u64()?;
            let limit_ms = reader.u64()?;
            let reserve_ms = reader.u64()?;
            let state_tag = reader.u8()?;
            let terminal_evidence_id = reader.array16()?;
            let state = match state_tag {
                0 if terminal_evidence_id == [0; 16] => ReservationState::Outstanding,
                1 if terminal_evidence_id != [0; 16] => {
                    ReservationState::Settled(terminal_evidence_id)
                }
                2 if terminal_evidence_id != [0; 16] => {
                    ReservationState::Cancelled(terminal_evidence_id)
                }
                _ => return Err(AccountingError::InvalidSnapshot),
            };
            if reservation_id == [0; 16]
                || resource_id == 0
                || window_ms == 0
                || window_ms > config.max_rolling_window_ms
                || limit_ms == 0
                || reserve_ms == 0
                || reserve_ms > limit_ms
                || reservations
                    .iter()
                    .any(|entry: &RollingReservation| entry.reservation_id == reservation_id)
                || matches!(state, ReservationState::Settled(receipt_id)
                    if !intervals.iter().any(|entry| entry.resource_id == resource_id
                        && entry.receipt_id == receipt_id
                        && entry.reservation_id == Some(reservation_id)))
            {
                return Err(AccountingError::InvalidSnapshot);
            }
            reservations.push(RollingReservation {
                reservation_id,
                resource_id,
                admitted_at_ms,
                window_ms,
                limit_ms,
                reserve_ms,
                state,
            });
        }
        for interval in &intervals {
            let Some(reservation_id) = interval.reservation_id else {
                continue;
            };
            let Some(reservation) = reservations.iter().find(|entry| {
                entry.reservation_id == reservation_id && entry.resource_id == interval.resource_id
            }) else {
                return Err(AccountingError::InvalidSnapshot);
            };
            if interval.start_ms < reservation.admitted_at_ms
                || interval
                    .end_ms
                    .checked_sub(interval.start_ms)
                    .is_none_or(|duration| duration > reservation.reserve_ms)
                || intervals
                    .iter()
                    .filter(|entry| entry.reservation_id == Some(reservation_id))
                    .count()
                    != 1
            {
                return Err(AccountingError::InvalidSnapshot);
            }
        }
        if reader.offset != payload.len() {
            return Err(AccountingError::InvalidSnapshot);
        }
        Ok(Self {
            config,
            known,
            intervals,
            events,
            reservations,
        })
    }
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn union_duration(intervals: impl Iterator<Item = (u64, u64)>) -> Option<u64> {
    let mut sorted = Vec::new();
    for interval in intervals {
        sorted.try_reserve(1).ok()?;
        sorted.push(interval);
    }
    sorted.sort_unstable();
    let mut total = 0u64;
    let Some(&(mut start, mut end)) = sorted.first() else {
        return Some(0);
    };
    for &(next_start, next_end) in &sorted[1..] {
        if next_start <= end {
            end = end.max(next_end);
        } else {
            total = total.checked_add(end.checked_sub(start)?)?;
            start = next_start;
            end = next_end;
        }
    }
    total.checked_add(end.checked_sub(start)?)
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], AccountingError> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(AccountingError::InvalidSnapshot)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(AccountingError::InvalidSnapshot)?;
        self.offset = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, AccountingError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, AccountingError> {
        Ok(u16::from_le_bytes(
            self.take(2)?
                .try_into()
                .map_err(|_| AccountingError::InvalidSnapshot)?,
        ))
    }
    fn u32(&mut self) -> Result<u32, AccountingError> {
        Ok(u32::from_le_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| AccountingError::InvalidSnapshot)?,
        ))
    }
    fn i32(&mut self) -> Result<i32, AccountingError> {
        Ok(i32::from_le_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| AccountingError::InvalidSnapshot)?,
        ))
    }
    fn u64(&mut self) -> Result<u64, AccountingError> {
        Ok(u64::from_le_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| AccountingError::InvalidSnapshot)?,
        ))
    }
    fn array16(&mut self) -> Result<[u8; 16], AccountingError> {
        self.take(16)?
            .try_into()
            .map_err(|_| AccountingError::InvalidSnapshot)
    }
}
