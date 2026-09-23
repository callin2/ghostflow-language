use ghostflow_core::{scan::ScanOutcomeV1, TickRecord};
pub fn resource_plan(
    report: &ghostflow_core::temporal_runtime::TemporalResourceReport,
    old_capacity: usize,
    max_bytes: usize,
) -> Result<String, String> {
    bounded(old_capacity, max_bytes, |sink| report.write_json(sink))
}
pub fn replay_plan(
    report: &ghostflow_core::temporal_runtime::TemporalReplayResourceReport,
    old_capacity: usize,
    max_bytes: usize,
) -> Result<String, String> {
    bounded(old_capacity, max_bytes, |sink| report.write_json(sink))
}
use std::fmt::{self, Write};

// Output storage is separate from the temporal arena budget. Count escaped UTF-8
// first, then allocate once. No per-record or per-proof JSON String is created.
struct Sink {
    output: Option<String>,
    length: usize,
    limit: usize,
}
impl Write for Sink {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        let end = self
            .length
            .checked_add(value.len())
            .filter(|n| *n <= self.limit)
            .ok_or(fmt::Error)?;
        if let Some(output) = &mut self.output {
            output.push_str(value);
        }
        self.length = end;
        Ok(())
    }
}
fn bounded(
    old_capacity: usize,
    max_bytes: usize,
    write: impl Fn(&mut Sink) -> fmt::Result,
) -> Result<String, String> {
    let limit = max_bytes
        .checked_sub(old_capacity)
        .ok_or("temporal replay JSON budget exceeded")?;
    let mut count = Sink {
        output: None,
        length: 0,
        limit,
    };
    write(&mut count).map_err(|_| "temporal replay JSON budget exceeded")?;
    let mut output = String::new();
    output
        .try_reserve_exact(count.length)
        .map_err(|_| "temporal replay JSON allocation failed")?;
    if output.capacity() > limit {
        return Err("temporal replay JSON budget exceeded".into());
    }
    let mut sink = Sink {
        output: Some(output),
        length: 0,
        limit: count.length,
    };
    write(&mut sink).map_err(|_| "temporal replay JSON budget exceeded")?;
    Ok(sink.output.expect("allocated output sink"))
}
pub fn legacy(
    records: &[TickRecord],
    old_capacity: usize,
    max_bytes: usize,
) -> Result<String, String> {
    bounded(old_capacity, max_bytes, |out| {
        write!(out,"{{\"format\":\"GhostFlow/temporal-replay-v1\",\"mode\":\"legacy\",\"checkpointTick\":{},\"records\":[",records.first().expect("positive replay count").tick-1)?;
        for (index, record) in records.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            record.write_json(out)?;
        }
        out.write_str("]}")
    })
}
pub fn framed(
    records: &[ScanOutcomeV1],
    old_capacity: usize,
    max_bytes: usize,
) -> Result<String, String> {
    bounded(old_capacity, max_bytes, |out| {
        write!(out,"{{\"format\":\"GhostFlow/temporal-replay-v1\",\"mode\":\"framed\",\"checkpointTick\":{},\"records\":[",records.first().expect("positive replay count").trace.tick-1)?;
        for (index, record) in records.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            write!(out,"{{\"format\":\"GhostFlow/scan-outcome-v1\",\"scanId\":{},\"logicalTimeMs\":{},\"trace\":",record.scan_id,record.logical_time_ms)?;
            record.trace.write_json(out)?;
            out.write_char('}')?;
        }
        out.write_str("]}")
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn profile_packet() -> Vec<u8> {
        let mut b = b"GFTA".to_vec();
        b.extend(1_u16.to_le_bytes());
        b.extend(1_u16.to_le_bytes());
        b.extend(7_u64.to_le_bytes());
        b.extend(4_u32.to_le_bytes());
        b.extend(4_000_000_u32.to_le_bytes());
        b.extend(11_u32.to_le_bytes());
        b.extend(4_u32.to_le_bytes());
        b.extend(1000_u64.to_le_bytes());
        b
    }
    pub(crate) fn configured_runtime() -> ghostflow_core::Runtime {
        fn s(b: &mut Vec<u8>, v: &str) {
            b.extend((v.len() as u16).to_le_bytes());
            b.extend(v.as_bytes());
        }
        fn blob(b: &mut Vec<u8>, v: &[u8]) {
            b.extend((v.len() as u32).to_le_bytes());
            b.extend(v);
        }
        let mut b = b"GFB1".to_vec();
        b.extend(4_u16.to_le_bytes());
        s(&mut b, "replay");
        b.extend(1_u32.to_le_bytes());
        b.extend(7_u16.to_le_bytes());
        for (name, kind) in [
            ("__gf_now_ms", 2),
            ("__gf_time_epoch", 2),
            ("present", 1),
            ("epoch", 2),
            ("id", 2),
            ("timestamp", 2),
            ("value", 2),
        ] {
            s(&mut b, name);
            b.push(kind);
        }
        b.extend(0_u16.to_le_bytes()); // states
        b.extend(0_u16.to_le_bytes());
        b.extend(1_u16.to_le_bytes()); // clocks
        b.extend(1_u16.to_le_bytes());
        b.extend(11_u32.to_le_bytes());
        s(&mut b, "root");
        for i in 2_u16..6 {
            b.extend(i.to_le_bytes());
        }
        b.extend(1_u16.to_le_bytes());
        s(&mut b, "main");
        b.extend(0_i32.to_le_bytes());
        blob(&mut b, &[5, 1]);
        b.extend(1_u16.to_le_bytes());
        b.extend(101_u32.to_le_bytes());
        s(&mut b, "mean");
        b.extend([0, 2]);
        b.extend(1000_u64.to_le_bytes());
        b.extend(500_u64.to_le_bytes());
        b.extend(1_u16.to_le_bytes());
        b.extend(0_u16.to_le_bytes());
        for expression in [&[1, 1][..], &[3, 6, 0], &[35], &[43], &[33], &[43]] {
            blob(&mut b, expression);
        }
        b.extend(0_u16.to_le_bytes());
        b.extend(1_u16.to_le_bytes());
        s(&mut b, "mean");
        b.push(2);
        blob(&mut b, &[57, 0, 0, 1]);
        b.extend(0_u16.to_le_bytes());
        let mut runtime = ghostflow_core::Runtime::new(2);
        runtime.install(ghostflow_core::Module::load(&b).unwrap(), false);
        runtime
    }
    pub(crate) fn active_runtime() -> ghostflow_core::Runtime {
        let mut runtime = configured_runtime();
        let packet = profile_packet();
        runtime
            .activate_with_temporal(
                &unsafe { crate::temporal_abi::from_raw(packet.as_ptr(), packet.len()) }.unwrap(),
            )
            .unwrap();
        runtime
    }
    pub(crate) fn submit(runtime: &mut ghostflow_core::Runtime, now: u64, id: u64, value: f64) {
        use ghostflow_core::Value;
        for (name, value) in [
            ("__gf_now_ms", now as f64),
            ("__gf_time_epoch", 7.0),
            ("epoch", 1.0),
            ("id", id as f64),
            ("timestamp", now as f64),
            ("value", value),
        ] {
            runtime.set_input(name, Value::Number(value)).unwrap();
        }
        runtime.set_input("present", Value::Bool(true)).unwrap();
    }
    #[test]
    fn output_budget_counts_utf8_and_retained_capacity_before_allocating() {
        let emit = |sink: &mut Sink| sink.write_str("λ🙂\\\"");
        let first = bounded(0, 8, emit).unwrap();
        assert_eq!(first.len(), 8);
        assert_eq!(
            bounded(0, 7, emit).unwrap_err(),
            "temporal replay JSON budget exceeded"
        );
        assert_eq!(
            bounded(first.capacity(), first.capacity() + 7, emit).unwrap_err(),
            "temporal replay JSON budget exceeded"
        );
        assert_eq!(
            bounded(first.capacity(), first.capacity() + 8, emit).unwrap(),
            first
        );
        assert_eq!(
            bounded(usize::MAX, 0, emit).unwrap_err(),
            "temporal replay JSON budget exceeded"
        );
    }
}
