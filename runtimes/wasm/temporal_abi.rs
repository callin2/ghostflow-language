use ghostflow_core::{
    temporal::{RootDensity, TargetBudget},
    temporal_runtime::TemporalActivation,
};

const MAX_ROOTS: usize = (128 - 2) / 4;
const HEADER_BYTES: usize = 24;
const ROOT_BYTES: usize = 16;
const CERTIFIED_HEADER_BYTES: usize = 28;
const MAX_PACKET_BYTES: usize = HEADER_BYTES + ROOT_BYTES * MAX_ROOTS;
const MAX_EXACT: u64 = (1_u64 << 53) - 1;

#[derive(Debug, PartialEq, Eq)]
pub struct TemporalProfilePacket {
    pub activation: TemporalActivation,
    pub certified_bool_roots: Vec<u32>,
}

pub unsafe fn from_raw(ptr: *const u8, len: usize) -> Result<TemporalActivation, String> {
    let packet = from_raw_packet(ptr, len)?;
    if !packet.certified_bool_roots.is_empty() {
        return Err("certified Bool roots require GFB6 runtime activation".into());
    }
    Ok(packet.activation)
}

pub unsafe fn from_raw_packet(ptr: *const u8, len: usize) -> Result<TemporalProfilePacket, String> {
    // Bound length before constructing a slice, including malformed direct ABI calls.
    if len > MAX_PACKET_BYTES {
        return Err("temporal profile exceeds 520 bytes".into());
    }
    if ptr.is_null() {
        return Err("temporal profile pointer is null".into());
    }
    decode_packet(std::slice::from_raw_parts(ptr, len))
}

fn decode(bytes: &[u8]) -> Result<TemporalActivation, String> {
    let packet = decode_packet(bytes)?;
    if !packet.certified_bool_roots.is_empty() {
        return Err("certified Bool roots require GFB6 runtime activation".into());
    }
    Ok(packet.activation)
}

fn decode_packet(bytes: &[u8]) -> Result<TemporalProfilePacket, String> {
    if bytes.len() > MAX_PACKET_BYTES {
        return Err("temporal profile exceeds 520 bytes".into());
    }
    if bytes.len() < HEADER_BYTES {
        return Err("temporal profile is truncated".into());
    }
    if &bytes[..4] != b"GFTA" {
        return Err("invalid temporal profile magic".into());
    }
    let version = u16::from_le_bytes([bytes[4], bytes[5]]);
    if version != 1 && version != 2 {
        return Err("unsupported temporal profile version".into());
    }
    let count = usize::from(u16::from_le_bytes([bytes[6], bytes[7]]));
    let certified_count = if version == 2 {
        if bytes.len() < CERTIFIED_HEADER_BYTES {
            return Err("temporal profile is truncated".into());
        }
        if bytes[26] != 0 || bytes[27] != 0 {
            return Err("temporal profile reserved bytes must be zero".into());
        }
        usize::from(u16::from_le_bytes([bytes[24], bytes[25]]))
    } else {
        0
    };
    if count + certified_count == 0
        || count + certified_count > MAX_ROOTS
        || (version == 2 && certified_count == 0)
    {
        return Err("temporal profile requires 1..31 roots".into());
    }
    let header = if version == 2 {
        CERTIFIED_HEADER_BYTES
    } else {
        HEADER_BYTES
    };
    if bytes.len() != header + ROOT_BYTES * count + 4 * certified_count {
        return Err("temporal profile length does not match root count".into());
    }
    // Header and exact record size have been checked before these fixed-width reads.
    let u32_at = |at| {
        u32::from_le_bytes(
            bytes[at..at + 4]
                .try_into()
                .expect("checked four-byte field"),
        )
    };
    let u64_at = |at| {
        u64::from_le_bytes(
            bytes[at..at + 8]
                .try_into()
                .expect("checked eight-byte field"),
        )
    };
    let time_epoch = u64_at(8);
    if time_epoch > MAX_EXACT {
        return Err("temporal time epoch exceeds exact integer range".into());
    }
    let max_retained_samples = u32_at(16) as usize;
    let max_bytes = u32_at(20) as usize;
    if max_retained_samples == 0 || max_bytes == 0 {
        return Err("temporal budgets must be positive".into());
    }
    let mut root_density = Vec::new();
    root_density
        .try_reserve_exact(count)
        .map_err(|_| "temporal profile allocation failed")?;
    let mut previous = 0;
    for index in 0..count {
        let at = header + ROOT_BYTES * index;
        let source_tag = u32_at(at);
        let max_observations = u32_at(at + 4) as usize;
        let interval_ms = u64_at(at + 8);
        if source_tag <= previous {
            return Err("temporal source tags must be positive and strictly increasing".into());
        }
        if max_observations == 0 || interval_ms == 0 || interval_ms > MAX_EXACT {
            return Err("temporal density is outside exact positive range".into());
        }
        root_density.push(RootDensity {
            source_tag,
            max_observations,
            interval_ms,
        });
        previous = source_tag;
    }
    let mut certified_bool_roots = Vec::new();
    certified_bool_roots
        .try_reserve_exact(certified_count)
        .map_err(|_| "temporal profile allocation failed")?;
    previous = 0;
    for index in 0..certified_count {
        let source_tag = u32_at(header + ROOT_BYTES * count + 4 * index);
        if source_tag <= previous {
            return Err(
                "certified Bool source tags must be positive and strictly increasing".into(),
            );
        }
        certified_bool_roots.push(source_tag);
        previous = source_tag;
    }
    Ok(TemporalProfilePacket {
        activation: TemporalActivation {
            root_density,
            budget: TargetBudget {
                max_retained_samples,
                max_bytes,
            },
            time_epoch,
        },
        certified_bool_roots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet() -> Vec<u8> {
        let mut bytes = b"GFTA".to_vec();
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&7_u64.to_le_bytes());
        bytes.extend_from_slice(&4_u32.to_le_bytes());
        bytes.extend_from_slice(&4_000_000_u32.to_le_bytes());
        bytes.extend_from_slice(&11_u32.to_le_bytes());
        bytes.extend_from_slice(&4_u32.to_le_bytes());
        bytes.extend_from_slice(&1000_u64.to_le_bytes());
        bytes
    }

    #[test]
    fn exact_profile_decodes_without_operating_defaults() {
        let value = decode(&packet()).unwrap();
        assert_eq!(value.time_epoch, 7);
        assert_eq!(value.budget.max_retained_samples, 4);
        assert_eq!(value.budget.max_bytes, 4_000_000);
        assert_eq!(
            value.root_density,
            vec![RootDensity {
                source_tag: 11,
                max_observations: 4,
                interval_ms: 1000
            }]
        );
    }

    #[test]
    fn certified_bool_profile_preserves_driver_source_tags_but_cannot_activate_v1() {
        let mut bytes = b"GFTA".to_vec();
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&0_u16.to_le_bytes());
        bytes.extend_from_slice(&7_u64.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&4_000_000_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&0_u16.to_le_bytes());
        bytes.extend_from_slice(&11_u32.to_le_bytes());
        let packet = decode_packet(&bytes).unwrap();
        assert_eq!(packet.activation.time_epoch, 7);
        assert!(packet.activation.root_density.is_empty());
        assert_eq!(packet.certified_bool_roots, vec![11]);
        assert_eq!(
            decode(&bytes).unwrap_err(),
            "certified Bool roots require GFB6 runtime activation"
        );
        bytes[28] = 0;
        assert_eq!(
            decode_packet(&bytes).unwrap_err(),
            "certified Bool source tags must be positive and strictly increasing"
        );
    }

    #[test]
    fn every_truncation_and_trailing_or_oversized_packet_is_rejected() {
        let valid = packet();
        for end in 0..valid.len() {
            assert!(decode(&valid[..end]).is_err(), "cut {end}");
        }
        let mut trailing = valid;
        trailing.push(0);
        assert_eq!(
            decode(&trailing).unwrap_err(),
            "temporal profile length does not match root count"
        );
        assert_eq!(
            decode(&vec![0; MAX_PACKET_BYTES + 1]).unwrap_err(),
            "temporal profile exceeds 520 bytes"
        );
    }

    #[test]
    fn invalid_numeric_domains_and_noncanonical_roots_are_rejected() {
        for (at, replacement, expected) in [
            (0, vec![0], "invalid temporal profile magic"),
            (
                4,
                3_u16.to_le_bytes().to_vec(),
                "unsupported temporal profile version",
            ),
            (
                6,
                0_u16.to_le_bytes().to_vec(),
                "temporal profile requires 1..31 roots",
            ),
            (
                6,
                32_u16.to_le_bytes().to_vec(),
                "temporal profile requires 1..31 roots",
            ),
            (
                8,
                (MAX_EXACT + 1).to_le_bytes().to_vec(),
                "temporal time epoch exceeds exact integer range",
            ),
            (
                16,
                0_u32.to_le_bytes().to_vec(),
                "temporal budgets must be positive",
            ),
            (
                20,
                0_u32.to_le_bytes().to_vec(),
                "temporal budgets must be positive",
            ),
            (
                24,
                0_u32.to_le_bytes().to_vec(),
                "temporal source tags must be positive and strictly increasing",
            ),
            (
                28,
                0_u32.to_le_bytes().to_vec(),
                "temporal density is outside exact positive range",
            ),
            (
                32,
                0_u64.to_le_bytes().to_vec(),
                "temporal density is outside exact positive range",
            ),
            (
                32,
                (MAX_EXACT + 1).to_le_bytes().to_vec(),
                "temporal density is outside exact positive range",
            ),
        ] {
            let mut bytes = packet();
            bytes[at..at + replacement.len()].copy_from_slice(&replacement);
            assert_eq!(decode(&bytes).unwrap_err(), expected, "offset {at}");
        }
        for tag in [11_u32, 1] {
            let mut bytes = packet();
            let mut second = bytes[24..].to_vec();
            second[..4].copy_from_slice(&tag.to_le_bytes());
            bytes.extend_from_slice(&second);
            bytes[6] = 2;
            assert_eq!(
                decode(&bytes).unwrap_err(),
                "temporal source tags must be positive and strictly increasing"
            );
        }
        unsafe {
            assert_eq!(
                from_raw(std::ptr::null(), 40).unwrap_err(),
                "temporal profile pointer is null"
            );
            assert_eq!(
                from_raw(std::ptr::null(), 521).unwrap_err(),
                "temporal profile exceeds 520 bytes"
            );
        }
    }
}
