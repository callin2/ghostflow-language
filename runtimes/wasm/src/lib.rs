use ghostflow_core::{Capability, Module, Runtime, Type, Value};
use std::{slice, str};

#[path = "../framed_abi.rs"]
mod framed_abi;

#[path = "../signals_abi.rs"]
mod signals_abi;

#[path = "../station_abi.rs"]
mod station_abi;

pub struct Handle {
    runtime: Runtime,
    error: String,
    trace: String,
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
