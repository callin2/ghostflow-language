//! GFB7's single Temperature -> Percent objective descriptor. This profile uses
//! the GFB3 body, followed by one objective; temporal/schedule preludes are absent.
use crate::controller::{Direction, Pid, PidConfig, PidStage};
use crate::{Error, Field, Reader, Result, Strategy, Type, Value};

#[derive(Clone, Debug)]
pub struct ObjectiveDescriptor {
    pub name: String,
    pub output: String,
    pub measure_input: u16,
    pub measure_ok_input: u16,
    pub target_input: u16,
    pub safe_max_input: u16,
    pub config: PidConfig,
}

impl ObjectiveDescriptor {
    pub(crate) fn load(
        reader: &mut Reader<'_>,
        inputs: &[Field],
        strategies: &[Strategy],
    ) -> Result<Self> {
        if reader.u16()? != 1 || strategies.len() != 1 {
            return Err(Error::new(
                "GFB7 requires exactly one objective and strategy",
            ));
        }
        let name = reader.string()?;
        let output = reader.string()?;
        let measure_input = reader.u16()?;
        let measure_ok_input = reader.u16()?;
        let target_input = reader.u16()?;
        let safe_max_input = reader.u16()?;
        for (index, expected) in [
            (measure_input, Type::Number),
            (measure_ok_input, Type::Bool),
            (target_input, Type::Number),
            (safe_max_input, Type::Number),
        ] {
            if inputs
                .get(usize::from(index))
                .is_none_or(|field| field.value_type != expected || field.name == "__gf_now_ms")
            {
                return Err(Error::new("invalid objective input binding"));
            }
        }
        let indices = [
            measure_input,
            measure_ok_input,
            target_input,
            safe_max_input,
        ];
        for (i, index) in indices.iter().enumerate() {
            if indices[..i].contains(index) {
                return Err(Error::new("aliased objective input binding"));
            }
        }
        if !inputs
            .iter()
            .any(|field| field.name == "__gf_now_ms" && field.value_type == Type::Number)
        {
            return Err(Error::new("objective requires Number __gf_now_ms clock"));
        }
        if strategies[0]
            .intents
            .iter()
            .any(|intent| intent.name == output)
        {
            return Err(Error::new("objective output collides with authored intent"));
        }
        let period_ms = reader.u64()?;
        let late_after_ms = reader.u64()?;
        let direction = match reader.u8()? {
            0 => Direction::Direct,
            1 => Direction::Reverse,
            _ => return Err(Error::new("invalid objective PID direction")),
        };
        let config = PidConfig {
            period_ms,
            late_after_ms,
            direction,
            kp: reader.f64()?,
            ki: reader.f64()?,
            kd: reader.f64()?,
            bias_percent: reader.f64()?,
            output_max_percent: reader.f64()?,
            restart_percent: reader.f64()?,
        };
        Pid::new(config)?;
        Ok(Self {
            name,
            output,
            measure_input,
            measure_ok_input,
            target_input,
            safe_max_input,
            config,
        })
    }

    pub(crate) fn stage(
        &self,
        controller: &Pid,
        now_ms: u64,
        inputs: &[Value],
    ) -> Result<PidStage> {
        let number = |index: u16| -> Result<f64> {
            match inputs[usize::from(index)] {
                Value::Number(value) => Ok(value),
                _ => Err(Error::new("invalid objective numeric input")),
            }
        };
        let measurement = match inputs[usize::from(self.measure_ok_input)] {
            Value::Bool(true) => Some(number(self.measure_input)?),
            Value::Bool(false) => None,
            _ => return Err(Error::new("invalid objective quality input")),
        };
        controller.begin(
            now_ms,
            measurement,
            number(self.target_input)?,
            number(self.safe_max_input)?,
        )
    }
}
