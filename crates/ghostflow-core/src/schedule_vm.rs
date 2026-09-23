//! Verified GFB5 requirements, without schedule execution or provider bindings.

use crate::{
    expression_metadata, temporal_vm, verify_expression_with_prelude, Error, Field, Reader, Result,
    Type, MAX_STATES,
};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolarEvent {
    Rise,
    Set,
}

/// GFB5 currently encodes only pulse/trusted_only/baseline/skip (all policy bytes zero).
#[derive(Clone, Debug, PartialEq)]
pub struct SolarPulseDescriptor {
    pub site: u32,
    pub name: String,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
    pub event: SolarEvent,
    pub offset_ms: i64,
    pub gap_ms: u64,
    pub when: Vec<u8>,
}

/// Slots are dense within their own kind; order is shared across both kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreludeEntry {
    Window(u16),
    Schedule(u16),
    TrueFor(u16),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleStrategy {
    pub name: String,
    pub schedules: Vec<SolarPulseDescriptor>,
    pub prelude: Vec<PreludeEntry>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleRequirements {
    /// Same order as the module strategies. Clock/root bindings are shared with temporal requirements.
    pub strategies: Vec<ScheduleStrategy>,
}

pub(crate) struct LoadedPrelude {
    pub windows: Vec<temporal_vm::WindowDescriptor>,
    pub schedules: Vec<SolarPulseDescriptor>,
    pub true_fors: Vec<crate::true_for_vm::TrueForDescriptor>,
    pub order: Vec<PreludeEntry>,
    pub marker_count: usize,
}

pub(crate) fn load_prelude(
    reader: &mut Reader<'_>,
    inputs: &[Field],
    states: &[Field],
    roots: &[temporal_vm::TemporalRoot],
    format: u16,
) -> Result<LoadedPrelude> {
    let count = usize::from(reader.u16()?);
    if count > MAX_STATES - states.len() {
        return Err(Error::new("prelude state limit exceeded"));
    }
    let mut result = LoadedPrelude {
        windows: Vec::new(),
        schedules: Vec::new(),
        true_fors: Vec::new(),
        order: Vec::with_capacity(count),
        marker_count: 0,
    };
    let mut sites = BTreeSet::new();
    let mut names = BTreeSet::new();
    for _ in 0..count {
        let (site, name) = match reader.u8()? {
            0 => {
                let (window, markers) = temporal_vm::load_window(
                    reader,
                    inputs,
                    states,
                    roots,
                    &result.windows,
                    result.schedules.len(),
                    result.true_fors.len(),
                    format,
                )?;
                let identity = (window.site, window.name.clone());
                result.marker_count += markers;
                result
                    .order
                    .push(PreludeEntry::Window(result.windows.len() as u16));
                result.windows.push(window);
                identity
            }
            1 => {
                let site = reader.u32()?;
                let name = reader.string()?;
                let timezone = reader.string()?;
                let latitude = reader.f64()?;
                if !(-90.0..=90.0).contains(&latitude) {
                    return Err(Error::new("invalid solar latitude"));
                }
                let longitude = reader.f64()?;
                if !(-180.0..=180.0).contains(&longitude) {
                    return Err(Error::new("invalid solar longitude"));
                }
                let event = match reader.u8()? {
                    0 => SolarEvent::Rise,
                    1 => SolarEvent::Set,
                    _ => return Err(Error::new("invalid solar event")),
                };
                let offset_ms = i64::from_le_bytes(reader.take(8)?.try_into().unwrap());
                if !(-86_400_000..=86_400_000).contains(&offset_ms) {
                    return Err(Error::new("invalid solar offset"));
                }
                for _ in 0..4 {
                    if reader.u8()? != 0 {
                        return Err(Error::new("unsupported schedule policy"));
                    }
                }
                let gap_ms = reader.u64()?;
                if !(1..=9_007_199_254_740_991).contains(&gap_ms) {
                    return Err(Error::new("invalid schedule gap"));
                }
                let when = reader.blob()?;
                if verify_expression_with_prelude(
                    &when,
                    inputs,
                    states,
                    false,
                    format,
                    &result.windows,
                    result.schedules.len(),
                    result.true_fors.len(),
                )? != Type::Bool
                {
                    return Err(Error::new("schedule predicate must be Bool"));
                }
                result.marker_count += expression_metadata(&when)?.1;
                result
                    .order
                    .push(PreludeEntry::Schedule(result.schedules.len() as u16));
                result.schedules.push(SolarPulseDescriptor {
                    site,
                    name: name.clone(),
                    timezone,
                    latitude,
                    longitude,
                    event,
                    offset_ms,
                    gap_ms,
                    when,
                });
                (site, name)
            }
            2 if format >= 6 => {
                let signal = crate::true_for_vm::load(reader, inputs)?;
                let identity = (signal.site, signal.name.clone());
                result
                    .order
                    .push(PreludeEntry::TrueFor(result.true_fors.len() as u16));
                result.true_fors.push(signal);
                identity
            }
            _ => return Err(Error::new("invalid prelude kind")),
        };
        if site == 0 || !sites.insert(site) {
            return Err(Error::new("invalid prelude site"));
        }
        if !names.insert(name) {
            return Err(Error::new("duplicate prelude name"));
        }
    }
    Ok(result)
}

pub(crate) fn projection_type(schedule_count: usize, slot: u16, field: u8) -> Result<Type> {
    if usize::from(slot) >= schedule_count {
        return Err(Error::new("schedule projection index"));
    }
    if field > 1 {
        return Err(Error::new("schedule projection field"));
    }
    Ok(Type::Bool)
}
