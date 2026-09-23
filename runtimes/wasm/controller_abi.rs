//! Explicit native Temperature -> Percent PID binding, independent of GFB.
//! This primitive does not make an objective manifest executable. Hosts must
//! validate and bind its descriptor, stage before the enclosing scan, then
//! commit on success or roll back on failure. No driver application occurs here.
use ghostflow_core::controller::{Direction, Pid, PidConfig, PidDecision, PidResult, PidStage};

pub struct ControllerHandle {
    controller: Pid,
    pending: Option<PidStage>,
    committed: Option<PidResult>,
    error: String,
}

impl ControllerHandle {
    fn result(&self) -> Option<PidResult> {
        self.pending
            .as_ref()
            .map(|stage| stage.result)
            .or(self.committed)
    }

    fn fail(&mut self, message: impl ToString) -> i32 {
        self.error = message.to_string();
        0
    }
}

/// Direction: 0 direct, 1 reverse. Times are milliseconds; gains use percentage
/// points, delta Kelvin and seconds. Null means invalid activation parameters.
#[no_mangle]
pub extern "C" fn gf_pid_create(
    period_ms: u64,
    late_after_ms: u64,
    direction: u32,
    kp: f64,
    ki: f64,
    kd: f64,
    bias_percent: f64,
    output_max_percent: f64,
    restart_percent: f64,
) -> *mut ControllerHandle {
    let direction = match direction {
        0 => Direction::Direct,
        1 => Direction::Reverse,
        _ => return std::ptr::null_mut(),
    };
    let Ok(controller) = Pid::new(PidConfig {
        period_ms,
        late_after_ms,
        direction,
        kp,
        ki,
        kd,
        bias_percent,
        output_max_percent,
        restart_percent,
    }) else {
        return std::ptr::null_mut();
    };
    Box::into_raw(Box::new(ControllerHandle {
        controller,
        pending: None,
        committed: None,
        error: String::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn gf_pid_destroy(handle: *mut ControllerHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// Stage from committed state. Each call supersedes an uncommitted candidate;
/// a failed stage clears it, so a stale candidate cannot later be committed.
/// measurement_present must be 0 (inadmissible) or 1 (present Kelvin value).
#[no_mangle]
pub unsafe extern "C" fn gf_pid_stage(
    handle: *mut ControllerHandle,
    now_ms: u64,
    measurement_present: u32,
    measurement_kelvin: f64,
    target_kelvin: f64,
    safe_max_percent: f64,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    h.pending = None;
    let measurement = match measurement_present {
        0 => None,
        1 => Some(measurement_kelvin),
        _ => return h.fail("invalid PID measurement presence flag"),
    };
    match h
        .controller
        .begin(now_ms, measurement, target_kelvin, safe_max_percent)
    {
        Ok(stage) => {
            h.pending = Some(stage);
            h.error.clear();
            1
        }
        Err(error) => h.fail(error),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_pid_commit(handle: *mut ControllerHandle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let Some(stage) = h.pending.take() else {
        return h.fail("no staged PID tick");
    };
    h.committed = Some(stage.result);
    h.controller.commit(stage);
    h.error.clear();
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_pid_rollback(handle: *mut ControllerHandle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    h.pending = None;
    h.error.clear();
    1
}

/// Candidate requested intent if staged, otherwise the last committed intent.
/// NaN means no result or a null handle; consult decision before reading values.
#[no_mangle]
pub unsafe extern "C" fn gf_pid_requested(handle: *const ControllerHandle) -> f64 {
    handle
        .as_ref()
        .and_then(ControllerHandle::result)
        .map_or(f64::NAN, |r| r.requested_percent)
}

#[no_mangle]
pub unsafe extern "C" fn gf_pid_safe(handle: *const ControllerHandle) -> f64 {
    handle
        .as_ref()
        .and_then(ControllerHandle::result)
        .map_or(f64::NAN, |r| r.safe_percent)
}

/// 0: no result; 1: updated; 2: held; 3: disabled by fault.
#[no_mangle]
pub unsafe extern "C" fn gf_pid_decision(handle: *const ControllerHandle) -> u32 {
    match handle
        .as_ref()
        .and_then(ControllerHandle::result)
        .map(|r| r.decision)
    {
        None => 0,
        Some(PidDecision::Updated) => 1,
        Some(PidDecision::Held) => 2,
        Some(PidDecision::Disabled) => 3,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_pid_error_ptr(handle: *const ControllerHandle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.error.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn gf_pid_error_len(handle: *const ControllerHandle) -> usize {
    handle.as_ref().map_or(0, |h| h.error.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create() -> *mut ControllerHandle {
        gf_pid_create(10_000, 30_000, 1, 2.0, 0.1, 1.0, 0.0, 80.0, 0.0)
    }

    #[test]
    fn native_abi_stages_numeric_targets_and_commits_only_explicitly() {
        unsafe {
            let handle = create();
            assert!(!handle.is_null());
            assert_eq!(gf_pid_stage(handle, 0, 1, 303.15, 298.15, 100.0), 1);
            assert_eq!(gf_pid_requested(handle), 0.0);
            assert_eq!(gf_pid_commit(handle), 1);
            assert_eq!(gf_pid_stage(handle, 10_000, 1, 304.15, 298.15, 100.0), 1);
            assert!((gf_pid_requested(handle) - 7.6).abs() < 1e-9);
            // Enclosing scan fails: discard candidate and retry the same time.
            assert_eq!(gf_pid_rollback(handle), 1);
            assert_eq!(gf_pid_requested(handle), 0.0);
            assert_eq!(gf_pid_stage(handle, 10_000, 1, 304.15, 298.15, 100.0), 1);
            assert_eq!(gf_pid_commit(handle), 1);
            assert!((gf_pid_safe(handle) - 7.6).abs() < 1e-9);
            assert_eq!(gf_pid_decision(handle), 1);
            assert_eq!(gf_pid_commit(handle), 0);
            gf_pid_destroy(handle);
        }
    }

    #[test]
    fn invalid_stage_cannot_commit_an_older_candidate() {
        unsafe {
            let handle = create();
            assert_eq!(gf_pid_stage(handle, 0, 1, 303.15, 298.15, 100.0), 1);
            assert_eq!(gf_pid_stage(handle, 1, 2, 303.15, 298.15, 100.0), 0);
            assert_eq!(gf_pid_commit(handle), 0);
            assert!(gf_pid_requested(handle).is_nan());
            assert!(gf_pid_error_len(handle) > 0);
            assert_eq!(gf_pid_stage(handle, 0, 1, 303.15, 298.15, 100.0), 1);
            assert_eq!(gf_pid_error_len(handle), 0);
            gf_pid_destroy(handle);
        }
    }

    #[test]
    fn fault_and_safe_ceiling_are_intents_and_invalid_activation_is_rejected() {
        unsafe {
            assert!(gf_pid_create(10_000, 30_000, 2, 2.0, 0.1, 1.0, 0.0, 80.0, 0.0).is_null());
            assert!(gf_pid_create(0, 30_000, 1, 2.0, 0.1, 1.0, 0.0, 80.0, 0.0).is_null());
            let handle = create();
            assert_eq!(gf_pid_stage(handle, 0, 1, 303.15, 298.15, 100.0), 1);
            assert_eq!(gf_pid_commit(handle), 1);
            assert_eq!(gf_pid_stage(handle, 10_000, 1, 303.15, 298.15, 0.0), 1);
            assert_eq!(gf_pid_safe(handle), 0.0);
            assert_eq!(gf_pid_commit(handle), 1);
            assert_eq!(gf_pid_stage(handle, 20_000, 0, 0.0, 298.15, 100.0), 1);
            assert_eq!(gf_pid_safe(handle), 0.0);
            assert_eq!(gf_pid_decision(handle), 3);
            gf_pid_destroy(handle);
            assert_eq!(gf_pid_commit(std::ptr::null_mut()), 0);
            assert_eq!(
                gf_pid_stage(std::ptr::null_mut(), 0, 1, 303.15, 298.15, 100.0),
                0
            );
            assert_eq!(gf_pid_rollback(std::ptr::null_mut()), 0);
            assert_eq!(gf_pid_decision(std::ptr::null()), 0);
            assert!(gf_pid_safe(std::ptr::null()).is_nan());
            gf_pid_destroy(std::ptr::null_mut());
        }
    }
}
