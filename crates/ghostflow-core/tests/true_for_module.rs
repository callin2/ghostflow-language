use ghostflow_core::true_for_runtime::TrueForActivation;
use ghostflow_core::{Module, Runtime, Value};

fn string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend((value.len() as u16).to_le_bytes());
    bytes.extend(value.as_bytes());
}
fn blob(bytes: &mut Vec<u8>, value: &[u8]) {
    bytes.extend((value.len() as u32).to_le_bytes());
    bytes.extend(value);
}
#[derive(Clone)]
struct Fixture {
    format: u16,
    site: u32,
    tag: u32,
    duration: u64,
    indices: [u16; 8],
    projection: [u8; 4],
    value_type: u8,
    include: bool,
    guard: bool,
}
impl Default for Fixture {
    fn default() -> Self {
        Self {
            format: 6,
            site: 17,
            tag: 7,
            duration: 300_000,
            indices: [2, 3, 4, 5, 6, 7, 8, 9],
            projection: [59, 0, 0, 1],
            value_type: 1,
            include: true,
            guard: false,
        }
    }
}
impl Fixture {
    fn bytes(&self) -> Vec<u8> {
        let mut b = b"GFB1".to_vec();
        b.extend(self.format.to_le_bytes());
        string(&mut b, "certified");
        b.extend(1u32.to_le_bytes());
        b.extend((if self.guard { 11u16 } else { 10 }).to_le_bytes());
        for (name, ty) in [
            ("__gf_now_ms", 2),
            ("__gf_time_epoch", 2),
            ("present", 1),
            ("epoch", 2),
            ("id", 2),
            ("start", 2),
            ("end", 2),
            ("value", self.value_type),
            ("quality", 2),
            ("fault", 2),
        ] {
            string(&mut b, name);
            b.push(ty);
        }
        if self.guard {
            string(&mut b, "divisor");
            b.push(2);
        }
        b.extend(0u16.to_le_bytes()); // states
        b.extend([0, 0, 1, 0, 0, 0]); // clocks and zero point roots
        b.extend(1u16.to_le_bytes());
        string(&mut b, "control");
        b.extend(0i32.to_le_bytes());
        blob(&mut b, &[5, 1]);
        b.extend(u16::from(self.include).to_le_bytes());
        if self.include {
            b.push(2);
            b.extend(self.site.to_le_bytes());
            string(&mut b, "sustained");
            b.extend(self.tag.to_le_bytes());
            string(&mut b, "hot");
            b.extend(self.duration.to_le_bytes());
            for index in self.indices {
                b.extend(index.to_le_bytes());
            }
        }
        b.extend(0u16.to_le_bytes()); // transitions
        b.extend((if self.guard { 2u16 } else { 1 }).to_le_bytes());
        string(&mut b, "alarm");
        b.push(1);
        blob(
            &mut b,
            if self.include {
                &self.projection
            } else {
                &[1, 0]
            },
        );
        if self.guard {
            string(&mut b, "guard");
            b.push(2);
            blob(&mut b, &[33, 3, 10, 0, 22]);
        }
        b.extend(0u16.to_le_bytes());
        b
    }
}
fn rejected(f: Fixture, message: &str) {
    match Module::load(&f.bytes()) {
        Ok(_) => panic!("accepted {message}"),
        Err(error) => assert_eq!(error.message(), message),
    }
}

#[test]
fn gfb6_describes_certified_intervals_but_activation_stays_closed() {
    let module = Module::load(&Fixture::default().bytes()).unwrap();
    let requirements = module.true_for_requirements().unwrap();
    let descriptor = &requirements.strategies[0].signals[0];
    assert_eq!(
        (
            descriptor.site,
            descriptor.source_tag,
            descriptor.duration_ms
        ),
        (17, 7, 300_000)
    );
    assert_eq!(descriptor.interval_inputs, [2, 3, 4, 5, 6, 7, 8, 9]);
    let mut runtime = Runtime::new(2);
    runtime.install(module.clone(), false);
    assert_eq!(
        runtime.activate().unwrap_err().message(),
        "true_for activation requires runtime bindings"
    );
    assert_eq!(
        runtime.hot_swap(module).unwrap_err().message(),
        "true_for activation requires runtime bindings"
    );
}

#[test]
fn gfb6_rejects_binding_domain_and_projection_corruption() {
    rejected(
        Fixture {
            site: 0,
            ..Fixture::default()
        },
        "invalid prelude site",
    );
    rejected(
        Fixture {
            tag: 0,
            ..Fixture::default()
        },
        "invalid certified source tag",
    );
    for duration in [0, 9_007_199_254_740_992, u64::MAX] {
        rejected(
            Fixture {
                duration,
                ..Fixture::default()
            },
            "invalid true_for duration",
        );
    }
    rejected(
        Fixture {
            value_type: 2,
            ..Fixture::default()
        },
        "invalid certified interval input",
    );
    let mut alias = Fixture::default();
    alias.indices[2] = 3;
    rejected(alias, "duplicate certified interval input binding");
    let mut clock = Fixture::default();
    clock.indices[1] = 0;
    rejected(clock, "duplicate certified interval input binding");
    let mut missing = Fixture::default();
    missing.indices[1] = 10;
    rejected(missing, "invalid certified interval input");
    rejected(
        Fixture {
            projection: [59, 1, 0, 1],
            ..Fixture::default()
        },
        "true_for projection index",
    );
    rejected(
        Fixture {
            projection: [59, 0, 0, 7],
            ..Fixture::default()
        },
        "true_for projection field",
    );
    rejected(
        Fixture {
            projection: [59, 0, 0, 2],
            ..Fixture::default()
        },
        "intent type mismatch",
    );
    rejected(
        Fixture {
            include: false,
            ..Fixture::default()
        },
        "GFB format 6 requires true_for",
    );
}

#[test]
fn gfb6_rejects_every_truncation_and_old_format_tag_relabeling() {
    let bytes = Fixture::default().bytes();
    for end in 0..bytes.len() {
        assert!(
            Module::load(&bytes[..end]).is_err(),
            "accepted prefix {end}"
        );
    }
    rejected(
        Fixture {
            format: 5,
            ..Fixture::default()
        },
        "invalid prelude kind",
    );
}

fn activation() -> TrueForActivation {
    TrueForActivation {
        certified_bool_roots: vec![7],
        time_epoch: 7,
        max_bytes: 4_000_000,
    }
}
fn inputs(runtime: &mut Runtime, id: u64, start: u64, end: u64, present: bool) {
    for (name, value) in [
        ("__gf_time_epoch", 7),
        ("epoch", 11),
        ("id", id),
        ("start", start),
        ("end", end),
        ("quality", 1),
        ("fault", 0),
    ] {
        runtime
            .set_input(name, Value::Number(value as f64))
            .unwrap();
    }
    runtime.set_input("present", Value::Bool(present)).unwrap();
    runtime.set_input("value", Value::Bool(true)).unwrap();
}

#[test]
fn certified_native_tick_reaches_boundary_and_emits_driver_identity() {
    let mut runtime = Runtime::new(2);
    runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    runtime
        .activate_with_certified_intervals(&activation())
        .unwrap();
    inputs(&mut runtime, 1, 0, 299_999, true);
    assert_eq!(
        runtime.tick_at(299_999).unwrap().safe_intents["alarm"],
        Value::Bool(false)
    );
    inputs(&mut runtime, 2, 299_999, 300_000, true);
    let record = runtime.tick_at(300_000).unwrap();
    assert_eq!(record.safe_intents["alarm"], Value::Bool(true));
    let trace = &record.true_for_trace[0];
    assert_eq!(trace.site, 17);
    assert_eq!(trace.source_tag, 7);
    assert_eq!(trace.outcome.covered_ms, 300_000);
    assert_eq!(trace.outcome.start_ms, Some(0));
    assert_eq!(trace.outcome.end_ms, Some(300_000));
    assert!(record.to_json().contains("\"certificateId\":2"));
    inputs(&mut runtime, 2, 299_999, 300_000, false);
    assert_eq!(
        runtime.tick_at(300_001).unwrap().safe_intents["alarm"],
        Value::Bool(false)
    );
}

#[test]
fn certified_native_retries_downstream_failure_without_committing_interval() {
    let mut runtime = Runtime::new(2);
    runtime.install(
        Module::load(
            &Fixture {
                guard: true,
                ..Fixture::default()
            }
            .bytes(),
        )
        .unwrap(),
        false,
    );
    runtime
        .activate_with_certified_intervals(&activation())
        .unwrap();
    inputs(&mut runtime, 1, 0, 100, true);
    runtime.set_input("divisor", Value::Number(1.0)).unwrap();
    runtime.tick_at(100).unwrap();
    inputs(&mut runtime, 2, 100, 300_000, true);
    runtime.set_input("divisor", Value::Number(0.0)).unwrap();
    assert_eq!(
        runtime.tick_at(300_000).unwrap_err().message(),
        "division by zero"
    );
    // A different certificate with the same ID is valid only if the failed one rolled back.
    inputs(&mut runtime, 2, 100, 200, true);
    runtime.set_input("divisor", Value::Number(1.0)).unwrap();
    let retry = runtime.tick_at(300_000).unwrap();
    assert_eq!(retry.tick, 2);
    assert_eq!(retry.true_for_trace[0].outcome.covered_ms, 200);
    assert_eq!(retry.safe_intents["alarm"], Value::Bool(false));
}

#[test]
fn certified_native_activation_rejects_unbound_roots_and_insufficient_storage() {
    let mut runtime = Runtime::new(2);
    runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    assert!(runtime
        .activate_with_certified_intervals(&TrueForActivation {
            certified_bool_roots: vec![],
            ..activation()
        })
        .is_err());
    assert!(runtime
        .activate_with_certified_intervals(&TrueForActivation {
            certified_bool_roots: vec![8],
            ..activation()
        })
        .is_err());
    assert!(runtime
        .activate_with_certified_intervals(&TrueForActivation {
            max_bytes: 1,
            ..activation()
        })
        .is_err());
    runtime
        .activate_with_certified_intervals(&activation())
        .unwrap();
    assert!(runtime
        .activate_with_certified_intervals(&activation())
        .is_err());
}

#[test]
fn certified_native_exact_memory_budget_is_enforced_before_activation() {
    let module = Module::load(&Fixture::default().bytes()).unwrap();
    let mut measured = Runtime::new(2);
    measured.install(module.clone(), false);
    measured
        .activate_with_certified_intervals(&activation())
        .unwrap();
    let required = measured.certified_interval_memory_bytes().unwrap();
    let mut bounded = Runtime::new(2);
    bounded.install(module, false);
    assert_eq!(
        bounded
            .activate_with_certified_intervals(&TrueForActivation {
                max_bytes: required - 1,
                ..activation()
            })
            .unwrap_err()
            .message(),
        "temporal-budget-exceeded"
    );
    bounded
        .activate_with_certified_intervals(&TrueForActivation {
            max_bytes: required,
            ..activation()
        })
        .unwrap();
    inputs(&mut bounded, 1, 0, 300_000, true);
    assert_eq!(
        bounded.tick_at(300_000).unwrap().safe_intents["alarm"],
        Value::Bool(true)
    );
}

#[test]
fn certified_native_quality_fault_and_invalid_backfill_do_not_create_continuity() {
    use ghostflow_core::signals::SensorFault;
    let mut runtime = Runtime::new(2);
    runtime.install(
        Module::load(
            &Fixture {
                duration: 10,
                ..Fixture::default()
            }
            .bytes(),
        )
        .unwrap(),
        false,
    );
    runtime
        .activate_with_certified_intervals(&activation())
        .unwrap();
    inputs(&mut runtime, 1, 0, 9, true);
    runtime.tick_at(9).unwrap();
    inputs(&mut runtime, 2, 9, 10, true);
    runtime.set_input("quality", Value::Number(2.0)).unwrap();
    assert_eq!(
        runtime.tick_at(10).unwrap().true_for_trace[0]
            .outcome
            .covered_ms,
        0
    );
    inputs(&mut runtime, 3, 10, 20, true);
    assert_eq!(
        runtime.tick_at(20).unwrap().safe_intents["alarm"],
        Value::Bool(true)
    );
    inputs(&mut runtime, 3, 10, 20, true);
    runtime.set_input("quality", Value::Number(4.0)).unwrap();
    runtime.set_input("fault", Value::Number(1.0)).unwrap();
    assert_eq!(
        runtime.tick_at(21).unwrap().true_for_trace[0]
            .outcome
            .upstream_fault,
        Some(SensorFault::Stale)
    );
    inputs(&mut runtime, 4, 14, 30, true);
    assert!(runtime.tick_at(30).is_err());
    inputs(&mut runtime, 4, 21, 30, true);
    let retry = runtime.tick_at(30).unwrap();
    assert_eq!(retry.true_for_trace[0].outcome.covered_ms, 9);
    assert_eq!(retry.safe_intents["alarm"], Value::Bool(false));
}

#[test]
fn certified_native_rewind_stays_closed_until_checkpoint_integration() {
    let module = Module::load(&Fixture::default().bytes()).unwrap();
    let mut runtime = Runtime::new(2);
    runtime.install(module.clone(), false);
    runtime
        .activate_with_certified_intervals(&activation())
        .unwrap();
    inputs(&mut runtime, 1, 0, 300_000, true);
    runtime.tick_at(300_000).unwrap();
    assert_eq!(
        runtime.rewind(1).unwrap_err().message(),
        "true_for rewind requires checkpoint support"
    );
    assert!(runtime.replay(module, &[], 1).is_err());
    assert_eq!(runtime.journal().len(), 1);
    assert_eq!(runtime.intent("alarm"), Some(Value::Bool(true)));
}
