//! Bounded trusted test-host transport for REF-03-022 reboot budget checks.
//! It links the production accounting C ABI from the wasm runtime crate and
//! accepts only a checked source manifest plus explicit durable acknowledgements.
//! Timestamps are caller-trusted comparable monotonic values; no physical clock
//! bridge, host projection, or implicit empty initialization is invented here.
use ghostflow_wasm::accounting_abi::*;
use serde_json::{json, Value};
use std::{env, error::Error, fs::File, io::Read, slice};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("reboot tape/module exceeds 1 MiB".into());
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
unsafe fn persist(handle: *mut AccountingHandle) -> Result<(), Box<dyn Error>> {
    checked(gf_accounting_snapshot(handle))?;
    checked(gf_accounting_ack_persisted(
        handle,
        gf_accounting_revision(handle),
    ))
}
unsafe fn used(handle: *mut AccountingHandle, resource: u32, now: u64, window: u64) -> Value {
    let mut out = 0u64;
    let status = gf_accounting_used_rolling(handle, resource, now, window, &mut out as *mut u64);
    json!({"status":status,"value": if status == 1 { json!(out) } else { Value::Null }})
}
unsafe fn reserve(
    handle: *mut AccountingHandle,
    id: u8,
    resource: u32,
    now: u64,
    window: u64,
    limit: u64,
    reserve_ms: u64,
    ack: bool,
) -> Result<Value, Box<dyn Error>> {
    let before = snapshot(handle);
    let reservation = [id; 16];
    let status = gf_accounting_reserve_rolling(
        handle,
        reservation.as_ptr(),
        resource,
        now,
        window,
        limit,
        reserve_ms,
    );
    let mut persist_calls = 0;
    if status == 1 || status == 2 {
        if ack {
            persist(handle)?;
        }
        persist_calls = 1;
    }
    let after = snapshot(handle);
    Ok(json!({"status":status,"before":before,"after":after,"persistCalls":persist_calls}))
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("usage: accounting_reboot_tape <module.gfb> <tape.json>".into());
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
        return Err("compiled module identity mismatch".into());
    }
    let account = tape["account"].as_str().ok_or("account is required")?;
    let binding = tape["manifest"]["accounting"]["bindings"]
        .as_array()
        .ok_or("missing account bindings")?
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
        .ok_or("missing account target")?;
    if tape["target"].as_str() != Some(target) {
        return Err("source target mismatch".into());
    }
    let resource = u32::try_from(n(&tape["resourceId"])?)?;
    if resource == 0 {
        return Err("resource identity must be non-zero".into());
    }
    let window = n(&tape["windowMs"])?;
    let limit = n(&tape["limitMs"])?;
    let reserve_ms = n(&tape["reserveMs"])?;
    let reboot_now = n(&tape["rebootNowMs"])?;
    let expiry_now = n(&tape["expiryNowMs"])?;
    let actual_start = n(&tape["actualStartMs"])?;
    let actual_end = n(&tape["actualEndMs"])?;
    let selected = tape["manifest"]["accounting"]["constraints"]
        .as_array()
        .ok_or("missing source constraint")?
        .iter()
        .filter_map(|group| group["limits"].as_array())
        .flatten()
        .find(|entry| {
            entry["account"].as_str() == Some(account) && entry["basis"]["kind"] == "rolling"
        })
        .ok_or("missing source rolling constraint")?;
    if selected["basis"]["durationMs"] != tape["windowMs"]
        || selected["operator"] != "<="
        || selected["persistence"] != "durable"
        || selected["boundMs"] != tape["limitMs"]
        || selected["reserveMs"] != tape["reserveMs"]
        || selected["onUnknown"] != "block"
    {
        return Err("source rolling admission constraint mismatch".into());
    }
    unsafe {
        let config = (8, 8, 8, 600_000);
        let owner = gf_accounting_create(config.0, config.1, config.2, config.3);
        if owner.is_null() {
            return Err("invalid accounting config".into());
        }
        checked(gf_accounting_initialize_empty(owner))?;
        persist(owner)?;
        let receipt = [1u8; 16];
        checked(gf_accounting_record_applied_segment(
            owner,
            receipt.as_ptr(),
            resource,
            actual_start,
            actual_end,
            100,
        ))?;
        persist(owner)?;
        let durable = snapshot(owner);
        gf_accounting_destroy(owner);

        let fresh = gf_accounting_create(config.0, config.1, config.2, config.3);
        let fresh_before = snapshot(fresh);
        let fresh_used = used(fresh, resource, reboot_now, window);
        let fresh_admission = reserve(
            fresh, 2, resource, reboot_now, window, limit, reserve_ms, false,
        )?;
        let fresh_after = snapshot(fresh);
        gf_accounting_destroy(fresh);

        let restored = gf_accounting_create(config.0, config.1, config.2, config.3);
        let durable_bytes = durable["bytes"]
            .as_array()
            .ok_or("snapshot bytes missing")?;
        let durable_vec: Vec<u8> = durable_bytes
            .iter()
            .map(|v| Ok(u8::try_from(n(v)?)?))
            .collect::<Result<_, Box<dyn Error>>>()?;
        checked(gf_accounting_restore(
            restored,
            durable_vec.as_ptr(),
            durable_vec.len(),
        ))?;
        let restored_before = snapshot(restored);
        let restored_used = used(restored, resource, reboot_now, window);
        let restored_block = reserve(
            restored, 3, resource, reboot_now, window, limit, reserve_ms, false,
        )?;
        let restored_after_block = snapshot(restored);
        let expiry_used = used(restored, resource, expiry_now, window);
        let expiry_grant = reserve(
            restored, 4, resource, expiry_now, window, limit, reserve_ms, true,
        )?;
        let restored_after_expiry = snapshot(restored);
        gf_accounting_destroy(restored);

        let corrupt = gf_accounting_create(config.0, config.1, config.2, config.3);
        let mut damaged = durable_vec.clone();
        damaged[7] ^= 255;
        let corrupt_restore_status =
            gf_accounting_restore(corrupt, damaged.as_ptr(), damaged.len());
        let corrupt_before = snapshot(corrupt);
        let corrupt_used = used(corrupt, resource, reboot_now, window);
        let corrupt_admission = reserve(
            corrupt, 5, resource, reboot_now, window, limit, reserve_ms, false,
        )?;
        let corrupt_after = snapshot(corrupt);
        gf_accounting_destroy(corrupt);

        println!(
            "{}",
            json!({
                "moduleFingerprint":fingerprint,"account":account,"target":target,"stage":"applied","resourceId":resource,
                "durable":durable,
                "fresh":{"before":fresh_before,"used":fresh_used,"admission":fresh_admission,"after":fresh_after},
                "restored":{"before":restored_before,"used":restored_used,"block":restored_block,"afterBlock":restored_after_block,
                    "expiryUsed":expiry_used,"expiryGrant":expiry_grant,"afterExpiry":restored_after_expiry},
                "corrupt":{"restoreStatus":corrupt_restore_status,"before":corrupt_before,"used":corrupt_used,"admission":corrupt_admission,"after":corrupt_after}
            })
        );
    }
    Ok(())
}
