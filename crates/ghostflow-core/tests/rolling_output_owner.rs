use ghostflow_core::accounting::{
    AccountingConfig, AccountingError, LedgerRead, OutputAdmission, OutputLease,
    RollingOutputOwner, RollingOutputPolicy,
};

const BOOT: u64 = 1;
const POLICY: RollingOutputPolicy = RollingOutputPolicy {
    resource_id: 1,
    window_ms: 60_000,
    limit_ms: 30_000,
    reserve_ms: 5_000,
};
const CONFIG: AccountingConfig = AccountingConfig {
    max_intervals: 8,
    max_events: 1,
    max_reservations: 8,
    max_rolling_window_ms: 60_000,
};

fn store(snapshot: &mut Vec<u8>) -> impl FnOnce(&[u8]) -> bool + '_ {
    |bytes| {
        *snapshot = bytes.to_vec();
        true
    }
}

fn start(owner: &mut RollingOutputOwner, time: u64, snapshot: &mut Vec<u8>) -> OutputLease {
    let OutputAdmission::Allowed(lease) = owner.request_on(time, store(snapshot)).unwrap() else {
        panic!("expected a durable grant at {time}");
    };
    lease
}

#[test]
fn only_persisted_leases_can_apply_and_the_rolling_budget_recovers_at_the_exact_boundary() {
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, CONFIG, BOOT, 0, store(&mut saved)).unwrap();
    for index in 0..6 {
        let now = index * 5_000;
        let lease = start(&mut owner, now, &mut saved);
        assert_eq!(lease.deadline_ms(), now + 5_000);
        let restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
        assert_eq!(restored.unresolved_lease(), Some(lease));
        owner
            .record_off(lease, Some(now), now + 5_000, store(&mut saved))
            .unwrap();
    }
    for now in [30_000, 60_000, 64_999] {
        assert_eq!(
            owner.request_on(now, |_| panic!("blocked ON must not be persisted")),
            Ok(OutputAdmission::BudgetExceeded)
        );
    }
    let LedgerRead::Known(explanation) = owner.explain(64_999) else {
        panic!("applied output evidence must be available");
    };
    assert_eq!(explanation.used_ms, 25_001);
    assert_eq!(explanation.next_release_ms, Some(65_000));
    let mut restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    let lease = start(&mut restored, 65_000, &mut saved);
    assert_eq!(lease.deadline_ms(), 70_000);
    assert_eq!(restored.explain(64_999), LedgerRead::Unknown);
}

#[test]
fn uncertain_writes_and_unresolved_restarts_never_release_a_second_on() {
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, CONFIG, BOOT, 10, store(&mut saved)).unwrap();
    assert_eq!(
        owner.request_on(9, |_| panic!("backward clock must not write")),
        Err(AccountingError::UnknownLedger)
    );
    let lease = start(&mut owner, 10, &mut saved);
    assert_eq!(
        owner.record_off(lease, Some(10), 5_010, |_| false),
        Err(AccountingError::UnknownLedger)
    );
    assert_eq!(
        owner.request_on(70_000, |_| true),
        Err(AccountingError::UnknownLedger)
    );
    let mut restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    assert_eq!(
        restored.request_on(70_000, |_| panic!("unresolved reservation must not write")),
        Ok(OutputAdmission::UnsettledOutput)
    );
    assert_eq!(restored.unresolved_lease(), Some(lease));
    let mut corrupt = saved.clone();
    corrupt[32] ^= 1;
    assert!(RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &corrupt).is_err());
    let other_output = RollingOutputPolicy {
        resource_id: 2,
        ..POLICY
    };
    assert!(RollingOutputOwner::restore(other_output, CONFIG, BOOT, &saved).is_err());
}

#[test]
fn restart_uncertainty_expires_only_after_a_full_window_of_confirmed_off() {
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, CONFIG, BOOT, 0, store(&mut saved)).unwrap();
    start(&mut owner, 500, &mut saved);
    let mut restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    assert_eq!(
        restored.recover_after_confirmed_off(499, 80_000, |_| panic!()),
        Err(AccountingError::InvalidReservation)
    );
    assert!(!restored
        .recover_after_confirmed_off(2_000, 61_999, |_| panic!())
        .unwrap());
    assert_eq!(
        restored.request_on(61_999, |_| panic!()),
        Ok(OutputAdmission::UnsettledOutput)
    );
    assert!(restored
        .recover_after_confirmed_off(2_000, 62_000, store(&mut saved))
        .unwrap());
    let mut restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    start(&mut restored, 62_000, &mut saved);
}

#[test]
fn expired_receipts_do_not_exhaust_a_bounded_rolling_only_ledger() {
    let bounded = AccountingConfig {
        max_intervals: 1,
        max_reservations: 1,
        ..CONFIG
    };
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, bounded, BOOT, 0, store(&mut saved)).unwrap();
    for index in 0..32 {
        let now = index * 65_000;
        let lease = start(&mut owner, now, &mut saved);
        owner
            .record_off(lease, Some(now), now + 5_000, store(&mut saved))
            .unwrap();
        owner = RollingOutputOwner::restore(POLICY, bounded, BOOT, &saved).unwrap();
    }
}

#[test]
fn changed_boot_waits_for_a_full_off_window_in_the_new_clock() {
    for settled in [false, true] {
        let mut saved = vec![];
        let mut owner =
            RollingOutputOwner::initialize(POLICY, CONFIG, BOOT, 1_000_000, store(&mut saved))
                .unwrap();
        let lease = start(&mut owner, 1_000_000, &mut saved);
        if settled {
            owner
                .record_off(lease, Some(1_000_000), 1_005_000, store(&mut saved))
                .unwrap();
        }
        let new_boot = BOOT + 1;
        let mut late_start = RollingOutputOwner::restore(POLICY, CONFIG, new_boot, &saved).unwrap();
        assert_eq!(late_start.explain(2_000_000), LedgerRead::Unknown);
        assert_eq!(
            late_start.request_on(2_000_000, |_| panic!()),
            Err(AccountingError::UnknownLedger)
        );

        let mut restarted = RollingOutputOwner::restore(POLICY, CONFIG, new_boot, &saved).unwrap();
        assert_eq!(restarted.explain(0), LedgerRead::Unknown);
        assert_eq!(
            restarted.request_on(0, |_| panic!()),
            Err(AccountingError::UnknownLedger)
        );
        assert_eq!(
            restarted.recover_after_confirmed_off(1_000, 999, |_| panic!()),
            Err(AccountingError::InvalidReservation)
        );
        assert!(!restarted
            .recover_after_confirmed_off(1_000, 60_999, |_| panic!())
            .unwrap());
        assert!(restarted
            .recover_after_confirmed_off(1_000, 61_000, store(&mut saved))
            .unwrap());
        let mut reopened = RollingOutputOwner::restore(POLICY, CONFIG, new_boot, &saved).unwrap();
        assert_eq!(reopened.unresolved_lease(), None);
        assert_eq!(
            start(&mut reopened, 61_000, &mut saved).deadline_ms(),
            66_000
        );
    }
}
