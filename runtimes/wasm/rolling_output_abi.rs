use ghostflow_core::accounting::{
    AccountingConfig, LedgerRead, OutputAdmission, OutputLease, RollingOutputOwner,
    RollingOutputPolicy,
};

pub struct RollingOutputHandle {
    owner: RollingOutputOwner,
    pending: Vec<u8>,
    lease: Option<OutputLease>,
}

#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_open(
    resource_id: u32,
    window_ms: u64,
    limit_ms: u64,
    reserve_ms: u64,
    max_intervals: u32,
    now_ms: u64,
    checkpoint: *const u8,
    checkpoint_len: usize,
) -> *mut RollingOutputHandle {
    let policy = RollingOutputPolicy {
        resource_id,
        window_ms,
        limit_ms,
        reserve_ms,
    };
    let config = AccountingConfig {
        max_intervals: max_intervals as usize,
        max_events: 1,
        max_reservations: max_intervals as usize,
        max_rolling_window_ms: window_ms,
    };
    let mut pending = Vec::new();
    let owner = if checkpoint.is_null() && checkpoint_len == 0 {
        RollingOutputOwner::initialize(policy, config, now_ms, capture(&mut pending))
    } else if !checkpoint.is_null() {
        let bytes = std::slice::from_raw_parts(checkpoint, checkpoint_len);
        RollingOutputOwner::restore(policy, config, bytes)
    } else {
        return std::ptr::null_mut();
    };
    match owner {
        Ok(owner) => Box::into_raw(Box::new(RollingOutputHandle {
            owner,
            pending,
            lease: None,
        })),
        Err(_) => std::ptr::null_mut(),
    }
}

fn capture(bytes: &mut Vec<u8>) -> impl FnOnce(&[u8]) -> bool + '_ {
    |snapshot| {
        bytes.extend_from_slice(snapshot);
        true
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_close(handle: *mut RollingOutputHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// 1 prepares a reservation, 2 is over budget, 3 is unsettled, 0 is unavailable.
/// A prepared reservation has no readable deadline until persistence is acknowledged.
#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_prepare(
    handle: *mut RollingOutputHandle,
    now_ms: u64,
) -> u32 {
    let Some(handle) = handle.as_mut().filter(|handle| handle.pending.is_empty()) else {
        return 0;
    };
    match handle
        .owner
        .request_on(now_ms, capture(&mut handle.pending))
    {
        Ok(OutputAdmission::Allowed(lease)) => {
            handle.lease = Some(lease);
            1
        }
        Ok(OutputAdmission::BudgetExceeded) => 2,
        Ok(OutputAdmission::UnsettledOutput) => 3,
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_finish(
    handle: *mut RollingOutputHandle,
    applied: bool,
    started_at_ms: u64,
    off_at_ms: u64,
) -> u32 {
    let Some(handle) = handle.as_mut().filter(|handle| handle.pending.is_empty()) else {
        return 0;
    };
    let Some(lease) = handle.lease else {
        return 0;
    };
    match handle.owner.record_off(
        lease,
        applied.then_some(started_at_ms),
        off_at_ms,
        capture(&mut handle.pending),
    ) {
        Ok(()) => {
            handle.lease = None;
            1
        }
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_recover(
    handle: *mut RollingOutputHandle,
    confirmed_off_at_ms: u64,
    now_ms: u64,
) -> u32 {
    let Some(handle) = handle
        .as_mut()
        .filter(|handle| handle.pending.is_empty() && handle.lease.is_none())
    else {
        return 0;
    };
    match handle.owner.recover_after_confirmed_off(
        confirmed_off_at_ms,
        now_ms,
        capture(&mut handle.pending),
    ) {
        Ok(true) => 1,
        Ok(false) => 2,
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_pending_ptr(
    handle: *const RollingOutputHandle,
) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |handle| handle.pending.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_pending_len(
    handle: *const RollingOutputHandle,
) -> usize {
    handle.as_ref().map_or(0, |handle| handle.pending.len())
}

/// The host may acknowledge only after its single writer has durably saved
/// the pending bytes. Recovered leases are never returned as output grants.
#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_ack(handle: *mut RollingOutputHandle) -> u64 {
    let Some(handle) = handle.as_mut().filter(|handle| !handle.pending.is_empty()) else {
        return 0;
    };
    handle.pending.clear();
    handle.lease.map_or(0, OutputLease::deadline_ms)
}

/// A durable explanation, with the same first five fields as the accounting ABI.
/// 1 is known, 2 is unknown or not yet acknowledged, 0 is an invalid argument.
#[no_mangle]
pub unsafe extern "C" fn gf_rolling_output_explain(
    handle: *const RollingOutputHandle,
    now_ms: u64,
    output: *mut u64,
) -> u32 {
    let Some(handle) = handle.as_ref() else {
        return 0;
    };
    if output.is_null() {
        return 0;
    }
    if !handle.pending.is_empty() {
        return 2;
    }
    let LedgerRead::Known(evidence) = handle.owner.explain(now_ms) else {
        return 2;
    };
    std::slice::from_raw_parts_mut(output, 5).copy_from_slice(&[
        evidence.used_ms,
        evidence.reserved_ms,
        u64::from(evidence.blocked),
        u64::from(evidence.next_release_ms.is_some()),
        evidence.next_release_ms.unwrap_or(0),
    ]);
    1
}
