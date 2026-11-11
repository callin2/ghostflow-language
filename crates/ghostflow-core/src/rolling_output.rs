//! Durable admission for one explicitly bound physical output.
//! The host supplies a trusted clock and a distinct identity for each reset of that clock.
use super::{
    crc32, AccountingConfig, AccountingError, AccountingLedger, LedgerRead, ReservationState,
    RollingExplanation,
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
pub enum OutputAdmission {
    Allowed(OutputLease),
    BudgetExceeded,
    UnsettledOutput,
}

pub struct RollingOutputOwner {
    policy: RollingOutputPolicy,
    ledger: AccountingLedger,
    boot_epoch: u64,
    clock_epoch: u64,
    clock_floor_ms: u64,
    sequence: u64,
}

impl RollingOutputOwner {
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
                    || entry.reserve_ms != policy.reserve_ms
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
                            || entry
                                .admitted_at_ms
                                .checked_add(policy.reserve_ms)
                                .is_none()))
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
        self.check_time(now_ms)?;
        if self.unresolved_lease().is_some() {
            return Ok(OutputAdmission::UnsettledOutput);
        }
        let deadline_ms = now_ms
            .checked_add(self.policy.reserve_ms)
            .ok_or(AccountingError::InvalidReservation)?;
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(AccountingError::Capacity)?;
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
        if self.ledger.intervals.len() == self.ledger.config.max_intervals {
            return Err(AccountingError::Capacity);
        }
        let p = self.policy;
        match self.ledger.reserve_rolling(
            Self::identity(sequence, 1),
            p.resource_id,
            now_ms,
            p.window_ms,
            p.limit_ms,
            p.reserve_ms,
        ) {
            Err(AccountingError::LimitExceeded) => return Ok(OutputAdmission::BudgetExceeded),
            result => {
                result?;
            }
        }
        self.sequence = sequence;
        self.persist(persist)?;
        Ok(OutputAdmission::Allowed(OutputLease {
            sequence,
            admitted_at_ms: now_ms,
            deadline_ms,
        }))
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
        let result = self.ledger.explain_rolling(
            p.resource_id,
            now_ms,
            p.window_ms,
            p.limit_ms,
            p.reserve_ms,
        );
        match result {
            LedgerRead::Known(mut evidence) if self.unresolved_lease().is_some() => {
                evidence.blocked = true;
                evidence.next_release_ms = None;
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
        if self.clock_epoch != self.boot_epoch
            || !self.ledger.is_known()
            || now_ms < self.clock_floor_ms
        {
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
