//! Borrowed JSON encoding. The sink controls allocation and may reject any write.
use crate::temporal_evidence::{operation_name, EvidenceIdentity, EvidencePoint, ProofNode};
use crate::temporal_runtime::{fault_code, WindowTrace};
use crate::{NamedValues, SafetyTrace, TickRecord, Value};
use std::fmt::{self, Write};

pub(crate) fn text(out: &mut impl Write, value: &str) -> fmt::Result {
    out.write_char('"')?;
    for ch in value.chars() {
        match ch {
            '"' => out.write_str("\\\"")?,
            '\\' => out.write_str("\\\\")?,
            '\n' => out.write_str("\\n")?,
            '\r' => out.write_str("\\r")?,
            '\t' => out.write_str("\\t")?,
            c if c < ' ' => write!(out, "\\u{:04x}", c as u32)?,
            c => out.write_char(c)?,
        }
    }
    out.write_char('"')
}
fn values(out: &mut impl Write, items: &NamedValues) -> fmt::Result {
    out.write_char('{')?;
    for (index, (name, value)) in items.iter().enumerate() {
        if index > 0 {
            out.write_char(',')?;
        }
        text(out, name)?;
        out.write_char(':')?;
        match value {
            Value::Bool(v) => write!(out, "{v}")?,
            Value::Number(v) => write!(out, "{v}")?,
            Value::Int(v) => write!(out, "{v}")?,
        }
    }
    out.write_char('}')
}
fn context_traces(out: &mut impl Write, r: &TickRecord) -> fmt::Result {
    if !r.context_trace.is_empty() {
        out.write_str(",\"contextTrace\":[")?;
        for (index, observation) in r.context_trace.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            write!(out, "{{\"site\":{},\"occurrenceId\":", observation.site)?;
            text(out, &observation.occurrence_id)?;
            out.write_str(",\"plannedWallMs\":")?;
            match observation.planned_ms {
                Some(value) => write!(out, "{value}")?,
                None => out.write_str("null")?,
            }
            out.write_str(",\"decision\":")?;
            text(out, &observation.decision)?;
            out.write_str(",\"providerRevision\":")?;
            text(out, &observation.provider_revision)?;
            out.write_str(",\"contextRevision\":")?;
            text(out, &observation.context_revision)?;
            if let Some(provenance) = &observation.clock_provenance {
                out.write_str(",\"clockProvenance\":")?;
                text(out, provenance)?;
                out.write_str(",\"clockSourceRevision\":")?;
                if let Some(revision) = &observation.clock_source_revision {
                    text(out, revision)?;
                } else {
                    out.write_str("null")?;
                }
                out.write_str(",\"clockUncertaintyMs\":")?;
                optional_u64(out, observation.clock_uncertainty_ms)?;
            }
            if let Some(reason) = &observation.unknown_reason {
                out.write_str(",\"unknownReason\":")?;
                text(out, reason)?;
            }
            out.write_char('}')?;
        }
        out.write_char(']')?;
    }
    Ok(())
}
fn certified_traces(out: &mut impl Write, r: &TickRecord) -> fmt::Result {
    if !r.true_for_trace.is_empty() {
        out.write_str(",\"trueForTrace\":[")?;
        for (index, trace) in r.true_for_trace.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            write!(
                out,
                "{{\"site\":{},\"sourceTag\":{},\"sourceEpoch\":{},\"certificateId\":",
                trace.site, trace.source_tag, trace.source_epoch
            )?;
            use crate::true_for::TrueForInput;
            match trace.input {
                TrueForInput::Interval(interval) => write!(out, "{}", interval.id)?,
                _ => out.write_str("null")?,
            }
            out.write_str(",\"timeEpoch\":")?;
            optional_u64(out, trace.outcome.time.map(|time| time.epoch))?;
            out.write_str(",\"startMs\":")?;
            optional_u64(out, trace.outcome.start_ms)?;
            out.write_str(",\"endMs\":")?;
            optional_u64(out, trace.outcome.end_ms)?;
            write!(
                out,
                ",\"coveredMs\":{},\"value\":",
                trace.outcome.covered_ms
            )?;
            match trace.outcome.value {
                Some(value) => write!(out, "{value}")?,
                None => out.write_str("null")?,
            }
            out.write_str(",\"fault\":")?;
            match trace.outcome.upstream_fault {
                Some(fault) => write!(out, "{}", crate::temporal_runtime::fault_code(fault))?,
                None => out.write_str("null")?,
            }
            out.write_str(",\"inputKind\":")?;
            text(
                out,
                match trace.input {
                    TrueForInput::Interval(_) => "interval",
                    TrueForInput::Unavailable(_) => "unavailable",
                    TrueForInput::NoObservation => "absent",
                },
            )?;
            if let TrueForInput::Interval(interval) = trace.input {
                write!(out,",\"intervalStartMs\":{},\"intervalEndMs\":{},\"intervalValue\":{},\"quality\":",interval.start_ms,interval.end_ms,interval.value)?;
                text(
                    out,
                    match interval.quality {
                        crate::temporal::EvidenceQuality::Measured => "Measured",
                        crate::temporal::EvidenceQuality::Held => "Held",
                        crate::temporal::EvidenceQuality::Constructed => "Constructed",
                    },
                )?;
            }
            out.write_char('}')?;
        }
        out.write_char(']')?;
    }
    Ok(())
}

fn optional_u64(out: &mut impl fmt::Write, value: Option<u64>) -> fmt::Result {
    match value {
        Some(value) => write!(out, "{value}"),
        None => out.write_str("null"),
    }
}
fn strings(out: &mut impl Write, items: &[String]) -> fmt::Result {
    out.write_char('[')?;
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.write_char(',')?;
        }
        text(out, item)?;
    }
    out.write_char(']')
}
fn safety(out: &mut impl Write, trace: &SafetyTrace) -> fmt::Result {
    out.write_str("{\"format\":\"GhostFlow/safety-trace-v1\",\"constraints\":[")?;
    for (index, c) in trace.constraints.iter().enumerate() {
        if index > 0 {
            out.write_char(',')?;
        }
        write!(out, "{{\"index\":{},\"kind\":", c.index)?;
        text(out, c.kind)?;
        out.write_str(",\"names\":")?;
        strings(out, &c.names)?;
        out.write_str(",\"firstViolation\":")?;
        if let Some(v) = &c.first_violation {
            write!(out, "{{\"round\":{},\"values\":", v.round)?;
            values(out, &v.values)?;
            out.write_str(",\"blocked\":")?;
            strings(out, &v.blocked)?;
            out.write_char('}')?;
        } else {
            out.write_str("null")?;
        }
        write!(
            out,
            ",\"final\":{{\"round\":{},\"values\":",
            c.final_evaluation.round
        )?;
        values(out, &c.final_evaluation.values)?;
        write!(out, ",\"satisfied\":{}}}}}", c.final_evaluation.satisfied)?;
    }
    out.write_str("]}")
}
fn point(out: &mut impl Write, p: &EvidencePoint) -> fmt::Result {
    match p.identity {
        EvidenceIdentity::Physical{source_tag,epoch,id} => write!(out,"{{\"sourceTag\":{source_tag},\"epoch\":{epoch},\"id\":{id},\"timestampMs\":{},\"value\":{}}}",p.timestamp_ms,p.value),
        EvidenceIdentity::Derived{site,time_epoch,revision} => write!(out,"{{\"kind\":\"derived\",\"site\":{site},\"timeEpoch\":{time_epoch},\"admissionRevision\":{revision},\"timestampMs\":{},\"evaluatedAtMs\":{},\"value\":{},\"proofRoot\":{}}}",p.timestamp_ms,p.evaluated_at_ms,p.value,p.proof_root.expect("derived point owns proof")),
    }
}
fn proof(out: &mut impl Write, p: &ProofNode) -> fmt::Result {
    match p.identity {
        EvidenceIdentity::Physical{source_tag,epoch,id} => write!(out,"{{\"kind\":\"physical\",\"sourceTag\":{source_tag},\"epoch\":{epoch},\"id\":{id}")?,
        EvidenceIdentity::Derived{site,time_epoch,revision} => write!(out,"{{\"kind\":\"derived\",\"site\":{site},\"timeEpoch\":{time_epoch},\"admissionRevision\":{revision},\"evaluatedAtMs\":{},\"operation\":\"{}\"",p.evaluated_at_ms,operation_name(p.operation.expect("derived proof operation")))?,
    }
    write!(out,",\"timestampMs\":{},\"value\":{},\"suppliedValue\":{},\"childCount\":{},\"subtreeSize\":{}}}",p.timestamp_ms,p.value,p.supplied_value,p.child_count,p.subtree_size)
}
fn window(out: &mut impl Write, w: &WindowTrace) -> fmt::Result {
    let o = w.outcome;
    let time = o.time.expect("committed temporal trace has time");
    write!(
        out,
        "{{\"site\":{},\"payloadType\":\"{}\",\"operation\":\"{}\",\"value\":",
        w.site,
        if w.payload_type == crate::Type::Int {
            "int"
        } else {
            "number"
        },
        operation_name(w.operation)
    )?;
    if let Some(v) = o.value {
        write!(out, "{v}")?;
    } else {
        out.write_str("null")?;
    }
    write!(out,",\"quality\":{},\"count\":{},\"admissionRevision\":{},\"timeEpoch\":{},\"nowMs\":{},\"first\":",if o.value.is_some(){3}else{0},o.count,o.revision,time.epoch,time.now_ms)?;
    if let Some(p) = o.first {
        point(out, &p)?;
    } else {
        out.write_str("null")?;
    }
    out.write_str(",\"last\":")?;
    if let Some(p) = o.last {
        point(out, &p)?;
    } else {
        out.write_str("null")?;
    }
    out.write_str(",\"contributors\":[")?;
    for (index, p) in w.contributors.iter().enumerate() {
        if index > 0 {
            out.write_char(',')?;
        }
        point(out, p)?;
    }
    out.write_str("],\"upstreamFault\":")?;
    if let Some(f) = o.upstream_fault {
        write!(
            out,
            "{{\"origin\":{},\"faultCode\":{}}}",
            f.origin,
            fault_code(f.fault)
        )?;
    } else {
        out.write_str("null")?;
    }
    if !w.proof.is_empty() {
        out.write_str(",\"proof\":[")?;
        for (index, p) in w.proof.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            proof(out, p)?;
        }
        out.write_char(']')?;
    }
    out.write_char('}')
}
pub(crate) fn record(out: &mut impl Write, r: &TickRecord) -> fmt::Result {
    write!(
        out,
        "{{\"tick\":{},\"module\":\"{:016x}\",\"strategy\":",
        r.tick, r.module_fingerprint
    )?;
    text(out, &r.strategy)?;
    for (name, map) in [
        ("inputs", &r.inputs),
        ("stateBefore", &r.state_before),
        ("stateAfter", &r.state_after),
        ("requested", &r.requested_intents),
        ("safe", &r.safe_intents),
    ] {
        write!(out, ",\"{name}\":")?;
        values(out, map)?;
    }
    out.write_str(",\"faults\":")?;
    strings(out, &r.faults)?;
    out.write_str(",\"safetyTrace\":")?;
    safety(out, &r.safety_trace)?;
    out.write_str(",\"resultTrace\":[")?;
    for (index, e) in r.result_trace.iter().enumerate() {
        if index > 0 {
            out.write_char(',')?;
        }
        write!(
            out,
            "{{\"site\":{},\"choice\":{},\"origin\":{}}}",
            e.site, e.choice, e.origin
        )?;
    }
    out.write_char(']')?;
    if !r.window_trace.is_empty() {
        out.write_str(",\"windowTrace\":[")?;
        for (index, w) in r.window_trace.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            window(out, w)?;
        }
        out.write_char(']')?;
    }
    certified_traces(out, r)?;
    context_traces(out, r)?;
    if !r.schedule_trace.is_empty() {
        out.write_str(",\"scheduleTrace\":[")?;
        for (index, trace) in r.schedule_trace.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            write!(
                out,
                "{{\"site\":{},\"due\":{},\"decision\":",
                trace.site, trace.due
            )?;
            text(out, &format!("{:?}", trace.decision))?;
            if let crate::schedule_clock::ClockProvenance::HeldClock { source_revision } =
                &trace.clock_provenance
            {
                out.write_str(",\"clockProvenance\":\"HeldClock\",\"clockSourceRevision\":")?;
                if let Some(revision) = source_revision {
                    text(out, revision)?;
                } else {
                    out.write_str("null")?;
                }
                out.write_str(",\"clockUncertaintyMs\":")?;
                optional_u64(out, trace.clock_uncertainty_ms)?;
            }
            if let Some(reason) = &trace.unknown_reason {
                out.write_str(",\"unknownReason\":")?;
                text(out, reason)?;
            }
            out.write_str(",\"observations\":[")?;
            for (index, row) in trace.observations.iter().enumerate() {
                if index > 0 {
                    out.write_char(',')?;
                }
                write!(out, "{{\"sourceDay\":{},\"occurrenceId\":", row.source_day,)?;
                if row.slot_key != 0 {
                    text(
                        out,
                        &format!(
                            "{}:{}:{}:{}",
                            trace.site, row.source_day, row.slot_key, row.fold
                        ),
                    )?;
                } else if row.fold == 0 {
                    text(out, &format!("{}:{}", trace.site, row.source_day))?;
                } else {
                    text(
                        out,
                        &format!("{}:{}:{}", trace.site, row.source_day, row.fold),
                    )?;
                }
                write!(
                    out,
                    ",\"slotKey\":{},\"minuteOfDay\":{},\"fold\":{}",
                    row.slot_key, row.minute_of_day, row.fold
                )?;
                out.write_str(",\"scheduledWallMs\":")?;
                optional_u64(out, row.scheduled_wall_ms)?;
                if row.fallback {
                    out.write_str(",\"fallback\":true")?;
                }
                if let Some(reason) = row.unavailable_reason {
                    write!(out, ",\"unavailableReason\":{}", reason)?;
                }
                out.write_str(",\"decision\":")?;
                text(out, &format!("{:?}", row.decision))?;
                out.write_str(",\"providerRevision\":")?;
                text(out, &row.provider_revision)?;
                out.write_str(",\"contextRevision\":")?;
                text(out, &row.context_revision)?;
                out.write_char('}')?;
            }
            out.write_str("]}")?;
        }
        out.write_char(']')?;
    }
    out.write_char('}')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_writer_preserves_escaped_schema_and_propagates_sink_failure() {
        let r = TickRecord {
            module_fingerprint: 1,
            tick: 2,
            strategy: "λ\"\\\n\u{1}".into(),
            inputs: NamedValues::from([("x".into(), Value::Int(-2))]),
            state_before: NamedValues::new(),
            state_after: NamedValues::new(),
            requested_intents: NamedValues::new(),
            safe_intents: NamedValues::new(),
            faults: vec!["🙂\t\r".into()],
            safety_trace: SafetyTrace {
                constraints: vec![],
            },
            result_trace: vec![crate::ResultTraceEvent {
                site: 3,
                choice: 2,
                origin: 1,
            }],
            window_trace: vec![],
            true_for_trace: vec![],
            schedule_trace: vec![],
            context_trace: vec![],
        };
        assert_eq!(r.to_json(),concat!(
            "{\"tick\":2,\"module\":\"0000000000000001\",\"strategy\":\"λ\\\"\\\\\\n\\u0001\",",
            "\"inputs\":{\"x\":-2},\"stateBefore\":{},\"stateAfter\":{},\"requested\":{},\"safe\":{},",
            "\"faults\":[\"🙂\\t\\r\"],\"safetyTrace\":{\"format\":\"GhostFlow/safety-trace-v1\",\"constraints\":[]},",
            "\"resultTrace\":[{\"site\":3,\"choice\":2,\"origin\":1}]}"));
        struct Reject;
        impl Write for Reject {
            fn write_str(&mut self, _: &str) -> fmt::Result {
                Err(fmt::Error)
            }
        }
        assert!(r.write_json(&mut Reject).is_err());
    }
}
