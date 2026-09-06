//! C ABI for the bounded station runtime.  This is intentionally separate from
//! the bytecode Runtime ABI: host storage and physical Driver code stay outside
//! WebAssembly and must acknowledge prepared bytes before any start grant.

use ghostflow_core::station::{
    ApplyRequest, CapacityObservation, Claim, DurableAck, EnterRequest, FinishOutcome, Mode,
    OutputState, Result as StationResult, StartRequest, Station, StationConfig, StopProof,
    StopRequest,
};
use std::slice;

pub struct StationHandle {
    station: Station,
    error: String,
    bytes: Vec<u8>,
    last_lease_deadline_ms: u64,
    last_capacity: u8,
}

impl StationHandle {
    fn new(config: StationConfig) -> StationResult<Self> {
        Ok(Self {
            station: Station::new(config)?,
            error: String::new(),
            bytes: Vec::new(),
            last_lease_deadline_ms: 0,
            last_capacity: 2,
        })
    }
    fn complete(&mut self, result: StationResult<()>) -> i32 {
        match result {
            Ok(()) => {
                self.error.clear();
                1
            }
            Err(error) => {
                self.error = error.to_string();
                0
            }
        }
    }
    fn prepare(
        &mut self,
        result: StationResult<ghostflow_core::station::PreparedPersistence>,
    ) -> i32 {
        match result {
            Ok(prepared) => {
                self.bytes = prepared.bytes().to_vec();
                self.error.clear();
                1
            }
            Err(error) => {
                self.error = error.to_string();
                0
            }
        }
    }
    fn fail(&mut self, message: impl Into<String>) -> i32 {
        self.error = message.into();
        0
    }
}

fn mode(value: u8) -> StationResult<Mode> {
    match value {
        1 => Ok(Mode::Auto),
        2 => Ok(Mode::Manual),
        3 => Ok(Mode::Configure),
        _ => Err(ghostflow_core::station::StationError::InvalidRequest(
            "mode must be Auto(1), Manual(2), or Configure(3)",
        )),
    }
}
fn outcome(value: u8) -> StationResult<FinishOutcome> {
    match value {
        1 => Ok(FinishOutcome::Completed),
        2 => Ok(FinishOutcome::Cancelled),
        3 => Ok(FinishOutcome::SkippedByStop),
        _ => Err(ghostflow_core::station::StationError::InvalidRequest(
            "finish outcome must be Completed(1), Cancelled(2), or SkippedByStop(3)",
        )),
    }
}
fn proof(value: u8) -> StationResult<StopProof> {
    match value {
        0 => Ok(StopProof::Commanded),
        1 => Ok(StopProof::Verified),
        _ => Err(ghostflow_core::station::StationError::InvalidRequest(
            "stop proof must be Commanded(0) or Verified(1)",
        )),
    }
}
fn capacity(value: i64) -> StationResult<Option<u32>> {
    if value == -1 {
        return Ok(None);
    }
    u32::try_from(value).map(Some).map_err(|_| {
        ghostflow_core::station::StationError::InvalidRequest(
            "capacity must be -1 (unknown) or a positive u32",
        )
    })
}
fn abi_bool(value: i32, name: &'static str) -> StationResult<bool> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(ghostflow_core::station::StationError::InvalidRequest(name)),
    }
}
unsafe fn bytes<'a>(ptr: *const u8, length: usize) -> StationResult<&'a [u8]> {
    if ptr.is_null() && length != 0 {
        return Err(ghostflow_core::station::StationError::InvalidRequest(
            "null byte pointer",
        ));
    }
    Ok(if length == 0 {
        &[]
    } else {
        slice::from_raw_parts(ptr, length)
    })
}
unsafe fn occurrences<'a>(ptr: *const u64, length: usize) -> StationResult<&'a [u64]> {
    if ptr.is_null() && length != 0 {
        return Err(ghostflow_core::station::StationError::InvalidRequest(
            "null occurrence pointer",
        ));
    }
    Ok(if length == 0 {
        &[]
    } else {
        slice::from_raw_parts(ptr, length)
    })
}

#[no_mangle]
pub extern "C" fn gf_station_create(
    valve_count: u8,
    max_open_valves: u8,
    daily_quota_ms: u64,
    max_start_budget_ms: u64,
    require_capacity_pass: i32,
) -> *mut StationHandle {
    let mut config = StationConfig::default();
    config.valve_count = valve_count;
    config.max_open_valves = max_open_valves;
    config.daily_quota_ms = daily_quota_ms;
    config.max_start_budget_ms = max_start_budget_ms;
    config.require_capacity_pass = require_capacity_pass != 0;
    match StationHandle::new(config) {
        Ok(handle) => Box::into_raw(Box::new(handle)),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_destroy(handle: *mut StationHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_synchronize_day(
    handle: *mut StationHandle,
    day: u32,
    now_ms: u64,
    deadline_ms: u64,
    trusted: i32,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = abi_bool(trusted, "trusted must be ABI bool 0 or 1").and_then(|trusted| {
        handle
            .station
            .synchronize_day(day, now_ms, deadline_ms, trusted)
    });
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_acknowledge_recovery_safe(
    handle: *mut StationHandle,
    proof_code: u8,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = proof(proof_code).and_then(|proof| {
        handle
            .station
            .acknowledge_recovery_safe_output(proof, now_ms)
    });
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_enter(
    handle: *mut StationHandle,
    mode_code: u8,
    request_id: u64,
    revision: u64,
    stop_generation: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = mode(mode_code).and_then(|mode| {
        handle
            .station
            .enter(EnterRequest {
                request_id,
                claim: Claim {
                    revision,
                    stop_generation,
                },
                mode,
            })
            .map(|_| ())
    });
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_prepare_start(
    handle: *mut StationHandle,
    request_id: u64,
    revision: u64,
    stop_generation: u64,
    session_id: u64,
    owner_id: u64,
    mode_code: u8,
    valves: u64,
    budget_ms: u64,
    occurrence_id: u64,
    available_flow: i64,
    requested_flow: i64,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = (|| {
        Ok(handle.station.prepare_start(StartRequest {
            request_id,
            claim: Claim {
                revision,
                stop_generation,
            },
            session_id,
            owner_id,
            mode: mode(mode_code)?,
            valves,
            budget_ms,
            occurrence_id: if occurrence_id == 0 {
                None
            } else {
                Some(occurrence_id)
            },
            capacity: CapacityObservation {
                available_flow: capacity(available_flow)?,
                requested_flow: capacity(requested_flow)?,
            },
            now_ms,
        })?)
    })();
    handle.prepare(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_commit_start(handle: *mut StationHandle, token: u64) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    match handle.station.commit_start(DurableAck::new(token)) {
        Ok(grant) => {
            handle.last_lease_deadline_ms = grant.lease_deadline_ms;
            handle.last_capacity = match grant.capacity {
                ghostflow_core::station::CapacityCheck::Pass => 0,
                ghostflow_core::station::CapacityCheck::Violation => 1,
                ghostflow_core::station::CapacityCheck::Unknown => 2,
            };
            handle.error.clear();
            1
        }
        Err(error) => handle.fail(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_prepare_stop(
    handle: *mut StationHandle,
    request_id: u64,
    revision: u64,
    stop_generation: u64,
    occurrences_ptr: *const u64,
    occurrences_len: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = occurrences(occurrences_ptr, occurrences_len).and_then(|occurrences| {
        handle.station.prepare_stop(
            StopRequest {
                request_id,
                claim: Claim {
                    revision,
                    stop_generation,
                },
            },
            occurrences,
        )
    });
    handle.prepare(result)
}

/// Returns 2 for an immediately actionable safe-output directive, even when a previous
/// prepare/host write is still pending.  The caller persists a later snapshot separately.
#[no_mangle]
pub unsafe extern "C" fn gf_station_request_stop(
    handle: *mut StationHandle,
    request_id: u64,
    revision: u64,
    stop_generation: u64,
    occurrences_ptr: *const u64,
    occurrences_len: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = occurrences(occurrences_ptr, occurrences_len).and_then(|occurrences| {
        handle.station.request_stop_with_occurrences(
            StopRequest {
                request_id,
                claim: Claim {
                    revision,
                    stop_generation,
                },
            },
            occurrences,
        )
    });
    match result {
        // A directive with a diagnostic still means apply safe outputs now.  The wrapper exposes
        // the diagnostic while preserving the distinct `2` return contract for emergency STOP.
        Ok(directive) => {
            handle.error = directive
                .reason
                .map(|error| error.to_string())
                .unwrap_or_default();
            2
        }
        Err(error) => handle.fail(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_commit_stop(handle: *mut StationHandle, token: u64) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = handle
        .station
        .commit_stop(DurableAck::new(token))
        .map(|_| ());
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_confirm_stopped(
    handle: *mut StationHandle,
    proof_code: u8,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = proof(proof_code).and_then(|proof| handle.station.confirm_stopped(proof, now_ms));
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_prepare_apply(
    handle: *mut StationHandle,
    request_id: u64,
    revision: u64,
    stop_generation: u64,
    next_revision: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = handle.station.prepare_apply(ApplyRequest {
        request_id,
        claim: Claim {
            revision,
            stop_generation,
        },
        next_revision,
    });
    handle.prepare(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_commit_apply(handle: *mut StationHandle, token: u64) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = handle
        .station
        .commit_apply(DurableAck::new(token))
        .map(|_| ());
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_authorize_output(
    handle: *mut StationHandle,
    session_id: u64,
    pump_on: i32,
    valves: u64,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = abi_bool(pump_on, "pump_on must be ABI bool 0 or 1").and_then(|pump_on| {
        handle
            .station
            .authorize_output(session_id, OutputState { pump_on, valves }, now_ms)
    });
    match result {
        Ok(grant) => {
            handle.last_lease_deadline_ms = grant.lease_deadline_ms;
            handle.error.clear();
            1
        }
        Err(error) => handle.fail(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_report_applied(
    handle: *mut StationHandle,
    session_id: u64,
    pump_on: i32,
    valves: u64,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = abi_bool(pump_on, "pump_on must be ABI bool 0 or 1").and_then(|pump_on| {
        handle
            .station
            .report_applied(session_id, OutputState { pump_on, valves }, now_ms)
    });
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_advance(handle: *mut StationHandle, now_ms: u64) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    match handle.station.advance(now_ms) {
        Ok(directive) => {
            handle.error.clear();
            if directive.force_safe_output {
                2
            } else {
                1
            }
        }
        Err(error) => handle.fail(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_prepare_finish(
    handle: *mut StationHandle,
    session_id: u64,
    outcome_code: u8,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = outcome(outcome_code)
        .and_then(|outcome| handle.station.prepare_finish(session_id, outcome, now_ms));
    handle.prepare(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_commit_finish(handle: *mut StationHandle, token: u64) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = handle.station.commit_finish(DurableAck::new(token));
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_abort_prepared(handle: *mut StationHandle, token: u64) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = handle.station.abort_prepared(token);
    handle.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_snapshot(handle: *mut StationHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    match handle.station.snapshot_bytes() {
        Ok(bytes) => {
            handle.bytes = bytes;
            handle.error.clear();
            1
        }
        Err(error) => handle.fail(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_restore(
    handle: *mut StationHandle,
    ptr: *const u8,
    length: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = bytes(ptr, length)
        .and_then(|bytes| Station::restore(handle.station.config().clone(), bytes));
    match result {
        Ok(station) => {
            handle.station = station;
            handle.bytes.clear();
            handle.error.clear();
            1
        }
        Err(error) => handle.fail(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_station_prepared_ptr(handle: *const StationHandle) -> *const u8 {
    handle
        .as_ref()
        .map(|handle| handle.bytes.as_ptr())
        .unwrap_or(std::ptr::null())
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_prepared_len(handle: *const StationHandle) -> usize {
    handle
        .as_ref()
        .map(|handle| handle.bytes.len())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_pending_token(handle: *const StationHandle) -> u64 {
    handle
        .as_ref()
        .and_then(|handle| handle.station.pending_token())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_last_error_ptr(handle: *const StationHandle) -> *const u8 {
    handle
        .as_ref()
        .map(|handle| handle.error.as_ptr())
        .unwrap_or(std::ptr::null())
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_last_error_len(handle: *const StationHandle) -> usize {
    handle
        .as_ref()
        .map(|handle| handle.error.len())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_mode(handle: *const StationHandle) -> u8 {
    handle
        .as_ref()
        .map(|handle| handle.station.mode() as u8)
        .unwrap_or(255)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_stopping(handle: *const StationHandle) -> i32 {
    handle
        .as_ref()
        .map(|handle| handle.station.stopping() as i32)
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_revision(handle: *const StationHandle) -> u64 {
    handle
        .as_ref()
        .map(|handle| handle.station.revision())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_stop_generation(handle: *const StationHandle) -> u64 {
    handle
        .as_ref()
        .map(|handle| handle.station.stop_generation())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_daily_used_ms(handle: *const StationHandle) -> u64 {
    handle
        .as_ref()
        .map(|handle| handle.station.daily_used_ms())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_reserved_ms(handle: *const StationHandle) -> u64 {
    handle
        .as_ref()
        .map(|handle| handle.station.reserved_ms())
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_last_lease_deadline(handle: *const StationHandle) -> u64 {
    handle
        .as_ref()
        .map(|handle| handle.last_lease_deadline_ms)
        .unwrap_or(0)
}
#[no_mangle]
pub unsafe extern "C" fn gf_station_last_capacity(handle: *const StationHandle) -> u8 {
    handle
        .as_ref()
        .map(|handle| handle.last_capacity)
        .unwrap_or(2)
}
