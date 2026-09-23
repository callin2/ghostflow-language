use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::{slice, str};

#[path = "../framed_abi.rs"]
mod framed_abi;

#[path = "../after_event_abi.rs"]
mod after_event_abi;

#[path = "../temporal_abi.rs"]
mod temporal_abi;

#[path = "../solar_abi.rs"]
mod solar_abi;

#[path = "../replay_abi.rs"]
mod replay_abi;

#[path = "../signals_abi.rs"]
mod signals_abi;

#[path = "../station_abi.rs"]
mod station_abi;

#[path = "../accounting_abi.rs"]
mod accounting_abi;

pub struct Handle {
    runtime: Runtime,
    error: String,
    trace: String,
    replay: String,
    resource_plan: String,
}

impl Handle {
    fn complete(&mut self, result: ghostflow_core::Result<()>) -> i32 {
        match result {
            Ok(()) => {
                self.error.clear();
                1
            }
            Err(error) => {
                self.error = error.to_string();
                0
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn gf_create() -> *mut Handle {
    Box::into_raw(Box::new(Handle {
        runtime: Runtime::new(1024),
        error: String::new(),
        trace: String::new(),
        replay: String::new(),
        resource_plan: String::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn gf_destroy(handle: *mut Handle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub extern "C" fn gf_alloc(length: usize) -> *mut u8 {
    let mut bytes = Vec::<u8>::with_capacity(length);
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn gf_dealloc(ptr: *mut u8, capacity: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, capacity));
    }
}

unsafe fn module_from_raw(ptr: *const u8, length: usize) -> ghostflow_core::Result<Module> {
    if ptr.is_null() {
        return Module::load(&[]);
    }
    Module::load(slice::from_raw_parts(ptr, length))
}

unsafe fn text<'a>(ptr: *const u8, length: usize) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    str::from_utf8(slice::from_raw_parts(ptr, length)).ok()
}

#[no_mangle]
pub unsafe extern "C" fn gf_load(handle: *mut Handle, ptr: *const u8, length: usize) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    match module_from_raw(ptr, length) {
        Ok(module) => {
            h.runtime.install(module, false);
            h.error.clear();
            1
        }
        Err(e) => {
            h.error = e.to_string();
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_hot_swap(handle: *mut Handle, ptr: *const u8, length: usize) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = module_from_raw(ptr, length).and_then(|m| h.runtime.hot_swap(m));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_add_capability(
    handle: *mut Handle,
    kind: *const u8,
    kind_len: usize,
    name: *const u8,
    name_len: usize,
    value_type: u8,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let Some(kind) = text(kind, kind_len) else {
        return 0;
    };
    let Some(name) = text(name, name_len) else {
        return 0;
    };
    let ty = match value_type {
        1 => Type::Bool,
        2 => Type::Number,
        3 => Type::Int,
        _ => return 0,
    };
    let result = h.runtime.add_capability(Capability::new(kind, name, ty));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_activate(handle: *mut Handle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.runtime.activate();
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_activate_temporal(
    handle: *mut Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let profile = match temporal_abi::from_raw_packet(ptr, len) {
        Ok(profile) => profile,
        Err(error) => {
            h.error = error;
            return 0;
        }
    };
    let result = if profile.certified_bool_roots.is_empty() {
        h.runtime.activate_with_temporal(&profile.activation)
    } else if !profile.activation.root_density.is_empty() {
        h.error = "certified interval activation does not accept point density".into();
        return 0;
    } else {
        h.runtime.activate_with_certified_intervals(
            &ghostflow_core::true_for_runtime::TrueForActivation {
                certified_bool_roots: profile.certified_bool_roots,
                time_epoch: profile.activation.time_epoch,
                max_bytes: profile.activation.budget.max_bytes,
            },
        )
    };
    h.complete(result)
}

unsafe fn input_name<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    text(ptr, len)
}

#[no_mangle]
pub unsafe extern "C" fn gf_set_bool(
    handle: *mut Handle,
    name: *const u8,
    len: usize,
    value: i32,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let result = h.runtime.set_input(name, Value::Bool(value != 0));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_set_number(
    handle: *mut Handle,
    name: *const u8,
    len: usize,
    value: f64,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let result = h.runtime.set_input(name, Value::Number(value));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_set_int(
    handle: *mut Handle,
    name: *const u8,
    len: usize,
    value: i32,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let result = h.runtime.set_input(name, Value::Int(value));
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_tick(handle: *mut Handle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.runtime.tick().map(|_| ());
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_tick_at(handle: *mut Handle, milliseconds: u64) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.runtime.tick_at(milliseconds).map(|_| ());
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_clear_inputs(handle: *mut Handle) {
    if let Some(h) = handle.as_mut() {
        h.runtime.clear_inputs();
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_replay_temporal(
    handle: *mut Handle,
    ptr: *const u8,
    len: usize,
    count: u32,
    max_peak_temporal_bytes: usize,
    max_json_bytes: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = temporal_abi::from_raw(ptr, len).and_then(|profile| {
        let records = h
            .runtime
            .replay_current_with_temporal(count as usize, &profile, max_peak_temporal_bytes)
            .map_err(|error| error.to_string())?;
        replay_abi::legacy(&records, h.replay.capacity(), max_json_bytes)
    });
    match result {
        Ok(replay) => {
            h.replay = replay;
            h.error.clear();
            1
        }
        Err(error) => {
            h.error = error;
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_replay_ptr(handle: *const Handle) -> *const u8 {
    handle
        .as_ref()
        .filter(|h| !h.replay.is_empty())
        .map_or(std::ptr::null(), |h| h.replay.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_replay_len(handle: *const Handle) -> usize {
    handle.as_ref().map_or(0, |h| h.replay.len())
}

#[no_mangle]
pub unsafe extern "C" fn gf_plan_temporal(
    handle: *mut Handle,
    ptr: *const u8,
    len: usize,
    max_json_bytes: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = crate::temporal_abi::from_raw(ptr, len).and_then(|profile| {
        let runtime = &h.runtime;
        let plan = runtime.plan_temporal(&profile).map_err(|e| e.to_string())?;
        crate::replay_abi::resource_plan(&plan, h.resource_plan.capacity(), max_json_bytes)
    });
    match result {
        Ok(plan) => {
            h.resource_plan = plan;
            {
                h.error.clear();
                1
            }
        }
        Err(error) => {
            h.error = error;
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_plan_temporal_replay(
    handle: *mut Handle,
    ptr: *const u8,
    len: usize,
    count: u32,
    max_json_bytes: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = crate::temporal_abi::from_raw(ptr, len).and_then(|profile| {
        let runtime = &h.runtime;
        let plan = runtime
            .plan_current_temporal_replay(count as usize, &profile)
            .map_err(|e| e.to_string())?;
        crate::replay_abi::replay_plan(&plan, h.resource_plan.capacity(), max_json_bytes)
    });
    match result {
        Ok(plan) => {
            h.resource_plan = plan;
            {
                h.error.clear();
                1
            }
        }
        Err(error) => {
            h.error = error;
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_resource_plan_ptr(handle: *const Handle) -> *const u8 {
    handle
        .as_ref()
        .filter(|h| !h.resource_plan.is_empty())
        .map_or(std::ptr::null(), |h| h.resource_plan.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_resource_plan_len(handle: *const Handle) -> usize {
    handle.as_ref().map_or(0, |h| h.resource_plan.len())
}

#[cfg(test)]
mod replay_tests {
    use super::*;
    #[test]
    fn resource_plan_is_static_bounded_and_success_only() {
        let mut h = Handle {
            runtime: crate::replay_abi::tests::configured_runtime(),
            error: String::new(),
            trace: "live".into(),
            replay: "old replay".into(),
            resource_plan: String::new(),
        };
        assert_eq!(unsafe { gf_resource_plan_len(&h) }, 0);
        let mut packet = profile_packet();
        packet[16..20].copy_from_slice(&1_u32.to_le_bytes());
        packet[20..24].copy_from_slice(&1_u32.to_le_bytes());
        let invoke =
            |h: &mut _, p: &[u8], cap| unsafe { gf_plan_temporal(h, p.as_ptr(), p.len(), cap) };
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
            unsafe { gf_plan_temporal_replay(&mut h, packet.as_ptr(), packet.len(), 1, 100_000) },
            0
        );
        assert_eq!(h.resource_plan, prior);
        assert_eq!(h.replay, "old replay");
        assert_eq!(invoke(&mut h, &packet, cap + prior.len()), 1);
        assert!(h.runtime.journal().is_empty());
        assert!(h.runtime.temporal_resource_report().is_none());
        assert_eq!(h.trace, "live");
    }
    use crate::replay_abi::tests::{active_runtime, profile_packet, submit};
    #[test]
    fn legacy_replay_rejection_preserves_live_and_previous_buffers_and_pending_inputs() {
        let mut h = Handle {
            runtime: active_runtime(),
            error: String::new(),
            trace: "unchanged trace".into(),
            replay: String::new(),
            resource_plan: String::new(),
        };
        assert_eq!(unsafe { gf_replay_len(&h) }, 0);
        assert!(unsafe { gf_replay_ptr(&h) }.is_null());
        for (time, id, value) in [(0, 1, 20.0), (100, 2, 30.0), (200, 3, 40.0)] {
            submit(&mut h.runtime, time, id, value);
            h.runtime.tick().unwrap();
        }
        let packet = profile_packet();
        let invoke = |h: &mut Handle, p: &[u8], count, peak, json| unsafe {
            gf_replay_temporal(h, p.as_ptr(), p.len(), count, peak, json)
        };
        assert_eq!(invoke(&mut h, &packet, 2, 20_000_000, 100_000), 1);
        let prior = h.replay.clone();
        let cap = h.replay.capacity();
        assert!(prior.contains("\"checkpointTick\":1"));
        assert!(prior.contains("\"value\":25"));
        let journal = h
            .runtime
            .journal()
            .iter()
            .map(|r| r.to_json())
            .collect::<Vec<_>>();
        submit(&mut h.runtime, 300, 4, 80.0);
        let mut wrong = packet.clone();
        wrong[8] = 8;
        for (p, count, peak, json) in [
            (&packet[..], 0, 20_000_000, 100_000),
            (&packet[..], 3, 20_000_000, 100_000),
            (&packet[..], 2, 1, 100_000),
            (&packet[..], 2, 20_000_000, cap + prior.len() - 1),
            (&packet[..10], 2, 20_000_000, 100_000),
            (&wrong[..], 2, 20_000_000, 100_000),
        ] {
            assert_eq!(invoke(&mut h, p, count, peak, json), 0);
            assert_eq!(h.replay, prior);
            assert_eq!(h.trace, "unchanged trace");
            assert_eq!(
                h.runtime
                    .journal()
                    .iter()
                    .map(|r| r.to_json())
                    .collect::<Vec<_>>(),
                journal
            );
        }
        assert_eq!(invoke(&mut h, &packet, 2, 20_000_000, cap + prior.len()), 1);
        assert!(h.error.is_empty());
        assert_eq!(
            h.runtime.tick().unwrap().safe_intents["mean"],
            Value::Number(42.5)
        );
        assert_eq!(h.replay, prior);
        assert_eq!(
            unsafe { gf_replay_temporal(std::ptr::null_mut(), std::ptr::null(), 0, 1, 1, 1) },
            0
        );
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_trace_ptr(handle: *mut Handle) -> *const u8 {
    let Some(h) = handle.as_mut() else {
        return std::ptr::null();
    };
    h.trace = h
        .runtime
        .journal()
        .back()
        .map(|record| record.to_json())
        .unwrap_or_else(|| "null".into());
    h.trace.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn gf_trace_len(handle: *const Handle) -> usize {
    handle.as_ref().map(|h| h.trace.len()).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_get_state_number(
    handle: *const Handle,
    name: *const u8,
    len: usize,
    found: *mut i32,
) -> f64 {
    let Some(h) = handle.as_ref() else { return 0.0 };
    let Some(name) = input_name(name, len) else {
        return 0.0;
    };
    let value = h.runtime.state(name);
    if let Some(out) = found.as_mut() {
        *out = matches!(value, Some(Value::Number(_))) as i32;
    }
    match value {
        Some(Value::Number(v)) => v,
        _ => 0.0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_get_intent_number(
    handle: *const Handle,
    name: *const u8,
    len: usize,
    found: *mut i32,
) -> f64 {
    let Some(h) = handle.as_ref() else { return 0.0 };
    let Some(name) = input_name(name, len) else {
        return 0.0;
    };
    let value = h.runtime.intent(name);
    if let Some(out) = found.as_mut() {
        *out = matches!(value, Some(Value::Number(_))) as i32;
    }
    match value {
        Some(Value::Number(v)) => v,
        _ => 0.0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_get_state_int(
    handle: *const Handle,
    name: *const u8,
    len: usize,
    found: *mut i32,
) -> i32 {
    let Some(h) = handle.as_ref() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let value = h.runtime.state(name);
    if let Some(out) = found.as_mut() {
        *out = matches!(value, Some(Value::Int(_))) as i32;
    }
    match value {
        Some(Value::Int(v)) => v,
        _ => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_get_intent_int(
    handle: *const Handle,
    name: *const u8,
    len: usize,
    found: *mut i32,
) -> i32 {
    let Some(h) = handle.as_ref() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let value = h.runtime.intent(name);
    if let Some(out) = found.as_mut() {
        *out = matches!(value, Some(Value::Int(_))) as i32;
    }
    match value {
        Some(Value::Int(v)) => v,
        _ => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_get_state_bool(
    handle: *const Handle,
    name: *const u8,
    len: usize,
    found: *mut i32,
) -> i32 {
    let Some(h) = handle.as_ref() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let value = h.runtime.state(name);
    if let Some(out) = found.as_mut() {
        *out = if matches!(value, Some(Value::Bool(_))) {
            1
        } else {
            0
        };
    }
    match value {
        Some(Value::Bool(v)) => v as i32,
        _ => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_get_intent_bool(
    handle: *const Handle,
    name: *const u8,
    len: usize,
    found: *mut i32,
) -> i32 {
    let Some(h) = handle.as_ref() else { return 0 };
    let Some(name) = input_name(name, len) else {
        return 0;
    };
    let value = h.runtime.intent(name);
    if let Some(out) = found.as_mut() {
        *out = if matches!(value, Some(Value::Bool(_))) {
            1
        } else {
            0
        };
    }
    match value {
        Some(Value::Bool(v)) => v as i32,
        _ => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_rewind(handle: *mut Handle, tick: u64) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.runtime.rewind(tick);
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_journal_len(handle: *const Handle) -> usize {
    handle
        .as_ref()
        .map(|h| h.runtime.journal().len())
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_last_error_ptr(handle: *const Handle) -> *const u8 {
    handle
        .as_ref()
        .map(|h| h.error.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[no_mangle]
pub unsafe extern "C" fn gf_last_error_len(handle: *const Handle) -> usize {
    handle.as_ref().map(|h| h.error.len()).unwrap_or(0)
}
