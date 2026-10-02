//! Bounded HIL transport for explicit Periodic, settings, civil, calendar or Solar context frames. All decisions
//! and frame commits belong to the shared Rust ScanDriver.
use ghostflow_core::{
    context_runtime::{Activation, Facts},
    context_vm::{
        Occurrence, ProviderBinding, ScheduleEvidence, SettingChange, SettingsEvent,
        SettingsOrigin, SolarContextEvidence,
    },
    scan::{ScanFrameV1, ScanInput},
    schedule_clock::{ClockSnapshot, ClockTrust},
    settings_stream::ConfigValue,
    solar_admission::{SolarFact, SolarFactAvailability},
    work_calendar::{DayClass, DayException, WorkCalendarSnapshot},
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
                    "Bool" => ConfigValue::Scalar(Value::Bool(
                        result["value"].as_bool().ok_or("invalid Bool setting")?,
                    )),
                    "Int" => ConfigValue::Scalar(Value::Int(i32::try_from(
                        result["value"].as_i64().ok_or("invalid Int setting")?,
                    )?)),
                    ty if ty.starts_with("TimeSlots<") => {
                        let slot_value = &result["value"];
                        if text(&slot_value["kind"])? != "slots" {
                            return Err("invalid TimeSlots setting".into());
                        }
                        let mut slots = Vec::new();
                        for item in array(&slot_value["entries"], 4096)? {
                            slots.push((
                                integer(&item["key"])?,
                                u16::try_from(integer(&item["minuteOfDay"])?)?,
                            ));
                        }
                        ConfigValue::Slots(slots)
                    }
                    _ => ConfigValue::Scalar(Value::Number(
                        result["value"]
                            .as_f64()
                            .filter(|n| n.is_finite())
                            .ok_or("invalid numeric setting")?,
                    )),
                };
                (semantic_type, Ok(value))
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

fn calendar_binding(value: &Json) -> Result<ProviderBinding> {
    fields(
        value,
        &[
            "kind",
            "provider",
            "namespace",
            "station",
            "bindingRevision",
            "location",
            "timezone",
            "criteria",
            "maxUncertaintyMs",
        ],
    )?;
    if value["kind"] != "calendar" {
        return Err("calendar tape requires calendar bindings".into());
    }
    Ok(ProviderBinding {
        provider: text(&value["provider"])?.into(),
        kind: 2,
        namespace: text(&value["namespace"])?.into(),
        station: text(&value["station"])?.into(),
        binding_revision: text(&value["bindingRevision"])?.into(),
        location: text(&value["location"])?.into(),
        timezone: text(&value["timezone"])?.into(),
        criteria: text(&value["criteria"])?.into(),
        max_uncertainty_ms: integer(&value["maxUncertaintyMs"])?,
    })
}

fn day_class(value: &Json) -> Result<DayClass> {
    match text(value)? {
        "work" => Ok(DayClass::Work),
        "off" => Ok(DayClass::Off),
        _ => Err("invalid calendar day class".into()),
    }
}

fn calendar_snapshot(value: &Json) -> Result<Option<WorkCalendarSnapshot>> {
    if value.is_null() {
        return Ok(None);
    }
    fields(
        value,
        &[
            "calendarId",
            "revision",
            "timezone",
            "coveredFromDate",
            "coveredToDateExclusive",
            "expiresAtMs",
            "weeklyWorkMask",
            "holidayPolicy",
            "holidays",
            "exceptions",
        ],
    )?;
    let holidays = array(&value["holidays"], 4096)?
        .iter()
        .map(|day| Ok(i32::try_from(integer(day)?)?))
        .collect::<Result<Vec<_>>>()?;
    let exceptions = array(&value["exceptions"], 4096)?
        .iter()
        .map(|entry| {
            fields(entry, &["date", "class"])?;
            Ok(DayException {
                date: i32::try_from(integer(&entry["date"])?)?,
                class: day_class(&entry["class"])?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(WorkCalendarSnapshot {
        calendar_id: text(&value["calendarId"])?.into(),
        revision: text(&value["revision"])?.into(),
        timezone: text(&value["timezone"])?.into(),
        covered_from_date: i32::try_from(integer(&value["coveredFromDate"])?)?,
        covered_to_date_exclusive: i32::try_from(integer(&value["coveredToDateExclusive"])?)?,
        expires_at_ms: integer(&value["expiresAtMs"])?,
        weekly_work_mask: u8::try_from(integer(&value["weeklyWorkMask"])?)?,
        holiday_policy: day_class(&value["holidayPolicy"])?,
        holidays,
        exceptions,
    }))
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
    let civil_profile =
        tape["profile"] == "context-civil-v1" || tape["profile"] == "context-settings-civil-v1";
    let calendar_profile = tape["profile"] == "context-calendar-v1";
    if civil_profile || calendar_profile {
        fields(&tape, &["profile", "activation", "steps", "checkpoint"])?;
        fields(
            &tape["activation"],
            &["bootEpoch", "terminalCapacity", "bindings"],
        )?;
    }
    let settings_profile = tape["profile"] == "context-settings-v1"
        || tape["profile"] == "context-settings-civil-v1"
        || solar_profile;
    if !settings_profile
        && !civil_profile
        && !calendar_profile
        && tape["profile"] != "context-periodic-v1"
    {
        return Err("unsupported context tape profile".into());
    }
    let activation = &tape["activation"];
    let bindings = if calendar_profile {
        array(&activation["bindings"], 128)?
            .iter()
            .map(calendar_binding)
            .collect::<Result<Vec<_>>>()?
    } else {
        if !array(&activation["bindings"], 0)?.is_empty() {
            return Err("Periodic providers must be empty".into());
        }
        vec![]
    };
    let mut runtime = Runtime::new(1024);
    runtime.install(module, false);
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    runtime.activate_with_context(&Activation {
        boot_epoch: integer(&activation["bootEpoch"])?,
        terminal_capacity: usize::try_from(integer(&activation["terminalCapacity"])?)?,
        bindings,
    })?;
    if (civil_profile || calendar_profile) && !tape["checkpoint"].is_null() {
        let encoded = tape["checkpoint"]
            .as_str()
            .ok_or("invalid checkpoint hex")?;
        if encoded.len() > 2_097_152 || encoded.len() % 2 != 0 || !encoded.is_ascii() {
            return Err("invalid or oversized checkpoint hex".into());
        }
        let bytes = (0..encoded.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&encoded[i..i + 2], 16))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        runtime.restore_context_checkpoint(&bytes)?;
    }
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
        } else if civil_profile || calendar_profile {
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
                ],
            )?;
            if !array(&step["natural"], 0)?.is_empty() {
                return Err("civil tape cannot supply natural providers".into());
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
                || (!calendar_profile && !schedule["calendar"].is_null())
                || (!(civil_profile || calendar_profile)
                    && !array(&schedule["rows"], 0)?.is_empty())
            {
                return Err(
                    "Periodic tape cannot supply providers, calendars or occurrence rows".into(),
                );
            }
            if settings_profile && !civil_profile {
                return Err("settings tape cannot supply schedules".into());
            }
            let mut rows = Vec::new();
            if civil_profile || calendar_profile {
                fields(
                    schedule,
                    &[
                        "site",
                        "coverageStartMs",
                        "coverageEndMs",
                        "provider",
                        "calendar",
                        "rows",
                    ],
                )?;
                for row in array(&schedule["rows"], 4096)? {
                    fields(
                        row,
                        &[
                            "sourceDay",
                            "slotKey",
                            "minuteOfDay",
                            "fold",
                            "eventId",
                            "eventKind",
                            "instantMs",
                            "withdrawn",
                            "providerRevision",
                            "contextRevision",
                        ],
                    )?;
                    if row["eventKind"] != "civil" || row["eventId"] != "" {
                        return Err("civil tape cannot supply natural occurrence identities".into());
                    }
                    rows.push(Occurrence {
                        source_day: i32::try_from(integer(&row["sourceDay"])?)?,
                        slot_key: integer(&row["slotKey"])?,
                        minute_of_day: u16::try_from(integer(&row["minuteOfDay"])?)?,
                        fold: u8::try_from(integer(&row["fold"])?)?,
                        event_id: String::new(),
                        event_kind: 0,
                        instant_ms: optional(&row["instantMs"])?,
                        withdrawn: row["withdrawn"].as_bool().ok_or("invalid withdrawn flag")?,
                        provider_revision: text(&row["providerRevision"])?.into(),
                        context_revision: text(&row["contextRevision"])?.into(),
                    });
                }
            }
            schedules.push(ScheduleEvidence {
                site: u32::try_from(integer(&schedule["site"])?)?,
                coverage_start_ms: integer(&schedule["coverageStartMs"])?,
                coverage_end_ms: integer(&schedule["coverageEndMs"])?,
                provider: None,
                calendar: if calendar_profile {
                    calendar_snapshot(&schedule["calendar"])?
                } else {
                    None
                },
                rows,
            });
        }
        let clock = &step["clock"];
        if civil_profile || calendar_profile {
            fields(
                clock,
                &[
                    "monotonicMs",
                    "bootEpoch",
                    "wallMs",
                    "uncertaintyMs",
                    "trusted",
                    "unknownReason",
                    "sourceRevision",
                ],
            )?;
        }
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
                if civil_profile || calendar_profile {
                    record["checkpoint"] = Json::String(
                        driver
                            .runtime()
                            .context_checkpoint()?
                            .iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect(),
                    );
                }
                println!("{record}");
            }
            Err(error) if calendar_profile => println!(
                "{}",
                json!({
                    "accepted": false, "error": error.to_string(), "checkpoint": driver.runtime().context_checkpoint()?.iter()
                        .map(|byte| format!("{byte:02x}")).collect::<String>(),
                })
            ),
            Err(error) if settings_profile => println!(
                "{}",
                json!({
                    "accepted": false, "error": error.to_string(), "settings": state,
                    "checkpoint": driver.runtime().context_checkpoint()?.iter()
                        .map(|byte| format!("{byte:02x}")).collect::<String>(),
                })
            ),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
