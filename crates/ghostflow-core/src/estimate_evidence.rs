//! Bounded admission of declared estimate bases. No model or measurement is produced.
use crate::signals::SensorFault;

/// Supported ceiling; each session also requires an explicit smaller/equal capacity.
pub const MAX_HISTORY: usize = 64;
/// Exact opaque host identities: boot, model, calibration, reference, reference
/// assertion (including actor/source), program and installation binding, in that order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Context {
    pub identities: [[u8; 32]; 7],
    pub run: u64,
    pub time_epoch: u64,
    pub source_epoch: u64,
}
/// Original execution identity of a request/write, independent of the estimator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExecutionOrigin {
    pub boot: [u8; 32],
    pub program: [u8; 32],
    pub binding: [u8; 32],
    pub run: u64,
    pub time_epoch: u64,
    pub source_epoch: u64,
}
impl Context {
    pub fn execution_origin(self) -> ExecutionOrigin {
        ExecutionOrigin {
            boot: self.identities[0],
            program: self.identities[5],
            binding: self.identities[6],
            run: self.run,
            time_epoch: self.time_epoch,
            source_epoch: self.source_epoch,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Basis {
    Requested,
    AcknowledgedWrites,
}
/// `meaning` binds the declared model/unit meaning; None is explicitly unknown.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Uncertainty {
    pub meaning: [u8; 32],
    pub bound: Option<f64>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reference {
    pub context: Context,
    pub established_ms: u64,
    /// Sequence watermark immediately before the first qualifying record.
    pub initial_sequence: u64,
    pub uncertainty: Uncertainty,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Application {
    Requested,
    Acknowledged,
    WriteFailed,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HistoryRecord {
    pub origin: ExecutionOrigin,
    pub sequence: u64,
    /// Actual request/write identity, never a reevaluation identity.
    pub identity: u64,
    pub at_ms: u64,
    pub target: u8,
    pub result: Application,
}
/// The host asserts complete coverage, including the tail after the latest write.
/// This declaration is not independent proof of physical completeness.
pub struct History<'a> {
    pub initial_sequence: u64,
    pub current_sequence: u64,
    pub observed_from_ms: u64,
    pub observed_through_ms: u64,
    pub complete: bool,
    pub records: &'a [HistoryRecord],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Coverage {
    pub initial_sequence: u64,
    pub current_sequence: u64,
    pub observed_from_ms: u64,
    pub observed_through_ms: u64,
    pub complete: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cause {
    MissingReference,
    MissingHistory,
    Gap,
    ContextChanged,
    WriteFailed,
    UncertainApplication,
    HistoryContextChanged,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Admitted,
    Unavailable(Cause),
    Fault(SensorFault),
}
/// Malformed inputs reject without committing history, time or verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejection {
    Capacity,
    Uncertainty,
    Ordering,
    RewrittenIdentity,
    WrongBasis,
}
/// One explicitly established reference. Invalid continuity never resets implicitly.
pub struct Session {
    reference: Option<Reference>,
    basis: Basis,
    capacity: usize,
    records: Vec<HistoryRecord>,
    now_ms: Option<u64>,
    broken: Option<Verdict>,
    verdict: Verdict,
    coverage: Option<Coverage>,
    evaluated_context: Option<Context>,
}
impl Session {
    pub fn new(
        reference: Option<Reference>,
        basis: Basis,
        capacity: usize,
    ) -> Result<Self, Rejection> {
        if capacity == 0 || capacity > MAX_HISTORY {
            return Err(Rejection::Capacity);
        }
        if reference.is_some_and(|r| {
            r.uncertainty
                .bound
                .is_some_and(|b| !b.is_finite() || b < 0.0)
        }) {
            return Err(Rejection::Uncertainty);
        }
        let mut records = Vec::new();
        records
            .try_reserve_exact(capacity)
            .map_err(|_| Rejection::Capacity)?;
        Ok(Self {
            reference,
            basis,
            capacity,
            records,
            now_ms: None,
            broken: None,
            coverage: None,
            evaluated_context: None,
            verdict: Verdict::Unavailable(if reference.is_some() {
                Cause::MissingHistory
            } else {
                Cause::MissingReference
            }),
        })
    }
    pub fn reference(&self) -> Option<&Reference> {
        self.reference.as_ref()
    }
    pub fn basis(&self) -> Basis {
        self.basis
    }
    pub fn capacity(&self) -> usize {
        self.capacity
    }
    pub fn records(&self) -> &[HistoryRecord] {
        &self.records
    }
    pub fn now_ms(&self) -> Option<u64> {
        self.now_ms
    }
    pub fn verdict(&self) -> Verdict {
        self.verdict
    }
    pub fn coverage(&self) -> Option<Coverage> {
        self.coverage
    }
    pub fn evaluated_context(&self) -> Option<Context> {
        self.evaluated_context
    }

    pub fn evaluate(
        &mut self,
        context: Context,
        now_ms: u64,
        history: Option<History<'_>>,
        source_fault: Option<SensorFault>,
    ) -> Result<Verdict, Rejection> {
        // Validate the entire payload before accepting even a reported fault.
        if let Some(h) = &history {
            if h.records.len() > self.capacity {
                return Err(Rejection::Capacity);
            }
            if h.observed_from_ms > h.observed_through_ms
                || h.observed_through_ms > now_ms
                || h.initial_sequence > h.current_sequence
            {
                return Err(Rejection::Ordering);
            }
            for (i, record) in h.records.iter().enumerate() {
                if record.at_ms < h.observed_from_ms
                    || record.at_ms > h.observed_through_ms
                    || (i > 0
                        && (record.sequence <= h.records[i - 1].sequence
                            || record.at_ms < h.records[i - 1].at_ms))
                {
                    return Err(Rejection::Ordering);
                }
                if (self.basis == Basis::Requested) != (record.result == Application::Requested) {
                    return Err(Rejection::WrongBasis);
                }
                if h.records[..i].iter().any(|r| r.identity == record.identity) {
                    return Err(Rejection::RewrittenIdentity);
                }
                if self.reference.is_some_and(|r| r.context == context)
                    && self.records.get(i).is_some_and(|old| old != record)
                {
                    return Err(Rejection::RewrittenIdentity);
                }
            }
        }
        let verdict = if let Some(fault) = source_fault {
            Verdict::Fault(fault)
        } else if let Some(broken) = self.broken {
            broken
        } else if let Some(reference) = self.reference {
            if reference.context != context {
                Verdict::Unavailable(Cause::ContextChanged)
            } else if now_ms < reference.established_ms
                || self.now_ms.is_some_and(|last| now_ms < last)
            {
                Verdict::Fault(SensorFault::ClockBackward)
            } else if let Some(h) = &history {
                let mut expected = reference.initial_sequence;
                let mut gap = !h.complete
                    || h.initial_sequence != expected
                    || h.records.first().is_some_and(|seed| {
                        seed.at_ms > reference.established_ms || seed.at_ms != h.observed_from_ms
                    })
                    || h.observed_through_ms != now_ms
                    || h.records.len() < self.records.len();
                for r in h.records {
                    match expected.checked_add(1) {
                        Some(next) if next == r.sequence => expected = next,
                        _ => gap = true,
                    }
                }
                if expected != h.current_sequence {
                    gap = true;
                }
                if h.records
                    .iter()
                    .any(|r| r.origin != context.execution_origin())
                {
                    Verdict::Unavailable(Cause::HistoryContextChanged)
                } else if gap {
                    Verdict::Unavailable(Cause::Gap)
                } else if h.records.is_empty() {
                    Verdict::Unavailable(Cause::MissingHistory)
                } else if h
                    .records
                    .iter()
                    .any(|r| r.result == Application::WriteFailed)
                {
                    Verdict::Unavailable(Cause::WriteFailed)
                } else if h.records.iter().any(|r| r.result == Application::Unknown) {
                    Verdict::Unavailable(Cause::UncertainApplication)
                } else {
                    Verdict::Admitted
                }
            } else {
                Verdict::Unavailable(Cause::MissingHistory)
            }
        } else {
            Verdict::Unavailable(Cause::MissingReference)
        };
        // Reported failures commit their actual evidence. Never replace a retained
        // longer history with a missing tail, or borrow another context's history.
        if self.reference.is_some_and(|r| r.context == context) {
            if let Some(h) = history {
                self.coverage = Some(Coverage {
                    initial_sequence: h.initial_sequence,
                    current_sequence: h.current_sequence,
                    observed_from_ms: h.observed_from_ms,
                    observed_through_ms: h.observed_through_ms,
                    complete: h.complete,
                });
                if h.records.len() >= self.records.len() {
                    self.records.clear();
                    self.records.extend_from_slice(h.records);
                }
            }
        }
        self.now_ms = Some(now_ms);
        self.evaluated_context = Some(context);
        self.verdict = verdict;
        if verdict != Verdict::Admitted {
            self.broken = Some(verdict);
        }
        Ok(verdict)
    }
}
