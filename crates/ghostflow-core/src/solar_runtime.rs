//! Native Solar GFB5 binding. Providers supply complete occurrence facts for the
//! installed descriptors; the VM owns admission, predicates and transaction commit.
use crate::schedule_clock::ClockSnapshot;
use crate::schedule_vm::SolarPulseDescriptor;
use crate::solar_admission::{SolarFacts, SolarPulseEngine, SolarStageResult};
use crate::{eval_expression_with_preludes, Error, Result, ResultTraceBuffer, Value};

#[derive(Clone, Copy, Debug)]
pub struct SolarActivation {
    pub boot_epoch: u64,
    /// Per-schedule retained terminal identities. Exhaustion rejects the tick;
    /// it never silently drops duplicate-suppression history.
    pub terminal_capacity: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct SolarInput<'a> {
    pub site: u32,
    pub facts: SolarFacts<'a>,
}
pub(crate) struct SolarRuntime {
    engines: Vec<SolarPulseEngine>,
    pub boot_epoch: u64,
}
pub(crate) struct StagedSolar {
    engines: Vec<SolarPulseEngine>,
    pub projections: Vec<[Value; 2]>,
    pub trace: Vec<SolarStageResult>,
}
impl SolarRuntime {
    pub(crate) fn new(
        descriptors: &[SolarPulseDescriptor],
        activation: &SolarActivation,
    ) -> Result<Self> {
        // Bound provider batches and terminal storage explicitly on MCU targets.
        if descriptors.is_empty() || !(1..=4096).contains(&activation.terminal_capacity) {
            return Err(Error::new("invalid solar activation capacity"));
        }
        let engines = descriptors
            .iter()
            .map(|d| {
                SolarPulseEngine::new(
                    d.site,
                    d.gap_ms,
                    activation.boot_epoch,
                    activation.terminal_capacity,
                )
            })
            .collect::<Result<_>>()?;
        Ok(Self {
            engines,
            boot_epoch: activation.boot_epoch,
        })
    }
    pub(crate) fn stage(
        &self,
        descriptors: &[SolarPulseDescriptor],
        clock: ClockSnapshot<'_>,
        facts: &[SolarInput<'_>],
        inputs: &[Value],
        state: &[Value],
        trace: &mut ResultTraceBuffer,
    ) -> Result<StagedSolar> {
        if facts.len() != descriptors.len()
            || facts
                .iter()
                .zip(descriptors)
                .any(|(fact, d)| fact.site != d.site)
        {
            return Err(Error::new("solar occurrence binding mismatch"));
        }
        // Revision text is copied into retained evidence; bound it before staging.
        if facts
            .iter()
            .flat_map(|input| input.facts.rows)
            .any(|row| row.provider_revision.len() > 128 || row.context_revision.len() > 128)
        {
            return Err(Error::new("solar provider revision exceeds limit"));
        }
        let mut staged = StagedSolar {
            engines: self.engines.clone(),
            projections: Vec::with_capacity(descriptors.len()),
            trace: Vec::with_capacity(descriptors.len()),
        };
        for ((descriptor, input), engine) in descriptors.iter().zip(facts).zip(&mut staged.engines)
        {
            let stage = engine.begin(clock, input.facts)?;
            // Evaluate on the admitted crossing only. A false condition is a
            // terminal per-occurrence outcome; later ticks cannot re-fire it.
            let predicate = if stage
                .result()
                .observations
                .iter()
                .any(|row| row.decision == crate::solar_admission::SolarDecision::Before)
            {
                match eval_expression_with_preludes(
                    &descriptor.when,
                    inputs,
                    state,
                    None,
                    trace,
                    &[],
                    &[],
                    &staged.projections,
                )? {
                    Value::Bool(value) => value,
                    _ => return Err(Error::new("schedule predicate must be Bool")),
                }
            } else {
                false
            };
            let result = engine.commit(stage.evaluate(predicate)?)?;
            let missed = result.observations.iter().any(|observation| {
                matches!(
                    observation.decision,
                    crate::solar_admission::SolarDecision::ConditionsFalseAtPulse
                        | crate::solar_admission::SolarDecision::Missed
                        | crate::solar_admission::SolarDecision::ObservationGap
                        | crate::solar_admission::SolarDecision::CorrectionPastHighWater
                )
            });
            staged
                .projections
                .push([Value::Bool(result.due), Value::Bool(missed)]);
            staged.trace.push(result);
        }
        Ok(staged)
    }
    pub(crate) fn commit(&mut self, stage: StagedSolar) {
        self.engines = stage.engines;
    }
}
