//! Real-time virtual keyboard host for Unix terminals.
//!
//! Numeric keys toggle the matching boolean input. Ctrl-C exits after
//! restoring the terminal. No GPIO, network, or serial device is opened.

use ghostflow_core::keyboard::KeyboardMapper;
use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::process::Command;
use std::time::Instant;

const USAGE: &str =
    "usage: keyboard <module.gfb> --key 1=input [--key 2=input ...] [--record events.csv]";

struct TerminalRawMode {
    saved: String,
}

impl TerminalRawMode {
    #[cfg(unix)]
    fn enter() -> Result<Self, Box<dyn Error>> {
        let saved = String::from_utf8(Command::new("stty").arg("-g").output()?.stdout)?
            .trim()
            .to_owned();
        let status = Command::new("stty")
            .args(["-icanon", "-echo", "min", "1", "time", "0"])
            .status()?;
        if !status.success() {
            return Err("failed to put terminal in raw mode".into());
        }
        Ok(Self { saved })
    }

    #[cfg(not(unix))]
    fn enter() -> Result<Self, Box<dyn Error>> {
        Err("keyboard host currently requires a Unix terminal".into())
    }
}

impl Drop for TerminalRawMode {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            let _ = Command::new("stty").arg(&self.saved).status();
            let _ = io::stdout().write_all(b"\n");
            let _ = io::stdout().flush();
        }
    }
}

fn parse_key(raw: &str) -> Result<(u8, String), Box<dyn Error>> {
    let (key, name) = raw.split_once('=').ok_or("--key must use N=input")?;
    let key: u8 = key.parse().map_err(|_| "key must be a number 1..8")?;
    if !(1..=8).contains(&key) || name.is_empty() {
        return Err("--key must use a key 1..8 and a non-empty input name".into());
    }
    Ok((key, name.to_owned()))
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.is_empty() {
        return Err(USAGE.into());
    }
    let module = Module::load(&fs::read(&args[0])?)?;
    let mut bindings: [Option<String>; 8] = Default::default();
    let mut record_path = None;
    let mut at = 1;
    while at < args.len() {
        match args[at].as_str() {
            "--key" if at + 1 < args.len() => {
                let (key, name) = parse_key(&args[at + 1])?;
                if bindings[usize::from(key - 1)].is_some() {
                    return Err("duplicate keyboard key binding".into());
                }
                bindings[usize::from(key - 1)] = Some(name);
                at += 2;
            }
            "--record" if at + 1 < args.len() && record_path.is_none() => {
                record_path = Some(args[at + 1].clone());
                at += 2;
            }
            _ => return Err(USAGE.into()),
        }
    }

    let mut mapper = KeyboardMapper::new(bindings)?;
    let module_inputs: BTreeMap<_, _> = module
        .input_fields()
        .map(|(name, ty)| (name.to_owned(), ty))
        .collect();
    for name in mapper.inputs() {
        if module_inputs.get(name) != Some(&Type::Bool) {
            return Err(format!("keyboard input {name} must be a Bool module input").into());
        }
    }
    for (name, ty) in &module_inputs {
        if name != "__gf_now_ms" && *ty != Type::Bool {
            return Err(format!("keyboard host cannot supply non-Bool input {name}").into());
        }
    }
    let capabilities: BTreeSet<_> = module
        .output_fields()
        .map(|(name, ty)| Capability::new("actuator", name, ty))
        .collect();
    let mut runtime = Runtime::new(256);
    runtime.install(module, false);
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    runtime.activate()?;

    let mut record = record_path
        .map(|path| -> Result<_, Box<dyn Error>> {
            let mut file = File::create(path)?;
            writeln!(file, "logical_time_ms,key,event")?;
            Ok(file)
        })
        .transpose()?;
    let _terminal = TerminalRawMode::enter()?;
    let started = Instant::now();
    let mut stdin = io::stdin();
    let mut buffer = [0_u8; 1];
    loop {
        stdin.read_exact(&mut buffer)?;
        let event = match buffer[0] {
            3 => break,
            b'1'..=b'8' => {
                let key = buffer[0] - b'0';
                mapper.toggle(key)?
            }
            _ => continue,
        };
        let now = started.elapsed().as_millis() as u64;
        runtime.clear_inputs();
        for (name, value) in mapper.values() {
            runtime.set_input(name, value)?;
        }
        // Unbound boolean inputs are held low. This keeps the legacy runtime
        // setter contract complete while allowing a keypad to control only a
        // selected subset of a module's inputs.
        for (name, ty) in &module_inputs {
            if *ty == Type::Bool && !mapper.inputs().any(|input| input == name) {
                runtime.set_input(name, Value::Bool(false))?;
            }
        }
        if module_inputs.contains_key("__gf_now_ms") {
            runtime.set_input("__gf_now_ms", Value::Number(now as f64))?;
        }
        let trace = runtime.tick()?;
        println!(
            "{{\"timeMs\":{now},\"key\":{},\"event\":\"{}\",\"trace\":{}}}",
            event.key(),
            if event.is_down() { "down" } else { "up" },
            trace.to_json()
        );
        io::stdout().flush()?;
        if let Some(file) = record.as_mut() {
            writeln!(
                file,
                "{now},{},{}",
                event.key(),
                if event.is_down() { "down" } else { "up" }
            )?;
            file.flush()?;
        }
    }
    Ok(())
}
