//! Bounded durable context checkpoint, scoped to one exact Program and bindings.
use super::*;
use crate::Reader;
use std::fmt::Write;

pub const MAX_CHECKPOINT: usize = 4 * 1024 * 1024;

fn append(out: &mut Vec<u8>, bytes: &[u8]) -> Result<()> {
    if out
        .len()
        .checked_add(bytes.len())
        .is_none_or(|n| n > MAX_CHECKPOINT - 4)
    {
        return Err(invalid("context checkpoint capacity exceeded"));
    }
    out.extend_from_slice(bytes);
    Ok(())
}
fn text(out: &mut Vec<u8>, value: &str) -> Result<()> {
    let count = u16::try_from(value.len()).map_err(|_| invalid("checkpoint text exceeds bound"))?;
    append(out, &count.to_le_bytes())?;
    append(out, value.as_bytes())
}
fn blob(out: &mut Vec<u8>, bytes: &[u8]) -> Result<()> {
    let count = u32::try_from(bytes.len()).map_err(|_| invalid("checkpoint blob exceeds bound"))?;
    append(out, &count.to_le_bytes())?;
    append(out, bytes)
}
fn bindings(bindings: &[ProviderBinding]) -> Result<Vec<u8>> {
    let mut sorted: Vec<_> = bindings.iter().collect();
    sorted.sort_by(|a, b| a.provider.cmp(&b.provider));
    let mut out = Vec::new();
    append(&mut out, &(sorted.len() as u16).to_le_bytes())?;
    for binding in sorted {
        append(&mut out, &[binding.kind])?;
        for value in [
            &binding.provider,
            &binding.namespace,
            &binding.station,
            &binding.binding_revision,
            &binding.location,
            &binding.timezone,
            &binding.criteria,
        ] {
            text(&mut out, value)?;
        }
        append(&mut out, &binding.max_uncertainty_ms.to_le_bytes())?;
    }
    Ok(out)
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
fn read_blob<'a>(reader: &mut Reader<'a>) -> Result<Vec<u8>> {
    let length = reader.u32()? as usize;
    if length > MAX_CHECKPOINT {
        return Err(invalid("checkpoint section exceeds bound"));
    }
    Ok(reader.take(length)?.to_vec())
}

impl ContextRuntime {
    pub(crate) fn snapshot(
        &self,
        descriptors: &[PulseDescriptor],
        fingerprint: u64,
    ) -> Result<Vec<u8>> {
        let mut out = b"GFCX\x01\x00".to_vec();
        append(&mut out, &fingerprint.to_le_bytes())?;
        blob(&mut out, &bindings(&self.bindings)?)?;
        append(&mut out, &self.settings_revision.to_le_bytes())?;
        append(&mut out, &(self.event_ids.len() as u16).to_le_bytes())?;
        for event in &self.event_ids {
            text(&mut out, event)?;
        }
        append(&mut out, &(descriptors.len() as u16).to_le_bytes())?;
        for (descriptor, engine) in descriptors.iter().zip(&self.engines) {
            append(&mut out, &descriptor.site().to_le_bytes())?;
            match engine {
                Some(engine) => blob(&mut out, &engine.snapshot()?)?,
                None => blob(&mut out, &[])?,
            }
        }
        let checksum = crc32(&out);
        out.extend_from_slice(&checksum.to_le_bytes());
        Ok(out)
    }

    pub(crate) fn restored(
        &self,
        descriptors: &[PulseDescriptor],
        fingerprint: u64,
        bytes: &[u8],
    ) -> Result<Self> {
        if bytes.len() < 18 || bytes.len() > MAX_CHECKPOINT {
            return Err(invalid("invalid context checkpoint size"));
        }
        let (payload, checksum) = bytes.split_at(bytes.len() - 4);
        let checksum = u32::from_le_bytes(
            checksum
                .try_into()
                .map_err(|_| invalid("invalid context checkpoint checksum"))?,
        );
        if crc32(payload) != checksum {
            return Err(invalid("corrupt context checkpoint"));
        }
        let mut reader = Reader::new(payload);
        if reader.take(4)? != b"GFCX" || reader.u16()? != 1 || reader.u64()? != fingerprint {
            return Err(invalid("context checkpoint Program identity mismatch"));
        }
        if read_blob(&mut reader)? != bindings(&self.bindings)? {
            return Err(invalid("context checkpoint provider identity mismatch"));
        }
        let mut restored = self.clone();
        restored.settings_revision = reader.u64()?;
        let count = usize::from(reader.u16()?);
        if count > self.capacity || restored.settings_revision > 9_007_199_254_740_991 {
            return Err(invalid("context checkpoint settings bound"));
        }
        restored.event_ids.clear();
        for _ in 0..count {
            let event = reader.string()?;
            if !bounded(&event) || !restored.event_ids.insert(event) {
                return Err(invalid("invalid checkpoint event identity"));
            }
        }
        if usize::from(reader.u16()?) != descriptors.len() {
            return Err(invalid("checkpoint descriptor count mismatch"));
        }
        for (index, descriptor) in descriptors.iter().enumerate() {
            if reader.u32()? != descriptor.site() {
                return Err(invalid("checkpoint site mismatch"));
            }
            let bytes = read_blob(&mut reader)?;
            restored.engines[index] = match descriptor {
                PulseDescriptor::Context(d) => Some(crate::context_schedule::Engine::restore(
                    d,
                    self.boot_epoch,
                    self.capacity,
                    &bytes,
                )?),
                _ if bytes.is_empty() => None,
                _ => return Err(invalid("unexpected checkpoint engine state")),
            };
        }
        if reader.at != payload.len() {
            return Err(invalid("trailing context checkpoint bytes"));
        }
        // Event positions and clocks are run-local; durable identities are not.
        restored.last_event_position = None;
        restored.clock = ScheduleClockGate::new(9_007_199_254_740_991, self.boot_epoch)?;
        Ok(restored)
    }

    pub(crate) fn state_json(
        &self,
        descriptors: &[PulseDescriptor],
        fingerprint: u64,
    ) -> Result<String> {
        let mut out = format!("{{\"programFingerprint\":\"{fingerprint:016x}\",\"settingsRevision\":{},\"settings\":[", self.settings_revision);
        let mut first = true;
        for (descriptor, engine) in descriptors.iter().zip(&self.engines) {
            let Some(value) = engine.as_ref().and_then(|e| match descriptor {
                PulseDescriptor::Context(d) => e.effective_setting(d),
                _ => None,
            }) else {
                continue;
            };
            if !first {
                out.push(',');
            }
            first = false;
            write!(out, "{{\"site\":{},\"value\":", descriptor.site())
                .map_err(|_| invalid("context state formatting"))?;
            match value {
                SettingValue::Duration(value) => {
                    write!(out, "{{\"kind\":\"duration\",\"milliseconds\":{value}}}")
                        .map_err(|_| invalid("context state formatting"))?
                }
                SettingValue::Slots(slots) => {
                    out.push_str("{\"kind\":\"slots\",\"entries\":[");
                    for (index, (key, minute)) in slots.iter().enumerate() {
                        if index > 0 {
                            out.push(',');
                        }
                        write!(out, "{{\"key\":{key},\"minuteOfDay\":{minute}}}")
                            .map_err(|_| invalid("context state formatting"))?;
                    }
                    out.push_str("]}");
                }
            }
            out.push('}');
        }
        out.push_str("]}");
        Ok(out)
    }
}
