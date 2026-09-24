use ghostflow_core::after_event::{AfterEvent, Event, EventKey, Input, Observation, Status};
use ghostflow_core::temporal::{EvidenceQuality, TemporalError, TimeContext};

fn time(now_ms: u64) -> TimeContext {
    TimeContext { epoch: 1, now_ms }
}
fn event(id: u64, at_ms: u64) -> Event {
    Event {
        key: EventKey {
            source_tag: 7,
            source_epoch: 1,
            id,
        },
        time_epoch: 1,
        at_ms,
    }
}
fn apply<const N: usize>(tracker: &mut AfterEvent<N>, at_ms: u64, input: Input) {
    tracker.stage(time(at_ms), input).unwrap();
    tracker.commit().unwrap();
}

#[test]
fn overlapping_events_keep_distinct_results() {
    let mut tracker = AfterEvent::<3>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    apply(&mut tracker, 105, Input::Start(event(2, 105)));
    apply(
        &mut tracker,
        109,
        Input::Predicate(Observation {
            at_ms: 109,
            value: true,
            quality: EvidenceQuality::Measured,
        }),
    );
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Satisfied { at_ms: 109 }
    );
    assert_eq!(
        tracker.result(event(2, 105).key).unwrap().status,
        Status::Satisfied { at_ms: 109 }
    );
    apply(&mut tracker, 110, Input::Start(event(3, 110)));
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Satisfied { at_ms: 109 }
    );
    assert_eq!(
        tracker.result(event(3, 110).key).unwrap().status,
        Status::Pending
    );
}

#[test]
fn overlapping_events_can_have_different_outcomes() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    apply(&mut tracker, 108, Input::Start(event(2, 108)));
    apply(
        &mut tracker,
        111,
        Input::Predicate(Observation {
            at_ms: 111,
            value: true,
            quality: EvidenceQuality::Measured,
        }),
    );
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Expired
    );
    assert_eq!(
        tracker.result(event(2, 108).key).unwrap().status,
        Status::Satisfied { at_ms: 111 }
    );
}

#[test]
fn exact_end_is_excluded_and_unmeasured_predicate_does_not_satisfy() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    apply(
        &mut tracker,
        105,
        Input::Predicate(Observation {
            at_ms: 105,
            value: true,
            quality: EvidenceQuality::Held,
        }),
    );
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Pending
    );
    apply(
        &mut tracker,
        110,
        Input::Predicate(Observation {
            at_ms: 110,
            value: true,
            quality: EvidenceQuality::Measured,
        }),
    );
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Expired
    );
}

#[test]
fn capacity_rejects_overwrite_until_terminal_result_is_acknowledged() {
    let mut tracker = AfterEvent::<1>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    assert_eq!(
        tracker.stage(time(101), Input::Start(event(2, 101))),
        Err(TemporalError::CapacityExceeded)
    );
    apply(&mut tracker, 110, Input::Clock);
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Expired
    );
    apply(&mut tracker, 110, Input::Acknowledge(event(1, 100).key));
    apply(&mut tracker, 110, Input::Start(event(1, 100)));
    assert!(tracker.result(event(1, 100).key).is_none());
    apply(&mut tracker, 111, Input::Start(event(2, 111)));
    assert_eq!(
        tracker.result(event(2, 111).key).unwrap().status,
        Status::Pending
    );
}

#[test]
fn rollback_keeps_committed_results_unchanged() {
    let mut tracker = AfterEvent::<1>::new(10).unwrap();
    tracker
        .stage(time(100), Input::Start(event(1, 100)))
        .unwrap();
    assert!(tracker.result(event(1, 100).key).is_none());
    tracker.rollback().unwrap();
    apply(&mut tracker, 100, Input::Start(event(2, 100)));
    assert!(tracker.result(event(1, 100).key).is_none());
    assert_eq!(
        tracker.result(event(2, 100).key).unwrap().status,
        Status::Pending
    );
}

#[test]
fn simultaneous_starts_and_observation_commit_as_one_batch() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    tracker
        .stage_batch(
            time(100),
            &[event(1, 100), event(2, 100)],
            Some(Observation {
                at_ms: 100,
                value: true,
                quality: EvidenceQuality::Measured,
            }),
            &[],
        )
        .unwrap();
    assert!(tracker.results().iter().all(Option::is_none));
    tracker.commit().unwrap();
    for id in [1, 2] {
        assert_eq!(
            tracker.result(event(id, 100).key).unwrap().status,
            Status::Satisfied { at_ms: 100 }
        );
    }
}

#[test]
fn rejected_batch_preserves_results_time_and_event_identity() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    assert_eq!(
        tracker.stage_batch(time(110), &[event(2, 110), event(3, 110)], None, &[]),
        Err(TemporalError::CapacityExceeded)
    );
    assert_eq!(tracker.commit(), Err(TemporalError::NotStaged));
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Pending
    );
    assert!(tracker.result(event(2, 110).key).is_none());
    // The rejected time and partial insertion must not advance either high-water.
    tracker
        .stage_batch(time(105), &[event(2, 105)], None, &[])
        .unwrap();
    tracker.commit().unwrap();
    assert_eq!(
        tracker.result(event(2, 105).key).unwrap().status,
        Status::Pending
    );
}

#[test]
fn invalid_predicate_does_not_release_or_replace_terminal_results() {
    let mut tracker = AfterEvent::<1>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    apply(&mut tracker, 110, Input::Clock);
    let starts = [event(2, 111)];
    let acknowledgements = [event(1, 100).key];
    assert_eq!(
        tracker.stage_batch(
            time(111),
            &starts,
            Some(Observation {
                at_ms: 112,
                value: true,
                quality: EvidenceQuality::Measured,
            }),
            &acknowledgements,
        ),
        Err(TemporalError::InvalidIdentity)
    );
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Expired
    );
    assert!(tracker.result(event(2, 111).key).is_none());
    tracker
        .stage_batch(time(111), &starts, None, &acknowledgements)
        .unwrap();
    tracker.commit().unwrap();
    assert!(tracker.result(event(1, 100).key).is_none());
    assert_eq!(
        tracker.result(event(2, 111).key).unwrap().status,
        Status::Pending
    );
}

#[test]
fn batch_boundary_expires_old_event_and_satisfies_new_event_independently() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    apply(&mut tracker, 100, Input::Start(event(1, 100)));
    tracker
        .stage_batch(
            time(110),
            &[event(2, 110)],
            Some(Observation {
                at_ms: 110,
                value: true,
                quality: EvidenceQuality::Measured,
            }),
            &[],
        )
        .unwrap();
    tracker.commit().unwrap();
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Expired
    );
    assert_eq!(
        tracker.result(event(2, 110).key).unwrap().status,
        Status::Satisfied { at_ms: 110 }
    );
}

#[test]
fn batch_rollback_and_restage_preserve_the_original_candidate() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    tracker
        .stage_batch(time(100), &[event(1, 100), event(2, 100)], None, &[])
        .unwrap();
    assert_eq!(
        tracker.stage_batch(time(110), &[], None, &[]),
        Err(TemporalError::AlreadyStaged)
    );
    tracker.rollback().unwrap();
    assert!(tracker.results().iter().all(Option::is_none));
    // Both the source identity and monotonic time may be reused after rollback.
    tracker
        .stage_batch(time(100), &[event(1, 100)], None, &[])
        .unwrap();
    tracker.commit().unwrap();
    assert_eq!(
        tracker.result(event(1, 100).key).unwrap().status,
        Status::Pending
    );
    assert!(tracker.result(event(2, 100).key).is_none());
}

#[test]
fn native_any_and_all_project_staged_identity_results() {
    let mut tracker = AfterEvent::<2>::new(10).unwrap();
    assert_eq!(tracker.any(), None);
    assert_eq!(tracker.all(), None);
    tracker
        .stage_batch(time(100), &[event(1, 100)], None, &[])
        .unwrap();
    assert_eq!(tracker.staged_any().unwrap(), None);
    assert_eq!(tracker.staged_all().unwrap(), None);
    tracker.commit().unwrap();
    tracker
        .stage_batch(
            time(110),
            &[event(2, 110)],
            Some(Observation {
                at_ms: 110,
                value: true,
                quality: EvidenceQuality::Measured,
            }),
            &[],
        )
        .unwrap();
    assert_eq!(tracker.staged_any().unwrap(), Some(true));
    assert_eq!(tracker.staged_all().unwrap(), Some(false));
    tracker.rollback().unwrap();
    assert_eq!(tracker.any(), None);
    assert_eq!(tracker.all(), None);
}
