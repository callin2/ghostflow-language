//! Binding identity only; admission and projection remain in the Rust VM.
use ghostflow_core::resource_constraints::ResourceBindingRegistry;
use std::sync::OnceLock;
pub(crate) fn registry() -> &'static ResourceBindingRegistry {
    static REGISTRY: OnceLock<ResourceBindingRegistry> = OnceLock::new();
    REGISTRY.get_or_init(ResourceBindingRegistry::new)
}
pub(crate) unsafe fn packet<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], String> {
    if ptr.is_null() || len == 0 || len > 65536 {
        return Err("invalid resource binding pointer/length".into());
    }
    Ok(std::slice::from_raw_parts(ptr, len))
}
#[no_mangle]
pub unsafe extern "C" fn gf_activate_resource_binding(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let bytes = match packet(ptr, len) {
        Ok(v) => v,
        Err(e) => {
            h.error = e;
            return 0;
        }
    };
    let result = h.runtime.activate_with_resource_binding(bytes, registry());
    h.complete(result)
}
#[no_mangle]
pub unsafe extern "C" fn gf_tick_resource_binding(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let bytes = match packet(ptr, len) {
        Ok(v) => v,
        Err(e) => {
            h.error = e;
            return 0;
        }
    };
    let result = h.runtime.tick_with_resource_binding(bytes).map(|_| ());
    h.complete(result)
}
