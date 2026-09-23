use ghostflow_core::range_schedule::{RangeDecision, RangeEngine, RangeFact};
use ghostflow_core::schedule_clock::{ClockSnapshot, ClockTrust};

fn clock(monotonic_ms: u64, wall_ms: u64) -> ClockSnapshot<'static> {
    ClockSnapshot {
        monotonic_ms,
        wall_ms: Some(wall_ms),
        boot_epoch: 1,
        trust: ClockTrust::Trusted,
        uncertainty_ms: None,
        source_revision: None,
    }
}

fn fact(key: &str, planned: u64) -> RangeFact {
    RangeFact {
        occurrence_key: key.into(),
        planned_wall_ms: planned,
        duration_ms: 600,
    }
}

#[test]
fn late_boot_admits_only_remaining_time_and_wall_corrections_do_not_move_end() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let facts = [fact("day-1", 1_000)];
    let stage = engine.begin(clock(0, 1_240), &facts, true, false).unwrap();
    assert!(stage.result.due && stage.result.active);
    assert_eq!(stage.result.deadline_monotonic_ms, Some(360));
    engine.commit(stage);
    for (mono, wall) in [(100, 9_000), (359, 900)] {
        let stage = engine
            .begin(clock(mono, wall), &facts, true, false)
            .unwrap();
        assert!(stage.result.active);
        assert!(!stage.result.due);
        assert_eq!(stage.result.deadline_monotonic_ms, Some(360));
        engine.commit(stage);
    }
    let stage = engine
        .begin(clock(360, 1_400), &facts, true, false)
        .unwrap();
    assert!(!stage.result.active);
    engine.commit(stage);
    let stage = engine
        .begin(clock(361, 1_400), &facts, true, false)
        .unwrap();
    assert!(!stage.result.due && !stage.result.active);
}

#[test]
fn unknown_prevents_admission_but_does_not_stop_admitted_range() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let facts = [fact("day-1", 1_000)];
    let unknown = ClockSnapshot {
        trust: ClockTrust::Unknown("lost"),
        ..clock(0, 1_240)
    };
    let stage = engine.begin(unknown, &facts, true, false).unwrap();
    assert_eq!(stage.result.decision, RangeDecision::ClockUnknown);
    engine.commit(stage);
    let stage = engine.begin(clock(10, 1_240), &facts, true, false).unwrap();
    assert!(stage.result.due);
    engine.commit(stage);
    let stage = engine
        .begin(
            ClockSnapshot {
                monotonic_ms: 369,
                ..unknown
            },
            &facts,
            true,
            false,
        )
        .unwrap();
    assert!(stage.result.active);
    engine.commit(stage);
    let stage = engine
        .begin(
            ClockSnapshot {
                monotonic_ms: 370,
                ..unknown
            },
            &facts,
            true,
            false,
        )
        .unwrap();
    assert!(!stage.result.active);
}

#[test]
fn gap_and_late_predicate_admit_current_interval_without_replaying_expired_one() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let facts = [fact("old", 0), fact("current", 1_000)];
    let stage = engine.begin(clock(0, 900), &facts, false, false).unwrap();
    engine.commit(stage);
    let stage = engine
        .begin(clock(500, 1_400), &facts, true, false)
        .unwrap();
    assert!(stage.result.due);
    assert_eq!(stage.result.occurrence_key.as_deref(), Some("current"));
    assert_eq!(stage.result.deadline_monotonic_ms, Some(700));
}

#[test]
fn exact_end_is_terminal_and_cancel_never_rearms() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let facts = [fact("expired", 1_000)];
    let stage = engine.begin(clock(0, 1_600), &facts, true, false).unwrap();
    assert_eq!(stage.result.decision, RangeDecision::LateStartExpired);
    engine.commit(stage);
    let stage = engine.begin(clock(1, 1_300), &facts, true, false).unwrap();
    assert!(!stage.result.due);
    engine.commit(stage);
    let facts = [fact("next", 2_000)];
    let stage = engine.begin(clock(2, 2_000), &facts, true, false).unwrap();
    engine.commit(stage);
    let stage = engine.begin(clock(3, 2_001), &facts, true, true).unwrap();
    assert_eq!(stage.result.decision, RangeDecision::Cancelled);
    engine.commit(stage);
    assert!(
        !engine
            .begin(clock(4, 2_002), &facts, true, false)
            .unwrap()
            .result
            .active
    );
}

#[test]
fn overlapping_facts_are_rejected_atomically_and_adjacent_intervals_are_allowed() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    assert!(engine
        .begin(
            clock(100, 1_200),
            &[fact("a", 1_000), fact("b", 1_599)],
            true,
            false
        )
        .is_err());
    let stage = engine
        .begin(
            clock(0, 1_200),
            &[fact("a", 1_000), fact("b", 1_600)],
            true,
            false,
        )
        .unwrap();
    assert!(stage.result.due);
    engine.commit(stage);
    assert!(engine
        .begin(clock(1, 1_201), &[fact("b", 1_500)], true, false)
        .is_err());
}

#[test]
fn discarded_stage_does_not_consume_admission() {
    let engine = RangeEngine::new(100, 1, 8).unwrap();
    let facts = [fact("a", 1_000)];
    assert!(
        engine
            .begin(clock(0, 1_200), &facts, true, false)
            .unwrap()
            .result
            .due
    );
    assert!(
        engine
            .begin(clock(0, 1_200), &facts, true, false)
            .unwrap()
            .result
            .due
    );
}

#[test]
fn live_start_edit_pauses_same_identity_and_resumes_without_second_due() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let stage = engine
        .begin(clock(0, 1_240), &[fact("slot-id", 1_000)], true, false)
        .unwrap();
    engine.commit(stage);
    let changed = [fact("slot-id", 1_420)];
    // A wall correction cannot change the stable 1_300 position at this edit.
    let stage = engine
        .begin_retime(clock(60, 9_000), &changed, true, false)
        .unwrap();
    assert!(!stage.result.active && !stage.result.due);
    assert_eq!(stage.result.deadline_monotonic_ms, Some(780));
    engine.commit(stage);
    let stage = engine
        .begin(
            ClockSnapshot {
                trust: ClockTrust::Unknown("lost"),
                ..clock(180, 1_420)
            },
            &changed,
            true,
            false,
        )
        .unwrap();
    assert!(!stage.result.active);
    engine.commit(stage);
    let stage = engine
        .begin(clock(200, 1_440), &changed, true, false)
        .unwrap();
    assert!(stage.result.active && !stage.result.due);
    assert_eq!(stage.result.occurrence_key.as_deref(), Some("slot-id"));
    engine.commit(stage);
    assert!(
        !engine
            .begin(clock(780, 2_020), &changed, true, false)
            .unwrap()
            .result
            .active
    );
}

#[test]
fn live_duration_uses_original_planned_start_and_shortening_is_terminal() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let stage = engine
        .begin(clock(0, 1_240), &[fact("a", 1_000)], true, false)
        .unwrap();
    engine.commit(stage);
    let changed = [RangeFact {
        duration_ms: 720,
        ..fact("a", 1_000)
    }];
    let stage = engine
        .begin_retime(clock(180, 8_000), &changed, true, false)
        .unwrap();
    assert_eq!(stage.result.deadline_monotonic_ms, Some(480));
    assert!(!stage.result.due);
    engine.commit(stage);
    let short = [RangeFact {
        duration_ms: 300,
        ..fact("a", 1_000)
    }];
    let stage = engine
        .begin_retime(clock(181, 8_001), &short, true, false)
        .unwrap();
    assert!(!stage.result.active);
    engine.commit(stage);
    assert!(
        !engine
            .begin_retime(clock(182, 1_422), &changed, true, false)
            .unwrap()
            .result
            .active
    );
}

#[test]
fn overlapping_live_retime_rejects_entire_event() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let initial = [fact("a", 1_000), fact("b", 1_600)];
    let stage = engine
        .begin(clock(0, 1_240), &initial, true, false)
        .unwrap();
    engine.commit(stage);
    assert!(engine
        .begin_retime(
            clock(60, 1_300),
            &[fact("a", 1_001), fact("b", 1_600)],
            true,
            false
        )
        .is_err());
    let stage = engine
        .begin(clock(60, 1_300), &initial, true, false)
        .unwrap();
    assert_eq!(stage.result.deadline_monotonic_ms, Some(360));
}

#[test]
fn edit_after_elapsed_deadline_cannot_revive_an_occurrence_without_intervening_scan() {
    let mut engine = RangeEngine::new(100, 1, 8).unwrap();
    let stage = engine
        .begin(clock(0, 1_240), &[fact("a", 1_000)], true, false)
        .unwrap();
    engine.commit(stage);
    let extended = [RangeFact {
        duration_ms: 900,
        ..fact("a", 1_000)
    }];
    let stage = engine
        .begin_retime(clock(361, 1_601), &extended, true, false)
        .unwrap();
    assert!(!stage.result.active && !stage.result.due);
}

#[test]
fn exact_deadline_event_order_determines_whether_extension_precedes_completion() {
    let mut before_scan = RangeEngine::new(100, 1, 8).unwrap();
    let original = [fact("a", 1_000)];
    let stage = before_scan
        .begin(clock(0, 1_240), &original, true, false)
        .unwrap();
    before_scan.commit(stage);
    let mut after_scan = before_scan.clone();
    let extended = [RangeFact {
        duration_ms: 900,
        ..fact("a", 1_000)
    }];
    let stage = before_scan
        .begin_retime(clock(360, 1_600), &extended, true, false)
        .unwrap();
    assert!(stage.result.active && !stage.result.due);
    assert_eq!(stage.result.deadline_monotonic_ms, Some(660));
    let stage = after_scan
        .begin(clock(360, 1_600), &original, true, false)
        .unwrap();
    after_scan.commit(stage);
    assert!(
        !after_scan
            .begin_retime(clock(360, 1_600), &extended, true, false)
            .unwrap()
            .result
            .active
    );
}
