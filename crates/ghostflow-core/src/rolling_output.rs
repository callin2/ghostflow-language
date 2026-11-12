//! Durable admission for one explicitly bound physical output.
//! The host supplies a trusted clock and a distinct identity for each reset of that clock.
use super::{
    crc32, AccountingConfig, AccountingError, AccountingLedger, LedgerRead, ReservationState,
    RollingExplanation, RollingReservation,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RollingOutputPolicy {
    pub resource_id: u32,
    pub window_ms: u64,
    pub limit_ms: u64,
    /// Includes the maximum time to apply the stop.
    pub reserve_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputLease {
    sequence: u64,
    admitted_at_ms: u64,
    deadline_ms: u64,
}

impl OutputLease {
    pub fn deadline_ms(self) -> u64 {
        self.deadline_ms
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AdmissionWindow {
    pub start_ms: u64,
    pub deadline_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputAdmission {
    Allowed(OutputLease),
    BudgetExceeded,
    StopMargin,
    UnsettledOutput,
    CapacityWait,
}

#[derive(Clone)]
pub struct RollingOutputOwner {
    policy: RollingOutputPolicy,
    ledger: AccountingLedger,
    boot_epoch: u64,
    clock_epoch: u64,
    clock_floor_ms: u64,
    sequence: u64,
}

impl RollingOutputOwner {
    /// Maximum checkpoint payload, before any host storage envelope.
    pub fn checkpoint_max_bytes(config: AccountingConfig) -> Result<usize, AccountingError> {
        let config = config.validate()?;
        AccountingLedger::checkpoint_size(config.max_intervals, 0, config.max_reservations)
            .and_then(|size| size.checked_add(60))
            .ok_or(AccountingError::Capacity)
    }

    /// Use only when provisioning an output with known-empty history.
    pub fn initialize(
        policy: RollingOutputPolicy,
        config: AccountingConfig,
        boot_epoch: u64,
        now_ms: u64,
        persist: impl FnOnce(&[u8]) -> bool,
    ) -> Result<Self, AccountingError> {
        Self::validate_policy(policy, config, boot_epoch)?;
        let mut owner = Self {
            policy,
            ledger: AccountingLedger::new(config)?,
            boot_epoch,
            clock_epoch: boot_epoch,
            clock_floor_ms: now_ms,
            sequence: 0,
        };
        owner.persist(persist)?;
        Ok(owner)
    }

    pub fn restore(
        policy: RollingOutputPolicy,
        config: AccountingConfig,
        boot_epoch: u64,
        snapshot: &[u8],
    ) -> Result<Self, AccountingError> {
        Self::validate_policy(policy, config, boot_epoch)?;
        let invalid = AccountingError::InvalidSnapshot;
        let payload_len = snapshot.len().checked_sub(4).ok_or(invalid)?;
        let (payload, checksum) = snapshot.split_at(payload_len);
        if payload.len() < 56
            || &payload[..4] != b"GFR1"
            || crc32(payload).to_le_bytes().as_slice() != checksum
            || payload[4..32] != Self::policy_bytes(policy)
        {
            return Err(invalid);
        }
        let clock_floor_ms = u64::from_le_bytes(payload[32..40].try_into().unwrap());
        let sequence = u64::from_le_bytes(payload[40..48].try_into().unwrap());
        let clock_epoch = u64::from_le_bytes(payload[48..56].try_into().unwrap());
        let ledger = AccountingLedger::restore(config, &payload[56..])?;
        if clock_epoch == 0
            || !ledger.events.is_empty()
            || ledger.intervals.iter().any(|item| {
                item.resource_id != policy.resource_id
                    || item.end_ms > clock_floor_ms
                    || item.reservation_id.is_none()
            })
            || ledger.reservations.iter().any(|entry| {
                let id_sequence = u64::from_le_bytes(entry.reservation_id[8..].try_into().unwrap());
                entry.resource_id != policy.resource_id
                    || id_sequence == 0
                    || id_sequence > sequence
                    || entry.reservation_id != Self::identity(id_sequence, 1)
                    || entry.window_ms != policy.window_ms
                    || entry.limit_ms != policy.limit_ms
                    || entry.reserve_ms > policy.reserve_ms
                    || entry.admitted_at_ms > clock_floor_ms
                    || match entry.state {
                        ReservationState::Settled(evidence)
                        | ReservationState::Cancelled(evidence) => {
                            evidence != Self::identity(id_sequence, 2)
                        }
                        ReservationState::Outstanding => false,
                    }
                    || (entry.state == ReservationState::Outstanding
                        && (entry.reservation_id != Self::identity(sequence, 1)
                            || entry.admitted_at_ms.checked_add(entry.reserve_ms).is_none()))
            })
        {
            return Err(invalid);
        }
        Ok(Self {
            policy,
            ledger,
            boot_epoch,
            clock_epoch,
            clock_floor_ms,
            sequence,
        })
    }

    pub fn policy(&self) -> RollingOutputPolicy {
        self.policy
    }

    pub fn requires_off_recovery(&self) -> bool {
        self.clock_epoch != self.boot_epoch || !self.ledger.is_known()
    }

    /// A restored lease represents uncertainty until the host proves the output
    /// is off. It must never be used to start or restart the output.
    pub fn unresolved_lease(&self) -> Option<OutputLease> {
        let entry = self
            .ledger
            .reservations
            .iter()
            .find(|entry| entry.state == ReservationState::Outstanding)?;
        Some(OutputLease {
            sequence: self.sequence,
            admitted_at_ms: entry.admitted_at_ms,
            deadline_ms: entry.admitted_at_ms.checked_add(entry.reserve_ms)?,
        })
    }

    pub fn request_on(
        &mut self,
        now_ms: u64,
        persist: impl FnOnce(&[u8]) -> bool,
    ) -> Result<OutputAdmission, AccountingError> {
        self.request_on_with_stop_margin(now_ms, 0, persist)
    }

    /// The host supplies a conservative bound for persistence and applying OFF.
    pub fn request_on_with_stop_margin(
        &mut self,
        now_ms: u64,
        stop_margin_ms: u64,
        persist: impl FnOnce(&[u8]) -> bool,
    ) -> Result<OutputAdmission, AccountingError> {
        let admission = self.admission_at(now_ms, stop_margin_ms)?;
        let OutputAdmission::Allowed(lease) = admission else {
            if admission == OutputAdmission::CapacityWait {
                self.prune(now_ms);
            }
            return Ok(admission);
        };
        let p = self.policy;
        self.prune(now_ms);
        match self.ledger.reserve_rolling_inner(
            RollingReservation {
                reservation_id: Self::identity(lease.sequence, 1),
                resource_id: p.resource_id,
                admitted_at_ms: now_ms,
                window_ms: p.window_ms,
                limit_ms: p.limit_ms,
                reserve_ms: lease.deadline_ms - now_ms,
                state: ReservationState::Outstanding,
            },
            true,
        ) {
            Err(AccountingError::LimitExceeded) => return Ok(OutputAdmission::BudgetExceeded),
            result => result?,
        };
        self.sequence = lease.sequence;
        self.persist(persist)?;
        Ok(admission)
    }

    /// Earliest conditional admission with the same margin and capacity checks
    /// as the live path. The caller must have confirmed OFF and no new exposure.
    pub fn next_admission(
        &self,
        now_ms: u64,
        stop_margin_ms: u64,
    ) -> Result<Option<AdmissionWindow>, AccountingError> {
        let candidate = |at| {
            self.admission_at(at, stop_margin_ms)
                .map(|admission| match admission {
                    OutputAdmission::Allowed(lease) => Some(AdmissionWindow {
                        start_ms: lease.admitted_at_ms,
                        deadline_ms: lease.deadline_ms,
                    }),
                    _ => None,
                })
        };
        self.check_time(now_ms)?;
        if self.unresolved_lease().is_some()
            || self.ledger.intervals.iter().any(|i| i.end_ms > now_ms)
        {
            return Ok(None);
        }
        if let Some(lease) = candidate(now_ms)? {
            return Ok(Some(lease));
        }
        let mut low = now_ms;
        let mut high = now_ms.saturating_add(self.policy.window_ms);
        if candidate(high)?.is_none() {
            return Ok(None);
        }
        // With no new exposure, the applied usage and occupied slots can only
        // decrease as the settled intervals leave the rolling window.
        while low < high {
            let middle = low + (high - low) / 2;
            if candidate(middle)?.is_some() {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        candidate(low)
    }

    fn admission_at(
        &self,
        now_ms: u64,
        stop_margin_ms: u64,
    ) -> Result<OutputAdmission, AccountingError> {
        self.check_time(now_ms)?;
        if self.unresolved_lease().is_some() {
            return Ok(OutputAdmission::UnsettledOutput);
        }
        let reserve_ms = self.prospective_duration(now_ms)?;
        if reserve_ms == 0 {
            return Ok(OutputAdmission::BudgetExceeded);
        }
        if reserve_ms <= stop_margin_ms {
            return Ok(OutputAdmission::StopMargin);
        }
        let deadline_ms = now_ms
            .checked_add(reserve_ms)
            .ok_or(AccountingError::InvalidReservation)?;
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(AccountingError::Capacity)?;
        let cutoff = now_ms.saturating_sub(self.policy.window_ms);
        let retained = |entry: &super::AppliedSegment| entry.end_ms > cutoff;
        let intervals = self
            .ledger
            .intervals
            .iter()
            .filter(|entry| retained(entry))
            .count();
        let reservations = self
            .ledger
            .reservations
            .iter()
            .filter(|entry| match entry.state {
                ReservationState::Settled(receipt) => self
                    .ledger
                    .intervals
                    .iter()
                    .any(|segment| retained(segment) && segment.receipt_id == receipt),
                ReservationState::Cancelled(_) => false,
                ReservationState::Outstanding => true,
            })
            .count();
        if intervals == self.ledger.config.max_intervals
            || reservations == self.ledger.config.max_reservations
        {
            return Ok(OutputAdmission::CapacityWait);
        }
        Ok(OutputAdmission::Allowed(OutputLease {
            sequence,
            admitted_at_ms: now_ms,
            deadline_ms,
        }))
    }

    fn prune(&mut self, now_ms: u64) {
        let cutoff = now_ms.saturating_sub(self.policy.window_ms);
        self.ledger.intervals.retain(|entry| entry.end_ms > cutoff);
        self.ledger.reservations.retain(|entry| match entry.state {
            ReservationState::Settled(receipt) => self
                .ledger
                .intervals
                .iter()
                .any(|segment| segment.receipt_id == receipt),
            ReservationState::Cancelled(_) => false,
            ReservationState::Outstanding => true,
        });
        // An unsuccessful reservation must not make a later, older query
        // assume history that has already been removed from memory.
        self.clock_floor_ms = now_ms;
    }

    fn prospective_duration(&self, now_ms: u64) -> Result<u64, AccountingError> {
        let p = self.policy;
        let mut high = p.reserve_ms.min(u64::MAX - now_ms);
        let fits = |duration| {
            let LedgerRead::Known(past_ms) =
                self.ledger
                    .used_rolling(p.resource_id, now_ms + duration, p.window_ms)
            else {
                return Err(AccountingError::UnknownLedger);
            };
            Ok(past_ms <= p.limit_ms - duration)
        };
        // Through any candidate lease (at most one window), new ON exposure
        // grows by one millisecond per millisecond. The union of completed ON
        // history can lose at most that much, so total exposure is greatest at
        // the candidate deadline and feasibility is monotone in lease length.
        // Most scans either permit the whole quantum or cannot permit any ON.
        if high == 0 || !fits(1)? {
            return Ok(0);
        }
        if high == 1 || fits(high)? {
            return Ok(high);
        }
        let mut low = 1;
        high -= 1;
        while low < high {
            let middle = low + (high - low).div_ceil(2);
            if fits(middle)? {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        Ok(low)
    }

    /// Supply the time of the applied ON transition and the confirmed OFF
    /// transition. None is allowed only when the host proves ON never applied.
    pub fn record_off(
        &mut self,
        lease: OutputLease,
        started_at_ms: Option<u64>,
        off_at_ms: u64,
        persist: impl FnOnce(&[u8]) -> bool,
    ) -> Result<(), AccountingError> {
        self.check_time(off_at_ms)?;
        if self.unresolved_lease() != Some(lease) {
            return Err(AccountingError::InvalidReservation);
        }
        let reservation = Self::identity(lease.sequence, 1);
        let evidence = Self::identity(lease.sequence, 2);
        if let Some(start) = started_at_ms {
            if off_at_ms > lease.deadline_ms {
                self.clock_floor_ms = off_at_ms;
                self.ledger.mark_unknown();
                return Err(AccountingError::InvalidReservation);
            }
            // This owner keeps rolling evidence only. The local-day value is
            // never used for reporting or admission.
            self.ledger.record_reserved_applied_segment(
                reservation,
                evidence,
                self.policy.resource_id,
                start,
                off_at_ms,
                0,
            )?;
            self.ledger.settle_rolling(reservation, evidence)?;
        } else {
            self.ledger.cancel_rolling(reservation, evidence)?;
        }
        self.clock_floor_ms = off_at_ms;
        self.persist(persist)
    }

    pub fn explain(&self, now_ms: u64) -> LedgerRead<RollingExplanation> {
        if self.check_time(now_ms).is_err() {
            return LedgerRead::Unknown;
        }
        let p = self.policy;
        let result = self
            .ledger
            .explain_rolling(p.resource_id, now_ms, p.window_ms, p.limit_ms, 1);
        match result {
            LedgerRead::Known(mut evidence) if self.unresolved_lease().is_some() => {
                evidence.blocked = true;
                evidence.next_release_ms = None;
                LedgerRead::Known(evidence)
            }
            LedgerRead::Known(mut evidence) => {
                if let Some(next_ms) = now_ms.checked_add(1) {
                    let LedgerRead::Known(projected) = self.ledger.explain_rolling(
                        p.resource_id,
                        next_ms,
                        p.window_ms,
                        p.limit_ms,
                        1,
                    ) else {
                        return LedgerRead::Unknown;
                    };
                    evidence.blocked = projected.blocked;
                    evidence.next_release_ms = projected.next_release_ms.map(|time| time - 1);
                } else {
                    evidence.blocked = true;
                    evidence.next_release_ms = None;
                }
                LedgerRead::Known(evidence)
            }
            result => result,
        }
    }

    /// Release uncertainty after the host has continuously kept this output
    /// OFF for a full window. On a new boot the proof must start in the new
    /// clock epoch. A relay command alone is not evidence.
    pub fn recover_after_confirmed_off(
        &mut self,
        confirmed_off_at_ms: u64,
        now_ms: u64,
        persist: impl FnOnce(&[u8]) -> bool,
    ) -> Result<bool, AccountingError> {
        if confirmed_off_at_ms > now_ms {
            return Err(AccountingError::InvalidReservation);
        }
        if self.clock_epoch != self.boot_epoch {
            if now_ms - confirmed_off_at_ms < self.policy.window_ms {
                return Ok(false);
            }
            // Old timestamps cannot be compared with this boot. The full OFF
            // window excludes every old interval while preserving lease identity.
            self.ledger = AccountingLedger::new(self.ledger.config)?;
            self.clock_epoch = self.boot_epoch;
            self.clock_floor_ms = now_ms;
            self.persist(persist)?;
            return Ok(true);
        }
        if !self.ledger.is_known() {
            if confirmed_off_at_ms < self.clock_floor_ms {
                return Err(AccountingError::InvalidReservation);
            }
            if now_ms - confirmed_off_at_ms < self.policy.window_ms {
                return Ok(false);
            }
            // A full observed OFF window excludes every uncertain prior interval.
            self.ledger = AccountingLedger::new(self.ledger.config)?;
            self.clock_floor_ms = now_ms;
            self.persist(persist)?;
            return Ok(true);
        }
        self.check_time(now_ms)?;
        let Some(lease) = self.unresolved_lease() else {
            return Ok(false);
        };
        if confirmed_off_at_ms < lease.admitted_at_ms {
            return Err(AccountingError::InvalidReservation);
        }
        if now_ms - confirmed_off_at_ms < self.policy.window_ms {
            return Ok(false);
        }
        // Any unobserved application would now be outside the rolling window.
        self.ledger.cancel_rolling(
            Self::identity(lease.sequence, 1),
            Self::identity(lease.sequence, 2),
        )?;
        self.clock_floor_ms = now_ms;
        self.persist(persist)?;
        Ok(true)
    }

    fn validate_policy(
        p: RollingOutputPolicy,
        config: AccountingConfig,
        boot_epoch: u64,
    ) -> Result<(), AccountingError> {
        if boot_epoch == 0
            || p.resource_id == 0
            || p.window_ms == 0
            || p.window_ms > config.max_rolling_window_ms
            || p.reserve_ms == 0
            || p.reserve_ms > p.limit_ms
            || p.limit_ms > p.window_ms
        {
            return Err(AccountingError::InvalidConfig);
        }
        Ok(())
    }

    fn check_time(&self, now_ms: u64) -> Result<(), AccountingError> {
        if self.requires_off_recovery() || now_ms < self.clock_floor_ms {
            return Err(AccountingError::UnknownLedger);
        }
        Ok(())
    }

    fn identity(sequence: u64, kind: u8) -> [u8; 16] {
        let mut id = [0; 16];
        id[0] = kind;
        id[8..].copy_from_slice(&sequence.to_le_bytes());
        id
    }

    fn policy_bytes(policy: RollingOutputPolicy) -> [u8; 28] {
        let mut bytes = [0; 28];
        bytes[..4].copy_from_slice(&policy.resource_id.to_le_bytes());
        bytes[4..12].copy_from_slice(&policy.window_ms.to_le_bytes());
        bytes[12..20].copy_from_slice(&policy.limit_ms.to_le_bytes());
        bytes[20..].copy_from_slice(&policy.reserve_ms.to_le_bytes());
        bytes
    }

    fn persist(&mut self, persist: impl FnOnce(&[u8]) -> bool) -> Result<(), AccountingError> {
        let mut snapshot = b"GFR1".to_vec();
        snapshot.extend_from_slice(&Self::policy_bytes(self.policy));
        snapshot.extend_from_slice(&self.clock_floor_ms.to_le_bytes());
        snapshot.extend_from_slice(&self.sequence.to_le_bytes());
        snapshot.extend_from_slice(&self.clock_epoch.to_le_bytes());
        let ledger = self
            .ledger
            .snapshot_bytes()
            .inspect_err(|_| self.ledger.mark_unknown())?;
        snapshot.extend_from_slice(&ledger);
        snapshot.extend_from_slice(&crc32(&snapshot).to_le_bytes());
        if !persist(&snapshot) {
            self.ledger.mark_unknown();
            return Err(AccountingError::UnknownLedger);
        }
        Ok(())
    }
}
