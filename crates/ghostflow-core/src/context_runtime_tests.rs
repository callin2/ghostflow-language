use super::*;
use context_vm::*;
use schedule_clock::{ClockSnapshot, ClockTrust};
use schedule_vm::{PulseDescriptor, ScheduleRequirements, ScheduleStrategy};

fn field(name: &str, value: Value) -> Field {
    Field {
        name: name.into(),
        value_type: value.value_type(),
        default: value,
    }
}
fn clock(epoch: u64, mono: u64, wall: u64) -> ClockSnapshot<'static> {
    ClockSnapshot {
        boot_epoch: epoch,
        monotonic_ms: mono,
        wall_ms: Some(wall),
        uncertainty_ms: Some(0),
        trust: ClockTrust::Trusted,
        source_revision: Some("clock-1"),
    }
}
fn module(descriptor: PulseDescriptor, natural: bool) -> Module {
    let mut inputs = vec![
        field("__gf_now_ms", Value::Number(0.0)),
        field("__gf_time_epoch", Value::Number(0.0)),
    ];
    if natural {
        inputs.extend([
            field("__gf_natural_7_ok", Value::Bool(false)),
            field("__gf_natural_7_value", Value::Bool(false)),
            field("__gf_natural_7_fault", Value::Number(0.0)),
        ]);
    } else {
        inputs.push(field("rhs", Value::Int(1)));
    }
    Module {
        fingerprint: 85,
        format_version: 10,
        name: "context-transaction".into(),
        version: 1,
        inputs,
        states: if natural {
            vec![]
        } else {
            vec![field("counter", Value::Int(10))]
        },
        strategies: vec![Strategy {
            name: "control".into(),
            priority: 0,
            query: vec![5, 1],
            result_trace_bound: 0,
            transitions: if natural {
                vec![]
            } else {
                vec![Transition {
                    state_index: 0,
                    expression: vec![4, 0, 0, 3, 2, 0, 28],
                }]
            },
            intents: vec![Intent {
                name: "allowed".into(),
                value_type: Type::Bool,
                expression: if natural {
                    vec![3, 3, 0]
                } else {
                    vec![58, 0, 0, 0]
                },
            }],
        }],
        constraints: vec![],
        temporal: Some(temporal_vm::TemporalRequirements {
            now_input: 0,
            time_epoch_input: 1,
            roots: vec![],
            strategies: vec![temporal_vm::TemporalStrategy {
                name: "control".into(),
                windows: vec![],
            }],
        }),
        schedules: Some(ScheduleRequirements {
            strategies: vec![ScheduleStrategy {
                name: "control".into(),
                schedules: vec![descriptor],
                prelude: vec![schedule_vm::PreludeEntry::Schedule(0)],
            }],
        }),
        true_fors: None,
        objective: None,
    }
}
fn periodic() -> Module {
    module(
        PulseDescriptor::Context(ScheduleDescriptor {
            site: 7,
            name: "periodic".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::Periodic {
                epoch_id: "instant:100".into(),
                anchor_ms: 100,
                every: DurationSetting {
                    name: "interval".into(),
                    operator_editable: true,
                    initial_ms: 10,
                    min_ms: 1,
                    max_ms: 1000,
                    step_ms: 1,
                },
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }),
        false,
    )
}
fn inputs(runtime: &mut Runtime, epoch: u64, mono: u64, rhs: Option<i32>) {
    runtime
        .set_input("__gf_now_ms", Value::Number(mono as f64))
        .unwrap();
    runtime
        .set_input("__gf_time_epoch", Value::Number(epoch as f64))
        .unwrap();
    if let Some(rhs) = rhs {
        runtime.set_input("rhs", Value::Int(rhs)).unwrap();
    }
}
fn periodic_facts() -> context_runtime::Facts {
    context_runtime::Facts {
        schedules: vec![ScheduleEvidence {
            site: 7,
            coverage_start_ms: 0,
            coverage_end_ms: 1000,
            provider: None,
            calendar: None,
            rows: vec![],
        }],
        ..Default::default()
    }
}

#[test]
fn rejected_vm_scan_rolls_back_live_event_then_durable_restore_keeps_accepted_phase() {
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    inputs(&mut runtime, 1, 0, Some(1));
    runtime
        .tick_with_context(clock(1, 0, 99), &periodic_facts())
        .unwrap();
    let before = runtime.context_checkpoint().unwrap();
    let mut facts = periodic_facts();
    facts.settings = Some(SettingsEvent {
        program_fingerprint: 85,
        event_id: "change-1".into(),
        base_revision: 0,
        position: 2,
        changes: vec![SettingChange {
            site: 7,
            value: SettingValue::Duration(20),
        }],
    });
    inputs(&mut runtime, 1, 1, Some(0));
    assert!(runtime.tick_with_context(clock(1, 1, 100), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    assert_eq!(runtime.journal.len(), 1);
    inputs(&mut runtime, 1, 1, Some(1));
    let accepted = runtime.tick_with_context(clock(1, 1, 100), &facts).unwrap();
    assert_eq!(accepted.requested_intents["allowed"], Value::Bool(false));
    let state = runtime.context_state_json().unwrap();
    assert!(state.contains("\"settingsRevision\":1"));
    assert!(state.contains("\"milliseconds\":20"));
    let checkpoint = runtime.context_checkpoint().unwrap();
    assert!(runtime.restore_context_checkpoint(&checkpoint).is_err());

    let mut reboot = Runtime::new(8);
    reboot.install(periodic(), false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let pristine = reboot.context_checkpoint().unwrap();
    let mut corrupt = checkpoint.clone();
    corrupt[20] ^= 1;
    assert!(reboot.restore_context_checkpoint(&corrupt).is_err());
    assert_eq!(reboot.context_checkpoint().unwrap(), pristine);
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    assert_eq!(reboot.context_state_json().unwrap(), state);
    inputs(&mut reboot, 2, 0, Some(1));
    assert_eq!(
        reboot
            .tick_with_context(clock(2, 0, 140), &periodic_facts())
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(false)
    );
    inputs(&mut reboot, 2, 20, Some(1));
    assert_eq!(
        reboot
            .tick_with_context(clock(2, 20, 160), &periodic_facts())
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(true)
    );
}

#[test]
fn natural_results_are_protected_and_wrong_station_rejects_without_consuming_scan() {
    let descriptor = PulseDescriptor::Natural(NaturalDescriptor {
        site: 7,
        name: "natural".into(),
        kind: natural_context::NaturalKind::Tide,
        provider: "harbor".into(),
        classification: "neap".into(),
        ok_input: 2,
        value_input: 3,
        fault_input: 4,
    });
    let binding = ProviderBinding {
        provider: "harbor".into(),
        kind: 0,
        namespace: "provider".into(),
        station: "station-1".into(),
        binding_revision: "binding-1".into(),
        location: "site-1".into(),
        timezone: "Asia/Seoul".into(),
        criteria: "classification-1".into(),
        max_uncertainty_ms: 10,
    };
    let mut runtime = Runtime::new(8);
    runtime.install(module(descriptor, true), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![binding.clone()],
        })
        .unwrap();
    assert!(runtime
        .set_input("__gf_natural_7_value", Value::Bool(true))
        .is_err());
    let observation = ProviderObservation {
        binding,
        provider_revision: "prediction-1".into(),
        coverage_start_ms: 0,
        coverage_end_ms: 100,
        expires_at_ms: 90,
        uncertainty_ms: 0,
        fault: None,
        classifications: vec!["neap".into()],
    };
    let mut facts = context_runtime::Facts {
        natural: vec![observation],
        ..Default::default()
    };
    inputs(&mut runtime, 1, 0, None);
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 0, 50), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(true)
    );
    facts.natural[0].binding.station = "wrong-station".into();
    inputs(&mut runtime, 1, 1, None);
    assert!(runtime.tick_with_context(clock(1, 1, 51), &facts).is_err());
    assert_eq!(runtime.journal.len(), 1);
    inputs(&mut runtime, 1, 1, None);
    let missing = runtime
        .tick_with_context(clock(1, 1, 51), &Default::default())
        .unwrap();
    assert_eq!(missing.tick, 2);
    assert_eq!(missing.requested_intents["allowed"], Value::Bool(false));
    assert!(missing.context_trace[0]
        .decision
        .contains("PredictionMissing"));
}

#[test]
fn one_scan_rejects_mixed_provider_revisions_before_committing_any_state() {
    let descriptor = PulseDescriptor::Natural(NaturalDescriptor {
        site: 7,
        name: "natural".into(),
        kind: natural_context::NaturalKind::Tide,
        provider: "harbor".into(),
        classification: "neap".into(),
        ok_input: 2,
        value_input: 3,
        fault_input: 4,
    });
    let mut program = module(descriptor, true);
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy
        .schedules
        .push(PulseDescriptor::Context(ScheduleDescriptor {
            site: 8,
            name: "run".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::TideRun {
                timezone: "UTC".into(),
                provider: "harbor".into(),
                high: true,
                offset_ms: 0,
                run_ms: 10,
                within_ms: 20,
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }));
    strategy
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(1));
    let binding = ProviderBinding {
        provider: "harbor".into(),
        kind: 0,
        namespace: "provider".into(),
        station: "station-1".into(),
        binding_revision: "binding-1".into(),
        location: "site-1".into(),
        timezone: "UTC".into(),
        criteria: "criteria-1".into(),
        max_uncertainty_ms: 10,
    };
    let observation = ProviderObservation {
        binding: binding.clone(),
        provider_revision: "revision-1".into(),
        coverage_start_ms: 0,
        coverage_end_ms: 100,
        expires_at_ms: 99,
        uncertainty_ms: 0,
        fault: None,
        classifications: vec!["neap".into()],
    };
    let mut facts = context_runtime::Facts {
        natural: vec![observation.clone()],
        schedules: vec![ScheduleEvidence {
            site: 8,
            coverage_start_ms: 0,
            coverage_end_ms: 100,
            provider: Some(observation),
            calendar: None,
            rows: vec![],
        }],
        ..Default::default()
    };
    let mut runtime = Runtime::new(8);
    runtime.install(program, false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![binding],
        })
        .unwrap();
    inputs(&mut runtime, 1, 0, None);
    let pristine = runtime.context_checkpoint().unwrap();
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .provider_revision = "revision-2".into();
    assert!(runtime
        .tick_with_context(clock(1, 0, 50), &facts)
        .unwrap_err()
        .to_string()
        .contains("inconsistent shared provider"));
    assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .provider_revision = "revision-1".into();
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .classifications = vec!["spring".into()];
    assert!(runtime.tick_with_context(clock(1, 0, 50), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .classifications
        .clear();
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 0, 50), &facts)
            .unwrap()
            .tick,
        1
    );
}

#[test]
fn periodic_rejects_extraneous_provider_rows_even_on_boot() {
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    inputs(&mut runtime, 1, 0, Some(1));
    let mut facts = periodic_facts();
    facts.schedules[0].rows.push(Occurrence {
        source_day: 0,
        slot_key: 0,
        minute_of_day: 0,
        fold: 0,
        event_id: String::new(),
        event_kind: 0,
        instant_ms: Some(100),
        withdrawn: false,
        provider_revision: String::new(),
        context_revision: String::new(),
    });
    assert!(runtime.tick_with_context(clock(1, 0, 99), &facts).is_err());
    assert!(runtime.journal.is_empty());
}
