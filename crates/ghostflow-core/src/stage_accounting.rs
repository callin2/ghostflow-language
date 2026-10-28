//! Scan-owned Bool usage. Physical evidence remains in the applied ledger.
use crate::{Error, Module, Reader, Result, TickRecord, Type, Value};

const MAX_ACCOUNTS: usize = 32;
const MAX_SEGMENTS: usize = 4096;
const MAX_RUNS: usize = 32;
const MAX_BYTES: usize = 512 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Requested,
    Safe,
    Applied,
    Confirmed,
}

impl Stage {
    fn read(reader: &mut Reader<'_>) -> Result<Self> {
        match reader.u8()? {
            0 => Ok(Self::Requested),
            1 => Ok(Self::Safe),
            2 => Ok(Self::Applied),
            3 => Ok(Self::Confirmed),
            _ => Err(Error::new("unknown accounting stage")),
        }
    }
    fn physical(self) -> bool {
        matches!(self, Self::Applied | Self::Confirmed)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Binding {
    account: String,
    resource: String,
    output: String,
    stage: Stage,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Segment {
    run: usize,
    start: u64,
    end: u64,
    values: Vec<Option<bool>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UsageRead {
    Known(u64),
    Unknown(&'static str),
}

impl UsageRead {
    pub fn to_json(&self) -> String {
        match self {
            Self::Known(value) => format!("{{\"kind\":\"Known\",\"usedMs\":\"{value}\"}}"),
            Self::Unknown(reason) => format!("{{\"kind\":\"Unknown\",\"reason\":\"{reason}\"}}"),
        }
    }
}

pub(crate) struct StageAccounting {
    identity: Vec<u8>,
    fingerprint: u64,
    bindings: Vec<Binding>,
    capacity: usize,
    runs: Vec<String>,
    segments: Vec<Segment>,
    previous: Option<(u64, Vec<Option<bool>>)>,
    fault: Option<&'static str>,
    revision: u64,
    persisted_revision: Option<u64>,
}

impl StageAccounting {
    pub(crate) fn activate(module: &Module, bytes: &[u8]) -> Result<Self> {
        if bytes.len() > 16_384 {
            return Err(Error::new("stage accounting activation byte bound"));
        }
        let mut reader = Reader::new(bytes);
        if reader.take(4)? != b"GSA1" {
            return Err(Error::new("invalid stage accounting activation"));
        }
        let fingerprint = reader.u64()?;
        if fingerprint != module.fingerprint {
            return Err(Error::new("stage accounting module mismatch"));
        }
        if reader.take(32)?.iter().all(|b| *b == 0) {
            return Err(Error::new("stage accounting source identity missing"));
        }
        let capacity = reader.u16()? as usize;
        if capacity == 0 || capacity > MAX_SEGMENTS {
            return Err(Error::new("stage accounting capacity bound"));
        }
        let count = reader.u8()? as usize;
        if count == 0 || count > MAX_ACCOUNTS {
            return Err(Error::new("stage accounting account bound"));
        }
        let mut bindings: Vec<Binding> = Vec::new();
        for _ in 0..count {
            let binding = Binding {
                account: reader.string()?,
                resource: reader.string()?,
                output: reader.string()?,
                stage: Stage::read(&mut reader)?,
            };
            if !module
                .output_fields()
                .any(|(name, ty)| name == binding.output && ty == Type::Bool)
                || bindings.iter().any(|b| {
                    b.account == binding.account
                        || b.resource == binding.resource && b.output != binding.output
                })
            {
                return Err(Error::new(
                    "invalid stage accounting output or account binding",
                ));
            }
            bindings.push(binding);
        }
        let identity = bytes[..reader.at].to_vec();
        let run = reader.string()?;
        if !reader.finished() {
            return Err(Error::new("trailing stage accounting activation bytes"));
        }
        Ok(Self {
            identity,
            fingerprint,
            bindings,
            capacity,
            runs: vec![run],
            segments: Vec::new(),
            previous: None,
            fault: None,
            revision: 0,
            persisted_revision: None,
        })
    }

    pub(crate) fn observe(&mut self, at: u64, trace: &TickRecord) {
        self.advance_revision();
        if self.fault.is_some() {
            return;
        }
        if trace.module_fingerprint != self.fingerprint {
            self.fault = Some("IdentityMismatch");
            return;
        }
        let mut values = Vec::with_capacity(self.bindings.len());
        for binding in &self.bindings {
            if binding.stage.physical() {
                values.push(None);
                continue;
            }
            let fields = if binding.stage == Stage::Requested {
                &trace.requested_intents
            } else {
                &trace.safe_intents
            };
            match fields.get(&binding.output) {
                Some(Value::Bool(value)) => values.push(Some(*value)),
                _ => {
                    self.fault = Some("CoverageMissing");
                    return;
                }
            }
        }
        let run = self.runs.len() - 1;
        let (start, interval_values) = self
            .previous
            .as_ref()
            .map(|(start, values)| (*start, values.clone()))
            .unwrap_or((at, values.clone()));
        if at < start {
            self.fault = Some("ClockReversed");
            return;
        }
        let merge = self.segments.last_mut().filter(|segment| {
            segment.run == run && segment.end == start && segment.values == interval_values
        });
        if let Some(segment) = merge {
            segment.end = at;
        } else if self.segments.len() < self.capacity {
            self.segments.push(Segment {
                run,
                start,
                end: at,
                values: interval_values,
            });
        } else {
            self.fault = Some("Capacity");
            self.previous = None;
            return;
        }
        self.previous = Some((at, values));
    }

    pub(crate) fn gap(&mut self) {
        self.previous = None;
        self.advance_revision();
    }

    fn advance_revision(&mut self) {
        if let Some(next) = self.revision.checked_add(1) {
            self.revision = next;
        } else {
            self.fault = Some("RevisionOverflow");
            self.persisted_revision = None;
        }
    }

    pub(crate) fn query(
        &self,
        account: &str,
        run: &str,
        start: u64,
        end: u64,
    ) -> Result<UsageRead> {
        if start > end {
            return Err(Error::new("stage accounting reversed query interval"));
        }
        let slot = self
            .bindings
            .iter()
            .position(|binding| binding.account == account)
            .ok_or_else(|| Error::new("unknown stage accounting account"))?;
        let run = self
            .runs
            .iter()
            .position(|value| value == run)
            .ok_or_else(|| Error::new("unknown stage accounting run"))?;
        match self.bindings[slot].stage {
            Stage::Applied => return Ok(UsageRead::Unknown("NoReceipt")),
            Stage::Confirmed => return Ok(UsageRead::Unknown("NoFeedback")),
            _ => (),
        }
        if let Some(fault) = self.fault {
            return Ok(UsageRead::Unknown(fault));
        }
        if self.persisted_revision != Some(self.revision) {
            return Ok(UsageRead::Unknown("PersistencePending"));
        }
        let mut cursor = start;
        let mut observed = false;
        let mut used = 0u64;
        for segment in self.segments.iter().filter(|segment| segment.run == run) {
            if segment.end < cursor || segment.start > end {
                continue;
            }
            if segment.start > cursor {
                return Ok(UsageRead::Unknown("CoverageMissing"));
            }
            observed = true;
            let stop = segment.end.min(end);
            if segment.values[slot] == Some(true) {
                used = used
                    .checked_add(stop - cursor)
                    .ok_or_else(|| Error::new("stage accounting duration overflow"))?;
            }
            cursor = stop;
            if cursor == end {
                return Ok(UsageRead::Known(used));
            }
        }
        Ok(if observed && cursor == end {
            UsageRead::Known(used)
        } else {
            UsageRead::Unknown("CoverageMissing")
        })
    }

    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn acknowledge(&mut self, revision: u64) -> Result<()> {
        if revision != self.revision {
            return Err(Error::new("stale stage accounting persistence revision"));
        }
        self.persisted_revision = Some(revision);
        Ok(())
    }

    pub(crate) fn snapshot(&self) -> Vec<u8> {
        let mut bytes = b"GSS1".to_vec();
        bytes.extend((self.identity.len() as u32).to_le_bytes());
        bytes.extend(&self.identity);
        bytes.push(match self.fault {
            None => 0,
            Some("Capacity") => 1,
            Some(_) => 2,
        });
        bytes.push(self.runs.len() as u8);
        for run in &self.runs {
            text(&mut bytes, run);
        }
        bytes.extend((self.segments.len() as u16).to_le_bytes());
        for segment in &self.segments {
            bytes.push(segment.run as u8);
            bytes.extend(segment.start.to_le_bytes());
            bytes.extend(segment.end.to_le_bytes());
            for value in &segment.values {
                bytes.push(match value {
                    None => 0,
                    Some(false) => 1,
                    Some(true) => 2,
                });
            }
        }
        let checksum = checksum(&bytes);
        bytes.extend(checksum.to_le_bytes());
        bytes
    }

    pub(crate) fn restore(&mut self, bytes: &[u8]) -> Result<()> {
        let result = self.decode_snapshot(bytes);
        match result {
            Ok((runs, segments, fault)) => {
                self.runs = runs;
                self.segments = segments;
                self.fault = fault;
                self.previous = None;
                self.revision = 0;
                self.persisted_revision = Some(0);
                Ok(())
            }
            Err(error) => {
                self.fault = Some("SnapshotInvalid");
                self.previous = None;
                Err(error)
            }
        }
    }

    fn decode_snapshot(
        &self,
        bytes: &[u8],
    ) -> Result<(Vec<String>, Vec<Segment>, Option<&'static str>)> {
        if self.revision != 0 || self.runs.len() != 1 || bytes.len() < 12 || bytes.len() > MAX_BYTES
        {
            return Err(Error::new(
                "stage accounting restore requires a fresh bounded owner",
            ));
        }
        let payload = &bytes[..bytes.len() - 8];
        if checksum(payload) != u64::from_le_bytes(bytes[bytes.len() - 8..].try_into().unwrap()) {
            return Err(Error::new("stage accounting snapshot checksum mismatch"));
        }
        let mut reader = Reader::new(payload);
        if reader.take(4)? != b"GSS1" {
            return Err(Error::new("invalid stage accounting snapshot"));
        }
        let length = reader.u32()? as usize;
        if reader.take(length)? != self.identity {
            return Err(Error::new("stage accounting snapshot binding mismatch"));
        }
        let fault = match reader.u8()? {
            0 => None,
            1 => Some("Capacity"),
            2 => Some("CoverageMissing"),
            _ => return Err(Error::new("invalid stage accounting snapshot fault")),
        };
        let count = reader.u8()? as usize;
        if count == 0 || count >= MAX_RUNS {
            return Err(Error::new("stage accounting snapshot run bound"));
        }
        let mut runs = Vec::new();
        for _ in 0..count {
            let run = reader.string()?;
            if runs.contains(&run) || self.runs.contains(&run) {
                return Err(Error::new(
                    "stage accounting restore requires a fresh run identity",
                ));
            }
            runs.push(run);
        }
        let count = reader.u16()? as usize;
        if count > self.capacity {
            return Err(Error::new("stage accounting snapshot segment bound"));
        }
        let mut segments: Vec<Segment> = Vec::new();
        for _ in 0..count {
            let run = reader.u8()? as usize;
            let start = reader.u64()?;
            let end = reader.u64()?;
            if run >= runs.len()
                || start > end
                || end > crate::scan::SCAN_FRAME_V1_MAX_EXACT_INTEGER
                || segments
                    .last()
                    .is_some_and(|last| run < last.run || run == last.run && start < last.end)
            {
                return Err(Error::new("invalid stage accounting snapshot interval"));
            }
            let mut values = Vec::new();
            for binding in &self.bindings {
                let value = match reader.u8()? {
                    0 => None,
                    1 => Some(false),
                    2 => Some(true),
                    _ => return Err(Error::new("invalid stage accounting snapshot value")),
                };
                if value.is_none() != binding.stage.physical() {
                    return Err(Error::new(
                        "stage accounting snapshot evidence kind mismatch",
                    ));
                }
                values.push(value);
            }
            segments.push(Segment {
                run,
                start,
                end,
                values,
            });
        }
        if !reader.finished() {
            return Err(Error::new("trailing stage accounting snapshot bytes"));
        }
        runs.push(self.runs[0].clone());
        Ok((runs, segments, fault))
    }
}

fn text(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend((value.len() as u16).to_le_bytes());
    bytes.extend(value.as_bytes());
}
fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}
