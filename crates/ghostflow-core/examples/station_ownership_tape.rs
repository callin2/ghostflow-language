//! Test-only transport for the existing fixed Station owner, not a resource-policy VM.
//! The host checks canonical source/bindings and passes the same config to native/WASM.
use ghostflow_core::station::{
    CapacityObservation, DurableAck, EnterRequest, FinishOutcome, Mode, OutputState, StartRequest,
    Station, StationConfig, StationError,
};
use serde_json::{json, Value};
use std::{env, error::Error, fs::File, io::Read};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("station ownership tape/artifact exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn number(value: &Value) -> Result<u64, Box<dyn Error>> {
    value
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| "invalid exact integer".into())
}
fn request(station: &Station, session_id: u64, now_ms: u64) -> StartRequest {
    StartRequest {
        request_id: if session_id == 77 { 2 } else { 3 },
        claim: station.claim(),
        session_id,
        owner_id: session_id + 11,
        mode: Mode::Auto,
        valves: 3,
        budget_ms: 100,
        occurrence_id: None,
        capacity: CapacityObservation::default(),
        now_ms,
    }
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: station_ownership_tape <constraints.json> <tape.json>".into());
    }
    let artifact = read(&args[0])?;
    let fingerprint = format!(
        "{:016x}",
        artifact
            .iter()
            .fold(0xcbf29ce484222325u64, |hash, byte| (hash
                ^ u64::from(*byte))
            .wrapping_mul(0x100000001b3))
    );
    let tape: Value = serde_json::from_slice(&read(&args[1])?)?;
    if tape["artifactFingerprint"].as_str() != Some(&fingerprint) {
        return Err("checked constraint artifact identity mismatch".into());
    }
    let config = &tape["stationConfig"];
    let order = tape["order"].as_str().ok_or("missing order")?;
    if order != "AB" && order != "BA" {
        return Err("invalid bounded order".into());
    }
    let mut station = Station::new(StationConfig {
        valve_count: u8::try_from(number(&config["valveCount"])?)?,
        max_open_valves: u8::try_from(number(&config["maxOpenValves"])?)?,
        daily_quota_ms: number(&config["dailyQuotaMs"])?,
        max_start_budget_ms: number(&config["maxStartBudgetMs"])?,
        require_capacity_pass: config["requireCapacityPass"]
            .as_bool()
            .ok_or("missing capacity requirement")?,
        ..StationConfig::default()
    })?;
    station.synchronize_day(20_000, 0, 10_000, true)?;
    station.enter(EnterRequest {
        request_id: 1,
        claim: station.claim(),
        mode: Mode::Auto,
    })?;
    let prepared = station.prepare_start(request(&station, 77, 10))?;
    let grant = station.commit_start(DurableAck::new(prepared.token()))?;
    let on = OutputState {
        pump_on: true,
        valves: 1,
    };
    let off = OutputState {
        pump_on: false,
        valves: 1,
    };
    let mut trace = vec![json!({"event":"lease","nowMs":10,"sessionId":77,
        "leaseDeadlineMs":grant.lease_deadline_ms,"reservedMs":station.reserved_ms()})];
    for actor in order.chars() {
        if actor == 'A' {
            let output = station.authorize_output(77, on, 10)?;
            trace.push(
                json!({"event":"request","actor":"A","nowMs":10,"pumpOn":true,
                "accepted":true,"sessionId":output.session_id,"valves":output.output.valves}),
            );
        } else {
            if station.authorize_output(78, OutputState::SAFE, 10).err()
                != Some(StationError::SessionMismatch)
            {
                return Err("inactive B unexpectedly authorized".into());
            }
            trace.push(
                json!({"event":"request","actor":"B","nowMs":10,"pumpOn":false,
                "accepted":false,"error":"SessionMismatch"}),
            );
        }
    }
    // No reauthorization: this real owner check must still recognize A's ON grant.
    station.report_applied(77, on, 10)?;
    if station.report_applied(78, OutputState::SAFE, 10).err()
        != Some(StationError::SessionMismatch)
    {
        return Err("inactive B unexpectedly reported applied".into());
    }
    trace.push(
        json!({"event":"appliedFixture","nowMs":10,"sessionId":77,"pumpOn":true,"valves":1,
        "nonownerReportRejected":true}),
    );
    station.advance(20)?;
    trace.push(
        json!({"event":"ledger","nowMs":20,"dailyUsedMs":station.daily_used_ms(),
        "reservedMs":station.reserved_ms()}),
    );
    station.authorize_output(77, off, 20)?;
    if station.authorize_output(78, OutputState::SAFE, 20).err()
        != Some(StationError::SessionMismatch)
    {
        return Err("inactive B unexpectedly authorized between phases".into());
    }
    station.report_applied(77, off, 20)?;
    if station.prepare_start(request(&station, 78, 20)).err() != Some(StationError::AlreadyOwned) {
        return Err("B unexpectedly acquired an OFF session lease".into());
    }
    trace.push(json!({"event":"betweenPhases","nowMs":20,"sessionId":77,"pumpOn":false,"valves":1,
        "nonownerRejected":true,"acquisitionRejected":"AlreadyOwned","reservedMs":station.reserved_ms()}));
    station.authorize_output(77, on, 30)?;
    station.report_applied(77, on, 30)?;
    trace
        .push(json!({"event":"appliedFixture","nowMs":30,"sessionId":77,"pumpOn":true,"valves":1}));
    station.authorize_output(77, OutputState::SAFE, 40)?;
    station.report_applied(77, OutputState::SAFE, 40)?;
    let prepared = station.prepare_finish(77, FinishOutcome::Completed, 40)?;
    station.commit_finish(DurableAck::new(prepared.token()))?;
    trace.push(
        json!({"event":"finish","nowMs":40,"dailyUsedMs":station.daily_used_ms(),
        "reservedMs":station.reserved_ms()}),
    );
    println!(
        "{}",
        json!({"artifactFingerprint":fingerprint,"order":order,"trace":trace})
    );
    Ok(())
}
