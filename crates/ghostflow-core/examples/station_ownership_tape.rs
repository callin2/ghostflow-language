//! Test-only transport for the existing fixed Station owner, not a resource-policy VM.
//! The host checks canonical source/bindings and passes the same config to native/WASM.
use ghostflow_core::station::{
    CapacityObservation, DurableAck, EnterRequest, FinishOutcome, Mode, OutputState, StartRequest,
    Station, StationConfig, StationError, StopProof, StopRequest,
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
// A second bounded tape proves whole-session admission, without altering the
// same-tick inactive-request oracle above. Applied states remain host fixtures.
fn lifecycle(station: &mut Station, fingerprint: &str) -> Result<(), Box<dyn Error>> {
    let prepared = station.prepare_start(request(station, 77, 10))?;
    let grant = station.commit_start(DurableAck::new(prepared.token()))?;
    let mut trace = vec![json!({"event":"lease","nowMs":10,"sessionId":77,
        "leaseDeadlineMs":grant.lease_deadline_ms,"reservedMs":station.reserved_ms()})];
    for (phase, now_ms, pump_on, valves) in [
        ("preopen", 10, false, 1),
        ("on", 20, true, 1),
        ("betweenStages", 30, false, 1),
        ("cleanup", 40, false, 2),
    ] {
        let output = OutputState { pump_on, valves };
        station.authorize_output(77, output, now_ms)?;
        station.report_applied(77, output, now_ms)?;
        if station.prepare_start(request(station, 78, now_ms)).err()
            != Some(StationError::AlreadyOwned)
            || station.active_session() != Some(77)
            || station.pending_token().is_some()
        {
            return Err("B acquired or changed A's active lease".into());
        }
        trace.push(
            json!({"event":phase,"nowMs":now_ms,"sessionId":77,"pumpOn":pump_on,
            "valves":valves,"admission":"AlreadyOwned","reservedMs":station.reserved_ms(),
            "dailyUsedMs":station.daily_used_ms()}),
        );
    }
    if station
        .prepare_finish(77, FinishOutcome::Cancelled, 40)
        .err()
        != Some(StationError::OutputStillApplied)
    {
        return Err("cleanup incorrectly treated pump OFF as stopped".into());
    }
    let directive = station.request_stop(StopRequest {
        request_id: 4,
        claim: station.claim(),
    })?;
    if !directive.force_safe_output
        || station.prepare_start(request(station, 78, 40)).err() != Some(StationError::Stopping)
        || station.confirm_stopped(StopProof::Commanded, 40).is_ok()
    {
        return Err("stop confirmation released active ownership".into());
    }
    trace.push(json!({"event":"stopBarrier","nowMs":40,"mode":"Auto","stopping":station.stopping(),
        "admission":"Stopping","sessionId":77,"reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}));
    station.report_applied(77, OutputState::SAFE, 50)?;
    if station.prepare_start(request(station, 78, 50)).err() != Some(StationError::Stopping)
        || station.confirm_stopped(StopProof::Commanded, 50).is_ok()
    {
        return Err("safe fixture released ownership before durable finish".into());
    }
    let finish = station.prepare_finish(77, FinishOutcome::Cancelled, 50)?;
    if station.prepare_start(request(station, 78, 50)).err()
        != Some(StationError::PendingPersistence)
        || station
            .commit_finish(DurableAck::new(finish.token() + 1))
            .err()
            != Some(StationError::PersistenceTokenMismatch)
        || station.active_session() != Some(77)
        || station.pending_token() != Some(finish.token())
    {
        return Err("unacknowledged finish released ownership".into());
    }
    trace.push(
        json!({"event":"finishPending","nowMs":50,"mode":"Auto","stopping":station.stopping(),
        "admission":"PendingPersistence","sessionId":77,"pumpOn":false,"valves":0,
        "reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}),
    );
    station.commit_finish(DurableAck::new(finish.token()))?;
    if station.active_session().is_some()
        || station.mode() != Mode::Stopped
        || station.prepare_start(request(station, 78, 50)).err() != Some(StationError::ModeMismatch)
    {
        return Err("finish did not require explicit new mode entry".into());
    }
    trace.push(json!({"event":"finishAck","nowMs":50,"mode":"Stopped","stopping":station.stopping(),
        "admission":"ModeMismatch","reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}));
    station.enter(EnterRequest {
        request_id: 5,
        claim: station.claim(),
        mode: Mode::Auto,
    })?;
    let prepared = station.prepare_start(request(station, 78, 50))?;
    let grant = station.commit_start(DurableAck::new(prepared.token()))?;
    let output = station.authorize_output(
        78,
        OutputState {
            pump_on: false,
            valves: 1,
        },
        50,
    )?;
    if station.authorize_output(77, OutputState::SAFE, 50).err()
        != Some(StationError::SessionMismatch)
    {
        return Err("old owner retained a grant after release".into());
    }
    trace.push(
        json!({"event":"BAdmitted","nowMs":50,"sessionId":output.session_id,
        "leaseDeadlineMs":grant.lease_deadline_ms,"pumpOn":false,"valves":1,
        "reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}),
    );
    println!(
        "{}",
        json!({"artifactFingerprint":fingerprint,"scenario":"lifecycle","trace":trace})
    );
    Ok(())
}
fn mode_batch(station: &mut Station, fingerprint: &str, order: &str) -> Result<(), Box<dyn Error>> {
    let prepared = station.prepare_start(request(station, 77, 10))?;
    station.commit_start(DurableAck::new(prepared.token()))?;
    let on = OutputState {
        pump_on: true,
        valves: 1,
    };
    station.authorize_output(77, on, 20)?;
    station.report_applied(77, on, 20)?;
    station.advance(40)?;
    let old = station.claim();
    station.request_stop(StopRequest {
        request_id: 4,
        claim: old,
    })?;
    let mut trace = vec![
        json!({"event":"Stop","nowMs":40,"mode":format!("{:?}", station.mode()),"stopping":station.stopping(),"reservedMs":station.reserved_ms()}),
    ];
    let modes = match order {
        "MC" => [Mode::Manual, Mode::Configure],
        "CM" => [Mode::Configure, Mode::Manual],
        _ => return Err("invalid mode batch order".into()),
    };
    let entries = |claim| {
        [
            EnterRequest {
                request_id: 5,
                claim,
                mode: modes[0],
            },
            EnterRequest {
                request_id: 6,
                claim,
                mode: modes[1],
            },
        ]
    };
    for claim in [old, station.claim()] {
        let before = station.snapshot_bytes()?;
        if station.enter_batch(&entries(claim)).is_ok() || station.snapshot_bytes()? != before {
            return Err("Stop-time entries mutated the owner".into());
        }
    }
    if station.prepare_start(request(station, 78, 40)).err() != Some(StationError::Stopping) {
        return Err("new start escaped Stop barrier".into());
    }
    trace.push(json!({"event":"entriesRejected","nowMs":40,"order":order,"mode":format!("{:?}", station.mode()),"stopping":station.stopping(),"reservedMs":station.reserved_ms()}));
    station.report_applied(77, OutputState::SAFE, 50)?;
    let finish = station.prepare_finish(77, FinishOutcome::Cancelled, 50)?;
    if station.enter_batch(&entries(station.claim())).err()
        != Some(StationError::PendingPersistence)
    {
        return Err("pending finish allowed entry".into());
    }
    station.commit_finish(DurableAck::new(finish.token()))?;
    station.advance(60)?;
    if station.mode() != Mode::Stopped || station.reserved_ms() != 0 {
        return Err("hidden entry after Stop completion".into());
    }
    trace.push(json!({"event":"finishAck","nowMs":60,"mode":format!("{:?}", station.mode()),"stopping":station.stopping(),"reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}));
    let before = station.snapshot_bytes()?;
    if station.enter_batch(&entries(station.claim())).err()
        != Some(StationError::ConflictingModeRequests)
        || station.snapshot_bytes()? != before
    {
        return Err("conflicting stopped entries selected a winner".into());
    }
    if station
        .enter(EnterRequest {
            request_id: 5,
            claim: old,
            mode: modes[0],
        })
        .is_ok()
    {
        return Err("stale entry claim survived Stop".into());
    }
    station.enter(EnterRequest {
        request_id: 5,
        claim: station.claim(),
        mode: modes[0],
    })?;
    trace.push(json!({"event":"explicitEntry","nowMs":60,"mode":format!("{:?}", station.mode())}));
    println!(
        "{}",
        json!({"artifactFingerprint":fingerprint,"scenario":"stopModeBatch","trace":trace})
    );
    Ok(())
}
// Explicit test-host planner inputs; the Station receives a total finite ON
// upper bound, not a new production reservation grammar or Driver guarantee.
fn reservation_cutoff(
    station: &mut Station,
    config: StationConfig,
    tape: &Value,
    fingerprint: &str,
) -> Result<(), Box<dyn Error>> {
    let worst = number(&tape["worstOnMs"])?;
    let delay = number(&tape["stopDelayMs"])?;
    let cutoff = number(&tape["manualCutoffMs"])?;
    let automatic = worst.checked_add(delay).ok_or("reservation overflow")?;
    let manual = cutoff.checked_add(delay).ok_or("reservation overflow")?;
    station.synchronize_day(20_000, 0, 86_400_000, true)?;
    station.enter(EnterRequest {
        request_id: 1,
        claim: station.claim(),
        mode: Mode::Auto,
    })?;
    let mut req = request(station, 77, 0);
    req.budget_ms = automatic;
    if station.prepare_start(req).err() != Some(StationError::QuotaExceeded) {
        return Err("automatic worst ON plus stop delay was admitted".into());
    }
    let mut trace = vec![
        json!({"event":"automaticRejected","budgetMs":automatic,"error":"QuotaExceeded","reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}),
    ];
    station.request_stop(StopRequest {
        request_id: 4,
        claim: station.claim(),
    })?;
    station.confirm_stopped(StopProof::Commanded, 0)?;
    station.enter(EnterRequest {
        request_id: 5,
        claim: station.claim(),
        mode: Mode::Manual,
    })?;
    req.claim = station.claim();
    req.mode = Mode::Manual;
    for budget in [0, u64::MAX] {
        req.budget_ms = budget;
        if station.prepare_start(req).err()
            != Some(StationError::InvalidRequest(
                "start budget must be finite and within station maximum",
            ))
        {
            return Err("non-finite or absent manual bound was admitted".into());
        }
    }
    trace.push(json!({"event":"manualUnboundedRejected","reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms()}));
    req.budget_ms = manual;
    let prepared = station.prepare_start(req)?;
    let grant = station.commit_start(DurableAck::new(prepared.token()))?;
    let on = OutputState {
        pump_on: true,
        valves: 1,
    };
    station.authorize_output(77, on, 0)?;
    station.report_applied(77, on, 0)?;
    trace.push(json!({"event":"finiteManualGranted","cutoffMs":cutoff,"budgetMs":manual,"leaseDeadlineMs":grant.lease_deadline_ms,"reservedMs":station.reserved_ms()}));
    let snapshot = station.snapshot_bytes()?;
    let mut recovered = Station::restore(config, &snapshot)?;
    recovered.synchronize_day(20_000, 0, 86_400_000, true)?;
    let mut recovery_request = req;
    recovery_request.request_id = 3;
    recovery_request.claim = recovered.claim();
    if recovered.prepare_start(recovery_request).err() != Some(StationError::RecoveryHold) {
        return Err("uncertain reservation resumed".into());
    }
    trace.push(json!({"event":"recoveryHold","reservedMs":recovered.reserved_ms(),"dailyUsedMs":recovered.daily_used_ms()}));
    station.advance(cutoff)?;
    let directive = station.request_stop(StopRequest {
        request_id: 6,
        claim: station.claim(),
    })?;
    if !directive.force_safe_output {
        return Err("manual cutoff did not command safe output".into());
    }
    trace.push(json!({"event":"manualCutoff","nowMs":cutoff,"forceSafeOutput":directive.force_safe_output,"reservedMs":station.reserved_ms()}));
    let deadline = station.advance(manual)?;
    if !deadline.force_safe_output
        || station.authorize_output(77, on, manual).err() != Some(StationError::Stopping)
    {
        return Err("lease did not enforce cutoff".into());
    }
    trace.push(json!({"event":"leaseDeadline","nowMs":manual,"forceSafeOutput":deadline.force_safe_output,"reservedMs":station.reserved_ms()}));
    // Applied SAFE is an explicit delayed host fixture, not verified physical feedback.
    station.report_applied(77, OutputState::SAFE, manual)?;
    let finish = station.prepare_finish(77, FinishOutcome::Cancelled, manual)?;
    if station
        .commit_finish(DurableAck::new(finish.token() + 1))
        .err()
        != Some(StationError::PersistenceTokenMismatch)
    {
        return Err("wrong finish ACK accepted".into());
    }
    if station.prepare_start(req).err() != Some(StationError::PendingPersistence)
        || station.active_session() != Some(77)
    {
        return Err("pending finish released ownership".into());
    }
    trace.push(json!({"event":"finishPending","reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms(),"mode":format!("{:?}", station.mode())}));
    station.commit_finish(DurableAck::new(finish.token()))?;
    if station.active_session().is_some() {
        return Err("finish retained ownership".into());
    }
    trace.push(json!({"event":"settledApplied","reservedMs":station.reserved_ms(),"dailyUsedMs":station.daily_used_ms(),"mode":format!("{:?}", station.mode())}));
    println!(
        "{}",
        json!({"artifactFingerprint":fingerprint,"scenario":"reservationCutoff","trace":trace})
    );
    Ok(())
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
    let station_config = StationConfig {
        valve_count: u8::try_from(number(&config["valveCount"])?)?,
        max_open_valves: u8::try_from(number(&config["maxOpenValves"])?)?,
        daily_quota_ms: number(&config["dailyQuotaMs"])?,
        max_start_budget_ms: number(&config["maxStartBudgetMs"])?,
        require_capacity_pass: config["requireCapacityPass"]
            .as_bool()
            .ok_or("missing capacity requirement")?,
        ..StationConfig::default()
    };
    let mut station = Station::new(station_config.clone())?;
    if tape["scenario"].as_str() == Some("reservationCutoff") {
        return reservation_cutoff(&mut station, station_config, &tape, &fingerprint);
    }
    station.synchronize_day(20_000, 0, 10_000, true)?;
    station.enter(EnterRequest {
        request_id: 1,
        claim: station.claim(),
        mode: Mode::Auto,
    })?;
    if tape["scenario"].as_str() == Some("lifecycle") {
        return lifecycle(&mut station, &fingerprint);
    }
    if tape["scenario"].as_str() == Some("stopModeBatch") {
        return mode_batch(
            &mut station,
            &fingerprint,
            tape["order"].as_str().ok_or("missing order")?,
        );
    }
    let order = tape["order"].as_str().ok_or("missing order")?;
    if order != "AB" && order != "BA" {
        return Err("invalid bounded order".into());
    }
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
