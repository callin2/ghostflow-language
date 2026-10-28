//! Source-bound continuous resource decisions, evaluated before the scan commits.
use crate::resource_constraints::{Lease, ResourceBindingRegistry};
use crate::{Error, Module, NamedValues, Reader, Result, ResultTraceBuffer, Type, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Write};

#[derive(Clone)]
struct Entry {
    node: u32,
    name: String,
    expressions: [Vec<u8>; 4],
}
#[derive(Clone)]
struct Policy {
    node: u32,
    name: String,
    resource: String,
    resource_id: String,
    output: String,
    maximum: bool,
    safe: f64,
    requests: Vec<Entry>,
    ceilings: Vec<Entry>,
}
#[derive(Clone)]
pub(crate) struct ContinuousResourcePlan {
    activation: Vec<u8>,
    source_hash: String,
    descriptor_hash: String,
    binding_hash: String,
    binding_revision: String,
    run_id: String,
    ids: BTreeSet<String>,
    policies: Vec<Policy>,
}
#[derive(Clone, Debug, PartialEq)]
pub enum PercentEvidence {
    Known(f64),
    Fault { reason: &'static str, origin: u32 },
}
#[derive(Clone, Debug, PartialEq)]
pub struct ContinuousEntryDecision {
    pub identity: String,
    pub name: String,
    pub evidence: PercentEvidence,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ContinuousResourceDecision {
    pub identity: String,
    pub policy: String,
    pub resource: String,
    pub resource_id: String,
    pub output: String,
    pub source_hash: String,
    pub descriptor_hash: String,
    pub binding_hash: String,
    pub binding_revision: String,
    pub run_id: String,
    pub tick: u64,
    pub selection: &'static str,
    pub requests: Vec<ContinuousEntryDecision>,
    pub ceilings: Vec<ContinuousEntryDecision>,
    pub selected: Option<f64>,
    pub selected_request: Option<String>,
    pub ties: Vec<String>,
    pub authored_safe: f64,
    pub fallback: bool,
    pub conditions_known: bool,
    pub candidate: f64,
    pub clamp: Option<f64>,
    pub final_percent: f64,
}
fn text(r: &mut Reader<'_>) -> Result<String> {
    let value = r.string()?;
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(Error::new("invalid continuous identity"));
    }
    Ok(value)
}
fn hash(r: &mut Reader<'_>) -> Result<String> {
    let value = text(r)?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(Error::new("invalid continuous hash"));
    }
    Ok(value)
}
fn count(r: &mut Reader<'_>, maximum: usize, nonempty: bool) -> Result<usize> {
    let value = r.u16()? as usize;
    if value > maximum || nonempty && value == 0 {
        return Err(Error::new("continuous count out of bounds"));
    }
    Ok(value)
}
fn percent(value: f64) -> Result<f64> {
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        return Err(Error::new("continuous Percent out of range"));
    }
    Ok(value)
}
impl ContinuousResourcePlan {
    pub(crate) fn read(r: &mut Reader<'_>, module: &mut Module) -> Result<Self> {
        if !matches!(module.format_version, 1..=4)
            || module.strategies.len() != 1
            || module.temporal.is_some()
            || module.schedules.is_some()
            || module.true_fors.is_some()
            || module.objective.is_some()
            || module.lifecycle.is_some()
            || !module.constraints.is_empty()
            || module.resource_policy.is_some()
            || module.continuous_resource.is_some()
        {
            return Err(Error::new(
                "continuous policy requires scalar base without objective/PID or other profiles",
            ));
        }
        let source_hash = hash(r)?;
        let descriptor_hash = hash(r)?;
        let length = r.u32()? as usize;
        if length > 65536 {
            return Err(Error::new("continuous activation byte limit"));
        }
        let activation = r.take(length)?.to_vec();
        let mut binding = Reader::new(&activation);
        if binding.take(4)? != b"GFRB" || binding.u16()? != 2 {
            return Err(Error::new("continuous activation requires GFRB2"));
        }
        let binding_revision = text(&mut binding)?;
        let run_id = text(&mut binding)?;
        let binding_hash = hash(&mut binding)?;
        if hash(&mut binding)? != source_hash {
            return Err(Error::new("continuous binding source mismatch"));
        }
        let mut resources = BTreeMap::new();
        let mut ids = BTreeSet::new();
        let mut outputs = BTreeSet::new();
        for _ in 0..count(&mut binding, 8, true)? {
            let name = text(&mut binding)?;
            let id = text(&mut binding)?;
            let output = text(&mut binding)?;
            if binding.u8()? != 2
                || !ids.insert(id.clone())
                || !outputs.insert(output.clone())
                || resources.insert(name, (id, output)).is_some()
            {
                return Err(Error::new("invalid typed continuous resource binding"));
            }
        }
        if !binding.finished() {
            return Err(Error::new("trailing continuous activation bytes"));
        }
        let strategy = &module.strategies[0];
        if strategy
            .intents
            .iter()
            .any(|intent| intent.value_type != Type::Number)
            || strategy
                .intents
                .iter()
                .map(|intent| intent.name.clone())
                .collect::<BTreeSet<_>>()
                != outputs
        {
            return Err(Error::new(
                "continuous policies must own every Number output",
            ));
        }
        let mut policies = vec![];
        let mut node_ids = BTreeSet::new();
        let mut names = BTreeSet::new();
        let mut marker_count = 0;
        let mut entry_count = 0;
        for _ in 0..count(r, 8, true)? {
            let node = r.u32()?;
            let name = text(r)?;
            if node == 0 || !node_ids.insert(node) || !names.insert(name.clone()) {
                return Err(Error::new("duplicate continuous policy identity"));
            }
            let resource = text(r)?;
            let output = text(r)?;
            let (resource_id, bound_output) = resources
                .remove(&resource)
                .ok_or_else(|| Error::new("missing or duplicate continuous writer"))?;
            if output != bound_output {
                return Err(Error::new("continuous output identity mismatch"));
            }
            let maximum = match r.u8()? {
                0 => false,
                1 => true,
                _ => return Err(Error::new("unsupported continuous selection")),
            };
            let safe = percent(r.f64()?)?;
            let mut read_entries = |nonempty| -> Result<Vec<Entry>> {
                let mut entries = vec![];
                let mut names = BTreeSet::new();
                for _ in 0..count(r, 16, nonempty)? {
                    entry_count += 1;
                    if entry_count > 32 {
                        return Err(Error::new("continuous entry total limit"));
                    }
                    let node = r.u32()?;
                    let name = text(r)?;
                    if node == 0 || !node_ids.insert(node) || !names.insert(name.clone()) {
                        return Err(Error::new("duplicate continuous request identity"));
                    }
                    let mut expressions = [vec![], vec![], vec![], vec![]];
                    for (index, expression) in expressions.iter_mut().enumerate() {
                        *expression = r.blob()?;
                        let expected = if index == 0 { Type::Bool } else { Type::Number };
                        if crate::verify_expression_with_prelude(
                            expression,
                            &module.inputs,
                            &module.states,
                            false,
                            module.format_version,
                            &[],
                            0,
                            0,
                        )? != expected
                        {
                            return Err(Error::new("continuous expression type mismatch"));
                        }
                        marker_count += crate::expression_metadata(expression)?.1;
                    }
                    entries.push(Entry {
                        node,
                        name,
                        expressions,
                    });
                }
                entries.sort_by_key(|entry| entry.node);
                Ok(entries)
            };
            let requests = read_entries(true)?;
            let ceilings = read_entries(false)?;
            policies.push(Policy {
                node,
                name,
                resource,
                resource_id,
                output,
                maximum,
                safe,
                requests,
                ceilings,
            });
        }
        if !resources.is_empty() {
            return Err(Error::new("unowned continuous resource binding"));
        }
        module.strategies[0].result_trace_bound += marker_count;
        Ok(Self {
            activation,
            source_hash,
            descriptor_hash,
            binding_hash,
            binding_revision,
            run_id,
            ids,
            policies,
        })
    }
    pub(crate) fn activate(
        &self,
        bytes: &[u8],
        registry: &ResourceBindingRegistry,
    ) -> Result<Lease> {
        if bytes != self.activation {
            return Err(Error::new("continuous activation binding mismatch"));
        }
        registry.acquire(&self.ids)
    }
    pub(crate) fn validate_scan(&self, bytes: &[u8]) -> Result<()> {
        let mut r = Reader::new(bytes);
        if r.take(4)? != b"GFRS"
            || r.u16()? != 2
            || hash(&mut r)? != self.binding_hash
            || text(&mut r)? != self.run_id
            || hash(&mut r)? != self.source_hash
            || !r.finished()
        {
            return Err(Error::new("continuous scan binding mismatch"));
        }
        Ok(())
    }
    pub(crate) fn stage(
        &self,
        inputs: &[Value],
        state: &[Value],
        tick: u64,
        trace: &mut ResultTraceBuffer,
    ) -> Result<(NamedValues, NamedValues, Vec<ContinuousResourceDecision>)> {
        let mut requested = NamedValues::new();
        let mut safe = NamedValues::new();
        let mut decisions = vec![];
        for policy in &self.policies {
            let entries = |items: &[Entry],
                           trace: &mut ResultTraceBuffer|
             -> Result<Vec<ContinuousEntryDecision>> {
                items
                    .iter()
                    .map(|entry| {
                        let evaluate = |index: usize, trace: &mut ResultTraceBuffer| {
                            crate::eval_expression_with_windows(
                                entry.expressions[index].as_slice(),
                                inputs,
                                state,
                                None,
                                trace,
                                &[],
                            )
                        };
                        let evidence = match evaluate(0, trace)? {
                            Value::Bool(true) => match evaluate(1, trace)? {
                                Value::Number(value) => PercentEvidence::Known(percent(value)?),
                                _ => return Err(Error::new("continuous Percent type mismatch")),
                            },
                            Value::Bool(false) => {
                                let reason = match evaluate(2, trace)? {
                                    Value::Number(0.0) => "Disconnected",
                                    Value::Number(1.0) => "Stale",
                                    Value::Number(2.0) => "Invalid",
                                    Value::Number(3.0) => "NotReady",
                                    _ => return Err(Error::new("invalid continuous SensorFault")),
                                };
                                let origin = match evaluate(3, trace)? {
                                    Value::Number(value)
                                        if value.is_finite()
                                            && value >= 0.0
                                            && value <= u32::MAX as f64
                                            && value.fract() == 0.0 =>
                                    {
                                        value as u32
                                    }
                                    _ => return Err(Error::new("invalid continuous fault origin")),
                                };
                                PercentEvidence::Fault { reason, origin }
                            }
                            _ => return Err(Error::new("continuous Result tag type mismatch")),
                        };
                        Ok(ContinuousEntryDecision {
                            identity: format!("{}:{}", self.source_hash, entry.node),
                            name: entry.name.clone(),
                            evidence,
                        })
                    })
                    .collect()
            };
            let requests = entries(&policy.requests, trace)?;
            let ceilings = entries(&policy.ceilings, trace)?;
            let conditions_known = requests
                .iter()
                .chain(&ceilings)
                .all(|entry| matches!(entry.evidence, PercentEvidence::Known(_)));
            let requests_known = requests
                .iter()
                .all(|entry| matches!(entry.evidence, PercentEvidence::Known(_)));
            let selected = if requests_known {
                requests
                    .iter()
                    .filter_map(|entry| {
                        if let PercentEvidence::Known(value) = entry.evidence {
                            Some(value)
                        } else {
                            None
                        }
                    })
                    .reduce(|a, b| if policy.maximum { a.max(b) } else { a.min(b) })
            } else {
                None
            };
            let ties: Vec<_> = requests.iter().filter(|entry| matches!(entry.evidence, PercentEvidence::Known(value) if Some(value) == selected))
                .map(|entry| entry.identity.clone()).collect();
            let selected_request = ties.first().cloned();
            let candidate = if conditions_known {
                selected.expect("nonempty known requests")
            } else {
                policy.safe
            };
            let clamp = ceilings
                .iter()
                .filter_map(|entry| {
                    if let PercentEvidence::Known(value) = entry.evidence {
                        Some(value)
                    } else {
                        None
                    }
                })
                .reduce(f64::min);
            let final_percent = clamp.map_or(candidate, |limit| candidate.min(limit));
            requested.insert(policy.output.clone(), Value::Number(candidate));
            safe.insert(policy.output.clone(), Value::Number(final_percent));
            decisions.push(ContinuousResourceDecision {
                identity: format!("{}:{}", self.source_hash, policy.node),
                policy: policy.name.clone(),
                resource: policy.resource.clone(),
                resource_id: policy.resource_id.clone(),
                output: policy.output.clone(),
                source_hash: self.source_hash.clone(),
                descriptor_hash: self.descriptor_hash.clone(),
                binding_hash: self.binding_hash.clone(),
                binding_revision: self.binding_revision.clone(),
                run_id: self.run_id.clone(),
                tick,
                selection: if policy.maximum { "max" } else { "min" },
                requests,
                ceilings,
                selected,
                selected_request,
                ties,
                authored_safe: policy.safe,
                fallback: !conditions_known,
                conditions_known,
                candidate,
                clamp,
                final_percent,
            });
        }
        Ok((requested, safe, decisions))
    }
}

impl ContinuousResourceDecision {
    pub(crate) fn write_json(&self, out: &mut impl Write) -> fmt::Result {
        use crate::trace_json::text;
        out.write_char('{')?;
        for (index, (name, value)) in [
            ("identity", &self.identity),
            ("policy", &self.policy),
            ("resource", &self.resource),
            ("resourceId", &self.resource_id),
            ("output", &self.output),
            ("sourceHash", &self.source_hash),
            ("descriptorHash", &self.descriptor_hash),
            ("bindingHash", &self.binding_hash),
            ("bindingRevision", &self.binding_revision),
            ("runId", &self.run_id),
        ]
        .iter()
        .enumerate()
        {
            if index > 0 {
                out.write_char(',')?;
            }
            text(out, name)?;
            out.write_char(':')?;
            text(out, value)?;
        }
        write!(out, ",\"tick\":{},\"selection\":", self.tick)?;
        text(out, self.selection)?;
        for (name, entries) in [("requests", &self.requests), ("ceilings", &self.ceilings)] {
            out.write_char(',')?;
            text(out, name)?;
            out.write_str(":[")?;
            for (index, entry) in entries.iter().enumerate() {
                if index > 0 {
                    out.write_char(',')?;
                }
                out.write_str("{\"identity\":")?;
                text(out, &entry.identity)?;
                out.write_str(",\"name\":")?;
                text(out, &entry.name)?;
                match entry.evidence {
                    PercentEvidence::Known(value) => {
                        write!(out, ",\"status\":\"known\",\"value\":{value}}}")?
                    }
                    PercentEvidence::Fault { reason, origin } => {
                        out.write_str(",\"status\":\"fault\",\"reason\":")?;
                        text(out, reason)?;
                        write!(out, ",\"origin\":{origin}}}")?;
                    }
                }
            }
            out.write_char(']')?;
        }
        for (name, value) in [("selected", self.selected), ("clamp", self.clamp)] {
            out.write_char(',')?;
            text(out, name)?;
            out.write_char(':')?;
            match value {
                Some(value) => write!(out, "{value}")?,
                None => out.write_str("null")?,
            }
        }
        out.write_str(",\"selectedRequest\":")?;
        match &self.selected_request {
            Some(value) => text(out, value)?,
            None => out.write_str("null")?,
        }
        out.write_str(",\"ties\":[")?;
        for (index, value) in self.ties.iter().enumerate() {
            if index > 0 {
                out.write_char(',')?;
            }
            text(out, value)?;
        }
        write!(out, "],\"authoredSafe\":{},\"fallback\":{},\"conditionsKnown\":{},\"candidate\":{},\"final\":{}}}",
            self.authored_safe, self.fallback, self.conditions_known, self.candidate, self.final_percent)
    }
}
