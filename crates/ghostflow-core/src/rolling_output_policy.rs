//! Bytecode-owned policy inspection. Ordinary Module activation rejects this profile.

use crate::accounting::RollingOutputOwner;
use crate::scan::ScanDriver;
use crate::{Capability, Error, Module, Reader, Result, Runtime, Type, Value, MAX_MODULE_BYTES};

const MAX_EXACT_DURATION: u64 = (1 << 53) - 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RollingOutputPolicyDescriptor {
    pub resource: String,
    pub output: String,
    pub window_ms: u64,
    pub limit_ms: u64,
    pub reserve_ms: u64,
}

impl RollingOutputPolicyDescriptor {
    /// Validate the mandatory profile and return only its immutable policy.
    pub fn inspect(bytes: &[u8]) -> Result<Self> {
        Ok(RollingOutputProgram::load(bytes)?.descriptor)
    }
}

/// Verified rolling control whose scalar module cannot be installed separately.
pub struct RollingOutputProgram {
    module: Module,
    descriptor: RollingOutputPolicyDescriptor,
}

impl RollingOutputProgram {
    pub fn load(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MODULE_BYTES {
            return Err(Error::new("rolling output module byte limit exceeded"));
        }
        let mut reader = Reader::new(bytes);
        if reader.take(4)? != b"GFB1" || reader.u16()? != 29 {
            return Err(Error::new("invalid GFB29 rolling output header"));
        }
        let inner_length = reader.u32()? as usize;
        let inner = reader.take(inner_length)?;
        if !matches!(inner.get(4..6), Some([1..=3, 0])) {
            return Err(Error::new("rolling output requires a scalar base module"));
        }
        let mut module = Module::load(inner)?;
        let policy = RollingOutputPolicyDescriptor {
            resource: reader.string()?,
            output: reader.string()?,
            window_ms: reader.u64()?,
            limit_ms: reader.u64()?,
            reserve_ms: reader.u64()?,
        };
        if !reader.finished()
            || !identifier(&policy.resource)
            || !identifier(&policy.output)
            || policy.reserve_ms == 0
            || policy.reserve_ms > policy.limit_ms
            || policy.limit_ms > policy.window_ms
            || policy.window_ms > MAX_EXACT_DURATION
        {
            return Err(Error::new("invalid rolling output policy"));
        }
        if !matches!(
            module.strategies.as_slice(),
            [strategy] if matches!(strategy.intents.as_slice(), [intent]
                if intent.name == policy.output && intent.value_type == Type::Bool)
        ) || module.temporal.is_some()
        {
            return Err(Error::new("rolling output requires one scalar Bool intent"));
        }
        module.fingerprint = bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
        module.bytecode_sha256 = crate::alarm_stream::sha256(bytes);
        Ok(Self {
            module,
            descriptor: policy,
        })
    }

    pub fn descriptor(&self) -> &RollingOutputPolicyDescriptor {
        &self.descriptor
    }

    pub fn name(&self) -> &str {
        self.module.name()
    }

    pub fn input_fields(&self) -> impl Iterator<Item = (&str, Type)> {
        self.module.input_fields()
    }

    pub fn state_fields(&self) -> impl Iterator<Item = (&str, Type, Value)> {
        self.module.state_fields()
    }

    pub fn output_fields(&self) -> impl Iterator<Item = (&str, Type)> {
        self.module.output_fields()
    }

    /// Activate only safe-intent evaluation. The sole output writer must
    /// independently reserve and settle an owner lease before applying ON.
    pub fn activate(
        self,
        owner: &RollingOutputOwner,
        installed_resource: &str,
        installed_output: &str,
        installed_resource_id: u32,
        capabilities: impl IntoIterator<Item = Capability>,
        journal_capacity: usize,
    ) -> Result<ScanDriver> {
        let mut runtime = Runtime::new(journal_capacity);
        self.install_proposals(
            &mut runtime,
            owner,
            installed_resource,
            installed_output,
            installed_resource_id,
        )?;
        for capability in capabilities {
            runtime.add_capability(capability)?;
        }
        runtime.activate()?;
        Ok(ScanDriver::new(runtime))
    }

    /// Install a proposal-only module into a configuring host runtime.
    pub fn install_proposals(
        self,
        runtime: &mut Runtime,
        owner: &RollingOutputOwner,
        installed_resource: &str,
        installed_output: &str,
        installed_resource_id: u32,
    ) -> Result<()> {
        let policy = owner.policy();
        if installed_resource != self.descriptor.resource
            || installed_output != self.descriptor.output
            || installed_resource_id != policy.resource_id
            || policy.window_ms != self.descriptor.window_ms
            || policy.limit_ms != self.descriptor.limit_ms
            || policy.reserve_ms != self.descriptor.reserve_ms
        {
            return Err(Error::new("installed rolling output owner policy mismatch"));
        }
        runtime.install(self.module, false);
        Ok(())
    }
}

fn identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_'))
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend((value.len() as u16).to_le_bytes());
        bytes.extend(value.as_bytes());
    }

    fn program(output: &str, reserve_ms: u64) -> Vec<u8> {
        let mut core = b"GFB1\x01\0".to_vec();
        text(&mut core, "Watering");
        core.extend(1u32.to_le_bytes());
        core.extend([0, 0, 0, 0, 1, 0]); // No inputs or state, one strategy.
        text(&mut core, "control");
        core.extend(0i32.to_le_bytes());
        core.extend([2, 0, 0, 0, 5, 1, 0, 0, 1, 0]); // True query, no transitions, one intent.
        text(&mut core, "pump");
        core.extend([1, 2, 0, 0, 0, 1, 1, 0, 0]); // Bool constant, no constraints.
        let mut bytes = b"GFB1\x1d\0".to_vec();
        bytes.extend((core.len() as u32).to_le_bytes());
        bytes.extend(core);
        text(&mut bytes, "irrigation");
        text(&mut bytes, output);
        for duration in [60_000, 30_000, reserve_ms] {
            bytes.extend(duration.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn mandatory_policy_inspects_without_generic_activation() {
        let bytes = program("pump", 5_000);
        let program = RollingOutputProgram::load(&bytes).unwrap();
        assert_eq!(program.name(), "Watering");
        assert_eq!(program.input_fields().count(), 0);
        assert_eq!(program.state_fields().count(), 0);
        assert_eq!(
            program.output_fields().collect::<Vec<_>>(),
            [("pump", Type::Bool)]
        );
        assert!(Module::load(&bytes).is_err());
        assert_eq!(
            RollingOutputPolicyDescriptor::inspect(&bytes).unwrap(),
            RollingOutputPolicyDescriptor {
                resource: "irrigation".into(),
                output: "pump".into(),
                window_ms: 60_000,
                limit_ms: 30_000,
                reserve_ms: 5_000,
            }
        );
        for n in 0..bytes.len() {
            assert!(RollingOutputPolicyDescriptor::inspect(&bytes[..n]).is_err());
        }
        assert!(RollingOutputPolicyDescriptor::inspect(&program("other", 5_000)).is_err());
        assert!(RollingOutputPolicyDescriptor::inspect(&program("pump", 30_001)).is_err());
        let mut trailing = bytes;
        trailing.push(0);
        assert!(RollingOutputPolicyDescriptor::inspect(&trailing).is_err());
    }

    #[test]
    fn activation_requires_the_matching_installed_owner() {
        use crate::accounting::{AccountingConfig, RollingOutputPolicy};
        let bytes = program("pump", 5_000);
        let owner = RollingOutputOwner::initialize(
            RollingOutputPolicy {
                resource_id: 7,
                window_ms: 60_000,
                limit_ms: 30_000,
                reserve_ms: 5_000,
            },
            AccountingConfig {
                max_intervals: 8,
                max_events: 1,
                max_reservations: 8,
                max_rolling_window_ms: 60_000,
            },
            1,
            0,
            |_| true,
        )
        .unwrap();
        assert!(RollingOutputProgram::load(&bytes)
            .unwrap()
            .activate(&owner, "irrigation", "other", 7, [], 4)
            .is_err());
        assert!(RollingOutputProgram::load(&bytes)
            .unwrap()
            .activate(&owner, "irrigation", "pump", 8, [], 4)
            .is_err());
        let mut driver = RollingOutputProgram::load(&bytes)
            .unwrap()
            .activate(&owner, "irrigation", "pump", 7, [], 4)
            .unwrap();
        let outcome = driver
            .scan(crate::scan::ScanFrameV1 {
                scan_id: 0,
                logical_time_ms: 0,
                inputs: vec![],
            })
            .unwrap();
        assert_eq!(outcome.trace.safe_intents["pump"], crate::Value::Bool(true));
    }
}
