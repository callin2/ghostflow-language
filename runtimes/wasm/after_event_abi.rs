//! GFAE v1: bounded identified-event delivery to the native temporal engine.
use ghostflow_core::{
    after_event::{AfterEvent, Event, EventKey, Observation, Status},
    temporal::{EvidenceQuality, TimeContext},
};
use std::fmt::Write;

const CAPACITY: usize = 32;
const MAX_PACKET: usize = 2048;
const MAX_EXACT: u64 = (1_u64 << 53) - 1;

pub struct Handle {
    engine: AfterEvent<CAPACITY>,
    event_source: u32,
    predicate_source: u32,
    error: String,
    results: String,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Reader<'_> {
    fn take(&mut self, count: usize) -> Result<&[u8], String> {
        let end = self.at.checked_add(count).ok_or("packet length overflow")?;
        let value = self
            .bytes
            .get(self.at..end)
            .ok_or("truncated after_event packet")?;
        self.at = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let value = u64::from_le_bytes(self.take(8)?.try_into().unwrap());
        if value > MAX_EXACT {
            return Err("after_event integer exceeds exact range".into());
        }
        Ok(value)
    }
    fn flag(&mut self) -> Result<bool, String> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err("invalid after_event flag".into()),
        }
    }
    fn key(&mut self) -> Result<EventKey, String> {
        Ok(EventKey {
            source_tag: self.u32()?,
            source_epoch: self.u64()?,
            id: self.u64()?,
        })
    }
}

impl Handle {
    fn stage(&mut self, bytes: &[u8]) -> Result<(), String> {
        let mut reader = Reader { bytes, at: 0 };
        if reader.take(4)? != b"GFAE" || reader.u16()? != 1 || reader.u16()? != 0 {
            return Err("invalid after_event packet header".into());
        }
        let time = TimeContext {
            epoch: reader.u64()?,
            now_ms: reader.u64()?,
        };
        let count = usize::from(reader.u16()?);
        let ack_count = usize::from(reader.u16()?);
        if count > CAPACITY || ack_count > CAPACITY {
            return Err("after_event batch capacity exceeded".into());
        }
        let has_predicate = reader.flag()?;
        let mut starts = Vec::with_capacity(count);
        for _ in 0..count {
            let key = reader.key()?;
            if key.source_tag != self.event_source {
                return Err("event source binding mismatch".into());
            }
            starts.push(Event {
                key,
                time_epoch: reader.u64()?,
                at_ms: reader.u64()?,
            });
        }
        let mut acknowledgements = Vec::with_capacity(ack_count);
        for _ in 0..ack_count {
            let key = reader.key()?;
            if key.source_tag != self.event_source {
                return Err("event acknowledgement binding mismatch".into());
            }
            acknowledgements.push(key);
        }
        let predicate = if has_predicate {
            if reader.u32()? != self.predicate_source {
                return Err("predicate source binding mismatch".into());
            }
            let at_ms = reader.u64()?;
            let value = reader.flag()?;
            let quality = match reader.u8()? {
                0 => EvidenceQuality::Measured,
                1 => EvidenceQuality::Held,
                2 => EvidenceQuality::Constructed,
                _ => return Err("invalid after_event evidence quality".into()),
            };
            Some(Observation {
                at_ms,
                value,
                quality,
            })
        } else {
            None
        };
        if reader.at != bytes.len() {
            return Err("trailing after_event packet bytes".into());
        }
        self.engine
            .stage_batch(time, &starts, predicate, &acknowledgements)
            .map_err(|e| format!("{e:?}"))
    }

    fn refresh_results(&mut self) {
        self.results.clear();
        self.results.push('[');
        for (index, result) in self.engine.results().iter().flatten().enumerate() {
            if index != 0 {
                self.results.push(',');
            }
            let event = result.event;
            write!(self.results,
                "{{\"event\":{{\"sourceTag\":{},\"sourceEpoch\":{},\"id\":{},\"timeEpoch\":{},\"atMs\":{}}},\"status\":\"{}\"",
                event.key.source_tag, event.key.source_epoch, event.key.id, event.time_epoch, event.at_ms,
                match result.status { Status::Pending => "pending", Status::Expired => "expired", Status::Satisfied { .. } => "satisfied" }
            ).unwrap();
            if let Status::Satisfied { at_ms } = result.status {
                write!(self.results, ",\"satisfiedAtMs\":{at_ms}").unwrap();
            }
            self.results.push('}');
        }
        self.results.push(']');
    }

    fn complete(&mut self, result: Result<(), String>) -> i32 {
        match result {
            Ok(()) => {
                self.error.clear();
                1
            }
            Err(error) => {
                self.error = error;
                0
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn gf_after_event_create(
    window_ms: u64,
    event_source: u32,
    predicate_source: u32,
) -> *mut Handle {
    if event_source == 0 || predicate_source == 0 {
        return std::ptr::null_mut();
    }
    let Ok(engine) = AfterEvent::new(window_ms) else {
        return std::ptr::null_mut();
    };
    Box::into_raw(Box::new(Handle {
        engine,
        event_source,
        predicate_source,
        error: String::new(),
        results: "[]".into(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn gf_after_event_destroy(handle: *mut Handle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_after_event_stage(
    handle: *mut Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    if ptr.is_null() || len > MAX_PACKET {
        return h.complete(Err("invalid after_event packet pointer or length".into()));
    }
    let result = h.stage(std::slice::from_raw_parts(ptr, len));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_after_event_commit(handle: *mut Handle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.engine.commit().map_err(|e| format!("{e:?}"));
    if result.is_ok() {
        h.refresh_results();
    }
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_after_event_rollback(handle: *mut Handle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.engine.rollback().map_err(|e| format!("{e:?}"));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_after_event_project(handle: *mut Handle, mode: u8, staged: i32) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = match (mode, staged) {
        (0, 0) => Ok(h.engine.any()),
        (1, 0) => Ok(h.engine.all()),
        (0, 1) => h.engine.staged_any().map_err(|error| format!("{error:?}")),
        (1, 1) => h.engine.staged_all().map_err(|error| format!("{error:?}")),
        _ => Err("invalid after_event projection".into()),
    };
    match result {
        Ok(value) => {
            h.error.clear();
            match value {
                None => 1,
                Some(false) => 2,
                Some(true) => 3,
            }
        }
        Err(error) => {
            h.error = error;
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_after_event_results_ptr(handle: *const Handle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.results.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_after_event_results_len(handle: *const Handle) -> usize {
    handle.as_ref().map_or(0, |h| h.results.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_after_event_error_ptr(handle: *const Handle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.error.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_after_event_error_len(handle: *const Handle) -> usize {
    handle.as_ref().map_or(0, |h| h.error.len())
}
