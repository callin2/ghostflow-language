//! Bounded HIL transport for explicit Periodic, settings or Solar context frames. All decisions
//! and frame commits belong to the shared Rust ScanDriver.
use ghostflow_core::{
    context_runtime::{Activation, Facts},
    context_vm::{
        ScheduleEvidence, SettingChange, SettingsEvent, SettingsOrigin, SolarContextEvidence,
    },
    scan::{ScanFrameV1, ScanInput},
    schedule_clock::{ClockSnapshot, ClockTrust},
    settings_stream::ConfigValue,
    solar_admission::{SolarFact, SolarFactAvailability},
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

fn settings_event(value: &Json) -> Result<Option<SettingsEvent>> {
    if value.is_null() {
        return Ok(None);
    }
    let fingerprint = value["programFingerprint"]
        .as_u64()
        .or_else(|| u64::from_str_radix(value["programFingerprint"].as_str()?, 16).ok())
        .ok_or("invalid program fingerprint")?;
    let origin = match text(&value["origin"])? {
        "operatorEdit" => SettingsOrigin::OperatorEdit,
        "producerObservation" => SettingsOrigin::ProducerObservation,
        _ => return Err("invalid settings origin".into()),
    };
    let mut changes = Vec::new();
    for change in array(&value["changes"], 128)? {
        let result = &change["result"];
        let (semantic_type, result) = match result["ok"].as_bool() {
            Some(false) => {
                let fault = match text(&result["fault"])? {
                    "SettingsInvalid" => 0,
                    "SettingsUnavailable" => 1,
                    _ => return Err("invalid settings fault".into()),
                };
                (String::new(), Err(fault))
            }
            Some(true) => {
                let semantic_type = text(&result["type"])?.to_owned();
                let value = match semantic_type.as_str() {
                    "Bool" => Value::Bool(result["value"].as_bool().ok_or("invalid Bool setting")?),
                    "Int" => Value::Int(i32::try_from(
                        result["value"].as_i64().ok_or("invalid Int setting")?,
                    )?),
                    _ => Value::Number(
                        result["value"]
                            .as_f64()
                            .filter(|n| n.is_finite())
                            .ok_or("invalid numeric setting")?,
                    ),
                };
                (semantic_type, Ok(ConfigValue::Scalar(value)))
            }
            None => return Err("invalid settings Result".into()),
        };
        changes.push(SettingChange {
            id: u32::try_from(integer(&change["configId"])?)?,
            semantic_type,
            result,
        });
    }
    Ok(Some(SettingsEvent {
        program_fingerprint: fingerprint,
        event_id: text(&value["eventId"])?.to_owned(),
        base_revision: integer(&value["baseRevision"])?,
        position: integer(&value["position"])?,
        origin,
        changes,
    }))
}

fn fields(value: &Json, allowed: &[&str]) -> Result<()> {
    let map = value.as_object().ok_or("context evidence must be object")?;
    if map.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("unexpected context evidence field".into());
    }
    Ok(())
}

fn solar_evidence(value: &Json) -> Result<SolarContextEvidence> {
    fields(
        value,
        &[
            "site",
            "timezone",
            "latitude",
            "longitude",
            "event",
            "offsetMs",
            "coverageStartMs",
            "coverageEndMs",
            "rows",
        ],
    )?;
    let coordinate = |key: &str, bound: f64| -> Result<f64> {
        value[key]
            .as_f64()
            .filter(|n| n.is_finite() && n.abs() <= bound)
            .ok_or_else(|| "invalid Solar coordinate".into())
    };
    let mut rows = Vec::new();
    let mut previous = None;
    for row in array(&value["rows"], 4096)? {
        fields(
            row,
            &[
                "sourceDay",
                "scheduledWallMs",
                "availability",
                "fallbackWallMs",
                "unavailableReason",
                "providerRevision",
                "contextRevision",
            ],
        )?;
        let day = u32::try_from(integer(&row["sourceDay"])?)?;
        if day > 2_932_896 || previous.is_some_and(|old| day <= old) {
            return Err("invalid Solar source order".into());
        }
        previous = Some(day);
        let availability = match integer(&row["availability"])? {
            0 => SolarFactAvailability::Available,
            1 => SolarFactAvailability::Unavailable,
            _ => return Err("invalid Solar availability".into()),
        };
        rows.push(SolarFact {
            source_day: i32::try_from(day)?,
            scheduled_wall_ms: optional(&row["scheduledWallMs"])?,
            availability,
            fallback_wall_ms: optional(&row["fallbackWallMs"])?,
            unavailable_reason: if row["unavailableReason"].is_null() {
                None
            } else {
                Some(u8::try_from(integer(&row["unavailableReason"])?)?)
            },
            provider_revision: text(&row["providerRevision"])?.into(),
            context_revision: text(&row["contextRevision"])?.into(),
            slot_key: 0,
            minute_of_day: 0,
            fold: 0,
        });
    }
    Ok(SolarContextEvidence {
        site: u32::try_from(integer(&value["site"])?)?,
        timezone: text(&value["timezone"])?.into(),
        latitude: coordinate("latitude", 90.0)?,
        longitude: coordinate("longitude", 180.0)?,
        event: u8::try_from(integer(&value["event"])?)?,
        offset_ms: value["offsetMs"]
            .as_i64()
            .filter(|n| n.unsigned_abs() <= MAX_EXACT)
            .ok_or("invalid Solar offset")?,
        coverage_start_ms: integer(&value["coverageStartMs"])?,
        coverage_end_ms: integer(&value["coverageEndMs"])?,
        rows,
    })
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
    let solar_profile = tape["profile"] == "context-solar-v1";
    let settings_profile = tape["profile"] == "context-settings-v1" || solar_profile;
    if !settings_profile && tape["profile"] != "context-periodic-v1" {
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
        if solar_profile {
            fields(
                step,
                &[
                    "scanId",
                    "logicalTimeMs",
                    "inputs",
                    "clock",
                    "natural",
                    "schedules",
                    "settings",
                    "solars",
                ],
            )?;
            if !array(&step["natural"], 0)?.is_empty() {
                return Err("Solar tape cannot supply natural providers".into());
            }
        } else if !step["solars"].is_null() {
            return Err("Solar facts require context-solar-v1".into());
        }
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
            if settings_profile {
                return Err("settings tape cannot supply schedules".into());
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
        let settings = if settings_profile {
            settings_event(&step["settings"])?
        } else {
            if !step["settings"].is_null() {
                return Err("Periodic tape cannot supply settings".into());
            }
            None
        };
        let solars = if solar_profile {
            array(&step["solars"], 128)?
                .iter()
                .map(solar_evidence)
                .collect::<Result<Vec<_>>>()?
        } else {
            vec![]
        };
        let result = driver.scan_with_context(
            ScanFrameV1 {
                scan_id: integer(&step["scanId"])?,
                logical_time_ms: integer(&step["logicalTimeMs"])?,
                inputs,
            },
            snapshot,
            &Facts {
                schedules,
                settings,
                solars,
                ..Default::default()
            },
        );
        let state = if settings_profile {
            Some(serde_json::from_str::<Json>(
                &driver.runtime().context_state_json()?,
            )?)
        } else {
            None
        };
        match result {
            Ok(outcome) => {
                let trace: Json = serde_json::from_str(&outcome.trace.to_json())?;
                let mut record = json!({ "accepted": true, "outcome": {
                    "format": "GhostFlow/scan-outcome-v1", "scanId": outcome.scan_id,
                    "logicalTimeMs": outcome.logical_time_ms, "trace": trace,
                }});
                if settings_profile {
                    record["settings"] = state.unwrap_or(Json::Null);
                }
                println!("{record}");
            }
            Err(error) if settings_profile => println!(
                "{}",
                json!({
                    "accepted": false, "error": error.to_string(), "settings": state,
                })
            ),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
