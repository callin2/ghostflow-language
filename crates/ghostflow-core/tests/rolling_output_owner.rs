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
fn forecast_waits_for_the_live_margin_and_does_not_settle_or_reserve() {
    let mut saved = vec![];
    let policy = RollingOutputPolicy {
        reserve_ms: 30_000,
        ..POLICY
    };
    let mut owner =
        RollingOutputOwner::initialize(policy, CONFIG, BOOT, 0, store(&mut saved)).unwrap();
    let lease = start(&mut owner, 0, &mut saved);
    assert_eq!(owner.next_admission(30_000, 100).unwrap(), None);
    owner
        .record_off(lease, Some(0), 29_950, store(&mut saved))
        .unwrap();
    let forecast = owner.next_admission(29_950, 100).unwrap().unwrap();
    assert_eq!(forecast.start_ms, 59_950);
    assert_eq!(forecast.deadline_ms, 89_950);
    assert!(owner.unresolved_lease().is_none());
    assert_eq!(
        owner
            .request_on_with_stop_margin(59_949, 100, |_| panic!("must not persist a denial"))
            .unwrap(),
        OutputAdmission::StopMargin
    );
    assert!(matches!(
        owner
            .request_on_with_stop_margin(59_950, 100, store(&mut saved))
            .unwrap(),
        OutputAdmission::Allowed(_)
    ));
}

#[test]
fn forecast_respects_capacity_until_the_whole_record_expires() {
    let mut saved = vec![];
    let config = AccountingConfig {
        max_intervals: 1,
        max_reservations: 1,
        ..CONFIG
    };
    let mut owner =
        RollingOutputOwner::initialize(POLICY, config, BOOT, 0, store(&mut saved)).unwrap();
    let lease = start(&mut owner, 0, &mut saved);
    owner
        .record_off(lease, Some(0), 1_000, store(&mut saved))
        .unwrap();
    let forecast = owner.next_admission(1_000, 100).unwrap().unwrap();
    assert_eq!(forecast.start_ms, 61_000);
    assert_eq!(forecast.deadline_ms, 66_000);
    assert_eq!(
        owner
            .request_on_with_stop_margin(60_999, 100, |_| panic!("no free slot"))
            .unwrap(),
        OutputAdmission::CapacityWait
    );
    assert!(matches!(
        owner
            .request_on_with_stop_margin(61_000, 100, store(&mut saved))
            .unwrap(),
        OutputAdmission::Allowed(_)
    ));
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
    for now in [30_000, 59_999] {
        assert_eq!(
            owner.request_on(now, |_| panic!("blocked ON must not be persisted")),
            Ok(OutputAdmission::BudgetExceeded)
        );
    }
    let LedgerRead::Known(explanation) = owner.explain(60_000) else {
        panic!("applied output evidence must be available");
    };
    assert_eq!(explanation.used_ms, 30_000);
    assert_eq!(explanation.next_release_ms, None);
    let mut restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    assert_eq!(
        restored.request_on_with_stop_margin(60_000, 5_000, |_| panic!(
            "unusable grant must not persist"
        )),
        Ok(OutputAdmission::StopMargin)
    );
    let lease = start(&mut restored, 60_000, &mut saved);
    assert_eq!(lease.deadline_ms(), 65_000);
    let restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    assert_eq!(restored.unresolved_lease(), Some(lease));
    assert_eq!(restored.explain(59_999), LedgerRead::Unknown);
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

#[test]
fn late_application_requires_full_same_boot_off_proof_and_durable_recovery() {
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, CONFIG, BOOT, 0, store(&mut saved)).unwrap();
    let lease = start(&mut owner, 0, &mut saved);
    assert_eq!(
        owner.record_off(lease, Some(0), 5_001, |_| panic!(
            "late evidence is not a successful settlement"
        )),
        Err(AccountingError::InvalidReservation)
    );
    assert_eq!(owner.explain(5_001), LedgerRead::Unknown);
    assert!(!owner
        .recover_after_confirmed_off(5_001, 65_000, |_| panic!())
        .unwrap());
    assert_eq!(
        owner.request_on(65_000, |_| panic!()),
        Err(AccountingError::UnknownLedger)
    );
    assert!(owner
        .recover_after_confirmed_off(5_001, 65_001, store(&mut saved))
        .unwrap());
    let mut restored = RollingOutputOwner::restore(POLICY, CONFIG, BOOT, &saved).unwrap();
    assert_eq!(
        start(&mut restored, 65_001, &mut saved).deadline_ms(),
        70_001
    );
}

#[test]
fn prospective_leases_match_an_independent_sliding_window_oracle() {
    let config = AccountingConfig {
        max_intervals: 32,
        max_reservations: 32,
        ..CONFIG
    };
    let policy = RollingOutputPolicy {
        window_ms: 60,
        limit_ms: 30,
        reserve_ms: 30,
        ..POLICY
    };
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(policy, config, BOOT, 0, store(&mut saved)).unwrap();
    let mut applied = Vec::new();
    let mut now = 0usize;
    while now < 18_000 {
        applied.resize(now, false);
        let feasible = |duration: usize| {
            (1..=duration).all(|offset| {
                let begin = (now + offset).saturating_sub(60);
                applied[begin.min(now)..now]
                    .iter()
                    .filter(|&&on| on)
                    .count()
                    + offset
                    <= 30
            })
        };
        let expected = (1..=30).take_while(|&d| feasible(d)).count();
        let result = owner.request_on(now as u64, store(&mut saved)).unwrap();
        if expected == 0 {
            assert_eq!(result, OutputAdmission::BudgetExceeded);
            now += 1;
            continue;
        }
        let OutputAdmission::Allowed(lease) = result else {
            panic!("expected duration {expected} at {now}, got {result:?}");
        };
        assert_eq!(lease.deadline_ms(), (now + expected) as u64);
        assert!(saved.len() <= RollingOutputOwner::checkpoint_max_bytes(config).unwrap());
        owner = RollingOutputOwner::restore(policy, config, BOOT, &saved).unwrap();
        // Alternate between sustained and irregular applied histories.
        let applied_length = if now / 97 % 2 == 0 {
            expected
        } else {
            expected.min(now % 7 + 1)
        };
        applied.resize(now + applied_length, true);
        owner
            .record_off(
                lease,
                Some(now as u64),
                (now + applied_length) as u64,
                store(&mut saved),
            )
            .unwrap();
        now += applied_length;
    }
}

#[test]
fn bounded_inventory_denies_without_persisting_and_recovers_when_history_expires() {
    let config = AccountingConfig {
        max_intervals: 1,
        max_reservations: 1,
        ..CONFIG
    };
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, config, BOOT, 0, store(&mut saved)).unwrap();
    let lease = start(&mut owner, 0, &mut saved);
    owner
        .record_off(lease, Some(0), 1, store(&mut saved))
        .unwrap();
    assert_eq!(
        saved.len(),
        RollingOutputOwner::checkpoint_max_bytes(config).unwrap()
    );
    assert_eq!(
        owner.request_on(60_000, |_| panic!("capacity denial writes nothing")),
        Ok(OutputAdmission::CapacityWait)
    );
    let lease = start(&mut owner, 60_001, &mut saved);
    assert_eq!(lease.deadline_ms(), 65_001);
}

#[test]
fn projection_near_the_clock_limit_never_wraps_a_deadline() {
    let mut saved = vec![];
    let mut owner =
        RollingOutputOwner::initialize(POLICY, CONFIG, BOOT, u64::MAX - 1, store(&mut saved))
            .unwrap();
    assert_eq!(
        start(&mut owner, u64::MAX - 1, &mut saved).deadline_ms(),
        u64::MAX
    );
}
