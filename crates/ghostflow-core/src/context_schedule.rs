//! GFB10 schedule state. Each scan clones the engine; the caller commits the
//! staged clone only after the whole VM scan succeeds.

use crate::context_vm::{
    Decision, Observation, ScheduleDefinition, ScheduleDescriptor, ScheduleEvidence, SettingValue,
};
use crate::cron_schedule::{CivilSlot, CronFields, RepeatedPolicy};
use crate::schedule_clock::{ClockDisposition, ClockSnapshot, ClockTrust, ScheduleClockGate};
use crate::work_calendar::{self, DayQuery, DaySelector};
use crate::{Error, Result};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
pub struct Engine {
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
        let observed = staged.clock.poll(clock)?;
        let mut decision = Decision::default();
        match &desc.definition {
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
                offday,
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
                        selector: if *offday {
                            DaySelector::Offday
                        } else {
                            DaySelector::Workday
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
        Ok((staged, decision))
    }

    fn validate_rows(desc: &ScheduleDescriptor, facts: &ScheduleEvidence) -> Result<()> {
        let tide = matches!(desc.definition, ScheduleDefinition::TideRun { .. });
        if matches!(desc.definition, ScheduleDefinition::Periodic { .. }) && !facts.rows.is_empty()
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
            (ScheduleDefinition::Periodic { every, .. }, SettingValue::Duration(interval)) => {
                if !every.operator_editable
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
                SettingValue::Slots(entries),
            ) => {
                if !operator_editable || entries.len() > usize::from(*capacity) {
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

    fn end_pending(&mut self, site: u32, reason: &str, out: &mut Decision) -> Result<()> {
        let pending = std::mem::take(&mut self.pending_grace);
        for (id, (planned, provider_revision, context_revision)) in pending {
            if self.terminal.contains(&id) {
                continue;
            }
            self.terminalize(&id)?;
            out.missed = true;
            out.observations.push(Observation {
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
            site: 1,
            name: "cycle".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::Periodic {
                epoch_id: "instant:1000".into(),
                anchor_ms: 1_000,
                every: DurationSetting {
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
            site: 4,
            name: "starts".into(),
            gap_ms: 10_000,
            definition: ScheduleDefinition::ConfigDailySlots {
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
