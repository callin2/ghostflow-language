use ghostflow_core::controller::{Direction, Pid, PidConfig, PidDecision};

fn config() -> PidConfig {
    PidConfig {
        period_ms: 10_000,
        late_after_ms: 30_000,
        direction: Direction::Reverse,
        kp: 2.0,
        ki: 0.1,
        kd: 1.0,
        bias_percent: 0.0,
        output_max_percent: 80.0,
        restart_percent: 0.0,
    }
}

#[test]
fn temperature_pid_resets_then_integrates_and_differentiates_measurement() {
    let mut pid = Pid::new(config()).unwrap();
    let first = pid.begin(0, Some(303.15), 298.15, 100.0).unwrap();
    assert_eq!(first.result.requested_percent, 0.0);
    pid.commit(first);
    let next = pid.begin(10_000, Some(304.15), 298.15, 100.0).unwrap();
    assert!((next.result.requested_percent - 7.6).abs() < 1e-9);
    assert_eq!(next.result.requested_percent, next.result.safe_percent);
}

#[test]
fn safety_clamp_rejects_integral_growth_and_discarded_stage_is_retryable() {
    let mut pid = Pid::new(config()).unwrap();
    let first = pid.begin(0, Some(303.15), 298.15, 100.0).unwrap();
    pid.commit(first);
    let blocked = pid.begin(10_000, Some(303.15), 298.15, 0.0).unwrap();
    assert_eq!(blocked.result.safe_percent, 0.0);
    assert_eq!(blocked.result.requested_percent, 0.0);
    // Discard the staged blocked sample: retry integrates exactly once.
    let retry = pid.begin(10_000, Some(303.15), 298.15, 100.0).unwrap();
    assert_eq!(retry.result.requested_percent, 5.0);
    pid.commit(blocked);
    let released = pid.begin(20_000, Some(303.15), 298.15, 100.0).unwrap();
    assert_eq!(released.result.requested_percent, 5.0);
}

#[test]
fn objective_saturation_does_not_wind_up_integral() {
    let mut pid = Pid::new(PidConfig {
        output_max_percent: 4.0,
        ..config()
    })
    .unwrap();
    let stage = pid.begin(0, Some(303.15), 298.15, 100.0).unwrap();
    pid.commit(stage);
    let stage = pid.begin(10_000, Some(303.15), 298.15, 100.0).unwrap();
    // Candidate I would demand 5%, above objective max 4%; retry old I once.
    assert_eq!(stage.result.requested_percent, 0.0);
    pid.commit(stage);
    let stage = pid.begin(20_000, Some(303.15), 298.15, 100.0).unwrap();
    assert_eq!(stage.result.requested_percent, 0.0);
}

#[test]
fn deadlines_hold_without_integrating_but_safety_is_immediate() {
    let mut pid = Pid::new(PidConfig {
        restart_percent: 20.0,
        ..config()
    })
    .unwrap();
    let stage = pid.begin(0, Some(303.15), 298.15, 100.0).unwrap();
    pid.commit(stage);
    for now in [0, 9_999] {
        let stage = pid.begin(now, Some(304.15), 298.15, 3.0).unwrap();
        assert_eq!(stage.result.decision, PidDecision::Held);
        assert_eq!(stage.result.requested_percent, 20.0);
        assert_eq!(stage.result.safe_percent, 3.0);
        pid.commit(stage);
    }
    let stage = pid.begin(10_000, Some(303.15), 298.15, 100.0).unwrap();
    assert_eq!(stage.result.requested_percent, 25.0);
}

#[test]
fn setpoint_changes_do_not_kick_derivative_and_direction_is_explicit() {
    let mut pid = Pid::new(PidConfig {
        direction: Direction::Direct,
        ki: 0.0,
        restart_percent: 20.0,
        ..config()
    })
    .unwrap();
    let stage = pid.begin(0, Some(298.15), 298.15, 100.0).unwrap();
    pid.commit(stage);
    let stage = pid.begin(10_000, Some(298.15), 303.15, 100.0).unwrap();
    assert_eq!(stage.result.requested_percent, 30.0);
}

#[test]
fn exact_late_limit_uses_actual_dt_and_one_past_disables() {
    let mut pid = Pid::new(config()).unwrap();
    let stage = pid.begin(0, Some(303.15), 298.15, 100.0).unwrap();
    pid.commit(stage);
    assert_eq!(
        pid.begin(30_000, Some(303.15), 298.15, 100.0)
            .unwrap()
            .result
            .requested_percent,
        15.0
    );
    let stage = pid.begin(30_001, Some(303.15), 298.15, 100.0).unwrap();
    assert_eq!(stage.result.decision, PidDecision::Disabled);
    assert_eq!(stage.result.safe_percent, 0.0);
    pid.commit(stage);
    let recovered = pid.begin(40_000, Some(305.15), 298.15, 100.0).unwrap();
    assert_eq!(recovered.result.requested_percent, 0.0);
}

#[test]
fn invalid_measurements_disable_immediately_and_recovery_tracks_safe_zero() {
    for measurement in [None, Some(f64::NAN), Some(f64::INFINITY), Some(-1.0)] {
        let mut pid = Pid::new(PidConfig {
            restart_percent: 20.0,
            ..config()
        })
        .unwrap();
        let stage = pid.begin(0, Some(303.15), 298.15, 100.0).unwrap();
        pid.commit(stage);
        let stage = pid.begin(1, measurement, 298.15, 100.0).unwrap();
        assert_eq!(stage.result.decision, PidDecision::Disabled);
        assert_eq!(stage.result.safe_percent, 0.0);
        pid.commit(stage);
        assert_eq!(
            pid.begin(10_000, Some(304.15), 298.15, 100.0)
                .unwrap()
                .result
                .requested_percent,
            0.0
        );
    }
}

#[test]
fn invalid_activation_and_rejected_time_do_not_change_controller() {
    assert!(Pid::new(PidConfig {
        period_ms: 0,
        ..config()
    })
    .is_err());
    assert!(Pid::new(PidConfig {
        ki: f64::NAN,
        ..config()
    })
    .is_err());
    assert!(Pid::new(PidConfig {
        late_after_ms: 9_999,
        ..config()
    })
    .is_err());
    let mut pid = Pid::new(config()).unwrap();
    let stage = pid.begin(10, Some(303.15), 298.15, 100.0).unwrap();
    pid.commit(stage);
    assert!(pid.begin(9, Some(304.15), 298.15, 100.0).is_err());
    assert!(pid.begin(10_010, Some(304.15), 298.15, f64::NAN).is_err());
    assert_eq!(
        pid.begin(10_010, Some(303.15), 298.15, 100.0)
            .unwrap()
            .result
            .requested_percent,
        5.0
    );
}

#[test]
fn zero_integral_gain_disables_term_without_overflowing_unused_arithmetic() {
    let mut pid = Pid::new(PidConfig {
        kp: 0.0,
        ki: 0.0,
        kd: 0.0,
        restart_percent: 20.0,
        ..config()
    })
    .unwrap();
    let stage = pid.begin(0, Some(0.0), f64::MAX, 100.0).unwrap();
    pid.commit(stage);
    let stage = pid.begin(10_000, Some(0.0), f64::MAX, 100.0).unwrap();
    assert_eq!(stage.result.decision, PidDecision::Updated);
    assert_eq!(stage.result.requested_percent, 20.0);
}
