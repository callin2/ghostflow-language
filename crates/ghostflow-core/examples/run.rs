//! Virtual native runner. It never opens a GPIO, network, or serial device.
#[path = "support/temporal_profile.rs"]
mod temporal_profile;

use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::{collections::BTreeSet, env, error::Error, fs};
use temporal_profile::parse_temporal;

const USAGE: &str = "usage: run <module.gfb> <inputs.csv> [--outcomes] [--temporal EPOCH MAX_SAMPLES MAX_BYTES TAG:MAX_OBSERVATIONS:INTERVAL_MS[,..]] (virtual outputs only)";

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() < 2 {
        return Err(USAGE.into());
    }
    let mut outcomes = false;
    let mut temporal = None;
    let mut at = 2;
    while at < args.len() {
        match args[at].as_str() {
            "--outcomes" if !outcomes => {
                outcomes = true;
                at += 1;
            }
            "--temporal" if temporal.is_none() && at + 4 < args.len() => {
                temporal = parse_temporal(&args[at + 1..at + 5]);
                if temporal.is_none() {
                    return Err(USAGE.into());
                }
                at += 5;
            }
            _ => return Err(USAGE.into()),
        }
    }
    let module = match Module::load(&fs::read(&args[0])?) {
        Ok(module) => module,
        Err(error) if outcomes => {
            print_error("load", error.message(), 0);
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };
    let capabilities: BTreeSet<_> = module
        .output_fields()
        .map(|(name, ty)| Capability::new("actuator", name, ty))
        .collect();
    let input_types: Vec<_> = module
        .input_fields()
        .map(|(name, ty)| (name.to_owned(), ty))
        .collect();
    let mut runtime = Runtime::new(256);
    runtime.install(module, false);
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    let activation = match temporal.as_ref() {
        Some(profile) => runtime.activate_with_temporal(profile),
        None => runtime.activate(),
    };
    if let Err(error) = activation {
        if !outcomes {
            return Err(error.into());
        }
        print_error("activate", error.message(), 0);
        return Ok(());
    }
    let input = fs::read_to_string(&args[1])?;
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header: Vec<_> = lines
        .next()
        .ok_or("missing CSV header")?
        .split(',')
        .collect();
    if header.iter().collect::<BTreeSet<_>>().len() != header.len() {
        return Err("duplicate CSV column".into());
    }
    for (row, line) in lines.enumerate() {
        let cells: Vec<_> = line.split(',').collect();
        if cells.len() != header.len() {
            return Err(format!("CSV row {} width mismatch", row + 2).into());
        }
        runtime.clear_inputs();
        for (name, value) in header.iter().zip(cells) {
            // Only the diagnostic protocol accepts empty cells as omitted input.
            // An empty cell is never coerced to a VM value.
            if outcomes && value.is_empty() {
                continue;
            }
            let (_, ty) = input_types
                .iter()
                .find(|(field, _)| field == name)
                .ok_or_else(|| format!("unknown input {name}"))?;
            let value = match ty {
                Type::Bool => Value::Bool(match value {
                    "true" => true,
                    "false" => false,
                    _ => return Err("expected true/false".into()),
                }),
                Type::Number => Value::Number(value.parse()?),
                Type::Int => Value::Int(value.parse()?),
            };
            runtime.set_input(name, value)?;
        }
        match runtime.tick() {
            Ok(trace) if outcomes => {
                println!("{{\"status\":\"OK\",\"trace\":{}}}", trace.to_json())
            }
            Ok(trace) => println!("{}", trace.to_json()),
            Err(error) if outcomes => print_error("tick", error.message(), runtime.journal().len()),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn print_error(phase: &str, error: &str, journal_length: usize) {
    let mut escaped = String::new();
    for ch in error.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            ch if ch.is_control() => escaped.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => escaped.push(ch),
        }
    }
    println!("{{\"status\":\"ERROR\",\"phase\":\"{phase}\",\"error\":\"{escaped}\",\"journalLength\":{journal_length}}}");
}
