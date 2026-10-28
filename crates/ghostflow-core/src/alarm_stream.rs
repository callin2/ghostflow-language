//! Alarm-only observation owner. Source provenance is validated by the canonical
//! compiler; the pinned packet joins that validation to the actual loaded bytes.
use crate::scan::SCAN_FRAME_V1_MAX_EXACT_INTEGER as MAX_SEQUENCE;
use crate::{trace_json::text, Error, Module, NamedValues, Reader, Result, Type, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, VecDeque},
    fmt::Write,
};

pub(crate) fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id(value: &str) -> bool {
    value.len() <= 128
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
        && !value.starts_with("__gf_")
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn wire_text(reader: &mut Reader<'_>) -> Result<String> {
    let len = reader.u16()? as usize;
    if len == 0 || len > 512 {
        return Err(Error::new("alarm text bound"));
    }
    String::from_utf8(reader.take(len)?.to_vec()).map_err(|_| Error::new("alarm UTF-8"))
}
fn optional(out: &mut String, value: Option<u64>) {
    match value {
        Some(value) => write!(out, "{value}").unwrap(),
        None => out.push_str("null"),
    }
}

struct Alarm {
    id: String,
    state: String,
    node: u32,
    anchors: Vec<String>,
    active: Option<bool>,
    episode: Option<u64>,
    last_sequence: Option<u64>,
}
struct Event {
    alarm: usize,
    sequence: u64,
    episode: u64,
    raised: bool,
    scan: u64,
    time: u64,
}

pub struct AlarmStream {
    binding_sha256: String,
    identities: [String; 10],
    alarms: Vec<Alarm>,
    events: VecDeque<Event>,
    capacity: usize,
    next_sequence: u64,
    last_scan: Option<u64>,
    last_time: Option<u64>,
}
impl AlarmStream {
    pub(crate) fn activate(module: &Module, packet: &[u8], expected_sha256: &str) -> Result<Self> {
        if packet.len() > 65536
            || !digest(expected_sha256)
            || hex(&sha256(packet)) != expected_sha256
        {
            return Err(Error::new("alarm binding digest mismatch or byte bound"));
        }
        if !matches!(module.format_version, 1..=4) {
            return Err(Error::new("alarm v1 requires scalar scan profile"));
        }
        let mut reader = Reader::new(packet);
        if reader.take(4)? != b"GFAL" || reader.u16()? != 1 {
            return Err(Error::new("alarm binding format"));
        }
        let mut identities: [String; 10] = Default::default();
        for value in &mut identities {
            *value = wire_text(&mut reader)?;
        }
        for index in [0, 3, 6, 7] {
            if !digest(&identities[index]) {
                return Err(Error::new("alarm identity digest"));
            }
        }
        if identities[0] != hex(&module.bytecode_sha256)
            || identities[1] != format!("{:016x}", module.fingerprint)
            || identities[2] != module.name
        {
            return Err(Error::new("alarm module identity mismatch"));
        }
        if !id(&identities[8]) || !id(&identities[9]) {
            return Err(Error::new("alarm run or stream identity"));
        }
        let capacity = reader.u16()? as usize;
        let count = reader.u16()? as usize;
        if !(1..=1024).contains(&capacity) || !(1..=16).contains(&count) {
            return Err(Error::new("alarm capacity or descriptor bound"));
        }
        let mut alarms = Vec::with_capacity(count);
        let mut ids = BTreeSet::new();
        let mut states = BTreeSet::new();
        for _ in 0..count {
            let alarm_id = wire_text(&mut reader)?;
            let state = wire_text(&mut reader)?;
            if !id(&alarm_id)
                || !ids.insert(alarm_id.clone())
                || !states.insert(state.clone())
                || !module
                    .states
                    .iter()
                    .any(|field| field.name == state && field.value_type == Type::Bool)
            {
                return Err(Error::new("alarm ID or existing Bool state mismatch"));
            }
            let node = reader.u32()?;
            let count = reader.u16()? as usize;
            if count == 0 || count > 32 {
                return Err(Error::new("alarm intent anchor bound"));
            }
            let mut anchors = Vec::with_capacity(count);
            for _ in 0..count {
                let anchor = wire_text(&mut reader)?;
                if anchors.contains(&anchor) {
                    return Err(Error::new("duplicate alarm intent anchor"));
                }
                anchors.push(anchor);
            }
            alarms.push(Alarm {
                id: alarm_id,
                state,
                node,
                anchors,
                active: None,
                episode: None,
                last_sequence: None,
            });
        }
        if !reader.finished() {
            return Err(Error::new("trailing alarm binding bytes"));
        }
        Ok(Self {
            binding_sha256: expected_sha256.into(),
            identities,
            alarms,
            events: VecDeque::with_capacity(capacity),
            capacity,
            next_sequence: 0,
            last_scan: None,
            last_time: None,
        })
    }
    pub(crate) fn preflight(&self) -> Result<()> {
        if self.next_sequence > MAX_SEQUENCE - self.alarms.len() as u64 {
            return Err(Error::new("alarm sequence exhausted; fresh run required"));
        }
        Ok(())
    }
    pub(crate) fn observe(&mut self, scan: u64, time: u64, values: &NamedValues) {
        for (index, alarm) in self.alarms.iter_mut().enumerate() {
            let active = match values.get(&alarm.state) {
                Some(Value::Bool(value)) => *value,
                _ => unreachable!("activated Bool state retained by scalar runtime"),
            };
            let changed = match alarm.active {
                None => active,
                Some(previous) => previous != active,
            };
            if changed {
                let sequence = self.next_sequence;
                self.next_sequence += 1;
                if active {
                    alarm.episode = Some(sequence);
                }
                alarm.last_sequence = Some(sequence);
                if self.events.len() == self.capacity {
                    self.events.pop_front();
                }
                self.events.push_back(Event {
                    alarm: index,
                    sequence,
                    episode: alarm.episode.expect("clear follows raise"),
                    raised: active,
                    scan,
                    time,
                });
            }
            alarm.active = Some(active);
        }
        self.last_scan = Some(scan);
        self.last_time = Some(time);
    }
    pub(crate) fn query(&self, packet: &[u8]) -> Result<String> {
        if packet.len() > 2048 {
            return Err(Error::new("alarm query byte bound"));
        }
        let mut reader = Reader::new(packet);
        if reader.take(4)? != b"GFAQ" || reader.u16()? != 1 {
            return Err(Error::new("alarm query format"));
        }
        if wire_text(&mut reader)? != self.binding_sha256
            || wire_text(&mut reader)? != self.identities[8]
            || wire_text(&mut reader)? != self.identities[9]
        {
            return Err(Error::new("stale alarm cursor identity"));
        }
        let after = match reader.u8()? {
            0 => None,
            1 => Some(reader.u64()?),
            _ => return Err(Error::new("alarm query cursor tag")),
        };
        if !reader.finished()
            || after.is_some_and(|value| value >= self.next_sequence || value > MAX_SEQUENCE)
        {
            return Err(Error::new("invalid or ahead alarm cursor"));
        }
        Ok(self.report(after))
    }
    fn report(&self, after: Option<u64>) -> String {
        let mut out =
            String::from("{\"format\":\"GhostFlow/alarm-report-v1\",\"version\":1,\"context\":{");
        for (index, key) in [
            "bytecodeSha256",
            "moduleFingerprint",
            "moduleId",
            "sourceSha256",
            "documentId",
            "revisionId",
            "schemaSha256",
            "descriptorSha256",
            "runId",
            "streamId",
        ]
        .iter()
        .enumerate()
        {
            if index > 0 {
                out.push(',');
            }
            text(&mut out, key).unwrap();
            out.push(':');
            text(&mut out, &self.identities[index]).unwrap();
        }
        out.push_str(",\"bindingSha256\":");
        text(&mut out, &self.binding_sha256).unwrap();
        out.push_str("},\"cursor\":{\"bindingSha256\":");
        text(&mut out, &self.binding_sha256).unwrap();
        out.push_str(",\"runId\":");
        text(&mut out, &self.identities[8]).unwrap();
        out.push_str(",\"streamId\":");
        text(&mut out, &self.identities[9]).unwrap();
        out.push_str(",\"sequence\":");
        optional(&mut out, self.next_sequence.checked_sub(1));
        out.push_str("},\"current\":{\"scanId\":");
        optional(&mut out, self.last_scan);
        out.push_str(",\"logicalTimeMs\":");
        optional(&mut out, self.last_time);
        out.push_str(",\"alarms\":[");
        for (index, alarm) in self.alarms.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push('{');
            self.alarm_identity(&mut out, alarm);
            out.push_str(",\"state\":");
            text(
                &mut out,
                match alarm.active {
                    None => "unobserved",
                    Some(false) => "inactive",
                    Some(true) => "active",
                },
            )
            .unwrap();
            out.push_str(",\"episodeSequence\":");
            optional(&mut out, alarm.episode);
            out.push_str(",\"lastSequence\":");
            optional(&mut out, alarm.last_sequence);
            out.push('}');
        }
        let oldest = self.events.front().map(|event| event.sequence);
        out.push_str("]},\"coverage\":{\"capacity\":");
        write!(out, "{}", self.capacity).unwrap();
        out.push_str(",\"oldestSequence\":");
        optional(&mut out, oldest);
        out.push_str(",\"latestSequence\":");
        optional(&mut out, self.next_sequence.checked_sub(1));
        out.push_str(",\"gap\":");
        let requested = after.map_or(0, |value| value + 1);
        if let Some(oldest) = oldest.filter(|oldest| *oldest > requested) {
            write!(out,"{{\"reason\":\"retention-overflow\",\"fromSequence\":{requested},\"toSequence\":{}}}",oldest-1).unwrap();
        } else {
            out.push_str("null");
        }
        out.push_str("},\"events\":[");
        for (index, event) in self
            .events
            .iter()
            .filter(|event| after.is_none_or(|after| event.sequence > after))
            .enumerate()
        {
            if index > 0 {
                out.push(',');
            }
            out.push('{');
            self.alarm_identity(&mut out, &self.alarms[event.alarm]);
            write!(out,",\"sequence\":{},\"episodeSequence\":{},\"transition\":\"{}\",\"scanId\":{},\"logicalTimeMs\":{} }}",event.sequence,event.episode,if event.raised {"raised"} else {"cleared"},event.scan,event.time).unwrap();
        }
        out.push_str("]}");
        out
    }
    fn alarm_identity(&self, out: &mut String, alarm: &Alarm) {
        out.push_str("\"alarmId\":");
        text(out, &alarm.id).unwrap();
        out.push_str(",\"stateDescriptorId\":");
        text(out, &format!("state.{}", alarm.state)).unwrap();
        write!(
            out,
            ",\"sourceNodeId\":{},\"intentAnchorIds\":[",
            alarm.node
        )
        .unwrap();
        for (index, anchor) in alarm.anchors.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            text(out, anchor).unwrap();
        }
        out.push(']');
    }
}
