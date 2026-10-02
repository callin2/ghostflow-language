//! Bounded test-host transport: raw typed events and persistence transitions,
//! never caller-projected counts or AccountingFaults. Execution uses the same
//! ledger-to-Result and VM path as gf_tick_accounting.
use ghostflow_core::{
    accounting::{AccountingConfig, AccountingLedger},
    context_runtime::{AccountingInput, Activation, Facts},
    schedule_clock::{ClockSnapshot, ClockTrust},
    Capability, Module, Runtime, Value,
};
use serde_json::{json, Value as Json};
use std::{env, error::Error, fs::File, io::Read};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 { return Err("event count tape exceeds 1 MiB".into()); }
    Ok(bytes)
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 3 { return Err("expected module and tape paths".into()); }
    let bytes = read(&args[1])?;
    let tape: Json = serde_json::from_slice(&read(&args[2])?)?;
    let config = AccountingConfig { max_intervals: 8, max_events: 8,
        max_reservations: 8, max_rolling_window_ms: 600_000 };
    let cases = tape["cases"].as_array().filter(|v| v.len() <= 32).ok_or("invalid cases")?;
    let mut results = Vec::new();
    for case in cases {
        let mut ledger = AccountingLedger::unknown(config)?;
        let mut acknowledged = false;
        let mut unavailable = 1;
        let mut snapshot = None;
        if case["initialize"].as_bool() == Some(true) {
            ledger = AccountingLedger::new(config)?;
            snapshot = Some(ledger.snapshot_bytes()?);
            acknowledged = case["ack"].as_bool() == Some(true);
            unavailable = 3;
        }
        for event in case["events"].as_array().filter(|v| v.len() <= 16).ok_or("invalid events")? {
            let id = u8::try_from(event["id"].as_u64().ok_or("invalid event id")?)?;
            let event_type = u32::try_from(event["eventType"].as_u64().ok_or("invalid event type")?)?;
            let day = i32::try_from(event["localDay"].as_i64().ok_or("invalid event day")?)?;
            ledger.record_event([id; 16], event_type, day)?;
            snapshot = Some(ledger.snapshot_bytes()?);
            acknowledged = case["ack"].as_bool() == Some(true);
            unavailable = 3;
        }
        if case["recover"].as_bool() == Some(true) { acknowledged = true; }
        if case["corrupt"].as_bool() == Some(true) {
            let mut damaged = snapshot.clone().ok_or("no snapshot to corrupt")?;
            damaged[7] ^= 255;
            if AccountingLedger::restore(config, &damaged).is_ok() {
                return Err("corrupt snapshot unexpectedly restored".into());
            }
            ledger.mark_unknown(); acknowledged = false; unavailable = 2;
        } else if case["restore"].as_bool() == Some(true) {
            ledger = AccountingLedger::restore(config, snapshot.as_ref().ok_or("no snapshot")?)?;
            acknowledged = true;
        }
        let module = Module::load(&bytes)?;
        let capabilities: Vec<_> = module.output_fields()
            .map(|(name, kind)| Capability::new("actuator", name, kind)).collect();
        let mut runtime = Runtime::new(1024);
        runtime.install(module, false);
        for capability in capabilities { runtime.add_capability(capability)?; }
        runtime.activate_with_context(&Activation { boot_epoch: 1, terminal_capacity: 8, bindings: vec![] })?;
        let binding = &tape["binding"];
        let day = if case["localDay"].is_null() { None } else {
            Some(i32::try_from(case["localDay"].as_i64().ok_or("invalid local day")?)?)
        };
        let input = AccountingInput::from_ledger(
            u32::try_from(binding["site"].as_u64().ok_or("invalid site")?)?,
            binding["account"].as_str().ok_or("invalid account")?.into(),
            binding["event"].as_str().ok_or("invalid event")?.into(),
            binding["timezone"].as_str().ok_or("invalid timezone")?.into(),
            &ledger, 9, day, acknowledged, unavailable)?;
        runtime.set_input("__gf_now_ms", Value::Number(0.0))?;
        runtime.set_input("__gf_time_epoch", Value::Number(1.0))?;
        let record = runtime.tick_with_context(ClockSnapshot { monotonic_ms: 0, boot_epoch: 1,
            wall_ms: Some(1_700_000_000_000), trust: ClockTrust::Trusted,
            uncertainty_ms: None, source_revision: Some("accounting-v1") },
            &Facts { accounting: vec![input], ..Facts::default() })?;
        results.push(json!({ "trace": serde_json::from_str::<Json>(&record.to_json())?,
            "snapshot": snapshot }));
    }
    println!("{}", serde_json::to_string(&results)?);
    Ok(())
}
