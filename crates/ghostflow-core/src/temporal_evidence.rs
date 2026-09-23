//! Owned physical/derived evidence, scoped to one installed execution session.
use crate::temporal::{
    self, AggregatePoint, Observation, Operation, RootDensity, RootInput, TargetBudget,
    TimeContext, UpstreamFault, Window, WindowCheckpoint, WindowConfig,
};
use crate::temporal_runtime::WindowTrace;
use crate::{Error, Result};
use std::mem::size_of;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum EvidenceIdentity {
    Physical {
        source_tag: u32,
        epoch: u64,
        id: u64,
    },
    Derived {
        site: u32,
        time_epoch: u64,
        revision: u64,
    },
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EvidencePoint {
    pub identity: EvidenceIdentity,
    pub timestamp_ms: u64,
    pub evaluated_at_ms: u64,
    pub value: f64,
    pub proof_root: Option<usize>,
    pub proof_size: usize,
}
impl AggregatePoint for EvidencePoint {
    fn value(&self) -> f64 {
        self.value
    }
    fn timestamp(&self) -> u64 {
        self.timestamp_ms
    }
}
pub(crate) fn operation_name(operation: Operation) -> &'static str {
    match operation {
        Operation::Average => "average",
        Operation::Min => "min",
        Operation::Max => "max",
        Operation::Rate => "rate",
    }
}
impl From<Observation> for EvidencePoint {
    fn from(point: Observation) -> Self {
        Self {
            identity: EvidenceIdentity::Physical {
                source_tag: point.source_tag,
                epoch: point.identity.epoch,
                id: point.identity.id,
            },
            timestamp_ms: point.identity.timestamp_ms,
            evaluated_at_ms: point.identity.timestamp_ms,
            value: point.value,
            proof_root: None,
            proof_size: 0,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProofNode {
    pub identity: EvidenceIdentity,
    pub timestamp_ms: u64,
    pub evaluated_at_ms: u64,
    pub value: f64,
    pub supplied_value: f64,
    pub operation: Option<Operation>,
    pub child_count: usize,
    pub subtree_size: usize,
}
const EMPTY: ProofNode = ProofNode {
    identity: EvidenceIdentity::Physical {
        source_tag: 0,
        epoch: 0,
        id: 0,
    },
    timestamp_ms: 0,
    evaluated_at_ms: 0,
    value: 0.0,
    supplied_value: 0.0,
    operation: None,
    child_count: 0,
    subtree_size: 1,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EvidenceOutcome {
    pub value: Option<f64>,
    pub count: usize,
    pub first: Option<EvidencePoint>,
    pub last: Option<EvidencePoint>,
    pub revision: u64,
    pub time: Option<TimeContext>,
    pub upstream_fault: Option<UpstreamFault>,
}
struct State {
    entries: Vec<EvidencePoint>,
    proof: Vec<ProofNode>,
    highwaters: Vec<u64>,
    outcome: EvidenceOutcome,
}
fn add(bytes: usize, count: usize, width: usize) -> Result<usize> {
    bytes
        .checked_add(count.checked_mul(width).ok_or_else(budget)?)
        .ok_or_else(budget)
}
fn budget() -> Error {
    Error::new("temporal-budget-exceeded")
}
fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<()> {
    values
        .try_reserve_exact(capacity)
        .map_err(|_| Error::new("temporal-allocation-failed"))?;
    if values.capacity() != capacity {
        return Err(budget());
    }
    Ok(())
}
fn failure(error: impl std::fmt::Display) -> Error {
    Error::new(error.to_string())
}
impl State {
    fn new(capacity: usize, proof_nodes: usize, sources: usize) -> Result<Self> {
        let mut entries = Vec::new();
        reserve(&mut entries, capacity)?;
        let mut proof = Vec::new();
        reserve(&mut proof, proof_nodes)?;
        proof.resize(proof_nodes, EMPTY);
        let mut highwaters = Vec::new();
        reserve(&mut highwaters, sources)?;
        highwaters.resize(sources, 0);
        Ok(Self {
            entries,
            proof,
            highwaters,
            outcome: EvidenceOutcome {
                value: None,
                count: 0,
                first: None,
                last: None,
                revision: 0,
                time: None,
                upstream_fault: None,
            },
        })
    }
    fn copy_from(&mut self, source: &Self) {
        self.entries.clear();
        self.entries.extend_from_slice(&source.entries);
        self.proof.copy_from_slice(&source.proof);
        self.highwaters.copy_from_slice(&source.highwaters);
        self.outcome = source.outcome;
    }
    fn bytes(&self) -> Result<usize> {
        add(
            add(
                add(0, self.entries.capacity(), size_of::<EvidencePoint>())?,
                self.proof.capacity(),
                size_of::<ProofNode>(),
            )?,
            self.highwaters.capacity(),
            size_of::<u64>(),
        )
    }
}
pub(crate) enum SelectedEvidence {
    Physical(Observation),
    Derived { site: u32, value: f64 },
}

pub(crate) struct EvidenceWindow {
    tracker: Window,
    config: WindowConfig,
    sites: Vec<u32>,
    capacity: usize,
    proof_per_entry: usize,
    committed: State,
    candidate: State,
    staged: bool,
    memory_bytes: usize,
}
pub(crate) struct EvidenceCheckpoint {
    tracker: WindowCheckpoint,
    config: WindowConfig,
    sites: Vec<u32>,
    capacity: usize,
    proof_per_entry: usize,
    state: State,
    memory_bytes: usize,
}
#[derive(Clone, Copy)]
pub(crate) struct EvidenceStoragePlan {
    pub capacity: usize,
    pub proof_nodes: usize,
    pub engine_bytes: usize,
    pub checkpoint_bytes: usize,
}
impl EvidenceStoragePlan {
    fn geometry(
        tracker: crate::temporal::WindowStoragePlan,
        sites: usize,
        capacity: usize,
        proof_per_entry: usize,
    ) -> Result<Self> {
        let proof_nodes = capacity.checked_mul(proof_per_entry).ok_or_else(budget)?;
        let bank = add(
            add(
                add(0, capacity, size_of::<EvidencePoint>())?,
                proof_nodes,
                size_of::<ProofNode>(),
            )?,
            sites,
            size_of::<u64>(),
        )?;
        let source_bytes = sites.checked_mul(size_of::<u32>()).ok_or_else(budget)?;
        Ok(Self {
            capacity,
            proof_nodes,
            engine_bytes: add(
                add(
                    add(
                        tracker.engine_bytes,
                        size_of::<EvidenceWindow>() - size_of::<Window>(),
                        1,
                    )?,
                    source_bytes,
                    1,
                )?,
                2,
                bank,
            )?,
            checkpoint_bytes: add(
                add(
                    add(
                        tracker.checkpoint_bytes,
                        size_of::<EvidenceCheckpoint>() - size_of::<WindowCheckpoint>(),
                        1,
                    )?,
                    source_bytes,
                    1,
                )?,
                1,
                bank,
            )?,
        })
    }
}
impl EvidenceCheckpoint {
    pub(crate) fn memory_bytes(&self) -> usize {
        self.memory_bytes
    }
}
impl EvidenceWindow {
    pub(crate) fn storage_plan(
        config: WindowConfig,
        roots: &[RootDensity],
        sites: usize,
        horizon: u64,
        proof_per_entry: usize,
    ) -> Result<EvidenceStoragePlan> {
        let tracker = Window::storage_plan(config, roots).map_err(failure)?;
        let mut capacity = 0;
        for root in roots {
            let intervals = horizon / root.interval_ms + u64::from(horizon % root.interval_ms != 0);
            capacity = add(
                capacity,
                root.max_observations,
                usize::try_from(intervals).map_err(|_| budget())?,
            )?;
        }
        EvidenceStoragePlan::geometry(tracker, sites, capacity, proof_per_entry)
    }
    pub(crate) fn new(
        config: WindowConfig,
        roots: &[RootDensity],
        sites: &[u32],
        horizon: u64,
        proof_per_entry: usize,
        limits: TargetBudget,
    ) -> Result<Self> {
        let plan = Self::storage_plan(config, roots, sites.len(), horizon, proof_per_entry)?;
        if plan.capacity > limits.max_retained_samples || plan.engine_bytes > limits.max_bytes {
            return Err(budget());
        }
        let capacity = plan.capacity;
        let nodes = plan.proof_nodes;
        let tracker = Window::new(config, roots, limits).map_err(failure)?;
        let mut owned_sites = Vec::new();
        reserve(&mut owned_sites, sites.len())?;
        owned_sites.extend_from_slice(sites);
        let mut engine = Self {
            tracker,
            config,
            sites: owned_sites,
            capacity,
            proof_per_entry,
            committed: State::new(capacity, nodes, sites.len())?,
            candidate: State::new(capacity, nodes, sites.len())?,
            staged: false,
            memory_bytes: 0,
        };
        engine.memory_bytes = add(
            add(
                add(
                    size_of::<Self>() + engine.tracker.memory_bytes() - size_of::<Window>(),
                    engine.sites.capacity(),
                    size_of::<u32>(),
                )?,
                engine.committed.bytes()?,
                1,
            )?,
            engine.candidate.bytes()?,
            1,
        )?;
        if engine.memory_bytes != plan.engine_bytes || engine.memory_bytes > limits.max_bytes {
            return Err(budget());
        }
        Ok(engine)
    }
    pub(crate) fn capacity(&self) -> usize {
        self.capacity
    }
    pub(crate) fn proof_capacity(&self) -> usize {
        self.capacity * self.proof_per_entry
    }
    pub(crate) fn memory_bytes(&self) -> usize {
        self.memory_bytes
    }
    pub(crate) fn stage(
        &mut self,
        time: TimeContext,
        roots: &[RootInput],
        selected: Option<SelectedEvidence>,
        upstream_fault: Option<UpstreamFault>,
        upstream: &[WindowTrace],
    ) -> Result<EvidenceOutcome> {
        if self.staged {
            return Err(Error::new("temporal-already-staged"));
        }
        self.tracker
            .stage(time, roots, None, upstream_fault)
            .map_err(failure)?;
        self.candidate.copy_from(&self.committed);
        let result = self.update(time, selected, upstream_fault, upstream);
        if result.is_err() {
            let _ = self.tracker.rollback();
        } else {
            self.staged = true;
        }
        result
    }
    fn update(
        &mut self,
        time: TimeContext,
        selected: Option<SelectedEvidence>,
        fault: Option<UpstreamFault>,
        upstream: &[WindowTrace],
    ) -> Result<EvidenceOutcome> {
        let state = &mut self.candidate;
        let tracker = &self.tracker;
        let valid_identity = |identity| match identity {
            EvidenceIdentity::Physical {
                source_tag, epoch, ..
            } => tracker
                .staged_root(source_tag)
                .is_some_and(|(current, _)| current.epoch == epoch),
            EvidenceIdentity::Derived { .. } => true,
        };
        let proof = &state.proof;
        state.entries.retain(|point| {
            time.now_ms.saturating_sub(point.timestamp_ms) < self.config.over_ms
                && valid_identity(point.identity)
                && point.proof_root.is_none_or(|start| {
                    proof[start..start + point.proof_size]
                        .iter()
                        .all(|node| valid_identity(node.identity))
                })
        });
        let mut admitted = None;
        if let Some(selected) = selected {
            match selected {
                SelectedEvidence::Physical(observation) => {
                    if !observation.value.is_finite() {
                        return Err(Error::new("temporal-non-finite-result"));
                    }
                    let (identity, fresh) = tracker
                        .staged_root(observation.source_tag)
                        .ok_or_else(|| Error::new("temporal-observation-identity-mismatch"))?;
                    if fresh && identity != observation.identity {
                        return Err(Error::new("temporal-observation-identity-mismatch"));
                    }
                    if fresh {
                        admitted = Some(EvidencePoint::from(observation));
                    }
                }
                SelectedEvidence::Derived { site, value } => {
                    let index = self
                        .sites
                        .iter()
                        .position(|candidate| *candidate == site)
                        .ok_or_else(|| Error::new("temporal derived site is not declared"))?;
                    let source = upstream
                        .iter()
                        .find(|source| source.site == site)
                        .ok_or_else(|| Error::new("temporal derived source is unavailable"))?;
                    if !value.is_finite() {
                        return Err(Error::new("temporal-non-finite-result"));
                    }
                    let source_value = source
                        .outcome
                        .value
                        .ok_or_else(|| Error::new("temporal derived source is not successful"))?;
                    if source.outcome.revision > state.highwaters[index] {
                        let last = source.outcome.last.ok_or_else(|| {
                            Error::new("temporal derived source has no contributors")
                        })?;
                        if time.now_ms.saturating_sub(last.timestamp_ms) < self.config.over_ms {
                            let proof_slot = (0..self.capacity)
                                .find(|slot| {
                                    !state.entries.iter().any(|point| {
                                        point.proof_root == Some(slot * self.proof_per_entry)
                                    })
                                })
                                .ok_or_else(budget)?;
                            let start = proof_slot * self.proof_per_entry;
                            let target = &mut state.proof[start..start + self.proof_per_entry];
                            let mut used = 1_usize;
                            for point in &source.contributors {
                                if let Some(root) = point.proof_root {
                                    let end = used
                                        .checked_add(point.proof_size)
                                        .filter(|end| *end <= target.len())
                                        .ok_or_else(budget)?;
                                    target[used..end].copy_from_slice(
                                        &source.proof[root..root + point.proof_size],
                                    );
                                    target[used].supplied_value = point.value;
                                    used = end;
                                } else {
                                    if used >= target.len() {
                                        return Err(budget());
                                    }
                                    target[used] = ProofNode {
                                        identity: point.identity,
                                        timestamp_ms: point.timestamp_ms,
                                        evaluated_at_ms: point.evaluated_at_ms,
                                        value: point.value,
                                        supplied_value: point.value,
                                        operation: None,
                                        child_count: 0,
                                        subtree_size: 1,
                                    };
                                    used += 1;
                                }
                            }
                            let identity = EvidenceIdentity::Derived {
                                site,
                                time_epoch: time.epoch,
                                revision: source.outcome.revision,
                            };
                            target[0] = ProofNode {
                                identity,
                                timestamp_ms: last.timestamp_ms,
                                evaluated_at_ms: time.now_ms,
                                value: source_value,
                                supplied_value: value,
                                operation: Some(source.operation),
                                child_count: source.contributors.len(),
                                subtree_size: used,
                            };
                            admitted = Some(EvidencePoint {
                                identity,
                                timestamp_ms: last.timestamp_ms,
                                evaluated_at_ms: time.now_ms,
                                value,
                                proof_root: Some(start),
                                proof_size: used,
                            });
                        }
                    }
                }
            }
        }
        if let Some(point) = admitted {
            if point.timestamp_ms > time.now_ms {
                return Err(Error::new("temporal-future-observation"));
            }
            if time.now_ms - point.timestamp_ms < self.config.over_ms {
                if state.entries.len() == self.capacity {
                    return Err(Error::new("temporal-capacity-exceeded"));
                }
                state.outcome.revision = state
                    .outcome
                    .revision
                    .checked_add(1)
                    .filter(|revision| *revision <= (1_u64 << 53) - 1)
                    .ok_or_else(|| Error::new("temporal-revision-exhausted"))?;
                state.entries.push(point);
            }
        }
        for (site, highwater) in self.sites.iter().zip(&mut state.highwaters) {
            *highwater = upstream
                .iter()
                .find(|record| record.site == *site)
                .ok_or_else(|| Error::new("temporal derived source is unavailable"))?
                .outcome
                .revision;
        }
        state
            .entries
            .sort_unstable_by_key(|point| (point.timestamp_ms, point.identity));
        let first = state.entries.first().copied();
        let last = state.entries.last().copied();
        let value = if last
            .is_some_and(|point| time.now_ms - point.timestamp_ms < self.config.max_age_ms)
        {
            temporal::aggregate(self.config.operation, &state.entries).map_err(failure)?
        } else {
            None
        };
        state.outcome = EvidenceOutcome {
            value,
            count: state.entries.len(),
            first,
            last,
            revision: state.outcome.revision,
            time: Some(time),
            upstream_fault: fault,
        };
        Ok(state.outcome)
    }
    pub(crate) fn staged_into(&self, points: &mut Vec<EvidencePoint>, proof: &mut Vec<ProofNode>) {
        for point in &self.candidate.entries {
            let mut copy = *point;
            if let Some(root) = point.proof_root {
                copy.proof_root = Some(proof.len());
                proof.extend_from_slice(&self.candidate.proof[root..root + point.proof_size]);
            }
            points.push(copy);
        }
    }
    pub(crate) fn commit(&mut self) -> Result<()> {
        if !self.staged {
            return Err(Error::new("temporal-not-staged"));
        }
        self.tracker.commit().map_err(failure)?;
        std::mem::swap(&mut self.committed, &mut self.candidate);
        self.staged = false;
        Ok(())
    }
    pub(crate) fn rollback(&mut self) -> Result<()> {
        self.staged = false;
        self.tracker.rollback().map_err(failure)
    }
    pub(crate) fn checkpoint(&self, limit: usize) -> Result<EvidenceCheckpoint> {
        let tracker_plan = self.tracker.storage_geometry().map_err(failure)?;
        let plan = EvidenceStoragePlan::geometry(
            tracker_plan,
            self.sites.len(),
            self.capacity,
            self.proof_per_entry,
        )?;
        if plan.checkpoint_bytes > limit {
            return Err(budget());
        }
        let tracker = self
            .tracker
            .checkpoint(tracker_plan.checkpoint_bytes)
            .map_err(failure)?;
        let mut sites = Vec::new();
        reserve(&mut sites, self.sites.len())?;
        sites.extend_from_slice(&self.sites);
        let mut state = State::new(self.capacity, self.proof_capacity(), self.sites.len())?;
        state.copy_from(&self.committed);
        let bytes = add(
            add(
                size_of::<EvidenceCheckpoint>() + tracker.memory_bytes()
                    - size_of::<WindowCheckpoint>(),
                sites.capacity(),
                size_of::<u32>(),
            )?,
            state.bytes()?,
            1,
        )?;
        if bytes != plan.checkpoint_bytes || bytes > limit {
            return Err(budget());
        }
        Ok(EvidenceCheckpoint {
            tracker,
            config: self.config,
            sites,
            capacity: self.capacity,
            proof_per_entry: self.proof_per_entry,
            state,
            memory_bytes: bytes,
        })
    }
    fn check(&self, snapshot: &EvidenceCheckpoint) -> Result<()> {
        if self.config != snapshot.config
            || self.capacity != snapshot.capacity
            || self.proof_per_entry != snapshot.proof_per_entry
            || self.sites != snapshot.sites
        {
            return Err(Error::new("temporal-checkpoint-mismatch"));
        }
        self.tracker
            .verify_checkpoint(&snapshot.tracker)
            .map_err(failure)
    }
    pub(crate) fn checkpoint_into(&self, target: &mut EvidenceCheckpoint) -> Result<()> {
        self.check(target)?;
        self.tracker
            .checkpoint_into(&mut target.tracker)
            .map_err(failure)?;
        target.state.copy_from(&self.committed);
        Ok(())
    }
    pub(crate) fn restore(&mut self, source: &EvidenceCheckpoint) -> Result<()> {
        self.check(source)?;
        self.tracker.restore(&source.tracker).map_err(failure)?;
        self.committed.copy_from(&source.state);
        Ok(())
    }
}
