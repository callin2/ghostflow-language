//! Test-only transport for source-bound historical accounting observations.
//! The test host verifies canonical source/manifest identity before this call.
//! This runner loads the exact module and declared account, then delegates all
//! interval union and rolling calculation to AccountingLedger. No I/O admission
//! or physical receipt validation is performed here.
use ghostflow_core::{
    accounting::{AccountingConfig, AccountingLedger, LedgerRead},
    Module,
};
use serde_json::{json, Value};
use std::{env, error::Error, fs::File, io::Read};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("accounting tape/module exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn number(value: &Value) -> Result<u64, Box<dyn Error>> {
    value
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| "invalid exact integer".into())
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: accounting_tape <module.gfb> <tape.json>".into());
    }
    let bytes = read(&args[0])?;
    Module::load(&bytes)?;
    let fingerprint = format!(
        "{:016x}",
        bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| (hash
            ^ u64::from(*byte))
        .wrapping_mul(0x100000001b3))
    );
    let tape: Value = serde_json::from_slice(&read(&args[1])?)?;
    if tape["moduleFingerprint"].as_str() != Some(&fingerprint) {
        return Err("compiled module identity mismatch".into());
    }
    let account = tape["account"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("account is required")?;
    let binding = tape["manifest"]["accounting"]["bindings"]
        .as_array()
        .ok_or("account bindings are required")?
        .iter()
        .find(|b| b["name"].as_str() == Some(account))
        .ok_or("unknown source account")?;
    if binding["operation"] != "on_time"
        || binding["persistence"] != "durable"
        || binding["evidenceBinding"]["kind"] != "applied_interval"
        || binding["evidenceBinding"]["stage"] != "applied"
    {
        return Err("unsupported source accounting binding".into());
    }
    let target = binding["evidenceBinding"]["target"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("account target is required")?;
    if tape["target"].as_str() != Some(target) {
        return Err("source target mismatch".into());
    }
    let resource = u32::try_from(number(&tape["resourceId"])?)?;
    if resource == 0 {
        return Err("resource identity must be non-zero".into());
    }
    let window = number(&tape["windowMs"])?;
    let config = AccountingConfig {
        max_intervals: 256,
        max_events: 8,
        max_reservations: 8,
        max_rolling_window_ms: 60_000,
    };
    let mut ledger = AccountingLedger::new(config)?;
    let frames = tape["frames"]
        .as_array()
        .filter(|v| v.len() <= 256)
        .ok_or("invalid or oversized frames")?;
    let mut previous = None;
    let mut observations = Vec::new();
    for frame in frames {
        let now = number(&frame["nowMs"])?;
        if previous.is_some_and(|before| now <= before) {
            return Err("frame clock must increase".into());
        }
        previous = Some(now);
        for segment in frame["segments"]
            .as_array()
            .filter(|v| v.len() <= 128)
            .ok_or("invalid or oversized segments")?
        {
            if number(&segment["resourceId"])? != u64::from(resource) {
                return Err("wrong bound resource ID".into());
            }
            let sequence = number(&segment["receiptId"])?;
            if sequence == 0 {
                return Err("receipt identity must be non-zero".into());
            }
            let mut receipt = [0u8; 16];
            receipt[..8].copy_from_slice(&sequence.to_le_bytes());
            let start = number(&segment["startMs"])?;
            let end = number(&segment["endMs"])?;
            if end > now {
                return Err("future applied evidence".into());
            }
            ledger.record_applied_segment(receipt, resource, start, end, 100)?;
            // Exercise actual snapshot serialization/restoration after mutations.
            ledger = AccountingLedger::restore(config, &ledger.snapshot_bytes()?)?;
        }
        if frame["query"].as_bool().ok_or("query flag is required")? {
            match ledger.used_rolling(resource, now, window) {
                LedgerRead::Known(used) => observations.push(json!({"nowMs":now,"usedMs":used})),
                LedgerRead::Unknown => return Err("rolling query is Unknown".into()),
            }
        }
    }
    println!(
        "{}",
        json!({"moduleFingerprint":fingerprint,"account":account,"target":target,"stage":"applied","resourceId":resource,"observations":observations})
    );
    Ok(())
}
