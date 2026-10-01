//! GFB10 typed schedule/provider requirements and GFSF4 evidence.

use crate::{natural_context::NaturalKind, work_calendar::WorkCalendarSnapshot};
use crate::{Error, Field, Reader, Result, Type};

#[derive(Clone, Debug, PartialEq)]
pub struct DurationSetting {
    pub id: u32,
    pub name: String,
    pub operator_editable: bool,
    pub initial_ms: u64,
    pub min_ms: u64,
    pub max_ms: u64,
    pub step_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ScheduleDefinition {
    AtPulse {
        at_ms: u64,
    },
    /// GFB12 immutable civil Range; UTC recurrence is computed in Rust.
    UtcRange {
        starts_ms: Vec<u64>,
        duration_ms: u64,
    },
    Periodic {
        epoch_id: String,
        anchor_ms: u64,
        every: DurationSetting,
    },
    Cron {
        timezone: String,
        fields: [Vec<u8>; 5],
        dst_missing: u8,
        dst_repeated: u8,
    },
    CalendarDaily {
        timezone: String,
        at_ms: u64,
        calendar: String,
        offday: bool,
        dst_missing: u8,
        dst_repeated: u8,
    },
    HolidayDaily {
        timezone: String,
        at_ms: u64,
        calendar: String,
        dst_missing: u8,
        dst_repeated: u8,
    },
    TideRun {
        timezone: String,
        provider: String,
        high: bool,
        offset_ms: i64,
        run_ms: u64,
        within_ms: u64,
    },
    ConfigDailySlots {
        config_id: u32,
        timezone: String,
        setting: String,
        operator_editable: bool,
        grid_ms: u64,
        capacity: u16,
        initial_minutes: Vec<u16>,
        dst_missing: u8,
        dst_repeated: u8,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScheduleDescriptor {
    pub clock_hold_ms: Option<u64>,
    pub site: u32,
    pub name: String,
    pub gap_ms: u64,
    pub definition: ScheduleDefinition,
    pub when: Vec<u8>,
    pub cancel: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NaturalDescriptor {
    pub site: u32,
    pub name: String,
    pub kind: NaturalKind,
    pub provider: String,
    pub classification: String,
    /// Protected input indices, filled by Rust before expression execution.
    pub ok_input: u16,
    pub value_input: u16,
    pub fault_input: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AccountingDescriptor {
    pub site: u32,
    pub name: String,
    pub account: String,
    pub event: String,
    pub timezone: String,
    pub ok_input: u16,
    pub value_input: u16,
    pub fault_input: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderBinding {
    pub provider: String,
    /// 0 TidePredictions, 1 LunarEphemeris, 2 WorkCalendar.
    pub kind: u8,
    pub namespace: String,
    pub station: String,
    pub binding_revision: String,
    pub location: String,
    pub timezone: String,
    pub criteria: String,
    pub max_uncertainty_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderObservation {
    pub binding: ProviderBinding,
    pub provider_revision: String,
    pub coverage_start_ms: u64,
    pub coverage_end_ms: u64,
    pub expires_at_ms: u64,
    pub uncertainty_ms: u64,
    /// NaturalContextFault's fixed numeric code; None means usable evidence.
    pub fault: Option<u8>,
    pub classifications: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Occurrence {
    pub source_day: i32,
    pub slot_key: u64,
    pub minute_of_day: u16,
    pub fold: u8,
    /// Tide's stable opaque source event ID; empty for civil facts.
    pub event_id: String,
    /// 0 civil, 1 high tide, 2 low tide.
    pub event_kind: u8,
    /// Civil scheduled instant or Tide un-offset predicted instant.
    pub instant_ms: Option<u64>,
    pub withdrawn: bool,
    pub provider_revision: String,
    pub context_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduleEvidence {
    pub site: u32,
    pub coverage_start_ms: u64,
    pub coverage_end_ms: u64,
    pub provider: Option<ProviderObservation>,
    pub calendar: Option<WorkCalendarSnapshot>,
    pub rows: Vec<Occurrence>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettingValue {
    Duration(u64),
    SharedDuration(u64),
    /// Full keyed value: existing key retimes; absent key removes; key 0 adds.
    Slots(Vec<(u64, u16)>),
    /// Already validated/allocated by the shared config stream, not host input.
    SharedSlots(Vec<(u64, u16)>),
}

pub use crate::settings_stream::ConfigEmission as SettingChange;

/// Authenticated by the host boundary; this tag is not an authentication token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsOrigin {
    OperatorEdit,
    ProducerObservation,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SettingsEvent {
    pub program_fingerprint: u64,
    pub event_id: String,
    pub base_revision: u64,
    pub position: u64,
    pub origin: SettingsOrigin,
    pub changes: Vec<SettingChange>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub clock_provenance: Option<String>,
    pub clock_source_revision: Option<String>,
    pub clock_uncertainty_ms: Option<u64>,
    pub unknown_reason: Option<String>,
    pub site: u32,
    pub occurrence_id: String,
    pub planned_ms: Option<u64>,
    pub decision: String,
    pub provider_revision: String,
    pub context_revision: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Decision {
    pub due: bool,
    pub missed: bool,
    pub active: bool,
    pub observations: Vec<Observation>,
}

pub(crate) fn text(reader: &mut Reader<'_>) -> Result<String> {
    let value = reader.string()?;
    if value.is_empty() || value.len() > 128 {
        return Err(Error::new("context identifier must contain 1..128 bytes"));
    }
    Ok(value)
}

pub(crate) fn validate_utc_range(starts: &[u64], duration: u64) -> Result<()> {
    const DAY: u64 = 86_400_000;
    if !(1..=96).contains(&starts.len())
        || duration == 0
        || duration > DAY
        || starts.iter().any(|start| *start >= DAY)
        || starts
            .windows(2)
            .any(|pair| pair[0] >= pair[1] || duration > pair[1] - pair[0])
        || duration > DAY - starts[starts.len() - 1] + starts[0]
    {
        return Err(Error::new("invalid or overlapping UTC Range recurrence"));
    }
    Ok(())
}

fn exact(reader: &mut Reader<'_>) -> Result<u64> {
    let value = reader.u64()?;
    if value > 9_007_199_254_740_991 {
        return Err(Error::new("context time exceeds exact range"));
    }
    Ok(value)
}

fn flag(reader: &mut Reader<'_>) -> Result<bool> {
    match reader.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(Error::new("invalid context flag")),
    }
}

fn dst(reader: &mut Reader<'_>) -> Result<(u8, u8)> {
    let pair = (reader.u8()?, reader.u8()?);
    if pair.0 > 1 || pair.1 > 3 {
        return Err(Error::new("invalid context DST policy"));
    }
    Ok(pair)
}

pub(crate) fn load_schedule(
    reader: &mut Reader<'_>,
    kind: u8,
    format: u16,
    prior: &[crate::schedule_vm::PulseDescriptor],
) -> Result<ScheduleDescriptor> {
    let site = reader.u32()?;
    let name = text(reader)?;
    let gap_ms = exact(reader)?;
    if gap_ms == 0 {
        return Err(Error::new("invalid context schedule gap"));
    }
    let definition = match kind {
        5 => {
            let epoch_id = text(reader)?;
            let anchor_ms = exact(reader)?;
            let every = if format == 10 {
                DurationSetting {
                    id: 0,
                    name: text(reader)?,
                    operator_editable: flag(reader)?,
                    initial_ms: exact(reader)?,
                    min_ms: exact(reader)?,
                    max_ms: exact(reader)?,
                    step_ms: exact(reader)?,
                }
            } else {
                let id = reader.u32()?;
                if id == 0 {
                    let interval = exact(reader)?;
                    DurationSetting {
                        id,
                        name: String::new(),
                        operator_editable: false,
                        initial_ms: interval,
                        min_ms: interval,
                        max_ms: interval,
                        step_ms: 1,
                    }
                } else {
                    let config = prior
                        .iter()
                        .find_map(|p| match p {
                            crate::schedule_vm::PulseDescriptor::Config(c) if c.id == id => Some(c),
                            _ => None,
                        })
                        .ok_or_else(|| Error::new("Periodic config must precede consumer"))?;
                    if config.semantic_type != "Duration" {
                        return Err(Error::new("Periodic config must be Duration"));
                    }
                    let crate::settings_stream::ConfigValue::Scalar(crate::Value::Number(initial)) =
                        config.initial
                    else {
                        return Err(Error::new("invalid Duration config"));
                    };
                    let (min, max, step) = config.bounds.map_or(
                        (1.0, 9_007_199_254_740_991.0, 1.0),
                        |(a, b, c)| match (a, b, c) {
                            (
                                crate::Value::Number(a),
                                crate::Value::Number(b),
                                crate::Value::Number(c),
                            ) => (a, b, c),
                            _ => (0.0, 0.0, 0.0),
                        },
                    );
                    DurationSetting {
                        id,
                        name: config.name.clone(),
                        operator_editable: config.operator_editable,
                        initial_ms: initial as u64,
                        min_ms: min as u64,
                        max_ms: max as u64,
                        step_ms: step as u64,
                    }
                }
            };
            if every.min_ms == 0
                || every.step_ms == 0
                || every.max_ms < every.min_ms
                || every.initial_ms < every.min_ms
                || every.initial_ms > every.max_ms
                || (every.initial_ms - every.min_ms) % every.step_ms != 0
            {
                return Err(Error::new("invalid Periodic setting"));
            }
            ScheduleDefinition::Periodic {
                epoch_id,
                anchor_ms,
                every,
            }
        }
        6 => {
            let timezone = text(reader)?;
            let (dst_missing, dst_repeated) = dst(reader)?;
            let mut fields: [Vec<u8>; 5] = Default::default();
            for (field, (min, max)) in
                fields
                    .iter_mut()
                    .zip([(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)])
            {
                let count = usize::from(reader.u8()?);
                if count == 0 || count > 60 {
                    return Err(Error::new("invalid Cron field length"));
                }
                for _ in 0..count {
                    let value = reader.u8()?;
                    if value < min || value > max || field.last().is_some_and(|last| *last >= value)
                    {
                        return Err(Error::new("invalid Cron field"));
                    }
                    field.push(value);
                }
            }
            if fields[2].len() != 31 && fields[4].len() != 7 {
                return Err(Error::new("Cron cannot restrict both day fields"));
            }
            ScheduleDefinition::Cron {
                timezone,
                fields,
                dst_missing,
                dst_repeated,
            }
        }
        7 => {
            let timezone = text(reader)?;
            let at_ms = exact(reader)?;
            let calendar = text(reader)?;
            let offday = flag(reader)?;
            let (dst_missing, dst_repeated) = dst(reader)?;
            if at_ms >= 86_400_000 {
                return Err(Error::new("invalid calendar Daily time"));
            }
            ScheduleDefinition::CalendarDaily {
                timezone,
                at_ms,
                calendar,
                offday,
                dst_missing,
                dst_repeated,
            }
        }
        8 => {
            let timezone = text(reader)?;
            let provider = text(reader)?;
            let high = flag(reader)?;
            let offset_ms = i64::from_le_bytes(
                reader
                    .take(8)?
                    .try_into()
                    .map_err(|_| Error::new("invalid Tide offset"))?,
            );
            let run_ms = exact(reader)?;
            let within_ms = exact(reader)?;
            if !(-86_400_000..=86_400_000).contains(&offset_ms) || run_ms == 0 || within_ms == 0 {
                return Err(Error::new("invalid Tide Run duration"));
            }
            ScheduleDefinition::TideRun {
                timezone,
                provider,
                high,
                offset_ms,
                run_ms,
                within_ms,
            }
        }
        9 => {
            let timezone = text(reader)?;
            let (config_id, setting, operator_editable, grid_ms, capacity, initial_minutes) =
                if format == 10 {
                    let setting = text(reader)?;
                    let operator_editable = flag(reader)?;
                    let grid_ms = exact(reader)?;
                    let capacity = reader.u16()?;
                    let count = reader.u16()?;
                    if grid_ms == 0
                        || 86_400_000 % grid_ms != 0
                        || capacity == 0
                        || capacity > 1440
                        || count > capacity
                    {
                        return Err(Error::new("invalid configured slots bound"));
                    }
                    let mut minutes = Vec::with_capacity(usize::from(count));
                    for _ in 0..count {
                        let minute = reader.u16()?;
                        if minute >= 1440
                            || u64::from(minute) * 60_000 % grid_ms != 0
                            || minutes.last().is_some_and(|last| *last >= minute)
                        {
                            return Err(Error::new("invalid configured slot"));
                        }
                        minutes.push(minute);
                    }
                    (0, setting, operator_editable, grid_ms, capacity, minutes)
                } else {
                    let config_id = reader.u32()?;
                    let config = prior
                        .iter()
                        .find_map(|p| match p {
                            crate::schedule_vm::PulseDescriptor::Config(c) if c.id == config_id => {
                                Some(c)
                            }
                            _ => None,
                        })
                        .ok_or_else(|| Error::new("TimeSlots config must precede consumer"))?;
                    let crate::settings_stream::ConfigValue::Slots(slots) = &config.initial else {
                        return Err(Error::new("DailySlots config must be TimeSlots"));
                    };
                    (
                        config_id,
                        config.name.clone(),
                        config.operator_editable,
                        config.grid_ms,
                        config.capacity,
                        slots.iter().map(|(_, minute)| *minute).collect(),
                    )
                };
            let (dst_missing, dst_repeated) = dst(reader)?;
            ScheduleDefinition::ConfigDailySlots {
                config_id,
                timezone,
                setting,
                operator_editable,
                grid_ms,
                capacity,
                initial_minutes,
                dst_missing,
                dst_repeated,
            }
        }
        15 if format == 15 => {
            let timezone = text(reader)?;
            let at_ms = exact(reader)?;
            let calendar = text(reader)?;
            let (dst_missing, dst_repeated) = dst(reader)?;
            if at_ms >= 86_400_000 {
                return Err(Error::new("invalid holiday Daily time"));
            }
            ScheduleDefinition::HolidayDaily {
                timezone,
                at_ms,
                calendar,
                dst_missing,
                dst_repeated,
            }
        }
        13 if matches!(format, 12 | 13 | 15) => {
            if text(reader)? != "UTC" {
                return Err(Error::new("Range requires UTC timezone"));
            }
            let duration_ms = exact(reader)?;
            let count = usize::from(reader.u16()?);
            if !(1..=96).contains(&count) {
                return Err(Error::new("invalid UTC Range start count"));
            }
            let mut starts_ms = Vec::with_capacity(count);
            for _ in 0..count {
                starts_ms.push(exact(reader)?);
            }
            validate_utc_range(&starts_ms, duration_ms)?;
            ScheduleDefinition::UtcRange {
                starts_ms,
                duration_ms,
            }
        }
        14 if format == 14 => ScheduleDefinition::AtPulse {
            at_ms: {
                let at = exact(reader)?;
                if at > 253_402_300_799_999 {
                    return Err(Error::new("At DateTime out of range"));
                }
                at
            },
        },
        _ => return Err(Error::new("invalid context schedule kind")),
    };
    let when = reader.blob()?;
    let cancel = reader.blob()?;
    let clock_hold_ms = if matches!(format, 13 | 15) {
        let hold = exact(reader)?;
        if hold != 0 && !matches!(definition, ScheduleDefinition::TideRun { .. }) {
            return Err(Error::new("clock hold requires natural schedule"));
        }
        (hold != 0).then_some(hold)
    } else {
        None
    };
    Ok(ScheduleDescriptor {
        clock_hold_ms,
        site,
        name,
        gap_ms,
        definition,
        when,
        cancel,
    })
}

pub(crate) fn load_natural(reader: &mut Reader<'_>, inputs: &[Field]) -> Result<NaturalDescriptor> {
    let site = reader.u32()?;
    let name = text(reader)?;
    let kind = match reader.u8()? {
        0 => NaturalKind::Tide,
        1 => NaturalKind::Moon,
        _ => return Err(Error::new("invalid natural provider kind")),
    };
    let provider = text(reader)?;
    let classification = text(reader)?;
    let valid = match kind {
        NaturalKind::Tide => matches!(classification.as_str(), "spring" | "neap"),
        NaturalKind::Moon => matches!(
            classification.as_str(),
            "new"
                | "waxing_crescent"
                | "first_quarter"
                | "waxing_gibbous"
                | "full"
                | "waning_gibbous"
                | "last_quarter"
                | "waning_crescent"
        ),
    };
    if !valid {
        return Err(Error::new("invalid natural classification"));
    }
    let ok_input = reader.u16()?;
    let value_input = reader.u16()?;
    let fault_input = reader.u16()?;
    for (index, suffix, ty) in [
        (ok_input, "ok", Type::Bool),
        (value_input, "value", Type::Bool),
        (fault_input, "fault", Type::Number),
    ] {
        let field = inputs
            .get(usize::from(index))
            .ok_or_else(|| Error::new("natural projection index"))?;
        if field.name != format!("__gf_natural_{site}_{suffix}") || field.value_type != ty {
            return Err(Error::new("natural projection binding mismatch"));
        }
    }
    Ok(NaturalDescriptor {
        site,
        name,
        kind,
        provider,
        classification,
        ok_input,
        value_input,
        fault_input,
    })
}

pub(crate) fn load_accounting(
    reader: &mut Reader<'_>,
    inputs: &[Field],
) -> Result<AccountingDescriptor> {
    let site = reader.u32()?;
    let name = text(reader)?;
    let account = text(reader)?;
    let event = text(reader)?;
    let timezone = text(reader)?;
    let ok_input = reader.u16()?;
    let value_input = reader.u16()?;
    let fault_input = reader.u16()?;
    for (index, suffix, ty) in [
        (ok_input, "ok", Type::Bool),
        (value_input, "value", Type::Int),
        (fault_input, "fault", Type::Number),
    ] {
        let field = inputs
            .get(usize::from(index))
            .ok_or_else(|| Error::new("accounting projection index"))?;
        if field.name != format!("__gf_accounting_{site}_{suffix}") || field.value_type != ty {
            return Err(Error::new("accounting projection binding mismatch"));
        }
    }
    Ok(AccountingDescriptor {
        site,
        name,
        account,
        event,
        timezone,
        ok_input,
        value_input,
        fault_input,
    })
}
