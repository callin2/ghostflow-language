//! C ABI for the caller-validated, bounded accounting ledger primitive.

use ghostflow_core::accounting::{
    AccountingConfig, AccountingError, AccountingLedger, AdmissionResult, LedgerRead, RecordResult,
};
use ghostflow_core::{
    context_runtime::{AccountingInput, Activation, Facts},
    schedule_clock::{ClockSnapshot, ClockTrust},
    Value,
};
use std::slice;

use crate::Handle;

pub struct AccountingHandle {
    config: AccountingConfig,
    ledger: AccountingLedger,
    error: String,
    bytes: Vec<u8>,
    revision: u64,
    snapshot_revision: Option<u64>,
    persisted_revision: u64,
    unavailable_fault: u8,
}

impl AccountingHandle {
    fn fail(&mut self, error: impl ToString) -> i32 {
        self.error = error.to_string();
        0
    }

    fn complete(
        &mut self,
        result: Result<RecordResult, ghostflow_core::accounting::AccountingError>,
    ) -> i32 {
        match result {
            Ok(RecordResult::Inserted) => {
                self.error.clear();
                1
            }
            Ok(RecordResult::Duplicate) => {
                self.error.clear();
                2
            }
            Err(error) => self.fail(error),
        }
    }

    fn advance_revision(&mut self) -> bool {
        if let Some(revision) = self.revision.checked_add(1) {
            self.revision = revision;
            self.snapshot_revision = None;
            true
        } else {
            self.ledger.mark_unknown();
            self.unavailable_fault = 3;
            self.snapshot_revision = None;
            self.error = "accounting revision overflow".into();
            false
        }
    }

    fn complete_admission(&mut self, result: Result<AdmissionResult, AccountingError>) -> i32 {
        match result {
            Ok(AdmissionResult::Reserved) => {
                self.error.clear();
                1
            }
            Ok(AdmissionResult::Duplicate) => {
                self.error.clear();
                2
            }
            Err(AccountingError::LimitExceeded) => {
                self.error.clear();
                3
            }
            Err(error) => self.fail(error),
        }
    }
}

unsafe fn identity(ptr: *const u8) -> Option<[u8; 16]> {
    if ptr.is_null() {
        return None;
    }
    Some(slice::from_raw_parts(ptr, 16).try_into().ok()?)
}

#[no_mangle]
pub extern "C" fn gf_accounting_create(
    max_intervals: u32,
    max_events: u32,
    max_reservations: u32,
    max_rolling_window_ms: u64,
) -> *mut AccountingHandle {
    let config = AccountingConfig {
        max_intervals: max_intervals as usize,
        max_events: max_events as usize,
        max_reservations: max_reservations as usize,
        max_rolling_window_ms,
    };
    match AccountingLedger::unknown(config) {
        Ok(ledger) => Box::into_raw(Box::new(AccountingHandle {
            config,
            ledger,
            error: String::new(),
            bytes: Vec::new(),
            revision: 0,
            snapshot_revision: None,
            persisted_revision: 0,
            unavailable_fault: 1,
        })),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Prepare a durable reservation. Status 1 is not an output grant: the host
/// must snapshot, persist, and acknowledge this revision before starting work.
/// Status 2 is an exact duplicate and status 3 is an atomic limit rejection.
#[no_mangle]
pub unsafe extern "C" fn gf_accounting_reserve_rolling(
    handle: *mut AccountingHandle,
    reservation_id: *const u8,
    resource_id: u32,
    admitted_at_ms: u64,
    window_ms: u64,
    limit_ms: u64,
    reserve_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let Some(reservation_id) = identity(reservation_id) else {
        return handle.fail("invalid reservation identity");
    };
    let result = handle.ledger.reserve_rolling(
        reservation_id,
        resource_id,
        admitted_at_ms,
        window_ms,
        limit_ms,
        reserve_ms,
    );
    let status = handle.complete_admission(result);
    if status == 1 && !handle.advance_revision() {
        return 0;
    }
    status
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_settle_rolling(
    handle: *mut AccountingHandle,
    reservation_id: *const u8,
    applied_receipt_id: *const u8,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let (Some(reservation_id), Some(applied_receipt_id)) =
        (identity(reservation_id), identity(applied_receipt_id))
    else {
        return handle.fail("invalid settlement identity");
    };
    let result = handle
        .ledger
        .settle_rolling(reservation_id, applied_receipt_id);
    let status = handle.complete(result);
    if status == 1 && !handle.advance_revision() {
        return 0;
    }
    status
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_cancel_rolling(
    handle: *mut AccountingHandle,
    reservation_id: *const u8,
    cancellation_evidence_id: *const u8,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let (Some(reservation_id), Some(cancellation_evidence_id)) =
        (identity(reservation_id), identity(cancellation_evidence_id))
    else {
        return handle.fail("invalid cancellation identity");
    };
    let result = handle
        .ledger
        .cancel_rolling(reservation_id, cancellation_evidence_id);
    let status = handle.complete(result);
    if status == 1 && !handle.advance_revision() {
        return 0;
    }
    status
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_destroy(handle: *mut AccountingHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// Explicit first-install operation. The host must persist the returned snapshot.
#[no_mangle]
pub unsafe extern "C" fn gf_accounting_initialize_empty(handle: *mut AccountingHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    match AccountingLedger::new(handle.config) {
        Ok(ledger) => {
            handle.ledger = ledger;
            handle.unavailable_fault = 1;
            if !handle.advance_revision() {
                return 0;
            }
            handle.error.clear();
            1
        }
        Err(error) => handle.fail(error),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_restore(
    handle: *mut AccountingHandle,
    ptr: *const u8,
    length: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    if ptr.is_null() && length != 0 {
        handle.ledger.mark_unknown();
        let _ = handle.advance_revision();
        return handle.fail("null accounting snapshot pointer");
    }
    let bytes = if length == 0 {
        &[]
    } else {
        slice::from_raw_parts(ptr, length)
    };
    match AccountingLedger::restore(handle.config, bytes) {
        Ok(ledger) => {
            handle.ledger = ledger;
            handle.unavailable_fault = 1;
            handle.revision = 0;
            handle.persisted_revision = 0;
            handle.snapshot_revision = Some(0);
            handle.error.clear();
            1
        }
        Err(error) => {
            handle.ledger.mark_unknown();
            handle.unavailable_fault = 2;
            let _ = handle.advance_revision();
            handle.fail(error)
        }
    }
}

/// Activate one GFB10 accounting control. Provider bindings are empty because
/// accounting Results are produced only from the paired Rust ledger.
#[no_mangle]
pub unsafe extern "C" fn gf_activate_accounting(
    control: *mut Handle,
    boot_epoch: u64,
    terminal_capacity: u32,
) -> i32 {
    let Some(control) = control.as_mut() else {
        return 0;
    };
    let activation = Activation {
        boot_epoch,
        terminal_capacity: terminal_capacity as usize,
        bindings: Vec::new(),
    };
    let result = control.runtime.activate_with_context(&activation);
    control.complete(result)
}

/// Tick a GFB10 control with a Result constructed inside Rust from the exact
/// durable ledger revision. No caller-supplied ok/count/fault projection exists.
#[no_mangle]
pub unsafe extern "C" fn gf_tick_accounting(
    control: *mut Handle,
    accounting: *mut AccountingHandle,
    site: u32,
    account_ptr: *const u8,
    account_len: usize,
    event_ptr: *const u8,
    event_len: usize,
    timezone_ptr: *const u8,
    timezone_len: usize,
    event_type: u32,
    local_day_present: i32,
    local_day: i32,
    monotonic_ms: u64,
    boot_epoch: u64,
    wall_ms_present: i32,
    wall_ms: u64,
    clock_trusted: i32,
) -> i32 {
    let (Some(control), Some(accounting)) = (control.as_mut(), accounting.as_ref()) else {
        return 0;
    };
    if !matches!(local_day_present, 0 | 1)
        || !matches!(wall_ms_present, 0 | 1)
        || !matches!(clock_trusted, 0 | 1)
    {
        control.error = "invalid accounting presence/trust flag".into();
        return 0;
    }
    let (Some(account), Some(event), Some(timezone)) = (
        crate::text(account_ptr, account_len),
        crate::text(event_ptr, event_len),
        crate::text(timezone_ptr, timezone_len),
    ) else {
        control.error = "invalid accounting binding text".into();
        return 0;
    };
    let input = match AccountingInput::from_ledger(
        site,
        account.into(),
        event.into(),
        timezone.into(),
        &accounting.ledger,
        event_type,
        (local_day_present != 0).then_some(local_day),
        accounting.persisted_revision == accounting.revision,
        // A known, unacknowledged revision is incomplete. Preserve the
        // missing/corrupt distinction for genuinely unknown ledgers.
        if accounting.ledger.is_known() && accounting.persisted_revision != accounting.revision {
            3
        } else {
            accounting.unavailable_fault
        },
    ) {
        Ok(input) => input,
        Err(error) => return control.complete(Err(error)),
    };
    if monotonic_ms > 9_007_199_254_740_991 || boot_epoch > 9_007_199_254_740_991 {
        control.error = "accounting clock exceeds exact Number range".into();
        return 0;
    }
    let facts = Facts {
        accounting: vec![input],
        ..Facts::default()
    };
    let clock = ClockSnapshot {
        monotonic_ms,
        boot_epoch,
        wall_ms: (wall_ms_present != 0).then_some(wall_ms),
        trust: if clock_trusted != 0 {
            ClockTrust::Trusted
        } else {
            ClockTrust::Unknown("ClockUnknown")
        },
        uncertainty_ms: None,
        source_revision: Some("accounting-v1"),
    };
    let result = (|| {
        control
            .runtime
            .set_input("__gf_now_ms", Value::Number(monotonic_ms as f64))?;
        control
            .runtime
            .set_input("__gf_time_epoch", Value::Number(boot_epoch as f64))?;
        control.runtime.tick_with_context(clock, &facts).map(|_| ())
    })();
    control.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_record_applied_segment(
    handle: *mut AccountingHandle,
    receipt_id: *const u8,
    resource_id: u32,
    start_ms: u64,
    end_ms: u64,
    local_day: i32,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let Some(receipt_id) = identity(receipt_id) else {
        handle.ledger.mark_unknown();
        handle.unavailable_fault = 3;
        let _ = handle.advance_revision();
        return handle.fail("invalid interval receipt identity");
    };
    let result =
        handle
            .ledger
            .record_applied_segment(receipt_id, resource_id, start_ms, end_ms, local_day);
    let status = handle.complete(result);
    if status == 1 {
        if !handle.advance_revision() {
            return 0;
        }
    } else if status == 0 {
        handle.ledger.mark_unknown();
        handle.unavailable_fault = 3;
        let _ = handle.advance_revision();
    }
    status
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_record_reserved_segment(
    handle: *mut AccountingHandle,
    reservation_id: *const u8,
    receipt_id: *const u8,
    resource_id: u32,
    start_ms: u64,
    end_ms: u64,
    local_day: i32,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let (Some(reservation_id), Some(receipt_id)) = (identity(reservation_id), identity(receipt_id))
    else {
        handle.ledger.mark_unknown();
        handle.unavailable_fault = 3;
        let _ = handle.advance_revision();
        return handle.fail("invalid reserved interval identity");
    };
    let result = handle.ledger.record_reserved_applied_segment(
        reservation_id,
        receipt_id,
        resource_id,
        start_ms,
        end_ms,
        local_day,
    );
    let status = handle.complete(result);
    if status == 1 {
        if !handle.advance_revision() {
            return 0;
        }
    } else if status == 0 {
        handle.ledger.mark_unknown();
        handle.unavailable_fault = 3;
        let _ = handle.advance_revision();
    }
    status
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_record_event(
    handle: *mut AccountingHandle,
    event_id: *const u8,
    event_type: u32,
    local_day: i32,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let Some(event_id) = identity(event_id) else {
        handle.ledger.mark_unknown();
        handle.unavailable_fault = 3;
        let _ = handle.advance_revision();
        return handle.fail("invalid event identity");
    };
    let result = handle.ledger.record_event(event_id, event_type, local_day);
    let status = handle.complete(result);
    if status == 1 {
        if !handle.advance_revision() {
            return 0;
        }
    } else if status == 0 {
        handle.ledger.mark_unknown();
        handle.unavailable_fault = 3;
        let _ = handle.advance_revision();
    }
    status
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_used_rolling(
    handle: *mut AccountingHandle,
    resource_id: u32,
    now_ms: u64,
    window_ms: u64,
    output: *mut u64,
) -> i32 {
    let Some(handle) = handle.as_ref() else {
        return 0;
    };
    let Some(output) = output.as_mut() else {
        return 0;
    };
    if handle.persisted_revision != handle.revision {
        return 2;
    }
    match handle.ledger.used_rolling(resource_id, now_ms, window_ms) {
        LedgerRead::Known(value) => {
            *output = value;
            1
        }
        LedgerRead::Unknown => 2,
    }
}

/// Output words: used, outstanding reserve, blocked, release-present, release,
/// exact durable revision. Status 2 is Unknown and writes no evidence.
#[no_mangle]
pub unsafe extern "C" fn gf_accounting_explain_rolling(
    handle: *const AccountingHandle,
    resource_id: u32,
    now_ms: u64,
    window_ms: u64,
    limit_ms: u64,
    reserve_ms: u64,
    output: *mut u64,
) -> i32 {
    let Some(handle) = handle.as_ref() else {
        return 0;
    };
    if output.is_null() {
        return 0;
    }
    if handle.persisted_revision != handle.revision {
        return 2;
    }
    let LedgerRead::Known(explanation) =
        handle
            .ledger
            .explain_rolling(resource_id, now_ms, window_ms, limit_ms, reserve_ms)
    else {
        return 2;
    };
    slice::from_raw_parts_mut(output, 6).copy_from_slice(&[
        explanation.used_ms,
        explanation.reserved_ms,
        u64::from(explanation.blocked),
        u64::from(explanation.next_release_ms.is_some()),
        explanation.next_release_ms.unwrap_or(0),
        handle.revision,
    ]);
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_used_local_day(
    handle: *mut AccountingHandle,
    resource_id: u32,
    local_day: i32,
    output: *mut u64,
) -> i32 {
    let Some(handle) = handle.as_ref() else {
        return 0;
    };
    let Some(output) = output.as_mut() else {
        return 0;
    };
    if handle.persisted_revision != handle.revision {
        return 2;
    }
    match handle.ledger.used_local_day(resource_id, local_day) {
        LedgerRead::Known(value) => {
            *output = value;
            1
        }
        LedgerRead::Unknown => 2,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_event_count(
    handle: *mut AccountingHandle,
    event_type: u32,
    local_day: i32,
    output: *mut u64,
) -> i32 {
    let Some(handle) = handle.as_ref() else {
        return 0;
    };
    let Some(output) = output.as_mut() else {
        return 0;
    };
    if handle.persisted_revision != handle.revision {
        return 2;
    }
    match handle.ledger.event_count(event_type, local_day) {
        LedgerRead::Known(value) => {
            *output = value;
            1
        }
        LedgerRead::Unknown => 2,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_snapshot(handle: *mut AccountingHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    match handle.ledger.snapshot_bytes() {
        Ok(bytes) => {
            handle.bytes = bytes;
            handle.snapshot_revision = Some(handle.revision);
            handle.error.clear();
            1
        }
        Err(error) => handle.fail(error),
    }
}

/// Acknowledge only the exact snapshot revision written successfully by the host.
#[no_mangle]
pub unsafe extern "C" fn gf_accounting_ack_persisted(
    handle: *mut AccountingHandle,
    revision: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    if handle.snapshot_revision != Some(revision) || handle.revision != revision {
        return handle.fail("accounting snapshot revision is stale or was not prepared");
    }
    handle.persisted_revision = revision;
    handle.error.clear();
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_revision(handle: *const AccountingHandle) -> u64 {
    handle.as_ref().map(|handle| handle.revision).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_snapshot_ptr(handle: *const AccountingHandle) -> *const u8 {
    handle
        .as_ref()
        .map(|handle| handle.bytes.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_snapshot_len(handle: *const AccountingHandle) -> usize {
    handle
        .as_ref()
        .map(|handle| handle.bytes.len())
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_last_error_ptr(
    handle: *const AccountingHandle,
) -> *const u8 {
    handle
        .as_ref()
        .map(|handle| handle.error.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[no_mangle]
pub unsafe extern "C" fn gf_accounting_last_error_len(handle: *const AccountingHandle) -> usize {
    handle
        .as_ref()
        .map(|handle| handle.error.len())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wasm_abi_records_queries_snapshots_and_restores() {
        let handle = gf_accounting_create(4, 4, 4, 60_000);
        assert!(!handle.is_null());
        unsafe {
            let mut count = 0;
            assert_eq!(gf_accounting_event_count(handle, 9, 100, &mut count), 2);
            assert_eq!(gf_accounting_initialize_empty(handle), 1);
            assert_eq!(gf_accounting_snapshot(handle), 1);
            let initial_revision = gf_accounting_revision(handle);
            assert_eq!(gf_accounting_ack_persisted(handle, initial_revision), 1);
            let event = [3u8; 16];
            assert_eq!(
                gf_accounting_record_event(handle, event.as_ptr(), 9, 100),
                1
            );
            assert_eq!(gf_accounting_event_count(handle, 9, 100, &mut count), 2);
            assert_eq!(gf_accounting_snapshot(handle), 1);
            let revision = gf_accounting_revision(handle);
            assert_ne!(revision, initial_revision);
            assert_eq!(gf_accounting_ack_persisted(handle, initial_revision), 0);
            assert_eq!(gf_accounting_ack_persisted(handle, revision), 1);
            assert_eq!(
                gf_accounting_record_event(handle, event.as_ptr(), 9, 100),
                2
            );
            assert_eq!(gf_accounting_event_count(handle, 9, 100, &mut count), 1);
            assert_eq!(count, 1);
            assert_eq!(gf_accounting_snapshot(handle), 1);
            let persisted_revision = gf_accounting_revision(handle);
            assert_eq!(gf_accounting_ack_persisted(handle, persisted_revision), 1);
            let ptr = gf_accounting_snapshot_ptr(handle);
            let len = gf_accounting_snapshot_len(handle);
            let snapshot = slice::from_raw_parts(ptr, len).to_vec();
            assert_eq!(
                gf_accounting_record_event(handle, event.as_ptr(), 9, 101),
                0
            );
            assert_eq!(gf_accounting_event_count(handle, 9, 100, &mut count), 2);
            assert_eq!(
                gf_accounting_restore(handle, snapshot.as_ptr(), snapshot.len()),
                1
            );
            assert_eq!(gf_accounting_event_count(handle, 9, 100, &mut count), 1);
            assert_eq!(count, 1);
            gf_accounting_destroy(handle);
        }
    }
}
