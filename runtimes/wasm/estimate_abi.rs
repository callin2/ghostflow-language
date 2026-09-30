//! GFEE v1 transport. Shared verbatim by native conformance and WASM.
use ghostflow_core::{estimate_evidence::*, signals::SensorFault};
use std::fmt::Write;

// Evaluation header/context/time/coverage + 64 exact-origin records. Config is smaller.
pub const MAX_PACKET: usize = 298 + MAX_HISTORY * 146;
pub struct Handle {
    session: Session,
    snapshot: String,
    error: String,
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self.at.checked_add(n).ok_or("packet overflow")?;
        let value = self
            .bytes
            .get(self.at..end)
            .ok_or("truncated estimate packet")?;
        self.at = end;
        Ok(value)
    }
    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn flag(&mut self) -> Result<bool, String> {
        match self.byte()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err("invalid flag".into()),
        }
    }
    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| "integer length")?,
        ))
    }
    fn digest(&mut self) -> Result<[u8; 32], String> {
        self.take(32)?
            .try_into()
            .map_err(|_| "digest length".into())
    }
    fn context(&mut self) -> Result<Context, String> {
        let mut identities = [[0; 32]; 7];
        for d in &mut identities {
            *d = self.digest()?;
        }
        Ok(Context {
            identities,
            run: self.u64()?,
            time_epoch: self.u64()?,
            source_epoch: self.u64()?,
        })
    }
    fn origin(&mut self) -> Result<ExecutionOrigin, String> {
        Ok(ExecutionOrigin {
            boot: self.digest()?,
            program: self.digest()?,
            binding: self.digest()?,
            run: self.u64()?,
            time_epoch: self.u64()?,
            source_epoch: self.u64()?,
        })
    }
    fn finish(self) -> Result<(), String> {
        if self.at == self.bytes.len() {
            Ok(())
        } else {
            Err("trailing estimate packet bytes".into())
        }
    }
}
fn reader(bytes: &[u8], kind: u8) -> Result<Reader<'_>, String> {
    if bytes.len() > MAX_PACKET {
        return Err("estimate packet capacity".into());
    }
    let mut r = Reader { bytes, at: 0 };
    if r.take(4)? != b"GFEE" || r.byte()? != 1 || r.byte()? != kind {
        return Err("estimate packet header".into());
    }
    Ok(r)
}
fn fault(code: u8) -> Result<Option<SensorFault>, String> {
    Ok(match code {
        0 => None,
        1 => Some(SensorFault::NotReady),
        2 => Some(SensorFault::Disconnected),
        3 => Some(SensorFault::Stale),
        4 => Some(SensorFault::Invalid),
        5 => Some(SensorFault::SourceChanged),
        6 => Some(SensorFault::ClockBackward),
        7 => Some(SensorFault::FutureTimestamp),
        _ => return Err("invalid source fault".into()),
    })
}
fn context_json(c: Context) -> String {
    let digests: Vec<_> = c
        .identities
        .iter()
        .map(|d| format!("\"{}\"", hex(d)))
        .collect();
    format!(
        "{{\"identities\":[{}],\"run\":\"{}\",\"timeEpoch\":\"{}\",\"sourceEpoch\":\"{}\"}}",
        digests.join(","),
        c.run,
        c.time_epoch,
        c.source_epoch
    )
}
fn hex(bytes: &[u8]) -> String {
    let mut s = String::new();
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}
impl Handle {
    pub fn new(bytes: &[u8]) -> Result<Self, String> {
        let mut r = reader(bytes, 0)?;
        let basis = match r.byte()? {
            0 => Basis::Requested,
            1 => Basis::AcknowledgedWrites,
            _ => return Err("invalid basis".into()),
        };
        let capacity = usize::from(r.byte()?);
        let reference = if r.flag()? {
            let context = r.context()?;
            let established_ms = r.u64()?;
            let initial_sequence = r.u64()?;
            let meaning = r.digest()?;
            let bound = if r.flag()? {
                Some(f64::from_le_bytes(
                    r.take(8)?.try_into().map_err(|_| "bound length")?,
                ))
            } else {
                None
            };
            Some(Reference {
                context,
                established_ms,
                initial_sequence,
                uncertainty: Uncertainty { meaning, bound },
            })
        } else {
            None
        };
        r.finish()?;
        let session = Session::new(reference, basis, capacity).map_err(|e| format!("{e:?}"))?;
        let mut handle = Self {
            session,
            snapshot: String::new(),
            error: String::new(),
        };
        handle.refresh();
        Ok(handle)
    }
    pub fn evaluate(&mut self, bytes: &[u8]) -> Result<(), String> {
        let mut r = reader(bytes, 1)?;
        let context = r.context()?;
        let now = r.u64()?;
        let source_fault = fault(r.byte()?)?;
        let mut records = Vec::new();
        let history = if r.flag()? {
            let initial_sequence = r.u64()?;
            let current_sequence = r.u64()?;
            let observed_from_ms = r.u64()?;
            let observed_through_ms = r.u64()?;
            let complete = r.flag()?;
            let count = usize::from(r.byte()?);
            if count > self.session.capacity() {
                return Err("Capacity".into());
            }
            records.try_reserve_exact(count).map_err(|_| "Capacity")?;
            for _ in 0..count {
                let origin = r.origin()?;
                let sequence = r.u64()?;
                let identity = r.u64()?;
                let at_ms = r.u64()?;
                let target = r.byte()?;
                let result = match r.byte()? {
                    0 => Application::Requested,
                    1 => Application::Acknowledged,
                    2 => Application::WriteFailed,
                    3 => Application::Unknown,
                    _ => return Err("invalid application result".into()),
                };
                records.push(HistoryRecord {
                    origin,
                    sequence,
                    identity,
                    at_ms,
                    target,
                    result,
                });
            }
            Some(History {
                initial_sequence,
                current_sequence,
                observed_from_ms,
                observed_through_ms,
                complete,
                records: &records,
            })
        } else {
            None
        };
        r.finish()?;
        self.session
            .evaluate(context, now, history, source_fault)
            .map_err(|e| format!("{e:?}"))?;
        self.refresh();
        Ok(())
    }
    pub fn snapshot(&self) -> &str {
        &self.snapshot
    }
    fn refresh(&mut self) {
        let s = &self.session;
        let (verdict, cause) = match s.verdict() {
            Verdict::Admitted => ("admitted", None),
            Verdict::Unavailable(c) => ("unavailable", Some(format!("{c:?}"))),
            Verdict::Fault(f) => ("fault", Some(format!("{f:?}"))),
        };
        let reference = s.reference().map_or("null".into(), |r| format!("{{\"context\":{},\"establishedMs\":\"{}\",\"initialSequence\":\"{}\",\"uncertainty\":{{\"meaning\":\"{}\",\"bound\":{}}}}}", context_json(r.context),r.established_ms,r.initial_sequence,hex(&r.uncertainty.meaning),r.uncertainty.bound.map_or("null".into(),|b| b.to_string())));
        let records: Vec<_> = s.records().iter().map(|r| format!("{{\"origin\":{{\"boot\":\"{}\",\"program\":\"{}\",\"binding\":\"{}\",\"run\":\"{}\",\"timeEpoch\":\"{}\",\"sourceEpoch\":\"{}\"}},\"sequence\":\"{}\",\"identity\":\"{}\",\"atMs\":\"{}\",\"target\":{},\"result\":\"{:?}\"}}",hex(&r.origin.boot),hex(&r.origin.program),hex(&r.origin.binding),r.origin.run,r.origin.time_epoch,r.origin.source_epoch,r.sequence,r.identity,r.at_ms,r.target,r.result)).collect();
        let coverage = s.coverage().map_or("null".into(),|c|format!("{{\"initialSequence\":\"{}\",\"currentSequence\":\"{}\",\"observedFromMs\":\"{}\",\"observedThroughMs\":\"{}\",\"complete\":{}}}",c.initial_sequence,c.current_sequence,c.observed_from_ms,c.observed_through_ms,c.complete));
        self.snapshot = format!("{{\"origin\":\"Estimated\",\"basis\":\"{:?}\",\"capacity\":{},\"verdict\":\"{}\",\"cause\":{},\"reference\":{},\"evaluatedContext\":{},\"nowMs\":{},\"coverage\":{},\"records\":[{}],\"temporalAdmission\":false}}",s.basis(),s.capacity(),verdict,cause.map_or("null".into(),|c|format!("\"{c}\"")),reference,s.evaluated_context().map_or("null".into(),context_json),s.now_ms().map_or("null".into(),|n|format!("\"{n}\"")),coverage,records.join(","));
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_new(ptr: *const u8, len: usize) -> *mut Handle {
    if ptr.is_null() || len > MAX_PACKET {
        return std::ptr::null_mut();
    }
    match Handle::new(std::slice::from_raw_parts(ptr, len)) {
        Ok(h) => Box::into_raw(Box::new(h)),
        Err(_) => std::ptr::null_mut(),
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_destroy(h: *mut Handle) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_evaluate(h: *mut Handle, ptr: *const u8, len: usize) -> i32 {
    let Some(h) = h.as_mut() else { return 0 };
    let result = if ptr.is_null() || len > MAX_PACKET {
        Err("estimate packet capacity/pointer".into())
    } else {
        h.evaluate(std::slice::from_raw_parts(ptr, len))
    };
    match result {
        Ok(()) => {
            h.error.clear();
            1
        }
        Err(e) => {
            h.error = e;
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_snapshot_ptr(h: *const Handle) -> *const u8 {
    h.as_ref().map_or(std::ptr::null(), |h| h.snapshot.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_snapshot_len(h: *const Handle) -> usize {
    h.as_ref().map_or(0, |h| h.snapshot.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_error_ptr(h: *const Handle) -> *const u8 {
    h.as_ref().map_or(std::ptr::null(), |h| h.error.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_estimate_error_len(h: *const Handle) -> usize {
    h.as_ref().map_or(0, |h| h.error.len())
}
