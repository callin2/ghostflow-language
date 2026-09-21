use ghostflow_core::{
    scan::{ScanDriver, ScanFrameV1, ScanInput},
    Capability, Module, Runtime, Type, Value,
};
use std::{collections::BTreeSet, slice, str};

const MAX_PACKET_BYTES: usize = 65_536;
const MAX_INPUTS: usize = 128;
const MAX_NAME_BYTES: usize = 1_024;
const MAX_MODULE_BYTES: usize = 1_024 * 1_024;
const MAX_CAPABILITY_TEXT_BYTES: usize = 1_024;

enum FramedState {
    Configuring(Runtime),
    Active(ScanDriver),
}

pub struct FramedHandle {
    state: FramedState,
    error: String,
    outcome: String,
}

impl FramedHandle {
    fn new() -> Self {
        Self {
            state: FramedState::Configuring(Runtime::new(1024)),
            error: String::new(),
            outcome: String::new(),
        }
    }

    fn success(&mut self) -> i32 {
        self.error.clear();
        1
    }

    fn failure(&mut self, message: impl Into<String>) -> i32 {
        self.error = message.into();
        0
    }
}

unsafe fn bytes<'a>(ptr: *const u8, len: usize, label: &str) -> Result<&'a [u8], String> {
    if ptr.is_null() {
        return Err(format!("{label} pointer is null"));
    }
    Ok(slice::from_raw_parts(ptr, len))
}

unsafe fn utf8<'a>(ptr: *const u8, len: usize, label: &str) -> Result<&'a str, String> {
    if len == 0 || len > MAX_CAPABILITY_TEXT_BYTES {
        return Err(format!(
            "{label} must contain 1..={MAX_CAPABILITY_TEXT_BYTES} UTF-8 bytes"
        ));
    }
    let value = bytes(ptr, len, label)?;
    str::from_utf8(value).map_err(|_| format!("{label} must be valid UTF-8"))
}

unsafe fn module_from_raw(ptr: *const u8, len: usize) -> Result<Module, String> {
    if len > MAX_MODULE_BYTES {
        return Err(format!("module exceeds {MAX_MODULE_BYTES} bytes"));
    }
    Module::load(bytes(ptr, len, "module")?).map_err(|error| error.to_string())
}

struct PacketReader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> PacketReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .at
            .checked_add(count)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| "scan frame is truncated".to_string())?;
        let value = &self.bytes[self.at..end];
        self.at = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("two-byte slice"),
        ))
    }

    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(
            self.take(8)?.try_into().expect("eight-byte slice"),
        ))
    }

    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(
            self.take(4)?.try_into().expect("four-byte slice"),
        ))
    }

    fn finished(&self) -> bool {
        self.at == self.bytes.len()
    }
}

unsafe fn decode_frame(
    ptr: *const u8,
    len: usize,
    scan_id: u64,
    logical_time_ms: u64,
) -> Result<ScanFrameV1, String> {
    if len > MAX_PACKET_BYTES {
        return Err(format!("scan frame exceeds {MAX_PACKET_BYTES} bytes"));
    }
    let bytes = bytes(ptr, len, "scan frame")?;
    let mut reader = PacketReader::new(bytes);
    let count = usize::from(reader.u16()?);
    if count > MAX_INPUTS {
        return Err(format!("scan frame exceeds {MAX_INPUTS} inputs"));
    }
    let mut inputs = Vec::with_capacity(count);
    let mut names = BTreeSet::new();
    for _ in 0..count {
        let name_len = usize::from(reader.u16()?);
        if name_len == 0 || name_len > MAX_NAME_BYTES {
            return Err(format!(
                "input name must contain 1..={MAX_NAME_BYTES} UTF-8 bytes"
            ));
        }
        let name = str::from_utf8(reader.take(name_len)?)
            .map_err(|_| "input name must be valid UTF-8".to_string())?
            .to_owned();
        if !names.insert(name.clone()) {
            return Err(format!("duplicate input {name}"));
        }
        if name == ghostflow_core::scan::RESERVED_CLOCK_INPUT {
            return Err("reserved clock input is host-derived".into());
        }
        let value = match reader.u8()? {
            1 => match reader.u8()? {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return Err("boolean input must be exactly 0 or 1".into()),
            },
            2 => {
                let number = reader.f64()?;
                if !number.is_finite() {
                    return Err("number input must be finite".into());
                }
                Value::Number(number)
            }
            3 => Value::Int(reader.i32()?),
            _ => return Err("input type must be bool (1), number (2), or Int (3)".into()),
        };
        inputs.push(ScanInput { name, value });
    }
    if !reader.finished() {
        return Err("scan frame has trailing bytes".into());
    }
    Ok(ScanFrameV1 {
        scan_id,
        logical_time_ms,
        inputs,
    })
}

#[no_mangle]
pub extern "C" fn gf_frame_create() -> *mut FramedHandle {
    Box::into_raw(Box::new(FramedHandle::new()))
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_destroy(handle: *mut FramedHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_load(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let module = match module_from_raw(ptr, len) {
        Ok(module) => module,
        Err(error) => return handle.failure(error),
    };
    match &mut handle.state {
        FramedState::Configuring(runtime) => {
            runtime.install(module, false);
            handle.success()
        }
        FramedState::Active(_) => handle.failure("framed runtime is already active"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_add_capability(
    handle: *mut FramedHandle,
    kind_ptr: *const u8,
    kind_len: usize,
    name_ptr: *const u8,
    name_len: usize,
    value_type: u8,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let kind = match utf8(kind_ptr, kind_len, "capability kind") {
        Ok(value) => value,
        Err(error) => return handle.failure(error),
    };
    let name = match utf8(name_ptr, name_len, "capability name") {
        Ok(value) => value,
        Err(error) => return handle.failure(error),
    };
    let value_type = match value_type {
        1 => Type::Bool,
        2 => Type::Number,
        3 => Type::Int,
        _ => return handle.failure("capability type must be bool (1), number (2), or Int (3)"),
    };
    match &mut handle.state {
        FramedState::Configuring(runtime) => {
            match runtime.add_capability(Capability::new(kind, name, value_type)) {
                Ok(()) => handle.success(),
                Err(error) => handle.failure(error.to_string()),
            }
        }
        FramedState::Active(_) => handle.failure("framed runtime is already active"),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_activate(handle: *mut FramedHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let state = std::mem::replace(&mut handle.state, FramedState::Configuring(Runtime::new(1)));
    match state {
        FramedState::Configuring(mut runtime) => match runtime.activate() {
            Ok(()) => {
                handle.state = FramedState::Active(runtime.into_scan_driver());
                handle.success()
            }
            Err(error) => {
                handle.state = FramedState::Configuring(runtime);
                handle.failure(error.to_string())
            }
        },
        FramedState::Active(driver) => {
            handle.state = FramedState::Active(driver);
            handle.failure("framed runtime is already active")
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_scan(
    handle: *mut FramedHandle,
    scan_id: u64,
    logical_time_ms: u64,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let frame = match decode_frame(ptr, len, scan_id, logical_time_ms) {
        Ok(frame) => frame,
        Err(error) => return handle.failure(error),
    };
    let outcome = match &mut handle.state {
        FramedState::Configuring(_) => return handle.failure("framed runtime is not active"),
        FramedState::Active(driver) => match driver.scan(frame) {
            Ok(outcome) => outcome,
            Err(error) => return handle.failure(error.to_string()),
        },
    };
    handle.outcome = format!(
        "{{\"format\":\"GhostFlow/scan-outcome-v1\",\"scanId\":{},\"logicalTimeMs\":{},\"trace\":{}}}",
        outcome.scan_id,
        outcome.logical_time_ms,
        outcome.trace.to_json(),
    );
    handle.success()
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_outcome_ptr(handle: *const FramedHandle) -> *const u8 {
    let Some(handle) = handle.as_ref() else {
        return std::ptr::null();
    };
    if handle.outcome.is_empty() {
        std::ptr::null()
    } else {
        handle.outcome.as_ptr()
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_outcome_len(handle: *const FramedHandle) -> usize {
    handle
        .as_ref()
        .map(|handle| handle.outcome.len())
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_error_ptr(handle: *const FramedHandle) -> *const u8 {
    let Some(handle) = handle.as_ref() else {
        return std::ptr::null();
    };
    if handle.error.is_empty() {
        std::ptr::null()
    } else {
        handle.error.as_ptr()
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_error_len(handle: *const FramedHandle) -> usize {
    handle
        .as_ref()
        .map(|handle| handle.error.len())
        .unwrap_or(0)
}
