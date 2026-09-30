//! Bounded normalized Solar fact replay; admission and execution stay in Rust.
use ghostflow_core::{
    schedule_clock::{ClockSnapshot, ClockTrust},
    solar_admission::{SolarFact, SolarFactAvailability, SolarFacts},
    solar_runtime::{SolarActivation, SolarInput},
    Capability, Module, Runtime, Value,
};
use serde_json::{json, Value as Json};
use std::{env, error::Error, fs::File, io::Read};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
fn read(path: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("Solar tape exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn integer(v: &Json) -> Result<u64> {
    v.as_u64()
        .filter(|v| *v <= 9_007_199_254_740_991)
        .ok_or_else(|| "invalid exact integer".into())
}
fn optional(v: &Json) -> Result<Option<u64>> {
    if v.is_null() {
        Ok(None)
    } else {
        integer(v).map(Some)
    }
}
fn text(v: &Json) -> Result<&str> {
    v.as_str()
        .filter(|v| !v.is_empty() && v.len() <= 128)
        .ok_or_else(|| "invalid fact text".into())
}
fn array(v: &Json, max: usize) -> Result<&[Json]> {
    v.as_array()
        .filter(|v| v.len() <= max)
        .map(Vec::as_slice)
        .ok_or_else(|| "invalid bounded array".into())
}
fn main() -> Result<()> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: solar_tape MODULE TAPE".into());
    }
    let module = Module::load(&read(&args[0])?)?;
    let fields: Vec<_> = module
        .input_fields()
        .map(|(n, t)| (n.to_owned(), t))
        .collect();
    let caps: Vec<_> = module
        .output_fields()
        .map(|(n, t)| Capability::new("actuator", n, t))
        .collect();
    let tape: Json = serde_json::from_slice(&read(&args[1])?)?;
    let boot = integer(&tape["bootEpoch"])?;
    let mut runtime = Runtime::new(4096);
    runtime.install(module, false);
    for cap in caps {
        runtime.add_capability(cap)?;
    }
    runtime.activate_with_solar(&SolarActivation {
        boot_epoch: boot,
        terminal_capacity: usize::try_from(integer(&tape["terminalCapacity"])?)?,
    })?;
    for scan in array(&tape["scans"], 4096)? {
        let packet = &scan["solarFacts"];
        let c = &packet["clock"];
        let rows: Vec<Vec<SolarFact>> = array(&packet["schedules"], 128)?
            .iter()
            .map(|schedule| -> Result<Vec<SolarFact>> {
                array(&schedule["rows"], 4096)?
                    .iter()
                    .map(|r| {
                        Ok(SolarFact {
                            source_day: i32::try_from(integer(&r["sourceDay"])?)?,
                            slot_key: 0,
                            minute_of_day: 0,
                            fold: 0,
                            scheduled_wall_ms: optional(&r["scheduledWallMs"])?,
                            fallback_wall_ms: optional(&r["fallbackWallMs"])?,
                            unavailable_reason: optional(&r["unavailableReason"])?
                                .map(u8::try_from)
                                .transpose()?,
                            availability: if r["available"]
                                .as_bool()
                                .ok_or("invalid availability")?
                            {
                                SolarFactAvailability::Available
                            } else {
                                SolarFactAvailability::Unavailable
                            },
                            provider_revision: text(&r["providerRevision"])?.into(),
                            context_revision: text(&r["contextRevision"])?.into(),
                        })
                    })
                    .collect()
            })
            .collect::<Result<_>>()?;
        let facts: Vec<_> = array(&packet["schedules"], 128)?
            .iter()
            .zip(&rows)
            .map(|(s, r)| -> Result<SolarInput<'_>> {
                Ok(SolarInput {
                    site: u32::try_from(integer(&s["site"])?)?,
                    facts: SolarFacts {
                        coverage_from_wall_ms: integer(&s["coverageFromWallMs"])?,
                        coverage_to_wall_ms: integer(&s["coverageToWallMs"])?,
                        rows: r,
                    },
                })
            })
            .collect::<Result<_>>()?;
        for (name, ty) in &fields {
            if name == "__gf_now_ms" {
                runtime.set_input(name, Value::Number(integer(&c["monotonicMs"])? as f64))?;
                continue;
            }
            if name == "__gf_time_epoch" {
                runtime.set_input(name, Value::Number(boot as f64))?;
                continue;
            }
            let v = &scan["inputs"][name];
            let value = match ty {
                ghostflow_core::Type::Bool => Value::Bool(v.as_bool().ok_or("missing Bool input")?),
                ghostflow_core::Type::Int => {
                    Value::Int(i32::try_from(v.as_i64().ok_or("missing Int input")?)?)
                }
                ghostflow_core::Type::Number => Value::Number(
                    v.as_f64()
                        .filter(|v| v.is_finite())
                        .ok_or("missing Number input")?,
                ),
            };
            runtime.set_input(name, value)?;
        }
        let clock = ClockSnapshot {
            monotonic_ms: integer(&c["monotonicMs"])?,
            boot_epoch: integer(&c["bootEpoch"])?,
            wall_ms: optional(&c["wallMs"])?,
            trust: if c["trusted"].as_bool().ok_or("invalid trust")? {
                ClockTrust::Trusted
            } else {
                ClockTrust::Unknown(text(&c["unknownReason"])?)
            },
            uncertainty_ms: optional(&c["uncertaintyMs"])?,
            source_revision: c["sourceRevision"].as_str(),
        };
        match runtime.tick_with_solar(clock, &facts) {
            Ok(record) => println!(
                "{}",
                json!({"accepted":true,"trace":serde_json::from_str::<Json>(&record.to_json())?})
            ),
            Err(error) => println!("{}", json!({"accepted":false,"error":error.to_string()})),
        }
    }
    Ok(())
}
