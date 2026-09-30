use ghostflow_core::estimate_evidence::*;
use ghostflow_core::signals::SensorFault;

fn reference() -> Reference {
    Reference {
        context: Context {
            identities: std::array::from_fn(|i| [(i + 1) as u8; 32]),
            run: 1,
            time_epoch: 2,
            source_epoch: 3,
        },
        established_ms: 10,
        initial_sequence: 0,
        uncertainty: Uncertainty {
            meaning: [2; 32],
            bound: None,
        },
    }
}
fn record() -> HistoryRecord {
    HistoryRecord {
        origin: reference().context.execution_origin(),
        sequence: 1,
        identity: 7,
        at_ms: 10,
        target: 1,
        result: Application::Acknowledged,
    }
}
fn history<'a>(records: &'a [HistoryRecord], through: u64) -> History<'a> {
    History {
        initial_sequence: 0,
        current_sequence: records.len() as u64,
        observed_from_ms: 10,
        observed_through_ms: through,
        complete: true,
        records,
    }
}
fn session() -> Session {
    Session::new(Some(reference()), Basis::AcknowledgedWrites, 4).unwrap()
}

#[test]
fn cached_ack_and_unknown_uncertainty_preserve_original_evidence() {
    let mut s = session();
    let r = [record()];
    assert_eq!(
        s.evaluate(reference().context, 10, Some(history(&r, 10)), None),
        Ok(Verdict::Admitted)
    );
    assert_eq!(
        s.evaluate(reference().context, 30, Some(history(&r, 30)), None),
        Ok(Verdict::Admitted)
    );
    assert_eq!(s.records(), &r);
    assert_eq!(s.reference(), Some(&reference()));
}
#[test]
fn rewritten_cached_ack_is_rejected_without_partial_commit() {
    let mut s = session();
    let r = [record()];
    s.evaluate(reference().context, 10, Some(history(&r, 10)), None)
        .unwrap();
    let changed = [HistoryRecord {
        at_ms: 11,
        ..record()
    }];
    assert_eq!(
        s.evaluate(reference().context, 12, Some(history(&changed, 12)), None),
        Err(Rejection::RewrittenIdentity)
    );
    assert_eq!(s.records(), &r);
    assert_eq!(s.verdict(), Verdict::Admitted);
}
#[test]
fn missing_tail_breaks_continuity_and_cannot_be_repaired_implicitly() {
    let mut s = session();
    let r = [record()];
    let mut h = history(&r, 20);
    h.current_sequence = 2;
    assert_eq!(
        s.evaluate(reference().context, 20, Some(h), None),
        Ok(Verdict::Unavailable(Cause::Gap))
    );
    assert_eq!(
        s.evaluate(reference().context, 21, Some(history(&r, 21)), None),
        Ok(Verdict::Unavailable(Cause::Gap))
    );
}
#[test]
fn reported_failure_is_retained_and_invalidates_old_ack() {
    for result in [Application::WriteFailed, Application::Unknown] {
        let mut s = session();
        let r = [
            record(),
            HistoryRecord {
                sequence: 2,
                identity: 8,
                at_ms: 11,
                result,
                ..record()
            },
        ];
        let cause = if result == Application::WriteFailed {
            Cause::WriteFailed
        } else {
            Cause::UncertainApplication
        };
        assert_eq!(
            s.evaluate(reference().context, 12, Some(history(&r, 12)), None),
            Ok(Verdict::Unavailable(cause))
        );
        assert_eq!(s.records(), &r);
    }
}
#[test]
fn source_fault_retains_its_original_classification() {
    for fault in [
        SensorFault::Stale,
        SensorFault::SourceChanged,
        SensorFault::ClockBackward,
    ] {
        let mut s = session();
        assert_eq!(
            s.evaluate(reference().context, 10, None, Some(fault)),
            Ok(Verdict::Fault(fault))
        );
        assert_eq!(
            s.evaluate(reference().context, 11, None, None),
            Ok(Verdict::Fault(fault))
        );
    }
}
#[test]
fn profile_and_uncertainty_reject_unsupported_or_malformed_values() {
    assert!(Session::new(Some(reference()), Basis::Requested, 0).is_err());
    assert!(Session::new(Some(reference()), Basis::Requested, MAX_HISTORY + 1).is_err());
    for bound in [-1.0, f64::NAN, f64::INFINITY] {
        let mut r = reference();
        r.uncertainty.bound = Some(bound);
        assert!(Session::new(Some(r), Basis::Requested, 1).is_err());
    }
}
#[test]
fn changed_context_and_missing_reference_remain_unavailable() {
    let mut s = session();
    let mut context = reference().context;
    context.identities[3][0] = 9;
    assert_eq!(
        s.evaluate(context, 10, None, None),
        Ok(Verdict::Unavailable(Cause::ContextChanged))
    );
    let mut s = Session::new(None, Basis::Requested, 1).unwrap();
    assert_eq!(
        s.evaluate(context, 10, None, None),
        Ok(Verdict::Unavailable(Cause::MissingReference))
    );
}

#[test]
fn seed_receipt_keeps_execution_origin_and_must_cover_reference_instant() {
    let mut r = reference();
    r.context.run = 4;
    let mut s = Session::new(Some(r), Basis::AcknowledgedWrites, 4).unwrap();
    assert_eq!(
        s.evaluate(r.context, 10, Some(history(&[record()], 10)), None),
        Ok(Verdict::Unavailable(Cause::HistoryContextChanged))
    );
    let mut r = reference();
    r.context.identities[1] = [20; 32];
    r.context.identities[3] = [21; 32];
    let mut s = Session::new(Some(r), Basis::AcknowledgedWrites, 4).unwrap();
    let seed = [HistoryRecord {
        at_ms: 8,
        ..record()
    }];
    let mut h = history(&seed, 10);
    h.observed_from_ms = 8;
    assert_eq!(
        s.evaluate(r.context, 10, Some(h), None),
        Ok(Verdict::Admitted)
    );
    assert_eq!(s.records()[0].at_ms, 8);
    let origin = r.context.execution_origin();
    assert_eq!(
        (origin.boot, origin.program, origin.binding),
        ([1; 32], [6; 32], [7; 32])
    );
    let mut s = session();
    let delayed = [HistoryRecord {
        at_ms: 11,
        ..record()
    }];
    let mut h = history(&delayed, 12);
    h.observed_from_ms = 11;
    assert_eq!(
        s.evaluate(reference().context, 12, Some(h), None),
        Ok(Verdict::Unavailable(Cause::Gap))
    );
}
#[test]
fn new_epoch_clock_reset_is_context_change_while_same_epoch_clock_reset_is_fault() {
    let mut s = session();
    s.evaluate(
        reference().context,
        10,
        Some(history(&[record()], 10)),
        None,
    )
    .unwrap();
    let mut c = reference().context;
    c.time_epoch += 1;
    assert_eq!(
        s.evaluate(c, 1, None, None),
        Ok(Verdict::Unavailable(Cause::ContextChanged))
    );
    let mut s = session();
    s.evaluate(
        reference().context,
        10,
        Some(history(&[record()], 10)),
        None,
    )
    .unwrap();
    assert_eq!(
        s.evaluate(reference().context, 1, None, None),
        Ok(Verdict::Fault(SensorFault::ClockBackward))
    );
}
