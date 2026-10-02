use ghostflow_core::accounting::{
    AccountingConfig, AccountingError, AccountingLedger, AdmissionResult, LedgerRead, RecordResult,
};

fn config() -> AccountingConfig {
    AccountingConfig {
        max_intervals: 8,
        max_events: 8,
        max_reservations: 8,
        max_rolling_window_ms: 60_000,
    }
}

#[test]
fn rolling_explanation_exact_union_threshold_and_restore() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .record_applied_segment(id(1), 7, 0, 20_000, 1)
        .unwrap();
    ledger
        .record_applied_segment(id(2), 7, 10_000, 30_000, 1)
        .unwrap();
    let LedgerRead::Known(explanation) = ledger.explain_rolling(7, 40_000, 60_000, 30_000, 5_000)
    else {
        panic!("known ledger");
    };
    assert_eq!(
        (
            explanation.used_ms,
            explanation.blocked,
            explanation.next_release_ms
        ),
        (30_000, true, Some(65_000))
    );
    let snapshot = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.reserve_rolling(id(3), 7, 64_999, 60_000, 30_000, 5_000),
        Err(AccountingError::LimitExceeded)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), snapshot);
    let restored = AccountingLedger::restore(config(), &snapshot).unwrap();
    assert_eq!(
        restored.explain_rolling(7, 40_000, 60_000, 30_000, 5_000),
        LedgerRead::Known(explanation)
    );
    assert_eq!(
        ledger.reserve_rolling(id(3), 7, 65_000, 60_000, 30_000, 5_000),
        Ok(AdmissionResult::Reserved)
    );
    assert_eq!(
        ledger.explain_rolling(7, 20_000, 60_000, 30_000, 5_000),
        LedgerRead::Unknown
    );
}

#[test]
fn rolling_explanation_never_expires_outstanding_reservations() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .reserve_rolling(id(1), 7, 0, 60_000, 30_000, 30_000)
        .unwrap();
    for now in [0, 1_000_000, u64::MAX] {
        let LedgerRead::Known(explanation) = ledger.explain_rolling(7, now, 60_000, 30_000, 1)
        else {
            panic!("known ledger");
        };
        assert_eq!(
            (
                explanation.reserved_ms,
                explanation.blocked,
                explanation.next_release_ms
            ),
            (30_000, true, None)
        );
    }
    ledger.cancel_rolling(id(1), id(2)).unwrap();
    let LedgerRead::Known(explanation) = ledger.explain_rolling(7, u64::MAX, 60_000, 30_000, 1)
    else {
        panic!("known ledger");
    };
    assert!(!explanation.blocked);
}

#[test]
fn rolling_explanation_u64_boundary_does_not_wrap_or_invent_release() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .record_applied_segment(id(1), 7, u64::MAX - 10, u64::MAX, 1)
        .unwrap();
    let LedgerRead::Known(explanation) = ledger.explain_rolling(7, u64::MAX, 60_000, 10, 1) else {
        panic!("known ledger");
    };
    assert_eq!(
        (
            explanation.used_ms,
            explanation.blocked,
            explanation.next_release_ms
        ),
        (10, true, None)
    );
    assert_eq!(
        AccountingLedger::unknown(config())
            .unwrap()
            .explain_rolling(7, 0, 60_000, 10, 1),
        LedgerRead::Unknown
    );
}

#[test]
fn rolling_admission_rejects_reference_reservation_without_mutation() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    let before = ledger.snapshot_bytes().unwrap();

    assert_eq!(
        ledger.reserve_rolling(id(20), 7, 1_000, 60_000, 30_000, 310_000),
        Err(AccountingError::LimitExceeded)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before);
}

#[test]
fn rolling_admission_accounts_for_applied_and_outstanding_time() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .record_applied_segment(id(1), 7, 0, 20_000, 100)
        .unwrap();

    assert_eq!(
        ledger.reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 10_000),
        Ok(AdmissionResult::Reserved)
    );
    assert_eq!(
        ledger.reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 10_000),
        Ok(AdmissionResult::Duplicate)
    );
    let before_rejection = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.reserve_rolling(id(21), 7, 20_000, 60_000, 30_000, 1),
        Err(AccountingError::LimitExceeded)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before_rejection);
}

#[test]
fn reservations_restore_and_unknown_ledgers_fail_closed() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 30_000)
        .unwrap();
    let snapshot = ledger.snapshot_bytes().unwrap();
    let mut restored = AccountingLedger::restore(config(), &snapshot).unwrap();
    assert_eq!(
        restored.reserve_rolling(id(21), 7, 20_000, 60_000, 30_000, 1),
        Err(AccountingError::LimitExceeded)
    );

    let mut unknown = AccountingLedger::unknown(config()).unwrap();
    assert_eq!(
        unknown.reserve_rolling(id(22), 7, 20_000, 60_000, 30_000, 1),
        Err(AccountingError::UnknownLedger)
    );
}

#[test]
fn settlement_requires_matching_applied_evidence_and_releases_reserved_charge() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 20_000)
        .unwrap();
    let before = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.settle_rolling(id(20), id(2)),
        Err(AccountingError::EvidenceMissing)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before);

    ledger
        .record_applied_segment(id(2), 7, 15_000, 20_000, 100)
        .unwrap();
    assert_eq!(
        ledger.settle_rolling(id(20), id(2)),
        Err(AccountingError::EvidenceMissing)
    );
    let before_historical_link = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.record_reserved_applied_segment(id(20), id(3), 7, 15_000, 20_000, 100),
        Err(AccountingError::InvalidReservation)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before_historical_link);
    ledger
        .record_reserved_applied_segment(id(20), id(3), 7, 20_000, 25_000, 100)
        .unwrap();
    let before_second_receipt = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.record_reserved_applied_segment(id(20), id(4), 7, 25_000, 30_000, 100),
        Err(AccountingError::InvalidReservation)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before_second_receipt);
    assert_eq!(
        ledger.settle_rolling(id(20), id(3)),
        Ok(RecordResult::Inserted)
    );
    assert_eq!(
        ledger.settle_rolling(id(20), id(3)),
        Ok(RecordResult::Duplicate)
    );
    let restored = AccountingLedger::restore(config(), &ledger.snapshot_bytes().unwrap()).unwrap();
    assert_eq!(restored.used_local_day(7, 100), LedgerRead::Known(10_000));
    assert_eq!(
        ledger.reserve_rolling(id(21), 7, 20_000, 60_000, 30_000, 25_000),
        Ok(AdmissionResult::Reserved)
    );
}

#[test]
fn restore_rejects_linked_receipts_that_bypass_reservation_invariants() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 20_000)
        .unwrap();
    ledger
        .record_reserved_applied_segment(id(20), id(3), 7, 20_000, 25_000, 100)
        .unwrap();
    let mut pre_admission = ledger.snapshot_bytes().unwrap();
    pre_admission[67..75].copy_from_slice(&19_999u64.to_le_bytes());
    rechecksum(&mut pre_admission);
    assert_eq!(
        AccountingLedger::restore(config(), &pre_admission),
        Err(AccountingError::InvalidSnapshot)
    );

    let mut duplicate_link = AccountingLedger::new(config()).unwrap();
    duplicate_link
        .reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 20_000)
        .unwrap();
    duplicate_link
        .record_applied_segment(id(2), 7, 20_000, 21_000, 100)
        .unwrap();
    duplicate_link
        .record_reserved_applied_segment(id(20), id(3), 7, 21_000, 22_000, 100)
        .unwrap();
    let mut duplicate_link = duplicate_link.snapshot_bytes().unwrap();
    duplicate_link[47..63].copy_from_slice(&id(20));
    rechecksum(&mut duplicate_link);
    assert_eq!(
        AccountingLedger::restore(config(), &duplicate_link),
        Err(AccountingError::InvalidSnapshot)
    );
}

#[test]
fn cancellation_evidence_is_stable_idempotent_and_restored() {
    let mut ledger = AccountingLedger::new(config()).unwrap();
    ledger
        .reserve_rolling(id(20), 7, 20_000, 60_000, 30_000, 30_000)
        .unwrap();
    assert_eq!(
        ledger.cancel_rolling(id(20), id(30)),
        Ok(RecordResult::Inserted)
    );
    assert_eq!(
        ledger.cancel_rolling(id(20), id(30)),
        Ok(RecordResult::Duplicate)
    );
    let before_collision = ledger.snapshot_bytes().unwrap();
    assert_eq!(
        ledger.cancel_rolling(id(20), id(31)),
        Err(AccountingError::IdentityCollision)
    );
    assert_eq!(ledger.snapshot_bytes().unwrap(), before_collision);

    let snapshot = ledger.snapshot_bytes().unwrap();
    let mut restored = AccountingLedger::restore(config(), &snapshot).unwrap();
    assert_eq!(
        restored.reserve_rolling(id(21), 7, 20_000, 60_000, 30_000, 30_000),
        Ok(AdmissionResult::Reserved)
    );
}

fn id(value: u8) -> [u8; 16] {
    [value; 16]
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

fn rechecksum(snapshot: &mut Vec<u8>) {
    snapshot.truncate(snapshot.len() - 4);
    snapshot.extend_from_slice(&crc32(snapshot).to_le_bytes());
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
