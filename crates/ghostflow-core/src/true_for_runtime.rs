//! Native execution of directly bound certified Bool intervals.
//! Mixed preludes and checkpoint/replay are not activated by this slice.

use crate::signals::SensorFault;
use crate::temporal::{EvidenceQuality, TimeContext};
use crate::temporal_runtime::{exact, fault_code};
use crate::true_for::{CertifiedBoolInterval, TrueFor, TrueForInput, TrueForOutcome};
use crate::true_for_vm::TrueForDescriptor;
use crate::{Error, Result, ResultTraceEvent, Value};
use std::mem::size_of;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrueForActivation {
    pub certified_bool_roots: Vec<u32>,
    pub time_epoch: u64,
    /// Engine, projection, and retained trace buffers; excludes compiled module,
    /// scalar VM journal fields, allocator metadata, JSON and caller clones.
    pub max_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrueForTrace {
    pub site: u32,
    pub source_tag: u32,
    pub source_epoch: u64,
    pub input: TrueForInput,
    pub outcome: TrueForOutcome,
}

pub(crate) struct TrueForRuntime {
    engines: Vec<TrueFor>,
    pub projections: Vec<[Value; 7]>,
    time_epoch: u64,
    pub memory_bytes: usize,
}

fn budget() -> Error {
    Error::new("temporal-budget-exceeded")
}
fn storage(base: usize, count: usize, width: usize) -> Result<usize> {
    base.checked_add(count.checked_mul(width).ok_or_else(budget)?)
        .ok_or_else(budget)
}
fn reserve<T>(values: &mut Vec<T>, count: usize) -> Result<()> {
    values
        .try_reserve_exact(count)
        .map_err(|_| Error::new("temporal-allocation-failed"))?;
    if values.capacity() != count {
        return Err(budget());
    }
    Ok(())
}
fn boolean(value: Value) -> Result<bool> {
    match value {
        Value::Bool(value) => Ok(value),
        _ => Err(Error::new("invalid certified interval Bool")),
    }
}

impl TrueForRuntime {
    pub(crate) fn new(
        signals: &[TrueForDescriptor],
        activation: &TrueForActivation,
        journal_capacity: usize,
        result_trace_bound: usize,
    ) -> Result<Self> {
        if activation.time_epoch > 9_007_199_254_740_991 || activation.max_bytes == 0 {
            return Err(Error::new("invalid certified interval activation"));
        }
        let retained_frames = journal_capacity.checked_add(1).ok_or_else(budget)?;
        let trace_frame = storage(
            size_of::<Vec<TrueForTrace>>(),
            signals.len(),
            size_of::<TrueForTrace>(),
        )?;
        let result_frame = storage(
            size_of::<Vec<ResultTraceEvent>>(),
            result_trace_bound,
            size_of::<ResultTraceEvent>(),
        )?;
        let trace_bytes = storage(
            0,
            retained_frames,
            trace_frame.checked_add(result_frame).ok_or_else(budget)?,
        )?;
        let memory_bytes = storage(
            storage(
                size_of::<Self>(),
                signals.len(),
                size_of::<TrueFor>() + size_of::<[Value; 7]>(),
            )?,
            1,
            trace_bytes,
        )?;
        if memory_bytes > activation.max_bytes {
            return Err(budget());
        }
        let mut engines = Vec::new();
        reserve(&mut engines, signals.len())?;
        let mut projections = Vec::new();
        reserve(&mut projections, signals.len())?;
        for signal in signals {
            engines.push(
                TrueFor::new(signal.source_tag, signal.duration_ms)
                    .map_err(|error| Error::new(error.to_string()))?,
            );
            projections.push([
                Value::Bool(false),
                Value::Bool(false),
                Value::Number(3.0),
                Value::Number(f64::from(signal.site)),
                Value::Number(0.0),
                Value::Number(0.0),
                Value::Number(0.0),
            ]);
        }
        Ok(Self {
            engines,
            projections,
            time_epoch: activation.time_epoch,
            memory_bytes,
        })
    }

    pub(crate) fn stage(
        &mut self,
        signals: &[TrueForDescriptor],
        time: TimeContext,
        inputs: &[Value],
    ) -> Result<Vec<TrueForTrace>> {
        if time.epoch != self.time_epoch {
            return Err(Error::new("temporal time epoch mismatch"));
        }
        let mut trace = Vec::new();
        reserve(&mut trace, self.engines.len())?;
        for (slot, descriptor) in signals.iter().enumerate() {
            let value = |field| inputs[usize::from(descriptor.interval_inputs[field])];
            let source_epoch = exact(value(1))?;
            let id = exact(value(2))?;
            let start_ms = exact(value(3))?;
            let end_ms = exact(value(4))?;
            let payload = boolean(value(5))?;
            let quality = exact(value(6))?;
            let fault = exact(value(7))?;
            if quality > 4 || fault > 3 {
                return Err(Error::new("invalid certified interval quality or fault"));
            }
            let input = if !boolean(value(0))? {
                TrueForInput::NoObservation
            } else if quality == 4 {
                TrueForInput::Unavailable(match fault {
                    0 => SensorFault::Disconnected,
                    1 => SensorFault::Stale,
                    2 => SensorFault::Invalid,
                    _ => SensorFault::NotReady,
                })
            } else {
                let quality = match quality {
                    1 => EvidenceQuality::Measured,
                    2 => EvidenceQuality::Held,
                    _ => EvidenceQuality::Constructed,
                };
                TrueForInput::Interval(CertifiedBoolInterval {
                    source_tag: descriptor.source_tag,
                    source_epoch,
                    time_epoch: time.epoch,
                    id,
                    start_ms,
                    end_ms,
                    value: payload,
                    quality,
                })
            };
            let outcome = self.engines[slot]
                .stage(time, source_epoch, input)
                .map_err(|error| Error::new(error.to_string()))?;
            let code = outcome.upstream_fault.map_or(3, fault_code);
            let origin = if outcome.upstream_fault.is_some() {
                descriptor.source_tag
            } else {
                descriptor.site
            };
            self.projections[slot] = [
                Value::Bool(outcome.value.is_some()),
                Value::Bool(outcome.value.unwrap_or(false)),
                Value::Number(f64::from(code)),
                Value::Number(f64::from(origin)),
                Value::Number(outcome.start_ms.unwrap_or(0) as f64),
                Value::Number(outcome.end_ms.unwrap_or(0) as f64),
                Value::Number(outcome.covered_ms as f64),
            ];
            trace.push(TrueForTrace {
                site: descriptor.site,
                source_tag: descriptor.source_tag,
                source_epoch,
                input,
                outcome,
            });
        }
        Ok(trace)
    }
    pub(crate) fn commit(&mut self) {
        for engine in &mut self.engines {
            engine
                .commit()
                .expect("every certified prelude staged before commit");
        }
    }
    pub(crate) fn rollback(&mut self) {
        for engine in &mut self.engines {
            let _ = engine.rollback();
        }
    }
}
