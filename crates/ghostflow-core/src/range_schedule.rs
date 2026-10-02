//! Planned-time Range basis for native schedule bindings.
//!
//! Trigger providers supply stable identities and planned intervals; they do not
//! supply admission or active bits. Like DailySlots, this engine stages changes
//! against the shared trusted-clock gate for an outer accepted transaction.
//! Safety arbitration consumes `active` downstream and never pauses this clock.

use crate::schedule_clock::{ClockDisposition, ClockSnapshot, ScheduleClockGate, MAX_EXACT_TIME};
use crate::{Error, Result};

const MAX_WALL_MS: u64 = 253_402_300_799_999;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeFact {
    /// Stable source identity, independent of planned time and revisions.
    pub occurrence_key: String,
    pub planned_wall_ms: u64,
    pub duration_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RangeDecision {
    Waiting,
    ClockUnknown,
    Admitted,
    Active,
    Completed,
    Cancelled,
    LateStartExpired,
    AlreadyTerminal,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RangeStageResult {
    pub due: bool,
    pub active: bool,
    pub occurrence_key: Option<String>,
    pub deadline_monotonic_ms: Option<u64>,
    pub decision: RangeDecision,
}

#[derive(Clone, Debug)]
struct ActiveRange {
    fact: RangeFact,
    deadline_monotonic_ms: u64,
    admitted_wall_ms: u64,
    admitted_monotonic_ms: u64,
    paused: bool,
}

#[derive(Clone, Debug)]
pub struct RangeEngine {
    clock: ScheduleClockGate,
    active: Option<ActiveRange>,
    terminal_keys: Vec<String>,
    terminal_capacity: usize,
}

#[derive(Clone, Debug)]
pub struct RangeStage {
    engine: RangeEngine,
    pub result: RangeStageResult,
    pub clock_disposition: ClockDisposition,
}

impl RangeEngine {
    pub(crate) fn terminal_keys(&self) -> &[String] {
        &self.terminal_keys
    }

    pub(crate) fn active_fact(&self) -> Option<&RangeFact> {
        self.active.as_ref().map(|active| &active.fact)
    }

    /// Durable keys consume admitted, cancelled and expired occurrences. A new
    /// boot gets a fresh gate and no active timer; restoration never resumes a
    /// previously admitted interval or emits a second admission pulse.
    pub(crate) fn restore_terminal_keys(&mut self, keys: Vec<String>) -> Result<()> {
        if keys.len() > self.terminal_capacity
            || keys.iter().any(|key| key.is_empty() || key.len() > 128)
            || keys
                .iter()
                .enumerate()
                .any(|(i, key)| keys[..i].contains(key))
        {
            return Err(Error::new("invalid Range terminal checkpoint keys"));
        }
        self.terminal_keys = keys;
        self.active = None;
        Ok(())
    }
    pub fn new(gap_ms: u64, boot_epoch: u64, terminal_capacity: usize) -> Result<Self> {
        if !(1..=4096).contains(&terminal_capacity) {
            return Err(Error::new("invalid Range ledger capacity"));
        }
        Ok(Self {
            clock: ScheduleClockGate::new(gap_ms, boot_epoch)?,
            active: None,
            terminal_keys: Vec::with_capacity(terminal_capacity),
            terminal_capacity,
        })
    }

    /// Stage a tick for one schedule. Facts may include expired occurrences,
    /// but only the currently open interval can admit. Admitted plans are frozen;
    /// provider revisions are not live setting events.
    pub fn begin(
        &self,
        snapshot: ClockSnapshot<'_>,
        facts: &[RangeFact],
        when: bool,
        cancel_when: bool,
    ) -> Result<RangeStage> {
        self.stage(snapshot, facts, when, cancel_when, false)
    }

    /// Stage effective plans from an atomic settings event. Stable source keys
    /// must survive edits, including changes to selected slot times. Supply all
    /// affected plans so overlap validation covers the complete event.
    pub fn begin_retime(
        &self,
        snapshot: ClockSnapshot<'_>,
        facts: &[RangeFact],
        when: bool,
        cancel_when: bool,
    ) -> Result<RangeStage> {
        self.stage(snapshot, facts, when, cancel_when, true)
    }

    fn stage(
        &self,
        snapshot: ClockSnapshot<'_>,
        facts: &[RangeFact],
        when: bool,
        cancel_when: bool,
        retime: bool,
    ) -> Result<RangeStage> {
        self.validate_facts(facts, retime)?;
        let mut engine = self.clone();
        let clock = engine.clock.poll(snapshot)?;
        let mut result = RangeStageResult {
            due: false,
            active: false,
            occurrence_key: None,
            deadline_monotonic_ms: None,
            decision: RangeDecision::Waiting,
        };
        if let Some(active) = &mut engine.active {
            let stable_wall_ms =
                active.admitted_wall_ms + (snapshot.monotonic_ms - active.admitted_monotonic_ms);
            // Provider refreshes and wall corrections cannot retime admission.
            // At the exact endpoint an event ordered before the scan can still
            // extend the interval. A later event cannot revive elapsed time.
            if retime && snapshot.monotonic_ms <= active.deadline_monotonic_ms {
                if let Some(changed) = facts
                    .iter()
                    .find(|fact| fact.occurrence_key == active.fact.occurrence_key)
                {
                    let end = changed.planned_wall_ms + changed.duration_ms;
                    active.deadline_monotonic_ms = snapshot
                        .monotonic_ms
                        .checked_add(end.saturating_sub(stable_wall_ms))
                        .filter(|deadline| *deadline <= MAX_EXACT_TIME)
                        .ok_or_else(|| Error::new("Range monotonic deadline is out of range"))?;
                    active.fact = changed.clone();
                    active.paused |= stable_wall_ms < changed.planned_wall_ms;
                }
            }
            result.occurrence_key = Some(active.fact.occurrence_key.clone());
            result.deadline_monotonic_ms = Some(active.deadline_monotonic_ms);
            if snapshot.monotonic_ms >= active.deadline_monotonic_ms {
                result.decision = RangeDecision::Completed;
            } else if cancel_when {
                result.decision = RangeDecision::Cancelled;
            } else {
                if active.paused
                    && stable_wall_ms >= active.fact.planned_wall_ms
                    && clock.current_effective_wall_ms.is_some()
                    && when
                {
                    active.paused = false;
                }
                result.active = !active.paused;
                result.decision = if result.active {
                    RangeDecision::Active
                } else if clock.current_effective_wall_ms.is_none() {
                    RangeDecision::ClockUnknown
                } else {
                    RangeDecision::Waiting
                };
                return Ok(RangeStage {
                    engine,
                    result,
                    clock_disposition: clock.disposition,
                });
            }
            engine.active = None;
        }
        let Some(wall_ms) = clock.current_effective_wall_ms else {
            if result.occurrence_key.is_none() {
                result.decision = RangeDecision::ClockUnknown;
            }
            return Ok(RangeStage {
                engine,
                result,
                clock_disposition: clock.disposition,
            });
        };
        for fact in facts {
            if engine.terminal_keys.contains(&fact.occurrence_key) {
                if result.occurrence_key.is_none() {
                    result.decision = RangeDecision::AlreadyTerminal;
                }
                continue;
            }
            if wall_ms < fact.planned_wall_ms {
                continue;
            }
            let end = fact.planned_wall_ms + fact.duration_ms;
            if wall_ms >= end {
                engine.retain(&fact.occurrence_key)?;
                result.decision = RangeDecision::LateStartExpired;
                continue;
            }
            if cancel_when {
                engine.retain(&fact.occurrence_key)?;
                result.decision = RangeDecision::Cancelled;
                continue;
            }
            if !when {
                continue;
            }
            let deadline = snapshot
                .monotonic_ms
                .checked_add(end - wall_ms)
                .filter(|deadline| *deadline <= MAX_EXACT_TIME)
                .ok_or_else(|| Error::new("Range monotonic deadline is out of range"))?;
            engine.retain(&fact.occurrence_key)?;
            engine.active = Some(ActiveRange {
                fact: fact.clone(),
                deadline_monotonic_ms: deadline,
                admitted_wall_ms: wall_ms,
                admitted_monotonic_ms: snapshot.monotonic_ms,
                paused: false,
            });
            result = RangeStageResult {
                due: true,
                active: true,
                occurrence_key: Some(fact.occurrence_key.clone()),
                deadline_monotonic_ms: Some(deadline),
                decision: RangeDecision::Admitted,
            };
            break;
        }
        Ok(RangeStage {
            engine,
            result,
            clock_disposition: clock.disposition,
        })
    }

    pub fn commit(&mut self, stage: RangeStage) {
        *self = stage.engine;
    }

    fn retain(&mut self, key: &str) -> Result<()> {
        if self.terminal_keys.len() == self.terminal_capacity {
            return Err(Error::new("Range terminal ledger capacity exceeded"));
        }
        self.terminal_keys.push(key.to_owned());
        Ok(())
    }

    fn validate_facts(&self, facts: &[RangeFact], retime: bool) -> Result<()> {
        if facts.len() > self.terminal_capacity {
            return Err(Error::new("Range fact batch exceeds ledger capacity"));
        }
        for (index, fact) in facts.iter().enumerate() {
            if fact.occurrence_key.is_empty()
                || fact.occurrence_key.len() > 128
                || fact.duration_ms == 0
                || fact.duration_ms > MAX_EXACT_TIME
                || fact
                    .planned_wall_ms
                    .checked_add(fact.duration_ms)
                    .is_none_or(|end| end > MAX_WALL_MS)
            {
                return Err(Error::new("invalid Range occurrence"));
            }
            for other in &facts[..index] {
                if fact.occurrence_key == other.occurrence_key {
                    return Err(Error::new("duplicate Range occurrence key"));
                }
                if overlaps(fact, other) {
                    return Err(Error::new("overlapping Range occurrences"));
                }
            }
        }
        if let Some(active) = &self.active {
            let active_fact = if retime {
                facts
                    .iter()
                    .find(|fact| fact.occurrence_key == active.fact.occurrence_key)
                    .unwrap_or(&active.fact)
            } else {
                &active.fact
            };
            for fact in facts {
                if active_fact.occurrence_key != fact.occurrence_key && overlaps(fact, active_fact)
                {
                    return Err(Error::new("Range occurrence overlaps admitted interval"));
                }
            }
        }
        Ok(())
    }
}

fn overlaps(left: &RangeFact, right: &RangeFact) -> bool {
    left.planned_wall_ms < right.planned_wall_ms + right.duration_ms
        && right.planned_wall_ms < left.planned_wall_ms + left.duration_ms
}
