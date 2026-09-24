//! Bounded GFSF v1 clock/provider-fact transport. No caller-computed due bit.
use ghostflow_core::{
    schedule_clock::{ClockSnapshot, ClockTrust},
    solar_admission::{SolarFact, SolarFactAvailability, SolarFacts},
    solar_runtime::{ScheduleInput, ScheduleKind, SolarActivation, SolarInput},
};

const MAX_PACKET: usize = 65_536;
const MAX_EXACT: u64 = (1_u64 << 53) - 1;
struct Packet {
    monotonic_ms: u64,
    boot_epoch: u64,
    wall_ms: Option<u64>,
    uncertainty_ms: Option<u64>,
    trusted: bool,
    reason: String,
    revision: String,
    schedules: Vec<Facts>,
}
struct Facts {
    site: u32,
    kind: ScheduleKind,
    from: u64,
    to: u64,
    rows: Vec<SolarFact>,
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Reader<'_> {
    fn take(&mut self, count: usize) -> Result<&[u8], String> {
        let end = self
            .at
            .checked_add(count)
            .ok_or("solar packet length overflow")?;
        let bytes = self
            .bytes
            .get(self.at..end)
            .ok_or("truncated solar packet")?;
        self.at = end;
        Ok(bytes)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let value = u64::from_le_bytes(self.take(8)?.try_into().unwrap());
        if value > MAX_EXACT {
            return Err("solar time exceeds exact integer range".into());
        }
        Ok(value)
    }
    fn flag(&mut self) -> Result<bool, String> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err("invalid solar flag".into()),
        }
    }
    fn optional(&mut self) -> Result<Option<u64>, String> {
        let present = self.flag()?;
        let value = self.u64()?;
        if !present && value != 0 {
            return Err("absent solar value must be zero".into());
        }
        Ok(present.then_some(value))
    }
    fn text(&mut self) -> Result<String, String> {
        let len = usize::from(self.u16()?);
        if len > 128 {
            return Err("solar text exceeds 128 bytes".into());
        }
        String::from_utf8(self.take(len)?.to_vec()).map_err(|_| "invalid solar UTF-8".into())
    }
}
fn decode(bytes: &[u8], version: u16) -> Result<Packet, String> {
    if bytes.len() > MAX_PACKET {
        return Err("solar packet exceeds 65536 bytes".into());
    }
    let mut reader = Reader { bytes, at: 0 };
    if reader.take(4)? != b"GFSF" || reader.u16()? != version {
        return Err("invalid solar packet header".into());
    }
    let count = usize::from(reader.u16()?);
    if !(1..=128).contains(&count) {
        return Err("invalid solar schedule count".into());
    }
    let mut packet = Packet {
        monotonic_ms: reader.u64()?,
        boot_epoch: reader.u64()?,
        wall_ms: reader.optional()?,
        uncertainty_ms: reader.optional()?,
        trusted: reader.flag()?,
        reason: reader.text()?,
        revision: reader.text()?,
        schedules: Vec::with_capacity(count),
    };
    if packet.trusted != packet.reason.is_empty() {
        return Err("invalid solar clock reason".into());
    }
    for _ in 0..count {
        let site = reader.u32()?;
        if site == 0 || packet.schedules.iter().any(|item| item.site == site) {
            return Err("invalid or duplicate solar site".into());
        }
        let kind = if version == 2 {
            match reader.u8()? {
                0 => ScheduleKind::Solar,
                1 => ScheduleKind::Daily,
                _ => return Err("invalid schedule kind".into()),
            }
        } else {
            ScheduleKind::Solar
        };
        let from = reader.u64()?;
        let to = reader.u64()?;
        let count = usize::from(reader.u16()?);
        if count > 4096 {
            return Err("solar fact count exceeds limit".into());
        }
        let mut rows = Vec::new();
        for _ in 0..count {
            let source_day = reader.u32()?;
            if source_day > 2_932_896 {
                return Err("invalid solar source day".into());
            }
            let fold = if version == 2 { reader.u8()? } else { 0 };
            if fold > 2 {
                return Err("invalid occurrence fold".into());
            }
            let available = reader.flag()?;
            let scheduled_wall_ms = reader.optional()?;
            if available != scheduled_wall_ms.is_some() {
                return Err("invalid solar availability".into());
            }
            let provider_revision = reader.text()?;
            let context_revision = reader.text()?;
            if provider_revision.is_empty() || context_revision.is_empty() {
                return Err("empty solar revision".into());
            }
            rows.push(SolarFact {
                source_day: source_day as i32,
                fold,
                scheduled_wall_ms,
                provider_revision,
                context_revision,
                availability: if available {
                    SolarFactAvailability::Available
                } else {
                    SolarFactAvailability::Unavailable
                },
            });
        }
        packet.schedules.push(Facts {
            site,
            kind,
            from,
            to,
            rows,
        });
    }
    if reader.at != bytes.len() {
        return Err("trailing solar packet bytes".into());
    }
    Ok(packet)
}

#[no_mangle]
pub unsafe extern "C" fn gf_activate_solar(
    handle: *mut super::Handle,
    boot_epoch: u64,
    terminal_capacity: u32,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.runtime.activate_with_solar(&SolarActivation {
        boot_epoch,
        terminal_capacity: terminal_capacity as usize,
    });
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_tick_solar(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    tick_facts(handle, ptr, len, 1)
}

#[no_mangle]
pub unsafe extern "C" fn gf_activate_schedules(
    handle: *mut super::Handle,
    boot_epoch: u64,
    terminal_capacity: u32,
) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    let result = h.runtime.activate_with_schedules(&SolarActivation {
        boot_epoch,
        terminal_capacity: terminal_capacity as usize,
    });
    h.complete(result)
}

#[no_mangle]
pub unsafe extern "C" fn gf_tick_schedules(
    handle: *mut super::Handle,
    ptr: *const u8,
    len: usize,
) -> i32 {
    tick_facts(handle, ptr, len, 2)
}

unsafe fn tick_facts(handle: *mut super::Handle, ptr: *const u8, len: usize, version: u16) -> i32 {
    let Some(h) = handle.as_mut() else { return 0 };
    if ptr.is_null() || len > MAX_PACKET {
        h.error = "invalid solar packet pointer or length".into();
        return 0;
    }
    let packet = match decode(std::slice::from_raw_parts(ptr, len), version) {
        Ok(packet) => packet,
        Err(error) => {
            h.error = error;
            return 0;
        }
    };
    let facts: Vec<_> = packet
        .schedules
        .iter()
        .map(|item| SolarInput {
            site: item.site,
            facts: SolarFacts {
                coverage_from_wall_ms: item.from,
                coverage_to_wall_ms: item.to,
                rows: &item.rows,
            },
        })
        .collect();
    let clock = ClockSnapshot {
        monotonic_ms: packet.monotonic_ms,
        boot_epoch: packet.boot_epoch,
        wall_ms: packet.wall_ms,
        uncertainty_ms: packet.uncertainty_ms,
        source_revision: (!packet.revision.is_empty()).then_some(packet.revision.as_str()),
        trust: if packet.trusted {
            ClockTrust::Trusted
        } else {
            ClockTrust::Unknown(&packet.reason)
        },
    };
    let result = if version == 1 {
        h.runtime.tick_with_solar(clock, &facts)
    } else {
        let inputs: Vec<_> = facts
            .iter()
            .zip(&packet.schedules)
            .map(|(input, encoded)| ScheduleInput {
                site: input.site,
                kind: encoded.kind,
                facts: input.facts,
            })
            .collect();
        h.runtime.tick_with_schedules(clock, &inputs)
    }
    .map(|_| ());
    h.complete(result)
}
