//! Virtual scenario transport. Node validates TOON and the artifact envelope;
//! this process owns keyboard state and submits only explicit scans to ScanDriver.
use ghostflow_core::keyboard::{KeyEvent, KeyboardMapper};
use ghostflow_core::scan::{ScanFrameV1, ScanInput};
use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use serde_json::{json, Value as Json};
use std::{collections::BTreeMap, env, error::Error, fs};

fn field<'a>(value: &'a Json, name: &str) -> Result<&'a Json, Box<dyn Error>> {
    value
        .get(name)
        .ok_or_else(|| format!("missing {name}").into())
}

fn text<'a>(value: &'a Json, name: &str) -> Result<&'a str, Box<dyn Error>> {
    field(value, name)?
        .as_str()
        .ok_or_else(|| format!("{name} must be text").into())
}

fn typed(input: &Json) -> Result<Value, Box<dyn Error>> {
    let value = field(input, "value")?;
    match text(input, "type")? {
        "Bool" => Ok(Value::Bool(value.as_bool().ok_or("Bool value required")?)),
        "Number" => Ok(Value::Number(
            value.as_f64().ok_or("Number value required")?,
        )),
        "Int" => Ok(Value::Int(i32::try_from(
            value.as_i64().ok_or("Int value required")?,
        )?)),
        _ => Err("invalid input type".into()),
    }
}

fn output_capabilities(
    fields: impl IntoIterator<Item = (String, Type)>,
) -> Result<Vec<Capability>, Box<dyn Error>> {
    let mut unique = BTreeMap::new();
    for (name, value_type) in fields {
        if let Some(existing) = unique.get(&name) {
            if *existing != value_type {
                return Err(format!("conflicting output types for {name}").into());
            }
        } else {
            unique.insert(name, value_type);
        }
    }
    Ok(unique
        .into_iter()
        .map(|(name, value_type)| Capability::new("actuator", name, value_type))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ghostflow_core::Type;

    #[test]
    fn output_capabilities_deduplicate_identical_fields() {
        let capabilities = output_capabilities([
            ("pump".to_owned(), Type::Bool),
            ("pump".to_owned(), Type::Bool),
        ])
        .unwrap();

        assert_eq!(capabilities, vec![Capability::new("actuator", "pump", Type::Bool)]);
    }

    #[test]
    fn output_capabilities_reject_conflicting_types() {
        let error = output_capabilities([
            ("pump".to_owned(), Type::Bool),
            ("pump".to_owned(), Type::Number),
        ])
        .unwrap_err();

        assert!(error.to_string().contains("conflicting output types for pump"));
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: scenario_scan <module.gfb> <actions.json>".into());
    }
    let module = Module::load(&fs::read(&args[0])?)?;
    let capabilities = output_capabilities(
        module
            .output_fields()
            .map(|(name, value_type)| (name.to_owned(), value_type)),
    )?;
    let mut runtime = Runtime::new(256);
    runtime.install(module, false);
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    if let Err(error) = runtime.activate() {
        eprintln!("activation: {error}");
        std::process::exit(1);
    }
    let mut driver = runtime.into_scan_driver();
    let scenario: Json = serde_json::from_slice(&fs::read(&args[1])?)?;
    let mut bindings: [Option<String>; 8] = Default::default();
    for item in field(&scenario, "keyBindings")?
        .as_array()
        .ok_or("keyBindings must be array")?
    {
        let key = field(item, "key")?.as_u64().ok_or("key must be integer")?;
        if !(1..=8).contains(&key) {
            return Err("key must be 1..8".into());
        }
        bindings[(key - 1) as usize] = Some(text(item, "input")?.to_owned());
    }
    let mut keyboard = KeyboardMapper::new(bindings)?;
    let mut inputs = BTreeMap::new();
    for item in field(&scenario, "initialInputs")?
        .as_array()
        .ok_or("initialInputs must be array")?
    {
        inputs.insert(text(item, "name")?.to_owned(), typed(item)?);
    }
    // A bound input may start true; seed mapper state from the complete initial frame.
    for key in 1..=8 {
        if let Some(name) = keyboard.binding(key) {
            if inputs.get(name) == Some(&Value::Bool(true)) {
                keyboard.apply(KeyEvent::Down(key))?;
            }
        }
    }
    let actions = field(&scenario, "actions")?
        .as_array()
        .ok_or("actions must be array")?;
    for (index, action) in actions.iter().enumerate() {
        let outcome = (|| -> Result<Option<Json>, Box<dyn Error>> {
            match text(action, "kind")? {
                "input" => {
                    let name = text(action, "name")?;
                    let value = typed(action)?;
                    inputs.insert(name.to_owned(), value);
                    if let Some(key) = (1..=8).find(|key| keyboard.binding(*key) == Some(name)) {
                        let down = value == Value::Bool(true);
                        keyboard.apply(if down {
                            KeyEvent::Down(key)
                        } else {
                            KeyEvent::Up(key)
                        })?;
                    }
                    Ok(None)
                }
                "key" => {
                    let key = u8::try_from(
                        field(action, "key")?
                            .as_u64()
                            .ok_or("key must be integer")?,
                    )?;
                    let event = match text(action, "event")? {
                        "down" => KeyEvent::Down(key),
                        "up" => KeyEvent::Up(key),
                        _ => return Err("key event must be down or up".into()),
                    };
                    keyboard.apply(event)?;
                    Ok(None)
                }
                "scan" => {
                    for (name, value) in keyboard.values() {
                        inputs.insert(name.to_owned(), value);
                    }
                    let at_ms = field(action, "atMs")?
                        .as_u64()
                        .ok_or("atMs must be integer")?;
                    let frame = ScanFrameV1 {
                        scan_id: driver.next_scan_id().ok_or("scan sequence exhausted")?,
                        logical_time_ms: at_ms,
                        inputs: inputs
                            .iter()
                            .map(|(name, value)| ScanInput {
                                name: name.clone(),
                                value: *value,
                            })
                            .collect(),
                    };
                    let result = driver.scan(frame)?;
                    Ok(Some(
                        json!({"scanId": result.scan_id, "logicalTimeMs": at_ms, "trace": serde_json::from_str::<Json>(&result.trace.to_json())?}),
                    ))
                }
                _ => Err("unknown action kind".into()),
            }
        })();
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                eprintln!("action[{index}]: {error}");
                std::process::exit(1);
            }
        };
        if let Some(outcome) = outcome {
            println!("{outcome}");
        }
    }
    Ok(())
}
