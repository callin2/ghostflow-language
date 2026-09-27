use ghostflow_core::schedule_clock::{ClockSnapshot, ClockTrust};
use ghostflow_core::solar_admission::{SolarFact, SolarFacts, SolarPulseEngine};

fn clock(monotonic_ms: u64, wall_ms: u64) -> ClockSnapshot<'static> {
    ClockSnapshot {
        monotonic_ms,
        boot_epoch: 7,
        wall_ms: Some(wall_ms),
        uncertainty_ms: Some(0),
        source_revision: Some("clock-v1"),
        trust: ClockTrust::Trusted,
    }
}

#[test]
fn daily_dst_folds_have_independent_terminal_identity() {
    let mut first = SolarFact::available(0, 1000, "iana-v1", "zone-v1");
    first.fold = 1;
    let mut second = SolarFact::available(0, 2000, "iana-v1", "zone-v1");
    second.fold = 2;
    let rows = [first, second];
    let facts = SolarFacts {
        coverage_from_wall_ms: 0,
        coverage_to_wall_ms: 3000,
        rows: &rows,
    };
    let mut engine = SolarPulseEngine::new(41, 2000, 7, 8).unwrap();
    let stage = engine.begin(clock(0, 900), facts).unwrap();
    assert!(!engine.commit(stage).unwrap().due);
    for (mono, wall) in [(100, 1000), (1100, 2000)] {
        let stage = engine
            .begin(clock(mono, wall), facts)
            .unwrap()
            .evaluate(true)
            .unwrap();
        assert!(engine.commit(stage).unwrap().due);
    }
    let stage = engine
        .begin(clock(1200, 1000), facts)
        .unwrap()
        .evaluate(true)
        .unwrap();
    assert!(!engine.commit(stage).unwrap().due);
}

#[test]
fn daily_rejects_duplicate_fold_identity_and_out_of_bounds_facts() {
    let first = SolarFact::available(0, 1000, "iana-v1", "zone-v1");
    let rows = [first.clone(), first];
    let engine = SolarPulseEngine::new(41, 2000, 7, 8).unwrap();
    let facts = SolarFacts {
        coverage_from_wall_ms: 0,
        coverage_to_wall_ms: 3000,
        rows: &rows,
    };
    assert!(engine.begin(clock(0, 900), facts).is_err());
    let outside = SolarFacts {
        coverage_from_wall_ms: 0,
        coverage_to_wall_ms: 999,
        rows: &rows[..1],
    };
    assert!(engine.begin(clock(0, 900), outside).is_err());
}
