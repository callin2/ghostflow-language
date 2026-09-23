//! Native admission for a `DailySlots<15min>` schedule.
//!
//! This module deliberately consumes occurrence facts from a host/provider. It
//! does not convert an IANA timezone or invent a local occurrence from a caller
//! supplied `due` bit. The provider supplies the local date, slot, and planned
//! instant; the engine owns the trusted clock gate and the durable occurrence
//! identity ledger.

use crate::schedule_clock::{ClockDisposition, ClockSnapshot, ScheduleClockGate};
use crate::{Error, Result};

const MAX_WALL_MS: u64 = 253_402_300_799_999;
const MAX_OCCURRENCE_KEY: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DailySlotAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DailySlotFact {
    /// Stable provider occurrence identity. It must not be derived from a
    /// mutable planned instant alone.
    pub occurrence_key: String,
    pub local_date: String,
    pub minute_of_day: u16,
    pub scheduled_wall_ms: Option<u64>,
    pub provider_revision: String,
    pub context_revision: String,
    pub availability: DailySlotAvailability,
}

impl DailySlotFact {
    pub fn available(
        occurrence_key: &str,
        local_date: &str,
        minute_of_day: u16,
        scheduled_wall_ms: u64,
        provider_revision: &str,
        context_revision: &str,
    ) -> Self {
        Self {
            occurrence_key: occurrence_key.to_owned(),
            local_date: local_date.to_owned(),
            minute_of_day,
            scheduled_wall_ms: Some(scheduled_wall_ms),
            provider_revision: provider_revision.to_owned(),
            context_revision: context_revision.to_owned(),
            availability: DailySlotAvailability::Available,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct DailySlotsFacts<'a> {
    pub coverage_from_wall_ms: u64,
    pub coverage_to_wall_ms: u64,
    pub rows: &'a [DailySlotFact],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DailySlotDecision {
    BootBaseline,
    RecoveryBaseline,
    Due,
    ConditionsFalseAtPulse,
    AlreadyTerminal,
    Missed,
    MultipleCrossingsMissed,
    ObservationGap,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DailySlotObservation {
    pub occurrence_key: String,
    pub local_date: String,
    pub minute_of_day: u16,
    pub scheduled_wall_ms: Option<u64>,
    pub decision: DailySlotDecision,
    pub provider_revision: String,
    pub context_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DailySlotsStageResult {
    pub due: bool,
    pub decision: DailySlotDecision,
    pub observations: Vec<DailySlotObservation>,
}

#[derive(Clone, Debug)]
pub struct DailySlotsEngine {
    selected_slots: Vec<u16>,
    clock: ScheduleClockGate,
    terminal_keys: Vec<String>,
    terminal_capacity: usize,
}

#[derive(Clone, Debug)]
pub struct DailySlotsStage {
    engine: DailySlotsEngine,
    pub result: DailySlotsStageResult,
}

impl DailySlotsEngine {
    pub fn new(
        selected_slots: &[u16],
        gap_ms: u64,
        boot_epoch: u64,
        terminal_capacity: usize,
    ) -> Result<Self> {
        if selected_slots.is_empty()
            || selected_slots.len() > 96
            || selected_slots
                .iter()
                .any(|slot| *slot >= 1_440 || slot % 15 != 0)
            || selected_slots.windows(2).any(|pair| pair[0] >= pair[1])
            || terminal_capacity == 0
        {
            return Err(Error::new("invalid DailySlots configuration"));
        }
        Ok(Self {
            selected_slots: selected_slots.to_vec(),
            clock: ScheduleClockGate::new(gap_ms, boot_epoch)?,
            terminal_keys: Vec::with_capacity(terminal_capacity),
            terminal_capacity,
        })
    }

    pub fn begin<'a>(
        &self,
        snapshot: ClockSnapshot<'a>,
        facts: DailySlotsFacts<'a>,
    ) -> Result<DailySlotsStage> {
        validate_facts(facts)?;
        if facts.rows.len() > self.terminal_capacity {
            return Err(Error::new(
                "DailySlots fact batch exceeds terminal ledger capacity",
            ));
        }
        let mut engine = self.clone();
        let clock = engine.clock.poll(snapshot)?;
        let mut result = DailySlotsStageResult {
            due: false,
            decision: DailySlotDecision::Unknown,
            observations: Vec::new(),
        };

        let terminalize = |engine: &mut DailySlotsEngine,
                           row: &DailySlotFact,
                           decision: DailySlotDecision,
                           result: &mut DailySlotsStageResult|
         -> Result<()> {
            if !engine
                .terminal_keys
                .iter()
                .any(|key| key == &row.occurrence_key)
            {
                if engine.terminal_keys.len() == engine.terminal_capacity {
                    return Err(Error::new("DailySlots terminal ledger capacity exceeded"));
                }
                engine.terminal_keys.push(row.occurrence_key.clone());
            }
            result.observations.push(DailySlotObservation {
                occurrence_key: row.occurrence_key.clone(),
                local_date: row.local_date.clone(),
                minute_of_day: row.minute_of_day,
                scheduled_wall_ms: row.scheduled_wall_ms,
                decision,
                provider_revision: row.provider_revision.clone(),
                context_revision: row.context_revision.clone(),
            });
            Ok(())
        };

        let current_wall = clock.current_effective_wall_ms;
        let previous_wall = clock.previous_effective_wall_ms;
        if matches!(
            clock.disposition,
            ClockDisposition::BootBaseline | ClockDisposition::RecoveryBaseline
        ) {
            result.decision = if clock.disposition == ClockDisposition::BootBaseline {
                DailySlotDecision::BootBaseline
            } else {
                DailySlotDecision::RecoveryBaseline
            };
            for row in facts.rows.iter().filter(|row| {
                row.scheduled_wall_ms
                    .is_some_and(|at| Some(at) <= current_wall)
            }) {
                terminalize(&mut engine, row, DailySlotDecision::Missed, &mut result)?;
            }
            return Ok(DailySlotsStage { engine, result });
        }
        if matches!(clock.disposition, ClockDisposition::ClockUnknown) || current_wall.is_none() {
            result.decision = DailySlotDecision::Unknown;
            return Ok(DailySlotsStage { engine, result });
        }
        if matches!(clock.disposition, ClockDisposition::ObservationGap)
            || previous_wall.is_none()
            || facts.coverage_from_wall_ms > previous_wall.unwrap()
            || facts.coverage_to_wall_ms < current_wall.unwrap()
        {
            result.decision = DailySlotDecision::ObservationGap;
            return Ok(DailySlotsStage { engine, result });
        }

        let previous = previous_wall.unwrap();
        let current = current_wall.unwrap();
        let candidates: Vec<&DailySlotFact> = facts
            .rows
            .iter()
            .filter(|row| row.availability == DailySlotAvailability::Available)
            .filter(|row| engine.selected_slots.contains(&row.minute_of_day))
            .filter(|row| {
                row.scheduled_wall_ms
                    .is_some_and(|at| at > previous && at <= current)
            })
            .collect();
        if candidates.len() > 1 {
            result.decision = DailySlotDecision::MultipleCrossingsMissed;
            for row in candidates {
                terminalize(&mut engine, row, DailySlotDecision::Missed, &mut result)?;
            }
        } else if let Some(row) = candidates.first() {
            if engine
                .terminal_keys
                .iter()
                .any(|key| key == &row.occurrence_key)
            {
                result.decision = DailySlotDecision::AlreadyTerminal;
                result.observations.push(DailySlotObservation {
                    occurrence_key: row.occurrence_key.clone(),
                    local_date: row.local_date.clone(),
                    minute_of_day: row.minute_of_day,
                    scheduled_wall_ms: row.scheduled_wall_ms,
                    decision: DailySlotDecision::AlreadyTerminal,
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
            } else {
                result.decision = DailySlotDecision::Due;
                result.due = true;
                terminalize(&mut engine, row, DailySlotDecision::Due, &mut result)?;
            }
        } else {
            result.decision = DailySlotDecision::Missed;
        }
        Ok(DailySlotsStage { engine, result })
    }

    pub fn commit(&mut self, stage: DailySlotsStage) {
        *self = stage.engine;
    }
}

fn validate_facts(facts: DailySlotsFacts<'_>) -> Result<()> {
    if facts.coverage_from_wall_ms > facts.coverage_to_wall_ms
        || facts.coverage_to_wall_ms > MAX_WALL_MS
    {
        return Err(Error::new("invalid DailySlots fact coverage"));
    }
    let mut keys = std::collections::BTreeSet::new();
    for row in facts.rows {
        if row.occurrence_key.is_empty() || row.occurrence_key.len() > MAX_OCCURRENCE_KEY {
            return Err(Error::new("invalid DailySlots occurrence key"));
        }
        if !keys.insert(&row.occurrence_key) {
            return Err(Error::new("duplicate DailySlots occurrence key"));
        }
        if row.local_date.len() != 10
            || row.local_date.as_bytes().get(4) != Some(&b'-')
            || row.local_date.as_bytes().get(7) != Some(&b'-')
            || row.minute_of_day >= 1_440
        {
            return Err(Error::new("invalid DailySlots local occurrence"));
        }
        if row.scheduled_wall_ms.is_some_and(|at| at > MAX_WALL_MS) {
            return Err(Error::new("DailySlots scheduled wall time is out of range"));
        }
        if row.provider_revision.len() > MAX_OCCURRENCE_KEY
            || row.context_revision.len() > MAX_OCCURRENCE_KEY
        {
            return Err(Error::new("DailySlots revision exceeds limit"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule_clock::{ClockSnapshot, ClockTrust};

    fn clock(monotonic_ms: u64, wall_ms: u64) -> ClockSnapshot<'static> {
        ClockSnapshot {
            monotonic_ms,
            boot_epoch: 7,
            wall_ms: Some(wall_ms),
            trust: ClockTrust::Trusted,
            uncertainty_ms: None,
            source_revision: Some("clock-r1"),
        }
    }

    #[test]
    fn boot_baseline_misses_past_and_next_crossing_is_due_once() {
        let mut engine = DailySlotsEngine::new(&[360], 60_000, 7, 8).unwrap();
        let past =
            DailySlotFact::available("2026-09-05/0360", "2026-09-05", 360, 1_000, "p1", "c1");
        let stage = engine
            .begin(
                clock(0, 1_000),
                DailySlotsFacts {
                    coverage_from_wall_ms: 0,
                    coverage_to_wall_ms: 2_000,
                    rows: &[past],
                },
            )
            .unwrap();
        assert_eq!(stage.result.decision, DailySlotDecision::BootBaseline);
        engine.commit(stage);
        let next =
            DailySlotFact::available("2026-09-06/0360", "2026-09-06", 360, 2_000, "p1", "c1");
        let next_rows = [next];
        let stage = engine
            .begin(
                clock(1_000, 2_000),
                DailySlotsFacts {
                    coverage_from_wall_ms: 1_000,
                    coverage_to_wall_ms: 2_000,
                    rows: &next_rows,
                },
            )
            .unwrap();
        assert!(stage.result.due);
        engine.commit(stage);
        let stage = engine
            .begin(
                clock(2_000, 2_001),
                DailySlotsFacts {
                    coverage_from_wall_ms: 2_000,
                    coverage_to_wall_ms: 2_001,
                    rows: &next_rows,
                },
            )
            .unwrap();
        assert_eq!(stage.result.decision, DailySlotDecision::Missed);
    }

    #[test]
    fn large_gap_and_multiple_crossings_are_missed_without_due() {
        let mut engine = DailySlotsEngine::new(&[360, 375], 60_000, 7, 8).unwrap();
        let rows = [
            DailySlotFact::available("a", "2026-09-05", 360, 2_000, "p", "c"),
            DailySlotFact::available("b", "2026-09-05", 375, 2_001, "p", "c"),
        ];
        engine.commit(
            engine
                .begin(
                    clock(0, 1_000),
                    DailySlotsFacts {
                        coverage_from_wall_ms: 0,
                        coverage_to_wall_ms: 1_000,
                        rows: &[],
                    },
                )
                .unwrap(),
        );
        let stage = engine
            .begin(
                clock(60_001, 2_001),
                DailySlotsFacts {
                    coverage_from_wall_ms: 1_000,
                    coverage_to_wall_ms: 2_001,
                    rows: &rows,
                },
            )
            .unwrap();
        assert!(!stage.result.due);
        assert_eq!(stage.result.decision, DailySlotDecision::ObservationGap);
    }
}
