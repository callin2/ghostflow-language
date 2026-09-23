use ghostflow_core::signals::SensorFault;
use ghostflow_core::temporal::{EvidenceQuality, TemporalError, TimeContext};
use ghostflow_core::true_for::{CertifiedBoolInterval, TrueFor, TrueForInput};

fn time(now_ms: u64) -> TimeContext {
    TimeContext { epoch: 1, now_ms }
}

fn interval(id: u64, start_ms: u64, end_ms: u64) -> TrueForInput {
    TrueForInput::Interval(CertifiedBoolInterval {
        source_tag: 7,
        source_epoch: 1,
        time_epoch: 1,
        id,
        start_ms,
        end_ms,
        value: true,
        quality: EvidenceQuality::Measured,
    })
}

#[test]
fn touching_certified_intervals_reach_duration_at_the_exact_boundary() {
    let mut engine = TrueFor::new(7, 300_000).unwrap();
    let first = engine
        .stage(time(299_999), 1, interval(1, 0, 299_999))
        .unwrap();
    assert_eq!(first.value, Some(false));
    assert_eq!(first.covered_ms, 299_999);
    engine.commit().unwrap();
    let boundary = engine
        .stage(time(300_000), 1, interval(2, 299_999, 300_000))
        .unwrap();
    assert_eq!(boundary.value, Some(true));
    assert_eq!(boundary.covered_ms, 300_000);
    assert_eq!(boundary.start_ms, Some(0));
    assert_eq!(boundary.end_ms, Some(300_000));
}

#[test]
fn overlap_counts_union_once_and_false_or_unmeasured_evidence_breaks_it() {
    let mut engine = TrueFor::new(7, 10).unwrap();
    engine.stage(time(6), 1, interval(1, 0, 6)).unwrap();
    engine.commit().unwrap();
    let overlap = engine.stage(time(9), 1, interval(2, 4, 9)).unwrap();
    assert_eq!(overlap.covered_ms, 9);
    assert_eq!(overlap.value, Some(false));
    engine.commit().unwrap();
    let TrueForInput::Interval(mut stopped) = interval(3, 9, 10) else {
        unreachable!()
    };
    stopped.value = false;
    let stopped = engine
        .stage(time(10), 1, TrueForInput::Interval(stopped))
        .unwrap();
    assert_eq!(stopped.value, Some(false));
    assert_eq!(stopped.covered_ms, 0);
    engine.commit().unwrap();
    let resumed = engine.stage(time(15), 1, interval(4, 10, 15)).unwrap();
    assert_eq!(resumed.covered_ms, 5);
    engine.commit().unwrap();
    let TrueForInput::Interval(mut held) = interval(5, 15, 16) else {
        unreachable!()
    };
    held.quality = EvidenceQuality::Held;
    let held = engine
        .stage(time(16), 1, TrueForInput::Interval(held))
        .unwrap();
    assert_eq!(held.value, None);
    assert_eq!(held.covered_ms, 0);
    engine.commit().unwrap();
    let resumed = engine.stage(time(20), 1, interval(6, 16, 20)).unwrap();
    assert_eq!(resumed.covered_ms, 4);
}

#[test]
fn points_duplicates_clock_ticks_and_gaps_never_manufacture_continuity() {
    let mut engine = TrueFor::new(7, 10).unwrap();
    engine.stage(time(0), 1, interval(1, 0, 0)).unwrap();
    engine.commit().unwrap();
    let point = engine.stage(time(10), 1, interval(2, 10, 10)).unwrap();
    assert_eq!(point.covered_ms, 0);
    assert_eq!(point.value, Some(false));
    engine.commit().unwrap();
    let clock = engine
        .stage(time(100), 1, TrueForInput::NoObservation)
        .unwrap();
    assert_eq!(clock.value, None);
    assert_eq!(clock.covered_ms, 0);
    engine.commit().unwrap();
    let covered = engine.stage(time(100), 1, interval(3, 10, 16)).unwrap();
    assert_eq!(covered.covered_ms, 6);
    engine.commit().unwrap();
    let duplicate = engine.stage(time(100), 1, interval(3, 10, 16)).unwrap();
    assert_eq!(duplicate.covered_ms, 6);
    engine.commit().unwrap();
    let gap = engine.stage(time(100), 1, interval(4, 17, 21)).unwrap();
    assert_eq!(gap.covered_ms, 4);
    assert_eq!(gap.value, Some(false));
    engine.commit().unwrap();
    assert_eq!(
        engine.stage(time(100), 1, interval(4, 17, 22)),
        Err(TemporalError::IdentityMismatch)
    );
    assert_eq!(engine.outcome(), gap);
}

#[test]
fn reset_epochs_and_faults_cannot_be_bridged_by_old_certificates() {
    let mut engine = TrueFor::new(7, 10).unwrap();
    engine.stage(time(9), 1, interval(1, 0, 9)).unwrap();
    engine.commit().unwrap();
    let fault = engine
        .stage(
            time(10),
            1,
            TrueForInput::Unavailable(SensorFault::Disconnected),
        )
        .unwrap();
    assert_eq!(fault.value, None);
    assert_eq!(fault.covered_ms, 0);
    assert_eq!(fault.upstream_fault, Some(SensorFault::Disconnected));
    engine.commit().unwrap();
    assert!(engine.stage(time(11), 1, interval(2, 8, 11)).is_err());
    let resumed = engine.stage(time(12), 1, interval(2, 10, 12)).unwrap();
    assert_eq!(resumed.covered_ms, 2);
    assert_eq!(resumed.upstream_fault, None);
    engine.commit().unwrap();
    let mut next = match interval(1, 12, 20) {
        TrueForInput::Interval(i) => i,
        _ => unreachable!(),
    };
    next.source_epoch = 2;
    let changed = engine
        .stage(time(20), 2, TrueForInput::Interval(next))
        .unwrap();
    assert_eq!(changed.covered_ms, 8);
    assert_eq!(changed.value, Some(false));
    engine.commit().unwrap();
    let reboot = TimeContext {
        epoch: 2,
        now_ms: 1,
    };
    next.id = 2;
    next.time_epoch = 2;
    next.start_ms = 0;
    next.end_ms = 1;
    let changed = engine
        .stage(reboot, 2, TrueForInput::Interval(next))
        .unwrap();
    assert_eq!(changed.covered_ms, 1);
}

#[test]
fn malformed_unordered_or_conflicting_intervals_fail_without_mutating_state() {
    let mut engine = TrueFor::new(7, 10).unwrap();
    engine.stage(time(6), 1, interval(2, 0, 6)).unwrap();
    engine.commit().unwrap();
    let before = engine.outcome();
    let TrueForInput::Interval(base) = interval(3, 6, 10) else {
        unreachable!()
    };
    for invalid in [
        CertifiedBoolInterval {
            start_ms: 11,
            ..base
        },
        CertifiedBoolInterval { end_ms: 12, ..base },
        CertifiedBoolInterval {
            source_tag: 8,
            ..base
        },
        CertifiedBoolInterval {
            source_epoch: 2,
            ..base
        },
        CertifiedBoolInterval {
            time_epoch: 2,
            ..base
        },
        CertifiedBoolInterval { id: 1, ..base },
        CertifiedBoolInterval {
            start_ms: 5,
            value: false,
            ..base
        },
        CertifiedBoolInterval {
            start_ms: 5,
            quality: EvidenceQuality::Held,
            ..base
        },
        CertifiedBoolInterval {
            start_ms: 4,
            end_ms: 5,
            ..base
        },
    ] {
        assert!(
            engine
                .stage(time(10), 1, TrueForInput::Interval(invalid))
                .is_err(),
            "{invalid:?}"
        );
        assert_eq!(engine.outcome(), before);
    }
    assert_eq!(
        engine.stage(time(5), 1, TrueForInput::NoObservation),
        Err(TemporalError::ClockBackward)
    );
    let valid = engine
        .stage(time(10), 1, TrueForInput::Interval(base))
        .unwrap();
    assert_eq!(valid.value, Some(true));
    engine.rollback().unwrap();
    assert_eq!(engine.outcome(), before);
    assert_eq!(engine.commit(), Err(TemporalError::NotStaged));
    let retried = engine
        .stage(time(10), 1, TrueForInput::Interval(base))
        .unwrap();
    assert_eq!(retried, valid);
    assert_eq!(
        engine.stage(time(10), 1, TrueForInput::NoObservation),
        Err(TemporalError::AlreadyStaged)
    );
    engine.commit().unwrap();
    assert_eq!(engine.outcome(), valid);
}
