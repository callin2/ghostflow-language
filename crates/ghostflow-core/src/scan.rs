//! Portable, host-facing single-scan boundary.
//!
//! This is deliberately separate from the legacy setter/tick API: hosts which
//! opt in provide one complete latched frame, and receive the trace produced by
//! that exact evaluation. It performs no I/O and applies no physical outputs.

use std::collections::BTreeSet;

use crate::{
    context_runtime::Facts, schedule_clock::ClockSnapshot, solar_runtime::ScheduleInput, Error,
    Result, Runtime, TickRecord, Value,
};

pub const SCAN_FRAME_V1_MAX_EXACT_INTEGER: u64 = 9_007_199_254_740_991;
pub const RESERVED_CLOCK_INPUT: &str = "__gf_now_ms";

#[derive(Clone, Debug, PartialEq)]
pub struct ScanInput {
    pub name: String,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScanFrameV1 {
    pub scan_id: u64,
    pub logical_time_ms: u64,
    /// A list rather than a map preserves duplicate names so the validator can
    /// reject them instead of silently accepting last-wins host input.
    pub inputs: Vec<ScanInput>,
}

pub type ScanFrame = ScanFrameV1;

#[derive(Clone, Debug)]
pub struct ScanOutcomeV1 {
    pub scan_id: u64,
    pub logical_time_ms: u64,
    pub trace: TickRecord,
}

pub type ScanOutcome = ScanOutcomeV1;

/// A fresh, owning driver defines one host-owned scan run. It deliberately
/// keeps sequencing outside `Runtime`, so a WASM handle can own this object
/// without a self-reference and legacy setter/tick callers remain unchanged.
pub struct ScanDriver {
    runtime: Runtime,
    first_scan_tick: u64,
    next_scan_id: Option<u64>,
    last_time_ms: Option<u64>,
}

impl Runtime {
    /// Transfers this runtime into a new framed scan run at scan ID zero.
    pub fn into_scan_driver(self) -> ScanDriver {
        ScanDriver::new(self)
    }
}

impl ScanDriver {
    /// Creates an owning framed driver at scan ID zero.
    pub fn new(runtime: Runtime) -> Self {
        Self {
            first_scan_tick: runtime.next_tick,
            runtime,
            next_scan_id: Some(0),
            last_time_ms: None,
        }
    }

    pub fn runtime(&self) -> &Runtime {
        &self.runtime
    }

    pub fn into_runtime(self) -> Runtime {
        self.runtime
    }

    pub fn restore_context_checkpoint(&mut self, bytes: &[u8]) -> Result<()> {
        self.runtime.restore_context_checkpoint(bytes)
    }

    pub fn restore_solar_checkpoint(&mut self, bytes: &[u8]) -> Result<()> {
        self.runtime.restore_solar_checkpoint(bytes)
    }

    /// Advance only Solar admission while host execution is explicitly paused.
    /// This does not create a scan or change framed scalar input/clock evidence.
    pub fn observe_solar_paused(
        &mut self,
        clock: ClockSnapshot<'_>,
        facts: &[crate::solar_runtime::SolarInput<'_>],
    ) -> Result<()> {
        self.runtime.observe_solar_paused(clock, facts)
    }

    /// Validates a complete host frame without changing runtime state, inputs,
    /// sequence, clock, journal, or output intents.
    pub fn validate_scan_frame(&self, frame: &ScanFrameV1) -> Result<()> {
        if frame.scan_id > SCAN_FRAME_V1_MAX_EXACT_INTEGER {
            return Err(Error::new("scan id exceeds exact number range"));
        }
        if frame.logical_time_ms > SCAN_FRAME_V1_MAX_EXACT_INTEGER {
            return Err(Error::new("logical time exceeds exact number range"));
        }
        let expected_scan_id = self
            .next_scan_id
            .ok_or_else(|| Error::new("scan sequence exhausted"))?;
        if frame.scan_id != expected_scan_id {
            return Err(Error::new(format!(
                "unexpected scan id {}, expected {expected_scan_id}",
                frame.scan_id
            )));
        }
        if self
            .last_time_ms
            .is_some_and(|previous| frame.logical_time_ms < previous)
        {
            return Err(Error::new("logical time moved backwards"));
        }

        let module = self
            .runtime
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        if self.runtime.active_strategy.is_none() {
            return Err(Error::new("runtime is not active"));
        }
        let expected_input_count = module
            .inputs
            .iter()
            .filter(|field| !self.derived_input(&field.name))
            .count();
        if frame.inputs.len() != expected_input_count {
            return Err(Error::new(format!(
                "expected {expected_input_count} complete inputs, got {}",
                frame.inputs.len()
            )));
        }

        let mut supplied = BTreeSet::new();
        for input in &frame.inputs {
            if self.derived_input(&input.name) {
                return Err(Error::new("reserved input is runtime-derived"));
            }
            if !supplied.insert(input.name.as_str()) {
                return Err(Error::new(format!("duplicate input {}", input.name)));
            }
            if matches!(input.value, Value::Number(number) if !number.is_finite()) {
                return Err(Error::new(format!("non-finite input {}", input.name)));
            }
            let field = module
                .inputs
                .iter()
                .find(|field| field.name == input.name)
                .ok_or_else(|| Error::new(format!("unknown input {}", input.name)))?;
            if field.value_type != input.value.value_type() {
                return Err(Error::new(format!("input type mismatch {}", input.name)));
            }
        }
        for field in &module.inputs {
            if !self.derived_input(&field.name) && !supplied.contains(field.name.as_str()) {
                return Err(Error::new(format!("missing input {}", field.name)));
            }
        }
        Ok(())
    }

    /// Evaluates one complete, validated host frame. Only a successful core
    /// evaluation advances the scan sequence and logical clock.
    pub fn scan(&mut self, frame: ScanFrameV1) -> Result<ScanOutcomeV1> {
        self.scan_inner(frame, None, None, None)
    }
    pub fn scan_with_resource_binding(
        &mut self,
        frame: ScanFrameV1,
        binding: &[u8],
    ) -> Result<ScanOutcomeV1> {
        self.scan_inner(frame, None, None, Some(binding))
    }

    /// Evaluates a complete context frame with explicit clock and context facts.
    /// Reserved clocks come from the snapshot; protected Results come from the
    /// core. Failed evaluation commits neither context nor scan sequencing.
    pub fn scan_with_context(
        &mut self,
        frame: ScanFrameV1,
        clock: ClockSnapshot<'_>,
        facts: &Facts,
    ) -> Result<ScanOutcomeV1> {
        if clock.monotonic_ms != frame.logical_time_ms {
            return Err(Error::new(
                "context clock does not match frame logical time",
            ));
        }
        if self.runtime.context_runtime.is_none() {
            return Err(Error::new(
                "context scan requires an activated context runtime",
            ));
        }
        self.scan_inner(frame, Some((clock, facts)), None, None)
    }

    /// Dispatches Solar provider facts through the same framed transaction.
    /// Clocks, admission, scalar state and scan sequence commit only on success.
    pub fn scan_with_solar(
        &mut self,
        frame: ScanFrameV1,
        clock: ClockSnapshot<'_>,
        facts: &[crate::solar_runtime::SolarInput<'_>],
    ) -> Result<ScanOutcomeV1> {
        if clock.monotonic_ms != frame.logical_time_ms {
            return Err(Error::new(
                "schedule clock does not match frame logical time",
            ));
        }
        if self.runtime.solar_runtime.is_none() {
            return Err(Error::new("solar scan requires an activated solar runtime"));
        }
        let facts: Vec<_> = facts
            .iter()
            .map(|input| ScheduleInput {
                site: input.site,
                kind: crate::solar_runtime::ScheduleKind::Solar,
                facts: input.facts,
            })
            .collect();
        self.scan_inner(frame, None, Some((clock, &facts, 1)), None)
    }

    /// Dispatches civil occurrence facts through the same framed transaction.
    /// The core derives admission and retains its ledger only on success.
    pub fn scan_with_schedules(
        &mut self,
        frame: ScanFrameV1,
        clock: ClockSnapshot<'_>,
        facts: &[ScheduleInput<'_>],
        version: u16,
    ) -> Result<ScanOutcomeV1> {
        if clock.monotonic_ms != frame.logical_time_ms {
            return Err(Error::new(
                "schedule clock does not match frame logical time",
            ));
        }
        if self.runtime.solar_runtime.is_none() {
            return Err(Error::new(
                "schedule scan requires an activated civil runtime",
            ));
        }
        if !matches!(version, 2 | 3) {
            return Err(Error::new("unsupported framed schedule packet version"));
        }
        self.scan_inner(frame, None, Some((clock, facts, version)), None)
    }

    fn derived_input(&self, name: &str) -> bool {
        name == RESERVED_CLOCK_INPUT
            || (name == "__gf_time_epoch"
                && self.runtime.solar_runtime.is_some()
                && self
                    .runtime
                    .module
                    .as_ref()
                    .is_some_and(|m| matches!(m.format_version, 5 | 6 | 8 | 9)))
            || (self.runtime.context_runtime.is_some()
                && ((name == "__gf_time_epoch"
                    && self.runtime.module.as_ref().is_some_and(|m| {
                        matches!(m.format_version, 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18)
                    }))
                    || [
                        "__gf_config_",
                        "__gf_natural_",
                        "__gf_accounting_",
                        "__gf_calendar_",
                    ]
                    .iter()
                    .any(|prefix| name.starts_with(prefix))))
    }

    fn scan_inner(
        &mut self,
        frame: ScanFrameV1,
        context: Option<(ClockSnapshot<'_>, &Facts)>,
        schedules: Option<(ClockSnapshot<'_>, &[ScheduleInput<'_>], u16)>,
        resource_binding: Option<&[u8]>,
    ) -> Result<ScanOutcomeV1> {
        self.validate_scan_frame(&frame)?;

        // Never combine a framed scan with pending legacy setter values.
        self.runtime.clear_inputs();
        for input in &frame.inputs {
            // Validation above establishes that these setters cannot fail for
            // this installed module. Keep the error path defensive regardless.
            if let Err(error) = self.runtime.set_input(&input.name, input.value) {
                self.runtime.clear_inputs();
                return Err(error);
            }
        }
        let derive_epoch = self
            .runtime
            .module
            .as_ref()
            .is_some_and(|m| matches!(m.format_version, 10 | 11 | 12 | 13 | 14 | 15 | 16 | 18));
        let result = if let Some((clock, facts)) = context {
            let clock_input = self.runtime.set_input(
                RESERVED_CLOCK_INPUT,
                Value::Number(clock.monotonic_ms as f64),
            );
            let clock_input = if derive_epoch {
                clock_input.and_then(|()| {
                    self.runtime
                        .set_input("__gf_time_epoch", Value::Number(clock.boot_epoch as f64))
                })
            } else {
                clock_input
            };
            clock_input.and_then(|()| self.runtime.tick_with_context(clock, facts))
        } else if let Some((clock, facts, version)) = schedules {
            self.runtime
                .set_input(
                    RESERVED_CLOCK_INPUT,
                    Value::Number(clock.monotonic_ms as f64),
                )
                .and_then(|()| {
                    self.runtime
                        .set_input("__gf_time_epoch", Value::Number(clock.boot_epoch as f64))
                })
                .and_then(|()| {
                    if version == 1 {
                        let facts: Vec<_> = facts
                            .iter()
                            .map(|input| crate::solar_runtime::SolarInput {
                                site: input.site,
                                facts: input.facts,
                            })
                            .collect();
                        self.runtime.tick_with_solar(clock, &facts)
                    } else if version == 3 {
                        self.runtime.tick_with_daily_slots(clock, facts)
                    } else {
                        self.runtime.tick_with_schedules(clock, facts)
                    }
                })
        } else if let Some(binding) = resource_binding {
            self.runtime.tick_with_resource_binding(binding)
        } else {
            self.runtime.tick_at(frame.logical_time_ms)
        };
        let trace = match result {
            Ok(record) => record.clone(),
            Err(error) => {
                // A rejected core evaluation must not leave a partial frame for
                // a subsequent legacy tick or another framed attempt.
                self.runtime.clear_inputs();
                return Err(error);
            }
        };
        self.last_time_ms = Some(frame.logical_time_ms);
        self.next_scan_id = if frame.scan_id == SCAN_FRAME_V1_MAX_EXACT_INTEGER {
            None
        } else {
            Some(frame.scan_id + 1)
        };
        Ok(ScanOutcomeV1 {
            scan_id: frame.scan_id,
            logical_time_ms: frame.logical_time_ms,
            trace,
        })
    }

    /// Explicitly named alias for adapters that prefer the ABI terminology.
    pub fn scan_frame(&mut self, frame: ScanFrameV1) -> Result<ScanOutcomeV1> {
        self.scan(frame)
    }

    pub fn next_scan_id(&self) -> Option<u64> {
        self.next_scan_id
    }

    pub fn scan_last_time_ms(&self) -> Option<u64> {
        self.last_time_ms
    }

    /// Read-only same-program ghost replay of retained records from this scan run.
    pub fn plan_current_temporal_replay(
        &self,
        count: usize,
        activation: &crate::temporal_runtime::TemporalActivation,
    ) -> Result<crate::temporal_runtime::TemporalReplayResourceReport> {
        let skip = self
            .runtime
            .journal
            .iter()
            .take_while(|record| record.tick < self.first_scan_tick)
            .count();
        self.runtime
            .plan_current_temporal_replay_range(skip, count, activation, true)
    }
    pub fn replay_current_with_temporal(
        &self,
        count: usize,
        activation: &crate::temporal_runtime::TemporalActivation,
        max_peak_temporal_bytes: usize,
    ) -> Result<Vec<ScanOutcomeV1>> {
        let plan = self.plan_current_temporal_replay(count, activation)?;
        if !plan.ghost_fits_budget || plan.required_peak_temporal_bytes > max_peak_temporal_bytes {
            return Err(Error::new("temporal-budget-exceeded"));
        }
        let skip = self
            .runtime
            .journal
            .iter()
            .take_while(|record| record.tick < self.first_scan_tick)
            .count();
        if count == 0 || count > self.runtime.journal.len() - skip {
            return Err(Error::new(
                "temporal replay count exceeds retained records or is zero",
            ));
        }
        // Charge this adapter-owned output allocation while core replay and its
        // returned records are also alive. Evidence payloads are moved, not cloned.
        let width = std::mem::size_of::<ScanOutcomeV1>();
        let required = count
            .checked_mul(width)
            .ok_or_else(|| Error::new("temporal-budget-exceeded"))?;
        if required
            .checked_add(self.runtime.temporal_memory_bytes().unwrap_or(0))
            .is_none_or(|bytes| bytes > max_peak_temporal_bytes)
        {
            return Err(Error::new("temporal-budget-exceeded"));
        }
        let mut outcomes = Vec::new();
        outcomes
            .try_reserve_exact(count)
            .map_err(|_| Error::new("temporal-allocation-failed"))?;
        let available = outcomes
            .capacity()
            .checked_mul(width)
            .and_then(|bytes| max_peak_temporal_bytes.checked_sub(bytes))
            .ok_or_else(|| Error::new("temporal-budget-exceeded"))?;
        let records = self
            .runtime
            .replay_current_temporal_range(skip, count, activation, available)?;
        for trace in records {
            let Some(Value::Number(time)) = trace.inputs.get(RESERVED_CLOCK_INPUT) else {
                return Err(Error::new("temporal replay lacks recorded logical time"));
            };
            let logical_time_ms = *time as u64;
            outcomes.push(ScanOutcomeV1 {
                scan_id: trace.tick - self.first_scan_tick,
                logical_time_ms,
                trace,
            });
        }
        Ok(outcomes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Capability, Field, Module, Type};

    const MODULE: &[u8] = include_bytes!("../../../build/irrigation.gfb");

    fn active_runtime(clock: bool) -> Runtime {
        let mut module = Module::load(MODULE).unwrap();
        if clock {
            module.inputs.push(Field {
                name: RESERVED_CLOCK_INPUT.into(),
                value_type: Type::Number,
                default: Value::Number(0.0),
            });
        }
        let mut runtime = Runtime::new(8);
        runtime.install(module, false);
        for name in ["pump", "valve"] {
            runtime
                .add_capability(Capability::new("actuator", name, Type::Bool))
                .unwrap();
        }
        runtime.activate().unwrap();
        runtime
    }

    fn frame(scan_id: u64, time: u64) -> ScanFrameV1 {
        ScanFrameV1 {
            scan_id,
            logical_time_ms: time,
            inputs: vec![
                ScanInput {
                    name: "start".into(),
                    value: Value::Bool(true),
                },
                ScanInput {
                    name: "stop".into(),
                    value: Value::Bool(false),
                },
                ScanInput {
                    name: "low_water".into(),
                    value: Value::Bool(false),
                },
                ScanInput {
                    name: "moisture".into(),
                    value: Value::Number(90.0),
                },
            ],
        }
    }

    #[test]
    fn scan_frame_is_complete_board_neutral_and_derives_the_reserved_clock() {
        let mut driver = active_runtime(true).into_scan_driver();
        let outcome = driver.scan(frame(0, 100)).unwrap();
        assert_eq!(outcome.scan_id, 0);
        assert_eq!(outcome.logical_time_ms, 100);
        assert_eq!(
            outcome.trace.inputs[RESERVED_CLOCK_INPUT],
            Value::Number(100.0)
        );
        assert_eq!(outcome.trace.requested_intents["pump"], Value::Bool(true));
        assert_eq!(outcome.trace.safe_intents["pump"], Value::Bool(true));
        assert_eq!(driver.next_scan_id(), Some(1));
        assert_eq!(driver.scan_last_time_ms(), Some(100));
    }

    #[test]
    fn rejected_frames_do_not_advance_sequence_time_or_mutate_state() {
        let mut driver = active_runtime(false).into_scan_driver();
        assert!(driver
            .scan(frame(0, SCAN_FRAME_V1_MAX_EXACT_INTEGER + 1))
            .is_err());
        let missing = ScanFrameV1 {
            inputs: frame(0, 0).inputs[..3].to_vec(),
            ..frame(0, 0)
        };
        assert!(driver.scan(missing).is_err());
        assert_eq!(driver.next_scan_id(), Some(0));
        assert_eq!(driver.scan_last_time_ms(), None);

        let mut duplicate = frame(0, 0);
        duplicate.inputs.push(ScanInput {
            name: "start".into(),
            value: Value::Bool(true),
        });
        assert!(driver.scan(duplicate).is_err());
        let mut reserved = frame(0, 0);
        reserved.inputs.push(ScanInput {
            name: RESERVED_CLOCK_INPUT.into(),
            value: Value::Number(0.0),
        });
        assert!(driver.scan(reserved).is_err());
        let mut wrong_type = frame(0, 0);
        wrong_type.inputs[0].value = Value::Number(1.0);
        assert!(driver.scan(wrong_type).is_err());
        let mut nonfinite = frame(0, 0);
        nonfinite.inputs[3].value = Value::Number(f64::NAN);
        assert!(driver.scan(nonfinite).is_err());
        assert_eq!(driver.next_scan_id(), Some(0));
        assert_eq!(driver.scan_last_time_ms(), None);

        driver.scan(frame(0, 10)).unwrap();
        assert_eq!(driver.runtime().state("watering"), Some(Value::Bool(true)));
        assert_eq!(driver.runtime().intent("pump"), Some(Value::Bool(true)));
        assert!(driver.scan(frame(2, 11)).is_err());
        assert!(driver.scan(frame(1, 9)).is_err());
        assert_eq!(driver.next_scan_id(), Some(1));
        assert_eq!(driver.scan_last_time_ms(), Some(10));
        assert_eq!(driver.runtime().state("watering"), Some(Value::Bool(true)));
        assert_eq!(driver.runtime().intent("pump"), Some(Value::Bool(true)));
        let runtime = driver.into_runtime();
        assert_eq!(runtime.journal().len(), 1);
    }

    #[test]
    fn sequence_rejects_non_exact_ids_and_stops_after_the_last_exact_id() {
        let mut driver = active_runtime(false).into_scan_driver();
        let too_large = frame(SCAN_FRAME_V1_MAX_EXACT_INTEGER + 1, 0);
        assert!(driver.scan(too_large).is_err());
        driver.next_scan_id = Some(SCAN_FRAME_V1_MAX_EXACT_INTEGER);
        driver
            .scan(frame(SCAN_FRAME_V1_MAX_EXACT_INTEGER, 0))
            .unwrap();
        assert_eq!(driver.next_scan_id(), None);
        assert!(driver
            .scan(frame(SCAN_FRAME_V1_MAX_EXACT_INTEGER, 1))
            .is_err());
    }

    #[test]
    fn fresh_driver_scopes_scan_ids_without_changing_legacy_runtime_lifecycle() {
        let runtime = active_runtime(true);
        {
            let mut first = runtime.into_scan_driver();
            first.scan(frame(0, 10)).unwrap();
            assert_eq!(first.next_scan_id(), Some(1));
            let runtime = first.into_runtime();
            let mut second = runtime.into_scan_driver();
            second.scan(frame(0, 10)).unwrap();
            assert_eq!(second.next_scan_id(), Some(1));
            let mut runtime = second.into_runtime();

            // Legacy callers may still supply the pre-existing runtime clock input.
            runtime.clear_inputs();
            runtime.set_input("start", Value::Bool(false)).unwrap();
            runtime.set_input("stop", Value::Bool(false)).unwrap();
            runtime.set_input("low_water", Value::Bool(false)).unwrap();
            runtime.set_input("moisture", Value::Number(90.0)).unwrap();
            runtime
                .set_input(RESERVED_CLOCK_INPUT, Value::Number(11.0))
                .unwrap();
            runtime.tick().unwrap();
            assert_eq!(runtime.journal().len(), 3);
        }
    }

    #[test]
    fn facade_operates_with_the_existing_minimum_bounded_journal_capacity() {
        let module = Module::load(MODULE).unwrap();
        let mut runtime = Runtime::new(0);
        runtime.install(module, false);
        for name in ["pump", "valve"] {
            runtime
                .add_capability(Capability::new("actuator", name, Type::Bool))
                .unwrap();
        }
        runtime.activate().unwrap();
        let mut driver = ScanDriver::new(runtime);
        driver.scan(frame(0, 0)).unwrap();
        assert_eq!(driver.runtime().journal().len(), 1);
    }

    #[test]
    fn failed_core_evaluation_clears_the_frame_before_the_next_attempt() {
        let mut module = Module::load(MODULE).unwrap();
        // Simulate a defensive core-evaluation failure after frame validation;
        // loading normally verifies this expression, but adapters must still
        // clear their complete frame if a core evaluation returns an error.
        module.strategies[0].transitions[0].expression = vec![3, 0xff, 0x00];
        let mut runtime = Runtime::new(8);
        runtime.install(module, false);
        for name in ["pump", "valve"] {
            runtime
                .add_capability(Capability::new("actuator", name, Type::Bool))
                .unwrap();
        }
        runtime.activate().unwrap();
        let mut driver = runtime.into_scan_driver();
        assert!(driver.scan(frame(0, 0)).is_err());
        assert_eq!(driver.next_scan_id(), Some(0));
        assert_eq!(driver.scan_last_time_ms(), None);
        let mut runtime = driver.into_runtime();
        assert!(runtime.tick().is_err());
        assert!(runtime.journal().is_empty());
    }
}
