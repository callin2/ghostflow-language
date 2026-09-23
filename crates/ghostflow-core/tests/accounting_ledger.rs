use ghostflow_core::accounting::{
    AccountingConfig, AccountingError, AccountingLedger, LedgerRead, RecordResult,
};

fn config() -> AccountingConfig {
    AccountingConfig {
        max_intervals: 8,
        max_events: 8,
        max_rolling_window_ms: 60_000,
    }
}

fn id(value: u8) -> [u8; 16] {
    [value; 16]
}

#[test]
fn rolling_and_local_day_usage_union_applied_segments() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .record_applied_segment(id(1), 7, 0, 20_000, 100)
        .unwrap();
    ledger
        .record_applied_segment(id(2), 7, 10_000, 30_000, 100)
        .unwrap();

    assert_eq!(
        ledger.used_rolling(7, 30_000, 20_000),
        LedgerRead::Known(20_000)
    );
    assert_eq!(ledger.used_local_day(7, 100), LedgerRead::Known(30_000));
}

#[test]
fn repeated_event_delivery_is_counted_once_and_snapshots_restore() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    assert_eq!(
        ledger.record_event(id(3), 9, 100),
        Ok(RecordResult::Inserted)
    );
    assert_eq!(
        ledger.record_event(id(3), 9, 100),
        Ok(RecordResult::Duplicate)
    );
    assert_eq!(ledger.event_count(9, 100), LedgerRead::Known(1));

    let snapshot = ledger.snapshot_bytes().unwrap();
    let mut restored = AccountingLedger::restore(config(), &snapshot).unwrap();
    assert_eq!(restored.event_count(9, 100), LedgerRead::Known(1));
    assert_eq!(
        restored.record_event(id(3), 9, 100),
        Ok(RecordResult::Duplicate)
    );
    assert_eq!(
        restored.record_event(id(3), 10, 100),
        Ok(RecordResult::Inserted)
    );
    assert_eq!(restored.event_count(10, 100), LedgerRead::Known(1));
}

#[test]
fn identity_collision_and_capacity_failure_are_atomic() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger.record_event(id(4), 9, 100).unwrap();
    let before = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.record_event(id(4), 9, 101),
        Err(AccountingError::IdentityCollision)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before);

    for n in 1..=8 {
        ledger
            .record_applied_segment(id(n), 7, u64::from(n) * 10, u64::from(n) * 10 + 5, 100)
            .unwrap();
    }
    let before = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.record_applied_segment(id(20), 7, 200, 205, 100),
        Err(AccountingError::Capacity)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before);
}

#[test]
fn unknown_state_and_invalid_snapshots_never_read_as_zero() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger.record_event(id(7), 9, 100).unwrap();
    ledger.mark_unknown();
    assert_eq!(ledger.event_count(9, 100), LedgerRead::Unknown);
    assert_eq!(ledger.used_rolling(7, 30_000, 20_000), LedgerRead::Unknown);
    let unknown_snapshot = ledger.snapshot_bytes().unwrap();
    let restored_unknown = AccountingLedger::restore(config(), &unknown_snapshot).unwrap();
    assert_eq!(restored_unknown.event_count(9, 100), LedgerRead::Unknown);
    let mut corrupt_snapshot = AccountingLedger::new(config())
        .unwrap()
        .snapshot_bytes()
        .unwrap();
    corrupt_snapshot[7] ^= 1;
    assert_eq!(
        AccountingLedger::restore(config(), &corrupt_snapshot),
        Err(AccountingError::InvalidSnapshot)
    );
    assert_eq!(
        AccountingLedger::restore(config(), b"not a snapshot"),
        Err(AccountingError::InvalidSnapshot)
    );
}

#[test]
fn midnight_segments_keep_day_totals_separate_and_window_bounds_fail_closed() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .record_applied_segment(id(5), 7, 90_000, 100_000, 100)
        .unwrap();
    ledger
        .record_applied_segment(id(6), 7, 100_000, 110_000, 101)
        .unwrap();
    assert_eq!(ledger.used_local_day(7, 100), LedgerRead::Known(10_000));
    assert_eq!(ledger.used_local_day(7, 101), LedgerRead::Known(10_000));
    assert_eq!(ledger.used_rolling(7, 110_000, 60_001), LedgerRead::Unknown);
}
