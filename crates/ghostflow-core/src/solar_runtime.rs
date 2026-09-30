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
#[derive(Clone)]
pub(crate) struct SolarRuntime {
    engines: Vec<SolarPulseEngine>,
    pub boot_epoch: u64,
}
pub(crate) struct StagedSolar {
    engines: Vec<SolarPulseEngine>,
    pub projections: Vec<[Value; 3]>,
    pub trace: Vec<SolarStageResult>,
}
impl SolarRuntime {
    // Mirrors the existing context checkpoint envelope: version, exact Program,
    // ordered declaration sites, bounded payload and CRC for accidental corruption.
    // Only terminal occurrence identities survive a reboot; clocks start fresh.
    pub(crate) fn snapshot(
        &self,
        descriptors: &[PulseDescriptor],
        fingerprint: u64,
    ) -> Result<Vec<u8>> {
        if descriptors
            .iter()
            .any(|d| !matches!(d, PulseDescriptor::Solar(_)))
        {
            return Err(Error::new(
                "solar checkpoint requires Solar-only descriptors",
            ));
        }
        let mut out = b"GFSO\x01\x00".to_vec();
        out.extend(fingerprint.to_le_bytes());
        out.extend((descriptors.len() as u16).to_le_bytes());
        for (descriptor, engine) in descriptors.iter().zip(&self.engines) {
            out.extend(descriptor.site().to_le_bytes());
            out.extend((engine.terminal_identities().len() as u16).to_le_bytes());
            for (day, _, _) in engine.terminal_identities() {
                out.extend(day.to_le_bytes());
            }
        }
        out.extend(checksum(&out).to_le_bytes());
        Ok(out)
    }

    pub(crate) fn restored(
        &self,
        descriptors: &[PulseDescriptor],
        fingerprint: u64,
        bytes: &[u8],
    ) -> Result<Self> {
        // 128 declarations, at most 4096 identities each, fixed-width envelope.
        if bytes.len() < 20 || bytes.len() > 20 + 128 * (6 + 4096 * 4) {
            return Err(Error::new("invalid solar checkpoint size"));
        }
        let (payload, crc) = bytes.split_at(bytes.len() - 4);
        if checksum(payload) != u32::from_le_bytes(crc.try_into().unwrap()) {
            return Err(Error::new("corrupt solar checkpoint"));
        }
        let mut reader = crate::Reader::new(payload);
        if reader.take(4)? != b"GFSO"
            || reader.u16()? != 1
            || reader.u64()? != fingerprint
            || usize::from(reader.u16()?) != descriptors.len()
            || descriptors
                .iter()
                .any(|d| !matches!(d, PulseDescriptor::Solar(_)))
        {
            return Err(Error::new("solar checkpoint Program identity mismatch"));
        }
        let mut restored = self.clone();
        for (descriptor, engine) in descriptors.iter().zip(&mut restored.engines) {
            if reader.u32()? != descriptor.site() {
                return Err(Error::new("solar checkpoint site mismatch"));
            }
            let count = usize::from(reader.u16()?);
            if count > 4096 {
                return Err(Error::new("solar checkpoint capacity exceeded"));
            }
            let mut days = Vec::with_capacity(count);
            for _ in 0..count {
                days.push((reader.u32()? as i32, 0, 0));
            }
            engine.restore_solar_identities(days)?;
        }
        if !reader.finished() {
            return Err(Error::new("trailing solar checkpoint bytes"));
        }
        Ok(restored)
    }

    pub(crate) fn new(
        descriptors: &[PulseDescriptor],
        activation: &SolarActivation,
    ) -> Result<Self> {
        // Bound provider batches and terminal storage explicitly on MCU targets.
        if descriptors.is_empty() || !(1..=4096).contains(&activation.terminal_capacity) {
            return Err(Error::new("invalid solar activation capacity"));
        }
        if descriptors.iter().any(|d| {
            matches!(
                d,
                PulseDescriptor::Context(_)
                    | PulseDescriptor::Natural(_)
                    | PulseDescriptor::Accounting(_)
            )
        }) {
            return Err(Error::new("context descriptors require context activation"));
        }
        let engines = descriptors
            .iter()
            .map(|d| {
                SolarPulseEngine::new(
                    d.site(),
                    d.gap_ms(),
                    activation.boot_epoch,
                    activation.terminal_capacity,
                )?
                .with_policy(
                    match d {
                        PulseDescriptor::Solar(s) => s.clock_hold_ms,
                        _ => None,
                    },
                    match d {
                        PulseDescriptor::Solar(s) => s.fallback_time_ms,
                        _ => None,
                    },
                )
                .map(|engine| {
                    engine.with_fallback_timezone(match d {
                        PulseDescriptor::Solar(s) => &s.timezone,
                        _ => "",
                    })
                })
            })
            .collect::<Result<_>>()?;
        Ok(Self {
            engines,
            boot_epoch: activation.boot_epoch,
        })
    }
    fn validate_inputs(descriptors: &[PulseDescriptor], facts: &[SolarInput<'_>]) -> Result<()> {
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
        Ok(())
    }

    pub(crate) fn observe_paused(
        &self,
        descriptors: &[PulseDescriptor],
        clock: ClockSnapshot<'_>,
        facts: &[SolarInput<'_>],
    ) -> Result<Self> {
        Self::validate_inputs(descriptors, facts)?;
        if descriptors
            .iter()
            .any(|d| !matches!(d, PulseDescriptor::Solar(_)))
            || facts
                .iter()
                .flat_map(|f| f.facts.rows)
                .any(|r| r.fold != 0 || r.slot_key != 0 || r.minute_of_day != 0)
        {
            return Err(Error::new("paused observation requires pure Solar facts"));
        }
        let mut staged = self.clone();
        for (input, engine) in facts.iter().zip(&mut staged.engines) {
            let stage = engine.begin(clock, input.facts)?.evaluate(false)?;
            // This suppresses host execution. It does not evaluate the authored
            // predicate or publish ConditionsFalseAtPulse as program trace.
            engine.commit(stage)?;
        }
        Ok(staged)
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
        Self::validate_inputs(descriptors, facts)?;
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
                            fallback: false,
                            unavailable_reason: None,
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
            staged.projections.push([
                Value::Bool(result.due),
                Value::Bool(missed),
                Value::Bool(false),
            ]);
            staged.trace.push(result);
        }
        Ok(staged)
    }
    pub(crate) fn commit(&mut self, stage: StagedSolar) {
        self.engines = stage.engines;
    }
}

fn checksum(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
