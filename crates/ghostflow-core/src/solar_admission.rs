//! Bounded, staged Solar pulse admission.
//!
//! This is the first Rust-owned admission slice. It consumes provider facts but
//! never accepts a caller-computed `due` bit. Provider truth, IANA conversion,
//! and durable package identity remain outside this component.

use crate::schedule_clock::{ClockDisposition, ClockProvenance, ClockSnapshot, ScheduleClockGate};
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
    pub fallback_wall_ms: Option<u64>,
    pub unavailable_reason: Option<u8>,
    pub source_day: i32,
    /// Stable slot key within a DailySlots definition; zero for other schedules.
    pub slot_key: u16,
    /// Declared civil minute; zero for other schedules.
    pub minute_of_day: u16,
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
            fallback_wall_ms: None,
            unavailable_reason: None,
            source_day,
            slot_key: 0,
            minute_of_day: 0,
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
    pub fallback: bool,
    pub unavailable_reason: Option<u8>,
    pub source_day: i32,
    pub slot_key: u16,
    pub minute_of_day: u16,
    pub fold: u8,
    pub scheduled_wall_ms: Option<u64>,
    pub decision: SolarDecision,
    pub provider_revision: String,
    pub context_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolarStageResult {
    pub clock_provenance: ClockProvenance,
    pub clock_uncertainty_ms: Option<u64>,
    pub site: u32,
    pub due: bool,
    pub decision: SolarDecision,
    pub observations: Vec<SolarObservation>,
    pub unknown_reason: Option<String>,
}

#[derive(Debug)]
pub struct SolarPulseEngine {
    clock_hold_ms: Option<u64>,
    fallback_time_ms: Option<u64>,
    fallback_utc: bool,
    site: u32,
    gap_ms: u64,
    clock: ScheduleClockGate,
    terminal_days: Vec<(i32, u16, u8)>,
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
    pub(crate) fn terminal_identities(&self) -> &[(i32, u16, u8)] {
        &self.terminal_days
    }

    pub(crate) fn restore_solar_identities(&mut self, days: Vec<(i32, u16, u8)>) -> Result<()> {
        if days.len() > self.terminal_capacity
            || days.iter().any(|(day, slot, fold)| {
                !(0..=MAX_SOURCE_DAY).contains(day) || *slot != 0 || *fold != 0
            })
            || days.iter().collect::<std::collections::BTreeSet<_>>().len() != days.len()
        {
            return Err(Error::new("invalid solar checkpoint terminal identities"));
        }
        self.terminal_days = days;
        Ok(())
    }

    pub fn new(site: u32, gap_ms: u64, boot_epoch: u64, terminal_capacity: usize) -> Result<Self> {
        if site == 0 || terminal_capacity == 0 || terminal_capacity > MAX_TERMINAL_CAPACITY {
            return Err(Error::new("invalid solar admission configuration"));
        }
        Ok(Self {
            clock_hold_ms: None,
            fallback_time_ms: None,
            fallback_utc: false,
            site,
            gap_ms,
            clock: ScheduleClockGate::new(gap_ms, boot_epoch)?,
            terminal_days: Vec::with_capacity(terminal_capacity),
            terminal_capacity,
            generation: 0,
            owner_id: NEXT_OWNER.fetch_add(1, Ordering::Relaxed),
        })
    }

    pub fn with_policy(
        mut self,
        clock_hold_ms: Option<u64>,
        fallback_time_ms: Option<u64>,
    ) -> Result<Self> {
        if clock_hold_ms.is_some_and(|v| v == 0 || v > 9_007_199_254_740_991)
            || fallback_time_ms.is_some_and(|v| v >= 86_400_000)
        {
            return Err(Error::new("invalid natural availability policy"));
        }
        self.clock_hold_ms = clock_hold_ms;
        self.fallback_time_ms = fallback_time_ms;
        Ok(self)
    }

    pub fn begin<'a>(
        &self,
        snapshot: ClockSnapshot<'a>,
        facts: SolarFacts<'a>,
    ) -> Result<SolarStage> {
        self.begin_with_unknown(snapshot, facts, None)
    }

    pub fn with_fallback_timezone(mut self, timezone: &str) -> Self {
        self.fallback_utc = matches!(timezone, "UTC" | "Etc/UTC");
        self
    }

    pub(crate) fn begin_with_unknown<'a>(
        &self,
        snapshot: ClockSnapshot<'a>,
        facts: SolarFacts<'a>,
        unknown_reason: Option<&str>,
    ) -> Result<SolarStage> {
        validate_facts(facts)?;
        if self.fallback_utc
            && facts.rows.iter().any(|row| {
                row.fallback_wall_ms.is_some_and(|at| {
                    at / 86_400_000 != row.source_day as u64
                        || Some(at % 86_400_000) != self.fallback_time_ms
                })
            })
        {
            return Err(Error::new("fallback fact violates civil descriptor"));
        }
        if facts
            .rows
            .iter()
            .any(|row| row.fallback_wall_ms.is_some() && self.fallback_time_ms.is_none())
        {
            return Err(Error::new("fallback fact requires explicit policy"));
        }
        let normalized_rows: Vec<_> = facts
            .rows
            .iter()
            .cloned()
            .map(|mut row| {
                if row.availability == SolarFactAvailability::Unavailable
                    && self.fallback_time_ms.is_some()
                {
                    row.scheduled_wall_ms = row.fallback_wall_ms;
                    if row.scheduled_wall_ms.is_some() {
                        row.availability = SolarFactAvailability::Available;
                    }
                }
                row
            })
            .collect();
        let facts = SolarFacts {
            rows: &normalized_rows,
            ..facts
        };
        if facts.rows.len() > self.terminal_capacity {
            return Err(Error::new(
                "solar fact batch exceeds terminal ledger capacity",
            ));
        }
        let mut engine = self.clone_for_stage();
        let policy_clock = engine
            .clock
            .poll_with_hold(snapshot, engine.clock_hold_ms)?;
        let clock = policy_clock.observation;
        let base_generation = engine.generation;
        let mut result = SolarStageResult {
            clock_provenance: policy_clock.provenance,
            clock_uncertainty_ms: clock.uncertainty_ms,
            site: engine.site,
            due: false,
            decision: SolarDecision::Before,
            observations: Vec::new(),
            unknown_reason: clock.unknown_reason.map(str::to_owned),
        };
        if clock.current_effective_wall_ms.is_some() {
            for row in facts.rows.iter().filter(|row| {
                row.availability == SolarFactAvailability::Unavailable
                    && row.unavailable_reason.is_some()
            }) {
                result
                    .observations
                    .push(observation(row, SolarDecision::Unknown));
            }
        }
        if let Some(reason) = unknown_reason {
            result.decision = SolarDecision::Unknown;
            result.unknown_reason = Some(clock.unknown_reason.unwrap_or(reason).to_owned());
            return Ok(SolarStage {
                engine,
                result,
                base_generation,
                evaluated: true,
            });
        }
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
                .filter(|fact| !engine.terminal_days.contains(&identity(fact)))
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
                    correction_days.push(identity(fact));
                    engine.terminal_days.push(identity(fact));
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
            .filter(|fact| !correction_days.contains(&identity(fact)))
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
            .filter(|fact| !engine.terminal_days.contains(&identity(fact)))
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
                engine.terminal_days.push(identity(fact));
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
                engine.terminal_days.push(identity(fact));
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
        if engine.terminal_days.contains(&identity(fact)) {
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
            clock_hold_ms: self.clock_hold_ms,
            fallback_time_ms: self.fallback_time_ms,
            fallback_utc: self.fallback_utc,
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
        let day = (row.source_day, row.slot_key, row.fold);
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
        fallback: fact.fallback_wall_ms.is_some(),
        unavailable_reason: fact.unavailable_reason,
        source_day: fact.source_day,
        slot_key: fact.slot_key,
        minute_of_day: fact.minute_of_day,
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
        .filter(|fact| !engine.terminal_days.contains(&identity(fact)))
        .filter(|fact| fact.availability == SolarFactAvailability::Available)
        .filter(|fact| fact.scheduled_wall_ms.is_some_and(|at| at <= current_wall))
        .collect();
    ensure_capacity(engine, past.len())?;
    for fact in past {
        engine.terminal_days.push(identity(fact));
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
    if facts.coverage_to_wall_ms > MAX_WALL_MS {
        return Err(Error::new("solar coverage out of range"));
    }
    let mut previous = None;
    for fact in facts.rows {
        if !(0..=MAX_SOURCE_DAY).contains(&fact.source_day) {
            return Err(Error::new("solar fact source day is out of range"));
        }
        if fact.unavailable_reason.is_some_and(|reason| reason > 5)
            || (fact.availability == SolarFactAvailability::Available
                && (fact.fallback_wall_ms.is_some() || fact.unavailable_reason.is_some()))
            || (fact.availability == SolarFactAvailability::Unavailable
                && fact.scheduled_wall_ms.is_some())
        {
            return Err(Error::new("invalid solar availability fact"));
        }
        if let Some(at) = fact.fallback_wall_ms {
            if at > MAX_WALL_MS
                || at < facts.coverage_from_wall_ms
                || at > facts.coverage_to_wall_ms
            {
                return Err(Error::new("fallback fact outside coverage"));
            }
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
        if previous.is_some_and(|key| key >= identity(fact)) {
            return Err(Error::new("solar facts must be ordered by source day"));
        }
        previous = Some(identity(fact));
    }
    Ok(())
}

fn identity(fact: &SolarFact) -> (i32, u16, u8) {
    (fact.source_day, fact.slot_key, fact.fold)
}

#[cfg(test)]
mod natural_policy_tests {
    use super::*;
    use crate::schedule_clock::ClockTrust;
    fn clock(now: u64, wall: u64, trusted: bool) -> ClockSnapshot<'static> {
        ClockSnapshot {
            monotonic_ms: now,
            boot_epoch: 7,
            wall_ms: Some(wall),
            trust: if trusted {
                ClockTrust::Trusted
            } else {
                ClockTrust::Unknown("TrustExpired")
            },
            uncertainty_ms: Some(2),
            source_revision: Some("rtc-v1"),
        }
    }
    fn fallback() -> SolarFact {
        SolarFact {
            source_day: 0,
            slot_key: 0,
            minute_of_day: 0,
            fold: 0,
            scheduled_wall_ms: None,
            fallback_wall_ms: Some(21_600_000),
            unavailable_reason: Some(2),
            provider_revision: "solar-v1".into(),
            context_revision: "site-v1".into(),
            availability: SolarFactAvailability::Unavailable,
        }
    }
    fn facts(rows: &[SolarFact]) -> SolarFacts<'_> {
        SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: 86_400_000,
            rows,
        }
    }
    fn commit(
        engine: &mut SolarPulseEngine,
        snapshot: ClockSnapshot<'_>,
        rows: &[SolarFact],
        predicate: bool,
    ) -> SolarStageResult {
        let stage = engine
            .begin(snapshot, facts(rows))
            .unwrap()
            .evaluate(predicate)
            .unwrap();
        engine.commit(stage).unwrap()
    }
    #[test]
    fn held_fallback_consumes_event_identity_and_restart_keeps_it() {
        let mut engine = SolarPulseEngine::new(1, 60_000, 7, 16)
            .unwrap()
            .with_policy(Some(2_000), Some(21_600_000))
            .unwrap()
            .with_fallback_timezone("UTC");
        let rows = [fallback()];
        assert_eq!(
            commit(&mut engine, clock(0, 21_599_000, true), &rows, true).decision,
            SolarDecision::BootBaseline
        );
        let held = commit(&mut engine, clock(1_000, 0, false), &rows, true);
        assert!(held.due);
        assert!(held.observations[0].fallback);
        assert_eq!(held.observations[0].unavailable_reason, Some(2));
        assert!(matches!(
            held.clock_provenance,
            ClockProvenance::HeldClock { .. }
        ));
        let expired = commit(&mut engine, clock(2_000, 0, false), &rows, true);
        assert!(!expired.due);
        assert_eq!(expired.unknown_reason.as_deref(), Some("TrustExpired"));
        let recovered = [SolarFact::available(0, 21_602_000, "solar-v2", "site-v1")];
        assert!(
            !commit(
                &mut engine,
                clock(3_000, 21_602_000, true),
                &recovered,
                true
            )
            .due
        );
        assert!(
            !commit(
                &mut engine,
                clock(4_000, 21_603_000, true),
                &recovered,
                true
            )
            .due
        );
        let mut restart = SolarPulseEngine::new(1, 60_000, 7, 16)
            .unwrap()
            .with_policy(Some(2_000), Some(21_600_000))
            .unwrap();
        restart
            .restore_solar_identities(engine.terminal_days.clone())
            .unwrap();
        assert!(!commit(&mut restart, clock(0, 21_599_000, true), &rows, true).due);
        assert_eq!(
            commit(&mut restart, clock(1_000, 21_600_000, true), &rows, true).decision,
            SolarDecision::AlreadyTerminal
        );
    }
    #[test]
    fn fallback_needs_clock_and_rejects_retiming_atomically() {
        let mut engine = SolarPulseEngine::new(1, 60_000, 7, 16)
            .unwrap()
            .with_policy(None, Some(21_600_000))
            .unwrap()
            .with_fallback_timezone("UTC");
        let rows = [fallback()];
        assert!(!commit(&mut engine, clock(0, 0, false), &rows, true).due);
        commit(&mut engine, clock(1_000, 21_599_000, true), &rows, true);
        let mut invalid = rows.clone();
        invalid[0].fallback_wall_ms = Some(21_600_001);
        assert!(engine
            .begin(clock(2_000, 21_600_000, true), facts(&invalid))
            .is_err());
        assert!(engine.terminal_days.is_empty());
        assert!(commit(&mut engine, clock(2_000, 21_600_000, true), &rows, true).due);
        let legacy = SolarPulseEngine::new(1, 60_000, 7, 16).unwrap();
        assert!(legacy.begin(clock(0, 0, true), facts(&rows)).is_err());
    }
    #[test]
    fn false_predicate_and_correction_are_terminal() {
        let mut engine = SolarPulseEngine::new(1, 60_000, 7, 16)
            .unwrap()
            .with_policy(None, Some(21_600_000))
            .unwrap();
        let rows = [fallback()];
        commit(&mut engine, clock(0, 21_599_000, true), &rows, true);
        assert_eq!(
            commit(&mut engine, clock(1_000, 21_600_000, true), &rows, false).decision,
            SolarDecision::ConditionsFalseAtPulse
        );
        assert!(!commit(&mut engine, clock(2_000, 21_600_001, true), &rows, true).due);
        let mut fresh = SolarPulseEngine::new(1, 60_000, 7, 16)
            .unwrap()
            .with_policy(None, Some(21_600_000))
            .unwrap();
        commit(&mut fresh, clock(0, 21_601_000, true), &[], true);
        assert_eq!(
            commit(&mut fresh, clock(1_000, 21_602_000, true), &rows, true).decision,
            SolarDecision::CorrectionPastHighWater
        );
    }

    #[test]
    fn unavailable_future_without_instant_does_not_consume_recovered_event() {
        let mut engine = SolarPulseEngine::new(1, 60_000, 7, 16)
            .unwrap()
            .with_policy(None, Some(21_600_000))
            .unwrap();
        let mut missing = fallback();
        missing.fallback_wall_ms = None;
        let rows = [missing];
        let unknown = commit(&mut engine, clock(0, 21_598_000, true), &rows, true);
        assert_eq!(unknown.observations[0].decision, SolarDecision::Unknown);
        assert!(engine.terminal_days.is_empty());
        let recovered = [SolarFact::available(0, 21_600_000, "solar-v2", "site-v1")];
        assert!(
            !commit(
                &mut engine,
                clock(1_000, 21_599_000, true),
                &recovered,
                true
            )
            .due
        );
        assert!(
            commit(
                &mut engine,
                clock(2_000, 21_600_000, true),
                &recovered,
                true
            )
            .due
        );
    }
}
