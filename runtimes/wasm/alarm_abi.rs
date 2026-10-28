use super::{bytes, utf8, FramedHandle, FramedState};

#[no_mangle]
pub unsafe extern "C" fn gf_frame_alarm_activate(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
    digest_ptr: *const u8,
    digest_len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    if len > 65536 || digest_len != 64 {
        return h.failure("alarm binding byte bound");
    }
    let packet = match bytes(ptr, len, "alarm binding") {
        Ok(bytes) => bytes,
        Err(error) => return h.failure(error),
    };
    let digest = match utf8(digest_ptr, digest_len, "alarm binding digest") {
        Ok(text) => text,
        Err(error) => return h.failure(error),
    };
    let result = match &mut h.state {
        FramedState::Active(driver) => driver.activate_alarms(packet, digest),
        _ => return h.failure("alarm binding requires active framed driver"),
    };
    match result {
        Ok(()) => h.success(),
        Err(error) => h.failure(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_alarm_query(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else {
        return 0;
    };
    if len > 2048 {
        return h.failure("alarm query byte bound");
    }
    let packet = match bytes(ptr, len, "alarm query") {
        Ok(bytes) => bytes,
        Err(error) => return h.failure(error),
    };
    let result = match &h.state {
        FramedState::Active(driver) => driver.query_alarms(packet),
        _ => return h.failure("alarm query requires active framed driver"),
    };
    match result {
        Ok(report) => {
            h.alarm_report = report;
            h.success()
        }
        Err(error) => {
            h.alarm_report.clear();
            h.failure(error.to_string())
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_alarm_report_ptr(handle: *const FramedHandle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.alarm_report.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_alarm_report_len(handle: *const FramedHandle) -> usize {
    handle.as_ref().map_or(0, |h| h.alarm_report.len())
}
