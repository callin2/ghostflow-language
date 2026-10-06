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
    replay: String,
    resource_plan: String,
    context_checkpoint: Vec<u8>,
    context_state: String,
}

impl FramedHandle {
    fn new() -> Self {
        Self {
            state: FramedState::Configuring(Runtime::new(1024)),
            error: String::new(),
            outcome: String::new(),
            replay: String::new(),
            resource_plan: String::new(),
            context_checkpoint: Vec::new(),
            context_state: String::new(),
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

/// Optional ABI extension. Evidence must be enabled while configuring a new run.
#[no_mangle]
pub unsafe extern "C" fn gf_frame_enable_instruction_witnesses(handle: *mut FramedHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let result = match &mut handle.state {
        FramedState::Configuring(runtime) => runtime.enable_instruction_witnesses(),
        FramedState::Active(_) => {
            return handle.failure("explanation requires a new configuring run")
        }
    };
    match result {
        Ok(()) => handle.success(),
        Err(error) => handle.failure(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_activate_resource_binding(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let bytes = match crate::resource_constraints_abi::packet(ptr, len) {
        Ok(v) => v,
        Err(e) => return h.failure(e),
    };
    let state = std::mem::replace(&mut h.state, FramedState::Configuring(Runtime::new(1)));
    match state {
        FramedState::Configuring(mut runtime) => match runtime
            .activate_with_resource_binding(bytes, crate::resource_constraints_abi::registry())
        {
            Ok(()) => {
                h.state = FramedState::Active(runtime.into_scan_driver());
                h.success()
            }
            Err(e) => {
                h.state = FramedState::Configuring(runtime);
                h.failure(e.to_string())
            }
        },
        FramedState::Active(driver) => {
            h.state = FramedState::Active(driver);
            h.failure("framed runtime is already active")
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_scan_resource_binding(
    handle: *mut FramedHandle,
    scan_id: u64,
    logical_time_ms: u64,
    ptr: *const u8,
    len: usize,
    binding_ptr: *const u8,
    binding_len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let frame = match decode_frame(ptr, len, scan_id, logical_time_ms) {
        Ok(v) => v,
        Err(e) => return h.failure(e),
    };
    let binding = match crate::resource_constraints_abi::packet(binding_ptr, binding_len) {
        Ok(v) => v,
        Err(e) => return h.failure(e),
    };
    let outcome = match &mut h.state {
        FramedState::Configuring(_) => return h.failure("framed runtime is not active"),
        FramedState::Active(driver) => match driver.scan_with_resource_binding(frame, binding) {
            Ok(v) => v,
            Err(e) => return h.failure(e.to_string()),
        },
    };
    h.outcome=format!("{{\"format\":\"GhostFlow/scan-outcome-v1\",\"scanId\":{},\"logicalTimeMs\":{},\"trace\":{}}}",outcome.scan_id,outcome.logical_time_ms,outcome.trace.to_json());
    h.success()
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_activate_temporal(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let profile = match crate::temporal_abi::from_raw(ptr, len) {
        Ok(profile) => profile,
        Err(error) => return handle.failure(error),
    };
    // Decode and validate before moving the configuring Runtime. Failure retains it.
    let state = std::mem::replace(&mut handle.state, FramedState::Configuring(Runtime::new(1)));
    match state {
        FramedState::Configuring(mut runtime) => match runtime.activate_with_temporal(&profile) {
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
pub unsafe extern "C" fn gf_frame_activate_context(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let profile = match crate::context_abi::activation_from_raw(ptr, len) {
        Ok(profile) => profile,
        Err(error) => return h.failure(error),
    };
    let state = std::mem::replace(&mut h.state, FramedState::Configuring(Runtime::new(1)));
    match state {
        FramedState::Configuring(mut runtime) => match runtime.activate_with_context(&profile) {
            Ok(()) => {
                h.state = FramedState::Active(runtime.into_scan_driver());
                h.success()
            }
            Err(error) => {
                h.state = FramedState::Configuring(runtime);
                h.failure(error.to_string())
            }
        },
        FramedState::Active(driver) => {
            h.state = FramedState::Active(driver);
            h.failure("framed runtime is already active")
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_activate_schedules(
    handle: *mut FramedHandle,
    boot_epoch: u64,
    terminal_capacity: u32,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let state = std::mem::replace(&mut h.state, FramedState::Configuring(Runtime::new(1)));
    match state {
        FramedState::Configuring(mut runtime) => {
            let result =
                runtime.activate_with_schedules(&ghostflow_core::solar_runtime::SolarActivation {
                    boot_epoch,
                    terminal_capacity: terminal_capacity as usize,
                });
            match result {
                Ok(()) => {
                    h.state = FramedState::Active(runtime.into_scan_driver());
                    h.success()
                }
                Err(error) => {
                    h.state = FramedState::Configuring(runtime);
                    h.failure(error.to_string())
                }
            }
        }
        FramedState::Active(driver) => {
            h.state = FramedState::Active(driver);
            h.failure("framed runtime is already active")
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_scan_schedules(
    handle: *mut FramedHandle,
    scan_id: u64,
    logical_time_ms: u64,
    ptr: *const u8,
    len: usize,
    schedule_ptr: *const u8,
    schedule_len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let frame = match decode_frame(ptr, len, scan_id, logical_time_ms) {
        Ok(frame) => frame,
        Err(error) => return h.failure(error),
    };
    let (packet, version) = match crate::solar_abi::schedules_from_raw(schedule_ptr, schedule_len) {
        Ok(packet) => packet,
        Err(error) => return h.failure(error),
    };
    let inputs = packet.inputs();
    let result = match &mut h.state {
        FramedState::Active(driver) => {
            driver.scan_with_schedules(frame, packet.clock(), &inputs, version)
        }
        _ => return h.failure("framed runtime is not active"),
    };
    match result {
        Ok(outcome) => {
            h.outcome = format!("{{\"format\":\"GhostFlow/scan-outcome-v1\",\"scanId\":{},\"logicalTimeMs\":{},\"trace\":{}}}", outcome.scan_id, outcome.logical_time_ms, outcome.trace.to_json());
            h.success()
        }
        Err(error) => h.failure(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_scan_context(
    handle: *mut FramedHandle,
    scan_id: u64,
    logical_time_ms: u64,
    ptr: *const u8,
    len: usize,
    context_ptr: *const u8,
    context_len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let frame = match decode_frame(ptr, len, scan_id, logical_time_ms) {
        Ok(frame) => frame,
        Err(error) => return h.failure(error),
    };
    let packet = match crate::context_abi::facts_from_raw(context_ptr, context_len) {
        Ok(packet) => packet,
        Err(error) => return h.failure(error),
    };
    let result = match &mut h.state {
        FramedState::Active(driver) => {
            driver.scan_with_context(frame, packet.clock(), &packet.facts)
        }
        _ => return h.failure("framed runtime is not active"),
    };
    match result {
        Ok(outcome) => {
            h.outcome = format!("{{\"format\":\"GhostFlow/scan-outcome-v1\",\"scanId\":{},\"logicalTimeMs\":{},\"trace\":{}}}", outcome.scan_id, outcome.logical_time_ms, outcome.trace.to_json());
            h.success()
        }
        Err(error) => h.failure(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_context_checkpoint(handle: *mut FramedHandle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let FramedState::Active(driver) = &h.state else {
        return h.failure("framed runtime is not active");
    };
    match driver.runtime().context_checkpoint().and_then(|bytes| {
        driver
            .runtime()
            .context_state_json()
            .map(|state| (bytes, state))
    }) {
        Ok((bytes, state)) => {
            h.context_checkpoint = bytes;
            h.context_state = state;
            h.success()
        }
        Err(error) => h.failure(error.to_string()),
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_context_checkpoint_ptr(handle: *const FramedHandle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.context_checkpoint.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_context_checkpoint_len(handle: *const FramedHandle) -> usize {
    handle.as_ref().map_or(0, |h| h.context_checkpoint.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_context_state_ptr(handle: *const FramedHandle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.context_state.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_context_state_len(handle: *const FramedHandle) -> usize {
    handle.as_ref().map_or(0, |h| h.context_state.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_restore_context_checkpoint(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    if ptr.is_null() || len > 4 * 1024 * 1024 {
        return h.failure("invalid context checkpoint pointer/length");
    }
    let FramedState::Active(driver) = &mut h.state else {
        return h.failure("framed runtime is not active");
    };
    match driver.restore_context_checkpoint(slice::from_raw_parts(ptr, len)) {
        Ok(()) => h.success(),
        Err(error) => h.failure(error.to_string()),
    }
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
pub unsafe extern "C" fn gf_frame_replay_temporal(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
    count: u32,
    max_peak_temporal_bytes: usize,
    max_json_bytes: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = crate::temporal_abi::from_raw(ptr, len).and_then(|profile| {
        let FramedState::Active(driver) = &h.state else {
            return Err("runtime is not active".into());
        };
        let records = driver
            .replay_current_with_temporal(count as usize, &profile, max_peak_temporal_bytes)
            .map_err(|error| error.to_string())?;
        crate::replay_abi::framed(&records, h.replay.capacity(), max_json_bytes)
    });
    match result {
        Ok(replay) => {
            h.replay = replay;
            h.success()
        }
        Err(error) => h.failure(error),
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_replay_ptr(handle: *const FramedHandle) -> *const u8 {
    handle
        .as_ref()
        .filter(|h| !h.replay.is_empty())
        .map_or(std::ptr::null(), |h| h.replay.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_replay_len(handle: *const FramedHandle) -> usize {
    handle.as_ref().map_or(0, |h| h.replay.len())
}

#[no_mangle]
pub unsafe extern "C" fn gf_frame_plan_temporal(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
    max_json_bytes: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = crate::temporal_abi::from_raw(ptr, len).and_then(|profile| {
        let runtime = match &h.state {
            FramedState::Configuring(runtime) => runtime,
            FramedState::Active(driver) => driver.runtime(),
        };
        let plan = runtime.plan_temporal(&profile).map_err(|e| e.to_string())?;
        crate::replay_abi::resource_plan(&plan, h.resource_plan.capacity(), max_json_bytes)
    });
    match result {
        Ok(plan) => {
            h.resource_plan = plan;
            h.success()
        }
        Err(error) => h.failure(error),
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_plan_temporal_replay(
    handle: *mut FramedHandle,
    ptr: *const u8,
    len: usize,
    count: u32,
    max_json_bytes: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = crate::temporal_abi::from_raw(ptr, len).and_then(|profile| {
        let FramedState::Active(runtime) = &h.state else {
            return Err("runtime is not active".into());
        };
        let plan = runtime
            .plan_current_temporal_replay(count as usize, &profile)
            .map_err(|e| e.to_string())?;
        crate::replay_abi::replay_plan(&plan, h.resource_plan.capacity(), max_json_bytes)
    });
    match result {
        Ok(plan) => {
            h.resource_plan = plan;
            h.success()
        }
        Err(error) => h.failure(error),
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_resource_plan_ptr(handle: *const FramedHandle) -> *const u8 {
    handle
        .as_ref()
        .filter(|h| !h.resource_plan.is_empty())
        .map_or(std::ptr::null(), |h| h.resource_plan.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_frame_resource_plan_len(handle: *const FramedHandle) -> usize {
    handle.as_ref().map_or(0, |h| h.resource_plan.len())
}

#[cfg(test)]
mod replay_tests {
    use super::*;
    #[test]
    fn resource_plan_is_static_bounded_and_success_only() {
        let mut h = FramedHandle {
            state: FramedState::Configuring(crate::replay_abi::tests::configured_runtime()),
            error: String::new(),
            outcome: "live".into(),
            replay: "old replay".into(),
            resource_plan: String::new(),
            context_checkpoint: Vec::new(),
            context_state: String::new(),
        };
        assert_eq!(unsafe { gf_frame_resource_plan_len(&h) }, 0);
        let mut packet = profile_packet();
        packet[16..20].copy_from_slice(&1_u32.to_le_bytes());
        packet[20..24].copy_from_slice(&1_u32.to_le_bytes());
        let invoke = |h: &mut _, p: &[u8], cap| unsafe {
            gf_frame_plan_temporal(h, p.as_ptr(), p.len(), cap)
        };
        assert_eq!(invoke(&mut h, &packet, 100_000), 1);
        assert!(h.resource_plan.contains("\"fitsBudget\":false"));
        let prior = h.resource_plan.clone();
        let cap = h.resource_plan.capacity();
        for (p, max) in [
            (&packet[..], cap + prior.len() - 1),
            (&packet[..10], 100_000),
        ] {
            assert_eq!(invoke(&mut h, p, max), 0);
            assert_eq!(h.resource_plan, prior);
        }
        assert_eq!(
            unsafe {
                gf_frame_plan_temporal_replay(&mut h, packet.as_ptr(), packet.len(), 1, 100_000)
            },
            0
        );
        assert_eq!(h.resource_plan, prior);
        assert_eq!(h.replay, "old replay");
        assert_eq!(invoke(&mut h, &packet, cap + prior.len()), 1);
        assert!(
            matches!(&h.state,FramedState::Configuring(runtime) if runtime.journal().is_empty() && runtime.temporal_resource_report().is_none())
        );
        assert_eq!(h.outcome, "live");
    }
    use crate::replay_abi::tests::{active_runtime, profile_packet, submit};
    #[test]
    fn framed_replay_preserves_outcome_sequence_and_last_success_after_failure() {
        let mut runtime = active_runtime();
        submit(&mut runtime, 0, 1, 20.0);
        runtime.tick().unwrap();
        let base = runtime.journal().back().unwrap().inputs.clone();
        let mut driver = runtime.into_scan_driver();
        for scan_id in 0..3 {
            let now = (scan_id + 1) * 100;
            let mut input = base.clone();
            input.insert("id".into(), Value::Number((scan_id + 2) as f64));
            input.insert("timestamp".into(), Value::Number(now as f64));
            input.insert("value".into(), Value::Number((scan_id + 3) as f64 * 10.0));
            driver
                .scan(ScanFrameV1 {
                    scan_id,
                    logical_time_ms: now,
                    inputs: input
                        .into_iter()
                        .filter(|(name, _)| name != "__gf_now_ms")
                        .map(|(name, value)| ScanInput { name, value })
                        .collect(),
                })
                .unwrap();
        }
        let mut h = FramedHandle {
            state: FramedState::Active(driver),
            error: String::new(),
            outcome: "unchanged outcome".into(),
            replay: String::new(),
            resource_plan: String::new(),
            context_checkpoint: Vec::new(),
            context_state: String::new(),
        };
        let packet = profile_packet();
        let invoke = |h: &mut FramedHandle, p: &[u8], count, peak, json| unsafe {
            gf_frame_replay_temporal(h, p.as_ptr(), p.len(), count, peak, json)
        };
        assert_eq!(invoke(&mut h, &packet, 2, 20_000_000, 100_000), 1);
        let prior = h.replay.clone();
        let cap = h.replay.capacity();
        assert!(prior.contains("\"checkpointTick\":2"));
        assert!(prior.contains("\"scanId\":1,\"logicalTimeMs\":200"));
        assert!(prior.contains("\"scanId\":2,\"logicalTimeMs\":300"));
        for (count, peak, json) in [
            (0, 20_000_000, 100_000),
            (3, 20_000_000, 100_000),
            (2, 1, 100_000),
            (2, 20_000_000, cap + prior.len() - 1),
        ] {
            assert_eq!(invoke(&mut h, &packet, count, peak, json), 0);
            assert_eq!(h.replay, prior);
            assert_eq!(h.outcome, "unchanged outcome");
        }
        assert_eq!(invoke(&mut h, &packet[..10], 2, 20_000_000, 100_000), 0);
        assert_eq!(h.replay, prior);
        assert_eq!(invoke(&mut h, &packet, 2, 20_000_000, cap + prior.len()), 1);
        let FramedState::Active(driver) = &h.state else {
            panic!("active driver preserved")
        };
        assert_eq!(driver.next_scan_id(), Some(3));
        assert_eq!(driver.scan_last_time_ms(), Some(300));
        assert_eq!(driver.runtime().journal().back().unwrap().tick, 4);
        assert_eq!(unsafe { gf_frame_replay_len(&h) }, prior.len());
    }
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
