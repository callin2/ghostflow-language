//! Dependency-free C ABI for the bounded signal conditioner.

use ghostflow_core::signals::{
    Filter, HysteresisConfig, Quality, Sample, Sensor, SensorConfig, SensorFault,
};
use std::mem::size_of;

#[repr(C)]
pub struct SignalConfig {
    pub filter_kind: u8, // 1 median, 2 moving average, 3 EMA
    pub window: u8,
    pub has_hysteresis: u8,
    pub initial: u8,
    pub alpha: f64,
    pub valid_min: f64,
    pub valid_max: f64,
    pub stale_after_ms: u64,
    pub recover_samples: u32,
    pub on_below: f64,
    pub off_above: f64,
}

pub struct SignalHandle {
    sensor: Sensor,
    error: String,
    checkpoint: Option<(Sensor, String)>,
}

fn config(raw: &SignalConfig) -> Result<SensorConfig, SensorFault> {
    let filter = match raw.filter_kind {
        1 => Filter::Median(raw.window as usize),
        2 => Filter::MovingAverage(raw.window as usize),
        3 => Filter::Ema(raw.alpha),
        _ => return Err(SensorFault::Invalid),
    };
    let hysteresis = if raw.has_hysteresis != 0 {
        Some(HysteresisConfig {
            on_below: raw.on_below,
            off_above: raw.off_above,
            initial: raw.initial != 0,
        })
    } else {
        None
    };
    let mut result = SensorConfig::new(
        filter,
        raw.valid_min,
        raw.valid_max,
        raw.stale_after_ms,
        raw.recover_samples as usize,
    );
    result.hysteresis = hysteresis;
    Ok(result)
}

fn set_error(handle: &mut SignalHandle, error: impl ToString) {
    handle.error = error.to_string();
}

#[no_mangle]
pub extern "C" fn gf_signal_sizeof() -> usize {
    size_of::<SignalConfig>()
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_create(raw: *const SignalConfig) -> *mut SignalHandle {
    let Some(raw) = raw.as_ref() else {
        return std::ptr::null_mut();
    };
    let Ok(config) = config(raw) else {
        return std::ptr::null_mut();
    };
    Box::into_raw(Box::new(SignalHandle {
        sensor: match Sensor::new(config) {
            Ok(sensor) => sensor,
            Err(_) => return std::ptr::null_mut(),
        },
        error: String::new(),
        checkpoint: None,
    }))
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_free(handle: *mut SignalHandle) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_begin(handle: *mut SignalHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    if handle.checkpoint.is_some() {
        set_error(handle, "signal transaction already active");
        return 0;
    }
    handle.checkpoint = Some((handle.sensor.clone(), handle.error.clone()));
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_commit(handle: *mut SignalHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    if handle.checkpoint.take().is_none() {
        set_error(handle, "signal transaction is not active");
        return 0;
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_rollback(handle: *mut SignalHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let Some((sensor, error)) = handle.checkpoint.take() else {
        set_error(handle, "signal transaction is not active");
        return 0;
    };
    handle.sensor = sensor;
    handle.error = error;
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_update(
    handle: *mut SignalHandle,
    epoch: u64,
    id: u64,
    timestamp_ms: u64,
    value: f64,
    quality: u8,
    now_ms: u64,
) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    let Some(quality) = Quality::from_u8(quality) else {
        set_error(handle, "unsupported sensor quality");
        return 0;
    };
    match handle
        .sensor
        .update(Sample::new(epoch, id, timestamp_ms, value, quality), now_ms)
    {
        Ok(result) => {
            handle.error.clear();
            if matches!(result, ghostflow_core::signals::UpdateResult::Duplicate) {
                2
            } else {
                1
            }
        }
        Err(error) if error.is_quality_fault() => {
            set_error(handle, error);
            1
        }
        Err(error) => {
            set_error(handle, error);
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_has_sample(handle: *const SignalHandle) -> u32 {
    handle
        .as_ref()
        .and_then(|h| h.sensor.accepted_sample_identity())
        .is_some() as u32
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_sample_epoch(handle: *const SignalHandle) -> u64 {
    handle
        .as_ref()
        .and_then(|h| h.sensor.accepted_sample_identity())
        .map(|identity| identity.0)
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_sample_id(handle: *const SignalHandle) -> u64 {
    handle
        .as_ref()
        .and_then(|h| h.sensor.accepted_sample_identity())
        .map(|identity| identity.1)
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_sample_timestamp(handle: *const SignalHandle) -> u64 {
    handle
        .as_ref()
        .and_then(|h| h.sensor.accepted_sample_identity())
        .map(|identity| identity.2)
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_readquality(handle: *const SignalHandle, now_ms: u64) -> u8 {
    handle
        .as_ref()
        .map(|h| h.sensor.quality(now_ms) as u8)
        .unwrap_or(Quality::Invalid as u8)
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_readvalue(handle: *const SignalHandle, now_ms: u64) -> f64 {
    handle
        .as_ref()
        .and_then(|h| h.sensor.value(now_ms))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_readhysteresis(handle: *const SignalHandle, now_ms: u64) -> i32 {
    handle
        .as_ref()
        .map(|h| h.sensor.read_hysteresis(now_ms).value as i32)
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_reset(handle: *mut SignalHandle) -> i32 {
    let Some(handle) = handle.as_mut() else {
        return 0;
    };
    handle.sensor.reset();
    handle.error.clear();
    1
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_last_error_ptr(handle: *const SignalHandle) -> *const u8 {
    handle
        .as_ref()
        .map(|h| h.error.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[no_mangle]
pub unsafe extern "C" fn gf_signal_last_error_len(handle: *const SignalHandle) -> usize {
    handle.as_ref().map(|h| h.error.len()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_lifecycle_restores_complete_handle_and_keeps_handles_isolated() {
        let mut handle = SignalHandle {
            sensor: Sensor::new(SensorConfig::new(Filter::Ema(1.0), 0.0, 100.0, 10_000, 1))
                .unwrap(),
            error: "prior error".into(),
            checkpoint: None,
        };
        let other = SignalHandle {
            sensor: Sensor::new(SensorConfig::new(Filter::Median(3), -100.0, 200.0, 50, 2))
                .unwrap(),
            error: "other error".into(),
            checkpoint: None,
        };
        unsafe {
            assert_eq!(gf_signal_begin(std::ptr::null_mut()), 0);
            assert_eq!(gf_signal_commit(std::ptr::null_mut()), 0);
            assert_eq!(gf_signal_rollback(std::ptr::null_mut()), 0);
            assert_eq!(gf_signal_commit(&mut handle), 0);
            assert_eq!(gf_signal_rollback(&mut handle), 0);
            assert_eq!(gf_signal_update(&mut handle, 1, 1, 1, 20.0, 1, 1), 1);
            handle.error = "prior error".into();
            assert_eq!(gf_signal_begin(&mut handle), 1);
            assert_eq!(gf_signal_update(&mut handle, 2, 2, 2, 80.0, 1, 2), 1);
            assert_eq!(handle.sensor.diagnostic_count(), 1);
            assert_eq!(gf_signal_begin(&mut handle), 0);
            assert_eq!(gf_signal_reset(&mut handle), 1);
            assert_eq!(gf_signal_rollback(&mut handle), 1);
            assert_eq!(handle.sensor.reading(1), Ok(20.0));
            assert_eq!(handle.sensor.accepted_sample_identity(), Some((1, 1, 1)));
            assert_eq!(handle.sensor.diagnostic_count(), 0);
            assert_eq!(handle.error, "prior error");
            assert_eq!(other.sensor.accepted_sample_identity(), None);
            assert_eq!(other.sensor.config().filter, Filter::Median(3));
            assert_eq!(other.error, "other error");
            assert_eq!(gf_signal_begin(&mut handle), 1);
            assert_eq!(gf_signal_update(&mut handle, 1, 2, 2, 40.0, 1, 2), 1);
            assert_eq!(gf_signal_commit(&mut handle), 1);
            assert_eq!(gf_signal_rollback(&mut handle), 0);
            assert_eq!(handle.sensor.reading(2), Ok(40.0));
            assert_eq!(gf_signal_begin(&mut handle), 1);
            gf_signal_free(Box::into_raw(Box::new(handle)));
        }
        println!(
            "Sensor={} checkpoint-slot={} SignalHandle={} bytes",
            size_of::<Sensor>(),
            size_of::<Option<(Sensor, String)>>(),
            size_of::<SignalHandle>()
        );
    }

    #[test]
    fn sample_identity_exports_preserve_authoritative_tuple() {
        let mut handle = SignalHandle {
            sensor: Sensor::new(SensorConfig::new(Filter::Ema(1.0), 0.0, 100.0, 10_000, 1))
                .unwrap(),
            error: String::new(),
            checkpoint: None,
        };
        unsafe {
            assert_eq!(gf_signal_has_sample(std::ptr::null()), 0);
            assert_eq!(gf_signal_sample_epoch(std::ptr::null()), 0);
            assert_eq!(gf_signal_sample_id(std::ptr::null()), 0);
            assert_eq!(gf_signal_sample_timestamp(std::ptr::null()), 0);
            assert_eq!(gf_signal_has_sample(&handle), 0);
            assert_eq!(
                gf_signal_update(&mut handle, 3, 10, 100, 20.0, Quality::Good as u8, 100),
                1
            );
            assert_eq!(
                gf_signal_update(&mut handle, 3, 5, 150, 99.0, Quality::Good as u8, 150),
                2
            );
            assert_eq!(gf_signal_has_sample(&handle), 1);
            assert_eq!(gf_signal_sample_epoch(&handle), 3);
            assert_eq!(gf_signal_sample_id(&handle), 10);
            assert_eq!(gf_signal_sample_timestamp(&handle), 100);
            assert_eq!(gf_signal_reset(&mut handle), 1);
            assert_eq!(gf_signal_has_sample(&handle), 0);
        }
    }
}
