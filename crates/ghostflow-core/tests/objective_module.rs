use ghostflow_core::{Capability, Module, Runtime, Type, Value};

fn string(bytes: &mut Vec<u8>, text: &str) {
    bytes.extend((text.len() as u16).to_le_bytes());
    bytes.extend(text.as_bytes());
}
fn blob(bytes: &mut Vec<u8>, code: &[u8]) {
    bytes.extend((code.len() as u32).to_le_bytes());
    bytes.extend(code);
}
fn artifact(measure_index: u16, output: &str) -> Vec<u8> {
    let mut b = b"GFB1".to_vec();
    b.extend(7u16.to_le_bytes());
    string(&mut b, "greenhouse");
    b.extend(1u32.to_le_bytes());
    b.extend(6u16.to_le_bytes());
    for (name, ty) in [
        ("__gf_now_ms", 2),
        ("temperature", 2),
        ("temperature_ok", 1),
        ("target", 2),
        ("safe_max", 2),
        ("denominator", 2),
    ] {
        string(&mut b, name);
        b.push(ty);
    }
    b.extend(0u16.to_le_bytes()); // states
    b.extend(1u16.to_le_bytes()); // strategies
    string(&mut b, "main");
    b.extend(0i32.to_le_bytes());
    blob(&mut b, &[5, 1]);
    b.extend(0u16.to_le_bytes()); // transitions
    b.extend(1u16.to_le_bytes());
    string(&mut b, "diagnostic");
    b.push(2);
    let mut division = vec![2];
    division.extend(1f64.to_le_bytes());
    division.extend([3, 5, 0, 22]);
    blob(&mut b, &division);
    b.extend(0u16.to_le_bytes()); // constraints
    b.extend(1u16.to_le_bytes()); // objectives
    string(&mut b, "greenhouse_temperature");
    string(&mut b, output);
    for index in [measure_index, 2, 3, 4] {
        b.extend(index.to_le_bytes());
    }
    b.extend(10_000u64.to_le_bytes());
    b.extend(30_000u64.to_le_bytes());
    b.push(1);
    for value in [2.0f64, 0.1, 1.0, 0.0, 80.0, 0.0] {
        b.extend(value.to_le_bytes());
    }
    b
}
fn inputs(runtime: &mut Runtime, measurement: f64, denominator: f64, safe: f64) {
    for (name, value) in [
        ("temperature", Value::Number(measurement)),
        ("temperature_ok", Value::Bool(true)),
        ("target", Value::Number(298.15)),
        ("safe_max", Value::Number(safe)),
        ("denominator", Value::Number(denominator)),
    ] {
        runtime.set_input(name, value).unwrap();
    }
}
fn runtime() -> Runtime {
    let module = Module::load(&artifact(1, "roof_vent.position")).unwrap();
    assert!(module
        .output_fields()
        .any(|f| f == ("roof_vent.position", Type::Number)));
    let mut runtime = Runtime::new(8);
    runtime.install(module, false);
    runtime
        .add_capability(Capability {
            kind: "actuator".into(),
            name: "roof_vent.position".into(),
            value_type: Type::Number,
        })
        .unwrap();
    runtime.activate().unwrap();
    runtime
}

#[test]
fn gfb7_objective_executes_inside_scan_and_failed_scan_discards_pid() {
    let mut runtime = runtime();
    inputs(&mut runtime, 303.15, 1.0, 100.0);
    assert_eq!(
        runtime.tick_at(0).unwrap().requested_intents["roof_vent.position"],
        Value::Number(0.0)
    );
    inputs(&mut runtime, 304.15, 0.0, 100.0);
    assert!(runtime.tick_at(10_000).is_err());
    runtime
        .set_input("denominator", Value::Number(1.0))
        .unwrap();
    let record = runtime.tick_at(10_000).unwrap();
    let Value::Number(requested) = record.requested_intents["roof_vent.position"] else {
        panic!("numeric PID output")
    };
    assert!((requested - 7.6).abs() < 1e-9);
    assert_eq!(
        record.safe_intents["roof_vent.position"],
        Value::Number(requested)
    );
    assert_eq!(record.tick, 2);
}

#[test]
fn objective_safety_ceiling_and_quality_are_native_inputs() {
    let mut runtime = runtime();
    inputs(&mut runtime, 303.15, 1.0, 100.0);
    runtime.tick_at(0).unwrap();
    inputs(&mut runtime, 313.15, 1.0, 10.0);
    let record = runtime.tick_at(10_000).unwrap();
    assert_eq!(
        record.requested_intents["roof_vent.position"],
        Value::Number(21.0)
    );
    assert_eq!(
        record.safe_intents["roof_vent.position"],
        Value::Number(10.0)
    );
    inputs(&mut runtime, 313.15, 1.0, 100.0);
    runtime
        .set_input("temperature_ok", Value::Bool(false))
        .unwrap();
    assert_eq!(
        runtime.tick_at(10_001).unwrap().safe_intents["roof_vent.position"],
        Value::Number(0.0)
    );
}

#[test]
fn gfb7_rejects_wrong_binding_collision_truncation_and_missing_capability() {
    assert!(Module::load(&artifact(2, "roof_vent.position")).is_err());
    assert!(Module::load(&artifact(1, "diagnostic")).is_err());
    let bytes = artifact(1, "roof_vent.position");
    for end in 0..bytes.len() {
        assert!(Module::load(&bytes[..end]).is_err(), "truncation {end}");
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(Module::load(&trailing).is_err());
    let mut runtime = Runtime::new(8);
    runtime.install(Module::load(&bytes).unwrap(), false);
    assert!(runtime.activate().is_err());
}

#[test]
fn objective_rewind_cannot_restore_vm_state_without_controller_memory() {
    let mut runtime = runtime();
    inputs(&mut runtime, 303.15, 1.0, 100.0);
    runtime.tick_at(0).unwrap();
    inputs(&mut runtime, 304.15, 1.0, 100.0);
    runtime.tick_at(10_000).unwrap();
    assert!(runtime.rewind(1).is_err());
    assert_eq!(runtime.journal().len(), 2);
    assert!(runtime.activate().is_err());
    assert!(runtime
        .hot_swap(Module::load(&artifact(1, "roof_vent.position")).unwrap())
        .is_err());
    let capabilities = [Capability {
        kind: "actuator".into(),
        name: "roof_vent.position".into(),
        value_type: Type::Number,
    }];
    assert!(runtime
        .replay(
            Module::load(&artifact(1, "roof_vent.position")).unwrap(),
            &capabilities,
            2
        )
        .is_err());
}
