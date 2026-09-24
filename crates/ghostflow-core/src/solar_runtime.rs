//! Native Solar GFB5 binding. Providers supply complete occurrence facts for the
//! installed descriptors; the VM owns admission, predicates and transaction commit.
use crate::schedule_clock::ClockSnapshot;
use crate::schedule_vm::PulseDescriptor;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScheduleKind {
    Solar,
    Daily,
    DailySlots,
}

#[derive(Clone, Copy, Debug)]
pub struct ScheduleInput<'a> {
    pub site: u32,
    pub kind: ScheduleKind,
    pub facts: SolarFacts<'a>,
}

pub(crate) fn validate_kinds(
    descriptors: &[PulseDescriptor],
    facts: &[ScheduleInput<'_>],
) -> Result<()> {
    if descriptors.len() != facts.len() {
        return Err(Error::new("schedule occurrence binding mismatch"));
    }
    for (descriptor, input) in descriptors.iter().zip(facts) {
        if descriptor.site() != input.site {
            return Err(Error::new("schedule occurrence binding mismatch"));
        }
        match descriptor {
            PulseDescriptor::Solar(_) if input.kind == ScheduleKind::Solar => {
                if input
                    .facts
                    .rows
                    .iter()
                    .any(|r| r.fold != 0 || r.slot_key != 0 || r.minute_of_day != 0)
                {
                    return Err(Error::new("Solar facts cannot contain a civil fold"));
                }
            }
            PulseDescriptor::Daily(d) if input.kind == ScheduleKind::Daily => {
                if input.facts.rows.iter().any(|r| {
                    r.slot_key != 0
                        || r.minute_of_day != 0
                        || match (d.dst_repeated, r.fold) {
                            (_, 0) | (0, 1) | (1, 2) | (2, 1 | 2) => false,
                            _ => true,
                        }
                }) {
                    return Err(Error::new("Daily fact violates DST repeated policy"));
                }
            }
            PulseDescriptor::DailySlots(d) if input.kind == ScheduleKind::DailySlots => {
                if input.facts.rows.iter().any(|r| {
                    !d.slots.contains(&(r.slot_key, r.minute_of_day))
                        || match (d.dst_repeated, r.fold) {
                            (_, 0) | (0, 1) | (1, 2) | (2, 1 | 2) => false,
                            _ => true,
                        }
                }) {
                    return Err(Error::new("DailySlots fact violates descriptor"));
                }
            }
            _ => return Err(Error::new("schedule fact kind mismatch")),
        }
    }
    Ok(())
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
        descriptors: &[PulseDescriptor],
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
                    d.site(),
                    d.gap_ms(),
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
        descriptors: &[PulseDescriptor],
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
                .any(|(fact, d)| fact.site != d.site())
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
            let mut unknown_reason = None;
            if matches!(
                descriptor,
                PulseDescriptor::Daily(_) | PulseDescriptor::DailySlots(_)
            ) {
                if input.facts.rows.iter().any(|r| {
                    r.availability == crate::solar_admission::SolarFactAvailability::Unavailable
                }) {
                    unknown_reason = Some("OccurrenceUnavailable");
                } else if clock.wall_ms.is_some_and(|wall| {
                    wall < input.facts.coverage_from_wall_ms
                        || wall > input.facts.coverage_to_wall_ms
                }) {
                    unknown_reason = Some("IncompleteCoverage");
                }
            }
            let stage = engine.begin_with_unknown(clock, input.facts, unknown_reason)?;
            // Evaluate on the admitted crossing only. A false condition is a
            // terminal per-occurrence outcome; later ticks cannot re-fire it.
            let predicate = if stage
                .result()
                .observations
                .iter()
                .any(|row| row.decision == crate::solar_admission::SolarDecision::Before)
            {
                match eval_expression_with_preludes(
                    descriptor.when(),
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
            let mut result = engine.commit(stage.evaluate(predicate)?)?;
            if matches!(
                descriptor,
                PulseDescriptor::Daily(_) | PulseDescriptor::DailySlots(_)
            ) && result.decision == crate::solar_admission::SolarDecision::Unknown
            {
                result
                    .observations
                    .extend(input.facts.rows.iter().map(|row| {
                        crate::solar_admission::SolarObservation {
                            source_day: row.source_day,
                            slot_key: row.slot_key,
                            minute_of_day: row.minute_of_day,
                            fold: row.fold,
                            scheduled_wall_ms: row.scheduled_wall_ms,
                            decision: crate::solar_admission::SolarDecision::Unknown,
                            provider_revision: row.provider_revision.clone(),
                            context_revision: row.context_revision.clone(),
                        }
                    }));
            }
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
