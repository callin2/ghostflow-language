//! Test-only TSV transport for the native framed ScanDriver.
//!
//! It deliberately performs no GhostFlow evaluation: every well-formed row is
//! handed unchanged to `ScanDriver`, whose outcome JSON is shared with WASM.

#[path = "support/temporal_profile.rs"]
mod temporal_profile;

use std::{env, error::Error, fs, io::Read};

use ghostflow_core::{
    scan::{ScanFrameV1, ScanInput},
    Capability, Module, Runtime, Value,
};
use temporal_profile::parse_temporal;

const MAX_MODULE_BYTES: usize = 1_024 * 1_024;
const MAX_TAPE_BYTES: usize = 1_024 * 1_024;
const MAX_ROW_BYTES: usize = 65_536;
const MAX_ATTEMPTS: usize = 4_096;
const MAX_INPUTS: usize = 128;
const MAX_NAME_BYTES: usize = 1_024;
const USAGE: &str = "usage: scan_tape <module.gfb> <tape.tsv> [--temporal EPOCH MAX_SAMPLES MAX_BYTES TAG:MAX_OBSERVATIONS:INTERVAL_MS[,..]]";

fn main() -> Result<(), Box<dyn Error>> {
    let mut args: Vec<_> = env::args().skip(1).collect();
    let witnesses = args
        .last()
        .is_some_and(|arg| arg == "--instruction-witnesses");
    if witnesses {
        args.pop();
    }
    if args.len() < 2 {
        return Err(USAGE.into());
    }
    let temporal = match args.len() {
        2 => None,
        7 if args[2] == "--temporal" => Some(parse_temporal(&args[3..7]).ok_or(USAGE)?),
        _ => return Err(USAGE.into()),
    };
    let module_bytes = read_bounded(&args[0], MAX_MODULE_BYTES, "module")?;
    let tape_bytes = read_bounded(&args[1], MAX_TAPE_BYTES, "tape")?;
    let module = Module::load(&module_bytes)?;
    let capabilities: Vec<_> = module
        .output_fields()
        .map(|(name, value_type)| Capability::new("actuator", name, value_type))
        .collect();
    let mut runtime = Runtime::new(1024);
    runtime.install(module, false);
    if witnesses {
        runtime.enable_instruction_witnesses()?;
    }
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    match temporal.as_ref() {
        Some(profile) => runtime.activate_with_temporal(profile)?,
        None => runtime.activate()?,
    }
    let mut driver = runtime.into_scan_driver();

    let tape = std::str::from_utf8(&tape_bytes).map_err(|_| "tape must be UTF-8")?;
    let mut attempts = 0usize;
    let mut last_outcome: Option<String> = None;
    for (line_number, line) in tape.lines().enumerate() {
        if line.is_empty() {
            continue;
        }
        if line.len() > MAX_ROW_BYTES {
            return Err(
                format!("tape row {} exceeds {MAX_ROW_BYTES} bytes", line_number + 1).into(),
            );
        }
        attempts = attempts
            .checked_add(1)
            .filter(|count| *count <= MAX_ATTEMPTS)
            .ok_or_else(|| format!("tape exceeds {MAX_ATTEMPTS} attempts"))?;
        let frame = parse_row(line, line_number + 1)?;
        let committed_trace = driver
            .runtime()
            .journal()
            .back()
            .map(|trace| trace.to_json());
        let committed_count = driver.runtime().journal().len();
        match driver.scan(frame) {
            Ok(outcome) => {
                let encoded = outcome_json(
                    outcome.scan_id,
                    outcome.logical_time_ms,
                    &outcome.trace.to_json(),
                );
                println!("{{\"accepted\":true,\"outcome\":{encoded}}}");
                last_outcome = Some(encoded);
            }
            Err(error) => {
                assert_eq!(driver.runtime().journal().len(), committed_count);
                assert_eq!(
                    driver
                        .runtime()
                        .journal()
                        .back()
                        .map(|trace| trace.to_json()),
                    committed_trace,
                    "rejected scan changed the native committed trace"
                );
                let outcome = last_outcome.as_deref().unwrap_or("null");
                println!(
                    "{{\"accepted\":false,\"outcome\":{outcome},\"error\":{}}}",
                    json_text(error.message())
                );
            }
        }
    }
    Ok(())
}

fn read_bounded(path: &str, maximum: usize, label: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut reader = fs::File::open(path)?.take(maximum as u64 + 1);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    if bytes.len() > maximum {
        return Err(format!("{label} exceeds {maximum} bytes").into());
    }
    Ok(bytes)
}

fn parse_row(line: &str, line_number: usize) -> Result<ScanFrameV1, Box<dyn Error>> {
    let fields: Vec<_> = line.split('\t').collect();
    if fields.len() < 2 || (fields.len() - 2) % 3 != 0 {
        return Err(format!("tape row {line_number} must be scanId<TAB>logicalTimeMs followed by name/type/value triples").into());
    }
    let scan_id = decimal_u64(fields[0], "scanId", line_number)?;
    let logical_time_ms = decimal_u64(fields[1], "logicalTimeMs", line_number)?;
    let input_count = (fields.len() - 2) / 3;
    if input_count > MAX_INPUTS {
        return Err(format!("tape row {line_number} exceeds {MAX_INPUTS} inputs").into());
    }
    let mut inputs = Vec::with_capacity(input_count);
    for fields in fields[2..].chunks_exact(3) {
        let name = fields[0];
        if name.is_empty() || name.len() > MAX_NAME_BYTES || name.contains(['\t', '\n', '\r']) {
            return Err(format!(
                "tape row {line_number} input name must contain 1..={MAX_NAME_BYTES} UTF-8 bytes"
            )
            .into());
        }
        let value = match fields[1] {
            "b" => match fields[2] {
                "true" => Value::Bool(true),
                "false" => Value::Bool(false),
                _ => {
                    return Err(format!(
                        "tape row {line_number} boolean input must be true or false"
                    )
                    .into())
                }
            },
            "n" => Value::Number(decimal_f64(fields[2], line_number)?),
            _ => return Err(format!("tape row {line_number} input type must be b or n").into()),
        };
        inputs.push(ScanInput {
            name: name.to_owned(),
            value,
        });
    }
    Ok(ScanFrameV1 {
        scan_id,
        logical_time_ms,
        inputs,
    })
}

fn decimal_u64(value: &str, label: &str, line_number: usize) -> Result<u64, Box<dyn Error>> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("tape row {line_number} {label} must be unsigned decimal").into());
    }
    value
        .parse::<u64>()
        .map_err(|_| format!("tape row {line_number} {label} is out of range").into())
}

fn decimal_f64(value: &str, line_number: usize) -> Result<f64, Box<dyn Error>> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'+' | b'-' | b'.' | b'e' | b'E'))
        || !value.bytes().any(|byte| byte.is_ascii_digit())
    {
        return Err(
            format!("tape row {line_number} number must use finite decimal notation").into(),
        );
    }
    let number = value
        .parse::<f64>()
        .map_err(|_| format!("tape row {line_number} number is invalid"))?;
    if !number.is_finite() {
        return Err(format!("tape row {line_number} number must be finite").into());
    }
    Ok(number)
}

fn outcome_json(scan_id: u64, logical_time_ms: u64, trace: &str) -> String {
    format!("{{\"format\":\"GhostFlow/scan-outcome-v1\",\"scanId\":{scan_id},\"logicalTimeMs\":{logical_time_ms},\"trace\":{trace}}}")
}

fn json_text(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character < ' ' => {
                output.push_str(&format!("\\u{:04x}", character as u32))
            }
            character => output.push(character),
        }
    }
    output.push('\"');
    output
}
