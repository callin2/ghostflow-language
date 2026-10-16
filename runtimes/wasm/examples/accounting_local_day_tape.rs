//! Bounded test-only source-bound transport for local-day accounting C ABI.
//! Trusted host supplies split intervals; no timezone/physical policy lives here.
use ghostflow_wasm::accounting_abi::*;
use serde_json::{json, Value};
use std::{env, error::Error, fs::File, io::Read, slice};
fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("local-day tape exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn n(value: &Value) -> Result<u64, Box<dyn Error>> {
    value
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| "invalid exact integer".into())
}
unsafe fn snapshot(h: *mut AccountingHandle) -> Result<Value, Box<dyn Error>> {
    let status = gf_accounting_snapshot(h);
    if status != 1 {
        return Err("snapshot failed".into());
    }
    Ok(
        json!({"status":status,"bytes":slice::from_raw_parts(gf_accounting_snapshot_ptr(h),gf_accounting_snapshot_len(h)),"revision":gf_accounting_revision(h)}),
    )
}
unsafe fn persist(h: *mut AccountingHandle) -> Result<(), Box<dyn Error>> {
    let _ = snapshot(h)?;
    if gf_accounting_ack_persisted(h, gf_accounting_revision(h)) != 1 {
        return Err("durable acknowledgement failed".into());
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: accounting_local_day_tape <module.gfb> <tape.json>".into());
    }
    let bytes = read(&args[0])?;
    ghostflow_core::Module::load(&bytes)?;
    let tape: Value = serde_json::from_slice(&read(&args[1])?)?;
    let fingerprint = format!(
        "{:016x}",
        bytes
            .iter()
            .fold(0xcbf29ce484222325u64, |h, b| (h ^ u64::from(*b))
                .wrapping_mul(0x100000001b3))
    );
    if tape["moduleFingerprint"] != fingerprint {
        return Err("compiled module identity mismatch".into());
    }
    let account = tape["account"].as_str().ok_or("missing account")?;
    let binding = tape["manifest"]["accounting"]["bindings"]
        .as_array()
        .ok_or("missing bindings")?
        .iter()
        .find(|b| b["name"] == account)
        .ok_or("missing bound account")?;
    if binding["operation"] != "on_time"
        || binding["persistence"] != "durable"
        || binding["evidenceBinding"]["kind"] != "applied_interval"
        || binding["evidenceBinding"]["stage"] != "applied"
        || binding["evidenceBinding"]["target"] != tape["target"]
    {
        return Err("source applied-account binding mismatch".into());
    }
    let resource = u32::try_from(n(&tape["resourceId"])?)?;
    if resource == 0 {
        return Err("zero resource identity".into());
    }
    let window = n(&tape["windowMs"])?;
    let steps = tape["steps"]
        .as_array()
        .filter(|s| s.len() <= 128)
        .ok_or("invalid steps")?;
    let days: Vec<i32> = tape["days"]
        .as_array()
        .filter(|d| d.len() == 2)
        .ok_or("two days required")?
        .iter()
        .map(|d| {
            d.as_i64()
                .ok_or("invalid day")
                .and_then(|n| i32::try_from(n).map_err(|_| "invalid day"))
        })
        .collect::<Result<_, _>>()?;
    let h = gf_accounting_create(256, 8, 8, window);
    if h.is_null() {
        return Err("invalid config".into());
    }
    let result = unsafe {
        (|| -> Result<Value, Box<dyn Error>> {
            if gf_accounting_initialize_empty(h) != 1 {
                return Err("explicit initialization failed".into());
            }
            persist(h)?;
            let mut trusted: Vec<u8> = snapshot(h)?["bytes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|n| n.as_u64().unwrap() as u8)
                .collect();
            let mut records = Vec::new();
            for step in steps {
                let before = snapshot(h)?;
                let status = if step["restoreLastTrusted"].as_bool() == Some(true) {
                    gf_accounting_restore(h, trusted.as_ptr(), trusted.len())
                } else {
                    if n(&step["resourceId"])? != u64::from(resource) {
                        return Err("wrong bound resource ID".into());
                    }
                    let sequence = n(&step["receiptId"])?;
                    if sequence == 0 {
                        return Err("zero receipt".into());
                    }
                    let mut receipt = [0u8; 16];
                    receipt[..8].copy_from_slice(&sequence.to_le_bytes());
                    let day = i32::try_from(step["localDay"].as_i64().ok_or("invalid local day")?)?;
                    gf_accounting_record_applied_segment(
                        h,
                        receipt.as_ptr(),
                        resource,
                        n(&step["startMs"])?,
                        n(&step["endMs"])?,
                        day,
                    )
                };
                if status == 1 {
                    persist(h)?;
                    trusted = snapshot(h)?["bytes"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|n| n.as_u64().unwrap() as u8)
                        .collect();
                }
                let after = snapshot(h)?;
                let now = n(&step["nowMs"])?;
                let mut value = 0;
                let used = if gf_accounting_used_rolling(h, resource, now, window, &mut value) == 1
                {
                    json!(value)
                } else {
                    Value::Null
                };
                let mut daily = Vec::new();
                for day in &days {
                    let mut value = 0;
                    daily.push(
                        if gf_accounting_used_local_day(h, resource, *day, &mut value) == 1 {
                            json!(value)
                        } else {
                            Value::Null
                        },
                    );
                }
                records.push(json!({"status":status,"before":before,"after":after,"rolling":used,"days":daily}));
            }
            Ok(
                json!({"moduleFingerprint":fingerprint,"account":account,"target":tape["target"],"resourceId":resource,"records":records}),
            )
        })()
    };
    unsafe { gf_accounting_destroy(h) };
    println!("{}", result?);
    Ok(())
}
