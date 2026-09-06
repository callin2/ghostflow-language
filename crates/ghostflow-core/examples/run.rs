//! Virtual native runner. It never opens a GPIO, network, or serial device.
use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::{collections::BTreeSet, env, error::Error, fs};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: run <module.gfb> <inputs.csv> (virtual outputs only)".into());
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
            };
            runtime.set_input(name, value)?;
        }
        println!("{}", runtime.tick()?.to_json());
    }
    Ok(())
}
