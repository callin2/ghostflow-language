use ghostflow_core::signals::SensorFault;
use ghostflow_core::temporal::{
    Evidence, EvidenceQuality, Identity, Observation, Operation, RootDensity, RootInput,
    TargetBudget, TimeContext, UpstreamFault, Window, WindowConfig,
};

const OVER_MS: u64 = 10_000;
const MAX_AGE_MS: u64 = 3_000;

fn identity(epoch: u64, id: u64, timestamp_ms: u64) -> Identity {
    Identity {
        epoch,
        id,
        timestamp_ms,
    }
}

fn measured(source_tag: u32, epoch: u64, id: u64, timestamp_ms: u64, value: f64) -> Evidence {
    Evidence {
        observation: Observation {
            source_tag,
            identity: identity(epoch, id, timestamp_ms),
            value,
        },
        quality: EvidenceQuality::Measured,
    }
}

fn root(source_tag: u32, sample: Option<Identity>) -> RootInput {
    RootInput {
        source_tag,
        identity: sample,
    }
}

fn window(operation: Operation, roots: &[RootDensity]) -> Window {
    Window::new(
        WindowConfig {
            operation,
            over_ms: OVER_MS,
            max_age_ms: MAX_AGE_MS,
        },
        roots,
        TargetBudget {
            max_retained_samples: 64,
            max_bytes: 16 * 1024,
        },
    )
    .expect("fixture satisfies the explicit dense observation profile")
}

fn stage_sample(
    window: &mut Window,
    time_epoch: u64,
    now_ms: u64,
    roots: &[RootInput],
    sample: Evidence,
) -> ghostflow_core::temporal::Outcome {
    let outcome = window
        .stage(
            TimeContext {
                epoch: time_epoch,
                now_ms,
            },
            roots,
            Some(sample),
            None,
        )
        .expect("valid observation stages");
    window.commit().expect("staged observation commits");
    outcome
}

fn ordered_in_window(now_ms: u64, over_ms: u64, values: &[Observation]) -> Vec<Observation> {
    let lower = now_ms.saturating_sub(over_ms);
    let mut kept: Vec<_> = values
        .iter()
        .copied()
        .filter(|item| item.identity.timestamp_ms > lower && item.identity.timestamp_ms <= now_ms)
        .collect();
    kept.sort_by_key(|item| {
        (
            item.identity.timestamp_ms,
            item.source_tag,
            item.identity.epoch,
            item.identity.id,
        )
    });
    kept
}

fn oracle(
    operation: Operation,
    now_ms: u64,
    over_ms: u64,
    max_age_ms: u64,
    values: &[Observation],
) -> Option<f64> {
    let kept = ordered_in_window(now_ms, over_ms, values);
    let last = kept.last()?;
    if now_ms - last.identity.timestamp_ms >= max_age_ms {
        return None;
    }
    match operation {
        Operation::Average => {
            Some(kept.iter().map(|item| item.value).sum::<f64>() / kept.len() as f64)
        }
        Operation::Min => kept.iter().map(|item| item.value).reduce(f64::min),
        Operation::Max => kept.iter().map(|item| item.value).reduce(f64::max),
        Operation::Rate => {
            let first = kept.first()?;
            let elapsed_ms = last.identity.timestamp_ms - first.identity.timestamp_ms;
            (elapsed_ms > 0).then(|| (last.value - first.value) * 1_000.0 / elapsed_ms as f64)
        }
    }
}

#[test]
fn average_matches_independent_open_left_window_and_strict_age_oracle() {
    let densities = [RootDensity {
        source_tag: 1,
        max_observations: 1,
        interval_ms: 1_000,
    }];
    let mut actual = window(Operation::Average, &densities);
    let samples = [
        measured(1, 1, 1, 0, 100.0),
        measured(1, 1, 2, 1_000, 10.0),
        measured(1, 1, 3, 10_000, 20.0),
    ];
    for sample in samples {
        stage_sample(
            &mut actual,
            1,
            sample.observation.identity.timestamp_ms,
            &[root(1, Some(sample.observation.identity))],
            sample,
        );
    }

    let expected = oracle(
        Operation::Average,
        10_000,
        OVER_MS,
        MAX_AGE_MS,
        &samples.map(|item| item.observation),
    );
    let staged = actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 10_000,
            },
            &[root(1, None)],
            None,
            None,
        )
        .expect("clock-only evaluation stages");
    assert_eq!(
        staged.value,
        expected,
        "contributors={:?}",
        actual.staged_contributors()
    );
    assert_eq!(staged.count, 2, "t-over is excluded");
    actual.commit().unwrap();

    let just_fresh = actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 12_999,
            },
            &[root(1, None)],
            None,
            None,
        )
        .unwrap();
    assert_eq!(
        just_fresh.value,
        Some(20.0),
        "the older point has left the window"
    );
    actual.commit().unwrap();
    let exact_max_age = actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 13_000,
            },
            &[root(1, None)],
            None,
            None,
        )
        .unwrap();
    assert_eq!(
        exact_max_age.value, None,
        "age == max_age is not admissible"
    );
}

#[test]
fn min_and_max_ignore_duplicates_retain_history_across_faults_and_order_ties() {
    let densities = [
        RootDensity {
            source_tag: 1,
            max_observations: 2,
            interval_ms: 1_000,
        },
        RootDensity {
            source_tag: 2,
            max_observations: 2,
            interval_ms: 1_000,
        },
    ];
    let samples = [
        measured(2, 1, 1, 1_000, 7.0),
        measured(1, 1, 1, 1_000, -2.0),
        measured(1, 1, 2, 5_000, 4.0),
    ];

    for operation in [Operation::Min, Operation::Max] {
        let mut actual = window(operation, &densities);
        let mut latest = [None, None];
        for sample in samples {
            latest[(sample.observation.source_tag - 1) as usize] =
                Some(sample.observation.identity);
            stage_sample(
                &mut actual,
                1,
                sample.observation.identity.timestamp_ms,
                &[root(1, latest[0]), root(2, latest[1])],
                sample,
            );
        }
        let expected = oracle(
            operation,
            5_000,
            OVER_MS,
            MAX_AGE_MS,
            &samples.map(|item| item.observation),
        );
        assert_eq!(actual.current().value, expected);
        assert_eq!(actual.current().count, 3);
        assert_eq!(actual.current().first.unwrap().source_tag, 1);
        assert_eq!(actual.current().last.unwrap().identity.id, 2);

        let duplicate = measured(1, 1, 2, 5_000, -999.0);
        let outcome = actual
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 5_100,
                },
                &[root(1, latest[0]), root(2, latest[1])],
                Some(duplicate),
                None,
            )
            .unwrap();
        assert_eq!(
            outcome.value, expected,
            "duplicate identity is never inserted twice"
        );
        assert_eq!(outcome.count, 3);
        actual.commit().unwrap();

        let before_fault = actual.contributors().to_vec();
        let fault = UpstreamFault {
            origin: 44,
            fault: SensorFault::Disconnected,
        };
        let faulted = actual
            .stage(
                TimeContext {
                    epoch: 1,
                    now_ms: 5_200,
                },
                &[root(1, latest[0]), root(2, latest[1])],
                None,
                Some(fault),
            )
            .unwrap();
        assert_eq!(faulted.upstream_fault, Some(fault));
        actual.commit().unwrap();
        assert_eq!(actual.contributors(), before_fault.as_slice());
    }
}

#[test]
fn rate_uses_deterministic_tie_order_and_requires_distinct_timestamps() {
    let densities = [
        RootDensity {
            source_tag: 1,
            max_observations: 2,
            interval_ms: 1_000,
        },
        RootDensity {
            source_tag: 2,
            max_observations: 2,
            interval_ms: 1_000,
        },
    ];
    let mut actual = window(Operation::Rate, &densities);
    let first = measured(2, 1, 1, 1_000, 99.0);
    let tied = measured(1, 1, 1, 1_000, 10.0);
    let last = measured(1, 1, 2, 3_000, 16.0);
    stage_sample(
        &mut actual,
        1,
        1_000,
        &[root(1, None), root(2, Some(first.observation.identity))],
        first,
    );
    let same_timestamp = stage_sample(
        &mut actual,
        1,
        1_000,
        &[
            root(1, Some(tied.observation.identity)),
            root(2, Some(first.observation.identity)),
        ],
        tied,
    );
    assert_eq!(same_timestamp.value, None);
    assert_eq!(same_timestamp.first.unwrap().source_tag, 1);
    assert_eq!(same_timestamp.last.unwrap().source_tag, 2);

    let outcome = stage_sample(
        &mut actual,
        1,
        3_000,
        &[
            root(1, Some(last.observation.identity)),
            root(2, Some(first.observation.identity)),
        ],
        last,
    );
    let observations = [first.observation, tied.observation, last.observation];
    assert_eq!(
        outcome.value,
        oracle(Operation::Rate, 3_000, OVER_MS, MAX_AGE_MS, &observations)
    );
    assert_eq!(
        outcome.value,
        Some(3.0),
        "rate is canonical delta per second"
    );
}

#[test]
fn root_and_time_epoch_changes_invalidate_only_the_required_history() {
    let densities = [
        RootDensity {
            source_tag: 1,
            max_observations: 1,
            interval_ms: 1_000,
        },
        RootDensity {
            source_tag: 2,
            max_observations: 1,
            interval_ms: 1_000,
        },
    ];
    let mut actual = window(Operation::Average, &densities);
    let a = measured(1, 1, 1, 1_000, 10.0);
    let b = measured(2, 1, 1, 2_000, 20.0);
    stage_sample(
        &mut actual,
        1,
        1_000,
        &[root(1, Some(a.observation.identity)), root(2, None)],
        a,
    );
    stage_sample(
        &mut actual,
        1,
        2_000,
        &[
            root(1, Some(a.observation.identity)),
            root(2, Some(b.observation.identity)),
        ],
        b,
    );

    let replacement = identity(2, 1, 2_100);
    let after_root_epoch = actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 2_100,
            },
            &[
                root(1, Some(replacement)),
                root(2, Some(b.observation.identity)),
            ],
            None,
            Some(UpstreamFault {
                origin: 9,
                fault: SensorFault::Disconnected,
            }),
        )
        .unwrap();
    assert_eq!(after_root_epoch.count, 1);
    assert_eq!(actual.staged_contributors().unwrap(), &[b.observation]);
    actual.commit().unwrap();

    let after_time_epoch = actual
        .stage(
            TimeContext {
                epoch: 2,
                now_ms: 100,
            },
            &[root(1, None), root(2, None)],
            None,
            None,
        )
        .unwrap();
    assert_eq!(after_time_epoch.count, 0);
    assert_eq!(after_time_epoch.value, None);
}

#[test]
fn failed_or_nested_stage_never_mutates_committed_or_staged_state() {
    let densities = [RootDensity {
        source_tag: 1,
        max_observations: 1,
        interval_ms: 1_000,
    }];
    let mut actual = window(Operation::Average, &densities);
    let first = measured(1, 1, 1, 1_000, 10.0);
    stage_sample(
        &mut actual,
        1,
        1_000,
        &[root(1, Some(first.observation.identity))],
        first,
    );
    let committed = actual.current();
    let second = measured(1, 1, 2, 2_000, 20.0);
    actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 2_000,
            },
            &[root(1, Some(second.observation.identity))],
            Some(second),
            None,
        )
        .unwrap();
    let staged = actual.staged_contributors().unwrap().to_vec();
    assert!(actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 2_001
            },
            &[root(1, Some(second.observation.identity))],
            None,
            None,
        )
        .is_err());
    assert_eq!(actual.current(), committed);
    assert_eq!(actual.staged_contributors().unwrap(), staged.as_slice());
    actual.rollback().unwrap();
    assert_eq!(actual.current(), committed);
    assert_eq!(actual.contributors(), &[first.observation]);

    assert!(actual
        .stage(
            TimeContext {
                epoch: 1,
                now_ms: 999
            },
            &[root(1, Some(first.observation.identity))],
            None,
            None,
        )
        .is_err());
    assert_eq!(actual.current(), committed);
    assert_eq!(actual.contributors(), &[first.observation]);
}

#[test]
fn explicit_dense_profile_determines_capacity_and_rejects_insufficient_budget() {
    let densities = [
        RootDensity {
            source_tag: 1,
            max_observations: 2,
            interval_ms: 1_000,
        },
        RootDensity {
            source_tag: 2,
            max_observations: 1,
            interval_ms: 2_000,
        },
    ];
    let enough = window(Operation::Average, &densities);
    assert_eq!(enough.capacity(), 25);
    assert!(enough.memory_bytes() > 0);

    let rejected = Window::new(
        WindowConfig {
            operation: Operation::Average,
            over_ms: OVER_MS,
            max_age_ms: MAX_AGE_MS,
        },
        &densities,
        TargetBudget {
            max_retained_samples: 24,
            max_bytes: 16 * 1024,
        },
    );
    assert!(rejected.is_err());
}
