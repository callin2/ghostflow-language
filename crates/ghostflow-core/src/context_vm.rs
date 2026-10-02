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
    SolarContext {
        timezone: String,
        latitude: f64,
        longitude: f64,
        event: u8,
        offset_ms: i64,
        fallback_time_ms: Option<u64>,
        config_ids: Vec<u32>,
    },
    AtPulse {
        at_ms: u64,
    },
    /// GFB12 immutable civil Range; UTC recurrence is computed in Rust.
    UtcRange {
        starts_ms: Vec<u64>,
        duration_ms: u64,
        duration: DurationSetting,
    },
    CalendarRange {
        timezone: String,
        starts_ms: Vec<u64>,
        duration_ms: u64,
        calendar: String,
        offday: bool,
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

#[derive(Clone, Debug, PartialEq)]
pub struct CalendarDescriptor {
    pub site: u32,
    pub name: String,
    pub calendar: String,
    pub selector: crate::work_calendar::DaySelector,
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

/// Complete provider facts, never a caller-computed due projection.
#[derive(Clone, Debug, PartialEq)]
pub struct SolarContextEvidence {
    pub site: u32,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
    pub event: u8,
    pub offset_ms: i64,
    pub coverage_start_ms: u64,
    pub coverage_end_ms: u64,
    pub rows: Vec<crate::solar_admission::SolarFact>,
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
    pub solar_fallback: Option<bool>,
    pub solar_unavailable_reason: Option<u8>,
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
        17 if format == 18 => {
            let timezone = text(reader)?;
            let duration_ms = exact(reader)?;
            let count = usize::from(reader.u16()?);
            if timezone != "UTC" || count != 1 {
                return Err(Error::new(
                    "calendar Range requires one static UTC Daily start",
                ));
            }
            let starts_ms = vec![exact(reader)?];
            validate_utc_range(&starts_ms, duration_ms)?;
            if starts_ms[0] + duration_ms > 86_400_000 {
                return Err(Error::new(
                    "calendar Range crosses midnight; split explicit intervals",
                ));
            }
            let calendar = text(reader)?;
            let offday = flag(reader)?;
            ScheduleDefinition::CalendarRange {
                timezone,
                starts_ms,
                duration_ms,
                calendar,
                offday,
            }
        }
        16 if format == 16 => {
            let timezone = text(reader)?;
            let latitude = reader.f64()?;
            let longitude = reader.f64()?;
            let event = reader.u8()?;
            let offset_ms = reader.u64()? as i64;
            let fallback = exact(reader)?;
            let count = usize::from(reader.u16()?);
            if !latitude.is_finite()
                || !longitude.is_finite()
                || !(-90.0..=90.0).contains(&latitude)
                || !(-180.0..=180.0).contains(&longitude)
                || event > 1
                || offset_ms.unsigned_abs() > 86_400_000
                || fallback > 86_400_000
                || count > 128
            {
                return Err(Error::new("invalid context Solar descriptor"));
            }
            let mut config_ids = Vec::with_capacity(count);
            for _ in 0..count {
                let id = reader.u32()?;
                if id == 0 || config_ids.last().is_some_and(|old| *old >= id)
                    || !prior.iter().any(|d| matches!(d, crate::schedule_vm::PulseDescriptor::Config(c) if c.id == id))
                { return Err(Error::new("invalid Solar config dependency")); }
                config_ids.push(id);
            }
            ScheduleDefinition::SolarContext {
                timezone,
                latitude,
                longitude,
                event,
                offset_ms,
                fallback_time_ms: (fallback != 86_400_000).then_some(fallback),
                config_ids,
            }
        }
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
        15 if matches!(format, 15 | 16 | 18) => {
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
        13 if matches!(format, 12 | 13 | 15 | 18) => {
            if text(reader)? != "UTC" {
                return Err(Error::new("Range requires UTC timezone"));
            }
            let duration_ms = exact(reader)?;
            let duration_config_id = if duration_ms == 0 {
                Some(reader.u32()?)
            } else {
                None
            };
            let count = usize::from(reader.u16()?);
            if !(1..=96).contains(&count) {
                return Err(Error::new("invalid UTC Range start count"));
            }
            let mut starts_ms = Vec::with_capacity(count);
            for _ in 0..count {
                starts_ms.push(exact(reader)?);
            }
            let duration =
                if let Some(id) = duration_config_id {
                    let config = prior
                        .iter()
                        .find_map(|p| match p {
                            crate::schedule_vm::PulseDescriptor::Config(c) if c.id == id => Some(c),
                            _ => None,
                        })
                        .ok_or_else(|| Error::new("Range duration config must precede consumer"))?;
                    if config.semantic_type != "Duration" {
                        return Err(Error::new("Range duration config must be Duration"));
                    }
                    let crate::settings_stream::ConfigValue::Scalar(crate::Value::Number(initial)) =
                        config.initial
                    else {
                        return Err(Error::new("invalid Range Duration config"));
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
                } else {
                    DurationSetting {
                        id: 0,
                        name: String::new(),
                        operator_editable: false,
                        initial_ms: duration_ms,
                        min_ms: duration_ms,
                        max_ms: duration_ms,
                        step_ms: 1,
                    }
                };
            if duration.min_ms == 0
                || duration.step_ms == 0
                || duration.max_ms < duration.min_ms
                || duration.initial_ms < duration.min_ms
                || duration.initial_ms > duration.max_ms
                || (duration.initial_ms - duration.min_ms) % duration.step_ms != 0
            {
                return Err(Error::new("invalid Range duration setting"));
            }
            validate_utc_range(&starts_ms, duration.initial_ms)?;
            ScheduleDefinition::UtcRange {
                starts_ms,
                duration_ms: duration.initial_ms,
                duration,
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
    if let ScheduleDefinition::SolarContext { config_ids, .. } = &definition {
        if *config_ids != config_dependencies(&when, prior)? {
            return Err(Error::new(
                "Solar config dependencies differ from protected input reads",
            ));
        }
    }
    let clock_hold_ms = if matches!(format, 13 | 15 | 16) {
        let hold = exact(reader)?;
        if hold != 0
            && !matches!(
                definition,
                ScheduleDefinition::TideRun { .. } | ScheduleDefinition::SolarContext { .. }
            )
        {
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

/// Decode instructions rather than trusting compiler dependency metadata or
/// searching byte values inside immediates. Result branches read all three
/// protected rails; every referenced rail binds the owning current Result.
fn config_dependencies(
    code: &[u8],
    prior: &[crate::schedule_vm::PulseDescriptor],
) -> Result<Vec<u32>> {
    let mut r = Reader::new(code);
    let mut reads = std::collections::BTreeSet::new();
    while !r.finished() {
        match r.u8()? {
            1 => {
                r.take(1)?;
            }
            2 => {
                r.take(8)?;
            }
            3 => {
                reads.insert(r.u16()?);
            }
            4 | 5 | 30 | 31 => {
                r.take(2)?;
            }
            23 | 56 => {
                r.take(4)?;
            }
            57..=59 => {
                r.take(3)?;
            }
            10 | 13..=22 | 24..=29 | 32..=55 => {}
            _ => return Err(Error::new("unknown expression opcode")),
        }
    }
    let mut ids: Vec<_> = prior
        .iter()
        .filter_map(|d| match d {
            crate::schedule_vm::PulseDescriptor::Config(c)
                if [c.ok_input, c.value_input, c.fault_input]
                    .iter()
                    .any(|i| reads.contains(i)) =>
            {
                Some(c.id)
            }
            _ => None,
        })
        .collect();
    ids.sort_unstable();
    Ok(ids)
}

#[cfg(test)]
mod calendar18_loader_tests {
    use super::*;

    fn string(out: &mut Vec<u8>, value: &str) {
        out.extend_from_slice(&(value.len() as u16).to_le_bytes());
        out.extend_from_slice(value.as_bytes());
    }

    fn range(timezone: &str, start: u64, duration: u64, selector: u8) -> Vec<u8> {
        let mut out = 7u32.to_le_bytes().to_vec();
        string(&mut out, "work-range");
        out.extend_from_slice(&1_000u64.to_le_bytes());
        string(&mut out, timezone);
        out.extend_from_slice(&duration.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&start.to_le_bytes());
        string(&mut out, "workers");
        out.push(selector);
        for value in [true, false] {
            out.extend_from_slice(&2u32.to_le_bytes());
            out.extend_from_slice(&[1, u8::from(value)]);
        }
        out
    }

    #[test]
    fn calendar18_loader_rejects_overnight_timezone_bad_selector_and_old_profile() {
        let endpoint = range("UTC", 23 * 3_600_000, 3_600_000, 0);
        assert!(load_schedule(&mut Reader::new(&endpoint), 17, 18, &[]).is_ok());
        for bytes in [
            range("UTC", 23 * 3_600_000, 3_600_001, 0),
            range("Asia/Seoul", 0, 100, 0),
            range("UTC", 0, 100, 2),
            range("UTC", 0, 0, 0),
        ] {
            assert!(load_schedule(&mut Reader::new(&bytes), 17, 18, &[]).is_err());
        }
        for format in [10, 11, 12, 13, 14, 15, 16, 17] {
            assert!(load_schedule(&mut Reader::new(&endpoint), 17, format, &[]).is_err());
        }
        // The original static Range contract still permits an interval across midnight.
        assert!(validate_utc_range(&[23 * 3_600_000], 2 * 3_600_000).is_ok());
    }

    #[test]
    fn calendar18_result_loader_verifies_typed_protected_projection_rails() {
        let mut bytes = 7u32.to_le_bytes().to_vec();
        string(&mut bytes, "working");
        string(&mut bytes, "workers");
        bytes.push(0);
        string(&mut bytes, "UTC");
        for index in [0u16, 1, 2] {
            bytes.extend_from_slice(&index.to_le_bytes());
        }
        let mut fields = [
            Field {
                name: "__gf_calendar_7_ok".into(),
                value_type: Type::Bool,
                default: crate::Value::Bool(false),
            },
            Field {
                name: "__gf_calendar_7_value".into(),
                value_type: Type::Bool,
                default: crate::Value::Bool(false),
            },
            Field {
                name: "__gf_calendar_7_fault".into(),
                value_type: Type::Number,
                default: crate::Value::Number(0.0),
            },
        ];
        assert!(load_calendar(&mut Reader::new(&bytes), &fields).is_ok());
        fields[0].name = "host_permission".into();
        assert!(load_calendar(&mut Reader::new(&bytes), &fields).is_err());
        fields[0].name = "__gf_calendar_7_ok".into();
        fields[1].value_type = Type::Number;
        assert!(load_calendar(&mut Reader::new(&bytes), &fields).is_err());
        fields[1].value_type = Type::Bool;
        let len = bytes.len();
        bytes[len - 2..].copy_from_slice(&0u16.to_le_bytes());
        assert!(load_calendar(&mut Reader::new(&bytes), &fields).is_err());
    }
}

pub(crate) fn load_calendar(
    reader: &mut Reader<'_>,
    inputs: &[Field],
) -> Result<CalendarDescriptor> {
    let site = reader.u32()?;
    let name = text(reader)?;
    let calendar = text(reader)?;
    let selector = match reader.u8()? {
        0 => crate::work_calendar::DaySelector::Workday,
        1 => crate::work_calendar::DaySelector::Offday,
        2 => crate::work_calendar::DaySelector::Holiday,
        _ => return Err(Error::new("invalid calendar selector")),
    };
    let timezone = text(reader)?;
    if timezone != "UTC" {
        return Err(Error::new("calendar Result requires explicit UTC binding"));
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
            .ok_or_else(|| Error::new("calendar projection index"))?;
        if field.name != format!("__gf_calendar_{site}_{suffix}") || field.value_type != ty {
            return Err(Error::new("calendar projection binding mismatch"));
        }
    }
    Ok(CalendarDescriptor {
        site,
        name,
        calendar,
        selector,
        timezone,
        ok_input,
        value_input,
        fault_input,
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

#[cfg(test)]
mod solar_dependency_tests {
    use super::*;
    use crate::schedule_vm::PulseDescriptor;
    fn config() -> PulseDescriptor {
        PulseDescriptor::Config(crate::settings_stream::ConfigDescriptor {
            id: 7,
            name: "enabled".into(),
            semantic_type: "Bool".into(),
            kind: 0,
            operator_editable: true,
            initial: crate::settings_stream::ConfigValue::Scalar(crate::Value::Bool(true)),
            bounds: None,
            grid_ms: 0,
            capacity: 0,
            ok_input: 2,
            value_input: 3,
            fault_input: 4,
        })
    }
    fn text(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
    }
    fn encoded(ids: &[u32], when: &[u8]) -> Vec<u8> {
        let mut bytes = 8u32.to_le_bytes().to_vec();
        text(&mut bytes, "rise");
        bytes.extend_from_slice(&1_000u64.to_le_bytes());
        text(&mut bytes, "UTC");
        bytes.extend_from_slice(&37f64.to_le_bytes());
        bytes.extend_from_slice(&127f64.to_le_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&0i64.to_le_bytes());
        bytes.extend_from_slice(&86_400_000u64.to_le_bytes());
        bytes.extend_from_slice(&(ids.len() as u16).to_le_bytes());
        for id in ids {
            bytes.extend_from_slice(&id.to_le_bytes());
        }
        for code in [when, &[1, 0][..]] {
            bytes.extend_from_slice(&(code.len() as u32).to_le_bytes());
            bytes.extend_from_slice(code);
        }
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes
    }
    fn module_bytes(ids: &[u32], when: &[u8]) -> Vec<u8> {
        let mut bytes = b"GFB1\x10\x00".to_vec();
        text(&mut bytes, "dependency-contract");
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&5u16.to_le_bytes());
        for (name, ty) in [
            ("__gf_now_ms", 2),
            ("__gf_time_epoch", 2),
            ("__gf_config_7_ok", 1),
            ("__gf_config_7_value", 1),
            ("__gf_config_7_fault", 2),
        ] {
            text(&mut bytes, name);
            bytes.push(ty);
        }
        bytes.extend_from_slice(&0u16.to_le_bytes()); // states
        for n in [0u16, 1, 0, 1] {
            bytes.extend_from_slice(&n.to_le_bytes());
        } // clock indices, roots, strategies
        text(&mut bytes, "control");
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&[5, 1]);
        bytes.extend_from_slice(&2u16.to_le_bytes()); // two descriptors
        bytes.push(12);
        bytes.extend_from_slice(&7u32.to_le_bytes());
        text(&mut bytes, "enabled");
        text(&mut bytes, "Bool");
        bytes.extend_from_slice(&[0, 1, 1, 0]); // Bool/operator/true/no bounds
        for n in [2u16, 3, 4] {
            bytes.extend_from_slice(&n.to_le_bytes());
        }
        bytes.push(16);
        bytes.extend_from_slice(&encoded(ids, when));
        for _ in 0..4 {
            bytes.extend_from_slice(&0u16.to_le_bytes());
        } // transitions, intents, constraints, objective
        bytes
    }
    #[test]
    fn module_loader_rejects_forged_solar_config_dependency_omission() {
        let valid = module_bytes(&[7], &[3, 3, 0]);
        assert!(crate::Module::load(&valid).is_ok());
        let forged = module_bytes(&[], &[3, 3, 0]);
        assert!(crate::Module::load(&forged)
            .err()
            .unwrap()
            .to_string()
            .contains("dependencies differ from protected input reads"));
        assert!(crate::Module::load(&module_bytes(&[7], &[1, 1])).is_err());
    }
    #[test]
    fn solar_dependency_metadata_must_match_decoded_protected_rails() {
        let prior = [config()];
        for input in [2, 3, 4] {
            let code = [3, input, 0];
            assert_eq!(config_dependencies(&code, &prior).unwrap(), vec![7]);
            assert!(load_schedule(&mut Reader::new(&encoded(&[], &code)), 16, 16, &prior).is_err());
            assert!(load_schedule(&mut Reader::new(&encoded(&[7], &code)), 16, 16, &prior).is_ok());
        }
        // The read-looking bytes are inside a floating-point immediate.
        let mut immediate = vec![2];
        immediate.extend_from_slice(&[3, 2, 0, 0, 0, 0, 0, 0]);
        assert!(config_dependencies(&immediate, &prior).unwrap().is_empty());
        assert!(load_schedule(&mut Reader::new(&encoded(&[7], &[1, 1])), 16, 16, &prior).is_err());
        assert!(load_schedule(&mut Reader::new(&encoded(&[8], &[1, 1])), 16, 16, &prior).is_err());
        assert!(load_schedule(
            &mut Reader::new(&encoded(&[7, 7], &[3, 2, 0])),
            16,
            16,
            &prior
        )
        .is_err());
        assert!(
            load_schedule(&mut Reader::new(&encoded(&[7], &[3, 2, 0])), 16, 15, &prior).is_err()
        );
    }
}
