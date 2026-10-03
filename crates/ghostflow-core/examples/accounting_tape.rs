//! Test-only transport for source-bound historical accounting observations.
//! The test host verifies canonical source/manifest identity before this call.
//! This runner loads the exact module and declared account, then delegates all
//! interval union and rolling calculation to AccountingLedger. An optional
//! explicit test-host Station tape exercises its admission/lifecycle owner.
//! This is neither production control admission nor physical receipt validation.
use ghostflow_core::{
    accounting::{
        AccountingConfig, AccountingError, AccountingLedger, AdmissionResult, LedgerRead,
    },
    station::{
        CapacityObservation, DurableAck, EnterRequest, FinishOutcome, Mode, OutputState,
        StartRequest, Station, StationConfig, StationError, StopProof, StopRequest,
    },
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
// Test-host lifecycle transport. The same explicit config/timestamps are used by
// the WASM host; this is not compiler lowering of stopped(station).
fn station_observations(tape: &Value) -> Result<Value, Box<dyn Error>> {
    let config = &tape["config"];
    let mut station = Station::new(StationConfig {
        valve_count: u8::try_from(number(&config["valveCount"])?)?,
        max_open_valves: u8::try_from(number(&config["maxOpenValves"])?)?,
        daily_quota_ms: number(&config["dailyQuotaMs"])?,
        max_start_budget_ms: number(&config["maxStartBudgetMs"])?,
        ..StationConfig::default()
    })?;
    let at = |name: &str| number(&tape[name]);
    let observe = |station: &Station, phase: &str, rejected: bool| {
        json!({
            "phase":phase,"mode":format!("{:?}",station.mode()),"stopping":station.stopping(),
            "reservedMs":station.reserved_ms(),"usedMs":station.daily_used_ms(),"rejected":rejected
        })
    };
    station.synchronize_day(100, 0, 10_000, true)?;
    station.enter(EnterRequest {
        request_id: 1,
        claim: station.claim(),
        mode: Mode::Auto,
    })?;
    let prepared = station.prepare_start(StartRequest {
        request_id: 2,
        claim: station.claim(),
        session_id: 77,
        owner_id: 88,
        mode: Mode::Auto,
        valves: 3,
        budget_ms: 100,
        occurrence_id: Some(501),
        capacity: CapacityObservation::default(),
        now_ms: at("onMs")?,
    })?;
    station.commit_start(DurableAck::new(prepared.token()))?;
    let on = OutputState {
        pump_on: true,
        valves: 1,
    };
    station.authorize_output(77, on, at("onMs")?)?;
    station.report_applied(77, on, at("onMs")?)?;
    let cleanup = OutputState {
        pump_on: false,
        valves: 1,
    };
    station.authorize_output(77, cleanup, at("offMs")?)?;
    station.report_applied(77, cleanup, at("offMs")?)?;
    station.request_stop(StopRequest {
        request_id: 3,
        claim: station.claim(),
    })?;
    let rejected = station
        .prepare_finish(77, FinishOutcome::Cancelled, at("offMs")?)
        .err()
        == Some(StationError::OutputStillApplied);
    if !rejected {
        return Err("pump OFF with open valves must reject finish for unsafe outputs".into());
    }
    if station
        .confirm_stopped(StopProof::Commanded, at("offMs")?)
        .err()
        != Some(StationError::InvalidRequest(
            "active session needs durable prepare_finish",
        ))
    {
        return Err("active session allowed stop confirmation".into());
    }
    let mut observations = vec![observe(&station, "pump-off-cleanup-open", rejected)];
    // The owner still prevents re-entry and stop confirmation while its session
    // and reservation remain, even after all outputs have become safe.
    if station
        .enter(EnterRequest {
            request_id: 4,
            claim: station.claim(),
            mode: Mode::Manual,
        })
        .is_ok()
    {
        return Err("unfinished owner allowed mode entry".into());
    }
    station.report_applied(77, OutputState::SAFE, at("safeMs")?)?;
    let prepared = station.prepare_finish(77, FinishOutcome::Cancelled, at("safeMs")?)?;
    observations.push(observe(&station, "safe-awaiting-durable-finish", false));
    station.commit_finish(DurableAck::new(prepared.token()))?;
    observations.push(observe(&station, "durable-finish", false));
    Ok(json!(observations))
}
// One fixed test-host joins the existing owners; no production admission or
// boot-clock bridge is claimed. Timestamps share a caller-trusted timeline.
fn restart_observations(
    ledger: &mut AccountingLedger,
    config: AccountingConfig,
    resource: u32,
    window: u64,
    tape: &Value,
) -> Result<Value, Box<dyn Error>> {
    let bound = &tape["stationConfig"];
    let station_config = StationConfig {
        valve_count: u8::try_from(number(&bound["valveCount"])?)?,
        max_open_valves: u8::try_from(number(&bound["maxOpenValves"])?)?,
        daily_quota_ms: number(&bound["dailyQuotaMs"])?,
        max_start_budget_ms: number(&bound["maxStartBudgetMs"])?,
        ..StationConfig::default()
    };
    let limit = number(&tape["limitMs"])?;
    let reserve = number(&tape["reserveMs"])?;
    let mut station = Station::new(station_config.clone())?;
    station.synchronize_day(100, 0, 100_000, true)?;
    station.enter(EnterRequest {
        request_id: 1,
        claim: station.claim(),
        mode: Mode::Auto,
    })?;
    let request = |station: &Station, request_id, occurrence, now_ms| StartRequest {
        request_id,
        claim: station.claim(),
        session_id: 77,
        owner_id: 88,
        mode: Mode::Auto,
        valves: 1,
        budget_ms: 100,
        occurrence_id: Some(occurrence),
        capacity: CapacityObservation::default(),
        now_ms,
    };
    let start = station.prepare_start(request(&station, 2, 501, 10))?;
    station.commit_start(DurableAck::new(start.token()))?;
    let on = OutputState {
        pump_on: true,
        valves: 1,
    };
    station.authorize_output(77, on, 10)?;
    station.report_applied(77, on, 10)?;
    station.authorize_output(77, OutputState::SAFE, 40)?;
    station.report_applied(77, OutputState::SAFE, 40)?;
    let finish = station.prepare_finish(77, FinishOutcome::Completed, 40)?;
    station.commit_finish(DurableAck::new(finish.token()))?;
    let mut observations = Vec::new();
    for phase in ["beforeRestart", "afterRestart", "afterWindowExpiry"] {
        let now = if phase == "afterWindowExpiry" {
            60_040
        } else {
            50
        };
        if phase == "afterRestart" {
            station.request_stop(StopRequest {
                request_id: 3,
                claim: station.claim(),
            })?;
            station.confirm_stopped(StopProof::Commanded, 50)?;
            let station_bytes = station.snapshot_bytes()?;
            let ledger_bytes = ledger.snapshot_bytes()?;
            station = Station::restore(station_config.clone(), &station_bytes)?;
            *ledger = AccountingLedger::restore(config, &ledger_bytes)?;
            station.synchronize_day(100, 50, 100_000, true)?;
            station.enter(EnterRequest {
                request_id: 4,
                claim: station.claim(),
                mode: Mode::Auto,
            })?;
        }
        if station.prepare_start(request(&station, 5, 501, now)).err()
            != Some(StationError::DuplicateOccurrence)
        {
            return Err("once ledger reset or duplicate occurrence admitted".into());
        }
        // Independent positive day/once admission, aborted before any grant:
        // rolling rejection cannot be explained by a duplicate or exhausted day.
        let prepared = station.prepare_start(request(&station, 6, 502, now))?;
        station.abort_prepared(prepared.token())?;
        let mut reservation = [0u8; 16];
        reservation[0] = if now == 50 { 20 } else { 21 };
        let rolling: String =
            match ledger.reserve_rolling(reservation, resource, now, window, limit, reserve) {
                Ok(AdmissionResult::Reserved) => "Inserted".into(),
                Ok(AdmissionResult::Duplicate) => "Duplicate".into(),
                Err(AccountingError::LimitExceeded) => "Rejected".into(),
                Err(error) => return Err(error.into()),
            };
        let used = match ledger.used_rolling(resource, now, window) {
            LedgerRead::Known(v) => v,
            _ => return Err("unknown rolling history".into()),
        };
        let day = match ledger.used_local_day(resource, 100) {
            LedgerRead::Known(v) => v,
            _ => return Err("unknown day history".into()),
        };
        observations.push(
            json!({"phase":phase,"nowMs":now,"duplicate":"DuplicateOccurrence",
            "freshDayAdmission":true,"stationDayUsedMs":station.daily_used_ms(),"dayUsedMs":day,
            "rollingUsedMs":used,"rollingAdmission":rolling}),
        );
    }
    Ok(json!(observations))
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
    let mut admissions = Vec::new();
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
        if !frame["admission"].is_null() {
            let request = &frame["admission"];
            let limit = number(&request["limitMs"])?;
            let reserve = number(&request["reserveMs"])?;
            let sequence = number(&request["reservationId"])?;
            if sequence == 0 {
                return Err("reservation identity must be non-zero".into());
            }
            let retry = request["retry"].as_bool().ok_or("retry flag is required")?;
            let selected = tape["manifest"]["accounting"]["constraints"]
                .as_array()
                .ok_or("missing source constraint")?
                .iter()
                .filter_map(|group| group["limits"].as_array())
                .flatten()
                .find(|limit| {
                    limit["account"].as_str() == Some(account)
                        && limit["basis"]["kind"] == "rolling"
                })
                .ok_or("missing source rolling constraint")?;
            if selected["basis"]["durationMs"] != tape["windowMs"]
                || selected["operator"] != "<="
                || selected["persistence"] != "durable"
                || selected["boundMs"] != request["limitMs"]
                || selected["reserveMs"] != request["reserveMs"]
                || selected["onUnknown"] != "block"
            {
                return Err("source rolling admission constraint mismatch".into());
            }
            let mut reservation = [0u8; 16];
            reservation[..8].copy_from_slice(&sequence.to_le_bytes());
            let before = ledger.snapshot_bytes()?;
            let status =
                match ledger.reserve_rolling(reservation, resource, now, window, limit, reserve) {
                    Ok(AdmissionResult::Reserved) => "Inserted",
                    Ok(AdmissionResult::Duplicate) => "Duplicate",
                    Err(AccountingError::LimitExceeded) => "Rejected",
                    Err(error) => return Err(error.into()),
                };
            let after = ledger.snapshot_bytes()?;
            let unchanged = before == after;
            // Test-host serialization round trip is explicit. Physical storage
            // and the WASM adapter's durability acknowledgement remain separate.
            ledger = AccountingLedger::restore(config, &after)?;
            let retry_status = if retry {
                Some(
                    match ledger.reserve_rolling(reservation, resource, now, window, limit, reserve)
                    {
                        Ok(AdmissionResult::Reserved) => "Inserted",
                        Ok(AdmissionResult::Duplicate) => "Duplicate",
                        Err(AccountingError::LimitExceeded) => "Rejected",
                        Err(error) => return Err(error.into()),
                    },
                )
            } else {
                None
            };
            let explanation = match ledger.explain_rolling(resource, now, window, limit, reserve) {
                LedgerRead::Known(value) => value,
                LedgerRead::Unknown => return Err("rolling admission is Unknown".into()),
            };
            admissions.push(json!({"nowMs":now,"status":status,"snapshotUnchanged":unchanged,
                "retry":retry_status,"usedMs":explanation.used_ms,"reservedMs":explanation.reserved_ms}));
        }
    }
    let mut result = json!({"moduleFingerprint":fingerprint,"account":account,"target":target,"stage":"applied","resourceId":resource,"observations":observations});
    if !admissions.is_empty() {
        result["admissionObservations"] = json!(admissions);
    }
    if !tape["station"].is_null() {
        result["stationObservations"] = station_observations(&tape["station"])?;
    }
    if !tape["restart"].is_null() {
        let limits = tape["manifest"]["accounting"]["constraints"]
            .as_array()
            .ok_or("missing source constraint")?;
        let selected = limits
            .iter()
            .filter_map(|group| group["limits"].as_array())
            .flatten()
            .find(|limit| {
                limit["account"].as_str() == Some(account) && limit["basis"]["kind"] == "rolling"
            })
            .ok_or("missing source rolling constraint")?;
        if selected["basis"]["durationMs"] != tape["windowMs"]
            || selected["boundMs"] != tape["restart"]["limitMs"]
            || selected["reserveMs"] != tape["restart"]["reserveMs"]
        {
            return Err("source rolling constraint mismatch".into());
        }
        result["restartObservations"] =
            restart_observations(&mut ledger, config, resource, window, &tape["restart"])?;
    }
    println!("{result}");
    Ok(())
}
