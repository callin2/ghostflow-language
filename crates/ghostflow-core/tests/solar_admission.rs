use ghostflow_core::schedule_clock::{ClockSnapshot, ClockTrust};
use ghostflow_core::solar_admission::{
    SolarDecision, SolarFact, SolarFacts, SolarPulseEngine, SolarStageResult,
};

fn clock(monotonic_ms: u64, wall_ms: u64) -> ClockSnapshot<'static> {
    ClockSnapshot {
        monotonic_ms,
        boot_epoch: 7,
        wall_ms: Some(wall_ms),
        trust: ClockTrust::Trusted,
        uncertainty_ms: None,
        source_revision: Some("clock-r1"),
    }
}

fn facts(rows: &[SolarFact]) -> SolarFacts<'_> {
    SolarFacts {
        coverage_from_wall_ms: 0,
        coverage_to_wall_ms: 10_000,
        rows,
    }
}

#[test]
fn baseline_then_one_crossing_is_admitted_only_when_predicate_is_true() {
    let mut engine = SolarPulseEngine::new(41, 10_000, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    let baseline = engine.begin(clock(0, 0), facts(&empty)).unwrap();
    assert_eq!(baseline.result().decision, SolarDecision::BootBaseline);
    engine.commit(baseline).unwrap();

    let rows = [SolarFact::available(3, 5_000, "provider-r1", "zone-r1")];
    let stage = engine.begin(clock(100, 5_000), facts(&rows)).unwrap();
    let stage = stage.evaluate(true).unwrap();
    assert_eq!(stage.result().decision, SolarDecision::Due);
    assert!(stage.result().due);
    engine.commit(stage).unwrap();

    let corrected = [SolarFact::available(3, 5_050, "provider-r2", "zone-r1")];
    let retry = engine.begin(clock(200, 5_100), facts(&corrected)).unwrap();
    assert_eq!(retry.result().decision, SolarDecision::AlreadyTerminal);
    assert!(!retry.result().due);
}

#[test]
fn multiple_crossings_are_all_missed_and_never_execute() {
    let mut engine = SolarPulseEngine::new(41, 10_000, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 0), facts(&empty)).unwrap())
        .unwrap();
    let rows = [
        SolarFact::available(3, 2_000, "provider-r1", "zone-r1"),
        SolarFact::available(4, 7_000, "provider-r1", "zone-r1"),
    ];
    let stage = engine.begin(clock(100, 8_000), facts(&rows)).unwrap();
    assert_eq!(
        stage.result().decision,
        SolarDecision::MultipleCrossingsMissed
    );
    assert!(!stage.result().due);
    assert_eq!(stage.result().observations.len(), 2);
    assert!(stage
        .result()
        .observations
        .iter()
        .all(|item| item.decision == SolarDecision::Missed));
    engine.commit(stage).unwrap();
}

#[test]
fn past_correction_does_not_hide_a_new_crossing() {
    let mut engine = SolarPulseEngine::new(41, 10_000, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 0), facts(&empty)).unwrap())
        .unwrap();
    engine
        .commit(engine.begin(clock(100, 100), facts(&empty)).unwrap())
        .unwrap();

    let rows = [
        SolarFact::available(3, 50, "provider-r2", "zone-r1"),
        SolarFact::available(4, 150, "provider-r1", "zone-r1"),
    ];
    let stage = engine
        .begin(clock(200, 200), facts(&rows))
        .unwrap()
        .evaluate(true)
        .unwrap();
    assert_eq!(stage.result().decision, SolarDecision::Due);
    assert!(stage.result().observations.iter().any(|item| {
        item.source_day == 3 && item.decision == SolarDecision::CorrectionPastHighWater
    }));
    assert!(stage
        .result()
        .observations
        .iter()
        .any(|item| { item.source_day == 4 && item.decision == SolarDecision::Due }));
    engine.commit(stage).unwrap();
}

#[test]
fn false_predicate_is_terminal_and_failed_commit_keeps_crossing_retryable() {
    let mut engine = SolarPulseEngine::new(41, 10_000, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 0), facts(&empty)).unwrap())
        .unwrap();
    let rows = [SolarFact::available(3, 5_000, "provider-r1", "zone-r1")];
    let stage = engine
        .begin(clock(100, 5_000), facts(&rows))
        .unwrap()
        .evaluate(false)
        .unwrap();
    assert_eq!(
        stage.result().decision,
        SolarDecision::ConditionsFalseAtPulse
    );
    assert!(!stage.result().due);
    // Dropping the staged value is an explicit rollback.
    let retry = engine
        .begin(clock(100, 5_000), facts(&rows))
        .unwrap()
        .evaluate(true)
        .unwrap();
    assert_eq!(retry.result().decision, SolarDecision::Due);
    assert_eq!(retry.result().observations[0].decision, SolarDecision::Due);
    assert!(matches!(retry.result(), SolarStageResult { .. }));
}

#[test]
fn observation_gap_terminalizes_crossed_occurrence_without_due() {
    let mut engine = SolarPulseEngine::new(41, 100, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 0), facts(&empty)).unwrap())
        .unwrap();
    let rows = [SolarFact::available(3, 50, "provider-r1", "zone-r1")];
    let stage = engine.begin(clock(101, 101), facts(&rows)).unwrap();
    assert_eq!(stage.result().decision, SolarDecision::ObservationGap);
    assert!(!stage.result().due);
    assert_eq!(
        stage.result().observations[0].decision,
        SolarDecision::ObservationGap
    );
    engine.commit(stage).unwrap();
    let corrected = [SolarFact::available(3, 120, "provider-r2", "zone-r1")];
    let retry = engine.begin(clock(150, 150), facts(&corrected)).unwrap();
    assert_eq!(retry.result().decision, SolarDecision::AlreadyTerminal);
}

#[test]
fn admission_rejects_unevaluated_and_stale_stages_atomically() {
    let mut engine = SolarPulseEngine::new(41, 10_000, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 0), facts(&empty)).unwrap())
        .unwrap();
    let rows = [SolarFact::available(3, 5_000, "provider-r1", "zone-r1")];
    let first = engine.begin(clock(100, 5_000), facts(&rows)).unwrap();
    assert_eq!(
        engine.commit(first).unwrap_err().message(),
        "solar admission predicate was not evaluated"
    );
    let second = engine.begin(clock(100, 5_000), facts(&rows)).unwrap();
    let fork = engine
        .begin(clock(100, 5_000), facts(&rows))
        .unwrap()
        .evaluate(true)
        .unwrap();
    engine.commit(fork).unwrap();
    assert_eq!(
        engine.commit(second).unwrap_err().message(),
        "solar admission stage is stale"
    );
}

#[test]
fn cloned_engines_cannot_cross_commit_stages() {
    let mut engine = SolarPulseEngine::new(41, 10_000, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 0), facts(&empty)).unwrap())
        .unwrap();
    let clone = engine.clone();
    let rows = [SolarFact::available(3, 5_000, "provider-r1", "zone-r1")];
    let stage = clone
        .begin(clock(100, 5_000), facts(&rows))
        .unwrap()
        .evaluate(true)
        .unwrap();
    assert_eq!(
        engine.commit(stage).unwrap_err().message(),
        "solar admission stage belongs to another engine"
    );
}

#[test]
fn corrected_occurrence_before_trusted_high_water_is_missed_once() {
    let mut engine = SolarPulseEngine::new(41, 100, 7, 4).unwrap();
    let empty: [SolarFact; 0] = [];
    engine
        .commit(engine.begin(clock(0, 1_000), facts(&empty)).unwrap())
        .unwrap();
    engine
        .commit(engine.begin(clock(1, 900), facts(&empty)).unwrap())
        .unwrap();
    let corrected = [SolarFact::available(3, 950, "provider-r2", "zone-r1")];
    let stage = engine.begin(clock(2, 960), facts(&corrected)).unwrap();
    assert_eq!(
        stage.result().decision,
        SolarDecision::CorrectionPastHighWater
    );
    assert!(!stage.result().due);
    engine.commit(stage).unwrap();
}

#[test]
fn incomplete_or_malformed_provider_facts_fail_closed_before_staging() {
    let mut engine = SolarPulseEngine::new(41, 100, 7, 4).unwrap();
    let malformed = [SolarFact {
        source_day: 3,
        fold: 0,
        scheduled_wall_ms: None,
        provider_revision: "provider-r1".into(),
        context_revision: "zone-r1".into(),
        availability: ghostflow_core::solar_admission::SolarFactAvailability::Available,
    }];
    assert_eq!(
        engine
            .begin(clock(0, 0), facts(&malformed))
            .unwrap_err()
            .message(),
        "available solar fact has no scheduled time"
    );
    let rows = [SolarFact::available(3, 7_500, "provider-r1", "zone-r1")];
    let incomplete = SolarFacts {
        coverage_from_wall_ms: 7_000,
        coverage_to_wall_ms: 8_000,
        rows: &rows,
    };
    engine
        .commit(engine.begin(clock(0, 0), facts(&[])).unwrap())
        .unwrap();
    assert_eq!(
        engine
            .begin(clock(101, 8_000), incomplete)
            .unwrap()
            .result()
            .decision,
        SolarDecision::Unknown
    );
}
