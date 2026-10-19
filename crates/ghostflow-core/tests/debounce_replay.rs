use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn compile(code: &[u8]) -> Module {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut compiler = Command::new("node")
        .current_dir(root)
        .args(["--input-type=module", "-e", r#"
import { compileSource } from './tools/toolchain.mjs';
let code = ''; for await (const part of process.stdin) code += part;
const result = await compileSource('```ghost\n' + code + '\n```\n', { filename: 'native-debounce.ghost.md' });
process.stdout.write(result.bytes);
"#])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().expect("start public GhostFlow compiler");
    compiler.stdin.take().unwrap().write_all(code).unwrap();
    let output = compiler.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Module::load(&output.stdout).unwrap()
}

// Explicit fixture policy inhibits unavailable START and rejects an unavailable divisor.
// Good acquisition rails retain the original true/false/arithmetic and replay oracles.
fn submit_good(runtime: &mut Runtime, name: &str, value: Value) {
    for (prefix, value) in [
        ("value", value),
        ("ok", Value::Bool(true)),
        ("fault", Value::Number(0.0)),
    ] {
        runtime
            .set_input(&format!("__gf_sensor_{prefix}_{name}"), value)
            .unwrap();
    }
}

#[test]
fn public_debounce_bytecode_preserves_atomicity_ghost_replay_and_rewind() {
    let module = compile(
        br#"
control NativeDebounce {
  input start: Bool; input divisor: Number;
  signal stable = debounce(start |> recover(false), stable_for: 2s, initial: false);
  output result: Bool; output guard: Int;
  result <- stable; guard <- 1 div int_exact(divisor |> recover(0.0));
}
"#,
    );
    let fields: Vec<_> = module
        .state_fields()
        .map(|(name, ty, value)| (name.to_owned(), ty, value))
        .collect();
    assert_eq!(fields.len(), 5);
    assert!(fields
        .iter()
        .any(|(name, ty, value)| name == "__gf_debounce_stable_stable"
            && *ty == Type::Bool
            && *value == Value::Bool(false)));
    let capabilities = [
        Capability::new("actuator", "result", Type::Bool),
        Capability::new("actuator", "guard", Type::Int),
    ];
    let mut runtime = Runtime::new(8);
    runtime.install(module.clone(), false);
    for capability in &capabilities {
        runtime.add_capability(capability.clone()).unwrap();
    }
    runtime.activate().unwrap();
    for now in [0, 1999] {
        submit_good(&mut runtime, "start", Value::Bool(true));
        submit_good(&mut runtime, "divisor", Value::Number(1.0));
        runtime.tick_at(now).unwrap();
    }
    let before: Vec<_> = fields
        .iter()
        .map(|(name, _, _)| runtime.state(name))
        .collect();
    let journal_before: Vec<_> = runtime
        .journal()
        .iter()
        .map(|record| record.to_json())
        .collect();
    submit_good(&mut runtime, "start", Value::Bool(true));
    submit_good(&mut runtime, "divisor", Value::Number(0.0));
    assert_eq!(
        runtime.tick_at(2000).unwrap_err().message(),
        "integer-division-by-zero"
    );
    assert_eq!(
        fields
            .iter()
            .map(|(name, _, _)| runtime.state(name))
            .collect::<Vec<_>>(),
        before
    );
    assert_eq!(
        runtime
            .journal()
            .iter()
            .map(|record| record.to_json())
            .collect::<Vec<_>>(),
        journal_before
    );
    submit_good(&mut runtime, "start", Value::Bool(true));
    submit_good(&mut runtime, "divisor", Value::Number(1.0));
    runtime.tick_at(2000).unwrap();
    assert_eq!(
        runtime.state("__gf_debounce_stable_stable"),
        Some(Value::Bool(true))
    );
    let expected: Vec<_> = runtime
        .journal()
        .iter()
        .map(|record| record.to_json())
        .collect();
    let replay = runtime.replay(module, &capabilities, 3).unwrap();
    assert_eq!(
        replay
            .iter()
            .map(|record| record.to_json())
            .collect::<Vec<_>>(),
        expected
    );
    runtime.rewind(replay[1].tick).unwrap();
    submit_good(&mut runtime, "start", Value::Bool(true));
    submit_good(&mut runtime, "divisor", Value::Number(1.0));
    assert_eq!(runtime.tick_at(2000).unwrap().to_json(), expected[2]);
}

#[test]
fn physical_root_highwaters_are_in_native_journal_replay_and_rewind() {
    let module = compile(
        br#"
control PhysicalReplay {
  input pick: Bool;
  input a: Bool; input b: Bool;
  signal stable = debounce(if (pick |> recover(false)) then a else b, stable_for: 2s, initial: false);
  output result: Bool;
  result <- case stable { ok(value) => value; fault(_) => false; };
}
"#,
    );
    assert_eq!(module.state_fields().count(), 9);
    let capabilities = [Capability::new("actuator", "result", Type::Bool)];
    let mut runtime = Runtime::new(8);
    runtime.install(module.clone(), false);
    runtime.add_capability(capabilities[0].clone()).unwrap();
    runtime.activate().unwrap();
    let submit = |runtime: &mut Runtime, pick: bool, id: f64, timestamp: f64| {
        submit_good(runtime, "pick", Value::Bool(pick));
        for name in ["a", "b"] {
            for (prefix, value) in [
                ("value", Value::Bool(true)),
                ("ok", Value::Bool(true)),
                ("fault", Value::Number(0.0)),
                ("sample_present", Value::Bool(true)),
                ("sample_epoch", Value::Number(0.0)),
                ("sample_id", Value::Number(id)),
                ("sample_timestamp", Value::Number(timestamp)),
            ] {
                runtime
                    .set_input(&format!("__gf_sensor_{prefix}_{name}"), value)
                    .unwrap();
            }
        }
    };
    for (now, pick, id) in [(0, true, 0.0), (500, false, 10.0), (2500, true, 5.0)] {
        submit(&mut runtime, pick, id, now as f64);
        runtime.tick_at(now).unwrap();
    }
    assert_eq!(runtime.intent("result"), Some(Value::Bool(false)));
    for (name, _, _) in module
        .state_fields()
        .filter(|(name, _, _)| name.starts_with("__gf_debounce_source_id_"))
    {
        assert_eq!(runtime.state(name), Some(Value::Number(10.0)));
    }
    let expected: Vec<_> = runtime
        .journal()
        .iter()
        .map(|record| record.to_json())
        .collect();
    let replay = runtime.replay(module, &capabilities, 3).unwrap();
    assert_eq!(
        replay
            .iter()
            .map(|record| record.to_json())
            .collect::<Vec<_>>(),
        expected
    );
    runtime.rewind(replay[1].tick).unwrap();
    submit(&mut runtime, true, 5.0, 2500.0);
    assert_eq!(runtime.tick_at(2500).unwrap().to_json(), expected[2]);
}
