//! GFSF5 facts and GFCA1 activation. Only typed evidence crosses the host boundary.
use ghostflow_core::{
    context_runtime::{Activation, Facts},
    context_vm::*,
    schedule_clock::{ClockSnapshot, ClockTrust},
    settings_stream::ConfigValue,
    work_calendar::{DayClass, DayException, WorkCalendarSnapshot},
    Value,
};

const MAX_PACKET: usize = 65_536;
const MAX_EXACT: u64 = 9_007_199_254_740_991;

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(n).ok_or("context packet overflow")?;
        let bytes = self
            .bytes
            .get(self.at..end)
            .ok_or("truncated context packet")?;
        self.at = end;
        Ok(bytes)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().map_err(|_| "invalid u16")?,
        ))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| "invalid u32")?,
        ))
    }
    fn raw64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| "invalid u64")?,
        ))
    }
    fn exact(&mut self) -> Result<u64, String> {
        let n = self.raw64()?;
        if n > MAX_EXACT {
            Err("context integer exceeds exact range".into())
        } else {
            Ok(n)
        }
    }
    fn flag(&mut self) -> Result<bool, String> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err("invalid context flag".into()),
        }
    }
    fn optional(&mut self) -> Result<Option<u64>, String> {
        let present = self.flag()?;
        let n = self.exact()?;
        if !present && n != 0 {
            return Err("absent context value must be zero".into());
        }
        Ok(present.then_some(n))
    }
    fn text(&mut self, empty: bool) -> Result<String, String> {
        let n = usize::from(self.u16()?);
        if n > 128 || (!empty && n == 0) {
            return Err("invalid context text length".into());
        }
        String::from_utf8(self.take(n)?.to_vec()).map_err(|_| "invalid context UTF-8".into())
    }
    fn count(&mut self, max: usize) -> Result<usize, String> {
        let n = usize::from(self.u16()?);
        if n > max {
            Err("context collection exceeds bound".into())
        } else {
            Ok(n)
        }
    }
    fn day(&mut self, exclusive: bool) -> Result<i32, String> {
        let n = self.u32()?;
        if n > if exclusive { 2_932_897 } else { 2_932_896 } {
            Err("invalid context date".into())
        } else {
            Ok(n as i32)
        }
    }
    fn finish(self) -> Result<(), String> {
        if self.at != self.bytes.len() {
            Err("trailing context packet bytes".into())
        } else {
            Ok(())
        }
    }
}

fn binding(r: &mut Reader<'_>) -> Result<ProviderBinding, String> {
    let kind = r.u8()?;
    if kind > 2 {
        return Err("invalid context provider kind".into());
    }
    Ok(ProviderBinding {
        kind,
        provider: r.text(false)?,
        namespace: r.text(false)?,
        station: r.text(false)?,
        binding_revision: r.text(false)?,
        location: r.text(false)?,
        timezone: r.text(false)?,
        criteria: r.text(false)?,
        max_uncertainty_ms: r.exact()?,
    })
}

fn observation(r: &mut Reader<'_>) -> Result<ProviderObservation, String> {
    let binding = binding(r)?;
    let provider_revision = r.text(false)?;
    let coverage_start_ms = r.exact()?;
    let coverage_end_ms = r.exact()?;
    let expires_at_ms = r.exact()?;
    let uncertainty_ms = r.exact()?;
    let fault = match r.u8()? {
        255 => None,
        code @ 0..=5 => Some(code),
        _ => return Err("invalid natural fault code".into()),
    };
    let count = usize::from(r.u8()?);
    if count > 8 {
        return Err("too many natural classifications".into());
    }
    let mut classifications = Vec::with_capacity(count);
    for _ in 0..count {
        classifications.push(r.text(false)?);
    }
    Ok(ProviderObservation {
        binding,
        provider_revision,
        coverage_start_ms,
        coverage_end_ms,
        expires_at_ms,
        uncertainty_ms,
        fault,
        classifications,
    })
}

fn calendar(r: &mut Reader<'_>) -> Result<WorkCalendarSnapshot, String> {
    let calendar_id = r.text(false)?;
    let revision = r.text(false)?;
    let timezone = r.text(false)?;
    let covered_from_date = r.day(false)?;
    let covered_to_date_exclusive = r.day(true)?;
    let expires_at_ms = r.exact()?;
    let weekly_work_mask = r.u8()?;
    let holiday_policy = if r.flag()? {
        DayClass::Work
    } else {
        DayClass::Off
    };
    let count = r.count(4096)?;
    let mut holidays = Vec::with_capacity(count);
    for _ in 0..count {
        holidays.push(r.day(false)?);
    }
    let count = r.count(4096)?;
    let mut exceptions = Vec::with_capacity(count);
    for _ in 0..count {
        exceptions.push(DayException {
            date: r.day(false)?,
            class: if r.flag()? {
                DayClass::Work
            } else {
                DayClass::Off
            },
        });
    }
    Ok(WorkCalendarSnapshot {
        calendar_id,
        revision,
        timezone,
        covered_from_date,
        covered_to_date_exclusive,
        expires_at_ms,
        weekly_work_mask,
        holiday_policy,
        holidays,
        exceptions,
    })
}

fn schedule(r: &mut Reader<'_>) -> Result<ScheduleEvidence, String> {
    let site = r.u32()?;
    let coverage_start_ms = r.exact()?;
    let coverage_end_ms = r.exact()?;
    let provider = if r.flag()? {
        Some(observation(r)?)
    } else {
        None
    };
    let calendar = if r.flag()? { Some(calendar(r)?) } else { None };
    let count = r.count(4096)?;
    let mut rows = Vec::with_capacity(count);
    for _ in 0..count {
        let source_day = r.day(false)?;
        let slot_key = r.exact()?;
        let minute_of_day = r.u16()?;
        let fold = r.u8()?;
        let event_id = r.text(true)?;
        let event_kind = r.u8()?;
        if minute_of_day >= 1440 || fold > 2 || event_kind > 2 {
            return Err("invalid context occurrence identity".into());
        }
        let instant_ms = r.optional()?;
        let withdrawn = r.flag()?;
        let provider_revision = r.text(false)?;
        let context_revision = r.text(false)?;
        rows.push(Occurrence {
            source_day,
            slot_key,
            minute_of_day,
            fold,
            event_id,
            event_kind,
            instant_ms,
            withdrawn,
            provider_revision,
            context_revision,
        });
    }
    Ok(ScheduleEvidence {
        site,
        coverage_start_ms,
        coverage_end_ms,
        provider,
        calendar,
        rows,
    })
}

fn solar(r: &mut Reader<'_>) -> Result<SolarContextEvidence, String> {
    use ghostflow_core::solar_admission::{SolarFact, SolarFactAvailability};
    let site = r.u32()?;
    let timezone = r.text(false)?;
    let latitude = f64::from_le_bytes(r.take(8)?.try_into().unwrap());
    let longitude = f64::from_le_bytes(r.take(8)?.try_into().unwrap());
    let event = r.u8()?;
    let offset_ms = r.raw64()? as i64;
    if !latitude.is_finite()
        || !longitude.is_finite()
        || !(-90.0..=90.0).contains(&latitude)
        || !(-180.0..=180.0).contains(&longitude)
        || event > 1
        || offset_ms.unsigned_abs() > 86_400_000
    {
        return Err("invalid Solar context immutable binding".into());
    }
    let coverage_start_ms = r.exact()?;
    let coverage_end_ms = r.exact()?;
    let count = r.count(4096)?;
    let mut rows = Vec::with_capacity(count);
    for _ in 0..count {
        let source_day = r.day(false)?;
        let availability = match r.u8()? {
            0 => SolarFactAvailability::Available,
            1 => SolarFactAvailability::Unavailable,
            _ => return Err("invalid Solar fact availability".into()),
        };
        let scheduled_wall_ms = r.optional()?;
        let fallback_wall_ms = r.optional()?;
        let unavailable_reason = match r.u8()? {
            255 => None,
            reason @ 0..=5 => Some(reason),
            _ => return Err("invalid Solar unavailable reason".into()),
        };
        if fallback_wall_ms.is_some() && unavailable_reason.is_none() {
            return Err("Solar fallback requires unavailable reason".into());
        }
        rows.push(SolarFact {
            source_day,
            availability,
            scheduled_wall_ms,
            fallback_wall_ms,
            unavailable_reason,
            provider_revision: r.text(false)?,
            context_revision: r.text(false)?,
            slot_key: 0,
            minute_of_day: 0,
            fold: 0,
        });
    }
    Ok(SolarContextEvidence {
        site,
        timezone,
        latitude,
        longitude,
        event,
        offset_ms,
        coverage_start_ms,
        coverage_end_ms,
        rows,
    })
}

fn settings(r: &mut Reader<'_>) -> Result<SettingsEvent, String> {
    let program_fingerprint = r.raw64()?;
    let event_id = r.text(false)?;
    let base_revision = r.exact()?;
    let position = r.exact()?;
    let origin = match r.u8()? {
        0 => SettingsOrigin::OperatorEdit,
        1 => SettingsOrigin::ProducerObservation,
        2 => SettingsOrigin::TemporaryReturn,
        _ => return Err("invalid settings origin".into()),
    };
    let count = r.count(128)?;
    let mut changes = Vec::with_capacity(count);
    for _ in 0..count {
        let id = r.u32()?;
        let (semantic_type, result) = match r.u8()? {
            0 => {
                let semantic_type = r.text(false)?;
                let value = match r.u8()? {
                    0 => ConfigValue::Scalar(Value::Bool(r.flag()?)),
                    1 => ConfigValue::Scalar(Value::Int(i32::from_le_bytes(
                        r.take(4)?.try_into().unwrap(),
                    ))),
                    2 => {
                        let value = f64::from_le_bytes(r.take(8)?.try_into().unwrap());
                        if !value.is_finite() {
                            return Err("nonfinite settings payload".into());
                        }
                        ConfigValue::Scalar(Value::Number(value))
                    }
                    3 => {
                        let count = r.count(4096)?;
                        let mut slots = Vec::with_capacity(count);
                        for _ in 0..count {
                            slots.push((r.exact()?, r.u16()?));
                        }
                        ConfigValue::Slots(slots)
                    }
                    _ => return Err("invalid settings value tag".into()),
                };
                (semantic_type, Ok(value))
            }
            1 => {
                let fault = r.u8()?;
                if fault > 1 {
                    return Err("invalid settings fault".into());
                }
                (String::new(), Err(fault))
            }
            _ => return Err("invalid settings Result tag".into()),
        };
        changes.push(SettingChange {
            id,
            semantic_type,
            result,
        });
    }
    Ok(SettingsEvent {
        program_fingerprint,
        event_id,
        base_revision,
        position,
        origin,
        changes,
    })
}

pub(crate) struct Packet {
    monotonic_ms: u64,
    boot_epoch: u64,
    wall_ms: Option<u64>,
    uncertainty_ms: Option<u64>,
    trusted: bool,
    reason: String,
    revision: String,
    pub(crate) facts: Facts,
}

impl Packet {
    pub(crate) fn clock(&self) -> ClockSnapshot<'_> {
        ClockSnapshot {
            monotonic_ms: self.monotonic_ms,
            boot_epoch: self.boot_epoch,
            wall_ms: self.wall_ms,
            uncertainty_ms: self.uncertainty_ms,
            trust: if self.trusted {
                ClockTrust::Trusted
            } else {
                ClockTrust::Unknown(&self.reason)
            },
            source_revision: (!self.revision.is_empty()).then_some(self.revision.as_str()),
        }
    }
}

pub(crate) unsafe fn activation_from_raw(ptr: *const u8, len: usize) -> Result<Activation, String> {
    if ptr.is_null() || len > MAX_PACKET {
        return Err("invalid context activation pointer/length".into());
    }
    decode_activation(std::slice::from_raw_parts(ptr, len))
}

pub(crate) unsafe fn facts_from_raw(ptr: *const u8, len: usize) -> Result<Packet, String> {
    if ptr.is_null() || len > MAX_PACKET {
        return Err("invalid context facts pointer/length".into());
    }
    decode_facts(std::slice::from_raw_parts(ptr, len))
}

fn decode_activation(bytes: &[u8]) -> Result<Activation, String> {
    let mut r = Reader { bytes, at: 0 };
    if bytes.len() > MAX_PACKET || r.take(4)? != b"GFCA" || r.u16()? != 1 {
        return Err("invalid context activation header".into());
    }
    let boot_epoch = r.exact()?;
    let terminal_capacity = r.u32()? as usize;
    let count = r.count(128)?;
    let mut bindings = Vec::with_capacity(count);
    for _ in 0..count {
        bindings.push(binding(&mut r)?);
    }
    r.finish()?;
    Ok(Activation {
        boot_epoch,
        terminal_capacity,
        bindings,
    })
}

fn decode_facts(bytes: &[u8]) -> Result<Packet, String> {
    let mut r = Reader { bytes, at: 0 };
    if bytes.len() > MAX_PACKET || r.take(4)? != b"GFSF" {
        return Err("invalid context facts header".into());
    }
    let version = r.u16()?;
    if !matches!(version, 5 | 6) {
        return Err("invalid context facts header".into());
    }
    let monotonic_ms = r.exact()?;
    let boot_epoch = r.exact()?;
    let wall_ms = r.optional()?;
    let uncertainty_ms = r.optional()?;
    let trusted = r.flag()?;
    let reason = r.text(true)?;
    let revision = r.text(true)?;
    if trusted != reason.is_empty() {
        return Err("invalid context clock reason".into());
    }
    let mut facts = Facts::default();
    let count = r.count(128)?;
    for _ in 0..count {
        facts.natural.push(observation(&mut r)?);
    }
    let count = r.count(128)?;
    for _ in 0..count {
        facts.schedules.push(schedule(&mut r)?);
    }
    if r.flag()? {
        facts.settings = Some(settings(&mut r)?);
    }
    if version == 6 {
        let count = r.count(128)?;
        for _ in 0..count {
            facts.solars.push(solar(&mut r)?);
        }
    }
    r.finish()?;
    Ok(Packet {
        monotonic_ms,
        boot_epoch,
        wall_ms,
        uncertainty_ms,
        trusted,
        reason,
        revision,
        facts,
    })
}

#[no_mangle]
pub unsafe extern "C" fn gf_activate_context(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    if ptr.is_null() || len > MAX_PACKET {
        h.error = "invalid context activation pointer/length".into();
        return 0;
    }
    match decode_activation(std::slice::from_raw_parts(ptr, len)) {
        Ok(profile) => {
            let result = h.runtime.activate_with_context(&profile);
            h.complete(result)
        }
        Err(error) => {
            h.error = error;
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn gf_tick_context(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    if ptr.is_null() || len > MAX_PACKET {
        h.error = "invalid context facts pointer/length".into();
        return 0;
    }
    let packet = match decode_facts(std::slice::from_raw_parts(ptr, len)) {
        Ok(packet) => packet,
        Err(error) => {
            h.error = error;
            return 0;
        }
    };
    let clock = ClockSnapshot {
        monotonic_ms: packet.monotonic_ms,
        boot_epoch: packet.boot_epoch,
        wall_ms: packet.wall_ms,
        uncertainty_ms: packet.uncertainty_ms,
        trust: if packet.trusted {
            ClockTrust::Trusted
        } else {
            ClockTrust::Unknown(&packet.reason)
        },
        source_revision: (!packet.revision.is_empty()).then_some(packet.revision.as_str()),
    };
    let result = h
        .runtime
        .tick_with_context(clock, &packet.facts)
        .map(|_| ());
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_context_checkpoint(handle: *mut super::Handle) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h
        .runtime
        .context_checkpoint()
        .and_then(|bytes| h.runtime.context_state_json().map(|state| (bytes, state)));
    match result {
        Ok((bytes, state)) => {
            h.context_checkpoint = bytes;
            h.context_state = state;
            h.error.clear();
            1
        }
        Err(error) => {
            h.error = error.to_string();
            0
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn gf_context_checkpoint_ptr(handle: *const super::Handle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.context_checkpoint.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_context_checkpoint_len(handle: *const super::Handle) -> usize {
    handle.as_ref().map_or(0, |h| h.context_checkpoint.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_context_state_ptr(handle: *const super::Handle) -> *const u8 {
    handle
        .as_ref()
        .map_or(std::ptr::null(), |h| h.context_state.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn gf_context_state_len(handle: *const super::Handle) -> usize {
    handle.as_ref().map_or(0, |h| h.context_state.len())
}
#[no_mangle]
pub unsafe extern "C" fn gf_restore_context_checkpoint(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    if ptr.is_null() || len > 4 * 1024 * 1024 {
        h.error = "invalid context checkpoint pointer/length".into();
        return 0;
    }
    let result = h
        .runtime
        .restore_context_checkpoint(std::slice::from_raw_parts(ptr, len));
    h.complete(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn text(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
    }
    fn solar_packet(reason: u8) -> Vec<u8> {
        let mut bytes = b"GFSF\x06\x00".to_vec();
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.extend_from_slice(&1u64.to_le_bytes());
        bytes.push(1);
        bytes.extend_from_slice(&90u64.to_le_bytes());
        bytes.push(1);
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.push(1);
        text(&mut bytes, "");
        text(&mut bytes, "clock-1");
        bytes.extend_from_slice(&[0, 0, 0, 0, 0]); // no natural/civil/settings
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&7u32.to_le_bytes());
        text(&mut bytes, "UTC");
        bytes.extend_from_slice(&37f64.to_le_bytes());
        bytes.extend_from_slice(&127f64.to_le_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&(-1i64).to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.extend_from_slice(&1_000u64.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.push(1); // unavailable
        bytes.push(0);
        bytes.extend_from_slice(&0u64.to_le_bytes()); // absent scheduled
        bytes.push(1);
        bytes.extend_from_slice(&100u64.to_le_bytes()); // fallback
        bytes.push(reason);
        text(&mut bytes, "provider-1");
        text(&mut bytes, "context-1");
        bytes
    }
    #[test]
    fn solar_context_packet_keeps_complete_facts_and_rejects_reason_omission_and_truncation() {
        let bytes = solar_packet(2);
        let packet = decode_facts(&bytes).unwrap();
        let solar = &packet.facts.solars[0];
        assert_eq!(
            (
                solar.site,
                solar.latitude,
                solar.longitude,
                solar.event,
                solar.offset_ms
            ),
            (7, 37.0, 127.0, 0, -1)
        );
        assert_eq!(solar.timezone, "UTC");
        assert_eq!(solar.rows[0].fallback_wall_ms, Some(100));
        assert_eq!(solar.rows[0].unavailable_reason, Some(2));
        assert_eq!(solar.rows[0].provider_revision, "provider-1");
        assert_eq!(solar.rows[0].context_revision, "context-1");
        assert!(decode_facts(&solar_packet(255)).is_err());
        for end in 0..bytes.len() {
            assert!(decode_facts(&bytes[..end]).is_err());
        }
        let mut trailing = bytes;
        trailing.push(0);
        assert!(decode_facts(&trailing).is_err());
    }
    #[test]
    fn context_activation_rejects_trailing_and_oversized_packets() {
        let mut bytes = b"GFCA\x01\x00".to_vec();
        bytes.extend_from_slice(&1u64.to_le_bytes());
        bytes.extend_from_slice(&8u32.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        assert!(decode_activation(&bytes).is_ok());
        bytes.push(0);
        assert!(decode_activation(&bytes).is_err());
        assert!(decode_activation(&vec![0; MAX_PACKET + 1]).is_err());
    }
    #[test]
    fn arbitrary_projection_payload_and_legacy_versions_are_rejected() {
        assert!(decode_facts(b"GFSF\x03\x00").is_err());
        assert!(decode_facts(b"GFSF\x04\x00\x01").is_err());
    }
    #[test]
    fn stream_semantic_payload_survives_decode_but_invalid_representation_rejects() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&1u64.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.push(b'e');
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes.extend_from_slice(&1u64.to_le_bytes());
        bytes.push(0); // host-authenticated operator edit origin
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&7u32.to_le_bytes());
        bytes.push(0); // ok rail; negativity is a semantic Duration error, not malformed bytes.
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(b"Duration");
        bytes.push(2);
        bytes.extend_from_slice(&(-1f64).to_le_bytes());
        let event = settings(&mut Reader {
            bytes: &bytes,
            at: 0,
        })
        .unwrap();
        assert_eq!(
            event.changes[0].result,
            Ok(ConfigValue::Scalar(Value::Number(-1.0)))
        );
        let end = bytes.len();
        bytes[end - 8..].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(settings(&mut Reader {
            bytes: &bytes,
            at: 0
        })
        .is_err());
    }
}
