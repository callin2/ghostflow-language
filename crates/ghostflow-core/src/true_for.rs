//! Fixed-storage admission of Driver-certified continuous Bool intervals.
//!
//! A certificate is a trusted Driver assertion, not a pair of point readings.
//! Installation must bind `source_tag` to the Driver that can make that assertion.
//! This engine does not infer continuity from sampling or scan cadence.

use crate::signals::SensorFault;
use crate::temporal::{EvidenceQuality, TemporalError, TimeContext};

type Result<T> = std::result::Result<T, TemporalError>;
const MAX_EXACT: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CertifiedBoolInterval {
    pub source_tag: u32,
    pub source_epoch: u64,
    pub time_epoch: u64,
    pub id: u64,
    /// Continuous coverage is [start_ms, end_ms). Equal endpoints certify no time.
    pub start_ms: u64,
    pub end_ms: u64,
    pub value: bool,
    pub quality: EvidenceQuality,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrueForInput {
    Interval(CertifiedBoolInterval),
    Unavailable(SensorFault),
    NoObservation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrueForOutcome {
    /// None means NotReady (or `upstream_fault`), never an inferred Bool.
    pub value: Option<bool>,
    pub covered_ms: u64,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub time: Option<TimeContext>,
    pub upstream_fault: Option<SensorFault>,
}

const EMPTY: TrueForOutcome = TrueForOutcome {
    value: None,
    covered_ms: 0,
    start_ms: None,
    end_ms: None,
    time: None,
    upstream_fault: None,
};

/// One fixed-size committed state and one candidate; no scan-time allocation.
pub struct TrueFor {
    source_tag: u32,
    duration_ms: u64,
    committed: State,
    candidate: Option<State>,
}

#[derive(Clone, Copy)]
struct State {
    outcome: TrueForOutcome,
    source_epoch: Option<u64>,
    last: Option<CertifiedBoolInterval>,
    /// A fault or non-admissible interval cannot later be bridged by backfill.
    reset_floor_ms: Option<u64>,
}

const EMPTY_STATE: State = State {
    outcome: EMPTY,
    source_epoch: None,
    last: None,
    reset_floor_ms: None,
};

impl TrueFor {
    pub fn new(source_tag: u32, duration_ms: u64) -> Result<Self> {
        if source_tag == 0 || duration_ms == 0 || duration_ms > MAX_EXACT {
            return Err(TemporalError::InvalidConfig);
        }
        Ok(Self {
            source_tag,
            duration_ms,
            committed: EMPTY_STATE,
            candidate: None,
        })
    }

    pub fn outcome(&self) -> TrueForOutcome {
        self.committed.outcome
    }

    pub fn stage(
        &mut self,
        time: TimeContext,
        source_epoch: u64,
        input: TrueForInput,
    ) -> Result<TrueForOutcome> {
        if self.candidate.is_some() {
            return Err(TemporalError::AlreadyStaged);
        }
        if time.epoch > MAX_EXACT || time.now_ms > MAX_EXACT || source_epoch > MAX_EXACT {
            return Err(TemporalError::InvalidIdentity);
        }
        if self
            .committed
            .outcome
            .time
            .is_some_and(|previous| previous.epoch == time.epoch && previous.now_ms > time.now_ms)
        {
            return Err(TemporalError::ClockBackward);
        }
        let mut next = if self.committed.source_epoch != Some(source_epoch)
            || self
                .committed
                .outcome
                .time
                .is_some_and(|previous| previous.epoch != time.epoch)
        {
            EMPTY_STATE
        } else {
            self.committed
        };
        next.source_epoch = Some(source_epoch);
        next.outcome.time = Some(time);
        match input {
            TrueForInput::Interval(interval) => {
                if interval.source_tag != self.source_tag
                    || interval.source_epoch != source_epoch
                    || interval.time_epoch != time.epoch
                {
                    return Err(TemporalError::IdentityMismatch);
                }
                if interval.id > MAX_EXACT
                    || interval.start_ms > interval.end_ms
                    || interval.end_ms > MAX_EXACT
                {
                    return Err(TemporalError::InvalidIdentity);
                }
                if interval.end_ms > time.now_ms {
                    return Err(TemporalError::FutureObservation);
                }
                if let Some(last) = next.last {
                    if interval.id < last.id || (interval.id == last.id && interval != last) {
                        return Err(TemporalError::IdentityMismatch);
                    }
                    if interval == last {
                        // Duplicate identity never changes coverage or revives a reset result.
                        self.candidate = Some(next);
                        return Ok(next.outcome);
                    }
                    if interval.start_ms < last.start_ms || interval.end_ms < last.end_ms {
                        return Err(TemporalError::SampleTimeBackward);
                    }
                    if interval.start_ms < last.end_ms
                        && (interval.value != last.value || interval.quality != last.quality)
                    {
                        return Err(TemporalError::IdentityMismatch);
                    }
                }
                if next
                    .reset_floor_ms
                    .is_some_and(|floor| interval.start_ms < floor)
                {
                    return Err(TemporalError::SampleTimeBackward);
                }
                next.last = Some(interval);
                next.outcome.upstream_fault = None;
                if interval.quality != EvidenceQuality::Measured || !interval.value {
                    next.outcome = TrueForOutcome {
                        time: Some(time),
                        ..EMPTY
                    };
                    next.outcome.value =
                        (interval.quality == EvidenceQuality::Measured).then_some(false);
                    next.reset_floor_ms = Some(interval.end_ms);
                } else {
                    let start = if next
                        .outcome
                        .end_ms
                        .is_some_and(|end| end >= interval.start_ms)
                    {
                        next.outcome.start_ms.unwrap_or(interval.start_ms)
                    } else {
                        interval.start_ms
                    };
                    next.outcome.start_ms = Some(start);
                    next.outcome.end_ms = Some(interval.end_ms);
                    next.outcome.covered_ms = interval.end_ms - start;
                    next.outcome.value = Some(next.outcome.covered_ms >= self.duration_ms);
                }
            }
            TrueForInput::Unavailable(fault) => {
                if !fault.is_quality_fault() {
                    return Err(TemporalError::InvalidIdentity);
                }
                next.outcome = TrueForOutcome {
                    time: Some(time),
                    upstream_fault: Some(fault),
                    ..EMPTY
                };
                next.reset_floor_ms = Some(time.now_ms);
            }
            TrueForInput::NoObservation => next.outcome.value = None,
        }
        self.candidate = Some(next);
        Ok(next.outcome)
    }

    pub fn commit(&mut self) -> Result<()> {
        self.committed = self.candidate.take().ok_or(TemporalError::NotStaged)?;
        Ok(())
    }

    pub fn rollback(&mut self) -> Result<()> {
        self.candidate.take().ok_or(TemporalError::NotStaged)?;
        Ok(())
    }
}
