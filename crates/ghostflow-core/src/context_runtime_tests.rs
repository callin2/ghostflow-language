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
        format_version: 11,
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
    let mut program = module(
        PulseDescriptor::Context(ScheduleDescriptor {
            site: 7,
            name: "periodic".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::Periodic {
                epoch_id: "instant:100".into(),
                anchor_ms: 100,
                every: DurationSetting {
                    id: 6,
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
    );
    program.inputs.extend([
        field("__gf_config_6_ok", Value::Bool(true)),
        field("__gf_config_6_value", Value::Number(10.0)),
        field("__gf_config_6_fault", Value::Number(0.0)),
    ]);
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy
        .schedules
        .push(PulseDescriptor::Config(settings_stream::ConfigDescriptor {
            id: 6,
            name: "interval".into(),
            semantic_type: "Duration".into(),
            kind: 2,
            operator_editable: true,
            initial: settings_stream::ConfigValue::Scalar(Value::Number(10.0)),
            bounds: Some((
                Value::Number(1.0),
                Value::Number(1000.0),
                Value::Number(1.0),
            )),
            grid_ms: 0,
            capacity: 0,
            ok_input: 3,
            value_input: 4,
            fault_input: 5,
        }));
    strategy
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(1));
    program
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

fn utc_range_program() -> Module {
    let mut program = module(
        PulseDescriptor::Context(ScheduleDescriptor {
            site: 7,
            name: "planned".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::UtcRange {
                starts_ms: vec![100],
                duration_ms: 100,
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }),
        false,
    );
    program.format_version = 12;
    program.strategies[0].intents[0].expression = vec![58, 0, 0, 2];
    program
}

#[test]
fn utc_range_context_failure_rolls_back_and_checkpoint_never_resumes() {
    let mut runtime = Runtime::new(8);
    runtime.install(utc_range_program(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    let pristine = runtime.context_checkpoint().unwrap();
    inputs(&mut runtime, 1, 0, Some(0));
    assert!(runtime
        .tick_with_context(clock(1, 0, 140), &periodic_facts())
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
    inputs(&mut runtime, 1, 0, Some(1));
    let admitted = runtime
        .tick_with_context(clock(1, 0, 140), &periodic_facts())
        .unwrap();
    assert_eq!(admitted.requested_intents["allowed"], Value::Bool(true));
    assert!(admitted.context_trace.iter().any(|o| o.decision == "Due"));
    let checkpoint = runtime.context_checkpoint().unwrap();
    let mut reboot = Runtime::new(8);
    reboot.install(utc_range_program(), false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    inputs(&mut reboot, 2, 0, Some(1));
    let restored = reboot
        .tick_with_context(clock(2, 0, 150), &periodic_facts())
        .unwrap();
    assert_eq!(restored.requested_intents["allowed"], Value::Bool(false));
    assert!(restored.context_trace.iter().all(|o| o.decision != "Due"));
    assert_eq!(reboot.context_checkpoint().unwrap(), checkpoint);
}

fn framed_periodic() -> scan::ScanDriver {
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    runtime.into_scan_driver()
}

fn context_frame(scan_id: u64, time: u64, rhs: i32) -> scan::ScanFrameV1 {
    scan::ScanFrameV1 {
        scan_id,
        logical_time_ms: time,
        inputs: vec![scan::ScanInput {
            name: "rhs".into(),
            value: Value::Int(rhs),
        }],
    }
}

#[test]
fn context_scan_latches_host_epoch_and_commits_periodic_intents() {
    let mut driver = framed_periodic();
    let first = driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &periodic_facts())
        .unwrap();
    assert_eq!(first.trace.inputs["__gf_now_ms"], Value::Number(0.0));
    assert_eq!(first.trace.inputs["__gf_time_epoch"], Value::Number(1.0));
    assert_eq!(first.trace.safe_intents["allowed"], Value::Bool(false));
    let due = driver
        .scan_with_context(context_frame(1, 1, 1), clock(1, 1, 100), &periodic_facts())
        .unwrap();
    assert_eq!(due.scan_id, 1);
    assert_eq!(due.logical_time_ms, 1);
    assert_eq!(due.trace.safe_intents["allowed"], Value::Bool(true));
    assert_eq!(driver.next_scan_id(), Some(2));
    assert_eq!(driver.scan_last_time_ms(), Some(1));
    assert!(driver
        .scan_with_context(context_frame(2, 0, 1), clock(1, 0, 101), &periodic_facts())
        .is_err());
    assert!(driver
        .scan_with_context(context_frame(2, 2, 1), clock(2, 2, 101), &periodic_facts())
        .is_err());
    assert_eq!(driver.next_scan_id(), Some(2));
    assert_eq!(driver.scan_last_time_ms(), Some(1));
}

#[test]
fn context_scan_rejects_inconsistent_frames_without_mutation() {
    let mut driver = framed_periodic();
    let before = driver.runtime().context_checkpoint().unwrap();
    assert!(driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 1, 99), &periodic_facts())
        .is_err());
    for name in ["__gf_now_ms", "__gf_time_epoch"] {
        let mut frame = context_frame(0, 0, 1);
        frame.inputs[0].name = name.into();
        frame.inputs[0].value = Value::Number(0.0);
        let error = driver
            .scan_with_context(frame, clock(1, 0, 99), &periodic_facts())
            .unwrap_err();
        assert_eq!(error.to_string(), "reserved input is runtime-derived");
    }
    assert!(driver
        .scan_with_context(context_frame(1, 0, 1), clock(1, 0, 99), &periodic_facts())
        .is_err());
    for epoch in [scan::SCAN_FRAME_V1_MAX_EXACT_INTEGER + 1, u64::MAX] {
        assert!(driver
            .scan_with_context(
                context_frame(0, 0, 1),
                clock(epoch, 0, 99),
                &periodic_facts()
            )
            .is_err());
    }
    assert!(driver.scan(context_frame(0, 0, 1)).is_err());
    assert_eq!(driver.runtime().context_checkpoint().unwrap(), before);
    assert_eq!(driver.next_scan_id(), Some(0));
    assert_eq!(driver.scan_last_time_ms(), None);
    assert!(driver.runtime().journal.is_empty());
    let accepted = driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &periodic_facts())
        .unwrap();
    assert_eq!((accepted.scan_id, accepted.logical_time_ms), (0, 0));
}

#[test]
fn context_scan_failure_keeps_occurrence_and_sequence_available_for_retry() {
    let mut driver = framed_periodic();
    driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &periodic_facts())
        .unwrap();
    let before = driver.runtime().context_checkpoint().unwrap();
    for (rhs, facts) in [
        (1, context_runtime::Facts::default()),
        (0, periodic_facts()),
    ] {
        assert!(driver
            .scan_with_context(context_frame(1, 1, rhs), clock(1, 1, 100), &facts)
            .is_err());
        assert_eq!(driver.runtime().context_checkpoint().unwrap(), before);
        assert_eq!(driver.runtime().state("counter"), Some(Value::Int(10)));
        assert_eq!(driver.runtime().journal.len(), 1);
        assert!(driver.runtime().inputs.iter().all(Option::is_none));
        assert_eq!(driver.next_scan_id(), Some(1));
        assert_eq!(driver.scan_last_time_ms(), Some(0));
    }
    let retry = driver
        .scan_with_context(context_frame(1, 1, 1), clock(1, 1, 100), &periodic_facts())
        .unwrap();
    assert_eq!(retry.trace.safe_intents["allowed"], Value::Bool(true));
    assert_eq!(driver.next_scan_id(), Some(2));
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
        origin: SettingsOrigin::OperatorEdit,
        event_id: "change-1".into(),
        base_revision: 0,
        position: 2,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Duration".into(),
            result: Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
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
    assert!(state.contains("\"value\":20"));
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

    let mut driver = runtime.into_scan_driver();
    let mut frame = scan::ScanFrameV1 {
        scan_id: 0,
        logical_time_ms: 2,
        inputs: vec![scan::ScanInput {
            name: "__gf_natural_7_value".into(),
            value: Value::Bool(true),
        }],
    };
    assert!(driver
        .scan_with_context(frame.clone(), clock(1, 2, 52), &Default::default())
        .is_err());
    frame.inputs.remove(0);
    let missing = driver
        .scan_with_context(frame, clock(1, 2, 52), &Default::default())
        .unwrap();
    assert_eq!(missing.trace.safe_intents["allowed"], Value::Bool(false));
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

#[test]
fn config_only_aggregate_fault_is_current_and_durable_then_recovers() {
    use settings_stream::{ConfigDescriptor, ConfigValue};
    let mut program = periodic();
    program.strategies[0].transitions.clear();
    program.strategies[0].intents[0].expression = vec![3, 3, 0]; // current Result.ok
    program.inputs.extend([
        field("__gf_config_8_ok", Value::Bool(true)),
        field("__gf_config_8_value", Value::Number(30.0)),
        field("__gf_config_8_fault", Value::Number(0.0)),
    ]);
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy.schedules.remove(0);
    strategy
        .schedules
        .push(PulseDescriptor::Config(ConfigDescriptor {
            id: 8,
            name: "duration".into(),
            semantic_type: "Duration".into(),
            kind: 2,
            operator_editable: true,
            initial: ConfigValue::Scalar(Value::Number(30.0)),
            bounds: Some((
                Value::Number(10.0),
                Value::Number(100.0),
                Value::Number(10.0),
            )),
            grid_ms: 0,
            capacity: 0,
            ok_input: 6,
            value_input: 7,
            fault_input: 8,
        }));
    strategy.prelude = vec![
        schedule_vm::PreludeEntry::Schedule(0),
        schedule_vm::PreludeEntry::Schedule(1),
    ];
    let mut runtime = Runtime::new(8);
    runtime.install(program.clone(), false);
    let activation = context_runtime::Activation {
        boot_epoch: 1,
        terminal_capacity: 16,
        bindings: vec![],
    };
    runtime.activate_with_context(&activation).unwrap();
    inputs(&mut runtime, 1, 0, Some(1));
    assert!(runtime
        .set_input("__gf_config_6_value", Value::Number(900.0))
        .is_err());
    let initial = runtime
        .tick_with_context(clock(1, 0, 100), &Default::default())
        .unwrap();
    assert_eq!(initial.inputs["__gf_config_6_value"], Value::Number(10.0));
    let mut facts = context_runtime::Facts {
        settings: Some(SettingsEvent {
            program_fingerprint: 85,
            origin: SettingsOrigin::OperatorEdit,
            event_id: "group-error".into(),
            base_revision: 0,
            position: 2,
            changes: vec![
                SettingChange {
                    id: 6,
                    semantic_type: "Duration".into(),
                    result: Ok(ConfigValue::Scalar(Value::Number(20.0))),
                },
                SettingChange {
                    id: 8,
                    semantic_type: "Duration".into(),
                    result: Ok(ConfigValue::Scalar(Value::Number(999.0))),
                },
            ],
        }),
        ..Default::default()
    };
    inputs(&mut runtime, 1, 1, Some(1));
    let fault = runtime.tick_with_context(clock(1, 1, 101), &facts).unwrap();
    assert_eq!(fault.inputs["__gf_config_6_ok"], Value::Bool(false));
    assert_eq!(fault.inputs["__gf_config_8_ok"], Value::Bool(false));
    assert_eq!(fault.requested_intents["allowed"], Value::Bool(false));
    let checkpoint = runtime.context_checkpoint().unwrap();
    let state = runtime.context_state_json().unwrap();
    assert!(state.contains("SettingsInvalid"));
    assert!(!state.contains("\"value\":10"));
    inputs(&mut runtime, 1, 2, Some(1));
    assert!(runtime.tick_with_context(clock(1, 2, 102), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), checkpoint);
    let mut reboot = Runtime::new(8);
    reboot.install(program, false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            ..activation
        })
        .unwrap();
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    assert_eq!(reboot.context_state_json().unwrap(), state);
    inputs(&mut reboot, 2, 0, Some(1));
    let still_fault = reboot
        .tick_with_context(clock(2, 0, 200), &Default::default())
        .unwrap();
    assert_eq!(still_fault.inputs["__gf_config_6_ok"], Value::Bool(false));
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "recovery".into();
    event.base_revision = 1;
    event.position = 2;
    event.changes[1].result = Ok(ConfigValue::Scalar(Value::Number(40.0)));
    inputs(&mut reboot, 2, 1, Some(1));
    let recovered = reboot.tick_with_context(clock(2, 1, 201), &facts).unwrap();
    assert_eq!(recovered.inputs["__gf_config_6_value"], Value::Number(20.0));
    assert_eq!(recovered.inputs["__gf_config_8_value"], Value::Number(40.0));
    assert_eq!(recovered.requested_intents["allowed"], Value::Bool(true));
    let before_mixed = reboot.context_checkpoint().unwrap();
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "mixed-faults".into();
    event.base_revision = 2;
    event.position = 3;
    event.changes[0].result = Err(0);
    event.changes[1].result = Err(1);
    inputs(&mut reboot, 2, 2, Some(1));
    assert!(reboot.tick_with_context(clock(2, 2, 202), &facts).is_err());
    assert_eq!(reboot.context_checkpoint().unwrap(), before_mixed);
}

#[test]
fn timeslots_consumers_share_keys_and_fault_without_historical_fallback() {
    use settings_stream::ConfigValue;
    let mut program = periodic();
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    let PulseDescriptor::Config(config) = &mut strategy.schedules[1] else {
        panic!()
    };
    config.kind = 3;
    config.semantic_type = "TimeSlots<60000ms,3>".into();
    config.initial = ConfigValue::Slots(vec![(1, 1)]);
    config.bounds = None;
    config.grid_ms = 60_000;
    config.capacity = 3;
    config.ok_input = u16::MAX;
    config.value_input = u16::MAX;
    config.fault_input = u16::MAX;
    let PulseDescriptor::Context(schedule) = &mut strategy.schedules[0] else {
        panic!()
    };
    schedule.definition = ScheduleDefinition::ConfigDailySlots {
        config_id: 6,
        timezone: "UTC".into(),
        setting: "interval".into(),
        operator_editable: true,
        grid_ms: 60_000,
        capacity: 3,
        initial_minutes: vec![1],
        dst_missing: 0,
        dst_repeated: 0,
    };
    let mut second = schedule.clone();
    second.site = 9;
    second.name = "second".into();
    strategy.schedules.push(PulseDescriptor::Context(second));
    strategy
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(2));
    let mut runtime = Runtime::new(8);
    runtime.install(program.clone(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    let mut facts = periodic_facts();
    let mut second = facts.schedules[0].clone();
    second.site = 9;
    facts.schedules.push(second);
    inputs(&mut runtime, 1, 0, Some(1));
    runtime.tick_with_context(clock(1, 0, 10), &facts).unwrap();
    facts.settings = Some(SettingsEvent {
        program_fingerprint: 85,
        origin: SettingsOrigin::OperatorEdit,
        event_id: "slots-ok".into(),
        base_revision: 0,
        position: 2,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "TimeSlots<60000ms,3>".into(),
            result: Ok(ConfigValue::Slots(vec![(1, 2), (0, 3)])),
        }],
    });
    inputs(&mut runtime, 1, 1, Some(1));
    runtime.tick_with_context(clock(1, 1, 11), &facts).unwrap();
    assert!(runtime
        .context_state_json()
        .unwrap()
        .contains("\"key\":2,\"minuteOfDay\":3"));
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "slots-fault".into();
    event.base_revision = 1;
    event.position = 3;
    event.changes[0].result = Err(1);
    inputs(&mut runtime, 1, 2, Some(1));
    let trace = runtime.tick_with_context(clock(1, 2, 12), &facts).unwrap();
    assert_eq!(
        trace
            .context_trace
            .iter()
            .filter(|o| o.decision == "Unknown(SettingsUnavailable)")
            .count(),
        2
    );
    let snapshot = runtime.context_checkpoint().unwrap();
    let state = runtime.context_state_json().unwrap();
    assert!(!state.contains("entries"));
    let mut reboot = Runtime::new(8);
    reboot.install(program, false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    reboot.restore_context_checkpoint(&snapshot).unwrap();
    assert_eq!(reboot.context_state_json().unwrap(), state);
}

#[test]
fn readonly_stream_accepts_producer_fault_and_initial_recovery_but_not_value_edit() {
    use settings_stream::ConfigValue;
    let mut program = periodic();
    program.strategies[0].transitions.clear();
    program.strategies[0].intents[0].expression = vec![3, 3, 0];
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy.schedules.remove(0);
    strategy.prelude = vec![schedule_vm::PreludeEntry::Schedule(0)];
    let PulseDescriptor::Config(config) = &mut strategy.schedules[0] else {
        panic!()
    };
    config.operator_editable = false;
    let mut runtime = Runtime::new(8);
    runtime.install(program.clone(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    let initial = runtime.context_checkpoint().unwrap();
    let mut facts = context_runtime::Facts {
        settings: Some(SettingsEvent {
            program_fingerprint: 85,
            origin: SettingsOrigin::OperatorEdit,
            event_id: "producer-outage".into(),
            base_revision: 0,
            position: 1,
            changes: vec![SettingChange {
                id: 6,
                semantic_type: String::new(),
                result: Err(1),
            }],
        }),
        ..Default::default()
    };
    inputs(&mut runtime, 1, 0, Some(1));
    assert!(runtime.tick_with_context(clock(1, 0, 0), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), initial);
    facts.settings.as_mut().unwrap().origin = SettingsOrigin::ProducerObservation;
    inputs(&mut runtime, 1, 0, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 0, 0), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(false)
    );
    let fault_snapshot = runtime.context_checkpoint().unwrap();
    let mut restored = Runtime::new(8);
    restored.install(program, false);
    restored
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    restored
        .restore_context_checkpoint(&fault_snapshot)
        .unwrap();
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "producer-recovery".into();
    event.base_revision = 1;
    event.position = 2;
    event.changes[0].semantic_type = "Duration".into();
    event.changes[0].result = Ok(ConfigValue::Scalar(Value::Number(20.0)));
    inputs(&mut runtime, 1, 1, Some(1));
    assert!(runtime.tick_with_context(clock(1, 1, 1), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), fault_snapshot);
    facts.settings.as_mut().unwrap().changes[0].result =
        Ok(ConfigValue::Scalar(Value::Number(10.0)));
    inputs(&mut runtime, 1, 1, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 1, 1), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(true)
    );
}

#[test]
fn pid_reads_staged_config_result_and_rolls_back_with_failed_vm() {
    use settings_stream::ConfigValue;
    let mut program = periodic();
    let schedule = &mut program.schedules.as_mut().unwrap().strategies[0];
    schedule.schedules.remove(0);
    let PulseDescriptor::Config(config) = &mut schedule.schedules[0] else {
        unreachable!()
    };
    config.semantic_type = "Temperature".into();
    config.initial = ConfigValue::Scalar(Value::Number(298.0));
    config.bounds = Some((
        Value::Number(290.0),
        Value::Number(310.0),
        Value::Number(1.0),
    ));
    schedule.prelude = vec![schedule_vm::PreludeEntry::Schedule(0)];
    program.strategies[0].intents[0].expression = vec![3, 3, 0];
    program.inputs.extend([
        field("measure", Value::Number(303.0)),
        field("measure_ok", Value::Bool(true)),
        field("safe_max", Value::Number(80.0)),
    ]);
    program.objective = Some(objective_vm::ObjectiveDescriptor {
        name: "temperature".into(),
        output: "vent".into(),
        measure_input: 6,
        measure_ok_input: 7,
        target_input: 4,
        target_ok_input: Some(3),
        safe_max_input: 8,
        config: controller::PidConfig {
            period_ms: 10_000,
            late_after_ms: 30_000,
            direction: controller::Direction::Reverse,
            kp: 2.0,
            ki: 0.0,
            kd: 0.0,
            bias_percent: 0.0,
            output_max_percent: 80.0,
            restart_percent: 0.0,
        },
    });
    let mut runtime = Runtime::new(8);
    runtime.install(program, false);
    runtime
        .add_capability(Capability {
            kind: "actuator".into(),
            name: "vent".into(),
            value_type: Type::Number,
        })
        .unwrap();
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let inputs = |runtime: &mut Runtime, epoch, mono, rhs| {
        inputs(runtime, epoch, mono, rhs);
        runtime
            .set_input(
                "measure",
                Value::Number(if mono == 0 {
                    298.0
                } else if mono == 42_000 {
                    304.0
                } else {
                    303.0
                }),
            )
            .unwrap();
        runtime.set_input("measure_ok", Value::Bool(true)).unwrap();
        runtime.set_input("safe_max", Value::Number(80.0)).unwrap();
    };
    let mut facts = context_runtime::Facts {
        natural: vec![],
        schedules: vec![],
        settings: None,
        accounting: vec![],
    };
    for mono in [0, 10_000] {
        inputs(&mut runtime, 1, mono, Some(1));
        runtime
            .tick_with_context(clock(1, mono, mono), &facts)
            .unwrap();
    }
    assert_eq!(runtime.safe_intents["vent"], Value::Number(10.0));
    let emission = |id: &str, revision, position, result| SettingsEvent {
        program_fingerprint: 85,
        event_id: id.into(),
        base_revision: revision,
        position,
        origin: SettingsOrigin::OperatorEdit,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Temperature".into(),
            result,
        }],
    };
    facts.settings = Some(emission(
        "new-target",
        0,
        3,
        Ok(ConfigValue::Scalar(Value::Number(300.0))),
    ));
    inputs(&mut runtime, 1, 20_000, Some(0));
    let before = runtime.context_checkpoint().unwrap();
    assert!(runtime
        .tick_with_context(clock(1, 20_000, 20_000), &facts)
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    assert_eq!(runtime.safe_intents["vent"], Value::Number(10.0));
    inputs(&mut runtime, 1, 20_000, Some(1));
    let record = runtime
        .tick_with_context(clock(1, 20_000, 20_000), &facts)
        .unwrap();
    assert_eq!(record.safe_intents["vent"], Value::Number(6.0));
    assert_eq!(record.inputs["__gf_config_6_value"], Value::Number(300.0));
    facts.settings = Some(emission(
        "target-unavailable",
        1,
        4,
        Err(settings_stream::SETTINGS_UNAVAILABLE),
    ));
    inputs(&mut runtime, 1, 21_000, Some(1));
    let record = runtime
        .tick_with_context(clock(1, 21_000, 21_000), &facts)
        .unwrap();
    assert_eq!(record.safe_intents["vent"], Value::Number(0.0));
    assert_eq!(record.safe_intents["allowed"], Value::Bool(false));
    facts.settings = Some(emission(
        "target-recovered",
        2,
        5,
        Ok(ConfigValue::Scalar(Value::Number(301.0))),
    ));
    inputs(&mut runtime, 1, 22_000, Some(1));
    runtime
        .tick_with_context(clock(1, 22_000, 22_000), &facts)
        .unwrap();
    facts.settings = None;
    inputs(&mut runtime, 1, 32_000, Some(1));
    // Existing track_safe policy reinitializes on the first recovered deadline.
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 32_000, 32_000), &facts)
            .unwrap()
            .safe_intents["vent"],
        Value::Number(0.0)
    );
    inputs(&mut runtime, 1, 42_000, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 42_000, 42_000), &facts)
            .unwrap()
            .safe_intents["vent"],
        Value::Number(2.0)
    );
}

#[test]
fn framed_context_commits_native_identity_and_retries_rejected_emissions() {
    use scan::{ScanFrameV1, ScanInput};
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let mut driver = runtime.into_scan_driver();
    let frame = |id, time, rhs| ScanFrameV1 {
        scan_id: id,
        logical_time_ms: time,
        inputs: vec![ScanInput {
            name: "rhs".into(),
            value: Value::Int(rhs),
        }],
    };
    let mut facts = periodic_facts();
    let first = driver
        .scan_with_context(frame(0, 0, 1), clock(1, 0, 99), &facts)
        .unwrap();
    assert_eq!((first.scan_id, first.logical_time_ms), (0, 0));
    let before = driver.runtime().context_checkpoint().unwrap();
    facts.settings = Some(SettingsEvent {
        program_fingerprint: 85,
        event_id: "framed-change".into(),
        base_revision: 0,
        position: 2,
        origin: SettingsOrigin::OperatorEdit,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Duration".into(),
            result: Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
        }],
    });
    assert!(driver
        .scan_with_context(frame(1, 1, 0), clock(1, 1, 100), &facts)
        .is_err());
    assert_eq!(driver.next_scan_id(), Some(1));
    assert_eq!(driver.scan_last_time_ms(), Some(0));
    assert_eq!(driver.runtime().context_checkpoint().unwrap(), before);
    assert!(driver
        .scan_with_context(frame(1, 1, 1), clock(1, 2, 101), &facts)
        .is_err());
    let mut forged = frame(1, 1, 1);
    forged.inputs[0] = ScanInput {
        name: "__gf_config_6_value".into(),
        value: Value::Number(999.0),
    };
    assert!(driver
        .scan_with_context(forged, clock(1, 1, 100), &facts)
        .is_err());
    let second = driver
        .scan_with_context(frame(1, 1, 1), clock(1, 1, 100), &facts)
        .unwrap();
    assert_eq!((second.scan_id, second.logical_time_ms), (1, 1));
    assert_eq!(
        second.trace.inputs["__gf_config_6_value"],
        Value::Number(20.0)
    );
    assert_eq!(driver.next_scan_id(), Some(2));
    assert!(driver
        .scan_with_context(frame(1, 2, 1), clock(1, 2, 101), &facts)
        .is_err());
    let snapshot = driver.runtime().context_checkpoint().unwrap();
    assert!(driver.restore_context_checkpoint(&snapshot).is_err());
    let mut reboot = Runtime::new(8);
    reboot.install(periodic(), false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let mut reboot = reboot.into_scan_driver();
    reboot.restore_context_checkpoint(&snapshot).unwrap();
    assert_eq!(
        reboot.runtime().context_state_json().unwrap(),
        driver.runtime().context_state_json().unwrap()
    );
    let new_frame = frame(0, 0, 1);
    assert_eq!(
        reboot
            .scan_with_context(new_frame, clock(2, 0, 101), &periodic_facts())
            .unwrap()
            .scan_id,
        0
    );
}
