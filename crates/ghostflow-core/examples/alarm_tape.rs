use ghostflow_core::{
    scan::{ScanFrameV1, ScanInput},
    Capability, Module, Runtime, Value,
};
use serde_json::{json, Value as Json};
use std::{env, error::Error, fs::File, io::Read};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("tape byte bound".into());
    }
    Ok(bytes)
}
fn integer(value: &Json) -> Result<u64, Box<dyn Error>> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .ok_or("invalid u64".into())
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 4 {
        return Err("usage: alarm_tape module.gfb binding.bin binding-sha256 tape.json".into());
    }
    let module = Module::load(&read(&args[0])?)?;
    let capabilities: Vec<_> = module
        .output_fields()
        .map(|(name, ty)| Capability::new("actuator", name, ty))
        .collect();
    let mut runtime = Runtime::new(64);
    runtime.install(module, false);
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    runtime.activate()?;
    let mut driver = runtime.into_scan_driver();
    driver.activate_alarms(&read(&args[1])?, &args[2])?;
    let tape: Json = serde_json::from_slice(&read(&args[3])?)?;
    let actions = tape["actions"]
        .as_array()
        .filter(|actions| actions.len() <= 4096)
        .ok_or("action bound")?;
    for action in actions {
        let row = if let Some(frame) = action.get("frame") {
            let inputs = frame["inputs"]
                .as_array()
                .ok_or("inputs required")?
                .iter()
                .map(|input| {
                    let name = input["name"].as_str().ok_or("input name")?.to_string();
                    let value = if let Some(value) = input["value"].as_bool() {
                        Value::Bool(value)
                    } else if input["type"] == "Int" {
                        Value::Int(input["value"].as_i64().ok_or("input Int")?.try_into()?)
                    } else {
                        Value::Number(input["value"].as_f64().ok_or("input value")?)
                    };
                    Ok(ScanInput { name, value })
                })
                .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
            match driver.scan(ScanFrameV1 {
                scan_id: integer(&frame["scanId"])?,
                logical_time_ms: integer(&frame["logicalTimeMs"])?,
                inputs,
            }) {
                Ok(outcome) => {
                    json!({"accepted":true,"format":"GhostFlow/scan-outcome-v1","scanId":outcome.scan_id,"logicalTimeMs":outcome.logical_time_ms,
                    "trace":serde_json::from_str::<Json>(&outcome.trace.to_json())?})
                }
                Err(error) => json!({"accepted":false,"error":error.to_string()}),
            }
        } else {
            let packet = action["query"]
                .as_array()
                .ok_or("query byte array required")?
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .and_then(|value| u8::try_from(value).ok())
                        .ok_or("invalid query byte")
                })
                .collect::<Result<Vec<_>, _>>()?;
            match driver.query_alarms(&packet) {
                Ok(report) => serde_json::from_str::<Json>(&report)?,
                Err(error) => json!({"error":error.to_string()}),
            }
        };
        println!("{row}");
    }
    Ok(())
}
