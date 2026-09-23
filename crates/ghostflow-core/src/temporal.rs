//! Bounded temporal aggregation of already evaluated measurement evidence.
//!
//! Driver density facts and a target budget are mandatory. The two preallocated
//! states make staging atomic without allocating on scans. This engine does not
//! evaluate GhostFlow expressions or manufacture physical observations.

use crate::signals::SensorFault;
use std::collections::VecDeque;
use std::fmt;
use std::mem::size_of;

const MAX_EXACT: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Average,
    Min,
    Max,
    Rate,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowConfig {
    pub operation: Operation,
    pub over_ms: u64,
    pub max_age_ms: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RootDensity {
    pub source_tag: u32,
    pub max_observations: usize,
    pub interval_ms: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TargetBudget {
    pub max_retained_samples: usize,
    pub max_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeContext {
    pub epoch: u64,
    pub now_ms: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Identity {
    pub epoch: u64,
    pub id: u64,
    pub timestamp_ms: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RootInput {
    pub source_tag: u32,
    pub identity: Option<Identity>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Observation {
    pub source_tag: u32,
    pub identity: Identity,
    pub value: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvidenceQuality {
    Measured,
    Held,
    Constructed,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Evidence {
    pub observation: Observation,
    pub quality: EvidenceQuality,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UpstreamFault {
    pub origin: u32,
    pub fault: SensorFault,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Outcome {
    /// None means no admissible fresh aggregate (NotReady).
    pub value: Option<f64>,
    pub count: usize,
    pub first: Option<Observation>,
    pub last: Option<Observation>,
    /// Increments only on admission, never on expiry or reevaluation.
    pub revision: u64,
    pub time: Option<TimeContext>,
    pub upstream_fault: Option<UpstreamFault>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TemporalError {
    InvalidConfig,
    BudgetExceeded,
    AllocationFailed,
    IncompleteRoots,
    InvalidIdentity,
    FutureObservation,
    ClockBackward,
    SampleTimeBackward,
    IdentityMismatch,
    DensityExceeded,
    CapacityExceeded,
    NonFinite,
    RevisionExhausted,
    AlreadyStaged,
    NotStaged,
    CheckpointMismatch,
}
impl fmt::Display for TemporalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidConfig => "temporal-invalid-config",
            Self::BudgetExceeded => "temporal-budget-exceeded",
            Self::AllocationFailed => "temporal-allocation-failed",
            Self::IncompleteRoots => "temporal-incomplete-roots",
            Self::InvalidIdentity => "temporal-invalid-identity",
            Self::FutureObservation => "temporal-future-observation",
            Self::ClockBackward => "temporal-clock-backward",
            Self::SampleTimeBackward => "temporal-sample-time-backward",
            Self::IdentityMismatch => "temporal-observation-identity-mismatch",
            Self::DensityExceeded => "temporal-density-exceeded",
            Self::CapacityExceeded => "temporal-capacity-exceeded",
            Self::NonFinite => "temporal-non-finite-result",
            Self::RevisionExhausted => "temporal-revision-exhausted",
            Self::AlreadyStaged => "temporal-already-staged",
            Self::NotStaged => "temporal-not-staged",
            Self::CheckpointMismatch => "temporal-checkpoint-mismatch",
        })
    }
}
impl std::error::Error for TemporalError {}
type Result<T> = std::result::Result<T, TemporalError>;

struct RootState {
    identity: Option<Identity>,
    timestamp_valid: bool,
    fresh: bool,
    density: VecDeque<u64>,
}
struct State {
    roots: Vec<RootState>,
    entries: Vec<Observation>,
    outcome: Outcome,
}

fn reserve<T>(values: &mut Vec<T>, count: usize) -> Result<()> {
    values
        .try_reserve_exact(count)
        .map_err(|_| TemporalError::AllocationFailed)?;
    if values.capacity() != count {
        return Err(TemporalError::BudgetExceeded);
    }
    Ok(())
}
fn add_size(total: usize, count: usize, width: usize) -> Result<usize> {
    total
        .checked_add(
            count
                .checked_mul(width)
                .ok_or(TemporalError::BudgetExceeded)?,
        )
        .ok_or(TemporalError::BudgetExceeded)
}
impl State {
    fn new(roots: &[RootDensity], capacity: usize) -> Result<Self> {
        let mut state = Self {
            roots: Vec::new(),
            entries: Vec::new(),
            outcome: Outcome {
                value: None,
                count: 0,
                first: None,
                last: None,
                revision: 0,
                time: None,
                upstream_fault: None,
            },
        };
        reserve(&mut state.roots, roots.len())?;
        reserve(&mut state.entries, capacity)?;
        for root in roots {
            let mut density = VecDeque::new();
            density
                .try_reserve_exact(root.max_observations)
                .map_err(|_| TemporalError::AllocationFailed)?;
            if density.capacity() != root.max_observations {
                return Err(TemporalError::BudgetExceeded);
            }
            state.roots.push(RootState {
                identity: None,
                timestamp_valid: false,
                fresh: false,
                density,
            });
        }
        Ok(state)
    }
    fn copy_from(&mut self, other: &Self) {
        self.entries.clear();
        self.entries.extend_from_slice(&other.entries);
        self.outcome = other.outcome;
        for (target, source) in self.roots.iter_mut().zip(&other.roots) {
            target.identity = source.identity;
            target.timestamp_valid = source.timestamp_valid;
            target.fresh = false;
            target.density.clear();
            target.density.extend(source.density.iter().copied());
        }
    }
    fn allocation_bytes(&self) -> Result<usize> {
        let mut bytes = add_size(0, self.entries.capacity(), size_of::<Observation>())?;
        bytes = add_size(bytes, self.roots.capacity(), size_of::<RootState>())?;
        for root in &self.roots {
            bytes = add_size(bytes, root.density.capacity(), size_of::<u64>())?;
        }
        Ok(bytes)
    }
}

/// Opaque committed state bound to the exact window configuration and profile.
///
/// A checkpoint owns its buffers. It is not a serialized restore interface and
/// cannot be constructed or modified by callers. Its allocation budget is
/// separate from the window budget; an integrating runtime must account for both.
pub struct WindowCheckpoint {
    config: WindowConfig,
    roots: Vec<RootDensity>,
    capacity: usize,
    memory_bytes: usize,
    state: State,
}
impl WindowCheckpoint {
    pub fn current(&self) -> Outcome {
        self.state.outcome
    }
    pub fn contributors(&self) -> &[Observation] {
        &self.state.entries
    }
    /// Inline object plus actual reserved buffers, excluding allocator bookkeeping.
    pub fn memory_bytes(&self) -> usize {
        self.memory_bytes
    }
}

/// A window bound to immutable density facts. Staging and checkpoint copies do
/// not allocate; construction and `checkpoint` allocate explicitly.
pub struct Window {
    config: WindowConfig,
    roots: Vec<RootDensity>,
    capacity: usize,
    memory_bytes: usize,
    committed: State,
    candidate: State,
    staged: bool,
}
#[derive(Clone, Copy)]
pub(crate) struct WindowStoragePlan {
    pub capacity: usize,
    pub engine_bytes: usize,
    pub checkpoint_bytes: usize,
}
impl Window {
    pub(crate) fn storage_geometry(&self) -> Result<WindowStoragePlan> {
        Self::storage_plan(self.config, &self.roots)
    }
    pub(crate) fn storage_plan(
        config: WindowConfig,
        roots: &[RootDensity],
    ) -> Result<WindowStoragePlan> {
        if config.over_ms == 0
            || config.over_ms > MAX_EXACT
            || config.max_age_ms == 0
            || config.max_age_ms > MAX_EXACT
            || roots.is_empty()
        {
            return Err(TemporalError::InvalidConfig);
        }
        let mut capacity = 0;
        let mut density_count = 0;
        let mut last_tag = 0;
        for root in roots {
            if root.source_tag <= last_tag
                || root.max_observations == 0
                || root.interval_ms == 0
                || root.interval_ms > MAX_EXACT
            {
                return Err(TemporalError::InvalidConfig);
            }
            last_tag = root.source_tag;
            let intervals = config.over_ms / root.interval_ms
                + u64::from(config.over_ms % root.interval_ms != 0);
            capacity = add_size(
                capacity,
                root.max_observations,
                usize::try_from(intervals).map_err(|_| TemporalError::BudgetExceeded)?,
            )?;
            density_count = add_size(density_count, root.max_observations, 1)?;
        }
        let roots_bytes = add_size(0, roots.len(), size_of::<RootDensity>())?;
        let bank = add_size(
            add_size(
                add_size(0, roots.len(), size_of::<RootState>())?,
                capacity,
                size_of::<Observation>(),
            )?,
            density_count,
            size_of::<u64>(),
        )?;
        Ok(WindowStoragePlan {
            capacity,
            engine_bytes: add_size(add_size(size_of::<Self>(), roots_bytes, 1)?, 2, bank)?,
            checkpoint_bytes: add_size(
                add_size(size_of::<WindowCheckpoint>(), roots_bytes, 1)?,
                1,
                bank,
            )?,
        })
    }
    pub fn new(config: WindowConfig, roots: &[RootDensity], budget: TargetBudget) -> Result<Self> {
        if budget.max_retained_samples == 0 || budget.max_bytes == 0 {
            return Err(TemporalError::InvalidConfig);
        }
        let plan = Self::storage_plan(config, roots)?;
        let capacity = plan.capacity;
        if capacity > budget.max_retained_samples || plan.engine_bytes > budget.max_bytes {
            return Err(TemporalError::BudgetExceeded);
        }
        let mut owned_roots = Vec::new();
        reserve(&mut owned_roots, roots.len())?;
        owned_roots.extend_from_slice(roots);
        let mut window = Self {
            config,
            roots: owned_roots,
            capacity,
            memory_bytes: 0,
            committed: State::new(roots, capacity)?,
            candidate: State::new(roots, capacity)?,
            staged: false,
        };
        let mut bytes = add_size(
            size_of::<Self>(),
            window.roots.capacity(),
            size_of::<RootDensity>(),
        )?;
        bytes = add_size(bytes, window.committed.allocation_bytes()?, 1)?;
        bytes = add_size(bytes, window.candidate.allocation_bytes()?, 1)?;
        if bytes != plan.engine_bytes || bytes > budget.max_bytes {
            return Err(TemporalError::BudgetExceeded);
        }
        window.memory_bytes = bytes;
        Ok(window)
    }
    /// Inline object plus actual reserved buffers, excluding allocator bookkeeping.
    pub fn memory_bytes(&self) -> usize {
        self.memory_bytes
    }
    pub fn capacity(&self) -> usize {
        self.capacity
    }
    pub fn current(&self) -> Outcome {
        self.committed.outcome
    }
    pub fn contributors(&self) -> &[Observation] {
        &self.committed.entries
    }
    pub fn staged_contributors(&self) -> Option<&[Observation]> {
        self.staged.then_some(self.candidate.entries.as_slice())
    }
    pub(crate) fn staged_root(&self, tag: u32) -> Option<(Identity, bool)> {
        let index = self
            .roots
            .binary_search_by_key(&tag, |root| root.source_tag)
            .ok()?;
        let root = &self.candidate.roots[index];
        root.identity.map(|identity| (identity, root.fresh))
    }
    /// Allocate and capture committed state, even if a candidate is staged.
    /// `max_bytes` bounds this checkpoint alone, not total runtime memory.
    pub fn checkpoint(&self, max_bytes: usize) -> Result<WindowCheckpoint> {
        let plan = Self::storage_plan(self.config, &self.roots)?;
        if plan.checkpoint_bytes > max_bytes {
            return Err(TemporalError::BudgetExceeded);
        }
        let mut roots = Vec::new();
        reserve(&mut roots, self.roots.len())?;
        roots.extend_from_slice(&self.roots);
        let mut checkpoint = WindowCheckpoint {
            config: self.config,
            roots,
            capacity: self.capacity,
            memory_bytes: 0,
            state: State::new(&self.roots, self.capacity)?,
        };
        let bytes = add_size(
            size_of::<WindowCheckpoint>(),
            checkpoint.roots.capacity(),
            size_of::<RootDensity>(),
        )?;
        let bytes = add_size(bytes, checkpoint.state.allocation_bytes()?, 1)?;
        if bytes != plan.checkpoint_bytes || bytes > max_bytes {
            return Err(TemporalError::BudgetExceeded);
        }
        checkpoint.memory_bytes = bytes;
        checkpoint.state.copy_from(&self.committed);
        Ok(checkpoint)
    }
    pub(crate) fn verify_checkpoint(&self, checkpoint: &WindowCheckpoint) -> Result<()> {
        if self.config != checkpoint.config
            || self.roots != checkpoint.roots
            || self.capacity != checkpoint.capacity
        {
            return Err(TemporalError::CheckpointMismatch);
        }
        Ok(())
    }
    /// Overwrite an already allocated checkpoint with committed state.
    /// Mismatch leaves the destination unchanged.
    pub fn checkpoint_into(&self, checkpoint: &mut WindowCheckpoint) -> Result<()> {
        self.verify_checkpoint(checkpoint)?;
        checkpoint.state.copy_from(&self.committed);
        Ok(())
    }
    /// Restore an opaque checkpoint into this matching window without allocation.
    /// A staged transaction must first be explicitly committed or rolled back.
    pub fn restore(&mut self, checkpoint: &WindowCheckpoint) -> Result<()> {
        if self.staged {
            return Err(TemporalError::AlreadyStaged);
        }
        self.verify_checkpoint(checkpoint)?;
        self.committed.copy_from(&checkpoint.state);
        Ok(())
    }
    pub fn commit(&mut self) -> Result<()> {
        if !self.staged {
            return Err(TemporalError::NotStaged);
        }
        std::mem::swap(&mut self.committed, &mut self.candidate);
        self.staged = false;
        Ok(())
    }
    pub fn rollback(&mut self) -> Result<()> {
        if !self.staged {
            return Err(TemporalError::NotStaged);
        }
        self.staged = false;
        Ok(())
    }
    pub fn stage(
        &mut self,
        time: TimeContext,
        roots: &[RootInput],
        sample: Option<Evidence>,
        upstream_fault: Option<UpstreamFault>,
    ) -> Result<Outcome> {
        if self.staged {
            return Err(TemporalError::AlreadyStaged);
        }
        if roots.len() != self.roots.len()
            || roots
                .iter()
                .zip(&self.roots)
                .any(|(input, root)| input.source_tag != root.source_tag)
        {
            return Err(TemporalError::IncompleteRoots);
        }
        if time.epoch > MAX_EXACT || time.now_ms > MAX_EXACT {
            return Err(TemporalError::InvalidIdentity);
        }
        if self
            .committed
            .outcome
            .time
            .is_some_and(|old| old.epoch == time.epoch && old.now_ms > time.now_ms)
        {
            return Err(TemporalError::ClockBackward);
        }
        if upstream_fault.is_some_and(|fault| fault.origin == 0 || !fault.fault.is_quality_fault())
        {
            return Err(TemporalError::InvalidIdentity);
        }
        self.candidate.copy_from(&self.committed);
        self.update_candidate(time, roots, sample, upstream_fault)?;
        self.staged = true;
        Ok(self.candidate.outcome)
    }
    fn update_candidate(
        &mut self,
        time: TimeContext,
        roots: &[RootInput],
        sample: Option<Evidence>,
        upstream_fault: Option<UpstreamFault>,
    ) -> Result<()> {
        let state = &mut self.candidate;
        if state
            .outcome
            .time
            .is_some_and(|old| old.epoch != time.epoch)
        {
            state.entries.clear();
            for root in &mut state.roots {
                root.density.clear();
                root.timestamp_valid = false;
            }
        }
        // The left boundary is open. Avoid unsigned subtraction below epoch zero.
        if time.now_ms >= self.config.over_ms {
            state
                .entries
                .retain(|entry| entry.identity.timestamp_ms > time.now_ms - self.config.over_ms);
        }
        for ((input, config), root) in roots.iter().zip(&self.roots).zip(&mut state.roots) {
            let Some(identity) = input.identity else {
                continue;
            };
            if identity.epoch > MAX_EXACT
                || identity.id > MAX_EXACT
                || identity.timestamp_ms > MAX_EXACT
            {
                return Err(TemporalError::InvalidIdentity);
            }
            if identity.timestamp_ms > time.now_ms {
                return Err(TemporalError::FutureObservation);
            }
            if let Some(old) = root.identity {
                if old.epoch == identity.epoch && identity.id <= old.id {
                    continue;
                }
                if old.epoch != identity.epoch {
                    state
                        .entries
                        .retain(|entry| entry.source_tag != input.source_tag);
                    root.density.clear();
                    root.timestamp_valid = false;
                } else if root.timestamp_valid && identity.timestamp_ms < old.timestamp_ms {
                    return Err(TemporalError::SampleTimeBackward);
                }
            }
            if identity.timestamp_ms >= config.interval_ms {
                let boundary = identity.timestamp_ms - config.interval_ms;
                while root
                    .density
                    .front()
                    .is_some_and(|timestamp| *timestamp <= boundary)
                {
                    root.density.pop_front();
                }
            }
            if root.density.len() >= config.max_observations {
                return Err(TemporalError::DensityExceeded);
            }
            root.density.push_back(identity.timestamp_ms);
            root.identity = Some(identity);
            root.timestamp_valid = true;
            root.fresh = true;
        }
        if let Some(evidence) = sample {
            let observation = evidence.observation;
            if !observation.value.is_finite() {
                return Err(TemporalError::NonFinite);
            }
            if observation.identity.timestamp_ms > time.now_ms {
                return Err(TemporalError::FutureObservation);
            }
            let index = self
                .roots
                .binary_search_by_key(&observation.source_tag, |root| root.source_tag)
                .map_err(|_| TemporalError::IdentityMismatch)?;
            let root = &state.roots[index];
            if root.fresh && roots[index].identity != Some(observation.identity) {
                return Err(TemporalError::IdentityMismatch);
            }
            if root.fresh
                && evidence.quality == EvidenceQuality::Measured
                && (time.now_ms < self.config.over_ms
                    || observation.identity.timestamp_ms > time.now_ms - self.config.over_ms)
            {
                if state.entries.len() >= self.capacity {
                    return Err(TemporalError::CapacityExceeded);
                }
                state.outcome.revision = state
                    .outcome
                    .revision
                    .checked_add(1)
                    .ok_or(TemporalError::RevisionExhausted)?;
                state.entries.push(observation);
            }
        }
        state.entries.sort_unstable_by_key(|entry| {
            (
                entry.identity.timestamp_ms,
                entry.source_tag,
                entry.identity.epoch,
                entry.identity.id,
            )
        });
        let first = state.entries.first().copied();
        let last = state.entries.last().copied();
        let fresh = last
            .is_some_and(|last| time.now_ms - last.identity.timestamp_ms < self.config.max_age_ms);
        let value = if fresh {
            aggregate(self.config.operation, &state.entries)?
        } else {
            None
        };
        state.outcome = Outcome {
            value,
            count: state.entries.len(),
            first,
            last,
            revision: state.outcome.revision,
            time: Some(time),
            upstream_fault,
        };
        Ok(())
    }
}

pub(crate) trait AggregatePoint {
    fn value(&self) -> f64;
    fn timestamp(&self) -> u64;
}
impl AggregatePoint for Observation {
    fn value(&self) -> f64 {
        self.value
    }
    fn timestamp(&self) -> u64 {
        self.identity.timestamp_ms
    }
}
pub(crate) fn aggregate<T: AggregatePoint>(
    operation: Operation,
    entries: &[T],
) -> Result<Option<f64>> {
    let Some(first) = entries.first() else {
        return Ok(None);
    };
    let last = entries.last().ok_or(TemporalError::NonFinite)?;
    let value = match operation {
        Operation::Min => entries
            .iter()
            .fold(first.value(), |value, entry| value.min(entry.value())),
        Operation::Max => entries
            .iter()
            .fold(first.value(), |value, entry| value.max(entry.value())),
        Operation::Average => {
            // Preserve ordinary exact sums and compensate finite cancellation.
            // Scale only when an intermediate sum/correction would overflow.
            let mut sum = 0.0_f64;
            let mut correction = 0.0_f64;
            let direct = entries.iter().all(|entry| {
                let next = sum + entry.value();
                if !next.is_finite() {
                    return false;
                }
                let error = if sum.abs() >= entry.value().abs() {
                    (sum - next) + entry.value()
                } else {
                    (entry.value() - next) + sum
                };
                correction += error;
                sum = next;
                correction.is_finite()
            });
            if direct && (sum + correction).is_finite() {
                (sum + correction) / entries.len() as f64
            } else {
                let scale = entries
                    .iter()
                    .fold(0.0_f64, |scale, entry| scale.max(entry.value().abs()));
                if scale == 0.0 {
                    0.0
                } else {
                    let mut sum = 0.0;
                    let mut compensation = 0.0;
                    for entry in entries {
                        let value = entry.value() / scale - compensation;
                        let next = sum + value;
                        compensation = (next - sum) - value;
                        sum = next;
                    }
                    (sum / entries.len() as f64).clamp(-1.0, 1.0) * scale
                }
            }
        }
        Operation::Rate => {
            let elapsed = last.timestamp() - first.timestamp();
            if elapsed == 0 {
                return Ok(None);
            }
            let per_second = 1000.0 / elapsed as f64;
            let difference = last.value() - first.value();
            if difference.is_finite() {
                difference * per_second
            } else {
                let scale = first.value().abs().max(last.value().abs());
                (last.value() / scale - first.value() / scale) * (scale * per_second)
            }
        }
    };
    if value.is_finite() {
        Ok(Some(value))
    } else {
        Err(TemporalError::NonFinite)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    thread_local! {
        static TRACK: Cell<bool> = const { Cell::new(false) };
        static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    }
    struct CountingAllocator;
    fn allocated() {
        let _ = TRACK.try_with(|track| {
            if track.get() {
                ALLOCATIONS.with(|count| count.set(count.get() + 1));
            }
        });
    }
    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            allocated();
            System.alloc(layout)
        }
        unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            allocated();
            System.realloc(pointer, layout, size)
        }
        unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
            System.dealloc(pointer, layout);
        }
    }
    #[global_allocator]
    static ALLOCATOR: CountingAllocator = CountingAllocator;

    #[test]
    fn structural_storage_plans_do_not_allocate_capacity_sized_arenas() {
        let config = WindowConfig {
            operation: Operation::Average,
            over_ms: 1000,
            max_age_ms: 500,
        };
        let roots = [RootDensity {
            source_tag: 1,
            max_observations: 1_000_000,
            interval_ms: 1000,
        }];
        ALLOCATIONS.with(|n| n.set(0));
        TRACK.with(|t| t.set(true));
        let physical = Window::storage_plan(config, &roots);
        let derived =
            crate::temporal_evidence::EvidenceWindow::storage_plan(config, &roots, 1, 2000, 2);
        TRACK.with(|t| t.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
        assert_eq!(physical.unwrap().capacity, 1_000_000);
        let derived = derived.unwrap();
        assert_eq!(derived.capacity, 2_000_000);
        assert_eq!(derived.proof_nodes, 4_000_000);
    }

    fn window(
        operation: Operation,
        over_ms: u64,
        max_age_ms: u64,
        max_observations: usize,
        interval_ms: u64,
    ) -> Window {
        Window::new(
            WindowConfig {
                operation,
                over_ms,
                max_age_ms,
            },
            &[RootDensity {
                source_tag: 1,
                max_observations,
                interval_ms,
            }],
            TargetBudget {
                max_retained_samples: 100,
                max_bytes: 100_000,
            },
        )
        .unwrap()
    }

    #[test]
    fn derived_stage_rollback_commit_checkpoint_and_proof_copy_do_not_allocate() {
        use crate::temporal_evidence::{
            EvidenceOutcome, EvidencePoint, EvidenceWindow, SelectedEvidence,
        };
        use crate::temporal_runtime::WindowTrace;
        use crate::Type;
        let roots = [RootDensity {
            source_tag: 1,
            max_observations: 1,
            interval_ms: 1,
        }];
        let mut engine = EvidenceWindow::new(
            WindowConfig {
                operation: Operation::Average,
                over_ms: 1,
                max_age_ms: 1,
            },
            &roots,
            &[10],
            2,
            2,
            TargetBudget {
                max_retained_samples: 2,
                max_bytes: 100_000,
            },
        )
        .unwrap();
        let mut checkpoint = engine.checkpoint(100_000).unwrap();
        let point = EvidencePoint::from(Observation {
            source_tag: 1,
            identity: Identity {
                epoch: 1,
                id: 1,
                timestamp_ms: 0,
            },
            value: 1.0,
        });
        let mut upstream = [WindowTrace {
            site: 10,
            payload_type: Type::Number,
            operation: Operation::Average,
            outcome: EvidenceOutcome {
                value: Some(1.0),
                count: 1,
                first: Some(point),
                last: Some(point),
                revision: 1,
                time: Some(TimeContext {
                    epoch: 7,
                    now_ms: 0,
                }),
                upstream_fault: None,
            },
            contributors: vec![point],
            proof: vec![],
        }];
        let mut points = Vec::with_capacity(2);
        let mut proof = Vec::with_capacity(4);
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for now in 0..200 {
            let identity = Identity {
                epoch: 1,
                id: now + 1,
                timestamp_ms: now,
            };
            let point = EvidencePoint::from(Observation {
                source_tag: 1,
                identity,
                value: now as f64,
            });
            upstream[0].contributors[0] = point;
            upstream[0].outcome = EvidenceOutcome {
                value: Some(now as f64),
                count: 1,
                first: Some(point),
                last: Some(point),
                revision: now + 1,
                time: Some(TimeContext {
                    epoch: 7,
                    now_ms: now,
                }),
                upstream_fault: None,
            };
            let inputs = [RootInput {
                source_tag: 1,
                identity: Some(identity),
            }];
            engine
                .stage(
                    TimeContext {
                        epoch: 7,
                        now_ms: now,
                    },
                    &inputs,
                    Some(SelectedEvidence::Derived {
                        site: 10,
                        value: now as f64,
                    }),
                    None,
                    &upstream,
                )
                .unwrap();
            engine.rollback().unwrap();
            engine
                .stage(
                    TimeContext {
                        epoch: 7,
                        now_ms: now,
                    },
                    &inputs,
                    Some(SelectedEvidence::Derived {
                        site: 10,
                        value: now as f64,
                    }),
                    None,
                    &upstream,
                )
                .unwrap();
            points.clear();
            proof.clear();
            engine.staged_into(&mut points, &mut proof);
            engine.commit().unwrap();
            engine.checkpoint_into(&mut checkpoint).unwrap();
            engine.restore(&checkpoint).unwrap();
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }
    fn sample(
        window: &mut Window,
        id: u64,
        timestamp_ms: u64,
        value: f64,
        quality: EvidenceQuality,
    ) -> Result<Outcome> {
        let identity = Identity {
            epoch: 1,
            id,
            timestamp_ms,
        };
        window.stage(
            TimeContext {
                epoch: 1,
                now_ms: timestamp_ms,
            },
            &[RootInput {
                source_tag: 1,
                identity: Some(identity),
            }],
            Some(Evidence {
                observation: Observation {
                    source_tag: 1,
                    identity,
                    value,
                },
                quality,
            }),
            None,
        )
    }

    #[test]
    fn checkpoint_restores_complete_committed_history_and_density() {
        let mut engine = window(Operation::Average, 1000, 1000, 2, 1000);
        sample(&mut engine, 1, 100, 2.0, EvidenceQuality::Measured).unwrap();
        engine.commit().unwrap();
        let fault = UpstreamFault {
            origin: 1,
            fault: SensorFault::Disconnected,
        };
        engine
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 150,
                },
                &[RootInput {
                    source_tag: 1,
                    identity: None,
                }],
                None,
                Some(fault),
            )
            .unwrap();
        engine.commit().unwrap();
        let mut checkpoint = engine.checkpoint(100_000).unwrap();
        let saved = engine.current();
        assert_eq!(checkpoint.current(), saved);
        assert_eq!(checkpoint.contributors(), engine.contributors());
        sample(&mut engine, 2, 200, 6.0, EvidenceQuality::Measured).unwrap();
        engine.commit().unwrap();
        engine.restore(&checkpoint).unwrap();
        assert_eq!(engine.current(), saved);
        assert_eq!(
            sample(&mut engine, 1, 100, 999.0, EvidenceQuality::Measured),
            Err(TemporalError::ClockBackward)
        );
        let duplicate = engine
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 200,
                },
                &[RootInput {
                    source_tag: 1,
                    identity: Some(Identity {
                        epoch: 1,
                        id: 1,
                        timestamp_ms: 100,
                    }),
                }],
                None,
                None,
            )
            .unwrap();
        assert_eq!(duplicate.revision, 1);
        engine.commit().unwrap();
        assert_eq!(
            sample(&mut engine, 2, 200, 6.0, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(4.0)
        );
        engine.commit().unwrap();
        engine.checkpoint_into(&mut checkpoint).unwrap();
        assert_eq!(checkpoint.current(), engine.current());
        assert_eq!(
            sample(&mut engine, 3, 300, 10.0, EvidenceQuality::Measured),
            Err(TemporalError::DensityExceeded)
        );
        engine
            .stage(
                TimeContext {
                    epoch: 2,
                    now_ms: 0,
                },
                &[RootInput {
                    source_tag: 1,
                    identity: None,
                }],
                None,
                None,
            )
            .unwrap();
        engine.commit().unwrap();
        engine.restore(&checkpoint).unwrap();
        assert_eq!(
            engine.current().time,
            Some(TimeContext {
                epoch: 1,
                now_ms: 200
            })
        );
        assert_eq!(
            sample(&mut engine, 3, 300, 10.0, EvidenceQuality::Measured),
            Err(TemporalError::DensityExceeded)
        );
    }

    #[test]
    fn checkpoint_rejects_binding_budget_and_staged_restore_without_mutation() {
        let mut source = window(Operation::Min, 1000, 1000, 2, 1000);
        sample(&mut source, 1, 100, 7.0, EvidenceQuality::Measured).unwrap();
        source.commit().unwrap();
        let checkpoint = source.checkpoint(100_000).unwrap();
        assert!(matches!(
            source.checkpoint(checkpoint.memory_bytes() - 1),
            Err(TemporalError::BudgetExceeded)
        ));
        let config = source.config;
        let roots = source.roots.clone();
        let budget = TargetBudget {
            max_retained_samples: 100,
            max_bytes: 100_000,
        };
        for (config, roots, budget) in [
            (
                WindowConfig {
                    operation: Operation::Max,
                    ..config
                },
                roots.clone(),
                budget,
            ),
            (
                WindowConfig {
                    over_ms: 999,
                    ..config
                },
                roots.clone(),
                budget,
            ),
            (
                WindowConfig {
                    max_age_ms: 999,
                    ..config
                },
                roots.clone(),
                budget,
            ),
            (
                config,
                vec![RootDensity {
                    source_tag: 2,
                    ..roots[0]
                }],
                budget,
            ),
            (
                config,
                vec![RootDensity {
                    interval_ms: 999,
                    ..roots[0]
                }],
                budget,
            ),
            (
                config,
                vec![RootDensity {
                    max_observations: 3,
                    ..roots[0]
                }],
                budget,
            ),
            (
                config,
                roots.clone(),
                TargetBudget {
                    max_bytes: 200_000,
                    ..budget
                },
            ),
            (
                config,
                roots.clone(),
                TargetBudget {
                    max_retained_samples: 200,
                    ..budget
                },
            ),
            (
                config,
                vec![RootDensity {
                    max_observations: 1,
                    ..roots[0]
                }],
                budget,
            ),
        ] {
            let mut target = Window::new(config, &roots, budget).unwrap();
            let before = target.current();
            let mut destination = target.checkpoint(100_000).unwrap();
            if config == source.config && roots == source.roots {
                target.restore(&checkpoint).unwrap();
                assert_eq!(target.current(), source.current());
                source.checkpoint_into(&mut destination).unwrap();
                assert_eq!(destination.current(), source.current());
                continue;
            }
            assert_eq!(
                target.restore(&checkpoint),
                Err(TemporalError::CheckpointMismatch)
            );
            assert_eq!(target.current(), before);
            assert_eq!(
                source.checkpoint_into(&mut destination),
                Err(TemporalError::CheckpointMismatch)
            );
            assert_eq!(destination.current(), before);
        }
        let staged = sample(&mut source, 2, 200, 3.0, EvidenceQuality::Measured).unwrap();
        assert_eq!(
            source.restore(&checkpoint),
            Err(TemporalError::AlreadyStaged)
        );
        let captured = source.checkpoint(100_000).unwrap();
        assert_eq!(
            captured.current(),
            checkpoint.current(),
            "capture is committed-only"
        );
        source.commit().unwrap();
        assert_eq!(source.current(), staged);
    }

    #[test]
    fn checkpoint_copy_restore_and_staging_reuse_all_reserved_storage() {
        let mut engine = window(Operation::Average, 1000, 1000, 2, 1000);
        sample(&mut engine, 1, 100, 2.0, EvidenceQuality::Measured).unwrap();
        engine.commit().unwrap();
        let mut checkpoint = engine.checkpoint(100_000).unwrap();
        let bytes = (engine.memory_bytes(), checkpoint.memory_bytes());
        eprintln!(
            "checkpoint allocation evidence: window={} checkpoint={} bytes",
            bytes.0, bytes.1
        );
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for _ in 0..200 {
            engine.checkpoint_into(&mut checkpoint).unwrap();
            sample(&mut engine, 2, 200, 6.0, EvidenceQuality::Measured).unwrap();
            engine.commit().unwrap();
            engine.restore(&checkpoint).unwrap();
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
        assert_eq!((engine.memory_bytes(), checkpoint.memory_bytes()), bytes);
        assert_eq!(engine.current().value, Some(2.0));
    }

    #[test]
    fn density_history_outlives_payload_window_and_failed_admission_can_retry() {
        let mut engine = window(Operation::Average, 250, 250, 2, 1000);
        sample(&mut engine, 1, 0, 2.0, EvidenceQuality::Measured).unwrap();
        engine.commit().unwrap();
        sample(&mut engine, 2, 100, 900.0, EvidenceQuality::Held).unwrap();
        engine.commit().unwrap();
        assert_eq!(engine.current().count, 1);
        let before = engine.current();
        assert_eq!(
            sample(&mut engine, 3, 250, 5.0, EvidenceQuality::Measured),
            Err(TemporalError::DensityExceeded)
        );
        assert_eq!(engine.current(), before);
        assert!(engine.staged_contributors().is_none());
        // The exact interval boundary frees only the first physical observation.
        let retry = sample(&mut engine, 3, 1000, 5.0, EvidenceQuality::Measured).unwrap();
        assert_eq!(retry.value, Some(5.0));
        assert_eq!(retry.revision, 2);
        engine.commit().unwrap();
    }

    #[test]
    fn equal_timestamp_bursts_are_valid_and_rate_requires_distinct_times() {
        let mut engine = window(Operation::Rate, 1000, 1000, 3, 1000);
        sample(&mut engine, 1, 0, 2.0, EvidenceQuality::Measured).unwrap();
        engine.commit().unwrap();
        let outcome = sample(&mut engine, 2, 0, 4.0, EvidenceQuality::Measured).unwrap();
        assert_eq!(outcome.count, 2);
        assert_eq!(outcome.value, None);
        engine.commit().unwrap();
        let duplicate = sample(&mut engine, 1, 0, 999.0, EvidenceQuality::Measured).unwrap();
        assert_eq!(duplicate.revision, 2);
        assert_eq!(duplicate.count, 2);
        engine.commit().unwrap();
        assert_eq!(
            sample(&mut engine, 3, 500, 8.0, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(12.0)
        );
        engine.commit().unwrap();
    }

    #[test]
    fn average_preserves_exact_small_means_and_finite_cancellation() {
        let mut average = window(Operation::Average, 1000, 1000, 4, 1000);
        sample(&mut average, 1, 0, 20.0, EvidenceQuality::Measured).unwrap();
        average.commit().unwrap();
        assert_eq!(
            sample(&mut average, 2, 1, 30.0, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(25.0)
        );
        let mut cancellation = window(Operation::Average, 1000, 1000, 4, 1000);
        for (id, value) in [(1, 1e16), (2, 1.0), (3, -1e16)] {
            sample(&mut cancellation, id, id, value, EvidenceQuality::Measured).unwrap();
            cancellation.commit().unwrap();
        }
        assert_eq!(cancellation.current().value, Some(1.0 / 3.0));
    }

    #[test]
    fn finite_extremes_do_not_spuriously_overflow_but_real_rate_overflow_rolls_back() {
        let mut same_sign = window(Operation::Average, 10_000, 10_000, 4, 10_000);
        sample(&mut same_sign, 1, 0, f64::MAX, EvidenceQuality::Measured).unwrap();
        same_sign.commit().unwrap();
        assert_eq!(
            sample(&mut same_sign, 2, 1, f64::MAX, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(f64::MAX)
        );
        let mut average = window(Operation::Average, 10_000, 10_000, 4, 10_000);
        sample(&mut average, 1, 0, f64::MAX, EvidenceQuality::Measured).unwrap();
        average.commit().unwrap();
        assert_eq!(
            sample(&mut average, 2, 1, -f64::MAX, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(0.0)
        );
        average.commit().unwrap();
        let mut rate = window(Operation::Rate, 10_000, 10_000, 4, 10_000);
        sample(&mut rate, 1, 0, -f64::MAX, EvidenceQuality::Measured).unwrap();
        rate.commit().unwrap();
        let before = rate.current();
        assert_eq!(
            sample(&mut rate, 2, 1, f64::MAX, EvidenceQuality::Measured),
            Err(TemporalError::NonFinite)
        );
        assert_eq!(rate.current(), before);
        assert_eq!(
            sample(&mut rate, 2, 2000, f64::MAX, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(f64::MAX)
        );
        rate.commit().unwrap();
    }

    #[test]
    fn stale_history_can_contribute_again_and_upstream_fault_is_preserved() {
        let mut engine = window(Operation::Average, 1000, 100, 4, 1000);
        sample(&mut engine, 1, 0, 2.0, EvidenceQuality::Measured).unwrap();
        engine.commit().unwrap();
        let fault = UpstreamFault {
            origin: 1,
            fault: SensorFault::Disconnected,
        };
        let output = engine
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 99,
                },
                &[RootInput {
                    source_tag: 1,
                    identity: None,
                }],
                None,
                Some(fault),
            )
            .unwrap();
        assert_eq!(output.value, Some(2.0));
        assert_eq!(output.upstream_fault, Some(fault));
        engine.commit().unwrap();
        let stale = engine
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 100,
                },
                &[RootInput {
                    source_tag: 1,
                    identity: None,
                }],
                None,
                None,
            )
            .unwrap();
        assert_eq!(stale.value, None);
        assert_eq!(stale.count, 1);
        assert_eq!(stale.revision, 1);
        engine.commit().unwrap();
        assert_eq!(
            sample(&mut engine, 2, 500, 8.0, EvidenceQuality::Measured)
                .unwrap()
                .value,
            Some(5.0)
        );
        engine.commit().unwrap();
    }

    #[test]
    fn explicit_profiles_and_complete_inputs_are_required() {
        let config = WindowConfig {
            operation: Operation::Min,
            over_ms: 1001,
            max_age_ms: 1,
        };
        let roots = [RootDensity {
            source_tag: 1,
            max_observations: 2,
            interval_ms: 1000,
        }];
        let budget = TargetBudget {
            max_retained_samples: 4,
            max_bytes: 100_000,
        };
        let mut engine = Window::new(config, &roots, budget).unwrap();
        assert_eq!(
            engine.capacity(),
            4,
            "full over, never max_age, determines retention"
        );
        assert!(matches!(
            Window::new(config, &[], budget),
            Err(TemporalError::InvalidConfig)
        ));
        assert!(matches!(
            Window::new(
                config,
                &roots,
                TargetBudget {
                    max_retained_samples: 3,
                    ..budget
                }
            ),
            Err(TemporalError::BudgetExceeded)
        ));
        assert!(matches!(
            Window::new(
                config,
                &roots,
                TargetBudget {
                    max_bytes: engine.memory_bytes() - 1,
                    ..budget
                }
            ),
            Err(TemporalError::BudgetExceeded)
        ));
        let huge = [RootDensity {
            source_tag: 1,
            max_observations: usize::MAX,
            interval_ms: 1,
        }];
        assert!(matches!(
            Window::new(config, &huge, budget),
            Err(TemporalError::BudgetExceeded)
        ));
        assert_eq!(
            engine.stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 0
                },
                &[],
                None,
                None
            ),
            Err(TemporalError::IncompleteRoots)
        );
        let first = sample(&mut engine, 1, 0, 2.0, EvidenceQuality::Measured).unwrap();
        assert_eq!(
            sample(&mut engine, 2, 1, 3.0, EvidenceQuality::Measured),
            Err(TemporalError::AlreadyStaged)
        );
        assert_eq!(engine.staged_contributors().unwrap()[0].value, 2.0);
        engine.commit().unwrap();
        assert_eq!(engine.current(), first);
        assert_eq!(engine.commit(), Err(TemporalError::NotStaged));
        assert_eq!(engine.rollback(), Err(TemporalError::NotStaged));
    }

    #[test]
    fn scan_staging_commit_and_rollback_allocate_no_heap() {
        let mut engine = window(Operation::Average, 1000, 1000, 4, 1000);
        println!("temporal memory: Window={} RootDensity={} RootState={} Observation={} densityTimestamp={} C=4 N=1 M=4 total={}",
            size_of::<Window>(), size_of::<RootDensity>(), size_of::<RootState>(), size_of::<Observation>(), size_of::<u64>(), engine.memory_bytes());
        ALLOCATIONS.with(|count| count.set(0));
        TRACK.with(|track| track.set(true));
        for id in 0..200 {
            sample(
                &mut engine,
                id,
                id * 1000,
                id as f64,
                EvidenceQuality::Measured,
            )
            .unwrap();
            if id % 3 == 0 {
                engine.rollback().unwrap();
            } else {
                engine.commit().unwrap();
            }
        }
        TRACK.with(|track| track.set(false));
        assert_eq!(ALLOCATIONS.with(Cell::get), 0);
    }

    #[test]
    fn exact_window_and_max_age_boundaries_are_transactional() {
        let roots = [RootDensity {
            source_tag: 1,
            max_observations: 4,
            interval_ms: 1000,
        }];
        let mut window = Window::new(
            WindowConfig {
                operation: Operation::Average,
                over_ms: 1000,
                max_age_ms: 500,
            },
            &roots,
            TargetBudget {
                max_retained_samples: 4,
                max_bytes: 100_000,
            },
        )
        .unwrap();
        let identity = Identity {
            epoch: 1,
            id: 1,
            timestamp_ms: 100,
        };
        let outcome = window
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 100,
                },
                &[RootInput {
                    source_tag: 1,
                    identity: Some(identity),
                }],
                Some(Evidence {
                    observation: Observation {
                        source_tag: 1,
                        identity,
                        value: 12.0,
                    },
                    quality: EvidenceQuality::Measured,
                }),
                None,
            )
            .unwrap();
        assert_eq!(outcome.value, Some(12.0));
        assert_eq!(window.current().value, None);
        window.commit().unwrap();
        let absent = [RootInput {
            source_tag: 1,
            identity: None,
        }];
        assert_eq!(
            window
                .stage(
                    TimeContext {
                        epoch: 1,
                        now_ms: 600
                    },
                    &absent,
                    None,
                    None
                )
                .unwrap()
                .value,
            None
        );
        assert_eq!(window.current().value, Some(12.0));
        window.rollback().unwrap();
        let expired = window
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 1100,
                },
                &absent,
                None,
                None,
            )
            .unwrap();
        assert_eq!(expired.count, 0);
        window.commit().unwrap();
        assert!(window.contributors().is_empty());
    }
}
