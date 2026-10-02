//! Test-only transport for the existing bounded Station adapter profile.
//! The Node test compiles canonical literate source, validates every binding,
//! and supplies that exact policy config to both native and WASM owners.
//! The fingerprint binds this transport to the checked constraint artifact;
//! this runner is not a native compiler, pump-curve model or unit validator.
use ghostflow_core::station::{
    CapacityObservation, DurableAck, EnterRequest, Mode, OutputState, StartRequest, Station,
    StationConfig, StationError,
};
use serde_json::{json, Value};
use std::{env, error::Error, fs::File, io::Read};

fn read(path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?.take(1_048_577).read_to_end(&mut bytes)?;
    if bytes.len() > 1_048_576 {
        return Err("station capacity tape/artifact exceeds 1 MiB".into());
    }
    Ok(bytes)
}
fn number(value: &Value) -> Result<u64, Box<dyn Error>> {
    value
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(|| "invalid exact integer".into())
}
fn optional_flow(value: &Value) -> Result<Option<u32>, Box<dyn Error>> {
    if value.is_null() {
        Ok(None)
    } else {
        Ok(Some(u32::try_from(number(value)?)?))
    }
}
fn start(station: &Station, capacity: CapacityObservation, now_ms: u64) -> StartRequest {
    StartRequest {
        request_id: 2,
        claim: station.claim(),
        session_id: 77,
        owner_id: 88,
        mode: Mode::Auto,
        valves: 3,
        budget_ms: 100,
        occurrence_id: Some(501),
        capacity,
        now_ms,
    }
}
fn granted(
    station: &mut Station,
    prepared: ghostflow_core::station::PreparedPersistence,
    now_ms: u64,
) -> Result<Value, Box<dyn Error>> {
    let grant = station.commit_start(DurableAck::new(prepared.token()))?;
    let output = OutputState {
        pump_on: true,
        valves: 1,
    };
    let authorized = station.authorize_output(77, output, now_ms)?;
    Ok(
        json!({"capacity":format!("{:?}",grant.capacity),"leaseDeadlineMs":grant.lease_deadline_ms,
        "reservedMs":station.reserved_ms(),"pumpOn":authorized.output.pump_on,"valves":authorized.output.valves,"durableWrites":1}),
    )
}
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: station_capacity_tape <constraints.json> <tape.json>".into());
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
    let cases = tape["cases"]
        .as_array()
        .filter(|cases| cases.len() <= 32)
        .ok_or("invalid bounded cases")?;
    let mut observations = Vec::new();
    for case in cases {
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
        let capacity = CapacityObservation {
            available_flow: optional_flow(&case["capacity"]["availableFlow"])?,
            requested_flow: optional_flow(&case["capacity"]["requestedFlow"])?,
        };
        let before = station.claim();
        let initial = match station.prepare_start(start(&station, capacity, 10)) {
            Ok(prepared) => json!({"rejected":false,"grant":granted(&mut station, prepared, 10)?}),
            Err(StationError::CapacityRequired) => {
                let unchanged = station.claim() == before;
                let no_grant = station
                    .authorize_output(
                        77,
                        OutputState {
                            pump_on: true,
                            valves: 1,
                        },
                        10,
                    )
                    .err()
                    == Some(StationError::SessionMismatch);
                let no_pending = station.commit_start(DurableAck::new(1)).err()
                    == Some(StationError::NoPendingPersistence);
                json!({"rejected":true,"error":"required pump capacity check was not Pass",
                    "unchanged":unchanged,"reservedMs":station.reserved_ms(),"durableWrites":0,
                    "noGrant":no_grant,"noPending":no_pending})
            }
            Err(error) => return Err(error.into()),
        };
        let retry = if initial["rejected"] == true {
            let request = start(
                &station,
                CapacityObservation {
                    available_flow: Some(10),
                    requested_flow: Some(10),
                },
                11,
            );
            let prepared = station.prepare_start(request)?;
            granted(&mut station, prepared, 11)?
        } else {
            Value::Null
        };
        observations.push(json!({"label":case["label"],"initial":initial,"retry":retry}));
    }
    println!(
        "{}",
        json!({"artifactFingerprint":fingerprint,"observations":observations})
    );
    Ok(())
}
