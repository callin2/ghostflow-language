use ghostflow_core::temporal::{RootDensity, TargetBudget};
use ghostflow_core::temporal_evidence::EvidenceIdentity;
use ghostflow_core::temporal_runtime::TemporalActivation;
use ghostflow_core::{Module, Runtime, Value};

#[test]
fn structural_plan_reports_positive_insufficient_budgets_without_activating() {
    let mut runtime = Runtime::new(2);
    runtime.install(module(), false);
    let mut tiny = profile();
    tiny.budget.max_bytes = 1;
    tiny.budget.max_retained_samples = 1;
    let planned = runtime.plan_temporal(&tiny).unwrap();
    assert!(!planned.fits_budget);
    assert_eq!(planned.retained_samples, 15);
    assert!(planned.accounted_temporal_bytes > 1);
    assert!(runtime.temporal_resource_report().is_none());
    let mut exact = profile();
    exact.budget.max_bytes = planned.accounted_temporal_bytes;
    exact.budget.max_retained_samples = planned.retained_samples;
    let valid = runtime.plan_temporal(&exact).unwrap();
    assert!(valid.fits_budget);
    exact.budget.max_bytes -= 1;
    assert!(!runtime.plan_temporal(&exact).unwrap().fits_budget);
    assert_eq!(
        runtime
            .activate_with_temporal(&exact)
            .unwrap_err()
            .message(),
        "temporal-budget-exceeded"
    );
    exact.budget.max_bytes += 1;
    runtime.activate_with_temporal(&exact).unwrap();
    assert_eq!(runtime.temporal_resource_report().unwrap(), &valid);
}

#[test]
fn replay_structural_plan_is_the_exact_core_and_framed_peak() {
    let mut runtime = runtime(&[physical(2), derived(0, 10)], &profile());
    for now in 0..3 {
        submit(&mut runtime, now, Some((now + 1, now as f64 * 10.0)));
        runtime.tick().unwrap();
    }
    let p = runtime.plan_current_temporal_replay(2, &profile()).unwrap();
    assert_eq!(
        p.required_peak_temporal_bytes,
        p.live_bytes + p.ghost_bytes + p.return_header_bytes
    );
    assert_eq!(p.frame_header_bytes, 0);
    assert_eq!(
        runtime
            .replay_current_with_temporal(2, &profile(), p.required_peak_temporal_bytes - 1)
            .unwrap_err()
            .message(),
        "temporal-budget-exceeded"
    );
    assert_eq!(
        runtime
            .replay_current_with_temporal(2, &profile(), p.required_peak_temporal_bytes)
            .unwrap()
            .len(),
        2
    );
    let mut fresh = runtime;
    submit(&mut fresh, 3, Some((4, 30.0)));
    let values = fresh.journal().back().unwrap().inputs.clone();
    let mut driver = fresh.into_scan_driver();
    use ghostflow_core::scan::{ScanFrameV1, ScanInput};
    for scan_id in 0..2 {
        let mut inputs = values.clone();
        inputs.insert("present".into(), Value::Bool(false));
        driver
            .scan(ScanFrameV1 {
                scan_id,
                logical_time_ms: 3 + scan_id,
                inputs: inputs
                    .into_iter()
                    .filter(|(name, _)| name != "__gf_now_ms")
                    .map(|(name, value)| ScanInput { name, value })
                    .collect(),
            })
            .unwrap();
    }
    let p = driver.plan_current_temporal_replay(2, &profile()).unwrap();
    assert_eq!(
        p.frame_header_bytes,
        2 * std::mem::size_of::<ghostflow_core::scan::ScanOutcomeV1>()
    );
    assert_eq!(
        p.required_peak_temporal_bytes,
        p.live_bytes + p.ghost_bytes + p.return_header_bytes + p.frame_header_bytes
    );
    assert_eq!(
        driver
            .replay_current_with_temporal(2, &profile(), p.required_peak_temporal_bytes - 1)
            .unwrap_err()
            .message(),
        "temporal-budget-exceeded"
    );
    assert_eq!(
        driver
            .replay_current_with_temporal(2, &profile(), p.required_peak_temporal_bytes)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn installed_temporal_replay_preserves_live_pending_inputs_and_rejects_bad_counts() {
    let mut runtime = runtime(&[physical(2), derived(0, 10)], &profile());
    for now in 0..3 {
        submit(&mut runtime, now, Some((now + 1, now as f64 * 10.0)));
        runtime.tick().unwrap();
    }
    let before: Vec<_> = runtime.journal().iter().map(|r| r.to_json()).collect();
    submit(&mut runtime, 3, Some((4, 30.0)));
    for count in [0, 3] {
        assert_eq!(
            runtime
                .replay_current_with_temporal(count, &profile(), 100_000_000)
                .unwrap_err()
                .message(),
            "temporal replay count exceeds retained records or is zero"
        );
    }
    let replay = runtime
        .replay_current_with_temporal(2, &profile(), 100_000_000)
        .unwrap();
    assert_eq!(
        replay.iter().map(|r| r.to_json()).collect::<Vec<_>>(),
        before
    );
    assert_eq!(
        runtime
            .journal()
            .iter()
            .map(|r| r.to_json())
            .collect::<Vec<_>>(),
        before
    );
    assert_eq!(
        runtime.tick().unwrap().window_trace[1].outcome.value,
        Some(11.25)
    );
}

#[test]
fn framed_temporal_replay_excludes_prior_legacy_ticks_and_keeps_scan_identity_after_rollover() {
    use ghostflow_core::scan::{ScanFrameV1, ScanInput, RESERVED_CLOCK_INPUT};
    let mut runtime = runtime(&[physical(2), derived(0, 10)], &profile());
    submit(&mut runtime, 0, Some((1, 0.0)));
    runtime.tick().unwrap();
    let base = runtime.journal().back().unwrap().inputs.clone();
    let mut driver = runtime.into_scan_driver();
    for scan_id in 0..3_u64 {
        let now = scan_id + 1;
        let mut inputs = base.clone();
        for (name, value) in [("id", now + 1), ("timestamp", now)] {
            inputs.insert(name.into(), Value::Number(value as f64));
        }
        inputs.insert("value".into(), Value::Number(now as f64 * 10.0));
        driver
            .scan(ScanFrameV1 {
                scan_id,
                logical_time_ms: now,
                inputs: inputs
                    .into_iter()
                    .filter(|(name, _)| name != RESERVED_CLOCK_INPUT)
                    .map(|(name, value)| ScanInput { name, value })
                    .collect(),
            })
            .unwrap();
        if scan_id == 0 {
            assert!(driver
                .replay_current_with_temporal(2, &profile(), 100_000_000)
                .is_err());
        }
    }
    let replay = driver
        .replay_current_with_temporal(2, &profile(), 100_000_000)
        .unwrap();
    assert_eq!(
        replay
            .iter()
            .map(|r| (r.scan_id, r.logical_time_ms, r.trace.tick))
            .collect::<Vec<_>>(),
        vec![(1, 2, 3), (2, 3, 4)]
    );
    assert_eq!(
        replay[0].trace.window_trace[1].outcome.value,
        Some(20.0 / 3.0)
    );
    assert_eq!(replay[1].trace.window_trace[1].outcome.value, Some(11.25));
    assert_eq!(driver.next_scan_id(), Some(3));
    assert_eq!(driver.scan_last_time_ms(), Some(3));
}

fn string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend((value.len() as u16).to_le_bytes());
    bytes.extend(value.as_bytes());
}
fn blob(bytes: &mut Vec<u8>, value: &[u8]) {
    bytes.extend((value.len() as u32).to_le_bytes());
    bytes.extend(value);
}
fn projection(slot: u16, field: u8) -> Vec<u8> {
    let mut bytes = vec![57];
    bytes.extend(slot.to_le_bytes());
    bytes.push(field);
    bytes
}
fn number(value: f64) -> Vec<u8> {
    let mut code = vec![2];
    code.extend(value.to_le_bytes());
    code
}
fn input(index: u16) -> Vec<u8> {
    let mut code = vec![3];
    code.extend(index.to_le_bytes());
    code
}
fn binary(mut left: Vec<u8>, right: Vec<u8>, op: u8) -> Vec<u8> {
    left.extend(right);
    left.push(op);
    left
}
fn choose(mut condition: Vec<u8>, yes: Vec<u8>, no: Vec<u8>) -> Vec<u8> {
    condition.push(30);
    condition.extend(((yes.len() + 3) as u16).to_le_bytes());
    condition.extend(yes);
    condition.push(31);
    condition.extend((no.len() as u16).to_le_bytes());
    condition.extend(no);
    condition
}
#[derive(Clone)]
struct Spec {
    operation: u8,
    over: u64,
    age: u64,
    roots: Vec<u16>,
    fields: [Vec<u8>; 6],
}
fn physical(over: u64) -> Spec {
    Spec {
        operation: 0,
        over,
        age: over,
        roots: vec![0],
        fields: [
            input(14),
            input(6),
            number(3.0),
            number(1.0),
            input(15),
            input(12),
        ],
    }
}
fn derived(upstream: u16, over: u64) -> Spec {
    Spec {
        operation: 0,
        over,
        age: over,
        roots: vec![0],
        fields: [
            projection(upstream, 0),
            projection(upstream, 1),
            projection(upstream, 2),
            projection(upstream, 3),
            projection(upstream, 7),
            number(f64::from(upstream) + 10.0),
        ],
    }
}
fn module() -> Module {
    Module::load(&module_bytes(&[physical(2), derived(0, 10)])).unwrap()
}
fn module_bytes(windows: &[Spec]) -> Vec<u8> {
    let mut bytes = b"GFB1".to_vec();
    bytes.extend(4_u16.to_le_bytes());
    string(&mut bytes, "nested-windows");
    bytes.extend(1_u32.to_le_bytes());
    let inputs = [
        ("__gf_now_ms", 2),
        ("__gf_time_epoch", 2),
        ("present", 1),
        ("epoch", 2),
        ("id", 2),
        ("timestamp", 2),
        ("value", 2),
        ("divisor", 3),
        ("present_b", 1),
        ("epoch_b", 2),
        ("id_b", 2),
        ("timestamp_b", 2),
        ("tag", 2),
        ("value_b", 2),
        ("ok", 1),
        ("quality", 2),
    ];
    bytes.extend((inputs.len() as u16).to_le_bytes());
    for (name, kind) in inputs {
        string(&mut bytes, name);
        bytes.push(kind);
    }
    bytes.extend(1_u16.to_le_bytes());
    string(&mut bytes, "counter");
    bytes.push(3);
    bytes.extend(0_i32.to_le_bytes());
    bytes.extend(0_u16.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(2_u16.to_le_bytes());
    bytes.extend(1_u32.to_le_bytes());
    string(&mut bytes, "root");
    for index in 2_u16..6 {
        bytes.extend(index.to_le_bytes());
    }
    bytes.extend(2_u32.to_le_bytes());
    string(&mut bytes, "b");
    for index in 8_u16..12 {
        bytes.extend(index.to_le_bytes());
    }
    bytes.extend(1_u16.to_le_bytes());
    string(&mut bytes, "main");
    bytes.extend(0_i32.to_le_bytes());
    blob(&mut bytes, &[5, 1]);
    bytes.extend((windows.len() as u16).to_le_bytes());
    for (slot, spec) in windows.iter().enumerate() {
        bytes.extend((10_u32 + slot as u32).to_le_bytes());
        string(&mut bytes, &format!("window{slot}"));
        bytes.extend([spec.operation, 2]);
        bytes.extend(spec.over.to_le_bytes());
        bytes.extend(spec.age.to_le_bytes());
        bytes.extend((spec.roots.len() as u16).to_le_bytes());
        for root in &spec.roots {
            bytes.extend(root.to_le_bytes());
        }
        for field in &spec.fields {
            blob(&mut bytes, field);
        }
    }
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(0_u16.to_le_bytes());
    blob(&mut bytes, &[4, 0, 0, 23, 1, 0, 0, 0, 25]);
    bytes.extend(2_u16.to_le_bytes());
    string(&mut bytes, "average");
    bytes.push(2);
    blob(&mut bytes, &projection(windows.len() as u16 - 1, 1));
    string(&mut bytes, "guard");
    bytes.push(3);
    blob(&mut bytes, &[23, 1, 0, 0, 0, 3, 7, 0, 28]);
    bytes.extend(0_u16.to_le_bytes()); // constraints
    bytes
}
fn submit(runtime: &mut Runtime, now: u64, sample: Option<(u64, f64)>) {
    for (name, value) in [
        ("__gf_now_ms", now as f64),
        ("__gf_time_epoch", 7.0),
        ("epoch", 1.0),
        ("id", sample.map_or(0, |s| s.0) as f64),
        ("timestamp", now as f64),
        ("value", sample.map_or(0.0, |s| s.1)),
        ("epoch_b", 1.0),
        ("id_b", 0.0),
        ("timestamp_b", 0.0),
        ("value_b", 0.0),
        ("tag", 1.0),
        ("quality", 1.0),
    ] {
        runtime.set_input(name, Value::Number(value)).unwrap();
    }
    runtime
        .set_input("present", Value::Bool(sample.is_some()))
        .unwrap();
    runtime.set_input("present_b", Value::Bool(false)).unwrap();
    runtime.set_input("ok", Value::Bool(true)).unwrap();
    runtime.set_input("divisor", Value::Int(1)).unwrap();
}
fn profile() -> TemporalActivation {
    TemporalActivation {
        time_epoch: 7,
        root_density: vec![RootDensity {
            source_tag: 1,
            max_observations: 3,
            interval_ms: 3,
        }],
        budget: TargetBudget {
            max_retained_samples: 100,
            max_bytes: 10_000_000,
        },
    }
}
fn runtime(specs: &[Spec], activation: &TemporalActivation) -> Runtime {
    let mut runtime = Runtime::new(2);
    runtime.install(Module::load(&module_bytes(specs)).unwrap(), false);
    runtime.activate_with_temporal(activation).unwrap();
    runtime
}

#[test]
fn nested_average_preserves_unit_weight_and_expiry_is_not_an_observation() {
    let mut runtime = Runtime::new(2);
    runtime.install(module(), false);
    runtime
        .activate_with_temporal(&TemporalActivation {
            time_epoch: 7,
            root_density: vec![RootDensity {
                source_tag: 1,
                max_observations: 3,
                interval_ms: 3,
            }],
            budget: TargetBudget {
                max_retained_samples: 20,
                max_bytes: 1_000_000,
            },
        })
        .unwrap();
    for (now, value) in [(0, 0.0), (1, 10.0), (2, 20.0)] {
        submit(&mut runtime, now, Some((now + 1, value)));
        runtime.tick().unwrap();
    }
    let record = runtime.journal().back().unwrap();
    assert_eq!(record.window_trace[0].outcome.value, Some(15.0));
    assert_eq!(record.window_trace[1].outcome.value, Some(20.0 / 3.0));
    assert_eq!(record.window_trace[1].outcome.count, 3);
    submit(&mut runtime, 3, None);
    let record = runtime.tick().unwrap();
    assert_eq!(record.window_trace[0].outcome.value, Some(20.0));
    assert_eq!(record.window_trace[1].outcome.value, Some(20.0 / 3.0));
    assert_eq!(record.window_trace[1].outcome.revision, 3);
}

#[test]
fn derived_observation_time_does_not_refresh_a_late_physical_sample() {
    let mut outer = derived(0, 10);
    outer.age = 2;
    let mut runtime = runtime(&[physical(10), outer], &profile());
    submit(&mut runtime, 9, Some((1, 4.0)));
    runtime.set_input("timestamp", Value::Number(0.0)).unwrap();
    let record = runtime.tick().unwrap();
    assert_eq!(record.window_trace[0].outcome.value, Some(4.0));
    assert_eq!(record.window_trace[1].outcome.value, None);
    let point = record.window_trace[1].contributors[0];
    assert_eq!((point.timestamp_ms, point.evaluated_at_ms), (0, 9));
    assert_eq!(record.window_trace[1].proof[1].timestamp_ms, 0);
}

#[test]
fn repeated_newest_timestamp_revisions_require_accumulated_capacity() {
    let mut inner = physical(20);
    inner.roots = vec![0, 1];
    let mut outer = derived(0, 5);
    outer.roots = vec![0, 1];
    let mut activation = profile();
    activation.root_density = vec![
        RootDensity {
            source_tag: 1,
            max_observations: 1,
            interval_ms: 1000,
        },
        RootDensity {
            source_tag: 2,
            max_observations: 1,
            interval_ms: 5,
        },
    ];
    activation.budget.max_retained_samples = 11;
    let mut runtime = runtime(&[inner.clone(), outer.clone()], &activation);
    submit(&mut runtime, 100, Some((1, 100.0)));
    runtime.tick().unwrap();
    for (now, id, timestamp, value) in [(101, 1, 90, 0.0), (102, 2, 95, 20.0)] {
        submit(&mut runtime, now, None);
        runtime.set_input("present_b", Value::Bool(true)).unwrap();
        for (name, value) in [
            ("id_b", id as f64),
            ("timestamp_b", timestamp as f64),
            ("tag", 2.0),
            ("value", value),
        ] {
            runtime.set_input(name, Value::Number(value)).unwrap();
        }
        runtime.tick().unwrap();
    }
    let trace = &runtime.journal().back().unwrap().window_trace[1];
    assert_eq!(trace.outcome.value, Some(190.0 / 3.0));
    assert_eq!(
        trace
            .contributors
            .iter()
            .map(|point| point.timestamp_ms)
            .collect::<Vec<_>>(),
        vec![100, 100, 100]
    );
    activation.budget.max_retained_samples = 10;
    let mut too_small = Runtime::new(2);
    too_small.install(Module::load(&module_bytes(&[inner, outer])).unwrap(), false);
    assert_eq!(
        too_small
            .activate_with_temporal(&activation)
            .unwrap_err()
            .to_string(),
        "temporal-budget-exceeded"
    );
}

#[test]
fn all_upstream_highwaters_consume_unselected_revisions_without_laundering_cached_values() {
    let mut first = physical(10);
    first.fields[5] = number(1.0);
    let mut second = physical(10);
    second.fields[5] = number(1.0);
    second.fields[1] = binary(input(6), number(4.0), 21);
    let mut outer = derived(0, 10);
    let condition = binary(input(12), number(10.0), 13);
    for field in 0..5 {
        outer.fields[field] = choose(
            condition.clone(),
            projection(0, [0, 1, 2, 3, 7][field]),
            projection(1, [0, 1, 2, 3, 7][field]),
        );
    }
    outer.fields[5] = input(12);
    let mut runtime = runtime(&[first, second, outer], &profile());
    submit(&mut runtime, 0, Some((1, 2.0)));
    runtime.set_input("tag", Value::Number(10.0)).unwrap();
    let trace = runtime.tick().unwrap();
    assert_eq!(trace.window_trace[1].outcome.value, Some(8.0));
    assert_eq!(trace.window_trace[2].outcome.value, Some(2.0));
    submit(&mut runtime, 1, None);
    runtime.set_input("tag", Value::Number(11.0)).unwrap();
    let trace = runtime.tick().unwrap();
    assert_eq!(trace.window_trace[2].outcome.value, Some(2.0));
    assert_eq!(trace.window_trace[2].outcome.count, 1);
    submit(&mut runtime, 2, Some((2, 4.0)));
    runtime.set_input("tag", Value::Number(11.0)).unwrap();
    let trace = runtime.tick().unwrap();
    assert_eq!(trace.window_trace[2].outcome.value, Some(7.0));
    assert_eq!(trace.window_trace[2].outcome.revision, 2);
    submit(&mut runtime, 3, Some((3, 40.0)));
    runtime.set_input("tag", Value::Number(11.0)).unwrap();
    runtime.set_input("quality", Value::Number(2.0)).unwrap();
    let trace = runtime.tick().unwrap();
    assert_eq!(trace.window_trace[2].outcome.revision, 2);
}

#[test]
fn source_epoch_change_invalidates_mixed_proofs_but_keeps_independent_other_root() {
    let mut mixed = physical(10);
    mixed.roots = vec![0, 1];
    mixed.fields[1] = choose(input(2), input(6), input(13));
    mixed.fields[5] = choose(input(2), number(1.0), number(2.0));
    let mut only_b = physical(10);
    only_b.roots = vec![1];
    only_b.fields[1] = input(13);
    only_b.fields[5] = number(2.0);
    let mut outer = derived(0, 10);
    outer.roots = vec![0, 1];
    let condition = binary(input(12), number(10.0), 13);
    for field in 0..5 {
        outer.fields[field] = choose(
            condition.clone(),
            projection(0, [0, 1, 2, 3, 7][field]),
            projection(1, [0, 1, 2, 3, 7][field]),
        );
    }
    outer.fields[5] = input(12);
    let mut activation = profile();
    activation.root_density = vec![
        RootDensity {
            source_tag: 1,
            max_observations: 3,
            interval_ms: 10,
        },
        RootDensity {
            source_tag: 2,
            max_observations: 3,
            interval_ms: 10,
        },
    ];
    let mut runtime = runtime(&[mixed, only_b, outer], &activation);
    submit(&mut runtime, 0, None);
    runtime.set_input("present_b", Value::Bool(true)).unwrap();
    for (name, value) in [("id_b", 1.0), ("value_b", 10.0), ("tag", 11.0)] {
        runtime.set_input(name, Value::Number(value)).unwrap();
    }
    assert_eq!(
        runtime.tick().unwrap().window_trace[2].outcome.value,
        Some(10.0)
    );
    submit(&mut runtime, 1, Some((1, 30.0)));
    runtime.set_input("tag", Value::Number(10.0)).unwrap();
    assert_eq!(
        runtime.tick().unwrap().window_trace[2].outcome.value,
        Some(15.0)
    );
    submit(&mut runtime, 2, Some((1, 50.0)));
    runtime.set_input("epoch", Value::Number(2.0)).unwrap();
    runtime.set_input("tag", Value::Number(11.0)).unwrap();
    let trace = runtime.tick().unwrap();
    assert_eq!(trace.window_trace[0].outcome.value, Some(30.0));
    assert_eq!(trace.window_trace[2].outcome.value, Some(10.0));
    assert_eq!(trace.window_trace[2].outcome.count, 1);
    assert!(trace.window_trace[2].proof.iter().all(|node| !matches!(
        node.identity,
        EvidenceIdentity::Physical { source_tag: 1, .. }
    )));
}

#[test]
fn derived_rate_needs_distinct_observation_times_and_uses_canonical_seconds() {
    let mut rate = derived(0, 10_000);
    rate.operation = 3;
    let mut activation = profile();
    activation.root_density[0] = RootDensity {
        source_tag: 1,
        max_observations: 3,
        interval_ms: 10_000,
    };
    let mut runtime = runtime(&[physical(10_000), rate], &activation);
    for id in [1, 2] {
        submit(&mut runtime, 1000, Some((id, 5.0)));
        assert_eq!(runtime.tick().unwrap().window_trace[1].outcome.value, None);
    }
    submit(&mut runtime, 3000, Some((3, 17.0)));
    let trace = runtime.tick().unwrap();
    assert_eq!(trace.window_trace[0].outcome.value, Some(9.0));
    assert_eq!(trace.window_trace[1].outcome.value, Some(2.0));
}

#[test]
fn nested_owned_proof_preserves_original_aggregate_and_transformed_edge_values() {
    let inner = physical(2);
    let mut middle = derived(0, 10);
    middle.fields[1] = binary(projection(0, 1), number(10.0), 21);
    let mut outer = derived(1, 10);
    outer.fields[1] = binary(projection(1, 1), number(1.0), 19);
    let mut runtime = runtime(&[inner, middle, outer], &profile());
    submit(&mut runtime, 0, Some((1, 2.0)));
    let owned = runtime.tick().unwrap().clone();
    drop(runtime);
    let trace = &owned.window_trace[2];
    assert_eq!(trace.outcome.value, Some(21.0));
    assert_eq!(trace.proof.len(), 3);
    assert_eq!(
        trace
            .proof
            .iter()
            .map(|node| (
                node.value,
                node.supplied_value,
                node.child_count,
                node.subtree_size
            ))
            .collect::<Vec<_>>(),
        vec![(20.0, 21.0, 1, 3), (2.0, 20.0, 1, 2), (2.0, 2.0, 0, 1)]
    );
    assert!(owned.to_json().contains("\"kind\":\"derived\""));
    assert!(owned.to_json().contains("\"kind\":\"physical\""));
}

#[test]
fn derived_exact_budget_replay_rollover_and_late_fault_retry_keep_owned_history() {
    let specs = [physical(2), derived(0, 10)];
    let mut activation = profile();
    activation.budget.max_retained_samples = 15;
    let module = Module::load(&module_bytes(&specs)).unwrap();
    let mut runtime = runtime(&specs, &activation);
    let bytes = runtime.temporal_memory_bytes().unwrap();
    activation.budget.max_bytes = bytes;
    let mut exact = Runtime::new(2);
    exact.install(module.clone(), false);
    exact.activate_with_temporal(&activation).unwrap();
    activation.budget.max_bytes = bytes - 1;
    let mut short = Runtime::new(2);
    short.install(module.clone(), false);
    assert_eq!(
        short
            .activate_with_temporal(&activation)
            .unwrap_err()
            .to_string(),
        "temporal-budget-exceeded"
    );
    activation.budget.max_bytes = bytes;
    for (now, value) in [(0, 0.0), (1, 10.0), (2, 20.0)] {
        submit(&mut runtime, now, Some((now + 1, value)));
        runtime.tick().unwrap();
    }
    submit(&mut runtime, 3, None);
    runtime.tick().unwrap();
    let replay = runtime
        .replay_with_temporal(module, &[], 2, &activation, 10_000_000)
        .unwrap();
    assert_eq!(
        replay
            .iter()
            .map(|record| record.window_trace[1].outcome.value)
            .collect::<Vec<_>>(),
        vec![Some(20.0 / 3.0); 2]
    );
    assert_eq!(
        replay[1].window_trace,
        runtime.journal().back().unwrap().window_trace
    );
    runtime.rewind(3).unwrap();
    let before = runtime.journal().back().unwrap().clone();
    submit(&mut runtime, 3, Some((4, 90.0)));
    runtime.set_input("divisor", Value::Int(0)).unwrap();
    assert_eq!(
        runtime.tick().unwrap_err().to_string(),
        "integer-division-by-zero"
    );
    assert_eq!(
        runtime.journal().back().unwrap().to_json(),
        before.to_json()
    );
    submit(&mut runtime, 3, Some((4, 30.0)));
    let record = runtime.tick().unwrap();
    assert_eq!(record.window_trace[1].outcome.value, Some(11.25));
    assert_eq!(record.window_trace[1].outcome.revision, 4);
    assert_eq!(record.state_after.get("counter"), Some(&Value::Int(4)));
}

#[test]
fn quality_markers_declare_exact_prior_dependencies_and_require_transitive_roots() {
    let mut first = physical(10);
    first.roots = vec![0, 1];
    let mut second = derived(0, 10);
    let error = Module::load(&module_bytes(&[first.clone(), second.clone()]))
        .err()
        .expect("nontransitive roots must reject");
    assert_eq!(
        error.to_string(),
        "temporal evidence roots are not transitive"
    );
    second.roots = vec![0, 1];
    let module = Module::load(&module_bytes(&[first, second])).unwrap();
    assert_eq!(
        module.temporal_requirements().unwrap().strategies[0].windows[1].upstream_windows,
        vec![0]
    );
    let mut no_marker = derived(0, 10);
    no_marker.fields[4] = number(3.0);
    let mut runtime = runtime(&[physical(10), no_marker], &profile());
    submit(&mut runtime, 0, Some((1, 2.0)));
    assert_eq!(
        runtime.tick().unwrap_err().to_string(),
        "temporal derived site is not declared"
    );
    assert!(runtime.journal().is_empty());
}

#[test]
fn duplicate_derived_payload_is_eager_but_fault_branch_retains_history_without_evaluating_it() {
    let mut outer = derived(0, 10);
    outer.fields[0] = input(14);
    outer.fields[3] = number(10.0);
    outer.fields[1] = binary(projection(0, 1), input(13), 22);
    let mut runtime = runtime(&[physical(10), outer], &profile());
    submit(&mut runtime, 0, Some((1, 8.0)));
    runtime.set_input("value_b", Value::Number(2.0)).unwrap();
    assert_eq!(
        runtime.tick().unwrap().window_trace[1].outcome.value,
        Some(4.0)
    );
    submit(&mut runtime, 0, Some((1, 8.0)));
    assert_eq!(runtime.tick().unwrap_err().message(), "division by zero");
    assert_eq!(runtime.journal().len(), 1);
    runtime.set_input("ok", Value::Bool(false)).unwrap();
    let record = runtime.tick().unwrap();
    assert_eq!(record.window_trace[1].outcome.value, Some(4.0));
    assert_eq!(record.window_trace[1].outcome.revision, 1);
    assert!(record.window_trace[1].outcome.upstream_fault.is_some());
}

#[test]
fn owned_trace_endpoints_use_compacted_proof_roots_after_admission_and_eviction() {
    let mut runtime = runtime(&[physical(2), derived(0, 3)], &profile());
    for (now, value) in [(0, 0.0), (1, 10.0), (2, 20.0), (3, 30.0)] {
        submit(&mut runtime, now, Some((now + 1, value)));
        let record = runtime.tick().unwrap();
        let trace = &record.window_trace[1];
        assert_eq!(trace.outcome.first, trace.contributors.first().copied());
        assert_eq!(trace.outcome.last, trace.contributors.last().copied());
        let first = trace.contributors.first().unwrap();
        let last = trace.contributors.last().unwrap();
        assert_eq!(first.proof_root, Some(0));
        let last_root = trace
            .contributors
            .iter()
            .take(trace.contributors.len() - 1)
            .map(|point| point.proof_size)
            .sum::<usize>();
        assert_eq!(last.proof_root, Some(last_root));
        let json = record.to_json();
        assert!(json.contains(&format!("\"first\":{{\"kind\":\"derived\",\"site\":10,\"timeEpoch\":7,\"admissionRevision\":{},\"timestampMs\":{},\"evaluatedAtMs\":{},\"value\":{},\"proofRoot\":0}}",match first.identity { EvidenceIdentity::Derived{revision,..}=>revision,_=>unreachable!() },first.timestamp_ms,first.evaluated_at_ms,first.value)));
    }
}
