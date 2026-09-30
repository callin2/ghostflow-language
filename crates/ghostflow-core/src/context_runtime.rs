//! Transactional Rust-owned natural Result and schedule execution.

use crate::settings_stream::{ConfigStream, ConfigValue, SETTINGS_INVALID, SETTINGS_UNAVAILABLE};
use crate::{
    context_vm::*,
    eval_expression_with_preludes,
    natural_context::{self, NaturalFault, NaturalKind, NaturalValue},
    schedule_clock::{ClockSnapshot, ClockTrust, ScheduleClockGate},
    schedule_vm::PulseDescriptor,
    Error, Result, ResultTraceBuffer, Value,
};
use std::collections::BTreeSet;

#[path = "context_checkpoint.rs"]
mod checkpoint;

#[derive(Clone, Debug)]
pub struct Activation {
    pub boot_epoch: u64,
    pub terminal_capacity: usize,
    pub bindings: Vec<ProviderBinding>,
}

#[derive(Clone, Debug, Default)]
pub struct Facts {
    pub schedules: Vec<ScheduleEvidence>,
    pub natural: Vec<ProviderObservation>,
    pub settings: Option<SettingsEvent>,
    pub accounting: Vec<AccountingInput>,
}

/// A Result produced from a Rust ledger, never decoded from caller projections.
#[derive(Clone, Debug)]
pub struct AccountingInput {
    site: u32,
    account: String,
    event: String,
    timezone: String,
    value: std::result::Result<i32, u8>,
}

impl AccountingInput {
    pub fn from_ledger(
        site: u32,
        account: String,
        event: String,
        timezone: String,
        ledger: &crate::accounting::AccountingLedger,
        event_type: u32,
        local_day: Option<i32>,
        durable_ack: bool,
        unavailable_fault: u8,
    ) -> Result<Self> {
        if site == 0
            || event_type == 0
            || ![&account, &event, &timezone].iter().all(|s| bounded(s))
            || !(1..=3).contains(&unavailable_fault)
            || local_day.is_some_and(|d| !(0..=2_932_896).contains(&d))
        {
            return Err(invalid("invalid accounting Result binding"));
        }
        let value = match local_day {
            None => Err(0),
            Some(_) if !durable_ack => Err(unavailable_fault),
            Some(day) => match ledger.event_count(event_type, day) {
                crate::accounting::LedgerRead::Known(value) => i32::try_from(value).map_err(|_| 4),
                crate::accounting::LedgerRead::Unknown => Err(unavailable_fault),
            },
        };
        Ok(Self {
            site,
            account,
            event,
            timezone,
            value,
        })
    }
}

#[derive(Clone)]
pub(crate) struct ContextRuntime {
    engines: Vec<Option<crate::context_schedule::Engine>>,
    configs: Vec<ConfigStream>,
    bindings: Vec<ProviderBinding>,
    pub boot_epoch: u64,
    settings_revision: u64,
    last_event_position: Option<u64>,
    event_ids: BTreeSet<String>,
    capacity: usize,
    clock: ScheduleClockGate,
}

pub(crate) struct Stage {
    pub runtime: ContextRuntime,
    pub projections: Vec<[Value; 3]>,
    pub trace: Vec<Observation>,
}

fn invalid(message: &str) -> Error {
    Error::new(message)
}
const MAX_EXACT: u64 = 9_007_199_254_740_991;

fn bounded(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128
}

impl ContextRuntime {
    pub(crate) fn new(descriptors: &[PulseDescriptor], activation: &Activation) -> Result<Self> {
        if descriptors.is_empty()
            || !(1..=4096).contains(&activation.terminal_capacity)
            || activation.bindings.len() > 128
        {
            return Err(invalid("invalid context activation bounds"));
        }
        let mut names = BTreeSet::new();
        for binding in &activation.bindings {
            if binding.kind > 2
                || binding.max_uncertainty_ms > 9_007_199_254_740_991
                || [
                    &binding.provider,
                    &binding.namespace,
                    &binding.station,
                    &binding.binding_revision,
                    &binding.location,
                    &binding.timezone,
                    &binding.criteria,
                ]
                .iter()
                .any(|s| !bounded(s))
                || !names.insert(binding.provider.as_str())
            {
                return Err(invalid("invalid or duplicate provider binding"));
            }
        }
        let mut used = BTreeSet::new();
        let mut engines = Vec::with_capacity(descriptors.len());
        for descriptor in descriptors {
            let requirement = match descriptor {
                PulseDescriptor::Natural(d) => Some((
                    d.provider.as_str(),
                    if d.kind == NaturalKind::Tide { 0 } else { 1 },
                    None,
                )),
                PulseDescriptor::Accounting(_) | PulseDescriptor::Config(_) => None,
                PulseDescriptor::Context(d) => match &d.definition {
                    ScheduleDefinition::TideRun {
                        provider, timezone, ..
                    } => Some((provider.as_str(), 0, Some(timezone.as_str()))),
                    ScheduleDefinition::CalendarDaily {
                        calendar, timezone, ..
                    } => Some((calendar.as_str(), 2, Some(timezone.as_str()))),
                    _ => None,
                },
                _ => {
                    return Err(invalid(
                        "GFB10 context activation cannot mix legacy schedule packets",
                    ))
                }
            };
            if let Some((provider, kind, timezone)) = requirement {
                let binding = activation
                    .bindings
                    .iter()
                    .find(|b| b.provider == provider)
                    .ok_or_else(|| invalid("missing declared provider binding"))?;
                if binding.kind != kind || timezone.is_some_and(|zone| binding.timezone != zone) {
                    return Err(invalid("provider kind or timezone binding mismatch"));
                }
                used.insert(provider);
            }
            engines.push(match descriptor {
                PulseDescriptor::Context(d) => Some(crate::context_schedule::Engine::new(
                    d,
                    activation.boot_epoch,
                    activation.terminal_capacity,
                )?),
                _ => None,
            });
        }
        if used.len() != activation.bindings.len() {
            return Err(invalid("unused provider activation binding"));
        }
        Ok(Self {
            engines,
            configs: descriptors
                .iter()
                .filter_map(|d| match d {
                    PulseDescriptor::Config(d) => Some(ConfigStream::new(d.clone())),
                    _ => None,
                })
                .collect::<Result<_>>()?,
            bindings: activation.bindings.clone(),
            boot_epoch: activation.boot_epoch,
            settings_revision: 0,
            last_event_position: None,
            event_ids: BTreeSet::new(),
            capacity: activation.terminal_capacity,
            clock: ScheduleClockGate::new(9_007_199_254_740_991, activation.boot_epoch)?,
        })
    }

    fn validate_observation(&self, observation: &ProviderObservation) -> Result<()> {
        let binding = self
            .bindings
            .iter()
            .find(|b| b.provider == observation.binding.provider)
            .ok_or_else(|| invalid("unbound provider observation"))?;
        if binding != &observation.binding {
            return Err(invalid("provider observation binding mismatch"));
        }
        if !bounded(&observation.provider_revision)
            || observation.coverage_start_ms >= observation.coverage_end_ms
            || observation.expires_at_ms < observation.coverage_start_ms
            || observation.fault.is_some_and(|f| f > 5)
            || [
                observation.coverage_start_ms,
                observation.coverage_end_ms,
                observation.expires_at_ms,
                observation.uncertainty_ms,
            ]
            .iter()
            .any(|v| *v > MAX_EXACT)
            || observation.classifications.len() > 8
            || observation.classifications.iter().any(|s| !bounded(s))
            || observation
                .classifications
                .iter()
                .collect::<BTreeSet<_>>()
                .len()
                != observation.classifications.len()
        {
            return Err(invalid("malformed provider observation"));
        }
        Ok(())
    }

    pub(crate) fn stage(
        &self,
        descriptors: &[PulseDescriptor],
        clock: ClockSnapshot<'_>,
        facts: &Facts,
        inputs: &mut [Value],
        state: &[Value],
        trace: &mut ResultTraceBuffer,
        program_fingerprint: u64,
        position: u64,
    ) -> Result<Stage> {
        let mut staged = Stage {
            runtime: self.clone(),
            projections: Vec::with_capacity(descriptors.len()),
            trace: Vec::new(),
        };
        staged.runtime.clock.poll(clock)?;
        let expected = descriptors
            .iter()
            .filter(|d| matches!(d, PulseDescriptor::Context(_)))
            .count();
        if facts.schedules.len() != expected || facts.natural.len() > self.bindings.len() {
            return Err(invalid("context facts do not match installed requirements"));
        }
        let mut providers = BTreeSet::new();
        for observation in &facts.natural {
            self.validate_observation(observation)?;
            if !providers.insert(observation.binding.provider.as_str()) {
                return Err(invalid("duplicate natural observation"));
            }
            if !descriptors.iter().any(|d| matches!(d, PulseDescriptor::Natural(n) if n.provider == observation.binding.provider)) {
                return Err(invalid("unexpected natural observation"));
            }
        }
        let accounting_count = descriptors
            .iter()
            .filter(|d| matches!(d, PulseDescriptor::Accounting(_)))
            .count();
        if facts.accounting.len() != accounting_count {
            return Err(invalid("missing accounting ledger Result binding"));
        }
        let mut accounting_sites = BTreeSet::new();
        for input in &facts.accounting {
            if !accounting_sites.insert(input.site) {
                return Err(invalid("duplicate accounting Result binding"));
            }
            let d = descriptors
                .iter()
                .find_map(|d| match d {
                    PulseDescriptor::Accounting(d) if d.site == input.site => Some(d),
                    _ => None,
                })
                .ok_or_else(|| invalid("unexpected accounting Result binding"))?;
            if input.account != d.account || input.event != d.event || input.timezone != d.timezone
            {
                return Err(invalid("accounting Result identity mismatch"));
            }
            let (ok, value, fault) = match input.value {
                Ok(count) => (true, count, 0),
                Err(fault) => (false, 0, fault),
            };
            inputs[usize::from(d.ok_input)] = Value::Bool(ok);
            inputs[usize::from(d.value_input)] = Value::Int(value);
            inputs[usize::from(d.fault_input)] = Value::Number(f64::from(fault));
            staged.trace.push(Observation {
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site: d.site,
                occurrence_id: String::new(),
                planned_ms: None,
                decision: format!("{:?}", input.value),
                provider_revision: String::new(),
                context_revision: input.event.clone(),
            });
        }
        let mut sites = BTreeSet::new();
        for evidence in &facts.schedules {
            if !sites.insert(evidence.site)
                || !descriptors
                    .iter()
                    .any(|d| matches!(d, PulseDescriptor::Context(c) if c.site == evidence.site))
            {
                return Err(invalid("unknown or duplicate context schedule site"));
            }
            if evidence.rows.len() > 4096
                || evidence.coverage_start_ms >= evidence.coverage_end_ms
                || evidence.coverage_end_ms > MAX_EXACT
            {
                return Err(invalid("invalid context occurrence bounds"));
            }
            let definition = descriptors
                .iter()
                .find_map(|d| match d {
                    PulseDescriptor::Context(d) if d.site == evidence.site => Some(&d.definition),
                    _ => None,
                })
                .ok_or_else(|| invalid("unknown context schedule site"))?;
            match definition {
                ScheduleDefinition::Periodic { .. } | ScheduleDefinition::UtcRange { .. } => {
                    if evidence.provider.is_some()
                        || evidence.calendar.is_some()
                        || !evidence.rows.is_empty()
                    {
                        return Err(invalid("unexpected Periodic evidence payload"));
                    }
                }
                ScheduleDefinition::TideRun { provider, .. } => {
                    if evidence.calendar.is_some()
                        || evidence
                            .provider
                            .as_ref()
                            .is_some_and(|p| p.binding.provider != *provider)
                    {
                        return Err(invalid("Tide provider payload mismatch"));
                    }
                }
                ScheduleDefinition::CalendarDaily {
                    calendar, timezone, ..
                } => {
                    if evidence.provider.is_some() {
                        return Err(invalid("unexpected Calendar provider payload"));
                    }
                    if let Some(snapshot) = &evidence.calendar {
                        if ![
                            &snapshot.calendar_id,
                            &snapshot.revision,
                            &snapshot.timezone,
                        ]
                        .iter()
                        .all(|s| bounded(s))
                            || snapshot.expires_at_ms > MAX_EXACT
                        {
                            return Err(invalid("invalid calendar snapshot bounds"));
                        }
                        crate::work_calendar::evaluate(
                            crate::work_calendar::DayQuery {
                                calendar_id: calendar,
                                timezone,
                                date: snapshot.covered_from_date,
                                selector: crate::work_calendar::DaySelector::Workday,
                                now_ms: 0,
                            },
                            Some(snapshot),
                        )
                        .map_err(|_| invalid("invalid calendar snapshot"))?;
                    }
                }
                _ => {
                    if evidence.provider.is_some() || evidence.calendar.is_some() {
                        return Err(invalid("unexpected civil evidence payload"));
                    }
                }
            }
            if let Some(provider) = &evidence.provider {
                self.validate_observation(provider)?;
            }
        }
        // One scan observes one version of each provider. Classification payloads
        // and occurrence rows are separate views of that same immutable envelope.
        let observations: Vec<_> = facts
            .natural
            .iter()
            .chain(facts.schedules.iter().filter_map(|s| s.provider.as_ref()))
            .collect();
        for (index, observation) in observations.iter().enumerate() {
            for (prior_index, prior) in observations[..index].iter().enumerate() {
                // Empty occurrence-side labels omit the classification payload;
                // natural-side empty labels certify an empty classification set.
                let compare_classes = !observation.classifications.is_empty()
                    && (prior_index < facts.natural.len() || !prior.classifications.is_empty());
                if prior.binding.provider == observation.binding.provider
                    && (prior.binding != observation.binding
                        || prior.provider_revision != observation.provider_revision
                        || prior.coverage_start_ms != observation.coverage_start_ms
                        || prior.coverage_end_ms != observation.coverage_end_ms
                        || prior.expires_at_ms != observation.expires_at_ms
                        || prior.uncertainty_ms != observation.uncertainty_ms
                        || prior.fault != observation.fault
                        || compare_classes
                            && prior.classifications.iter().collect::<BTreeSet<_>>()
                                != observation.classifications.iter().collect::<BTreeSet<_>>())
                {
                    return Err(invalid("inconsistent shared provider snapshot"));
                }
            }
        }
        if let Some(event) = &facts.settings {
            if event.program_fingerprint != program_fingerprint
                || !bounded(&event.event_id)
                || event.base_revision != self.settings_revision
                || event.position != position
                || self
                    .last_event_position
                    .is_some_and(|last| event.position <= last)
                || self.event_ids.contains(&event.event_id)
                || event.changes.is_empty()
                || event.changes.len() > self.configs.len()
                || self.event_ids.len() >= self.capacity
            {
                return Err(invalid("invalid or stale settings transaction"));
            }
            let mut changes = BTreeSet::new();
            let mut candidates = Vec::new();
            let mut group_fault = None;
            let mut explicit_fault = None;
            for change in &event.changes {
                let Some((index, config)) = self
                    .configs
                    .iter()
                    .enumerate()
                    .find(|(_, c)| c.descriptor.id == change.id)
                else {
                    return Err(invalid("unknown settings stream target"));
                };
                if !changes.insert(change.id)
                    || event.origin == SettingsOrigin::OperatorEdit
                        && !config.descriptor.operator_editable
                {
                    return Err(invalid("invalid settings target"));
                }
                match &change.result {
                    Err(fault) if *fault <= SETTINGS_UNAVAILABLE => {
                        if explicit_fault.is_some_and(|old| old != *fault) {
                            return Err(invalid("conflicting explicit settings faults"));
                        }
                        explicit_fault = Some(*fault);
                    }
                    Err(_) => return Err(invalid("invalid settings fault tag")),
                    Ok(value) => {
                        if matches!(value, ConfigValue::Scalar(Value::Number(n)) if !n.is_finite())
                        {
                            return Err(invalid("nonfinite settings packet"));
                        }
                        if !bounded(&change.semantic_type)
                            || matches!(value, ConfigValue::Slots(slots) if slots.len() > 4096)
                        {
                            return Err(invalid("settings payload exceeds transport bounds"));
                        }
                        if let Some((value, next_key)) =
                            config.validate(&change.semantic_type, value)
                        {
                            if !config.descriptor.operator_editable
                                && value != config.descriptor.initial
                            {
                                return Err(invalid(
                                    "producer cannot change readonly config payload",
                                ));
                            }
                            candidates.push((index, value, next_key));
                        } else {
                            group_fault = Some(SETTINGS_INVALID);
                            staged.trace.push(Observation {
                                clock_provenance: None,
                                clock_source_revision: None,
                                clock_uncertainty_ms: None,
                                unknown_reason: None,
                                site: change.id,
                                occurrence_id: event.event_id.clone(),
                                planned_ms: None,
                                decision: if change.semantic_type != config.descriptor.semantic_type
                                {
                                    "SettingsTypeMismatch".into()
                                } else {
                                    "SettingsPayloadInvalid".into()
                                },
                                provider_revision: self.settings_revision.to_string(),
                                context_revision: config.descriptor.name.clone(),
                            });
                        }
                    }
                }
            }
            if let Some(fault) = group_fault.or(explicit_fault) {
                for config in &mut staged.runtime.configs {
                    if changes.contains(&config.descriptor.id) {
                        config.current = Err(fault);
                    }
                }
            } else {
                for (index, value, next_key) in candidates {
                    let config = &mut staged.runtime.configs[index];
                    config.current = Ok(value.clone());
                    config.last_success = value;
                    config.next_key = next_key;
                }
            }
            staged.runtime.settings_revision = self
                .settings_revision
                .checked_add(1)
                .ok_or_else(|| invalid("settings revision exhausted"))?;
            staged.runtime.last_event_position = Some(event.position);
            staged.runtime.event_ids.insert(event.event_id.clone());
        }
        for config in &staged.runtime.configs {
            config.project(inputs);
            staged.trace.push(Observation {
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site: config.descriptor.id,
                occurrence_id: String::new(),
                planned_ms: None,
                decision: match &config.current {
                    Ok(_) => "SettingsOk".into(),
                    Err(0) => "SettingsInvalid".into(),
                    Err(_) => "SettingsUnavailable".into(),
                },
                provider_revision: staged.runtime.settings_revision.to_string(),
                context_revision: config.descriptor.name.clone(),
            });
        }
        // Natural projections are complete before any schedule predicate runs.
        for descriptor in descriptors {
            let PulseDescriptor::Natural(d) = descriptor else {
                continue;
            };
            let binding = self
                .bindings
                .iter()
                .find(|b| b.provider == d.provider)
                .ok_or_else(|| invalid("missing natural activation"))?;
            let observation = facts
                .natural
                .iter()
                .find(|o| o.binding.provider == d.provider);
            let labels: Vec<&str> = observation.map_or_else(Vec::new, |o| {
                o.classifications.iter().map(String::as_str).collect()
            });
            let evidence = observation.map(|o| natural_context::NaturalObservation {
                kind: d.kind,
                provider: &o.binding.provider,
                binding_revision: &o.binding.binding_revision,
                provider_revision: &o.provider_revision,
                location: &o.binding.location,
                timezone: &o.binding.timezone,
                criteria: &o.binding.criteria,
                coverage_start_ms: o.coverage_start_ms,
                coverage_end_ms: o.coverage_end_ms,
                expires_at_ms: o.expires_at_ms,
                uncertainty_ms: o.uncertainty_ms,
                classifications: &labels,
                fault: o.fault.map(fault_from_code),
            });
            let result = natural_context::evaluate(
                natural_context::NaturalQuery {
                    kind: d.kind,
                    provider: &d.provider,
                    classification: &d.classification,
                    location: &binding.location,
                    timezone: &binding.timezone,
                    max_uncertainty_ms: binding.max_uncertainty_ms,
                },
                evidence.as_ref(),
                clock.wall_ms.unwrap_or(0),
                matches!(clock.trust, ClockTrust::Trusted) && clock.wall_ms.is_some(),
            )
            .map_err(|_| invalid("invalid natural context evidence"))?;
            let (ok, value, fault) = match result.value {
                NaturalValue::Ok(value) => (true, value, 0),
                NaturalValue::Fault(fault) => (false, false, fault as u8),
            };
            inputs[usize::from(d.ok_input)] = Value::Bool(ok);
            inputs[usize::from(d.value_input)] = Value::Bool(value);
            inputs[usize::from(d.fault_input)] = Value::Number(f64::from(fault));
            staged.trace.push(Observation {
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site: d.site,
                occurrence_id: String::new(),
                planned_ms: None,
                decision: format!("{:?}", result.value),
                provider_revision: result.provider_revision.unwrap_or("").into(),
                context_revision: result.binding_revision.unwrap_or("").into(),
            });
        }
        for (index, descriptor) in descriptors.iter().enumerate() {
            if let PulseDescriptor::Context(d) = descriptor {
                let evidence = facts
                    .schedules
                    .iter()
                    .find(|e| e.site == d.site)
                    .ok_or_else(|| invalid("missing schedule evidence"))?;
                let evaluate = |code: &[u8], trace: &mut ResultTraceBuffer| -> Result<bool> {
                    match eval_expression_with_preludes(
                        code,
                        inputs,
                        state,
                        None,
                        trace,
                        &[],
                        &[],
                        &staged.projections,
                    )? {
                        Value::Bool(value) => Ok(value),
                        _ => Err(invalid("context predicate must be Bool")),
                    }
                };
                let when = evaluate(&d.when, trace)?;
                let cancel = evaluate(&d.cancel, trace)?;
                let config_id = match &d.definition {
                    ScheduleDefinition::Periodic { every, .. } => every.id,
                    ScheduleDefinition::ConfigDailySlots { config_id, .. } => *config_id,
                    _ => 0,
                };
                let config = staged
                    .runtime
                    .configs
                    .iter()
                    .find(|c| c.descriptor.id == config_id);
                let changed = facts
                    .settings
                    .as_ref()
                    .is_some_and(|e| e.changes.iter().any(|c| c.id == config_id));
                let change = if changed {
                    config.and_then(|c| match &c.current {
                        Ok(ConfigValue::Scalar(Value::Number(n))) => {
                            Some(SettingValue::SharedDuration(*n as u64))
                        }
                        Ok(ConfigValue::Slots(slots)) => {
                            Some(SettingValue::SharedSlots(slots.clone()))
                        }
                        _ => None,
                    })
                } else {
                    None
                };
                let engine = self.engines[index]
                    .as_ref()
                    .ok_or_else(|| invalid("context engine binding mismatch"))?;
                let (next, decision) = if let Some(Err(fault)) = config.map(|c| &c.current) {
                    engine.stage_settings_fault(d, clock, evidence, *fault)?
                } else {
                    engine.stage(
                        d,
                        clock,
                        evidence,
                        when,
                        cancel,
                        change.as_ref(),
                        staged.runtime.settings_revision,
                    )?
                };
                staged.runtime.engines[index] = Some(next);
                staged.projections.push([
                    Value::Bool(decision.due),
                    Value::Bool(decision.missed),
                    Value::Bool(decision.active),
                ]);
                staged.trace.extend(decision.observations);
            } else {
                staged.projections.push([Value::Bool(false); 3]);
            }
        }
        Ok(staged)
    }
}

fn fault_from_code(code: u8) -> NaturalFault {
    match code {
        0 => NaturalFault::ClockUnknown,
        1 => NaturalFault::LocationUnknown,
        2 => NaturalFault::EventUnavailable,
        3 => NaturalFault::PredictionMissing,
        4 => NaturalFault::PredictionStale,
        _ => NaturalFault::ZoneUnsupported,
    }
}
