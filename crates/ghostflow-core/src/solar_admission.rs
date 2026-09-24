//! Bounded, staged Solar pulse admission.
//!
//! This is the first Rust-owned admission slice. It consumes provider facts but
//! never accepts a caller-computed `due` bit. Provider truth, IANA conversion,
//! and durable package identity remain outside this component.

use crate::schedule_clock::{ClockDisposition, ClockSnapshot, ScheduleClockGate};
use crate::{Error, Result};
use std::sync::atomic::{AtomicU32, Ordering};

const MAX_SOURCE_DAY: i32 = 2_932_896;
const MAX_WALL_MS: u64 = 253_402_300_799_999;
const MAX_TERMINAL_CAPACITY: usize = 2_932_897;
static NEXT_OWNER: AtomicU32 = AtomicU32::new(1);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolarFactAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolarFact {
    pub source_day: i32,
    /// Civil recurrence fold. Solar facts always use zero.
    pub fold: u8,
    pub scheduled_wall_ms: Option<u64>,
    pub provider_revision: String,
    pub context_revision: String,
    pub availability: SolarFactAvailability,
}

impl SolarFact {
    pub fn available(
        source_day: i32,
        scheduled_wall_ms: u64,
        provider: &str,
        context: &str,
    ) -> Self {
        Self {
            source_day,
            fold: 0,
            scheduled_wall_ms: Some(scheduled_wall_ms),
            provider_revision: provider.to_owned(),
            context_revision: context.to_owned(),
            availability: SolarFactAvailability::Available,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SolarFacts<'a> {
    pub coverage_from_wall_ms: u64,
    pub coverage_to_wall_ms: u64,
    pub rows: &'a [SolarFact],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolarDecision {
    BootBaseline,
    RecoveryBaseline,
    Before,
    Due,
    ConditionsFalseAtPulse,
    AlreadyTerminal,
    Missed,
    MultipleCrossingsMissed,
    ObservationGap,
    CorrectionPastHighWater,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolarObservation {
    pub source_day: i32,
    pub fold: u8,
    pub scheduled_wall_ms: Option<u64>,
    pub decision: SolarDecision,
    pub provider_revision: String,
    pub context_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolarStageResult {
    pub site: u32,
    pub due: bool,
    pub decision: SolarDecision,
    pub observations: Vec<SolarObservation>,
    pub unknown_reason: Option<String>,
}

#[derive(Debug)]
pub struct SolarPulseEngine {
    site: u32,
    gap_ms: u64,
    clock: ScheduleClockGate,
    terminal_days: Vec<(i32, u8)>,
    terminal_capacity: usize,
    generation: u64,
    owner_id: u32,
}

impl Clone for SolarPulseEngine {
    fn clone(&self) -> Self {
        let mut clone = self.clone_for_stage();
        clone.owner_id = NEXT_OWNER.fetch_add(1, Ordering::Relaxed);
        clone
    }
}

#[derive(Clone, Debug)]
pub struct SolarStage {
    engine: SolarPulseEngine,
    result: SolarStageResult,
    base_generation: u64,
    evaluated: bool,
}

impl SolarPulseEngine {
    pub fn new(site: u32, gap_ms: u64, boot_epoch: u64, terminal_capacity: usize) -> Result<Self> {
        if site == 0 || terminal_capacity == 0 || terminal_capacity > MAX_TERMINAL_CAPACITY {
            return Err(Error::new("invalid solar admission configuration"));
        }
        Ok(Self {
            site,
            gap_ms,
            clock: ScheduleClockGate::new(gap_ms, boot_epoch)?,
            terminal_days: Vec::with_capacity(terminal_capacity),
            terminal_capacity,
            generation: 0,
            owner_id: NEXT_OWNER.fetch_add(1, Ordering::Relaxed),
        })
    }

    pub fn begin<'a>(
        &self,
        snapshot: ClockSnapshot<'a>,
        facts: SolarFacts<'a>,
    ) -> Result<SolarStage> {
        validate_facts(facts)?;
        if facts.rows.len() > self.terminal_capacity {
            return Err(Error::new(
                "solar fact batch exceeds terminal ledger capacity",
            ));
        }
        let mut engine = self.clone_for_stage();
        let clock = engine.clock.poll(snapshot)?;
        let base_generation = engine.generation;
        let mut result = SolarStageResult {
            site: engine.site,
            due: false,
            decision: SolarDecision::Before,
            observations: Vec::new(),
            unknown_reason: clock.unknown_reason.map(str::to_owned),
        };
        if matches!(clock.disposition, ClockDisposition::BootBaseline) {
            result.decision = SolarDecision::BootBaseline;
            terminalize_past(
                &mut engine,
                facts,
                clock.current_effective_wall_ms,
                &mut result,
            )?;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        if matches!(clock.disposition, ClockDisposition::RecoveryBaseline) {
            result.decision = SolarDecision::RecoveryBaseline;
            terminalize_past(
                &mut engine,
                facts,
                clock.current_effective_wall_ms,
                &mut result,
            )?;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        let Some(previous_wall) = clock.previous_effective_wall_ms else {
            result.decision = SolarDecision::Unknown;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        };
        let Some(current_wall) = clock.current_effective_wall_ms else {
            result.decision = SolarDecision::Unknown;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        };
        if previous_wall < facts.coverage_from_wall_ms || current_wall > facts.coverage_to_wall_ms {
            result.decision = SolarDecision::Unknown;
            result.unknown_reason = Some("IncompleteCoverage".into());
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        let observation_gap = matches!(clock.disposition, ClockDisposition::ObservationGap);
        let mut had_correction = false;
        let mut correction_days = Vec::new();
        if let Some(high_water) = clock.previous_trusted_high_water_ms {
            let corrections: Vec<&SolarFact> = facts
                .rows
                .iter()
                .filter(|fact| !engine.terminal_days.contains(&(fact.source_day, fact.fold)))
                .filter(|fact| fact.availability == SolarFactAvailability::Available)
                .filter(|fact| {
                    fact.scheduled_wall_ms
                        .is_some_and(|at| at <= current_wall && at <= high_water)
                })
                .collect();
            if !corrections.is_empty() {
                ensure_capacity(&engine, corrections.len())?;
                had_correction = true;
                for fact in corrections {
                    correction_days.push((fact.source_day, fact.fold));
                    engine.terminal_days.push((fact.source_day, fact.fold));
                    result
                        .observations
                        .push(observation(fact, SolarDecision::CorrectionPastHighWater));
                }
            }
        }
        let all_crossed: Vec<&SolarFact> = facts
            .rows
            .iter()
            .filter(|fact| fact.availability == SolarFactAvailability::Available)
            .filter(|fact| !correction_days.contains(&(fact.source_day, fact.fold)))
            .filter(|fact| {
                fact.scheduled_wall_ms
                    .is_some_and(|at| at > previous_wall && at <= current_wall)
            })
            .collect();
        if all_crossed.is_empty() {
            result.decision = if had_correction {
                SolarDecision::CorrectionPastHighWater
            } else {
                SolarDecision::Before
            };
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        let crossed: Vec<&SolarFact> = all_crossed
            .iter()
            .copied()
            .filter(|fact| !engine.terminal_days.contains(&(fact.source_day, fact.fold)))
            .collect();
        if crossed.is_empty() {
            result.decision = SolarDecision::AlreadyTerminal;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        if observation_gap {
            ensure_capacity(&engine, crossed.len())?;
            for fact in &crossed {
                engine.terminal_days.push((fact.source_day, fact.fold));
                result
                    .observations
                    .push(observation(fact, SolarDecision::ObservationGap));
            }
            result.decision = SolarDecision::ObservationGap;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        if crossed.len() >= 2 {
            ensure_capacity(&engine, crossed.len())?;
            for fact in crossed {
                engine.terminal_days.push((fact.source_day, fact.fold));
                result
                    .observations
                    .push(observation(fact, SolarDecision::Missed));
            }
            result.decision = SolarDecision::MultipleCrossingsMissed;
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
        let fact = crossed[0];
        if engine.terminal_days.contains(&(fact.source_day, fact.fold)) {
            result.decision = SolarDecision::AlreadyTerminal;
        } else {
            result
                .observations
                .push(observation(fact, SolarDecision::Before));
        }
        Ok(SolarStage {
            engine,
            result,
            base_generation,
            evaluated: false,
        })
    }

    fn clone_for_stage(&self) -> Self {
        Self {
            site: self.site,
            gap_ms: self.gap_ms,
            clock: self.clock.clone(),
            terminal_days: self.terminal_days.clone(),
            terminal_capacity: self.terminal_capacity,
            generation: self.generation,
            owner_id: self.owner_id,
        }
    }

    pub fn commit(&mut self, stage: SolarStage) -> Result<SolarStageResult> {
        if stage.engine.site != self.site || stage.engine.gap_ms != self.gap_ms {
            return Err(Error::new(
                "solar admission stage does not belong to engine",
            ));
        }
        if stage.engine.owner_id != self.owner_id {
            return Err(Error::new(
                "solar admission stage belongs to another engine",
            ));
        }
        if stage.base_generation != self.generation {
            return Err(Error::new("solar admission stage is stale"));
        }
        if !stage.evaluated {
            return Err(Error::new("solar admission predicate was not evaluated"));
        }
        let mut next = stage.engine;
        next.generation = self.generation.saturating_add(1);
        *self = next;
        Ok(stage.result)
    }
}

impl SolarStage {
    pub fn evaluate(mut self, predicate: bool) -> Result<Self> {
        let pending: Vec<usize> = self
            .result
            .observations
            .iter()
            .enumerate()
            .filter_map(|(index, observation)| {
                (observation.decision == SolarDecision::Before).then_some(index)
            })
            .collect();
        if pending.len() != 1 {
            return Ok(self);
        }
        let pending_index = pending[0];
        let row = &self.result.observations[pending_index];
        let day = (row.source_day, row.fold);
        if self.engine.terminal_days.contains(&day) {
            self.result.decision = SolarDecision::AlreadyTerminal;
            self.result.observations[pending_index].decision = SolarDecision::AlreadyTerminal;
            return Ok(self);
        }
        if self.engine.terminal_days.len() >= self.engine.terminal_capacity {
            return Err(Error::new("solar terminal ledger capacity exceeded"));
        }
        self.engine.terminal_days.push(day);
        self.result.due = predicate;
        self.result.decision = if predicate {
            SolarDecision::Due
        } else {
            SolarDecision::ConditionsFalseAtPulse
        };
        self.result.observations[pending_index].decision = self.result.decision;
        self.evaluated = true;
        Ok(self)
    }

    pub fn result(&self) -> &SolarStageResult {
        &self.result
    }
}

fn observation(fact: &SolarFact, decision: SolarDecision) -> SolarObservation {
    SolarObservation {
        source_day: fact.source_day,
        fold: fact.fold,
        scheduled_wall_ms: fact.scheduled_wall_ms,
        decision,
        provider_revision: fact.provider_revision.clone(),
        context_revision: fact.context_revision.clone(),
    }
}

fn terminalize_past(
    engine: &mut SolarPulseEngine,
    facts: SolarFacts<'_>,
    current_wall: Option<u64>,
    result: &mut SolarStageResult,
) -> Result<()> {
    let Some(current_wall) = current_wall else {
        return Ok(());
    };
    let past: Vec<&SolarFact> = facts
        .rows
        .iter()
        .filter(|fact| !engine.terminal_days.contains(&(fact.source_day, fact.fold)))
        .filter(|fact| fact.availability == SolarFactAvailability::Available)
        .filter(|fact| fact.scheduled_wall_ms.is_some_and(|at| at <= current_wall))
        .collect();
    ensure_capacity(engine, past.len())?;
    for fact in past {
        engine.terminal_days.push((fact.source_day, fact.fold));
        result
            .observations
            .push(observation(fact, SolarDecision::Missed));
    }
    Ok(())
}

fn ensure_capacity(engine: &SolarPulseEngine, additions: usize) -> Result<()> {
    if engine.terminal_days.len().saturating_add(additions) > engine.terminal_capacity {
        return Err(Error::new("solar terminal ledger capacity exceeded"));
    }
    Ok(())
}

fn validate_facts(facts: SolarFacts<'_>) -> Result<()> {
    if facts.coverage_from_wall_ms > facts.coverage_to_wall_ms {
        return Err(Error::new("solar fact coverage is reversed"));
    }
    let mut previous = None;
    for fact in facts.rows {
        if !(0..=MAX_SOURCE_DAY).contains(&fact.source_day) {
            return Err(Error::new("solar fact source day is out of range"));
        }
        if fact.fold > 2 {
            return Err(Error::new("invalid occurrence fold"));
        }
        if fact.availability == SolarFactAvailability::Available && fact.scheduled_wall_ms.is_none()
        {
            return Err(Error::new("available solar fact has no scheduled time"));
        }
        if fact.provider_revision.is_empty() || fact.context_revision.is_empty() {
            return Err(Error::new("solar fact revision is empty"));
        }
        if let Some(at) = fact.scheduled_wall_ms {
            if at > MAX_WALL_MS {
                return Err(Error::new("solar fact wall time is out of range"));
            }
            if at < facts.coverage_from_wall_ms || at > facts.coverage_to_wall_ms {
                return Err(Error::new("solar fact is outside coverage"));
            }
        }
        if previous.is_some_and(|day| day >= (fact.source_day, fact.fold)) {
            return Err(Error::new("solar facts must be ordered by source day"));
        }
        previous = Some((fact.source_day, fact.fold));
    }
    Ok(())
}
