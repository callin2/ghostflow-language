//! Typed natural-provider observations. The host supplies evidence; Rust decides
//! the Result used by a GhostFlow `case` expression.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaturalKind {
    Tide,
    Moon,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaturalFault {
    ClockUnknown,
    LocationUnknown,
    EventUnavailable,
    PredictionMissing,
    PredictionStale,
    ZoneUnsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaturalQuery<'a> {
    pub kind: NaturalKind,
    pub provider: &'a str,
    pub classification: &'a str,
    pub location: &'a str,
    pub timezone: &'a str,
    pub max_uncertainty_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaturalObservation<'a> {
    pub kind: NaturalKind,
    pub provider: &'a str,
    pub binding_revision: &'a str,
    pub provider_revision: &'a str,
    pub location: &'a str,
    pub timezone: &'a str,
    pub criteria: &'a str,
    pub coverage_start_ms: u64,
    pub coverage_end_ms: u64,
    pub expires_at_ms: u64,
    pub uncertainty_ms: u64,
    /// Provider-certified classification labels. A tide provider can report
    /// neither or overlapping labels; a successful lunar observation has one phase.
    pub classifications: &'a [&'a str],
    pub fault: Option<NaturalFault>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaturalValue {
    Ok(bool),
    Fault(NaturalFault),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaturalResult<'a> {
    pub value: NaturalValue,
    pub binding_revision: Option<&'a str>,
    pub provider_revision: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaturalInputError {
    MalformedEvidence,
    BindingMismatch,
}

pub fn evaluate<'a>(
    query: NaturalQuery<'a>,
    evidence: Option<&'a NaturalObservation<'a>>,
    now_ms: u64,
    trusted_clock: bool,
) -> Result<NaturalResult<'a>, NaturalInputError> {
    if query.provider.is_empty() || !valid_classification(query.kind, query.classification) {
        return Err(NaturalInputError::BindingMismatch);
    }
    let Some(evidence) = evidence else {
        return Ok(NaturalResult {
            value: NaturalValue::Fault(if trusted_clock {
                NaturalFault::PredictionMissing
            } else {
                NaturalFault::ClockUnknown
            }),
            binding_revision: None,
            provider_revision: None,
        });
    };
    if evidence.kind != query.kind || evidence.provider != query.provider {
        return Err(NaturalInputError::BindingMismatch);
    }
    if evidence.provider_revision.is_empty()
        || evidence.binding_revision.is_empty()
        || evidence.criteria.is_empty()
        || evidence.coverage_start_ms >= evidence.coverage_end_ms
        || evidence.expires_at_ms < evidence.coverage_start_ms
        || evidence.uncertainty_ms > query.max_uncertainty_ms
        || evidence.classifications.len() > 8
        || evidence
            .classifications
            .iter()
            .any(|label| !valid_classification(evidence.kind, label))
        || evidence
            .classifications
            .iter()
            .enumerate()
            .any(|(index, label)| evidence.classifications[..index].contains(label))
        || (evidence.kind == NaturalKind::Moon
            && evidence.fault.is_none()
            && evidence.classifications.len() != 1)
    {
        return Err(NaturalInputError::MalformedEvidence);
    }
    let result = |value| NaturalResult {
        value,
        binding_revision: Some(evidence.binding_revision),
        provider_revision: Some(evidence.provider_revision),
    };
    if !trusted_clock {
        return Ok(result(NaturalValue::Fault(NaturalFault::ClockUnknown)));
    }
    if evidence.location.is_empty() || evidence.location != query.location {
        return Ok(result(NaturalValue::Fault(NaturalFault::LocationUnknown)));
    }
    if evidence.timezone.is_empty() || evidence.timezone != query.timezone {
        return Ok(result(NaturalValue::Fault(NaturalFault::ZoneUnsupported)));
    }
    if now_ms < evidence.coverage_start_ms || now_ms >= evidence.coverage_end_ms {
        return Ok(result(NaturalValue::Fault(NaturalFault::PredictionMissing)));
    }
    if now_ms >= evidence.expires_at_ms {
        return Ok(result(NaturalValue::Fault(NaturalFault::PredictionStale)));
    }
    if let Some(fault) = evidence.fault {
        return Ok(result(NaturalValue::Fault(fault)));
    }
    Ok(result(NaturalValue::Ok(
        evidence.classifications.contains(&query.classification),
    )))
}

fn valid_classification(kind: NaturalKind, label: &str) -> bool {
    match kind {
        NaturalKind::Tide => matches!(label, "spring" | "neap"),
        NaturalKind::Moon => matches!(
            label,
            "new"
                | "waxing_crescent"
                | "first_quarter"
                | "waxing_gibbous"
                | "full"
                | "waning_gibbous"
                | "last_quarter"
                | "waning_crescent"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation<'a>(kind: NaturalKind, classes: &'a [&'a str]) -> NaturalObservation<'a> {
        NaturalObservation {
            kind,
            provider: "harbor",
            binding_revision: "binding-1",
            provider_revision: "prediction-4",
            location: "site-1",
            timezone: "Asia/Seoul",
            criteria: "provider-criteria-1",
            coverage_start_ms: 100,
            coverage_end_ms: 200,
            expires_at_ms: 180,
            uncertainty_ms: 10,
            classifications: classes,
            fault: None,
        }
    }

    #[test]
    fn matching_nonmatching_and_overlapping_tide_classes_are_rust_results() {
        let query = NaturalQuery {
            kind: NaturalKind::Tide,
            provider: "harbor",
            classification: "neap",
            location: "site-1",
            timezone: "Asia/Seoul",
            max_uncertainty_ms: 10,
        };
        assert_eq!(
            evaluate(
                query,
                Some(&observation(NaturalKind::Tide, &["neap"])),
                150,
                true
            )
            .unwrap()
            .value,
            NaturalValue::Ok(true)
        );
        assert_eq!(
            evaluate(
                query,
                Some(&observation(NaturalKind::Tide, &["spring"])),
                150,
                true
            )
            .unwrap()
            .value,
            NaturalValue::Ok(false)
        );
        assert_eq!(
            evaluate(
                query,
                Some(&observation(NaturalKind::Tide, &["spring", "neap"])),
                150,
                true
            )
            .unwrap()
            .value,
            NaturalValue::Ok(true)
        );
        assert_eq!(
            evaluate(query, Some(&observation(NaturalKind::Tide, &[])), 150, true)
                .unwrap()
                .value,
            NaturalValue::Ok(false)
        );
    }

    #[test]
    fn expiry_and_coverage_are_distinct_and_keep_revision_evidence() {
        let query = NaturalQuery {
            kind: NaturalKind::Moon,
            provider: "harbor",
            classification: "full",
            location: "site-1",
            timezone: "Asia/Seoul",
            max_uncertainty_ms: 10,
        };
        let evidence = observation(NaturalKind::Moon, &["full"]);
        assert_eq!(
            evaluate(query, Some(&evidence), 100, true).unwrap().value,
            NaturalValue::Ok(true)
        );
        let stale = evaluate(query, Some(&evidence), 180, true).unwrap();
        assert_eq!(
            stale.value,
            NaturalValue::Fault(NaturalFault::PredictionStale)
        );
        assert_eq!(stale.provider_revision, Some("prediction-4"));
        assert_eq!(
            evaluate(query, Some(&evidence), 200, true).unwrap().value,
            NaturalValue::Fault(NaturalFault::PredictionMissing)
        );
    }

    #[test]
    fn malformed_and_mismatched_evidence_rejects_before_result() {
        let query = NaturalQuery {
            kind: NaturalKind::Tide,
            provider: "harbor",
            classification: "neap",
            location: "site-1",
            timezone: "Asia/Seoul",
            max_uncertainty_ms: 10,
        };
        let mut evidence = observation(NaturalKind::Tide, &["neap"]);
        evidence.provider = "elsewhere";
        assert_eq!(
            evaluate(query, Some(&evidence), 150, true),
            Err(NaturalInputError::BindingMismatch)
        );
        evidence.provider = "harbor";
        evidence.coverage_end_ms = 100;
        assert_eq!(
            evaluate(query, Some(&evidence), 150, true),
            Err(NaturalInputError::MalformedEvidence)
        );
    }

    #[test]
    fn unknown_clock_precedes_missing_prediction() {
        let query = NaturalQuery {
            kind: NaturalKind::Tide,
            provider: "harbor",
            classification: "neap",
            location: "site-1",
            timezone: "Asia/Seoul",
            max_uncertainty_ms: 10,
        };
        assert_eq!(
            evaluate(query, None, 150, false).unwrap().value,
            NaturalValue::Fault(NaturalFault::ClockUnknown)
        );
        assert_eq!(
            evaluate(query, None, 150, true).unwrap().value,
            NaturalValue::Fault(NaturalFault::PredictionMissing)
        );
    }
}
