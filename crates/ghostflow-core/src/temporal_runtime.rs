//! Transactional execution storage for verified physical-source window preludes.
//!
//! The explicit budget covers temporal-owned buffers and the maximum retained
//! contributor records plus one temporary record. It excludes allocator metadata,
//! existing scalar Runtime storage, JSON output strings, and caller-owned clones.

use crate::signals::SensorFault;
use crate::temporal::{
    Identity, Observation, RootDensity, RootInput, TargetBudget, TimeContext, UpstreamFault,
    WindowConfig,
};
use crate::temporal_evidence::{
    EvidenceCheckpoint, EvidenceOutcome, EvidencePoint, EvidenceWindow, ProofNode, SelectedEvidence,
};
use crate::temporal_vm::{TemporalRequirements, WindowDescriptor};
use crate::{eval_expression_with_windows, Error, Result, ResultTraceBuffer, Type, Value};
use std::mem::size_of;

const MAX_EXACT: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporalActivation {
    pub root_density: Vec<RootDensity>,
    pub budget: TargetBudget,
    pub time_epoch: u64,
}

/// Target-layout upper bound, including reserved future record capacity.
/// This is not process heap usage; JSON, allocator metadata and scalar/module
/// storage remain outside the temporal resource contract.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporalResourceReport {
    pub module_fingerprint: u64,
    pub strategy: String,
    pub target_pointer_bytes: usize,
    pub journal_capacity: usize,
    pub window_count: usize,
    pub retained_samples: usize,
    pub accounted_temporal_bytes: usize,
    pub fits_budget: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporalReplayResourceReport {
    pub module_fingerprint: u64,
    pub strategy: String,
    pub target_pointer_bytes: usize,
    pub eligible_count: usize,
    pub count: usize,
    pub live_bytes: usize,
    pub ghost_bytes: usize,
    pub return_header_bytes: usize,
    pub frame_header_bytes: usize,
    pub required_peak_temporal_bytes: usize,
    pub ghost_fits_budget: bool,
}
impl TemporalResourceReport {
    pub fn write_json(&self, out: &mut impl std::fmt::Write) -> std::fmt::Result {
        write!(
            out,
            "{{\"format\":\"GhostFlow/temporal-resources-v1\",\"module\":\"{:016x}\",\"strategy\":",
            self.module_fingerprint
        )?;
        crate::trace_json::text(out, &self.strategy)?;
        write!(out,",\"targetPointerBytes\":{},\"journalCapacity\":{},\"windowCount\":{},\"retainedSamples\":{},\"accountedTemporalBytes\":{},\"fitsBudget\":{}}}",self.target_pointer_bytes,self.journal_capacity,self.window_count,self.retained_samples,self.accounted_temporal_bytes,self.fits_budget)
    }
}
impl TemporalReplayResourceReport {
    pub fn write_json(&self, out: &mut impl std::fmt::Write) -> std::fmt::Result {
        write!(out,"{{\"format\":\"GhostFlow/temporal-replay-resources-v1\",\"module\":\"{:016x}\",\"strategy\":",self.module_fingerprint)?;
        crate::trace_json::text(out, &self.strategy)?;
        write!(out,",\"targetPointerBytes\":{},\"eligibleCount\":{},\"count\":{},\"liveBytes\":{},\"ghostBytes\":{},\"returnHeaderBytes\":{},\"frameHeaderBytes\":{},\"requiredPeakTemporalBytes\":{},\"ghostFitsBudget\":{}}}",self.target_pointer_bytes,self.eligible_count,self.count,self.live_bytes,self.ghost_bytes,self.return_header_bytes,self.frame_header_bytes,self.required_peak_temporal_bytes,self.ghost_fits_budget)
    }
    pub(crate) fn new(
        live: &TemporalResourceReport,
        ghost: TemporalResourceReport,
        count: usize,
        eligible_count: usize,
        framed: bool,
    ) -> Result<Self> {
        let return_header_bytes = add(
            0,
            count,
            size_of::<Vec<WindowTrace>>() + size_of::<Vec<crate::ResultTraceEvent>>(),
        )?;
        let frame_header_bytes = if framed {
            add(0, count, size_of::<crate::scan::ScanOutcomeV1>())?
        } else {
            0
        };
        let peak = add(
            add(
                add(
                    live.accounted_temporal_bytes,
                    ghost.accounted_temporal_bytes,
                    1,
                )?,
                return_header_bytes,
                1,
            )?,
            frame_header_bytes,
            1,
        )?;
        Ok(Self {
            module_fingerprint: ghost.module_fingerprint,
            strategy: ghost.strategy,
            target_pointer_bytes: size_of::<usize>(),
            eligible_count,
            count,
            live_bytes: live.accounted_temporal_bytes,
            ghost_bytes: ghost.accounted_temporal_bytes,
            return_header_bytes,
            frame_header_bytes,
            required_peak_temporal_bytes: peak,
            ghost_fits_budget: ghost.fits_budget,
        })
    }
}
struct WindowPlan {
    horizon: u64,
    proof_per_entry: usize,
    proof_bound: usize,
    geometry: crate::temporal_evidence::EvidenceStoragePlan,
}
pub(crate) struct TemporalPlan {
    pub report: TemporalResourceReport,
    windows: Vec<WindowPlan>,
    trace_bytes: usize,
}

/// Self-contained evidence; it remains usable after the Runtime is dropped.
#[derive(Clone, Debug, PartialEq)]
pub struct WindowTrace {
    pub site: u32,
    pub payload_type: Type,
    pub operation: crate::temporal::Operation,
    pub outcome: EvidenceOutcome,
    pub contributors: Vec<EvidencePoint>,
    pub proof: Vec<ProofNode>,
}

struct Slot {
    engine: EvidenceWindow,
    inputs: Vec<RootInput>,
}
struct Snapshot {
    tick: Option<u64>,
    clock: Option<u64>,
    windows: Vec<EvidenceCheckpoint>,
}

pub(crate) struct TemporalRuntime {
    slots: Vec<Slot>,
    pub(crate) projections: Vec<[Value; 8]>,
    snapshots: Vec<Snapshot>,
    density: Vec<RootDensity>,
    pub(crate) time_epoch: u64,
    pub(crate) strategy: usize,
    pub(crate) memory_bytes: usize,
    pub(crate) report: TemporalResourceReport,
    trace_bytes: usize,
}

fn failure(error: impl std::fmt::Display) -> Error {
    Error::new(error.to_string())
}
fn reserve<T>(values: &mut Vec<T>, count: usize) -> Result<()> {
    values
        .try_reserve_exact(count)
        .map_err(|_| Error::new("temporal-allocation-failed"))?;
    if values.capacity() != count {
        return Err(Error::new("temporal-budget-exceeded"));
    }
    Ok(())
}
fn add(total: usize, count: usize, width: usize) -> Result<usize> {
    total
        .checked_add(
            count
                .checked_mul(width)
                .ok_or_else(|| Error::new("temporal-budget-exceeded"))?,
        )
        .ok_or_else(|| Error::new("temporal-budget-exceeded"))
}
pub(crate) fn exact(value: Value) -> Result<u64> {
    match value {
        Value::Number(v)
            if v.is_finite() && v >= 0.0 && v <= MAX_EXACT as f64 && v.fract() == 0.0 =>
        {
            Ok(v as u64)
        }
        _ => Err(Error::new("temporal-invalid-identity")),
    }
}
pub(crate) fn fault_code(fault: SensorFault) -> u8 {
    match fault {
        SensorFault::Disconnected => 0,
        SensorFault::Stale => 1,
        SensorFault::Invalid => 2,
        _ => 3,
    }
}
fn fault_from(code: u64) -> Result<SensorFault> {
    match code {
        0 => Ok(SensorFault::Disconnected),
        1 => Ok(SensorFault::Stale),
        2 => Ok(SensorFault::Invalid),
        3 => Ok(SensorFault::NotReady),
        _ => Err(Error::new("temporal-invalid-fault")),
    }
}

impl TemporalPlan {
    pub(crate) fn new(
        requirements: &TemporalRequirements,
        strategy: usize,
        activation: &TemporalActivation,
        journal: usize,
        result_trace_bound: usize,
        module_fingerprint: u64,
        strategy_name: &str,
    ) -> Result<Self> {
        if activation.time_epoch > MAX_EXACT
            || activation.budget.max_bytes == 0
            || activation.budget.max_retained_samples == 0
        {
            return Err(Error::new("temporal-invalid-config"));
        }
        let descriptors = &requirements.strategies[strategy].windows;
        let required = requirements
            .roots
            .iter()
            .filter(|root| {
                descriptors.iter().any(|w| {
                    w.roots
                        .iter()
                        .any(|i| requirements.roots[usize::from(*i)].source_tag == root.source_tag)
                })
            })
            .map(|r| r.source_tag);
        if activation
            .root_density
            .iter()
            .map(|d| d.source_tag)
            .ne(required)
        {
            return Err(Error::new("temporal activation root contract mismatch"));
        }
        let mut windows: Vec<WindowPlan> = Vec::new();
        reserve(&mut windows, descriptors.len())?;
        let mut used = add(
            size_of::<TemporalRuntime>() + size_of::<TemporalPlan>(),
            descriptors.len(),
            size_of::<WindowPlan>(),
        )?;
        used = add(used, strategy_name.len(), 1)?;
        used = add(
            used,
            descriptors.len(),
            size_of::<Slot>() + size_of::<[Value; 8]>(),
        )?;
        used = add(used, journal + 1, size_of::<Snapshot>())?;
        used = add(
            used,
            activation.root_density.len(),
            size_of::<RootDensity>(),
        )?;
        let marker_bytes = add(
            size_of::<Vec<crate::ResultTraceEvent>>(),
            result_trace_bound,
            size_of::<crate::ResultTraceEvent>(),
        )?;
        used = add(used, journal + 1, marker_bytes)?;
        let mut samples = 0;
        let mut proof_nodes = 0;
        let mut scratch_peak = 0;
        for d in descriptors {
            let horizon = d
                .over_ms
                .checked_add(
                    d.upstream_windows
                        .iter()
                        .map(|i| windows[usize::from(*i)].horizon)
                        .max()
                        .unwrap_or(0),
                )
                .ok_or_else(|| Error::new("temporal-budget-exceeded"))?;
            let proof_per_entry = d
                .upstream_windows
                .iter()
                .map(|i| windows[usize::from(*i)].proof_bound)
                .max()
                .unwrap_or(0);
            let roots = selected_roots(requirements, d, &activation.root_density)?;
            let geometry = EvidenceWindow::storage_plan(
                WindowConfig {
                    operation: d.operation,
                    over_ms: d.over_ms,
                    max_age_ms: d.max_age_ms,
                },
                &roots,
                d.upstream_windows.len(),
                horizon,
                proof_per_entry,
            )?;
            samples = add(samples, geometry.capacity, 1)?;
            proof_nodes = add(proof_nodes, geometry.proof_nodes, 1)?;
            used = add(used, geometry.engine_bytes - size_of::<EvidenceWindow>(), 1)?;
            used = add(used, roots.len(), size_of::<RootInput>())?;
            used = add(used, journal + 1, geometry.checkpoint_bytes)?;
            scratch_peak = scratch_peak.max(add(
                add(0, roots.len(), size_of::<RootDensity>())?,
                d.upstream_windows.len(),
                size_of::<u32>(),
            )?);
            let proof_bound = add(1, geometry.capacity, proof_per_entry.max(1))?;
            windows.push(WindowPlan {
                horizon,
                proof_per_entry,
                proof_bound,
                geometry,
            });
        }
        used = add(used, scratch_peak, 1)?;
        let trace_bytes = add(
            add(
                add(
                    size_of::<Vec<WindowTrace>>(),
                    descriptors.len(),
                    size_of::<WindowTrace>(),
                )?,
                samples,
                size_of::<EvidencePoint>(),
            )?,
            proof_nodes,
            size_of::<ProofNode>(),
        )?;
        used = add(used, journal + 1, trace_bytes)?;
        let mut name = String::new();
        name.try_reserve_exact(strategy_name.len())
            .map_err(|_| Error::new("temporal-allocation-failed"))?;
        if name.capacity() != strategy_name.len() {
            return Err(Error::new("temporal-budget-exceeded"));
        }
        name.push_str(strategy_name);
        Ok(Self {
            report: TemporalResourceReport {
                module_fingerprint,
                strategy: name,
                target_pointer_bytes: size_of::<usize>(),
                journal_capacity: journal,
                window_count: descriptors.len(),
                retained_samples: samples,
                accounted_temporal_bytes: used,
                fits_budget: used <= activation.budget.max_bytes
                    && samples <= activation.budget.max_retained_samples,
            },
            windows,
            trace_bytes,
        })
    }
}
fn selected_roots(
    requirements: &TemporalRequirements,
    descriptor: &WindowDescriptor,
    density: &[RootDensity],
) -> Result<Vec<RootDensity>> {
    let mut roots = Vec::new();
    reserve(&mut roots, descriptor.roots.len())?;
    for index in &descriptor.roots {
        roots.push(
            *density
                .iter()
                .find(|d| d.source_tag == requirements.roots[usize::from(*index)].source_tag)
                .ok_or_else(|| Error::new("temporal activation root contract mismatch"))?,
        );
    }
    Ok(roots)
}
impl TemporalRuntime {
    pub(crate) fn check_activation_profile(&self, activation: &TemporalActivation) -> Result<()> {
        if self.time_epoch != activation.time_epoch || self.density != activation.root_density {
            return Err(Error::new("incompatible temporal replay bindings"));
        }
        Ok(())
    }
    pub(crate) fn new(
        requirements: &TemporalRequirements,
        strategy: usize,
        activation: &TemporalActivation,
        journal: usize,
        max_bytes: usize,
        result_trace_bound: usize,
        module_fingerprint: u64,
        strategy_name: &str,
    ) -> Result<Self> {
        let plan = TemporalPlan::new(
            requirements,
            strategy,
            activation,
            journal,
            result_trace_bound,
            module_fingerprint,
            strategy_name,
        )?;
        if !plan.report.fits_budget || plan.report.accounted_temporal_bytes > max_bytes {
            return Err(Error::new("temporal-budget-exceeded"));
        }
        let descriptors = &requirements.strategies[strategy].windows;
        let mut slots = Vec::new();
        reserve(&mut slots, descriptors.len())?;
        let mut projections = Vec::new();
        reserve(&mut projections, descriptors.len())?;
        let mut snapshots = Vec::new();
        reserve(&mut snapshots, journal + 1)?;
        let mut density = Vec::new();
        reserve(&mut density, activation.root_density.len())?;
        density.extend_from_slice(&activation.root_density);
        for (d, p) in descriptors.iter().zip(&plan.windows) {
            let roots = selected_roots(requirements, d, &density)?;
            let mut sites = Vec::new();
            reserve(&mut sites, d.upstream_windows.len())?;
            sites.extend(
                d.upstream_windows
                    .iter()
                    .map(|i| descriptors[usize::from(*i)].site),
            );
            let engine = EvidenceWindow::new(
                WindowConfig {
                    operation: d.operation,
                    over_ms: d.over_ms,
                    max_age_ms: d.max_age_ms,
                },
                &roots,
                &sites,
                p.horizon,
                p.proof_per_entry,
                TargetBudget {
                    max_retained_samples: p.geometry.capacity,
                    max_bytes: p.geometry.engine_bytes,
                },
            )?;
            if engine.memory_bytes() != p.geometry.engine_bytes {
                return Err(Error::new("temporal-budget-exceeded"));
            }
            let mut inputs = Vec::new();
            reserve(&mut inputs, roots.len())?;
            inputs.extend(roots.iter().map(|r| RootInput {
                source_tag: r.source_tag,
                identity: None,
            }));
            slots.push(Slot { engine, inputs });
            projections.push([Value::Number(0.0); 8]);
        }
        for index in 0..=journal {
            let mut windows = Vec::new();
            reserve(&mut windows, slots.len())?;
            for (slot, p) in slots.iter().zip(&plan.windows) {
                let checkpoint = slot.engine.checkpoint(p.geometry.checkpoint_bytes)?;
                if checkpoint.memory_bytes() != p.geometry.checkpoint_bytes {
                    return Err(Error::new("temporal-budget-exceeded"));
                }
                windows.push(checkpoint);
            }
            snapshots.push(Snapshot {
                tick: if index == 0 { Some(0) } else { None },
                clock: None,
                windows,
            });
        }
        Ok(Self {
            slots,
            projections,
            snapshots,
            density,
            time_epoch: activation.time_epoch,
            strategy,
            memory_bytes: plan.report.accounted_temporal_bytes,
            trace_bytes: plan.trace_bytes,
            report: plan.report,
        })
    }
    pub(crate) fn stage(
        &mut self,
        requirements: &TemporalRequirements,
        inputs: &[Value],
        state: &[Value],
        trace: &mut ResultTraceBuffer,
    ) -> Result<Vec<WindowTrace>> {
        let epoch = exact(inputs[usize::from(requirements.time_epoch_input)])?;
        if epoch != self.time_epoch {
            return Err(Error::new("temporal time epoch mismatch"));
        }
        let now = exact(inputs[usize::from(requirements.now_input)])?;
        let descriptors = &requirements.strategies[self.strategy].windows;
        let mut records = Vec::new();
        reserve(&mut records, self.slots.len())?;
        let mut evidence_bytes = add(
            size_of::<Vec<WindowTrace>>(),
            records.capacity(),
            size_of::<WindowTrace>(),
        )?;
        for (index, descriptor) in descriptors.iter().enumerate() {
            for (root_index, root_input) in
                descriptor.roots.iter().zip(&mut self.slots[index].inputs)
            {
                let root = &requirements.roots[usize::from(*root_index)];
                let identity = Identity {
                    epoch: exact(inputs[usize::from(root.epoch_input)])?,
                    id: exact(inputs[usize::from(root.id_input)])?,
                    timestamp_ms: exact(inputs[usize::from(root.timestamp_input)])?,
                };
                root_input.identity = match inputs[usize::from(root.present_input)] {
                    Value::Bool(true) => Some(identity),
                    Value::Bool(false) => None,
                    _ => return Err(Error::new("invalid temporal presence")),
                };
            }
            let evaluate = |code: &[u8], trace: &mut ResultTraceBuffer| {
                eval_expression_with_windows(
                    code,
                    inputs,
                    state,
                    None,
                    trace,
                    &self.projections[..index],
                )
            };
            let (sample, fault) = match evaluate(&descriptor.source.ok, trace)? {
                Value::Bool(true) => {
                    // Result success evaluates its selected payload even on duplicate observations.
                    let value = match evaluate(&descriptor.source.payload, trace)? {
                        Value::Number(v) => v,
                        Value::Int(v) => f64::from(v),
                        _ => return Err(Error::new("invalid temporal payload")),
                    };
                    let quality = exact(evaluate(&descriptor.source.quality, trace)?)?;
                    if quality > 3 {
                        return Err(Error::new("invalid temporal quality"));
                    }
                    let tag = exact(evaluate(&descriptor.source.source_tag, trace)?)?;
                    let tag =
                        u32::try_from(tag).map_err(|_| Error::new("temporal-invalid-identity"))?;
                    let sample = if quality == 1 {
                        let root = self.slots[index]
                            .inputs
                            .iter()
                            .find(|root| root.source_tag == tag)
                            .ok_or_else(|| Error::new("temporal-observation-identity-mismatch"))?;
                        root.identity.map(|identity| {
                            SelectedEvidence::Physical(Observation {
                                source_tag: tag,
                                identity,
                                value,
                            })
                        })
                    } else if quality == 3 {
                        Some(SelectedEvidence::Derived { site: tag, value })
                    } else {
                        None
                    };
                    (sample, None)
                }
                Value::Bool(false) => {
                    let fault = fault_from(exact(evaluate(&descriptor.source.fault, trace)?)?)?;
                    let origin = u32::try_from(exact(evaluate(&descriptor.source.origin, trace)?)?)
                        .map_err(|_| Error::new("temporal-invalid-identity"))?;
                    (None, Some(UpstreamFault { origin, fault }))
                }
                _ => return Err(Error::new("invalid temporal ok")),
            };
            let slot = &mut self.slots[index];
            let mut outcome = slot
                .engine
                .stage(
                    TimeContext { epoch, now_ms: now },
                    &slot.inputs,
                    sample,
                    fault,
                    &records,
                )
                .map_err(failure)?;
            if outcome.revision > MAX_EXACT {
                return Err(Error::new("temporal-revision-exhausted"));
            }
            self.projections[index] = projections(descriptor, outcome)?;
            let mut contributors = Vec::new();
            reserve(&mut contributors, slot.engine.capacity())?;
            evidence_bytes = add(
                evidence_bytes,
                contributors.capacity(),
                size_of::<EvidencePoint>(),
            )?;
            let mut proof = Vec::new();
            reserve(&mut proof, slot.engine.proof_capacity())?;
            evidence_bytes = add(evidence_bytes, proof.capacity(), size_of::<ProofNode>())?;
            if evidence_bytes > self.trace_bytes {
                return Err(Error::new("temporal-budget-exceeded"));
            }
            slot.engine.staged_into(&mut contributors, &mut proof);
            outcome.first = contributors.first().copied();
            outcome.last = contributors.last().copied();
            records.push(WindowTrace {
                site: descriptor.site,
                payload_type: descriptor.payload_type,
                operation: descriptor.operation,
                outcome,
                contributors,
                proof,
            });
        }
        Ok(records)
    }
    pub(crate) fn rollback(&mut self) {
        for slot in &mut self.slots {
            let _ = slot.engine.rollback();
        }
    }
    pub(crate) fn commit(&mut self, tick: u64, clock: u64) {
        let position = (tick % self.snapshots.len() as u64) as usize;
        for (slot, checkpoint) in self
            .slots
            .iter_mut()
            .zip(&mut self.snapshots[position].windows)
        {
            slot.engine
                .commit()
                .expect("every prelude staged before commit");
            slot.engine
                .checkpoint_into(checkpoint)
                .expect("activation prebound checkpoint geometry");
        }
        self.snapshots[position].tick = Some(tick);
        self.snapshots[position].clock = Some(clock);
    }
    pub(crate) fn restore_tick(&mut self, tick: u64) -> Result<Option<u64>> {
        let position = (tick % self.snapshots.len() as u64) as usize;
        let snapshot = &self.snapshots[position];
        if snapshot.tick != Some(tick) {
            return Err(Error::new("temporal checkpoint not retained"));
        }
        for (slot, checkpoint) in self.slots.iter_mut().zip(&snapshot.windows) {
            slot.engine
                .restore(checkpoint)
                .expect("prebound checkpoint geometry");
        }
        Ok(snapshot.clock)
    }
    pub(crate) fn seed_from(&mut self, other: &Self, tick: u64) -> Result<Option<u64>> {
        if self.time_epoch != other.time_epoch
            || self.density != other.density
            || self.slots.len() != other.slots.len()
        {
            return Err(Error::new("incompatible temporal replay bindings"));
        }
        let source = &other.snapshots[(tick % other.snapshots.len() as u64) as usize];
        if source.tick != Some(tick) {
            return Err(Error::new("temporal checkpoint not retained"));
        }
        let target_index = (tick % self.snapshots.len() as u64) as usize;
        for ((slot, checkpoint), target) in self
            .slots
            .iter_mut()
            .zip(&source.windows)
            .zip(&mut self.snapshots[target_index].windows)
        {
            slot.engine.restore(checkpoint).map_err(failure)?;
            slot.engine
                .checkpoint_into(target)
                .expect("prebound target checkpoint geometry");
        }
        self.snapshots[target_index].tick = Some(tick);
        self.snapshots[target_index].clock = source.clock;
        Ok(source.clock)
    }
}

fn projections(descriptor: &WindowDescriptor, outcome: EvidenceOutcome) -> Result<[Value; 8]> {
    let value = match descriptor.payload_type {
        Type::Number => Value::Number(outcome.value.unwrap_or(0.0)),
        Type::Int => {
            let v = outcome.value.unwrap_or(0.0);
            if v.fract() != 0.0 || v < f64::from(i32::MIN) || v > f64::from(i32::MAX) {
                return Err(Error::new("temporal Int result out of range"));
            }
            Value::Int(v as i32)
        }
        _ => return Err(Error::new("invalid temporal payload")),
    };
    let ok = outcome.value.is_some();
    let (fault, origin) = if ok { (0, 0) } else { (3, descriptor.site) };
    Ok([
        Value::Bool(ok),
        value,
        Value::Number(f64::from(fault)),
        Value::Number(f64::from(origin)),
        Value::Number(outcome.revision as f64),
        Value::Number(outcome.last.map_or(0, |point| point.timestamp_ms) as f64),
        Value::Number(outcome.count as f64),
        Value::Number(if ok { 3.0 } else { 0.0 }),
    ])
}
