//! Bounded REF-03-049 test transport linked to the production accounting C ABI.
//! Source/binding verification belongs to the trusted test host. This runner loads
//! the module and checks its selected durable applied/rolling admission descriptor.
//! It does not implement a Driver, persistence storage or a physical cutoff.
use ghostflow_wasm::accounting_abi::*;
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, error::Error, fs::File, io::Read, slice};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("reservation tape exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn n(v: &Value) -> Result<u64, Box<dyn Error>> {
    v.as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| "invalid exact integer".into())
}
fn id(v: &Value) -> Result<[u8; 16], Box<dyn Error>> {
    Ok([u8::try_from(n(v)?)?; 16])
}
unsafe fn snapshot(h: *mut AccountingHandle) -> Value {
    let status = gf_accounting_snapshot(h);
    let bytes = slice::from_raw_parts(gf_accounting_snapshot_ptr(h), gf_accounting_snapshot_len(h))
        .to_vec();
    json!({"status":status,"bytes":bytes,"revision":gf_accounting_revision(h)})
}
unsafe fn explanation(
    h: *mut AccountingHandle,
    resource: u32,
    now: u64,
    window: u64,
    limit: u64,
    reserve: u64,
) -> Value {
    let mut fields = [0u64; 6];
    let status = gf_accounting_explain_rolling(
        h,
        resource,
        now,
        window,
        limit,
        reserve,
        fields.as_mut_ptr(),
    );
    json!({"status":status,"fields":if status==1 { json!(fields) } else { Value::Null }})
}
unsafe fn acknowledge(h: *mut AccountingHandle) -> Result<(), Box<dyn Error>> {
    if gf_accounting_snapshot(h) != 1
        || gf_accounting_ack_persisted(h, gf_accounting_revision(h)) != 1
    {
        return Err("durable acknowledgement rejected".into());
    }
    Ok(())
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 {
        return Err("usage: stop_delay_reservation_tape <module.gfb> <tape.json>".into());
    }
    let bytes = read(&args[1])?;
    ghostflow_core::Module::load(&bytes)?;
    let tape: Value = serde_json::from_slice(&read(&args[2])?)?;
    let fingerprint = format!(
        "{:016x}",
        bytes
            .iter()
            .fold(0xcbf29ce484222325u64, |h, b| (h ^ u64::from(*b))
                .wrapping_mul(0x100000001b3))
    );
    if tape["moduleFingerprint"].as_str() != Some(&fingerprint) {
        return Err("compiled module identity mismatch".into());
    }
    let account = tape["account"].as_str().ok_or("missing account")?;
    let binding = tape["manifest"]["accounting"]["bindings"]
        .as_array()
        .ok_or("missing bindings")?
        .iter()
        .find(|b| b["name"].as_str() == Some(account))
        .ok_or("unknown account")?;
    if binding["operation"] != "on_time"
        || binding["persistence"] != "durable"
        || binding["evidenceBinding"]["kind"] != "applied_interval"
        || binding["evidenceBinding"]["stage"] != "applied"
        || binding["evidenceBinding"]["target"] != tape["target"]
    {
        return Err("source accounting binding mismatch".into());
    }
    let resource = u32::try_from(n(&tape["resourceId"])?)?;
    if resource == 0 {
        return Err("zero resource identity".into());
    }
    let window = n(&tape["windowMs"])?;
    let limit = n(&tape["limitMs"])?;
    let reserve = n(&tape["reserveMs"])?;
    let selected = tape["manifest"]["accounting"]["constraints"]
        .as_array()
        .ok_or("missing constraints")?
        .iter()
        .filter_map(|g| g["limits"].as_array())
        .flatten()
        .find(|l| l["account"].as_str() == Some(account) && l["basis"]["kind"] == "rolling")
        .ok_or("missing rolling limit")?;
    if selected["basis"]["durationMs"] != tape["windowMs"]
        || selected["boundMs"] != tape["limitMs"]
        || selected["reserveMs"] != tape["reserveMs"]
        || selected["operator"] != "<="
        || selected["persistence"] != "durable"
        || selected["onUnknown"] != "block"
    {
        return Err("source rolling admission descriptor mismatch".into());
    }
    let steps = tape["steps"]
        .as_array()
        .filter(|s| !s.is_empty() && s.len() <= 64)
        .ok_or("bounded steps required")?;
    let mut checkpoints: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut rows = Vec::new();
    unsafe {
        let create = || gf_accounting_create(8, 8, 8, window);
        let mut h = create();
        if h.is_null() {
            return Err("invalid ledger config".into());
        }
        for step in steps {
            let action = step["action"].as_str().ok_or("missing action")?;
            let now = n(&step["nowMs"])?;
            let before = snapshot(h);
            let status = match action {
                "initialize" => gf_accounting_initialize_empty(h),
                "record" => gf_accounting_record_applied_segment(
                    h,
                    id(&step["receiptId"])?.as_ptr(),
                    resource,
                    n(&step["startMs"])?,
                    n(&step["endMs"])?,
                    100,
                ),
                "reserve" => gf_accounting_reserve_rolling(
                    h,
                    id(&step["reservationId"])?.as_ptr(),
                    resource,
                    now,
                    window,
                    limit,
                    reserve,
                ),
                "recordReserved" => gf_accounting_record_reserved_segment(
                    h,
                    id(&step["reservationId"])?.as_ptr(),
                    id(&step["receiptId"])?.as_ptr(),
                    resource,
                    n(&step["startMs"])?,
                    n(&step["endMs"])?,
                    100,
                ),
                "settle" => gf_accounting_settle_rolling(
                    h,
                    id(&step["reservationId"])?.as_ptr(),
                    id(&step["receiptId"])?.as_ptr(),
                ),
                "cancel" => gf_accounting_cancel_rolling(
                    h,
                    id(&step["reservationId"])?.as_ptr(),
                    id(&step["evidenceId"])?.as_ptr(),
                ),
                "observe" => 1,
                "save" => {
                    let key = step["checkpoint"]
                        .as_str()
                        .ok_or("missing checkpoint identity")?;
                    let saved = snapshot(h);
                    let data = saved["bytes"]
                        .as_array()
                        .ok_or("missing checkpoint bytes")?
                        .iter()
                        .map(|v| Ok(u8::try_from(n(v)?)?))
                        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
                    checkpoints.insert(key.to_owned(), data);
                    1
                }
                "restart" => {
                    gf_accounting_destroy(h);
                    h = create();
                    if h.is_null() {
                        return Err("invalid restart config".into());
                    }
                    if let Some(key) = step["checkpoint"].as_str() {
                        let mut saved = checkpoints.get(key).ok_or("unknown checkpoint")?.clone();
                        if step["corrupt"].as_bool() == Some(true) {
                            *saved.get_mut(7).ok_or("short checkpoint")? ^= 255;
                        }
                        gf_accounting_restore(h, saved.as_ptr(), saved.len())
                    } else {
                        1
                    }
                }
                _ => return Err("unknown operation".into()),
            };
            let mutate = matches!(
                action,
                "initialize" | "record" | "reserve" | "recordReserved" | "settle" | "cancel"
            );
            let ack = mutate && (status == 1 || status == 2) && step["ack"].as_bool() == Some(true);
            if ack {
                acknowledge(h)?;
            }
            let after = snapshot(h);
            let observed = explanation(h, resource, now, window, limit, reserve);
            rows.push(json!({"action":action,"nowMs":now,"status":status,"persistCalls":u8::from(ack),"before":before,"after":after,"explanation":observed}));
        }
        gf_accounting_destroy(h);
    }
    println!(
        "{}",
        json!({"moduleFingerprint":fingerprint,"account":account,"target":tape["target"],"stage":"applied","resourceId":resource,"rows":rows})
    );
    Ok(())
}
