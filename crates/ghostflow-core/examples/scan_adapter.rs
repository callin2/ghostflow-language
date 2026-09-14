//! Virtual native ScanFrame adapter for cross-target conformance tests.
//! It reads no device state and applies no physical output.
use ghostflow_core::scan::{ScanFrameV1, ScanInput};
use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::{collections::BTreeSet, env, error::Error, fs};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: scan_adapter <module.gfb> <frames.csv>".into());
    }
    let module = Module::load(&fs::read(&args[0])?)?;
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
    runtime.activate()?;
    let mut driver = runtime.into_scan_driver();

    let input = fs::read_to_string(&args[1])?;
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header: Vec<_> = lines
        .next()
        .ok_or("missing CSV header")?
        .split(',')
        .collect();
    if header.len() < 3 || header[0] != "scan_id" || header[1] != "logical_time_ms" {
        return Err(
            "CSV must start with scan_id,logical_time_ms and include every module input".into(),
        );
    }
    if header.iter().collect::<BTreeSet<_>>().len() != header.len() {
        return Err("duplicate CSV column".into());
    }
    for (row, line) in lines.enumerate() {
        let cells: Vec<_> = line.split(',').collect();
        if cells.len() != header.len() {
            return Err(format!("CSV row {} width mismatch", row + 2).into());
        }
        let mut inputs = Vec::with_capacity(header.len() - 2);
        for (name, raw) in header.iter().skip(2).zip(cells.iter().skip(2)) {
            let (_, ty) = input_types
                .iter()
                .find(|(field, _)| field == name)
                .ok_or_else(|| format!("unknown input {name}"))?;
            let value = match ty {
                Type::Bool => Value::Bool(match *raw {
                    "true" => true,
                    "false" => false,
                    _ => return Err(format!("expected true/false for {name}").into()),
                }),
                Type::Number => Value::Number(raw.parse()?),
            };
            inputs.push(ScanInput {
                name: (*name).to_owned(),
                value,
            });
        }
        let outcome = driver.scan(ScanFrameV1 {
            scan_id: cells[0].parse()?,
            logical_time_ms: cells[1].parse()?,
            inputs,
        })?;
        println!(
            "{{\"scanId\":{},\"logicalTimeMs\":{},\"trace\":{}}}",
            outcome.scan_id,
            outcome.logical_time_ms,
            outcome.trace.to_json()
        );
    }
    Ok(())
}
