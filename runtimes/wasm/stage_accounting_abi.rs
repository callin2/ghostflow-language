use super::{bytes, FramedHandle, FramedState};

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_activate(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    stage_bytes(handle, ptr, len, false)
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_restore(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    stage_bytes(handle, ptr, len, true)
}

unsafe fn stage_bytes(handle: *mut FramedHandle, ptr: *const u8, len: usize, restore: bool) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    if len > 512 * 1024 {
        return h.failure("stage accounting byte bound");
    }
    let data = match bytes(ptr, len, "stage accounting") {
        Ok(data) => data,
        Err(error) => return h.failure(error),
    };
    let result = match &mut h.state {
        FramedState::Active(driver) => {
            if restore {
                driver.restore_stage_accounting(data)
            } else {
                driver.activate_stage_accounting(data)
            }
        }
        _ => return h.failure("stage accounting requires an active scan driver"),
    };
    match result {
        Ok(()) => h.success(),
        Err(error) => h.failure(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_snapshot(handle: *mut FramedHandle) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    match &h.state {
        FramedState::Active(driver) => match driver.stage_accounting_snapshot() {
            Ok((revision, bytes)) => {
                h.stage_revision = revision;
                h.stage_snapshot = bytes;
                h.success()
            }
            Err(error) => h.failure(error.to_string()),
        },
        _ => h.failure("stage accounting requires an active scan driver"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_acknowledge(
    handle: *mut FramedHandle,
    revision: u64,
) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    match &mut h.state {
        FramedState::Active(driver) => match driver.acknowledge_stage_accounting(revision) {
            Ok(()) => h.success(),
            Err(error) => h.failure(error.to_string()),
        },
        _ => h.failure("stage accounting requires an active scan driver"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_gap(handle: *mut FramedHandle) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    match &mut h.state {
        FramedState::Active(driver) => match driver.stage_accounting_gap() {
            Ok(()) => h.success(),
            Err(error) => h.failure(error.to_string()),
        },
        _ => h.failure("stage accounting requires an active scan driver"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_query(
    handle: *mut FramedHandle,
    account_ptr: *const u8,
    account_len: usize,
    run_ptr: *const u8,
    run_len: usize,
    start: u64,
    end: u64,
) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    h.stage_query.clear();
    let account = match super::utf8(account_ptr, account_len, "account") {
        Ok(value) => value,
        Err(error) => return h.failure(error),
    };
    let run = match super::utf8(run_ptr, run_len, "run") {
        Ok(value) => value,
        Err(error) => return h.failure(error),
    };
    match &h.state {
        FramedState::Active(driver) => {
            match driver.stage_accounting_query(account, run, start, end) {
                Ok(read) => {
                    h.stage_query = read.to_json();
                    h.success()
                }
                Err(error) => h.failure(error.to_string()),
            }
        }
        _ => h.failure("stage accounting requires an active scan driver"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_snapshot_ptr(h: *const FramedHandle) -> *const u8 {
    h.as_ref()
        .map_or(std::ptr::null(), |h| h.stage_snapshot.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_snapshot_len(h: *const FramedHandle) -> usize {
    h.as_ref().map_or(0, |h| h.stage_snapshot.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_revision(h: *const FramedHandle) -> u64 {
    h.as_ref().map_or(0, |h| h.stage_revision)
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_query_ptr(h: *const FramedHandle) -> *const u8 {
    h.as_ref()
        .map_or(std::ptr::null(), |h| h.stage_query.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_stage_query_len(h: *const FramedHandle) -> usize {
    h.as_ref().map_or(0, |h| h.stage_query.len())
}
