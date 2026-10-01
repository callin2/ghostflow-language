//! GFB10 schedule state. Each scan clones the engine; the caller commits the
//! staged clone only after the whole VM scan succeeds.

use crate::context_vm::{
    Decision, Observation, ScheduleDefinition, ScheduleDescriptor, ScheduleEvidence, SettingValue,
};
use crate::cron_schedule::{CivilSlot, CronFields, RepeatedPolicy};
use crate::range_schedule::{RangeDecision, RangeEngine, RangeFact};
use crate::schedule_clock::{ClockDisposition, ClockSnapshot, ClockTrust, ScheduleClockGate};
use crate::work_calendar::{self, DayQuery, DaySelector};
use crate::{Error, Result};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
pub struct Engine {
    solar: Option<crate::solar_admission::SolarPulseEngine>,
    solar_settings_baseline: bool,
    clock: ScheduleClockGate,
    terminal: BTreeSet<String>,
    capacity: usize,
    phase_revision: u64,
    interval_ms: Option<u64>,
    slots: Vec<(u64, u16)>,
    next_slot_key: u64,
    added_at_wall: BTreeMap<u64, u64>,
    active_run: Option<ActiveRun>,
    last_plan: BTreeMap<String, u64>,
    pending_grace: BTreeMap<String, (u64, String, String)>,
    range: Option<RangeEngine>,
    range_clock_revision: Option<String>,
    range_calendar_revision: Option<String>,
}

#[derive(Clone)]
struct ActiveRun {
    id: String,
    end_monotonic_ms: u64,
    planned_ms: u64,
    provider_revision: String,
    context_revision: String,
}

fn invalid(message: &str) -> Error {
    Error::new(message)
}

fn write_len(bytes: &mut Vec<u8>, len: usize) -> Result<()> {
    let value =
        u16::try_from(len).map_err(|_| invalid("context checkpoint collection exceeds bound"))?;
    bytes.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

fn write_string(bytes: &mut Vec<u8>, value: &str) -> Result<()> {
    if value.len() > 1024 {
        return Err(invalid("context checkpoint identity exceeds bound"));
    }
    write_len(bytes, value.len())?;
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}

struct SnapshotReader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> SnapshotReader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(len)
            .ok_or_else(|| invalid("context checkpoint length overflow"))?;
        let result = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| invalid("truncated context checkpoint"))?;
        self.at = end;
        Ok(result)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn string(&mut self) -> Result<String> {
        let len = self.u16()? as usize;
        if len > 1024 {
            return Err(invalid("context checkpoint identity exceeds bound"));
        }
        let bytes = self.take(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| invalid("invalid context checkpoint UTF-8"))
    }
}

impl Engine {
    pub fn effective_setting(&self, desc: &ScheduleDescriptor) -> Option<SettingValue> {
        match desc.definition {
            ScheduleDefinition::Periodic { .. } => self.interval_ms.map(SettingValue::Duration),
            ScheduleDefinition::ConfigDailySlots { .. } => {
                Some(SettingValue::Slots(self.slots.clone()))
            }
            _ => None,
        }
    }

    pub fn snapshot(&self) -> Result<Vec<u8>> {
        if let Some(solar) = &self.solar {
            let mut bytes = b"GFES\x03".to_vec();
            write_len(&mut bytes, solar.terminal_identities().len())?;
            for (day, _, _) in solar.terminal_identities() {
                bytes.extend_from_slice(&day.to_le_bytes());
            }
            return Ok(bytes);
        }
        if let Some(range) = &self.range {
            // Only consumed identities are durable. Active monotonic references
            // cannot be transferred to a new boot and are never resumed.
            let mut bytes = b"GFES\x02GFRG\x01".to_vec();
            write_len(&mut bytes, range.terminal_keys().len())?;
            for key in range.terminal_keys() {
                write_string(&mut bytes, key)?;
            }
            return Ok(bytes);
        }
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"GFES");
        bytes.push(1);
        bytes.extend_from_slice(&self.phase_revision.to_le_bytes());
        bytes.push(u8::from(self.interval_ms.is_some()));
        bytes.extend_from_slice(&self.interval_ms.unwrap_or(0).to_le_bytes());
        write_len(&mut bytes, self.slots.len())?;
        for &(key, minute) in &self.slots {
            bytes.extend_from_slice(&key.to_le_bytes());
            bytes.extend_from_slice(&minute.to_le_bytes());
        }
        bytes.extend_from_slice(&self.next_slot_key.to_le_bytes());
        write_len(&mut bytes, self.added_at_wall.len())?;
        for (&key, &at) in &self.added_at_wall {
            bytes.extend_from_slice(&key.to_le_bytes());
            bytes.extend_from_slice(&at.to_le_bytes());
        }
        write_len(&mut bytes, self.terminal.len())?;
        for id in &self.terminal {
            write_string(&mut bytes, id)?;
        }
        write_len(&mut bytes, self.last_plan.len())?;
        for (id, &planned) in &self.last_plan {
            write_string(&mut bytes, id)?;
            bytes.extend_from_slice(&planned.to_le_bytes());
        }
        if bytes.len() > 1_048_576 {
            return Err(invalid("context checkpoint exceeds bound"));
        }
        Ok(bytes)
    }

    pub fn restore(
        desc: &ScheduleDescriptor,
        boot_epoch: u64,
        capacity: usize,
        bytes: &[u8],
    ) -> Result<Self> {
        if bytes.len() > 1_048_576 {
            return Err(invalid("context checkpoint exceeds bound"));
        }
        let mut reader = SnapshotReader { bytes, at: 0 };
        if matches!(desc.definition, ScheduleDefinition::SolarContext { .. }) {
            if reader.take(5)? != b"GFES\x03" {
                return Err(invalid("invalid Solar context checkpoint version"));
            }
            let mut restored = Self::new(desc, boot_epoch, capacity)?;
            let count = usize::from(reader.u16()?);
            if count > capacity {
                return Err(invalid("Solar context checkpoint capacity exceeded"));
            }
            let mut identities = Vec::with_capacity(count);
            for _ in 0..count {
                identities.push((
                    u32::from_le_bytes(reader.take(4)?.try_into().unwrap()) as i32,
                    0,
                    0,
                ));
            }
            if reader.at != bytes.len() {
                return Err(invalid("trailing Solar context checkpoint bytes"));
            }
            restored
                .solar
                .as_mut()
                .unwrap()
                .restore_solar_identities(identities)?;
            return Ok(restored);
        }
        if let ScheduleDefinition::UtcRange { starts_ms, .. }
        | ScheduleDefinition::CalendarRange { starts_ms, .. } = &desc.definition
        {
            if reader.take(5)? != b"GFES\x02" || reader.take(5)? != b"GFRG\x01" {
                return Err(invalid("invalid Range checkpoint version"));
            }
            let mut restored = Self::new(desc, boot_epoch, capacity)?;
            let count = usize::from(reader.u16()?);
            if count > capacity {
                return Err(invalid("Range checkpoint terminal capacity"));
            }
            let mut keys = Vec::with_capacity(count);
            for _ in 0..count {
                let key = reader.string()?;
                let parts: Vec<_> = key.split(':').collect();
                if parts.len() != 3 {
                    return Err(invalid("invalid Range checkpoint occurrence identity"));
                }
                let site = parts[0].parse::<u32>().ok();
                let day = parts[1].parse::<u64>().ok();
                let slot = parts[2].parse::<usize>().ok();
                if site != Some(desc.site)
                    || day.is_none_or(|day| day > 2_932_896)
                    || slot.is_none_or(|slot| !(1..=starts_ms.len()).contains(&slot))
                    || key != format!("{}:{}:{}", desc.site, day.unwrap(), slot.unwrap())
                {
                    return Err(invalid("invalid Range checkpoint occurrence identity"));
                }
                keys.push(key);
            }
            if reader.at != bytes.len() {
                return Err(invalid("trailing Range checkpoint bytes"));
            }
            restored
                .range
                .as_mut()
                .unwrap()
                .restore_terminal_keys(keys)?;
            return Ok(restored);
        }
        if reader.take(4)? != b"GFES" || reader.u8()? != 1 {
            return Err(invalid("invalid context checkpoint version"));
        }
        let mut restored = Self::new(desc, boot_epoch, capacity)?;
        restored.phase_revision = reader.u64()?;
        let has_interval = reader.u8()?;
        if has_interval > 1 {
            return Err(invalid("invalid context checkpoint interval tag"));
        }
        let interval = reader.u64()?;
        restored.interval_ms = if has_interval == 1 {
            Some(interval)
        } else {
            None
        };
        let slot_count = reader.u16()? as usize;
        let declared_slots_capacity = match &desc.definition {
            ScheduleDefinition::ConfigDailySlots { capacity, .. } => usize::from(*capacity),
            _ => 0,
        };
        if slot_count > declared_slots_capacity {
            return Err(invalid("context checkpoint slot capacity"));
        }
        restored.slots.clear();
        let mut seen_times = BTreeSet::new();
        let mut previous_key = 0;
        for _ in 0..slot_count {
            let key = reader.u64()?;
            let minute = reader.u16()?;
            if key <= previous_key || minute >= 1440 || !seen_times.insert(minute) {
                return Err(invalid("invalid context checkpoint slot"));
            }
            previous_key = key;
            restored.slots.push((key, minute));
        }
        restored.next_slot_key = reader.u64()?;
        if restored.next_slot_key <= previous_key {
            return Err(invalid("invalid context checkpoint key allocator"));
        }
        let added_count = reader.u16()? as usize;
        if added_count > declared_slots_capacity {
            return Err(invalid("context checkpoint added-key capacity"));
        }
        restored.added_at_wall.clear();
        for _ in 0..added_count {
            let key = reader.u64()?;
            let at = reader.u64()?;
            if key == 0
                || key >= restored.next_slot_key
                || restored.added_at_wall.insert(key, at).is_some()
            {
                return Err(invalid("invalid context checkpoint added key"));
            }
        }
        let terminal_count = reader.u16()? as usize;
        if terminal_count > capacity {
            return Err(invalid("context checkpoint terminal capacity"));
        }
        restored.terminal.clear();
        for _ in 0..terminal_count {
            if !restored.terminal.insert(reader.string()?) {
                return Err(invalid("duplicate context terminal checkpoint key"));
            }
        }
        let plan_count = reader.u16()? as usize;
        if plan_count > capacity {
            return Err(invalid("context checkpoint plan capacity"));
        }
        restored.last_plan.clear();
        for _ in 0..plan_count {
            let key = reader.string()?;
            let planned = reader.u64()?;
            if restored.last_plan.insert(key, planned).is_some() {
                return Err(invalid("duplicate context plan checkpoint key"));
            }
        }
        if reader.at != bytes.len() {
            return Err(invalid("trailing context checkpoint bytes"));
        }
        match &desc.definition {
            ScheduleDefinition::AtPulse { .. } => {
                let identity = format!("{}:at", desc.site);
                if restored.terminal.iter().any(|id| id != &identity)
                    || restored.interval_ms.is_some()
                    || !restored.slots.is_empty()
                    || !restored.added_at_wall.is_empty()
                    || !restored.last_plan.is_empty()
                    || restored.phase_revision != 0
                    || restored.next_slot_key != 1
                {
                    return Err(invalid("At checkpoint identity mismatch"));
                }
            }
            ScheduleDefinition::Periodic { every, .. } => {
                let value = restored
                    .interval_ms
                    .ok_or_else(|| invalid("missing Periodic checkpoint interval"))?;
                if value < every.min_ms
                    || value > every.max_ms
                    || (value - every.min_ms) % every.step_ms != 0
                    || !every.operator_editable && value != every.initial_ms
                    || !restored.slots.is_empty()
                    || !restored.added_at_wall.is_empty()
                {
                    return Err(invalid("Periodic checkpoint setting mismatch"));
                }
            }
            ScheduleDefinition::ConfigDailySlots {
                grid_ms,
                capacity: max,
                operator_editable,
                initial_minutes,
                ..
            } => {
                if restored.interval_ms.is_some()
                    || restored.slots.len() > usize::from(*max)
                    || !operator_editable
                        && restored
                            .slots
                            .iter()
                            .map(|(_, minute)| *minute)
                            .collect::<Vec<_>>()
                            != *initial_minutes
                    || restored
                        .slots
                        .iter()
                        .any(|(_, minute)| u64::from(*minute) * 60_000 % grid_ms != 0)
                {
                    return Err(invalid("TimeSlots checkpoint setting mismatch"));
                }
            }
            _ if restored.interval_ms.is_some() || !restored.slots.is_empty() => {
                return Err(invalid("unexpected context checkpoint setting"))
            }
            _ => {}
        }
        // A new run always starts with a fresh clock gate and no active Run.
        restored.active_run = None;
        restored.pending_grace.clear();
        Ok(restored)
    }

    pub fn new(desc: &ScheduleDescriptor, boot_epoch: u64, capacity: usize) -> Result<Self> {
        if capacity == 0 || capacity > 4096 {
            return Err(invalid("invalid context terminal capacity"));
        }
        let (interval_ms, slots, next_slot_key) = match &desc.definition {
            ScheduleDefinition::UtcRange {
                starts_ms,
                duration_ms,
            } => {
                crate::context_vm::validate_utc_range(starts_ms, *duration_ms)?;
                (None, Vec::new(), 1)
            }
            ScheduleDefinition::CalendarRange {
                timezone,
                starts_ms,
                duration_ms,
                calendar,
                ..
            } => {
                crate::context_vm::validate_utc_range(starts_ms, *duration_ms)?;
                if timezone != "UTC"
                    || calendar.is_empty()
                    || calendar.len() > 128
                    || starts_ms.len() != 1
                    || starts_ms[0] + duration_ms > 86_400_000
                {
                    return Err(invalid(
                        "calendar Range crosses midnight or has invalid binding",
                    ));
                }
                (None, Vec::new(), 1)
            }
            ScheduleDefinition::Periodic { every, .. } => {
                if every.initial_ms == 0
                    || every.initial_ms < every.min_ms
                    || every.initial_ms > every.max_ms
                    || every.step_ms == 0
                    || (every.initial_ms - every.min_ms) % every.step_ms != 0
                {
                    return Err(invalid("invalid Periodic setting"));
                }
                (Some(every.initial_ms), Vec::new(), 1)
            }
            ScheduleDefinition::ConfigDailySlots {
                initial_minutes,
                grid_ms,
                capacity: max,
                ..
            } => {
                if *max == 0
                    || initial_minutes.len() > usize::from(*max)
                    || *grid_ms == 0
                    || 86_400_000 % grid_ms != 0
                    || initial_minutes
                        .iter()
                        .any(|m| *m >= 1440 || (u64::from(*m) * 60_000) % grid_ms != 0)
                    || initial_minutes.windows(2).any(|pair| pair[0] >= pair[1])
                {
                    return Err(invalid("invalid TimeSlots initial value"));
                }
                (
                    None,
                    initial_minutes
                        .iter()
                        .enumerate()
                        .map(|(i, minute)| ((i + 1) as u64, *minute))
                        .collect(),
                    initial_minutes.len() as u64 + 1,
                )
            }
            _ => (None, Vec::new(), 1),
        };
        Ok(Self {
            solar: match &desc.definition {
                ScheduleDefinition::SolarContext {
                    timezone,
                    fallback_time_ms,
                    ..
                } => Some(
                    crate::solar_admission::SolarPulseEngine::new(
                        desc.site,
                        desc.gap_ms,
                        boot_epoch,
                        capacity,
                    )?
                    .with_policy(desc.clock_hold_ms, *fallback_time_ms)?
                    .with_fallback_timezone(timezone),
                ),
                _ => None,
            },
            solar_settings_baseline: false,
            clock: ScheduleClockGate::new(desc.gap_ms, boot_epoch)?,
            terminal: BTreeSet::new(),
            capacity,
            phase_revision: 0,
            interval_ms,
            slots,
            next_slot_key,
            added_at_wall: BTreeMap::new(),
            active_run: None,
            last_plan: BTreeMap::new(),
            pending_grace: BTreeMap::new(),
            range: if matches!(
                desc.definition,
                ScheduleDefinition::UtcRange { .. } | ScheduleDefinition::CalendarRange { .. }
            ) {
                Some(RangeEngine::new(desc.gap_ms, boot_epoch, capacity)?)
            } else {
                None
            },
            range_clock_revision: None,
            range_calendar_revision: None,
        })
    }

    pub fn stage(
        &self,
        desc: &ScheduleDescriptor,
        clock: ClockSnapshot<'_>,
        facts: &ScheduleEvidence,
        when: bool,
        cancel: bool,
        change: Option<&SettingValue>,
        next_settings_revision: u64,
    ) -> Result<(Self, Decision)> {
        if facts.site != desc.site
            || facts.rows.len() > 4096
            || facts.coverage_start_ms >= facts.coverage_end_ms
        {
            return Err(invalid("invalid context schedule evidence"));
        }
        Self::validate_rows(desc, facts)?;
        if let ScheduleDefinition::CalendarRange {
            starts_ms,
            duration_ms,
            calendar,
            timezone,
            offday,
        } = &desc.definition
        {
            if change.is_some() {
                return Err(invalid(
                    "immutable calendar Range cannot accept settings changes",
                ));
            }
            let mut eligibility = None;
            if let (ClockTrust::Trusted, Some(wall)) = (clock.trust, clock.wall_ms) {
                if wall > 253_402_300_799_999 {
                    return Err(invalid("calendar Range wall time is out of range"));
                }
                eligibility = Some(
                    work_calendar::evaluate(
                        DayQuery {
                            calendar_id: calendar,
                            timezone,
                            date: (wall / 86_400_000) as i32,
                            selector: if *offday {
                                DaySelector::Offday
                            } else {
                                DaySelector::Workday
                            },
                            now_ms: wall,
                        },
                        facts.calendar.as_ref(),
                    )
                    .map_err(|_| invalid("invalid calendar Range snapshot"))?
                    .value,
                );
            }
            let allowed = eligibility == Some(Ok(true));
            let (mut staged, mut decision) = self.utc_range(
                desc.site,
                starts_ms,
                *duration_ms,
                clock,
                when && allowed,
                cancel,
            )?;
            if decision.due {
                staged.range_calendar_revision =
                    facts.calendar.as_ref().map(|c| c.revision.clone());
            }
            for observation in &mut decision.observations {
                observation.provider_revision = if decision.active
                    || observation.decision == "Completed"
                    || observation.decision == "Cancelled"
                {
                    staged.range_calendar_revision.clone().unwrap_or_default()
                } else {
                    facts
                        .calendar
                        .as_ref()
                        .map_or(String::new(), |c| c.revision.clone())
                };
                if observation.decision == "Waiting" && !allowed {
                    observation.decision = match eligibility {
                        Some(Ok(false)) => "ExcludedDay".into(),
                        Some(Err(fault)) => format!("Unknown({fault:?})"),
                        _ => "Unknown(ClockUnknown)".into(),
                    };
                }
            }
            return Ok((staged, decision));
        }
        if let ScheduleDefinition::UtcRange {
            starts_ms,
            duration_ms,
        } = &desc.definition
        {
            if change.is_some() {
                return Err(invalid(
                    "immutable UTC Range cannot accept settings changes",
                ));
            }
            return self.utc_range(desc.site, starts_ms, *duration_ms, clock, when, cancel);
        }
        let mut staged = self.clone();
        staged.apply_setting(
            desc,
            change,
            next_settings_revision,
            if matches!(clock.trust, ClockTrust::Trusted) {
                clock.wall_ms
            } else {
                None
            },
        )?;
        let policy = staged.clock.poll_with_hold(clock, desc.clock_hold_ms)?;
        let observed = policy.observation;
        let mut decision = Decision::default();
        match &desc.definition {
            ScheduleDefinition::SolarContext { .. } => {
                return Err(invalid("Solar requires complete Solar facts"))
            }
            ScheduleDefinition::AtPulse { at_ms } => {
                staged.at_pulse(desc.site, *at_ms, &observed, when, &mut decision)?
            }
            ScheduleDefinition::UtcRange { .. } | ScheduleDefinition::CalendarRange { .. } => {
                unreachable!("Range staged before pulse clock")
            }
            ScheduleDefinition::Periodic {
                epoch_id,
                anchor_ms,
                ..
            } => staged.periodic(
                desc.site,
                epoch_id,
                *anchor_ms,
                &observed,
                change.is_some(),
                when,
                &mut decision,
            )?,
            ScheduleDefinition::Cron {
                fields,
                dst_repeated,
                ..
            } => {
                let cron =
                    CronFields::from_values(fields).map_err(|_| invalid("invalid Cron fields"))?;
                staged.civil(desc.site, facts, &observed, when, &mut decision, |row| {
                    cron.validate_source(
                        CivilSlot {
                            source_day: row.source_day,
                            minute_of_day: row.minute_of_day,
                            fold: row.fold,
                            scheduled_wall_ms: row.instant_ms.unwrap_or(0),
                        },
                        repeated(*dst_repeated),
                    )
                    .map_err(|_| invalid("Cron occurrence does not match source fields"))?;
                    Ok(Some(format!(
                        "{}:{}:{}",
                        row.source_day, row.minute_of_day, row.fold
                    )))
                })?;
            }
            ScheduleDefinition::CalendarDaily {
                calendar,
                timezone,
                at_ms,
                dst_repeated,
                ..
            }
            | ScheduleDefinition::HolidayDaily {
                calendar,
                timezone,
                at_ms,
                dst_repeated,
                ..
            } => {
                staged.civil(desc.site, facts, &observed, when, &mut decision, |row| {
                    if row.minute_of_day != (*at_ms / 60_000) as u16
                        || !fold_allowed(row.fold, *dst_repeated)
                        || row.slot_key != 0
                    {
                        return Err(invalid("Daily calendar occurrence mismatch"));
                    }
                    let query = DayQuery {
                        calendar_id: calendar,
                        timezone,
                        date: row.source_day,
                        selector: match desc.definition {
                            ScheduleDefinition::HolidayDaily { .. } => DaySelector::Holiday,
                            ScheduleDefinition::CalendarDaily { offday: true, .. } => {
                                DaySelector::Offday
                            }
                            _ => DaySelector::Workday,
                        },
                        now_ms: observed.current_effective_wall_ms.unwrap_or(0),
                    };
                    match work_calendar::evaluate(query, facts.calendar.as_ref()) {
                        Ok(outcome) => match outcome.value {
                            Ok(true) => Ok(Some(format!("{}:{}", row.source_day, row.fold))),
                            Ok(false) => Ok(Some(format!("!{}:{}", row.source_day, row.fold))),
                            Err(fault) => Ok(Some(format!(
                                "?{:?}:{}:{}",
                                fault, row.source_day, row.fold
                            ))),
                        },
                        Err(_) => Err(invalid("invalid WorkCalendar snapshot")),
                    }
                })?;
            }
            ScheduleDefinition::ConfigDailySlots {
                grid_ms,
                capacity,
                dst_repeated,
                ..
            } => {
                let selected_slots = staged.slots.clone();
                let added_at_wall = staged.added_at_wall.clone();
                staged.civil(desc.site, facts, &observed, when, &mut decision, |row| {
                    if row.fold > 2
                        || !fold_allowed(row.fold, *dst_repeated)
                        || row.minute_of_day >= 1440
                        || (u64::from(row.minute_of_day) * 60_000) % grid_ms != 0
                        || !selected_slots.contains(&(row.slot_key, row.minute_of_day))
                        || selected_slots.len() > usize::from(*capacity)
                    {
                        return Err(invalid("TimeSlots occurrence mismatch"));
                    }
                    if added_at_wall
                        .get(&row.slot_key)
                        .is_some_and(|at| row.instant_ms.is_some_and(|planned| planned <= *at))
                    {
                        return Ok(None);
                    }
                    Ok(Some(format!(
                        "{}:{}:{}",
                        row.source_day, row.slot_key, row.fold
                    )))
                })?;
            }
            ScheduleDefinition::TideRun {
                provider,
                high,
                offset_ms,
                run_ms,
                within_ms,
                ..
            } => {
                staged.tide(
                    desc.site,
                    provider,
                    *high,
                    *offset_ms,
                    *run_ms,
                    *within_ms,
                    clock.monotonic_ms,
                    facts,
                    &observed,
                    when,
                    cancel,
                    &mut decision,
                )?;
            }
        }
        if matches!(desc.definition, ScheduleDefinition::TideRun { .. }) {
            let held = match &policy.provenance {
                crate::schedule_clock::ClockProvenance::HeldClock { source_revision } => {
                    Some(source_revision.clone())
                }
                _ => None,
            };
            if held.is_some() || observed.current_effective_wall_ms.is_none() {
                let mut evidence = Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: observed.uncertainty_ms,
                    unknown_reason: observed.unknown_reason.map(str::to_owned),
                    site: desc.site,
                    occurrence_id: String::new(),
                    planned_ms: observed.current_effective_wall_ms,
                    decision: if held.is_some() {
                        "HeldClock"
                    } else {
                        "Unknown(ClockUnknown)"
                    }
                    .into(),
                    provider_revision: String::new(),
                    context_revision: String::new(),
                };
                if let Some(revision) = held {
                    evidence.clock_provenance = Some("HeldClock".into());
                    evidence.clock_source_revision = revision;
                }
                decision.observations.push(evidence);
            }
        }
        Ok((staged, decision))
    }

    fn validate_rows(desc: &ScheduleDescriptor, facts: &ScheduleEvidence) -> Result<()> {
        if matches!(desc.definition, ScheduleDefinition::CalendarRange { .. })
            && (facts.provider.is_some() || !facts.rows.is_empty())
        {
            return Err(invalid("unexpected calendar Range occurrence payload"));
        }
        if matches!(
            desc.definition,
            ScheduleDefinition::UtcRange { .. } | ScheduleDefinition::AtPulse { .. }
        ) && (facts.provider.is_some() || facts.calendar.is_some() || !facts.rows.is_empty())
        {
            return Err(invalid("unexpected UTC Range evidence payload"));
        }
        let tide = matches!(desc.definition, ScheduleDefinition::TideRun { .. });
        if matches!(
            desc.definition,
            ScheduleDefinition::Periodic { .. } | ScheduleDefinition::UtcRange { .. }
        ) && !facts.rows.is_empty()
        {
            return Err(invalid("Periodic evidence cannot contain occurrence rows"));
        }
        let mut previous_civil = None;
        let mut previous_tide: Option<&str> = None;
        for row in &facts.rows {
            if row.source_day < 0
                || row.source_day > 2_932_896
                || row.provider_revision.is_empty()
                || row.context_revision.is_empty()
                || row.provider_revision.len() > 128
                || row.context_revision.len() > 128
                || row
                    .instant_ms
                    .is_some_and(|instant| instant > 253_402_300_799_999)
            {
                return Err(invalid("invalid occurrence row"));
            }
            if tide {
                if !(1..=2).contains(&row.event_kind)
                    || row.event_id.is_empty()
                    || row.event_id.len() > 128
                    || row.slot_key != 0
                    || row.fold != 0
                    || row.minute_of_day >= 1440
                    || !row.withdrawn && row.instant_ms.is_none()
                    || previous_tide.is_some_and(|last| row.event_id.as_str() <= last)
                {
                    return Err(invalid("invalid or duplicate Tide occurrence row"));
                }
                previous_tide = Some(&row.event_id);
            } else {
                let key = (row.source_day, row.slot_key, row.minute_of_day, row.fold);
                if row.event_kind != 0
                    || !row.event_id.is_empty()
                    || row.withdrawn
                    || row.minute_of_day >= 1440
                    || row.fold > 2
                    || previous_civil.is_some_and(|last| key <= last)
                {
                    return Err(invalid("invalid or duplicate civil occurrence row"));
                }
                previous_civil = Some(key);
            }
        }
        Ok(())
    }

    fn utc_range(
        &self,
        site: u32,
        starts: &[u64],
        duration: u64,
        clock: ClockSnapshot<'_>,
        when: bool,
        cancel: bool,
    ) -> Result<(Self, Decision)> {
        const DAY: u64 = 86_400_000;
        const MAX_WALL: u64 = 253_402_300_799_999;
        let mut plans = Vec::new();
        if let (ClockTrust::Trusted, Some(wall)) = (clock.trust, clock.wall_ms) {
            if wall > MAX_WALL {
                return Err(invalid("UTC Range wall time is out of range"));
            }
            let current_day = wall / DAY;
            for day in current_day.saturating_sub(1)..=current_day {
                for (slot, start) in starts.iter().enumerate() {
                    let planned = day * DAY + start;
                    let _end = planned
                        .checked_add(duration)
                        .filter(|end| *end <= MAX_WALL)
                        .ok_or_else(|| invalid("UTC Range planned end is out of range"))?;
                    // Only intervals crossing midnight need a preceding-day
                    // plan. Keep them after their end too, so the exact end
                    // consumes the identity before a wall correction backward.
                    if day < current_day && start + duration <= DAY {
                        continue;
                    }
                    plans.push(RangeFact {
                        occurrence_key: format!("{site}:{day}:{}", slot + 1),
                        planned_wall_ms: planned,
                        duration_ms: duration,
                    });
                }
            }
        }
        let original = self
            .range
            .as_ref()
            .ok_or_else(|| invalid("missing Range engine"))?;
        let stage = original.begin(clock, &plans, when, cancel)?;
        let result = stage.result.clone();
        let disposition = stage.clock_disposition;
        let previous_active = original.active_fact().cloned();
        let previous_keys = original.terminal_keys();
        let mut staged = self.clone();
        let range = staged.range.as_mut().unwrap();
        range.commit(stage);
        if result.due {
            staged.range_clock_revision =
                Some(clock.source_revision.unwrap_or("clock-unversioned").into());
        }
        let revision = staged
            .range_clock_revision
            .as_deref()
            .unwrap_or(clock.source_revision.unwrap_or("clock-unversioned"));
        let mut out = Decision {
            due: result.due,
            active: result.active,
            ..Decision::default()
        };
        for key in range
            .terminal_keys()
            .iter()
            .filter(|key| !previous_keys.contains(key))
        {
            let fact = plans
                .iter()
                .find(|fact| &fact.occurrence_key == key)
                .ok_or_else(|| invalid("missing terminal Range plan"))?;
            let decision = if result.occurrence_key.as_ref() == Some(key) && result.due {
                "Due"
            } else if clock
                .wall_ms
                .is_some_and(|wall| wall >= fact.planned_wall_ms + duration)
            {
                "LateStartExpired"
            } else {
                "Cancelled"
            };
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: key.clone(),
                planned_ms: Some(fact.planned_wall_ms),
                decision: decision.into(),
                provider_revision: "utc-static-v1".into(),
                context_revision: if decision == "Due" {
                    revision
                } else {
                    clock.source_revision.unwrap_or("clock-unversioned")
                }
                .into(),
            });
        }
        if let Some(key) = &result.occurrence_key {
            if !out.observations.iter().any(|o| &o.occurrence_id == key) {
                let fact = range
                    .active_fact()
                    .or(previous_active.as_ref())
                    .ok_or_else(|| invalid("missing active Range plan"))?;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: key.clone(),
                    planned_ms: Some(fact.planned_wall_ms),
                    decision: format!("{:?}", result.decision),
                    provider_revision: "utc-static-v1".into(),
                    context_revision: revision.into(),
                });
            }
        }
        if disposition == ClockDisposition::ObservationGap {
            let fact = result
                .occurrence_key
                .as_ref()
                .and_then(|key| {
                    plans
                        .iter()
                        .find(|fact| &fact.occurrence_key == key)
                        .or(range.active_fact())
                        .or(previous_active.as_ref())
                })
                .or_else(|| {
                    clock.wall_ms.and_then(|wall| {
                        plans.iter().find(|fact| {
                            wall >= fact.planned_wall_ms && wall < fact.planned_wall_ms + duration
                        })
                    })
                });
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: fact.map_or_else(String::new, |fact| fact.occurrence_key.clone()),
                planned_ms: fact.map(|fact| fact.planned_wall_ms),
                decision: "ObservationGap".into(),
                provider_revision: "utc-static-v1".into(),
                context_revision: clock.source_revision.unwrap_or("clock-unversioned").into(),
            });
        } else if result.decision == RangeDecision::ClockUnknown && out.observations.is_empty() {
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: String::new(),
                planned_ms: None,
                decision: "Unknown(ClockUnknown)".into(),
                provider_revision: "utc-static-v1".into(),
                context_revision: clock.source_revision.unwrap_or("clock-unversioned").into(),
            });
        }
        if out.observations.is_empty() {
            let fact = clock.wall_ms.and_then(|wall| {
                plans.iter().find(|fact| {
                    wall >= fact.planned_wall_ms && wall < fact.planned_wall_ms + duration
                })
            });
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: fact.map_or_else(String::new, |fact| fact.occurrence_key.clone()),
                planned_ms: fact.map(|fact| fact.planned_wall_ms),
                decision: format!("{:?}", result.decision),
                provider_revision: "utc-static-v1".into(),
                context_revision: clock.source_revision.unwrap_or("clock-unversioned").into(),
            });
        }
        // Range .missed remains outside the current executable projection contract.
        Ok((staged, out))
    }

    pub fn stage_settings_fault(
        &self,
        desc: &ScheduleDescriptor,
        clock: ClockSnapshot<'_>,
        facts: &ScheduleEvidence,
        fault: u8,
    ) -> Result<(Self, Decision)> {
        Self::validate_rows(desc, facts)?;
        let mut staged = self.clone();
        staged.clock.poll_with_hold(clock, desc.clock_hold_ms)?;
        Ok((
            staged,
            Decision {
                observations: vec![crate::context_vm::Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site: desc.site,
                    occurrence_id: String::new(),
                    planned_ms: None,
                    decision: format!(
                        "Unknown({})",
                        if fault == 0 {
                            "SettingsInvalid"
                        } else {
                            "SettingsUnavailable"
                        }
                    ),
                    provider_revision: String::new(),
                    context_revision: String::new(),
                }],
                ..Default::default()
            },
        ))
    }

    pub fn stage_solar(
        &self,
        desc: &ScheduleDescriptor,
        clock: ClockSnapshot<'_>,
        evidence: &crate::context_vm::SolarContextEvidence,
        when: bool,
        settings_fault: Option<u8>,
    ) -> Result<(Self, Decision)> {
        use crate::solar_admission::{SolarDecision as SD, SolarFacts};
        let ScheduleDefinition::SolarContext {
            timezone,
            latitude,
            longitude,
            event,
            offset_ms,
            ..
        } = &desc.definition
        else {
            return Err(invalid("Solar context descriptor required"));
        };
        if evidence.site != desc.site
            || evidence.timezone != *timezone
            || evidence.latitude.to_bits() != latitude.to_bits()
            || evidence.longitude.to_bits() != longitude.to_bits()
            || evidence.event != *event
            || evidence.offset_ms != *offset_ms
            || evidence.rows.len() > 4096
            || evidence.coverage_start_ms >= evidence.coverage_end_ms
            || evidence.rows.iter().any(|r| {
                r.fold != 0
                    || r.slot_key != 0
                    || r.minute_of_day != 0
                    || r.fallback_wall_ms.is_some() && r.unavailable_reason.is_none()
                    || r.provider_revision.is_empty()
                    || r.context_revision.is_empty()
                    || r.provider_revision.len() > 128
                    || r.context_revision.len() > 128
            })
        {
            return Err(invalid("Solar context facts violate immutable descriptor"));
        }
        let facts = SolarFacts {
            coverage_from_wall_ms: evidence.coverage_start_ms,
            coverage_to_wall_ms: evidence.coverage_end_ms,
            rows: &evidence.rows,
        };
        let mut staged = self.clone();
        let engine = staged
            .solar
            .as_mut()
            .ok_or_else(|| invalid("Solar context engine absent"))?;
        let recovery = settings_fault.is_none() && staged.solar_settings_baseline;
        if recovery {
            engine.reset_observation_baseline(clock.boot_epoch)?;
        }
        let reason = settings_fault.map(|f| {
            if f == 0 {
                "SettingsInvalid"
            } else {
                "SettingsUnavailable"
            }
        });
        let stage = engine
            .begin_with_unknown(clock, facts, reason)?
            .evaluate(when)?;
        let result = engine.commit(stage)?;
        staged.solar_settings_baseline = settings_fault.is_some();
        let (clock_provenance, clock_source_revision) = match &result.clock_provenance {
            crate::schedule_clock::ClockProvenance::Snapshot => {
                ("Snapshot", clock.source_revision.map(str::to_owned))
            }
            crate::schedule_clock::ClockProvenance::HeldClock { source_revision } => {
                ("HeldClock", source_revision.clone())
            }
        };
        let decision_text = |decision| {
            if let Some(reason) = reason {
                format!("Unknown({reason})")
            } else if recovery && decision == SD::BootBaseline {
                "RecoveryBaseline".into()
            } else if decision == SD::Unknown {
                format!(
                    "Unknown({})",
                    result
                        .unknown_reason
                        .as_deref()
                        .unwrap_or("OccurrenceUnavailable")
                )
            } else {
                format!("{decision:?}")
            }
        };
        let mut out = Decision {
            due: result.due,
            ..Default::default()
        };
        for row in &result.observations {
            out.missed |= matches!(
                row.decision,
                SD::ConditionsFalseAtPulse
                    | SD::Missed
                    | SD::ObservationGap
                    | SD::CorrectionPastHighWater
            );
            out.observations.push(Observation {
                solar_fallback: Some(row.fallback),
                solar_unavailable_reason: row.unavailable_reason,
                clock_provenance: Some(clock_provenance.into()),
                clock_source_revision: clock_source_revision.clone(),
                clock_uncertainty_ms: result.clock_uncertainty_ms,
                unknown_reason: result.unknown_reason.clone(),
                site: desc.site,
                occurrence_id: format!("{}:{}:0:0", desc.site, row.source_day),
                planned_ms: row.scheduled_wall_ms,
                decision: decision_text(row.decision),
                provider_revision: row.provider_revision.clone(),
                context_revision: row.context_revision.clone(),
            });
        }
        if out.observations.is_empty() || reason.is_some() || recovery {
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: Some(clock_provenance.into()),
                clock_source_revision: clock_source_revision.clone(),
                clock_uncertainty_ms: result.clock_uncertainty_ms,
                unknown_reason: result.unknown_reason.clone(),
                site: desc.site,
                occurrence_id: String::new(),
                planned_ms: None,
                decision: decision_text(result.decision),
                provider_revision: String::new(),
                context_revision: String::new(),
            });
        }
        Ok((staged, out))
    }

    fn apply_setting(
        &mut self,
        desc: &ScheduleDescriptor,
        change: Option<&SettingValue>,
        revision: u64,
        wall_ms: Option<u64>,
    ) -> Result<()> {
        let Some(change) = change else {
            return Ok(());
        };
        match (&desc.definition, change) {
            (
                ScheduleDefinition::Periodic { every, .. },
                SettingValue::Duration(interval) | SettingValue::SharedDuration(interval),
            ) => {
                if !every.operator_editable && !matches!(change, SettingValue::SharedDuration(_))
                    || *interval < every.min_ms
                    || *interval > every.max_ms
                    || (interval - every.min_ms) % every.step_ms != 0
                {
                    return Err(invalid(
                        "Periodically edited setting is unauthorized or out of range",
                    ));
                }
                self.interval_ms = Some(*interval);
                self.phase_revision = revision;
            }
            (
                ScheduleDefinition::ConfigDailySlots {
                    operator_editable,
                    grid_ms,
                    capacity,
                    ..
                },
                SettingValue::Slots(entries) | SettingValue::SharedSlots(entries),
            ) => {
                if !operator_editable && !matches!(change, SettingValue::SharedSlots(_))
                    || entries.len() > usize::from(*capacity)
                {
                    return Err(invalid("TimeSlots edit unauthorized or exceeds capacity"));
                }
                let mut keys = BTreeSet::new();
                let mut times = BTreeSet::new();
                let mut updated = Vec::with_capacity(entries.len());
                for &(key, minute) in entries {
                    if minute >= 1440
                        || u64::from(minute) * 60_000 % grid_ms != 0
                        || !times.insert(minute)
                    {
                        return Err(invalid("invalid TimeSlots edit value"));
                    }
                    let resolved = if key == 0 {
                        let at = wall_ms.ok_or_else(|| {
                            invalid("TimeSlots edit requires trusted wall baseline")
                        })?;
                        let fresh = self.next_slot_key;
                        self.next_slot_key = self
                            .next_slot_key
                            .checked_add(1)
                            .ok_or_else(|| invalid("TimeSlots key exhausted"))?;
                        self.added_at_wall.insert(fresh, at);
                        fresh
                    } else if matches!(change, SettingValue::SharedSlots(_)) {
                        if !self.slots.contains(&(key, minute)) {
                            self.added_at_wall.insert(key, wall_ms.unwrap_or(0));
                        }
                        self.next_slot_key = self.next_slot_key.max(
                            key.checked_add(1)
                                .ok_or_else(|| invalid("TimeSlots key exhausted"))?,
                        );
                        key
                    } else {
                        let Some((_, old_minute)) =
                            self.slots.iter().find(|(existing, _)| *existing == key)
                        else {
                            return Err(invalid("unknown TimeSlots key"));
                        };
                        if *old_minute != minute {
                            let at = wall_ms.ok_or_else(|| {
                                invalid("TimeSlots edit requires trusted wall baseline")
                            })?;
                            self.added_at_wall.insert(key, at);
                        }
                        key
                    };
                    if !keys.insert(resolved) {
                        return Err(invalid("duplicate TimeSlots key"));
                    }
                    updated.push((resolved, minute));
                }
                updated.sort_by_key(|(key, _)| *key);
                self.slots = updated;
                self.added_at_wall.retain(|key, _| keys.contains(key));
            }
            _ => return Err(invalid("setting type does not match schedule")),
        }
        Ok(())
    }

    fn terminalize(&mut self, id: &str) -> Result<()> {
        if !self.terminal.contains(id) && self.terminal.len() >= self.capacity {
            return Err(invalid("context terminal ledger capacity exceeded"));
        }
        self.terminal.insert(id.to_owned());
        Ok(())
    }

    fn at_pulse(
        &mut self,
        site: u32,
        planned: u64,
        clock: &crate::schedule_clock::ClockObservation<'_>,
        when: bool,
        out: &mut Decision,
    ) -> Result<()> {
        let id = format!("{site}:at");
        let Some(now) = clock.current_effective_wall_ms else {
            return Ok(());
        };
        if self.terminal.contains(&id) {
            return Ok(());
        }
        let baseline = matches!(
            clock.disposition,
            ClockDisposition::BootBaseline | ClockDisposition::RecoveryBaseline
        );
        let crossed = clock
            .previous_effective_wall_ms
            .is_some_and(|previous| previous < planned && planned <= now)
            && planned > clock.previous_trusted_high_water_ms.unwrap_or(0);
        if !(baseline && planned <= now || crossed) {
            return Ok(());
        }
        let outcome = if baseline {
            "BaselinePastMissed"
        } else if clock.disposition == ClockDisposition::ObservationGap {
            "ObservationGap"
        } else if !when {
            "ConditionsFalseAtPulse"
        } else {
            "Due"
        };
        self.terminalize(&id)?;
        out.due = outcome == "Due";
        out.missed = !out.due;
        out.observations.push(Observation {
            solar_fallback: None,
            solar_unavailable_reason: None,
            clock_provenance: None,
            clock_source_revision: None,
            clock_uncertainty_ms: None,
            unknown_reason: None,
            site,
            occurrence_id: id,
            planned_ms: Some(planned),
            decision: outcome.into(),
            provider_revision: String::new(),
            context_revision: String::new(),
        });
        Ok(())
    }

    fn end_pending(&mut self, site: u32, reason: &str, out: &mut Decision) -> Result<()> {
        let pending = std::mem::take(&mut self.pending_grace);
        for (id, (planned, provider_revision, context_revision)) in pending {
            if self.terminal.contains(&id) {
                continue;
            }
            self.terminalize(&id)?;
            out.missed = true;
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: id,
                planned_ms: Some(planned),
                decision: reason.into(),
                provider_revision,
                context_revision,
            });
        }
        Ok(())
    }

    fn periodic(
        &mut self,
        site: u32,
        epoch: &str,
        anchor: u64,
        clock: &crate::schedule_clock::ClockObservation<'_>,
        edited: bool,
        when: bool,
        out: &mut Decision,
    ) -> Result<()> {
        let interval = self
            .interval_ms
            .ok_or_else(|| invalid("missing Periodic interval"))?;
        let Some(now) = clock.current_effective_wall_ms else {
            return Ok(());
        };
        if edited
            || !matches!(
                clock.disposition,
                ClockDisposition::Observed | ClockDisposition::ObservationGap
            )
        {
            return Ok(());
        }
        let previous = clock.previous_effective_wall_ms.unwrap_or(now);
        if now <= previous || now < anchor {
            return Ok(());
        }
        let first = if previous < anchor {
            0
        } else {
            (previous - anchor) / interval + 1
        };
        let last = (now - anchor) / interval;
        if last < first {
            return Ok(());
        }
        let count = last - first + 1;
        if count > self.capacity as u64 {
            return Err(invalid("Periodic occurrence batch exceeds capacity"));
        }
        for ordinal in first..=last {
            let id = format!("{site}:{epoch}:{}:{ordinal}", self.phase_revision);
            let planned = anchor
                .checked_add(
                    ordinal
                        .checked_mul(interval)
                        .ok_or_else(|| invalid("Periodic instant overflow"))?,
                )
                .ok_or_else(|| invalid("Periodic instant overflow"))?;
            if planned > 253_402_300_799_999 {
                return Err(invalid("Periodic instant out of range"));
            }
            if self.terminal.contains(&id)
                || planned <= clock.previous_trusted_high_water_ms.unwrap_or(0)
            {
                continue;
            }
            let outcome = if clock.disposition == ClockDisposition::ObservationGap {
                "ObservationGap"
            } else if count > 1 {
                "MultipleCrossingsMissed"
            } else if !when {
                "ConditionsFalseAtPulse"
            } else {
                "Due"
            };
            self.terminalize(&id)?;
            out.due |= outcome == "Due";
            out.missed |= outcome != "Due";
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: id,
                planned_ms: Some(planned),
                decision: outcome.into(),
                provider_revision: String::new(),
                context_revision: String::new(),
            });
        }
        Ok(())
    }

    fn civil<F>(
        &mut self,
        site: u32,
        facts: &ScheduleEvidence,
        clock: &crate::schedule_clock::ClockObservation<'_>,
        when: bool,
        out: &mut Decision,
        classify: F,
    ) -> Result<()>
    where
        F: Fn(&crate::context_vm::Occurrence) -> Result<Option<String>>,
    {
        let classified = facts
            .rows
            .iter()
            .map(&classify)
            .collect::<Result<Vec<_>>>()?;
        let Some(now) = clock.current_effective_wall_ms else {
            return Ok(());
        };
        let Some(previous) = clock.previous_effective_wall_ms else {
            return Ok(());
        };
        if !matches!(
            clock.disposition,
            ClockDisposition::Observed | ClockDisposition::ObservationGap
        ) {
            return Ok(());
        }
        if previous < facts.coverage_start_ms || now >= facts.coverage_end_ms {
            return Ok(());
        }
        let mut crossed = Vec::new();
        for (row, id) in facts.rows.iter().zip(classified) {
            let Some(planned) = row.instant_ms else {
                continue;
            };
            let Some(id) = id else { continue };
            if planned > previous && planned <= now {
                if let Some(fault) = id.strip_prefix('?') {
                    let reason = fault.split(':').next().unwrap_or("CalendarMissing");
                    out.observations.push(Observation {
                        solar_fallback: None,
                        solar_unavailable_reason: None,
                        clock_provenance: None,
                        clock_source_revision: None,
                        clock_uncertainty_ms: None,
                        unknown_reason: None,
                        site,
                        occurrence_id: format!("{site}:calendar"),
                        planned_ms: Some(planned),
                        decision: format!("Unknown({reason})"),
                        provider_revision: row.provider_revision.clone(),
                        context_revision: facts
                            .calendar
                            .as_ref()
                            .map_or(String::new(), |c| c.revision.clone()),
                    });
                    continue;
                }
                if let Some(ineligible) = id.strip_prefix('!') {
                    if !self.terminal.contains(ineligible) {
                        self.terminalize(ineligible)?;
                        out.observations.push(Observation {
                            solar_fallback: None,
                            solar_unavailable_reason: None,
                            clock_provenance: None,
                            clock_source_revision: None,
                            clock_uncertainty_ms: None,
                            unknown_reason: None,
                            site,
                            occurrence_id: ineligible.into(),
                            planned_ms: Some(planned),
                            decision: "DayIneligible".into(),
                            provider_revision: row.provider_revision.clone(),
                            context_revision: facts
                                .calendar
                                .as_ref()
                                .map_or(String::new(), |c| c.revision.clone()),
                        });
                    }
                    continue;
                }
                crossed.push((id, row, planned));
            }
        }
        let many = crossed.len() > 1;
        for (id, row, planned) in crossed {
            if self.terminal.contains(&id)
                || planned <= clock.previous_trusted_high_water_ms.unwrap_or(0)
            {
                continue;
            }
            self.terminalize(&id)?;
            let outcome = if clock.disposition == ClockDisposition::ObservationGap {
                "ObservationGap"
            } else if many {
                "MultipleCrossingsMissed"
            } else if !when {
                "ConditionsFalseAtPulse"
            } else {
                "Due"
            };
            out.due |= outcome == "Due";
            out.missed |= outcome != "Due";
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: id,
                planned_ms: Some(planned),
                decision: outcome.into(),
                provider_revision: row.provider_revision.clone(),
                context_revision: row.context_revision.clone(),
            });
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn tide(
        &mut self,
        site: u32,
        provider: &str,
        high: bool,
        offset: i64,
        run: u64,
        within: u64,
        monotonic: u64,
        facts: &ScheduleEvidence,
        clock: &crate::schedule_clock::ClockObservation<'_>,
        when: bool,
        cancel: bool,
        out: &mut Decision,
    ) -> Result<()> {
        if clock.disposition != ClockDisposition::Observed {
            self.end_pending(
                site,
                if clock.disposition == ClockDisposition::ObservationGap {
                    "ObservationGap"
                } else {
                    "BaselineNoCatchup"
                },
                out,
            )?;
        }
        if let Some(active) = self.active_run.clone() {
            if cancel || monotonic >= active.end_monotonic_ms {
                self.active_run = None;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: active.id,
                    planned_ms: Some(active.planned_ms),
                    decision: if cancel {
                        "Cancelled".into()
                    } else {
                        "RunEnded".into()
                    },
                    provider_revision: active.provider_revision,
                    context_revision: active.context_revision,
                });
            } else {
                out.active = true;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: active.id,
                    planned_ms: Some(active.planned_ms),
                    decision: "Active".into(),
                    provider_revision: active.provider_revision,
                    context_revision: active.context_revision,
                });
            }
        }
        let Some(now) = clock.current_effective_wall_ms else {
            return Ok(());
        };
        let previous = clock.previous_effective_wall_ms.unwrap_or(now);
        if previous < facts.coverage_start_ms || now >= facts.coverage_end_ms {
            self.end_pending(site, "IncompleteCoverage", out)?;
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: format!("{site}:coverage"),
                planned_ms: None,
                decision: "Unknown(IncompleteCoverage)".into(),
                provider_revision: String::new(),
                context_revision: String::new(),
            });
            return Ok(());
        }
        let Some(observation) = facts.provider.as_ref() else {
            self.end_pending(site, "PredictionMissing", out)?;
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: format!("{site}:provider"),
                planned_ms: None,
                decision: "Unknown(PredictionMissing)".into(),
                provider_revision: String::new(),
                context_revision: String::new(),
            });
            return Ok(());
        };
        if observation.binding.provider != provider
            || observation.binding.kind != 0
            || now < observation.coverage_start_ms
            || now >= observation.coverage_end_ms
            || now >= observation.expires_at_ms
            || observation.fault.is_some()
            || observation.uncertainty_ms > observation.binding.max_uncertainty_ms
        {
            self.end_pending(site, "PredictionStale", out)?;
            out.observations.push(Observation {
                solar_fallback: None,
                solar_unavailable_reason: None,
                clock_provenance: None,
                clock_source_revision: None,
                clock_uncertainty_ms: None,
                unknown_reason: None,
                site,
                occurrence_id: format!("{site}:provider"),
                planned_ms: None,
                decision: "Unknown(PredictionStale)".into(),
                provider_revision: observation.provider_revision.clone(),
                context_revision: observation.binding.binding_revision.clone(),
            });
            return Ok(());
        }
        let mut candidates = Vec::new();
        for row in &facts.rows {
            if row.event_kind != if high { 1 } else { 2 } {
                continue;
            }
            let id = format!(
                "{}:{}:{}",
                observation.binding.namespace, observation.binding.station, row.event_id
            );
            if row.withdrawn {
                if !self.terminal.contains(&id) {
                    self.pending_grace.remove(&id);
                    self.terminalize(&id)?;
                    out.missed = true;
                    out.observations.push(Observation {
                        solar_fallback: None,
                        solar_unavailable_reason: None,
                        clock_provenance: None,
                        clock_source_revision: None,
                        clock_uncertainty_ms: None,
                        unknown_reason: None,
                        site,
                        occurrence_id: id,
                        planned_ms: None,
                        decision: "EventWithdrawn".into(),
                        provider_revision: row.provider_revision.clone(),
                        context_revision: row.context_revision.clone(),
                    });
                }
                continue;
            }
            let instant = row
                .instant_ms
                .ok_or_else(|| invalid("Tide event lacks instant"))?;
            let planned = instant
                .checked_add_signed(offset)
                .ok_or_else(|| invalid("Tide offset out of range"))?;
            if self.terminal.contains(&id) {
                continue;
            }
            if !self.last_plan.contains_key(&id) && self.last_plan.len() >= self.capacity {
                return Err(invalid("Tide plan ledger capacity exceeded"));
            }
            let previous_plan = self.last_plan.insert(id.clone(), planned);
            if previous_plan.is_some_and(|old| old != planned) {
                self.pending_grace.remove(&id);
            }
            let was_pending = self
                .pending_grace
                .get(&id)
                .is_some_and(|(at, _, _)| *at == planned);
            if let Some(old) = previous_plan {
                if old != planned
                    && planned <= clock.previous_trusted_high_water_ms.unwrap_or(0)
                    && !self.terminal.contains(&id)
                {
                    self.terminalize(&id)?;
                    out.missed = true;
                    out.observations.push(Observation {
                        solar_fallback: None,
                        solar_unavailable_reason: None,
                        clock_provenance: None,
                        clock_source_revision: None,
                        clock_uncertainty_ms: None,
                        unknown_reason: None,
                        site,
                        occurrence_id: id,
                        planned_ms: Some(planned),
                        decision: "CorrectionPastHighWater".into(),
                        provider_revision: row.provider_revision.clone(),
                        context_revision: row.context_revision.clone(),
                    });
                    continue;
                }
            }
            if planned <= now && clock.disposition != ClockDisposition::Observed {
                self.terminalize(&id)?;
                out.missed = true;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: id,
                    planned_ms: Some(planned),
                    decision: if clock.disposition == ClockDisposition::ObservationGap {
                        "ObservationGap".into()
                    } else {
                        "BaselineNoCatchup".into()
                    },
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
                continue;
            }
            if planned <= previous && !was_pending {
                self.terminalize(&id)?;
                out.missed = true;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: id,
                    planned_ms: Some(planned),
                    decision: "PastHighWater".into(),
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
                continue;
            }
            if planned <= now && now >= planned.saturating_add(within) {
                self.terminalize(&id)?;
                out.missed = true;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: id,
                    planned_ms: Some(planned),
                    decision: "GraceExpired".into(),
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
                continue;
            }
            if !self.terminal.contains(&id)
                && planned <= now
                && now < planned.saturating_add(within)
                && (planned > previous || was_pending && now > previous)
            {
                candidates.push((id, row, planned));
            }
        }
        if candidates.len() > 1 {
            for (id, row, planned) in candidates {
                self.pending_grace.remove(&id);
                self.terminalize(&id)?;
                out.missed = true;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: id,
                    planned_ms: Some(planned),
                    decision: "MultipleCrossingsMissed".into(),
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
            }
        } else if let Some((id, row, planned)) = candidates.pop() {
            if cancel {
                self.pending_grace.remove(&id);
                self.terminalize(&id)?;
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: id,
                    planned_ms: Some(planned),
                    decision: "Cancelled".into(),
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
            } else if when {
                self.pending_grace.remove(&id);
                self.terminalize(&id)?;
                out.due = true;
                out.active = true;
                let end = monotonic
                    .checked_add(run)
                    .ok_or_else(|| invalid("Tide Run end overflow"))?;
                self.active_run = Some(ActiveRun {
                    id: id.clone(),
                    end_monotonic_ms: end,
                    planned_ms: planned,
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
                out.observations.push(Observation {
                    solar_fallback: None,
                    solar_unavailable_reason: None,
                    clock_provenance: None,
                    clock_source_revision: None,
                    clock_uncertainty_ms: None,
                    unknown_reason: None,
                    site,
                    occurrence_id: id,
                    planned_ms: Some(planned),
                    decision: "Due".into(),
                    provider_revision: row.provider_revision.clone(),
                    context_revision: row.context_revision.clone(),
                });
            } else {
                self.pending_grace.insert(
                    id,
                    (
                        planned,
                        row.provider_revision.clone(),
                        row.context_revision.clone(),
                    ),
                );
            }
        }
        Ok(())
    }
}

fn repeated(policy: u8) -> RepeatedPolicy {
    match policy {
        0 => RepeatedPolicy::First,
        1 => RepeatedPolicy::Second,
        2 => RepeatedPolicy::Both,
        _ => RepeatedPolicy::Skip,
    }
}
fn fold_allowed(fold: u8, policy: u8) -> bool {
    match policy {
        0 => fold != 2,
        1 => fold != 1,
        2 => fold <= 2,
        _ => fold == 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context_vm::{DurationSetting, Occurrence, ProviderBinding, ProviderObservation};
    use crate::schedule_clock::ClockTrust;

    fn range_desc(starts: Vec<u64>, duration: u64) -> ScheduleDescriptor {
        ScheduleDescriptor {
            clock_hold_ms: None,
            site: 7,
            name: "planned".into(),
            gap_ms: 100,
            definition: ScheduleDefinition::UtcRange {
                starts_ms: starts,
                duration_ms: duration,
            },
            when: vec![],
            cancel: vec![],
        }
    }

    #[test]
    fn utc_range_late_recovery_gap_cancel_and_monotonic_end() {
        let desc = range_desc(vec![1_000, 2_000], 600);
        let evidence = facts(7);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        let unknown = ClockSnapshot {
            trust: ClockTrust::Unknown("lost"),
            ..clock(1_240)
        };
        let (engine, unknown_result) = engine
            .stage(&desc, unknown, &evidence, true, false, None, 0)
            .unwrap();
        assert!(!unknown_result.due && !unknown_result.active);
        let admitted_clock = ClockSnapshot {
            monotonic_ms: 1_250,
            wall_ms: Some(1_240),
            ..clock(1_250)
        };
        let (engine, admitted) = engine
            .stage(&desc, admitted_clock, &evidence, true, false, None, 0)
            .unwrap();
        assert!(admitted.due && admitted.active && !admitted.missed);
        assert_eq!(admitted.observations[0].occurrence_id, "7:0:1");
        assert_eq!(admitted.observations[0].planned_ms, Some(1_000));
        let (engine, continuing) = engine
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 1_609,
                    wall_ms: Some(9_000),
                    ..clock(1_609)
                },
                &evidence,
                false,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(continuing.active && !continuing.due);
        assert!(continuing
            .observations
            .iter()
            .any(|o| o.decision == "ObservationGap"));
        let (engine, completed) = engine
            .stage(
                &desc,
                ClockSnapshot {
                    trust: ClockTrust::Unknown("lost"),
                    ..clock(1_610)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(!completed.active);
        let (engine, next) = engine
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 1_611,
                    wall_ms: Some(2_400),
                    ..clock(1_611)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(next.due && next.active);
        let (engine, cancelled) = engine
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 1_612,
                    wall_ms: Some(2_401),
                    ..clock(1_612)
                },
                &evidence,
                true,
                true,
                None,
                0,
            )
            .unwrap();
        assert!(!cancelled.active);
        assert!(cancelled
            .observations
            .iter()
            .any(|o| o.decision == "Cancelled"));
        let (_, no_rearm) = engine
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 1_613,
                    wall_ms: Some(2_402),
                    ..clock(1_613)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(!no_rearm.due && !no_rearm.active);
    }

    #[test]
    fn utc_range_previous_day_open_exact_end_and_terminal_checkpoint() {
        const DAY: u64 = 86_400_000;
        let desc = range_desc(vec![DAY - 300], 600);
        let evidence = facts(7);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        let (engine, admitted) = engine
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 0,
                    wall_ms: Some(DAY + 100),
                    ..clock(0)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(admitted.due && admitted.active);
        assert_eq!(admitted.observations[0].occurrence_id, "7:0:1");
        let checkpoint = engine.snapshot().unwrap();
        assert!(checkpoint.starts_with(b"GFES\x02GFRG\x01"));
        let restored = Engine::restore(&desc, 2, 8, &checkpoint).unwrap();
        let (_, no_resume) = restored
            .stage(
                &desc,
                ClockSnapshot {
                    boot_epoch: 2,
                    monotonic_ms: 0,
                    wall_ms: Some(DAY + 101),
                    ..clock(0)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(!no_resume.due && !no_resume.active);
        assert_eq!(restored.snapshot().unwrap(), checkpoint);
        assert!(Engine::restore(&desc, 2, 8, &checkpoint[..checkpoint.len() - 1]).is_err());
        let mut trailing = checkpoint.clone();
        trailing.push(0);
        assert!(Engine::restore(&desc, 2, 8, &trailing).is_err());
        let mut wrong_version = checkpoint.clone();
        wrong_version[4] = 1;
        assert!(Engine::restore(&desc, 2, 8, &wrong_version).is_err());
        let mut wrong_site = checkpoint.clone();
        wrong_site[14] = b'8';
        assert!(Engine::restore(&desc, 2, 8, &wrong_site).is_err());
        let mut duplicate = checkpoint.clone();
        duplicate[10..12].copy_from_slice(&2u16.to_le_bytes());
        duplicate.extend_from_slice(&checkpoint[12..]);
        assert!(Engine::restore(&desc, 2, 8, &duplicate).is_err());
        let fresh = Engine::new(&desc, 1, 8).unwrap();
        let (closed, exact_end) = fresh
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 0,
                    wall_ms: Some(DAY - 300 + 600),
                    ..clock(0)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(!exact_end.due && !exact_end.active);
        assert_eq!(exact_end.observations[0].decision, "LateStartExpired");
        let (_, corrected_back) = closed
            .stage(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 1,
                    wall_ms: Some(DAY + 100),
                    ..clock(1)
                },
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(!corrected_back.due && !corrected_back.active);
        let same_day_desc = range_desc(vec![1_000], 600);
        let fresh = Engine::new(&same_day_desc, 1, 8).unwrap();
        let (_, expired) = fresh
            .stage(
                &same_day_desc,
                clock(1_600),
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert_eq!(expired.observations[0].decision, "LateStartExpired");
        assert_eq!(expired.observations[0].occurrence_id, "7:0:1");
        assert!(!expired.missed);
    }

    #[test]
    fn utc_range_capacity_and_malformed_inputs_reject_atomically() {
        let desc = range_desc(vec![1_000, 2_000], 600);
        let evidence = facts(7);
        let engine = Engine::new(&desc, 1, 1).unwrap();
        assert!(engine
            .stage(&desc, clock(1_240), &evidence, true, false, None, 0)
            .is_err());
        assert_eq!(engine.snapshot().unwrap(), b"GFES\x02GFRG\x01\0\0");
        let engine = Engine::new(&desc, 1, 8).unwrap();
        assert!(engine
            .stage(&desc, clock(u64::MAX), &evidence, true, false, None, 0)
            .is_err());
        assert!(engine
            .stage(
                &desc,
                clock(1_240),
                &evidence,
                true,
                false,
                Some(&SettingValue::Duration(1)),
                1
            )
            .is_err());
        assert!(Engine::new(&range_desc(vec![0, 86_399_999], 2), 1, 8).is_err());
        assert!(Engine::restore(
            &desc,
            2,
            8,
            &Engine::new(&periodic(false), 1, 8)
                .unwrap()
                .snapshot()
                .unwrap()
        )
        .is_err());
        let single = range_desc(vec![1_000], 600);
        let engine = Engine::new(&single, 1, 1).unwrap();
        let (engine, _) = engine
            .stage(&single, clock(1_240), &evidence, true, false, None, 0)
            .unwrap();
        let checkpoint = engine.snapshot().unwrap();
        assert!(engine
            .stage(&single, clock(86_401_240), &evidence, true, false, None, 0)
            .is_err());
        assert_eq!(engine.snapshot().unwrap(), checkpoint);
    }

    fn solar_desc(fallback_time_ms: Option<u64>) -> ScheduleDescriptor {
        ScheduleDescriptor {
            clock_hold_ms: Some(1_000),
            site: 7,
            name: "solar".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::SolarContext {
                timezone: "UTC".into(),
                latitude: 37.0,
                longitude: 127.0,
                event: 0,
                offset_ms: 0,
                fallback_time_ms,
                config_ids: vec![],
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }
    }
    fn solar_facts() -> crate::context_vm::SolarContextEvidence {
        crate::context_vm::SolarContextEvidence {
            site: 7,
            timezone: "UTC".into(),
            latitude: 37.0,
            longitude: 127.0,
            event: 0,
            offset_ms: 0,
            coverage_start_ms: 0,
            coverage_end_ms: 1_000,
            rows: vec![crate::solar_admission::SolarFact::available(
                0, 100, "p1", "c1",
            )],
        }
    }

    #[test]
    fn solar_context_reuses_fallback_and_bounded_clock_hold_with_complete_trace() {
        use crate::solar_admission::SolarFactAvailability;
        let desc = solar_desc(Some(100));
        let mut evidence = solar_facts();
        evidence.rows[0].availability = SolarFactAvailability::Unavailable;
        evidence.rows[0].scheduled_wall_ms = None;
        evidence.rows[0].fallback_wall_ms = Some(100);
        evidence.rows[0].unavailable_reason = Some(2);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        let (baseline, _) = engine
            .stage_solar(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 0,
                    wall_ms: Some(90),
                    ..clock(0)
                },
                &evidence,
                true,
                None,
            )
            .unwrap();
        let (due, result) = baseline
            .stage_solar(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 10,
                    wall_ms: None,
                    trust: ClockTrust::Unknown("TrustExpired"),
                    source_revision: None,
                    ..clock(0)
                },
                &evidence,
                true,
                None,
            )
            .unwrap();
        assert!(result.due);
        assert!(result.observations.iter().any(|o| o.decision == "Due"
            && o.solar_fallback == Some(true)
            && o.solar_unavailable_reason == Some(2)
            && o.clock_provenance.as_deref() == Some("HeldClock")
            && o.clock_source_revision.as_deref() == Some("clock-1")));
        let (_, expired) = due
            .stage_solar(
                &desc,
                ClockSnapshot {
                    monotonic_ms: 1_001,
                    wall_ms: None,
                    trust: ClockTrust::Unknown("TrustExpired"),
                    source_revision: None,
                    ..clock(0)
                },
                &evidence,
                true,
                None,
            )
            .unwrap();
        assert!(!expired.due);
        assert!(expired
            .observations
            .iter()
            .any(|o| o.decision.starts_with("Unknown(")));
        let forbidden = solar_desc(None);
        assert!(Engine::new(&forbidden, 1, 8)
            .unwrap()
            .stage_solar(&forbidden, clock(90), &evidence, true, None)
            .is_err());
        let mismatched = solar_desc(Some(101));
        assert!(Engine::new(&mismatched, 1, 8)
            .unwrap()
            .stage_solar(&mismatched, clock(90), &evidence, true, None)
            .is_err());
    }

    #[test]
    fn solar_context_false_condition_and_checkpoint_capacity_fail_closed() {
        let desc = solar_desc(None);
        let evidence = solar_facts();
        let initial = Engine::new(&desc, 1, 1).unwrap();
        let (baseline, _) = initial
            .stage_solar(&desc, clock(90), &evidence, true, None)
            .unwrap();
        let (consumed, result) = baseline
            .stage_solar(&desc, clock(100), &evidence, false, None)
            .unwrap();
        assert!(!result.due && result.missed);
        assert_eq!(result.observations[0].decision, "ConditionsFalseAtPulse");
        let (_, repeat) = consumed
            .stage_solar(&desc, clock(101), &evidence, true, None)
            .unwrap();
        assert!(!repeat.due);
        let checkpoint = consumed.snapshot().unwrap();
        let restored = Engine::restore(&desc, 2, 1, &checkpoint).unwrap();
        let (baseline, _) = restored
            .stage_solar(
                &desc,
                ClockSnapshot {
                    boot_epoch: 2,
                    ..clock(90)
                },
                &evidence,
                true,
                None,
            )
            .unwrap();
        assert!(
            !baseline
                .stage_solar(
                    &desc,
                    ClockSnapshot {
                        boot_epoch: 2,
                        ..clock(100)
                    },
                    &evidence,
                    true,
                    None
                )
                .unwrap()
                .1
                .due
        );
        for mutation in 0..4 {
            let mut malformed = checkpoint.clone();
            match mutation {
                0 => malformed[4] = 1,
                1 => malformed[5..7].copy_from_slice(&2u16.to_le_bytes()),
                2 => malformed[7..11].copy_from_slice(&u32::MAX.to_le_bytes()),
                _ => malformed.push(0),
            }
            assert!(Engine::restore(&desc, 2, 1, &malformed).is_err());
        }
        let mut too_many = evidence.clone();
        too_many
            .rows
            .push(crate::solar_admission::SolarFact::available(
                1, 200, "p1", "c1",
            ));
        let before = initial.snapshot().unwrap();
        assert!(initial
            .stage_solar(&desc, clock(90), &too_many, true, None)
            .is_err());
        assert_eq!(initial.snapshot().unwrap(), before);
    }

    fn clock(at: u64) -> ClockSnapshot<'static> {
        ClockSnapshot {
            monotonic_ms: at,
            boot_epoch: 1,
            wall_ms: Some(at),
            trust: ClockTrust::Trusted,
            uncertainty_ms: Some(0),
            source_revision: Some("clock-1"),
        }
    }
    fn facts(site: u32) -> ScheduleEvidence {
        ScheduleEvidence {
            site,
            coverage_start_ms: 0,
            coverage_end_ms: 10_000,
            provider: None,
            calendar: None,
            rows: Vec::new(),
        }
    }
    fn periodic(editable: bool) -> ScheduleDescriptor {
        ScheduleDescriptor {
            clock_hold_ms: None,
            site: 1,
            name: "cycle".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::Periodic {
                epoch_id: "instant:1000".into(),
                anchor_ms: 1_000,
                every: DurationSetting {
                    id: 1,
                    name: "interval".into(),
                    operator_editable: editable,
                    initial_ms: 1_000,
                    min_ms: 1_000,
                    max_ms: 3_000,
                    step_ms: 1_000,
                },
            },
            when: vec![],
            cancel: vec![],
        }
    }

    #[test]
    fn periodic_crossing_is_once_and_live_edit_uses_new_phase() {
        let desc = periodic(true);
        let evidence = facts(1);
        let mut engine = Engine::new(&desc, 1, 8).unwrap();
        let (next, first) = engine
            .stage(&desc, clock(0), &evidence, true, false, None, 0)
            .unwrap();
        assert!(!first.due);
        engine = next;
        let (next, due) = engine
            .stage(&desc, clock(1_000), &evidence, true, false, None, 0)
            .unwrap();
        assert!(due.due);
        assert_eq!(due.observations.len(), 1);
        engine = next;
        let (next, edit) = engine
            .stage(
                &desc,
                clock(2_500),
                &evidence,
                true,
                false,
                Some(&SettingValue::Duration(2_000)),
                1,
            )
            .unwrap();
        assert!(!edit.due);
        engine = next;
        let (_, new_phase) = engine
            .stage(&desc, clock(3_000), &evidence, true, false, None, 1)
            .unwrap();
        assert!(new_phase.due);
        assert_ne!(
            due.observations[0].occurrence_id,
            new_phase.observations[0].occurrence_id
        );
    }

    #[test]
    fn periodic_rejects_unauthorized_edit_without_mutating_original() {
        let desc = periodic(false);
        let evidence = facts(1);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        assert!(engine
            .stage(
                &desc,
                clock(0),
                &evidence,
                true,
                false,
                Some(&SettingValue::Duration(2_000)),
                1
            )
            .is_err());
        let (next, _) = engine
            .stage(&desc, clock(0), &evidence, true, false, None, 0)
            .unwrap();
        assert!(
            next.stage(&desc, clock(1_000), &evidence, true, false, None, 0)
                .unwrap()
                .1
                .due
        );
    }

    #[test]
    fn checkpoint_restores_setting_phase_and_terminal_without_catchup() {
        let desc = periodic(true);
        let evidence = facts(1);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        let (engine, _) = engine
            .stage(&desc, clock(0), &evidence, true, false, None, 0)
            .unwrap();
        let (engine, due) = engine
            .stage(&desc, clock(1_000), &evidence, true, false, None, 0)
            .unwrap();
        assert!(due.due);
        let (engine, _) = engine
            .stage(
                &desc,
                clock(1_500),
                &evidence,
                true,
                false,
                Some(&SettingValue::Duration(2_000)),
                7,
            )
            .unwrap();
        let checkpoint = engine.snapshot().unwrap();
        let restored = Engine::restore(&desc, 2, 8, &checkpoint).unwrap();
        assert_eq!(
            restored.effective_setting(&desc),
            Some(SettingValue::Duration(2_000))
        );
        let reboot_clock = ClockSnapshot {
            boot_epoch: 2,
            ..clock(3_000)
        };
        let (restored, baseline) = restored
            .stage(&desc, reboot_clock, &evidence, true, false, None, 7)
            .unwrap();
        assert!(!baseline.due);
        let next_clock = ClockSnapshot {
            boot_epoch: 2,
            ..clock(5_000)
        };
        let (_, due) = restored
            .stage(&desc, next_clock, &evidence, true, false, None, 7)
            .unwrap();
        assert!(due.due);
        assert_ne!(due.observations[0].occurrence_id, "1:instant:1000:0:0");
        assert!(Engine::restore(&desc, 2, 8, &checkpoint[..checkpoint.len() - 1]).is_err());
    }

    #[test]
    fn periodic_gap_and_false_condition_are_distinct() {
        let desc = periodic(false);
        let evidence = facts(1);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        let (engine, _) = engine
            .stage(&desc, clock(0), &evidence, true, false, None, 0)
            .unwrap();
        let (engine, false_pulse) = engine
            .stage(&desc, clock(1_000), &evidence, false, false, None, 0)
            .unwrap();
        assert!(!false_pulse.due && false_pulse.missed);
        assert_eq!(
            false_pulse.observations[0].decision,
            "ConditionsFalseAtPulse"
        );
        let (_, gap) = engine
            .stage(&desc, clock(8_000), &evidence, true, false, None, 0)
            .unwrap();
        assert!(gap.missed);
        assert!(gap
            .observations
            .iter()
            .all(|o| o.decision == "MultipleCrossingsMissed"));
    }

    #[test]
    fn tide_cancel_wins_first_admissible_tick_and_never_rearms() {
        let desc = ScheduleDescriptor {
            clock_hold_ms: None,
            site: 2,
            name: "tide".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::TideRun {
                timezone: "UTC".into(),
                provider: "harbor".into(),
                high: true,
                offset_ms: 0,
                run_ms: 600,
                within_ms: 300,
            },
            when: vec![],
            cancel: vec![],
        };
        let binding = ProviderBinding {
            provider: "harbor".into(),
            kind: 0,
            namespace: "ns".into(),
            station: "station".into(),
            binding_revision: "b1".into(),
            location: "site".into(),
            timezone: "UTC".into(),
            criteria: "criteria".into(),
            max_uncertainty_ms: 10,
        };
        let provider = ProviderObservation {
            binding,
            provider_revision: "r1".into(),
            coverage_start_ms: 0,
            coverage_end_ms: 10_000,
            expires_at_ms: 10_000,
            uncertainty_ms: 0,
            fault: None,
            classifications: Vec::new(),
        };
        let row = Occurrence {
            source_day: 0,
            slot_key: 0,
            minute_of_day: 0,
            fold: 0,
            event_id: "event-1".into(),
            event_kind: 1,
            instant_ms: Some(1_000),
            withdrawn: false,
            provider_revision: "r1".into(),
            context_revision: "b1".into(),
        };
        let mut evidence = facts(2);
        evidence.provider = Some(provider);
        evidence.rows.push(row);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        let (baseline, _) = engine
            .stage(&desc, clock(900), &evidence, true, false, None, 0)
            .unwrap();
        let (cancelled, result) = baseline
            .stage(&desc, clock(1_000), &evidence, true, true, None, 0)
            .unwrap();
        assert!(!result.due && !result.active);
        assert_eq!(result.observations[0].decision, "Cancelled");
        let (_, later) = cancelled
            .stage(&desc, clock(1_100), &evidence, true, false, None, 0)
            .unwrap();
        assert!(!later.due && !later.active);

        let (_, exact_end) = baseline
            .stage(&desc, clock(1_300), &evidence, true, false, None, 0)
            .unwrap();
        assert!(!exact_end.due && exact_end.missed);
        assert_eq!(exact_end.observations[0].decision, "GraceExpired");

        let (_, past_baseline) = engine
            .stage(&desc, clock(1_100), &evidence, true, false, None, 0)
            .unwrap();
        assert!(!past_baseline.due && past_baseline.missed);
        assert_eq!(past_baseline.observations[0].decision, "BaselineNoCatchup");

        let mut duplicate = evidence.clone();
        duplicate.rows.push(duplicate.rows[0].clone());
        assert!(engine
            .stage(&desc, clock(900), &duplicate, true, false, None, 0)
            .is_err());

        let mut missing = evidence.clone();
        missing.provider = None;
        let (_, unknown) = baseline
            .stage(&desc, clock(1_000), &missing, true, false, None, 0)
            .unwrap();
        assert!(!unknown.due && !unknown.missed);
        assert_eq!(
            unknown.observations[0].decision,
            "Unknown(PredictionMissing)"
        );
        let (stale_crossing, _) = baseline
            .stage(&desc, clock(1_000), &missing, true, false, None, 0)
            .unwrap();
        let (_, refreshed) = stale_crossing
            .stage(&desc, clock(1_100), &evidence, true, false, None, 0)
            .unwrap();
        assert!(!refreshed.due && refreshed.missed);
        assert_eq!(refreshed.observations[0].decision, "PastHighWater");

        let (pending, blocked) = baseline
            .stage(&desc, clock(1_000), &evidence, false, false, None, 0)
            .unwrap();
        assert!(!blocked.due && !blocked.missed);
        let (_, admitted_late) = pending
            .stage(&desc, clock(1_100), &evidence, true, false, None, 0)
            .unwrap();
        assert!(admitted_late.due && admitted_late.active);
        let mut incomplete = evidence.clone();
        incomplete.coverage_end_ms = 1_100;
        let (interrupted, interrupted_decision) = pending
            .stage(&desc, clock(1_100), &incomplete, true, false, None, 0)
            .unwrap();
        assert!(!interrupted_decision.due && interrupted_decision.missed);
        let (_, resumed) = interrupted
            .stage(&desc, clock(1_200), &evidence, true, false, None, 0)
            .unwrap();
        assert!(!resumed.due);

        let (admitted, due) = baseline
            .stage(&desc, clock(1_000), &evidence, true, false, None, 0)
            .unwrap();
        assert!(due.due && due.active);
        let mut withdrawn = evidence.clone();
        withdrawn.rows[0].withdrawn = true;
        withdrawn.rows[0].instant_ms = None;
        let (_, active) = admitted
            .stage(&desc, clock(1_100), &withdrawn, true, false, None, 0)
            .unwrap();
        assert!(active.active && !active.missed);
        assert!(active
            .observations
            .iter()
            .all(|item| item.decision != "EventWithdrawn"));
        assert_eq!(active.observations[0].planned_ms, Some(1_000));
        assert_eq!(active.observations[0].provider_revision, "r1");
        let (_, completed) = admitted
            .stage(&desc, clock(1_600), &withdrawn, true, false, None, 0)
            .unwrap();
        assert!(!completed.active);
        assert_eq!(completed.observations[0].decision, "RunEnded");
        assert_eq!(completed.observations[0].planned_ms, Some(1_000));
        let held_desc = ScheduleDescriptor {
            clock_hold_ms: Some(200),
            ..desc.clone()
        };
        let held_engine = Engine::new(&held_desc, 1, 8).unwrap();
        let (held_baseline, _) = held_engine
            .stage(&held_desc, clock(900), &evidence, true, false, None, 0)
            .unwrap();
        let unknown_clock = |at| ClockSnapshot {
            trust: ClockTrust::Unknown("TrustExpired"),
            wall_ms: None,
            ..clock(at)
        };
        let (held_run, held_due) = held_baseline
            .stage(
                &held_desc,
                unknown_clock(1_000),
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(held_due.due && held_due.active);
        let held_trace = held_due
            .observations
            .iter()
            .find(|row| row.decision == "HeldClock")
            .unwrap();
        assert_eq!(held_trace.clock_source_revision.as_deref(), Some("clock-1"));
        assert_eq!(held_trace.unknown_reason.as_deref(), Some("TrustExpired"));
        let (expired_run, expired_decision) = held_run
            .stage(
                &held_desc,
                unknown_clock(1_100),
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(expired_decision.active && !expired_decision.due);
        let (_, ended) = expired_run
            .stage(
                &held_desc,
                unknown_clock(1_600),
                &evidence,
                true,
                false,
                None,
                0,
            )
            .unwrap();
        assert!(!ended.active && !ended.due);
        assert!(ended
            .observations
            .iter()
            .any(|row| row.decision == "RunEnded"));
        let saved = held_run.snapshot().unwrap();
        let restarted = Engine::restore(&held_desc, 2, 8, &saved).unwrap();
        assert!(restarted.active_run.is_none());
        let (_, cancelled_run) = admitted
            .stage(&desc, clock(1_100), &withdrawn, true, true, None, 0)
            .unwrap();
        assert!(!cancelled_run.active);
        assert_eq!(cancelled_run.observations[0].decision, "Cancelled");
        assert_eq!(cancelled_run.observations[0].provider_revision, "r1");

        let narrow = Engine::new(&desc, 1, 1).unwrap();
        let mut two_plans = evidence.clone();
        two_plans.rows.push(Occurrence {
            event_id: "event-2".into(),
            instant_ms: Some(2_000),
            ..evidence.rows[0].clone()
        });
        assert!(narrow
            .stage(&desc, clock(900), &two_plans, true, false, None, 0)
            .is_err());
        assert!(narrow
            .stage(&desc, clock(900), &evidence, true, false, None, 0)
            .is_ok());
    }

    #[test]
    fn cron_wrong_source_and_duplicate_rows_reject_at_boot_baseline() {
        let desc = ScheduleDescriptor {
            clock_hold_ms: None,
            site: 3,
            name: "morning".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::Cron {
                timezone: "UTC".into(),
                fields: [
                    vec![0],
                    vec![6],
                    (1..=31).collect(),
                    (1..=12).collect(),
                    vec![5],
                ],
                dst_missing: 0,
                dst_repeated: 0,
            },
            when: vec![],
            cancel: vec![],
        };
        let row = Occurrence {
            source_day: 0,
            slot_key: 0,
            minute_of_day: 360,
            fold: 0,
            event_id: String::new(),
            event_kind: 0,
            instant_ms: Some(1_000),
            withdrawn: false,
            provider_revision: "iana-1".into(),
            context_revision: "tzdb-1".into(),
        };
        let mut evidence = facts(3);
        evidence.rows.push(row);
        let engine = Engine::new(&desc, 1, 8).unwrap();
        assert!(engine
            .stage(&desc, clock(900), &evidence, true, false, None, 0)
            .is_err());
        evidence.rows[0].source_day = 1;
        evidence.rows.push(evidence.rows[0].clone());
        assert!(engine
            .stage(&desc, clock(900), &evidence, true, false, None, 0)
            .is_err());
    }

    #[test]
    fn timeslots_live_edit_uses_opaque_keys_and_restores_effective_setting() {
        let desc = ScheduleDescriptor {
            clock_hold_ms: None,
            site: 4,
            name: "starts".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::ConfigDailySlots {
                config_id: 3,
                timezone: "UTC".into(),
                setting: "watering_slots".into(),
                operator_editable: true,
                grid_ms: 900_000,
                capacity: 3,
                initial_minutes: vec![360],
                dst_missing: 0,
                dst_repeated: 0,
            },
            when: vec![],
            cancel: vec![],
        };
        let engine = Engine::new(&desc, 1, 1).unwrap();
        let empty = facts(4);
        let edit = SettingValue::Slots(vec![(1, 375), (0, 390)]);
        let (changed, decision) = engine
            .stage(&desc, clock(900), &empty, true, false, Some(&edit), 1)
            .unwrap();
        assert!(!decision.due);
        assert_eq!(
            changed.effective_setting(&desc),
            Some(SettingValue::Slots(vec![(1, 375), (2, 390)]))
        );
        let bytes = changed.snapshot().unwrap();
        let restored = Engine::restore(&desc, 2, 1, &bytes).unwrap();
        assert_eq!(
            restored.effective_setting(&desc),
            changed.effective_setting(&desc)
        );
        let removed = SettingValue::Slots(vec![(2, 390)]);
        let (removed_engine, _) = changed
            .stage(&desc, clock(950), &empty, true, false, Some(&removed), 2)
            .unwrap();
        let mut stale = facts(4);
        stale.rows.push(Occurrence {
            source_day: 0,
            slot_key: 1,
            minute_of_day: 375,
            fold: 0,
            event_id: String::new(),
            event_kind: 0,
            instant_ms: Some(1_000),
            withdrawn: false,
            provider_revision: "iana-1".into(),
            context_revision: "tzdb-1".into(),
        });
        assert!(removed_engine
            .stage(&desc, clock(1_000), &stale, true, false, None, 2)
            .is_err());
        assert!(changed
            .stage(
                &desc,
                clock(950),
                &empty,
                true,
                false,
                Some(&SettingValue::Slots(vec![(99, 390)])),
                2
            )
            .is_err());
    }
}
