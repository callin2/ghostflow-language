//! Bounded trusted test-host transport over the actual accounting C ABI.
//! The manifest comes from the same checked canonical source as the module.
//! It supplies raw records and explicit persistence acknowledgements, never
//! caller-projected count/fault/admission results or physical certification.
use ghostflow_wasm::{accounting_abi::*, *};
use serde_json::{json, Value};
use std::{env, error::Error, fs::File, io::Read, slice};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("admission tape exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn n(value: &Value) -> Result<u64, Box<dyn Error>> {
    value.as_u64().ok_or_else(|| "invalid integer".into())
}
fn checked(status: i32) -> Result<(), Box<dyn Error>> {
    if status != 1 {
        return Err(format!("unexpected ABI status {status}").into());
    }
    Ok(())
}
unsafe fn snapshot(handle: *mut AccountingHandle) -> Value {
    let status = gf_accounting_snapshot(handle);
    let bytes = slice::from_raw_parts(
        gf_accounting_snapshot_ptr(handle),
        gf_accounting_snapshot_len(handle),
    )
    .to_vec();
    json!({"status":status,"bytes":bytes,"revision":gf_accounting_revision(handle)})
}
unsafe fn persist(handle: *mut AccountingHandle, ack: bool) -> Result<(), Box<dyn Error>> {
    checked(gf_accounting_snapshot(handle))?;
    if ack {
        checked(gf_accounting_ack_persisted(
            handle,
            gf_accounting_revision(handle),
        ))?;
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("expected checked module and trusted manifest tape".into());
    }
    let bytes = read(&args[1])?;
    let tape: Value = serde_json::from_slice(&read(&args[2])?)?;
    let fingerprint = format!(
        "{:016x}",
        bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| (hash
            ^ u64::from(*byte))
        .wrapping_mul(0x100000001b3))
    );
    if tape["moduleFingerprint"].as_str() != Some(&fingerprint) {
        return Err("module identity mismatch".into());
    }
    let bindings = tape["manifest"]["accounting"]["bindings"]
        .as_array()
        .ok_or("missing bindings")?;
    let count = bindings
        .iter()
        .find(|v| v["name"] == "starts")
        .ok_or("missing count binding")?;
    let applied = bindings
        .iter()
        .find(|v| v["name"] == "applied")
        .ok_or("missing applied binding")?;
    if count["operation"] != "count_events"
        || count["persistence"] != "durable"
        || count["evidenceBinding"]["kind"] != "typed_event"
        || count["basis"]["kind"] != "local_day"
        || applied["operation"] != "on_time"
        || applied["persistence"] != "durable"
        || applied["evidenceBinding"]["kind"] != "applied_interval"
        || applied["evidenceBinding"]["stage"] != "applied"
    {
        return Err("unsupported checked account binding".into());
    }
    let limits: Vec<_> = tape["manifest"]["accounting"]["constraints"]
        .as_array()
        .ok_or("missing constraints")?
        .iter()
        .filter_map(|group| group["limits"].as_array())
        .flatten()
        .filter(|limit| limit["account"] == "applied")
        .collect();
    if limits.len() != 1
        || limits[0]["operator"] != "<="
        || limits[0]["basis"]["kind"] != "rolling"
        || limits[0]["onUnknown"] != "block"
        || limits[0]["persistence"] != "durable"
    {
        return Err("unsupported source protective policy".into());
    }
    let limit = limits[0];
    let site = u32::try_from(n(&count["site"])?)?;
    let account = count["name"].as_str().ok_or("invalid account")?;
    let event = count["evidenceBinding"]["target"]
        .as_str()
        .ok_or("invalid event")?;
    let timezone = count["basis"]["zone"].as_str().ok_or("invalid timezone")?;
    let cases = tape["cases"]
        .as_array()
        .filter(|v| v.len() <= 32)
        .ok_or("invalid cases")?;
    let mut results = Vec::new();
    for case in cases {
        unsafe {
            let counts = gf_accounting_create(8, 8, 8, 600_000);
            let usage = gf_accounting_create(8, 8, 8, 600_000);
            let control = gf_create();
            if counts.is_null() || usage.is_null() {
                return Err("invalid ledger config".into());
            }
            let ack = case["ack"].as_bool().ok_or("invalid ack")?;
            if case["initialize"] == true {
                for handle in [counts, usage] {
                    checked(gf_accounting_initialize_empty(handle))?;
                    persist(handle, ack)?;
                }
            }
            for record in case["events"]
                .as_array()
                .filter(|v| v.len() <= 16)
                .ok_or("invalid events")?
            {
                let id = [u8::try_from(n(&record["id"])?)?; 16];
                let event_type = u32::try_from(n(&record["eventType"])?)?;
                let day = i32::try_from(record["localDay"].as_i64().ok_or("invalid day")?)?;
                checked(gf_accounting_record_event(
                    counts,
                    id.as_ptr(),
                    event_type,
                    day,
                ))?;
                checked(gf_accounting_record_applied_segment(
                    usage,
                    id.as_ptr(),
                    7,
                    0,
                    1,
                    day,
                ))?;
                persist(counts, ack)?;
                persist(usage, ack)?;
            }
            if case["corrupt"] == true {
                for handle in [counts, usage] {
                    checked(gf_accounting_snapshot(handle))?;
                    let mut damaged = slice::from_raw_parts(
                        gf_accounting_snapshot_ptr(handle),
                        gf_accounting_snapshot_len(handle),
                    )
                    .to_vec();
                    damaged[7] ^= 255;
                    if gf_accounting_restore(handle, damaged.as_ptr(), damaged.len()) != 0 {
                        return Err("corrupt restore succeeded".into());
                    }
                }
            }
            if case["recover"] == true {
                persist(counts, true)?;
                persist(usage, true)?;
            }
            let count_before = snapshot(counts);
            let applied_before = snapshot(usage);
            checked(gf_load(control, bytes.as_ptr(), bytes.len()))?;
            checked(gf_add_capability(
                control,
                b"actuator".as_ptr(),
                8,
                b"ready".as_ptr(),
                5,
                1,
            ))?;
            checked(gf_activate_accounting(control, 1, 8))?;
            checked(gf_tick_accounting(
                control,
                counts,
                site,
                account.as_ptr(),
                account.len(),
                event.as_ptr(),
                event.len(),
                timezone.as_ptr(),
                timezone.len(),
                9,
                1,
                100,
                0,
                1,
                1,
                1_700_000_000_000,
                1,
            ))?;
            let trace_ptr = gf_trace_ptr(control);
            let trace: Value =
                serde_json::from_slice(slice::from_raw_parts(trace_ptr, gf_trace_len(control)))?;
            let status = gf_accounting_reserve_rolling(
                usage,
                [20u8; 16].as_ptr(),
                7,
                0,
                n(&limit["basis"]["durationMs"])?,
                n(&limit["boundMs"])?,
                n(&limit["reserveMs"])?,
            );
            let persistence_calls = if status == 1 {
                persist(usage, true)?;
                1
            } else {
                0
            };
            results.push(json!({"trace":trace,"countBefore":count_before,"countAfter":snapshot(counts),
                "appliedBefore":applied_before,"appliedAfter":snapshot(usage),"admissionStatus":status,"persistCalls":persistence_calls}));
            gf_destroy(control);
            gf_accounting_destroy(counts);
            gf_accounting_destroy(usage);
        }
    }
    println!("{}", serde_json::to_string(&results)?);
    Ok(())
}
