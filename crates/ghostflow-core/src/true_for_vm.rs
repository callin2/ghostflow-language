//! Verified GFB6 certified-interval requirements. Loading does not execute them.

use crate::{temporal_vm::TemporalRequirements, Error, Field, Reader, Result, Type};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrueForDescriptor {
    pub site: u32,
    pub name: String,
    pub source_tag: u32,
    pub source_name: String,
    pub duration_ms: u64,
    /// Present, epoch, id, start, end, Bool value, quality, fault.
    pub interval_inputs: [u16; 8],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrueForStrategy {
    pub name: String,
    pub signals: Vec<TrueForDescriptor>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrueForRequirements {
    pub strategies: Vec<TrueForStrategy>,
}

pub(crate) fn load(reader: &mut Reader<'_>, inputs: &[Field]) -> Result<TrueForDescriptor> {
    let site = reader.u32()?;
    let name = reader.string()?;
    let source_tag = reader.u32()?;
    if source_tag == 0 {
        return Err(Error::new("invalid certified source tag"));
    }
    let source_name = reader.string()?;
    let duration_ms = reader.u64()?;
    if !(1..=9_007_199_254_740_991).contains(&duration_ms) {
        return Err(Error::new("invalid true_for duration"));
    }
    let mut interval_inputs = [0; 8];
    let mut used = BTreeSet::new();
    for (index, expected) in interval_inputs.iter_mut().zip([
        Type::Bool,
        Type::Number,
        Type::Number,
        Type::Number,
        Type::Number,
        Type::Bool,
        Type::Number,
        Type::Number,
    ]) {
        *index = reader.u16()?;
        if inputs
            .get(usize::from(*index))
            .map(|field| field.value_type)
            != Some(expected)
        {
            return Err(Error::new("invalid certified interval input"));
        }
        if !used.insert(*index) {
            return Err(Error::new("duplicate certified interval input binding"));
        }
    }
    Ok(TrueForDescriptor {
        site,
        name,
        source_tag,
        source_name,
        duration_ms,
        interval_inputs,
    })
}

impl TrueForRequirements {
    /// Source capabilities are global to a module, including unselected strategies.
    pub(crate) fn validate_bindings(&self, temporal: &TemporalRequirements) -> Result<()> {
        let mut used = BTreeSet::from([temporal.now_input, temporal.time_epoch_input]);
        for root in &temporal.roots {
            used.extend([
                root.present_input,
                root.epoch_input,
                root.id_input,
                root.timestamp_input,
            ]);
        }
        let mut tags = BTreeMap::<u32, &TrueForDescriptor>::new();
        let mut names = BTreeSet::new();
        for signal in self
            .strategies
            .iter()
            .flat_map(|strategy| &strategy.signals)
        {
            if let Some(previous) = tags.get(&signal.source_tag) {
                if previous.source_name != signal.source_name
                    || previous.interval_inputs != signal.interval_inputs
                {
                    return Err(Error::new("certified source binding mismatch"));
                }
                continue;
            }
            if !names.insert(&signal.source_name) {
                return Err(Error::new("certified source binding mismatch"));
            }
            if temporal.roots.iter().any(|root| {
                (root.source_tag == signal.source_tag || root.name == signal.source_name)
                    && (root.source_tag != signal.source_tag || root.name != signal.source_name)
            }) {
                return Err(Error::new("certified source binding mismatch"));
            }
            for index in signal.interval_inputs {
                if !used.insert(index) {
                    return Err(Error::new("duplicate certified interval input binding"));
                }
            }
            tags.insert(signal.source_tag, signal);
        }
        Ok(())
    }
}

pub(crate) fn projection_type(count: usize, slot: u16, field: u8) -> Result<Type> {
    if usize::from(slot) >= count {
        return Err(Error::new("true_for projection index"));
    }
    match field {
        0 | 1 => Ok(Type::Bool),
        2..=6 => Ok(Type::Number),
        _ => Err(Error::new("true_for projection field")),
    }
}
