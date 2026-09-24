//! Bounded HIL transport for explicit Periodic context frames. All decisions
//! and frame commits belong to the shared Rust ScanDriver.
use ghostflow_core::{
    context_runtime::{Activation, Facts},
    context_vm::ScheduleEvidence,
    scan::{ScanFrameV1, ScanInput},
    schedule_clock::{ClockSnapshot, ClockTrust},
    Capability, Module, Runtime, Value,
};
use serde_json::{json, Value as Json};
use std::{env, error::Error, fs::File, io::Read};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const MAX_EXACT: u64 = 9_007_199_254_740_991;

fn read(path: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("context tape/module exceeds 1 MiB".into());
    }
    Ok(bytes)
}

fn integer(value: &Json) -> Result<u64> {
    value
        .as_u64()
        .filter(|n| *n <= MAX_EXACT)
        .ok_or_else(|| "invalid exact integer".into())
}

fn array(value: &Json, maximum: usize) -> Result<&[Json]> {
    value
        .as_array()
        .filter(|v| v.len() <= maximum)
        .map(Vec::as_slice)
        .ok_or_else(|| "invalid or oversized context array".into())
}

fn optional(value: &Json) -> Result<Option<u64>> {
    if value.is_null() {
        Ok(None)
    } else {
        integer(value).map(Some)
    }
}

fn text(value: &Json) -> Result<&str> {
    value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .ok_or_else(|| "invalid context text".into())
}

fn main() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: context_tape <module.gfb> <tape.json>".into());
    }
    let module = Module::load(&read(&args[0])?)?;
    let input_types: std::collections::BTreeMap<_, _> = module
        .input_fields()
        .map(|(name, kind)| (name.to_owned(), kind))
        .collect();
    let capabilities: Vec<_> = module
        .output_fields()
        .map(|(name, kind)| Capability::new("actuator", name, kind))
        .collect();
    let tape: Json = serde_json::from_slice(&read(&args[1])?)?;
    if tape["profile"] != "context-periodic-v1" {
        return Err("unsupported context tape profile".into());
    }
    let activation = &tape["activation"];
    if !array(&activation["bindings"], 0)?.is_empty() {
        return Err("Periodic providers must be empty".into());
    }
    let mut runtime = Runtime::new(1024);
    runtime.install(module, false);
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    runtime.activate_with_context(&Activation {
        boot_epoch: integer(&activation["bootEpoch"])?,
        terminal_capacity: usize::try_from(integer(&activation["terminalCapacity"])?)?,
        bindings: vec![],
    })?;
    let mut driver = runtime.into_scan_driver();
    for step in array(&tape["steps"], 4096)? {
        let mut inputs = Vec::new();
        for input in array(&step["inputs"], 128)? {
            let name = text(&input["name"])?;
            let value = match input_types.get(name) {
                Some(ghostflow_core::Type::Bool) => {
                    Value::Bool(input["value"].as_bool().ok_or("invalid Bool input")?)
                }
                Some(ghostflow_core::Type::Int) => Value::Int(i32::try_from(
                    input["value"].as_i64().ok_or("invalid Int input")?,
                )?),
                Some(ghostflow_core::Type::Number) => Value::Number(
                    input["value"]
                        .as_f64()
                        .filter(|n| n.is_finite())
                        .ok_or("invalid Number input")?,
                ),
                None => return Err("unknown context input".into()),
            };
            inputs.push(ScanInput {
                name: name.into(),
                value,
            });
        }
        let mut schedules = Vec::new();
        for schedule in array(&step["schedules"], 128)? {
            if !schedule["provider"].is_null()
                || !schedule["calendar"].is_null()
                || !array(&schedule["rows"], 0)?.is_empty()
            {
                return Err(
                    "Periodic tape cannot supply providers, calendars or occurrence rows".into(),
                );
            }
            schedules.push(ScheduleEvidence {
                site: u32::try_from(integer(&schedule["site"])?)?,
                coverage_start_ms: integer(&schedule["coverageStartMs"])?,
                coverage_end_ms: integer(&schedule["coverageEndMs"])?,
                provider: None,
                calendar: None,
                rows: vec![],
            });
        }
        let clock = &step["clock"];
        let trusted = clock["trusted"].as_bool().ok_or("invalid clock trust")?;
        let snapshot = ClockSnapshot {
            monotonic_ms: integer(&clock["monotonicMs"])?,
            boot_epoch: integer(&clock["bootEpoch"])?,
            wall_ms: optional(&clock["wallMs"])?,
            uncertainty_ms: optional(&clock["uncertaintyMs"])?,
            trust: if trusted {
                ClockTrust::Trusted
            } else {
                ClockTrust::Unknown(text(&clock["unknownReason"])?)
            },
            source_revision: if clock["sourceRevision"].is_null() {
                None
            } else {
                Some(text(&clock["sourceRevision"])?)
            },
        };
        let outcome = driver.scan_with_context(
            ScanFrameV1 {
                scan_id: integer(&step["scanId"])?,
                logical_time_ms: integer(&step["logicalTimeMs"])?,
                inputs,
            },
            snapshot,
            &Facts {
                schedules,
                ..Default::default()
            },
        )?;
        let trace: Json = serde_json::from_str(&outcome.trace.to_json())?;
        println!(
            "{}",
            json!({ "accepted": true, "outcome": {
                "format": "GhostFlow/scan-outcome-v1", "scanId": outcome.scan_id,
                "logicalTimeMs": outcome.logical_time_ms, "trace": trace,
            }})
        );
    }
    Ok(())
}
