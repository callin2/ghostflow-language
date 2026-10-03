//! Transport-independent current Result observations for typed config streams.
use crate::{Error, Field, Reader, Result, Type, Value};
use std::collections::BTreeSet;

pub const SETTINGS_INVALID: u8 = 0;
pub const SETTINGS_UNAVAILABLE: u8 = 1;

#[derive(Clone, Debug, PartialEq)]
pub enum ConfigValue {
    Scalar(Value),
    Slots(Vec<(u64, u16)>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConfigDescriptor {
    pub id: u32,
    pub name: String,
    pub semantic_type: String,
    pub kind: u8,
    pub operator_editable: bool,
    pub initial: ConfigValue,
    pub bounds: Option<(Value, Value, Value)>,
    pub grid_ms: u64,
    pub capacity: u16,
    pub ok_input: u16,
    pub value_input: u16,
    pub fault_input: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConfigEmission {
    pub id: u32,
    /// Required only on the success rail; checked against the declared payload.
    pub semantic_type: String,
    pub result: std::result::Result<ConfigValue, u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ConfigStream {
    pub descriptor: ConfigDescriptor,
    pub current: std::result::Result<ConfigValue, u8>,
    pub emission_revision: u64,
    pub application_position: Option<u64>,
    // Identity/allocator history, never an implicit read fallback.
    pub last_success: ConfigValue,
    pub next_key: u64,
}

fn invalid(message: &str) -> Error {
    Error::new(message)
}

pub(crate) fn read_scalar(reader: &mut Reader<'_>, kind: u8) -> Result<Value> {
    match kind {
        0 => match reader.u8()? {
            0 => Ok(Value::Bool(false)),
            1 => Ok(Value::Bool(true)),
            _ => Err(invalid("invalid config Bool")),
        },
        1 => Ok(Value::Int(reader.i32()?)),
        2 => Ok(Value::Number(reader.f64()?)),
        _ => Err(invalid("invalid scalar config kind")),
    }
}

pub(crate) fn load(reader: &mut Reader<'_>, inputs: &[Field]) -> Result<ConfigDescriptor> {
    let id = reader.u32()?;
    let name = crate::context_vm::text(reader)?;
    let semantic_type = crate::context_vm::text(reader)?;
    let kind = reader.u8()?;
    let operator_editable = match reader.u8()? {
        0 => false,
        1 => true,
        _ => return Err(invalid("invalid config access")),
    };
    let (initial, bounds, grid_ms, capacity) = if kind == 3 {
        let grid = reader.u64()?;
        let capacity = reader.u16()?;
        let count = reader.u16()?;
        if grid == 0
            || grid > 86_400_000
            || grid % 60_000 != 0
            || capacity == 0
            || capacity > 4096
            || count > capacity
        {
            return Err(invalid("invalid TimeSlots config descriptor"));
        }
        let mut slots = Vec::new();
        for index in 0..count {
            let minute = reader.u16()?;
            if minute >= 1440
                || u64::from(minute) * 60_000 % grid != 0
                || slots.last().is_some_and(|(_, last)| *last >= minute)
            {
                return Err(invalid("invalid initial config slots"));
            }
            slots.push((u64::from(index) + 1, minute));
        }
        (ConfigValue::Slots(slots), None, grid, capacity)
    } else {
        let initial = read_scalar(reader, kind)?;
        let bounds = match reader.u8()? {
            0 => None,
            1 if kind != 0 => Some((
                read_scalar(reader, kind)?,
                read_scalar(reader, kind)?,
                read_scalar(reader, kind)?,
            )),
            _ => return Err(invalid("invalid config bounds tag")),
        };
        (ConfigValue::Scalar(initial), bounds, 0, 0)
    };
    let descriptor = ConfigDescriptor {
        id,
        name,
        semantic_type,
        kind,
        operator_editable,
        initial,
        bounds,
        grid_ms,
        capacity,
        ok_input: reader.u16()?,
        value_input: reader.u16()?,
        fault_input: reader.u16()?,
    };
    if id == 0 {
        return Err(invalid("invalid config identity"));
    }
    if !match kind {
        0 => descriptor.semantic_type == "Bool",
        1 => descriptor.semantic_type == "Int",
        2 => descriptor.semantic_type != "Int" && numeric_domain(&descriptor.semantic_type, 0.0),
        3 => {
            descriptor.semantic_type
                == format!(
                    "TimeSlots<{}ms,{}>",
                    descriptor.grid_ms, descriptor.capacity
                )
        }
        _ => false,
    } {
        return Err(invalid("config payload representation mismatch"));
    }
    if kind == 3 {
        if [
            descriptor.ok_input,
            descriptor.value_input,
            descriptor.fault_input,
        ] != [u16::MAX; 3]
        {
            return Err(invalid("TimeSlots has no scalar projection"));
        }
    } else {
        let ty = match kind {
            0 => Type::Bool,
            1 => Type::Int,
            2 => Type::Number,
            _ => return Err(invalid("invalid config kind")),
        };
        for (index, suffix, expected) in [
            (descriptor.ok_input, "ok", Type::Bool),
            (descriptor.value_input, "value", ty),
            (descriptor.fault_input, "fault", Type::Number),
        ] {
            let field = inputs
                .get(usize::from(index))
                .ok_or_else(|| invalid("config projection index"))?;
            if field.name != format!("__gf_config_{id}_{suffix}") || field.value_type != expected {
                return Err(invalid("config projection binding mismatch"));
            }
        }
    }
    let stream = ConfigStream::new(descriptor.clone())?;
    if stream
        .validate(&descriptor.semantic_type, &descriptor.initial)
        .is_none()
    {
        return Err(invalid("invalid initial config value"));
    }
    Ok(descriptor)
}

fn number(value: Value) -> Option<f64> {
    match value {
        Value::Int(value) => Some(f64::from(value)),
        Value::Number(value) if value.is_finite() => Some(value),
        _ => None,
    }
}

impl ConfigStream {
    pub fn new(descriptor: ConfigDescriptor) -> Result<Self> {
        if let Some((low, high, step)) = descriptor.bounds {
            let (Some(low), Some(high), Some(step)) = (number(low), number(high), number(step))
            else {
                return Err(invalid("invalid numeric config bounds"));
            };
            if low > high || step <= 0.0 {
                return Err(invalid("invalid numeric config bounds"));
            }
            if !numeric_domain(&descriptor.semantic_type, low)
                || !numeric_domain(&descriptor.semantic_type, high)
                || descriptor.semantic_type == "Date" && step > f64::from(i32::MAX)
                || matches!(
                    descriptor.semantic_type.as_str(),
                    "Int" | "Duration" | "Date" | "DateTime" | "TimeOfDay"
                ) && (step.fract() != 0.0 || step > 9_007_199_254_740_991.0)
                || matches!(
                    descriptor.semantic_type.as_str(),
                    "Int" | "Date" | "DateTime" | "TimeOfDay"
                ) && (high - low) % step != 0.0
            {
                return Err(invalid(
                    "config bounds disagree with payload domain or grid",
                ));
            }
        }
        let next_key = match &descriptor.initial {
            ConfigValue::Slots(slots) => slots.len() as u64 + 1,
            _ => 1,
        };
        Ok(Self {
            current: Ok(descriptor.initial.clone()),
            emission_revision: 0,
            application_position: None,
            last_success: descriptor.initial.clone(),
            descriptor,
            next_key,
        })
    }

    /// Normalize one candidate on a clone; semantic invalidity is an error rail,
    /// not an engine exception. Callers commit only a complete aggregate.
    pub fn validate(&self, semantic_type: &str, value: &ConfigValue) -> Option<(ConfigValue, u64)> {
        self.validate_candidate(semantic_type, value, false)
    }

    /// Restore allocated ordinary row identities after a host-validated overlay.
    /// Ordinary edits still cannot resurrect a retired key, and this path never
    /// accepts unallocated keys or bypasses type, grid, capacity or uniqueness.
    pub fn validate_temporary_return(
        &self,
        semantic_type: &str,
        value: &ConfigValue,
    ) -> Option<(ConfigValue, u64)> {
        self.validate_candidate(semantic_type, value, true)
    }

    fn validate_candidate(
        &self,
        semantic_type: &str,
        value: &ConfigValue,
        temporary_return: bool,
    ) -> Option<(ConfigValue, u64)> {
        let d = &self.descriptor;
        if semantic_type != d.semantic_type {
            return None;
        }
        match (d.kind, value) {
            (0, ConfigValue::Scalar(Value::Bool(_))) if semantic_type == "Bool" => {
                Some((value.clone(), self.next_key))
            }
            (1 | 2, ConfigValue::Scalar(scalar)) => {
                if (d.kind == 1) != matches!(scalar, Value::Int(_)) {
                    return None;
                }
                let n = number(*scalar)?;
                if !numeric_domain(semantic_type, n) {
                    return None;
                }
                if let Some((low, high, step)) = d.bounds {
                    let (low, high, step) = (number(low)?, number(high)?, number(step)?);
                    let units = (n - low) / step;
                    let off_grid = if matches!(
                        semantic_type,
                        "Int" | "Duration" | "Date" | "DateTime" | "TimeOfDay"
                    ) {
                        (n - low) % step != 0.0
                    } else {
                        (units - units.round()).abs() > 1e-9
                    };
                    if n < low || n > high || off_grid {
                        return None;
                    }
                }
                Some((value.clone(), self.next_key))
            }
            (3, ConfigValue::Slots(slots)) => {
                if slots.len() > usize::from(d.capacity) {
                    return None;
                }
                let ConfigValue::Slots(prior) = &self.last_success else {
                    return None;
                };
                let mut next = self.next_key;
                let mut keys = BTreeSet::new();
                let mut minutes = BTreeSet::new();
                let mut normalized = Vec::new();
                for &(key, minute) in slots {
                    if minute >= 1440
                        || u64::from(minute) * 60_000 % d.grid_ms != 0
                        || !minutes.insert(minute)
                    {
                        return None;
                    }
                    let key = if key == 0 {
                        let key = next;
                        next = next.checked_add(1)?;
                        if next > 9_007_199_254_740_991 {
                            return None;
                        }
                        key
                    } else if prior.iter().any(|(old, _)| *old == key)
                        || temporary_return && key < self.next_key
                    {
                        key
                    } else {
                        return None;
                    };
                    if !keys.insert(key) {
                        return None;
                    }
                    normalized.push((key, minute));
                }
                normalized.sort_by_key(|(key, _)| *key);
                Some((ConfigValue::Slots(normalized), next))
            }
            _ => None,
        }
    }

    pub fn project(&self, inputs: &mut [Value]) {
        let d = &self.descriptor;
        if d.kind == 3 {
            return;
        }
        let (ok, value, fault) = match &self.current {
            Ok(ConfigValue::Scalar(value)) => (true, *value, 0),
            Err(fault) => (
                false,
                match d.kind {
                    0 => Value::Bool(false),
                    1 => Value::Int(0),
                    _ => Value::Number(0.0),
                },
                *fault,
            ),
            _ => unreachable!("validated config representation"),
        };
        inputs[usize::from(d.ok_input)] = Value::Bool(ok);
        inputs[usize::from(d.value_input)] = value;
        inputs[usize::from(d.fault_input)] = Value::Number(f64::from(fault));
    }
}

fn numeric_domain(kind: &str, value: f64) -> bool {
    if !value.is_finite() {
        return false;
    }
    match kind {
        "Int" => value.fract() == 0.0 && value >= i32::MIN as f64 && value <= i32::MAX as f64,
        "Duration" => value >= 0.0 && value <= 9_007_199_254_740_991.0 && value.fract() == 0.0,
        "Percent" => (0.0..=100.0).contains(&value),
        "TimeOfDay" => (0.0..86_400_000.0).contains(&value) && value.fract() == 0.0,
        "Date" => (0.0..=2_932_896.0).contains(&value) && value.fract() == 0.0,
        "DateTime" => (0.0..=253_402_300_799_999.0).contains(&value) && value.fract() == 0.0,
        "Number"
        | "Temperature"
        | "TemperatureDelta"
        | "RelativeHumidity"
        | "CO2Concentration"
        | "VaporPressureDeficit"
        | "Length"
        | "Volume"
        | "Pressure"
        | "FlowRate"
        | "Voltage"
        | "ElectricalCurrent"
        | "Power"
        | "Energy"
        | "Irradiance"
        | "PPFD"
        | "Conductivity"
        | "Acidity" => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn temporary_return_preserves_allocated_row_without_weakening_ordinary_edit() {
        let descriptor = ConfigDescriptor {
            id: 1,
            name: "slots".into(),
            semantic_type: "TimeSlots<900000ms,3>".into(),
            kind: 3,
            operator_editable: true,
            initial: ConfigValue::Slots(vec![(1, 360)]),
            bounds: None,
            grid_ms: 900000,
            capacity: 3,
            ok_input: 0,
            value_input: 1,
            fault_input: 2,
        };
        let mut stream = ConfigStream::new(descriptor).unwrap();
        let original = stream.last_success.clone();
        let (temporary, next) = stream
            .validate("TimeSlots<900000ms,3>", &ConfigValue::Slots(vec![(0, 480)]))
            .unwrap();
        stream.last_success = temporary;
        stream.next_key = next;
        assert_eq!(next, 3);
        assert!(stream
            .validate("TimeSlots<900000ms,3>", &original)
            .is_none());
        assert_eq!(
            stream.validate_temporary_return("TimeSlots<900000ms,3>", &original),
            Some((original, 3))
        );
        for invalid in [
            ConfigValue::Slots(vec![(3, 360)]),
            ConfigValue::Slots(vec![(1, 361)]),
            ConfigValue::Slots(vec![(1, 360), (1, 480)]),
        ] {
            assert!(stream
                .validate_temporary_return("TimeSlots<900000ms,3>", &invalid)
                .is_none());
        }
        assert!(stream
            .validate_temporary_return("TimeSlots<900000ms,4>", &ConfigValue::Slots(vec![(1, 360)]))
            .is_none());
    }
    #[test]
    fn native_descriptor_enforces_integer_and_calendar_max_grid() {
        let mut descriptor = ConfigDescriptor {
            id: 1,
            name: "amount".into(),
            semantic_type: "Int".into(),
            kind: 1,
            operator_editable: true,
            initial: ConfigValue::Scalar(Value::Int(0)),
            bounds: Some((Value::Int(0), Value::Int(3), Value::Int(2))),
            grid_ms: 0,
            capacity: 0,
            ok_input: 0,
            value_input: 1,
            fault_input: 2,
        };
        assert!(ConfigStream::new(descriptor.clone()).is_err());
        descriptor.kind = 2;
        descriptor.semantic_type = "TimeOfDay".into();
        descriptor.initial = ConfigValue::Scalar(Value::Number(0.0));
        descriptor.bounds = Some((Value::Number(0.0), Value::Number(3.0), Value::Number(2.0)));
        assert!(ConfigStream::new(descriptor.clone()).is_err());
        descriptor.bounds = Some((Value::Number(0.0), Value::Number(4.0), Value::Number(2.0)));
        assert!(ConfigStream::new(descriptor.clone()).is_ok());
        descriptor.semantic_type = "Date".into();
        descriptor.bounds = Some((
            Value::Number(0.0),
            Value::Number(0.0),
            Value::Number(f64::from(i32::MAX) + 1.0),
        ));
        assert!(ConfigStream::new(descriptor).is_err());
    }
}
