//! Native conformance transport: one hex config line, followed by hex evaluations.
#[path = "../../../runtimes/wasm/estimate_abi.rs"]
mod estimate_abi;
use std::io::{self, BufRead};
fn decode(line: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    if line.len() > estimate_abi::MAX_PACKET * 2 || line.len() % 2 != 0 {
        return Err("invalid hex packet size".into());
    }
    (0..line.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(line.get(i..i + 2).ok_or("invalid hex")?, 16).map_err(Into::into)
        })
        .collect()
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut lines = io::stdin().lock().lines();
    let config = decode(&lines.next().ok_or("missing config")??)?;
    let mut handle = estimate_abi::Handle::new(&config)?;
    println!("{}", handle.snapshot());
    for line in lines {
        let packet = decode(&line?)?;
        match handle.evaluate(&packet) {
            Ok(()) => println!("{{\"accepted\":true,\"snapshot\":{}}}", handle.snapshot()),
            Err(error) => println!(
                "{{\"accepted\":false,\"error\":{},\"snapshot\":{}}}",
                serde_json::to_string(&error)?,
                handle.snapshot()
            ),
        }
    }
    Ok(())
}
