//! Verified GFB4 window requirements. This module does not execute a prelude.
//!
//! Source evidence names physical roots and verified prior-window dependencies.
//! Derived observations retain their own identities and physical proof leaves.
//! Loading requirements never invents density or memory bindings.

use crate::temporal::Operation;
use crate::{
    expression_metadata, verify_expression_with_prelude, Error, Field, Reader, Result, Type,
    MAX_STATES,
};
use std::collections::BTreeSet;

const MAX_EXACT: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporalRoot {
    pub source_tag: u32,
    pub name: String,
    pub present_input: u16,
    pub epoch_input: u16,
    pub id_input: u16,
    pub timestamp_input: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowSource {
    pub ok: Vec<u8>,
    pub payload: Vec<u8>,
    pub fault: Vec<u8>,
    pub origin: Vec<u8>,
    pub quality: Vec<u8>,
    pub source_tag: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowDescriptor {
    pub site: u32,
    pub name: String,
    pub operation: Operation,
    pub payload_type: Type,
    pub over_ms: u64,
    pub max_age_ms: u64,
    /// Strictly increasing indices into the module's physical root table.
    pub roots: Vec<u16>,
    /// Prior evidence slots declared by field-7 reads in the quality expression.
    pub upstream_windows: Vec<u16>,
    pub source: WindowSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporalStrategy {
    pub name: String,
    pub windows: Vec<WindowDescriptor>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemporalRequirements {
    pub now_input: u16,
    pub time_epoch_input: u16,
    pub roots: Vec<TemporalRoot>,
    /// Same order as the module strategies; each prelude is topologically ordered.
    pub strategies: Vec<TemporalStrategy>,
}

impl TemporalRequirements {
    pub(crate) fn load_header(
        reader: &mut Reader<'_>,
        inputs: &[Field],
        allow_empty_roots: bool,
    ) -> Result<Self> {
        let now_input = reader.u16()?;
        let time_epoch_input = reader.u16()?;
        for (index, name) in [
            (now_input, "__gf_now_ms"),
            (time_epoch_input, "__gf_time_epoch"),
        ] {
            if !inputs
                .get(usize::from(index))
                .is_some_and(|input| input.value_type == Type::Number && input.name == name)
            {
                return Err(Error::new("invalid temporal clock input"));
            }
        }
        let count = usize::from(reader.u16()?);
        if (!allow_empty_roots && count == 0) || count > inputs.len().saturating_sub(2) / 4 {
            return Err(Error::new("invalid temporal root count"));
        }
        let mut roots = Vec::with_capacity(count);
        let mut names = BTreeSet::new();
        let mut bound_inputs = BTreeSet::from([now_input, time_epoch_input]);
        let mut previous_tag = 0;
        for _ in 0..count {
            let source_tag = reader.u32()?;
            if source_tag <= previous_tag {
                return Err(Error::new("invalid temporal root tag"));
            }
            previous_tag = source_tag;
            let name = reader.string()?;
            if !names.insert(name.clone()) {
                return Err(Error::new("duplicate temporal root name"));
            }
            let indices = [reader.u16()?, reader.u16()?, reader.u16()?, reader.u16()?];
            for (index, ty) in
                indices
                    .into_iter()
                    .zip([Type::Bool, Type::Number, Type::Number, Type::Number])
            {
                if inputs.get(usize::from(index)).map(|input| input.value_type) != Some(ty) {
                    return Err(Error::new("invalid temporal root input"));
                }
                if !bound_inputs.insert(index) {
                    return Err(Error::new("duplicate temporal input binding"));
                }
            }
            roots.push(TemporalRoot {
                source_tag,
                name,
                present_input: indices[0],
                epoch_input: indices[1],
                id_input: indices[2],
                timestamp_input: indices[3],
            });
        }
        Ok(Self {
            now_input,
            time_epoch_input,
            roots,
            strategies: Vec::new(),
        })
    }
}

pub(crate) fn load_windows(
    reader: &mut Reader<'_>,
    inputs: &[Field],
    states: &[Field],
    roots: &[TemporalRoot],
) -> Result<(Vec<WindowDescriptor>, usize)> {
    let count = usize::from(reader.u16()?);
    if count > MAX_STATES - states.len() {
        return Err(Error::new("temporal state limit exceeded"));
    }
    let mut windows = Vec::with_capacity(count);
    let mut sites = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut marker_count = 0;
    for _ in 0..count {
        let (window, markers) = load_window(reader, inputs, states, roots, &windows, 0, 0, 4)?;
        let site = window.site;
        if site == 0 || !sites.insert(site) {
            return Err(Error::new("invalid temporal window site"));
        }
        let name = &window.name;
        if !names.insert(name.clone()) {
            return Err(Error::new("duplicate temporal window name"));
        }
        marker_count += markers;
        windows.push(window);
    }
    Ok((windows, marker_count))
}

pub(crate) fn load_window(
    reader: &mut Reader<'_>,
    inputs: &[Field],
    states: &[Field],
    roots: &[TemporalRoot],
    windows: &[WindowDescriptor],
    schedule_count: usize,
    true_for_count: usize,
    format: u16,
) -> Result<(WindowDescriptor, usize)> {
    let site = reader.u32()?;
    let name = reader.string()?;
    let mut marker_count = 0;
    let operation = match reader.u8()? {
        0 => Operation::Average,
        1 => Operation::Min,
        2 => Operation::Max,
        3 => Operation::Rate,
        _ => return Err(Error::new("invalid temporal operation")),
    };
    let payload_type = Type::from_byte(reader.u8()?, 4)?;
    if payload_type == Type::Bool
        || (matches!(operation, Operation::Average | Operation::Rate)
            && payload_type != Type::Number)
    {
        return Err(Error::new("invalid temporal payload type"));
    }
    let over_ms = reader.u64()?;
    let max_age_ms = reader.u64()?;
    if !(1..=MAX_EXACT).contains(&over_ms) || !(1..=MAX_EXACT).contains(&max_age_ms) {
        return Err(Error::new("invalid temporal duration"));
    }
    let root_count = usize::from(reader.u16()?);
    if root_count == 0 || root_count > roots.len() {
        return Err(Error::new("invalid temporal window roots"));
    }
    let mut source_roots = Vec::with_capacity(root_count);
    for _ in 0..root_count {
        let index = reader.u16()?;
        if usize::from(index) >= roots.len()
            || source_roots
                .last()
                .is_some_and(|previous| *previous >= index)
        {
            return Err(Error::new("invalid temporal window roots"));
        }
        source_roots.push(index);
    }
    let mut read_source = |expected| -> Result<Vec<u8>> {
        let code = reader.blob()?;
        if verify_expression_with_prelude(
            &code,
            inputs,
            states,
            false,
            format,
            windows,
            schedule_count,
            true_for_count,
        )? != expected
        {
            return Err(Error::new("temporal source expression type mismatch"));
        }
        marker_count += expression_metadata(&code)?.1;
        Ok(code)
    };
    let source = WindowSource {
        ok: read_source(Type::Bool)?,
        payload: read_source(payload_type)?,
        fault: read_source(Type::Number)?,
        origin: read_source(Type::Number)?,
        quality: read_source(Type::Number)?,
        source_tag: read_source(Type::Number)?,
    };
    let upstream_windows = quality_dependencies(&source.quality)?;
    for index in &upstream_windows {
        if windows[usize::from(*index)]
            .roots
            .iter()
            .any(|root| !source_roots.contains(root))
        {
            return Err(Error::new("temporal evidence roots are not transitive"));
        }
    }
    Ok((
        WindowDescriptor {
            site,
            name,
            operation,
            payload_type,
            over_ms,
            max_age_ms,
            roots: source_roots,
            upstream_windows,
            source,
        },
        marker_count,
    ))
}

fn quality_dependencies(code: &[u8]) -> Result<Vec<u16>> {
    let mut reader = Reader::new(code);
    let mut dependencies = BTreeSet::new();
    while !reader.finished() {
        match reader.u8()? {
            1 => {
                reader.take(1)?;
            }
            2 => {
                reader.take(8)?;
            }
            3..=5 | 30..=31 => {
                reader.take(2)?;
            }
            23 | 56 => {
                reader.take(4)?;
            }
            57 => {
                let slot = reader.u16()?;
                if reader.u8()? == 7 {
                    dependencies.insert(slot);
                }
            }
            58 => {
                reader.take(3)?;
            }
            10 | 13..=17 | 19..=22 | 24..=29 | 32..=55 => {}
            _ => return Err(Error::new("unknown expression opcode")),
        }
    }
    Ok(dependencies.into_iter().collect())
}

pub(crate) fn projection_type(windows: &[WindowDescriptor], slot: u16, field: u8) -> Result<Type> {
    let window = windows
        .get(usize::from(slot))
        .ok_or_else(|| Error::new("temporal projection index"))?;
    match field {
        0 => Ok(Type::Bool),
        1 => Ok(window.payload_type),
        2..=7 => Ok(Type::Number),
        _ => Err(Error::new("temporal projection field")),
    }
}
