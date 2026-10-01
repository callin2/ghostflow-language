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
    pub clock_hold_ms: Option<u64>,
    pub fallback_time_ms: Option<u64>,
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

#[derive(Clone, Debug, PartialEq)]
pub struct DailyPulseDescriptor {
    pub site: u32,
    pub name: String,
    pub timezone: String,
    pub at_ms: u64,
    /// 0 skip, 1 next_valid.
    pub dst_missing: u8,
    /// 0 first, 1 second, 2 both, 3 skip.
    pub dst_repeated: u8,
    pub gap_ms: u64,
    pub when: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DailySlotsPulseDescriptor {
    pub site: u32,
    pub name: String,
    pub timezone: String,
    pub grid_ms: u64,
    /// 0 skip, 1 next_valid.
    pub dst_missing: u8,
    /// 0 first, 1 second, 2 both, 3 skip.
    pub dst_repeated: u8,
    pub gap_ms: u64,
    /// Stable literal definition keys paired with their declared civil minute.
    pub slots: Vec<(u16, u16)>,
    pub when: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PulseDescriptor {
    Solar(SolarPulseDescriptor),
    Daily(DailyPulseDescriptor),
    DailySlots(DailySlotsPulseDescriptor),
    Context(crate::context_vm::ScheduleDescriptor),
    Natural(crate::context_vm::NaturalDescriptor),
    Accounting(crate::context_vm::AccountingDescriptor),
    Config(crate::settings_stream::ConfigDescriptor),
}
impl PulseDescriptor {
    pub fn site(&self) -> u32 {
        match self {
            Self::Solar(d) => d.site,
            Self::Daily(d) => d.site,
            Self::DailySlots(d) => d.site,
            Self::Context(d) => d.site,
            Self::Natural(d) => d.site,
            Self::Accounting(d) => d.site,
            Self::Config(d) => d.id,
        }
    }
    pub fn gap_ms(&self) -> u64 {
        match self {
            Self::Solar(d) => d.gap_ms,
            Self::Daily(d) => d.gap_ms,
            Self::DailySlots(d) => d.gap_ms,
            Self::Context(d) => d.gap_ms,
            Self::Natural(_) => 1,
            Self::Accounting(_) => 1,
            Self::Config(_) => 1,
        }
    }
    pub fn when(&self) -> &[u8] {
        match self {
            Self::Solar(d) => &d.when,
            Self::Daily(d) => &d.when,
            Self::DailySlots(d) => &d.when,
            Self::Context(d) => &d.when,
            Self::Natural(_) => &[],
            Self::Accounting(_) => &[],
            Self::Config(_) => &[],
        }
    }
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
    pub schedules: Vec<PulseDescriptor>,
    pub prelude: Vec<PreludeEntry>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleRequirements {
    /// Same order as the module strategies. Clock/root bindings are shared with temporal requirements.
    pub strategies: Vec<ScheduleStrategy>,
}

pub(crate) struct LoadedPrelude {
    pub windows: Vec<temporal_vm::WindowDescriptor>,
    pub schedules: Vec<PulseDescriptor>,
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
                let (clock_hold_ms, fallback_time_ms) = if matches!(format, 13 | 15) {
                    let hold = reader.u64()?;
                    let fallback = reader.u64()?;
                    if hold > 9_007_199_254_740_991 || fallback > 86_400_000 {
                        return Err(Error::new("invalid natural availability policy"));
                    }
                    (
                        (hold != 0).then_some(hold),
                        (fallback != 86_400_000).then_some(fallback),
                    )
                } else {
                    (None, None)
                };
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
                result
                    .schedules
                    .push(PulseDescriptor::Solar(SolarPulseDescriptor {
                        clock_hold_ms,
                        fallback_time_ms,
                        site,
                        name: name.clone(),
                        timezone,
                        latitude,
                        longitude,
                        event,
                        offset_ms,
                        gap_ms,
                        when,
                    }));
                (site, name)
            }
            3 if matches!(format, 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15) => {
                let site = reader.u32()?;
                let name = reader.string()?;
                let timezone = reader.string()?;
                let at_ms = reader.u64()?;
                let dst_missing = reader.u8()?;
                let dst_repeated = reader.u8()?;
                if timezone.is_empty() || at_ms >= 86_400_000 || dst_missing > 1 || dst_repeated > 3
                {
                    return Err(Error::new("invalid Daily descriptor"));
                }
                for _ in 0..4 {
                    if reader.u8()? != 0 {
                        return Err(Error::new("unsupported Daily policy"));
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
                result
                    .schedules
                    .push(PulseDescriptor::Daily(DailyPulseDescriptor {
                        site,
                        name: name.clone(),
                        timezone,
                        at_ms,
                        dst_missing,
                        dst_repeated,
                        gap_ms,
                        when,
                    }));
                (site, name)
            }
            4 if matches!(format, 9 | 10 | 11 | 12 | 13 | 14 | 15) => {
                let site = reader.u32()?;
                let name = reader.string()?;
                let timezone = reader.string()?;
                let grid_ms = reader.u64()?;
                let dst_missing = reader.u8()?;
                let dst_repeated = reader.u8()?;
                if timezone.is_empty() || grid_ms != 900_000 || dst_missing > 1 || dst_repeated > 3
                {
                    return Err(Error::new("invalid DailySlots descriptor"));
                }
                for _ in 0..4 {
                    if reader.u8()? != 0 {
                        return Err(Error::new("unsupported DailySlots policy"));
                    }
                }
                let gap_ms = reader.u64()?;
                if !(1..=9_007_199_254_740_991).contains(&gap_ms) {
                    return Err(Error::new("invalid schedule gap"));
                }
                let slot_count = usize::from(reader.u16()?);
                if !(1..=96).contains(&slot_count) {
                    return Err(Error::new("invalid DailySlots slots"));
                }
                let mut slots = Vec::with_capacity(slot_count);
                for _ in 0..slot_count {
                    let key = reader.u16()?;
                    let minute = reader.u16()?;
                    if minute >= 1_440 || key != minute + 1 || minute % 15 != 0 {
                        return Err(Error::new("invalid DailySlots slot"));
                    }
                    if slots
                        .last()
                        .is_some_and(|(_, previous)| *previous >= minute)
                    {
                        return Err(Error::new("invalid DailySlots slot order"));
                    }
                    slots.push((key, minute));
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
                result
                    .schedules
                    .push(PulseDescriptor::DailySlots(DailySlotsPulseDescriptor {
                        site,
                        name: name.clone(),
                        timezone,
                        grid_ms,
                        dst_missing,
                        dst_repeated,
                        gap_ms,
                        slots,
                        when,
                    }));
                (site, name)
            }
            kind if (matches!(kind, 5..=9) && matches!(format, 10 | 11 | 12 | 13 | 14 | 15))
                || (kind == 13 && matches!(format, 12 | 13 | 14 | 15))
                || (kind == 15 && format == 15)
                || (kind == 14 && format == 14) =>
            {
                let descriptor =
                    crate::context_vm::load_schedule(reader, kind, format, &result.schedules)?;
                for expression in [&descriptor.when, &descriptor.cancel] {
                    if verify_expression_with_prelude(
                        expression,
                        inputs,
                        states,
                        false,
                        format,
                        &result.windows,
                        result.schedules.len(),
                        result.true_fors.len(),
                    )? != Type::Bool
                    {
                        return Err(Error::new("context predicate must be Bool"));
                    }
                    result.marker_count += expression_metadata(expression)?.1;
                }
                let identity = (descriptor.site, descriptor.name.clone());
                result
                    .order
                    .push(PreludeEntry::Schedule(result.schedules.len() as u16));
                result.schedules.push(PulseDescriptor::Context(descriptor));
                identity
            }
            10 if matches!(format, 10 | 11 | 12 | 13 | 14 | 15) => {
                let descriptor = crate::context_vm::load_natural(reader, inputs)?;
                let identity = (descriptor.site, descriptor.name.clone());
                result
                    .order
                    .push(PreludeEntry::Schedule(result.schedules.len() as u16));
                result.schedules.push(PulseDescriptor::Natural(descriptor));
                identity
            }
            11 if matches!(format, 10 | 11 | 12 | 13 | 14 | 15) => {
                let descriptor = crate::context_vm::load_accounting(reader, inputs)?;
                let identity = (descriptor.site, descriptor.name.clone());
                result
                    .order
                    .push(PreludeEntry::Schedule(result.schedules.len() as u16));
                result
                    .schedules
                    .push(PulseDescriptor::Accounting(descriptor));
                identity
            }
            12 if matches!(format, 11 | 12 | 13 | 14 | 15) => {
                let descriptor = crate::settings_stream::load(reader, inputs)?;
                let identity = (descriptor.id, descriptor.name.clone());
                result
                    .order
                    .push(PreludeEntry::Schedule(result.schedules.len() as u16));
                result.schedules.push(PulseDescriptor::Config(descriptor));
                identity
            }
            2 if format == 6 => {
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

pub(crate) fn projection_type(
    schedule_count: usize,
    slot: u16,
    field: u8,
    format: u16,
) -> Result<Type> {
    if usize::from(slot) >= schedule_count {
        return Err(Error::new("schedule projection index"));
    }
    if field
        > if matches!(format, 10 | 11 | 12 | 13 | 14 | 15) {
            2
        } else {
            1
        }
    {
        return Err(Error::new("schedule projection field"));
    }
    Ok(Type::Bool)
}
