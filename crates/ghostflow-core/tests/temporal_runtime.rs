use ghostflow_core::temporal::{RootDensity, TargetBudget};
use ghostflow_core::temporal_runtime::TemporalActivation;
use ghostflow_core::{Module, Runtime, Value};

fn string(b: &mut Vec<u8>, s: &str) {
    b.extend((s.len() as u16).to_le_bytes());
    b.extend(s.as_bytes());
}
fn blob(b: &mut Vec<u8>, v: &[u8]) {
    b.extend((v.len() as u32).to_le_bytes());
    b.extend(v);
}
fn input(i: u16) -> Vec<u8> {
    let mut b = vec![3];
    b.extend(i.to_le_bytes());
    b
}
fn integer(v: i32) -> Vec<u8> {
    let mut b = vec![23];
    b.extend(v.to_le_bytes());
    b
}
fn module(two_roots: bool, two_windows: bool) -> Module {
    variant(two_roots, two_windows, 0, 2, None)
}
fn variant(
    two_roots: bool,
    two_windows: bool,
    operation: u8,
    payload_type: u8,
    payload: Option<Vec<u8>>,
) -> Module {
    Module::load(&variant_bytes(
        two_roots,
        two_windows,
        operation,
        payload_type,
        payload,
    ))
    .unwrap()
}
fn variant_bytes(
    two_roots: bool,
    two_windows: bool,
    operation: u8,
    payload_type: u8,
    payload: Option<Vec<u8>>,
) -> Vec<u8> {
    let mut b = b"GFB1".to_vec();
    b.extend(4u16.to_le_bytes());
    string(&mut b, "window-runtime");
    b.extend(1u32.to_le_bytes());
    let mut inputs = vec![
        ("__gf_now_ms", 2),
        ("__gf_time_epoch", 2),
        ("present", 1),
        ("epoch", 2),
        ("id", 2),
        ("timestamp", 2),
        ("value", 2),
        ("ok", 1),
        ("quality", 2),
        ("tag", 2),
        ("fault", 2),
        ("divisor", 2),
        ("intent_divisor", 3),
    ];
    if two_roots {
        inputs.extend([
            ("present_b", 1),
            ("epoch_b", 2),
            ("id_b", 2),
            ("timestamp_b", 2),
        ]);
    }
    b.extend((inputs.len() as u16).to_le_bytes());
    for (name, ty) in inputs {
        string(&mut b, name);
        b.push(ty);
    }
    b.extend(1u16.to_le_bytes());
    string(&mut b, "counter");
    b.push(3);
    b.extend(0i32.to_le_bytes());
    b.extend(0u16.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend((if two_roots { 2u16 } else { 1 }).to_le_bytes());
    b.extend(1u32.to_le_bytes());
    string(&mut b, "a");
    for i in 2u16..6 {
        b.extend(i.to_le_bytes());
    }
    if two_roots {
        b.extend(2u32.to_le_bytes());
        string(&mut b, "b");
        for i in 13u16..17 {
            b.extend(i.to_le_bytes());
        }
    }
    b.extend(1u16.to_le_bytes());
    string(&mut b, "main");
    b.extend(0i32.to_le_bytes());
    blob(&mut b, &[5, 1]);
    let windows = if two_windows { 2u16 } else { 1 };
    b.extend(windows.to_le_bytes());
    for slot in 0..windows {
        b.extend((u32::from(slot) + 10).to_le_bytes());
        string(&mut b, if slot == 0 { "mean" } else { "following" });
        b.extend([operation, payload_type]);
        b.extend(1000u64.to_le_bytes());
        b.extend(500u64.to_le_bytes());
        b.extend((if two_roots { 2u16 } else { 1 }).to_le_bytes());
        b.extend(0u16.to_le_bytes());
        if two_roots {
            b.extend(1u16.to_le_bytes());
        }
        blob(&mut b, &input(7));
        let expression = payload.clone().unwrap_or_else(|| {
            let mut expression = if slot == 0 {
                input(6)
            } else {
                vec![57, 0, 0, 1]
            };
            expression.extend(input(11));
            expression.push(22);
            expression
        });
        blob(&mut b, &expression);
        for code in [input(10), input(9), input(8), input(9)] {
            blob(&mut b, &code);
        }
    }
    b.extend(1u16.to_le_bytes());
    b.extend(0u16.to_le_bytes());
    let mut next = vec![4, 0, 0];
    next.extend(integer(1));
    next.push(25);
    blob(&mut b, &next);
    b.extend(6u16.to_le_bytes());
    for (name, ty, code) in [
        ("value", payload_type, vec![57, (windows - 1) as u8, 0, 1]),
        ("ready", 1, vec![57, 0, 0, 0]),
        ("fault", 2, vec![57, 0, 0, 2]),
        ("origin", 2, vec![57, 0, 0, 3]),
        ("quality", 2, vec![57, 0, 0, 7]),
        ("after", 3, {
            let mut c = integer(1);
            c.extend(input(12));
            c.push(28);
            c
        }),
    ] {
        string(&mut b, name);
        b.push(ty);
        blob(&mut b, &code);
    }
    b.extend(0u16.to_le_bytes());
    b
}
fn activation(two_roots: bool) -> TemporalActivation {
    TemporalActivation {
        root_density: (1..=if two_roots { 2 } else { 1 })
            .map(|source_tag| RootDensity {
                source_tag,
                max_observations: 4,
                interval_ms: 1000,
            })
            .collect(),
        budget: TargetBudget {
            max_retained_samples: 32,
            max_bytes: 1_000_000,
        },
        time_epoch: 7,
    }
}
fn runtime(two_roots: bool, two_windows: bool, journal: usize) -> Runtime {
    let mut r = Runtime::new(journal);
    r.install(module(two_roots, two_windows), false);
    r.activate_with_temporal(&activation(two_roots)).unwrap();
    r
}
fn snapshot(r: &mut Runtime, now: u64, id: u64, value: f64) {
    for (name, v) in [
        ("__gf_now_ms", now as f64),
        ("__gf_time_epoch", 7.0),
        ("epoch", 1.0),
        ("id", id as f64),
        ("timestamp", now as f64),
        ("value", value),
        ("quality", 1.0),
        ("tag", 1.0),
        ("fault", 0.0),
        ("divisor", 1.0),
    ] {
        r.set_input(name, Value::Number(v)).unwrap();
    }
    r.set_input("present", Value::Bool(true)).unwrap();
    r.set_input("ok", Value::Bool(true)).unwrap();
    r.set_input("intent_divisor", Value::Int(1)).unwrap();
}
fn absent_b(r: &mut Runtime) {
    r.set_input("present_b", Value::Bool(false)).unwrap();
    for name in ["epoch_b", "id_b", "timestamp_b"] {
        r.set_input(name, Value::Number(0.0)).unwrap();
    }
}

#[test]
fn temporal_activation_requires_exact_facts_and_budgets_without_silent_restart() {
    let mut r = Runtime::new(2);
    r.install(module(false, false), false);
    let mut a = activation(false);
    a.root_density.clear();
    assert_eq!(
        r.activate_with_temporal(&a).unwrap_err().message(),
        "temporal activation root contract mismatch"
    );
    assert!(r.active_strategy().is_none());
    a = activation(false);
    a.budget.max_retained_samples = 3;
    assert_eq!(
        r.activate_with_temporal(&a).unwrap_err().message(),
        "temporal-budget-exceeded"
    );
    a = activation(false);
    a.budget.max_bytes = 1;
    assert_eq!(
        r.activate_with_temporal(&a).unwrap_err().message(),
        "temporal-budget-exceeded"
    );
    a = activation(false);
    r.activate_with_temporal(&a).unwrap();
    let bytes = r.temporal_memory_bytes().unwrap();
    eprintln!("temporal runtime reservation: roots=1 windows=1 capacity=4 journal=2 bytes={bytes}");
    assert!(bytes > 0 && bytes < a.budget.max_bytes);
    snapshot(&mut r, 0, 1, 2.0);
    r.tick().unwrap();
    assert!(r.activate_with_temporal(&a).is_err());
    assert_eq!(r.journal().len(), 1);
    assert_eq!(r.state("counter"), Some(Value::Int(1)));
    let mut smaller = Runtime::new(2);
    smaller.install(module(false, false), false);
    a.budget.max_bytes = bytes - 1;
    assert_eq!(
        smaller.activate_with_temporal(&a).unwrap_err().message(),
        "temporal-budget-exceeded"
    );
    a.budget.max_bytes = bytes;
    smaller.activate_with_temporal(&a).unwrap();
    assert_eq!(smaller.temporal_memory_bytes(), Some(bytes));
    for count in [4, 7, 8] {
        let mut multiple = Runtime::new(2);
        multiple.install(module(false, true), false);
        let mut a = activation(false);
        a.budget.max_retained_samples = count;
        let accepted = multiple.activate_with_temporal(&a);
        if count == 8 {
            accepted.unwrap();
        } else {
            assert_eq!(accepted.unwrap_err().message(), "temporal-budget-exceeded");
        }
    }
    for mut a in [activation(true), activation(false)] {
        let mut target = Runtime::new(2);
        target.install(module(false, false), false);
        if a.root_density.len() == 1 {
            a.time_epoch = 9_007_199_254_740_992;
        }
        assert!(target.activate_with_temporal(&a).is_err());
        assert!(target.active_strategy().is_none());
    }
}

#[test]
fn temporal_prelude_retains_history_on_fault_and_has_strict_freshness_and_owned_trace() {
    let mut r = runtime(false, false, 4);
    snapshot(&mut r, 0, 1, 2.0);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(2.0));
    snapshot(&mut r, 100, 2, 8.0);
    let trace = r.tick().unwrap().clone();
    assert_eq!(trace.window_trace[0].outcome.value, Some(5.0));
    assert_eq!(trace.window_trace[0].contributors.len(), 2);
    assert!(trace.to_json().contains("\"windowTrace\""));
    snapshot(&mut r, 599, 2, 999.0);
    r.set_input("present", Value::Bool(false)).unwrap();
    r.set_input("ok", Value::Bool(false)).unwrap();
    r.set_input("divisor", Value::Number(0.0)).unwrap();
    let record = r.tick().unwrap();
    assert_eq!(record.window_trace[0].outcome.value, Some(5.0));
    assert!(record.window_trace[0].outcome.upstream_fault.is_some());
    snapshot(&mut r, 600, 2, 999.0);
    r.set_input("present", Value::Bool(false)).unwrap();
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, None);
    assert_eq!(trace.window_trace[0].outcome.value, Some(5.0));
    assert_eq!(trace.window_trace[0].contributors[0].value, 2.0);
}

#[test]
fn temporal_later_intent_failure_rolls_back_every_window_and_can_retry_same_sample() {
    let mut r = runtime(false, true, 4);
    snapshot(&mut r, 0, 1, 2.0);
    r.tick().unwrap();
    snapshot(&mut r, 100, 2, 8.0);
    r.set_input("intent_divisor", Value::Int(0)).unwrap();
    assert_eq!(r.tick().unwrap_err().message(), "integer-division-by-zero");
    assert_eq!(r.journal().len(), 1);
    assert_eq!(r.state("counter"), Some(Value::Int(1)));
    r.set_input("intent_divisor", Value::Int(1)).unwrap();
    let rec = r.tick().unwrap();
    assert_eq!(rec.tick, 2);
    assert_eq!(rec.window_trace[0].outcome.value, Some(5.0));
    assert_eq!(rec.window_trace[1].outcome.value, Some(3.5));
    assert_eq!(rec.window_trace[0].outcome.revision, 2);
}

#[test]
fn temporal_duplicate_success_payload_fault_is_eager_and_fault_branch_skips_payload() {
    let mut r = runtime(false, false, 4);
    snapshot(&mut r, 0, 1, 2.0);
    r.tick().unwrap();
    snapshot(&mut r, 0, 1, 999.0);
    r.set_input("divisor", Value::Number(0.0)).unwrap();
    assert_eq!(r.tick().unwrap_err().message(), "division by zero");
    assert_eq!(r.journal().len(), 1);
    r.set_input("ok", Value::Bool(false)).unwrap();
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(2.0));
}

#[test]
fn temporal_epoch_density_future_and_derived_quality_fail_atomically() {
    let mut r = runtime(false, false, 8);
    for id in 1..=4 {
        snapshot(&mut r, 0, id, id as f64);
        r.tick().unwrap();
    }
    snapshot(&mut r, 0, 5, 50.0);
    assert_eq!(r.tick().unwrap_err().message(), "temporal-density-exceeded");
    assert_eq!(r.journal().len(), 4);
    r.set_input("epoch", Value::Number(2.0)).unwrap();
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(50.0));
    snapshot(&mut r, 100, 6, 60.0);
    r.set_input("__gf_time_epoch", Value::Number(8.0)).unwrap();
    assert_eq!(
        r.tick().unwrap_err().message(),
        "temporal time epoch mismatch"
    );
    r.set_input("__gf_time_epoch", Value::Number(7.0)).unwrap();
    r.set_input("timestamp", Value::Number(101.0)).unwrap();
    assert_eq!(
        r.tick().unwrap_err().message(),
        "temporal-future-observation"
    );
    r.set_input("timestamp", Value::Number(100.0)).unwrap();
    r.set_input("quality", Value::Number(3.0)).unwrap();
    assert_eq!(
        r.tick().unwrap_err().message(),
        "temporal derived site is not declared"
    );
    assert_eq!(r.journal().len(), 5);
}

#[test]
fn temporal_branch_selects_physical_source_and_root_epoch_removes_only_own_history() {
    let mut r = runtime(true, false, 8);
    snapshot(&mut r, 0, 1, 2.0);
    absent_b(&mut r);
    r.tick().unwrap();
    snapshot(&mut r, 100, 1, 8.0);
    r.set_input("present", Value::Bool(false)).unwrap();
    r.set_input("tag", Value::Number(2.0)).unwrap();
    r.set_input("present_b", Value::Bool(true)).unwrap();
    for (name, v) in [("epoch_b", 1.0), ("id_b", 1.0), ("timestamp_b", 100.0)] {
        r.set_input(name, Value::Number(v)).unwrap();
    }
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(5.0));
    snapshot(&mut r, 200, 0, 20.0);
    r.set_input("epoch", Value::Number(2.0)).unwrap();
    absent_b(&mut r);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(14.0));
}

#[test]
fn temporal_rewind_and_rollover_replay_restore_before_oldest_history() {
    let mut r = runtime(false, false, 2);
    for (now, id, value) in [(0, 1, 2.0), (100, 2, 8.0), (200, 3, 20.0), (300, 4, 30.0)] {
        snapshot(&mut r, now, id, value);
        r.tick().unwrap();
    }
    assert_eq!(r.journal().front().unwrap().tick, 3);
    assert_eq!(r.journal()[0].window_trace[0].outcome.value, Some(10.0));
    assert_eq!(r.journal()[1].window_trace[0].outcome.value, Some(15.0));
    assert_eq!(
        r.replay(module(false, false), &[], 2)
            .unwrap_err()
            .message(),
        "temporal replay requires explicit bindings and peak budget"
    );
    assert!(r
        .replay_with_temporal(module(false, false), &[], 2, &activation(false), 1)
        .is_err());
    let peak = 2 * r.temporal_memory_bytes().unwrap()
        + 2 * (std::mem::size_of::<Vec<ghostflow_core::temporal_runtime::WindowTrace>>()
            + std::mem::size_of::<Vec<ghostflow_core::ResultTraceEvent>>());
    assert!(r
        .replay_with_temporal(module(false, false), &[], 2, &activation(false), peak - 1)
        .is_err());
    let replay = r
        .replay_with_temporal(module(false, false), &[], 2, &activation(false), peak)
        .unwrap();
    assert_eq!(
        replay
            .iter()
            .map(|rec| rec.window_trace[0].outcome.value)
            .collect::<Vec<_>>(),
        vec![Some(10.0), Some(15.0)]
    );
    assert_eq!(replay[0].window_trace[0].contributors.len(), 3);
    assert_eq!(replay[0].tick, 3);
    r.rewind(3).unwrap();
    assert_eq!(r.journal().len(), 1);
    snapshot(&mut r, 300, 4, 30.0);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(15.0));
}

#[test]
fn temporal_unavailable_projection_is_notready_and_upstream_fault_remains_evidence() {
    let mut r = runtime(false, false, 4);
    snapshot(&mut r, 0, 1, 2.0);
    r.set_input("ok", Value::Bool(false)).unwrap();
    r.set_input("divisor", Value::Number(0.0)).unwrap();
    let record = r.tick().unwrap();
    assert_eq!(record.window_trace[0].outcome.value, None);
    assert_eq!(
        record.window_trace[0].outcome.upstream_fault.unwrap().fault,
        ghostflow_core::signals::SensorFault::Disconnected
    );
    assert_eq!(r.intent("fault"), Some(Value::Number(3.0)));
    assert_eq!(r.intent("origin"), Some(Value::Number(10.0)));
    assert_eq!(r.intent("quality"), Some(Value::Number(0.0)));
    snapshot(&mut r, 100, 2, 8.0);
    r.tick().unwrap();
    assert_eq!(r.intent("quality"), Some(Value::Number(3.0)));
    snapshot(&mut r, 600, 2, 999.0);
    r.set_input("present", Value::Bool(false)).unwrap();
    r.set_input("ok", Value::Bool(false)).unwrap();
    r.set_input("fault", Value::Number(2.0)).unwrap();
    let record = r.tick().unwrap();
    assert_eq!(record.window_trace[0].outcome.value, None);
    assert_eq!(
        record.window_trace[0].outcome.upstream_fault.unwrap().fault,
        ghostflow_core::signals::SensorFault::Invalid
    );
    assert_eq!(r.intent("fault"), Some(Value::Number(3.0)));
    assert_eq!(r.intent("origin"), Some(Value::Number(10.0)));
}

#[test]
fn temporal_expiry_rollover_checkpoint_and_faulted_retry_match_absolute_oracle() {
    let mut r = Runtime::new(2);
    r.install(module(false, false), false);
    let mut a = activation(false);
    a.root_density[0].max_observations = 3;
    r.activate_with_temporal(&a).unwrap();
    for (now, id, value, expected) in [
        (0, 1, 10.0, 10.0),
        (400, 2, 20.0, 15.0),
        (800, 3, 30.0, 20.0),
    ] {
        snapshot(&mut r, now, id, value);
        assert_eq!(
            r.tick().unwrap().window_trace[0].outcome.value,
            Some(expected)
        );
    }
    for (now, expected) in [(1000, Some(25.0)), (1300, None)] {
        snapshot(&mut r, now, 3, 999.0);
        r.set_input("present", Value::Bool(false)).unwrap();
        let w = &r.tick().unwrap().window_trace[0];
        assert_eq!(w.outcome.value, expected);
        assert_eq!(w.outcome.revision, 3);
    }
    snapshot(&mut r, 1400, 4, 50.0);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(40.0));
    let replay = r
        .replay_with_temporal(module(false, false), &[], 2, &a, 2_000_000)
        .unwrap();
    assert_eq!(
        replay
            .iter()
            .map(|rec| rec.window_trace[0].outcome.value)
            .collect::<Vec<_>>(),
        vec![None, Some(40.0)]
    );
    r.rewind(5).unwrap();
    snapshot(&mut r, 1400, 4, 90.0);
    r.set_input("intent_divisor", Value::Int(0)).unwrap();
    assert!(r.tick().is_err());
    assert_eq!(r.state("counter"), Some(Value::Int(5)));
    assert_eq!(r.journal().len(), 1);
    r.set_input("value", Value::Number(50.0)).unwrap();
    r.set_input("intent_divisor", Value::Int(1)).unwrap();
    let rec = r.tick().unwrap();
    assert_eq!(rec.tick, 6);
    assert_eq!(rec.window_trace[0].outcome.value, Some(40.0));
    assert_eq!(rec.window_trace[0].outcome.revision, 4);
}

#[test]
fn temporal_prelude_reads_old_authored_state_and_typed_min_max_and_rate_execute() {
    let mut r = Runtime::new(2);
    r.install(variant(false, false, 0, 2, Some(vec![4, 0, 0, 48])), false);
    r.activate_with_temporal(&activation(false)).unwrap();
    snapshot(&mut r, 0, 1, 999.0);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(0.0));
    snapshot(&mut r, 100, 2, 999.0);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(0.5));
    assert_eq!(r.state("counter"), Some(Value::Int(2)));
    for operation in [1, 2] {
        let mut r = Runtime::new(2);
        r.install(variant(false, false, operation, 3, Some(input(12))), false);
        r.activate_with_temporal(&activation(false)).unwrap();
        snapshot(&mut r, 0, 1, 0.0);
        r.set_input("intent_divisor", Value::Int(i32::MIN)).unwrap();
        r.tick().unwrap();
        snapshot(&mut r, 100, 2, 0.0);
        r.set_input("intent_divisor", Value::Int(i32::MAX)).unwrap();
        r.tick().unwrap();
        assert_eq!(
            r.intent("value"),
            Some(Value::Int(if operation == 1 { i32::MIN } else { i32::MAX }))
        );
    }
    let mut rate = Runtime::new(2);
    rate.install(variant(false, false, 3, 2, None), false);
    rate.activate_with_temporal(&activation(false)).unwrap();
    snapshot(&mut rate, 0, 1, 0.0);
    assert_eq!(rate.tick().unwrap().window_trace[0].outcome.value, None);
    snapshot(&mut rate, 100, 2, 5.0);
    assert_eq!(
        rate.tick().unwrap().window_trace[0].outcome.value,
        Some(50.0)
    );
}

#[test]
fn temporal_trace_json_is_complete_and_independent_of_live_runtime() {
    let trace = {
        let mut r = runtime(false, false, 2);
        snapshot(&mut r, 25, 1, 7.0);
        r.tick().unwrap().clone()
    };
    assert_eq!(
        trace.to_json().split("\"windowTrace\":").nth(1).unwrap(),
        r#"[{"site":10,"payloadType":"number","operation":"average","value":7,"quality":3,"count":1,"admissionRevision":1,"timeEpoch":7,"nowMs":25,"first":{"sourceTag":1,"epoch":1,"id":1,"timestampMs":25,"value":7},"last":{"sourceTag":1,"epoch":1,"id":1,"timestampMs":25,"value":7},"contributors":[{"sourceTag":1,"epoch":1,"id":1,"timestampMs":25,"value":7}],"upstreamFault":null}]}"#
    );
}

#[test]
fn temporal_replay_rejects_changed_backing_layouts_with_identical_descriptors() {
    let mut r = runtime(false, false, 2);
    snapshot(&mut r, 0, 1, 7.0);
    r.tick().unwrap();
    let before = r.journal()[0].to_json();
    let original = variant_bytes(false, false, 0, 2, None);
    let mut swapped = original.clone();
    let epoch = original
        .windows(7)
        .position(|bytes| bytes == b"\x05\x00epoch")
        .unwrap()
        + 2;
    let value = original
        .windows(7)
        .position(|bytes| bytes == b"\x05\x00value")
        .unwrap()
        + 2;
    swapped[epoch..epoch + 5].copy_from_slice(b"value");
    swapped[value..value + 5].copy_from_slice(b"epoch");
    let mut renamed = original;
    let counter = renamed
        .windows(9)
        .position(|bytes| bytes == b"\x07\x00counter")
        .unwrap()
        + 2;
    renamed[counter..counter + 7].copy_from_slice(b"changed");
    for bytes in [swapped, renamed] {
        let changed = Module::load(&bytes).unwrap();
        assert_eq!(
            changed.temporal_requirements(),
            module(false, false).temporal_requirements()
        );
        assert_eq!(
            r.replay_with_temporal(changed, &[], 1, &activation(false), 2_000_000)
                .unwrap_err()
                .message(),
            "incompatible temporal replay binding layout"
        );
        assert_eq!(r.journal()[0].to_json(), before);
    }
}

#[test]
fn temporal_source_trace_markers_execute_once_and_their_peak_storage_is_budgeted() {
    let plain = runtime(false, false, 2).temporal_memory_bytes().unwrap();
    let mut payload = input(6);
    payload.extend([32, 32, 56, 99, 0, 0, 0]);
    let mut r = Runtime::new(2);
    r.install(variant(false, false, 0, 2, Some(payload)), false);
    r.activate_with_temporal(&activation(false)).unwrap();
    assert_eq!(
        r.temporal_memory_bytes().unwrap() - plain,
        3 * std::mem::size_of::<ghostflow_core::ResultTraceEvent>()
    );
    snapshot(&mut r, 0, 1, 2.0);
    let rec = r.tick().unwrap();
    assert_eq!(rec.result_trace.len(), 1);
    assert_eq!(rec.result_trace[0].site, 99);
    snapshot(&mut r, 100, 2, 8.0);
    r.set_input("intent_divisor", Value::Int(0)).unwrap();
    assert!(r.tick().is_err());
    assert_eq!(r.journal().len(), 1);
    r.set_input("intent_divisor", Value::Int(1)).unwrap();
    let rec = r.tick().unwrap();
    assert_eq!(rec.result_trace.len(), 1);
    assert_eq!(rec.window_trace[0].outcome.value, Some(5.0));
}

#[test]
fn temporal_held_and_constructed_values_cannot_be_admitted_as_measurements() {
    let mut r = runtime(false, false, 4);
    for (id, quality) in [(1, 0.0), (2, 2.0)] {
        snapshot(&mut r, 0, id, 99.0);
        r.set_input("quality", Value::Number(quality)).unwrap();
        let record = r.tick().unwrap();
        assert_eq!(record.window_trace[0].outcome.count, 0);
        assert_eq!(record.window_trace[0].outcome.revision, 0);
        assert_eq!(record.window_trace[0].outcome.value, None);
    }
    snapshot(&mut r, 100, 3, 7.0);
    assert_eq!(r.tick().unwrap().window_trace[0].outcome.value, Some(7.0));
}

#[test]
fn temporal_nonfinite_aggregate_rolls_back_and_retries_the_physical_identity() {
    let mut r = Runtime::new(2);
    r.install(variant(false, false, 3, 2, None), false);
    r.activate_with_temporal(&activation(false)).unwrap();
    snapshot(&mut r, 0, 1, -f64::MAX);
    r.tick().unwrap();
    snapshot(&mut r, 1, 2, f64::MAX);
    assert_eq!(
        r.tick().unwrap_err().message(),
        "temporal-non-finite-result"
    );
    assert_eq!(r.state("counter"), Some(Value::Int(1)));
    assert_eq!(r.journal().len(), 1);
    r.set_input("value", Value::Number(-f64::MAX)).unwrap();
    let record = r.tick().unwrap();
    assert_eq!(record.tick, 2);
    assert_eq!(record.window_trace[0].outcome.value, Some(0.0));
    assert_eq!(record.window_trace[0].outcome.revision, 2);
}
