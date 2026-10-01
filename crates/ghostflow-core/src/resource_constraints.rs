//! Finite Boolean resource envelopes. This module owns logical admission only.
use crate::{Error, Module, NamedValues, Reader, Result, Type, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct ResourceBindingRegistry(Arc<Mutex<BTreeSet<String>>>);
impl ResourceBindingRegistry {
    pub fn new() -> Self {
        Self::default()
    }
    fn acquire(&self, ids: &BTreeSet<String>) -> Result<Lease> {
        let mut owned = self
            .0
            .lock()
            .map_err(|_| Error::new("resource registry poisoned"))?;
        if ids.iter().any(|id| owned.contains(id)) {
            return Err(Error::new("resource writer already active"));
        }
        owned.extend(ids.iter().cloned());
        Ok(Lease {
            registry: self.clone(),
            ids: ids.clone(),
        })
    }
}
pub(crate) struct Lease {
    registry: ResourceBindingRegistry,
    ids: BTreeSet<String>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut owned) = self.registry.0.lock() {
            for id in &self.ids {
                owned.remove(id);
            }
        }
    }
}

#[derive(Clone)]
enum Predicate {
    Bool(bool),
    Int(i32),
    On(String),
    Count(Vec<String>),
    Any(Vec<String>),
    Implies(Box<Self>, Box<Self>),
    Compare(u8, Box<Self>, Box<Self>),
}
#[derive(Clone, Copy, PartialEq)]
enum Scalar {
    Bool(bool),
    Int(i32),
}
impl Predicate {
    fn read(
        r: &mut Reader<'_>,
        depth: usize,
        nodes: &mut usize,
        refs: &mut BTreeSet<String>,
    ) -> Result<Self> {
        *nodes += 1;
        if depth > 32 || *nodes > 8192 {
            return Err(Error::new("resource predicate complexity exceeded"));
        }
        Ok(match r.u8()? {
            0 => Self::Bool(boolean(r)?),
            1 => Self::Int(r.i32()?),
            2 => {
                let s = string(r)?;
                refs.insert(s.clone());
                Self::On(s)
            }
            tag @ (3 | 4) => {
                let mut names = vec![];
                let mut unique = BTreeSet::new();
                for _ in 0..count(r, true)? {
                    let s = string(r)?;
                    if !unique.insert(s.clone()) {
                        return Err(Error::new("duplicate resource predicate reference"));
                    }
                    refs.insert(s.clone());
                    names.push(s);
                }
                if tag == 3 {
                    Self::Count(names)
                } else {
                    Self::Any(names)
                }
            }
            5 => {
                let a = Self::read(r, depth + 1, nodes, refs)?;
                let b = Self::read(r, depth + 1, nodes, refs)?;
                if a.ty() != Type::Bool || b.ty() != Type::Bool {
                    return Err(Error::new("resource implication requires Bool"));
                }
                Self::Implies(Box::new(a), Box::new(b))
            }
            6 => {
                let op = r.u8()?;
                let a = Self::read(r, depth + 1, nodes, refs)?;
                let b = Self::read(r, depth + 1, nodes, refs)?;
                if op > 5 || a.ty() != b.ty() || (op > 1 && a.ty() != Type::Int) {
                    return Err(Error::new("invalid resource comparison"));
                }
                Self::Compare(op, Box::new(a), Box::new(b))
            }
            _ => return Err(Error::new("unsupported resource predicate")),
        })
    }
    fn ty(&self) -> Type {
        match self {
            Self::Int(_) | Self::Count(_) => Type::Int,
            _ => Type::Bool,
        }
    }
    fn eval(&self, v: &BTreeMap<String, bool>) -> Scalar {
        match self {
            Self::Bool(b) => Scalar::Bool(*b),
            Self::Int(i) => Scalar::Int(*i),
            Self::On(s) => Scalar::Bool(v[s]),
            Self::Count(s) => Scalar::Int(s.iter().filter(|s| v[*s]).count() as i32),
            Self::Any(s) => Scalar::Bool(s.iter().any(|s| v[s])),
            Self::Implies(a, b) => {
                Scalar::Bool(a.eval(v) != Scalar::Bool(true) || b.eval(v) == Scalar::Bool(true))
            }
            Self::Compare(op, a, b) => {
                let a = a.eval(v);
                let b = b.eval(v);
                Scalar::Bool(match op {
                    0 => a == b,
                    1 => a != b,
                    2 => matches!((a,b),(Scalar::Int(a),Scalar::Int(b)) if a<b),
                    3 => matches!((a,b),(Scalar::Int(a),Scalar::Int(b)) if a<=b),
                    4 => matches!((a,b),(Scalar::Int(a),Scalar::Int(b)) if a>b),
                    _ => matches!((a,b),(Scalar::Int(a),Scalar::Int(b)) if a>=b),
                })
            }
        }
    }
}
fn string(r: &mut Reader<'_>) -> Result<String> {
    let s = r.string()?;
    if s.is_empty() || s.len() > 128 {
        Err(Error::new("invalid resource identity"))
    } else {
        Ok(s)
    }
}
fn hash(r: &mut Reader<'_>) -> Result<String> {
    let s = string(r)?;
    if s.len() != 64
        || !s
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Err(Error::new("invalid resource hash"))
    } else {
        Ok(s)
    }
}
fn count(r: &mut Reader<'_>, empty: bool) -> Result<usize> {
    let n = r.u16()? as usize;
    if n > 128 || (!empty && n == 0) {
        Err(Error::new("resource count out of bounds"))
    } else {
        Ok(n)
    }
}
fn boolean(r: &mut Reader<'_>) -> Result<bool> {
    match r.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(Error::new("invalid resource Bool")),
    }
}
#[derive(Clone)]
struct Group {
    name: String,
    modes: Vec<String>,
    requires: Vec<Predicate>,
    safe: BTreeMap<String, bool>,
}
#[derive(Clone)]
pub(crate) struct Plan {
    activation: Vec<u8>,
    binding_hash: String,
    source_hash: String,
    descriptor_hash: String,
    outputs: BTreeMap<String, String>,
    modes: BTreeMap<String, String>,
    groups: Vec<Group>,
    ids: BTreeSet<String>,
}
impl Plan {
    pub(crate) fn read(r: &mut Reader<'_>, m: &Module) -> Result<Self> {
        if !matches!(m.format_version, 1 | 3)
            || m.inputs
                .iter()
                .chain(m.states.iter())
                .any(|f| f.value_type != Type::Bool)
            || m.strategies
                .iter()
                .flat_map(|s| &s.intents)
                .any(|i| i.value_type != Type::Bool)
        {
            return Err(Error::new("resource profile requires Bool GFB1 v1/v3 base"));
        }
        let source_hash = hash(r)?;
        let descriptor_hash = hash(r)?;
        let activation_length = r.u32()? as usize;
        if activation_length > 65536 {
            return Err(Error::new("resource binding byte limit exceeded"));
        }
        let activation = r.take(activation_length)?.to_vec();
        let mut b = Reader::new(&activation);
        if b.take(4)? != b"GFRB" || b.u16()? != 1 {
            return Err(Error::new("unsupported resource activation binding"));
        }
        let _revision = string(&mut b)?;
        let binding_hash = hash(&mut b)?;
        let mut resources = BTreeMap::new();
        let mut ids = BTreeSet::new();
        for _ in 0..count(&mut b, false)? {
            let alias = string(&mut b)?;
            let ty = b.u8()?;
            let id = string(&mut b)?;
            if ty > 1 || resources.insert(alias, (ty, id.clone())).is_some() || !ids.insert(id) {
                return Err(Error::new("duplicate or invalid resource binding"));
            }
        }
        let mut outputs = BTreeMap::new();
        let mut output_resources = BTreeSet::new();
        for _ in 0..count(&mut b, false)? {
            let port = string(&mut b)?;
            let alias = string(&mut b)?;
            if resources.get(&alias).map(|v| v.0) != Some(1)
                || outputs.insert(port, alias.clone()).is_some()
                || !output_resources.insert(alias)
            {
                return Err(Error::new("invalid resource output binding"));
            }
        }
        let source_outputs: BTreeSet<_> = m
            .strategies
            .iter()
            .flat_map(|s| s.intents.iter().map(|i| i.name.clone()))
            .collect();
        if source_outputs != outputs.keys().cloned().collect()
            || m.strategies.iter().any(|s| {
                s.intents
                    .iter()
                    .map(|i| i.name.clone())
                    .collect::<BTreeSet<_>>()
                    != source_outputs
            })
        {
            return Err(Error::new(
                "resource binding must cover every strategy output",
            ));
        }
        let mut modes = BTreeMap::new();
        let mut mode_ids = BTreeSet::new();
        for _ in 0..count(&mut b, true)? {
            let alias = string(&mut b)?;
            let input = string(&mut b)?;
            let id = string(&mut b)?;
            if !m
                .inputs
                .iter()
                .any(|f| f.name == input && f.value_type == Type::Bool)
                || modes.insert(alias, input).is_some()
                || !mode_ids.insert(id)
            {
                return Err(Error::new("invalid resource mode binding"));
            }
        }
        if !b.finished() {
            return Err(Error::new("trailing resource binding bytes"));
        }
        let mut groups = vec![];
        let mut group_names = BTreeSet::new();
        let mut used_modes = BTreeSet::new();
        let mut union_safe = BTreeMap::new();
        let mut node_count = 0;
        for _ in 0..count(r, false)? {
            let name = string(r)?;
            if !group_names.insert(name.clone()) {
                return Err(Error::new("duplicate resource group"));
            }
            let target = string(r)?;
            if !resources.contains_key(&target) {
                return Err(Error::new("missing resource target"));
            }
            let mut gm = vec![];
            for _ in 0..count(r, true)? {
                let mode = string(r)?;
                if !modes.contains_key(&mode) || !used_modes.insert(mode.clone()) {
                    return Err(Error::new("missing or duplicate group mode binding"));
                }
                gm.push(mode);
            }
            if gm.len() == 1 {
                return Err(Error::new(
                    "exclusive resource group requires at least two modes",
                ));
            }
            let mut refs = BTreeSet::new();
            let mut requires = vec![];
            for _ in 0..count(r, true)? {
                let bytes = r.blob()?;
                let mut p = Reader::new(&bytes);
                let predicate = Predicate::read(&mut p, 0, &mut node_count, &mut refs)?;
                if !p.finished() || predicate.ty() != Type::Bool {
                    return Err(Error::new("invalid mandatory resource predicate"));
                }
                requires.push(predicate);
            }
            if resources[&target].0 == 1 {
                refs.insert(target);
            }
            let mut safe = BTreeMap::new();
            for _ in 0..count(r, false)? {
                let alias = string(r)?;
                let value = boolean(r)?;
                if resources.get(&alias).map(|v| v.0) != Some(1)
                    || !output_resources.contains(&alias)
                    || safe.insert(alias.clone(), value).is_some()
                {
                    return Err(Error::new("invalid authored resource safe map"));
                }
                if union_safe.insert(alias, value).is_some_and(|v| v != value) {
                    return Err(Error::new("conflicting overlapping resource safe maps"));
                }
            }
            if !refs.is_subset(&safe.keys().cloned().collect())
                || !safe.keys().all(|s| refs.contains(s))
            {
                return Err(Error::new(
                    "authored safe map must exactly cover target and predicate resources",
                ));
            }
            if requires.iter().any(|p| p.eval(&safe) != Scalar::Bool(true)) {
                return Err(Error::new(
                    "authored safe map violates mandatory resource predicate",
                ));
            }
            if gm.is_empty() && requires.is_empty() {
                return Err(Error::new("empty mandatory resource group"));
            }
            groups.push(Group {
                name,
                modes: gm,
                requires,
                safe,
            });
        }
        if used_modes != modes.keys().cloned().collect()
            || union_safe.keys().cloned().collect::<BTreeSet<_>>() != output_resources
        {
            return Err(Error::new("unprotected resource binding"));
        }
        let named_safe: NamedValues = outputs
            .iter()
            .map(|(port, alias)| (port.clone(), Value::Bool(union_safe[alias])))
            .collect();
        if crate::apply_safety(named_safe.clone(), &m.constraints).0 != named_safe {
            return Err(Error::new(
                "authored resource safe map conflicts with local constraints",
            ));
        }
        Ok(Self {
            activation,
            binding_hash,
            source_hash,
            descriptor_hash,
            outputs,
            modes,
            groups,
            ids,
        })
    }
    pub(crate) fn activate(
        &self,
        bytes: &[u8],
        registry: &ResourceBindingRegistry,
    ) -> Result<(Guard, Lease)> {
        if bytes != self.activation {
            return Err(Error::new("resource activation binding mismatch"));
        }
        let lease = registry.acquire(&self.ids)?;
        Ok((
            Guard {
                plan: self.clone(),
                states: vec![GroupState::default(); self.groups.len()],
                previous: BTreeMap::new(),
            },
            lease,
        ))
    }
}
#[derive(Clone, Default)]
struct GroupState {
    admitted: Option<String>,
    blocked: BTreeSet<String>,
    tripped: bool,
    pending_denial: bool,
}
#[derive(Clone)]
pub(crate) struct Guard {
    plan: Plan,
    states: Vec<GroupState>,
    previous: BTreeMap<String, bool>,
}
#[derive(Clone, Debug)]
pub struct Observation {
    pub group: String,
    pub decision: String,
    pub failed_rule: Option<usize>,
    pub admitted_mode: Option<String>,
    pub tripped: bool,
    pub binding_hash: String,
    pub source_hash: String,
    pub descriptor_hash: String,
    pub local_candidate: NamedValues,
    pub final_protected: NamedValues,
}
impl Guard {
    pub(crate) fn validate_scan(&self, bytes: &[u8]) -> Result<()> {
        let mut r = Reader::new(bytes);
        if r.take(4)? != b"GFRS"
            || r.u16()? != 1
            || hash(&mut r)? != self.plan.binding_hash
            || !r.finished()
        {
            return Err(Error::new("resource scan binding mismatch"));
        }
        Ok(())
    }
    pub(crate) fn stage(
        &self,
        inputs: &NamedValues,
        requested: &NamedValues,
        candidate: &NamedValues,
    ) -> Result<(Self, NamedValues, Vec<Observation>)> {
        let mut next = self.clone();
        let values: BTreeMap<String, bool> = self
            .plan
            .outputs
            .iter()
            .map(|(p, a)| match candidate.get(p) {
                Some(Value::Bool(v)) => Ok((a.clone(), *v)),
                _ => Err(Error::new("missing finite resource candidate")),
            })
            .collect::<Result<_>>()?;
        let mut projected = values.clone();
        let mut decisions = vec!["allow"; self.states.len()];
        let mut denied = BTreeSet::new();
        let mut trips = BTreeSet::new();
        let mut releases = BTreeSet::new();
        for (i, g) in self.plan.groups.iter().enumerate() {
            let state = &mut next.states[i];
            let active: BTreeSet<String> = g
                .modes
                .iter()
                .filter(|mode| inputs.get(&self.plan.modes[*mode]) == Some(&Value::Bool(true)))
                .cloned()
                .collect();
            state.blocked.retain(|mode| active.contains(mode));
            let neutral = if g.modes.is_empty() {
                self.plan
                    .outputs
                    .iter()
                    .filter(|(_, a)| g.safe.contains_key(*a))
                    .all(|(p, a)| requested.get(p) == Some(&Value::Bool(g.safe[a])))
            } else {
                active.is_empty()
            };
            if state.tripped {
                decisions[i] = "tripped";
                trips.insert(i);
                if neutral {
                    state.tripped = false;
                    decisions[i] = "neutral";
                }
                continue;
            }
            if state.pending_denial {
                if neutral {
                    state.pending_denial = false;
                    decisions[i] = "neutral";
                } else {
                    denied.insert(i);
                    decisions[i] = "held_prestart";
                }
                continue;
            }
            let incumbent = state
                .admitted
                .as_ref()
                .is_some_and(|a| g.modes.is_empty() || active.contains(a));
            if !incumbent && self.states[i].admitted.is_some() {
                releases.insert(i);
            }
            if incumbent
                && !g.modes.is_empty()
                && active.iter().any(|a| state.admitted.as_ref() != Some(a))
            {
                state.blocked.extend(
                    active
                        .iter()
                        .filter(|a| state.admitted.as_ref() != Some(*a))
                        .cloned(),
                );
                denied.insert(i);
                decisions[i] = "incumbent_conflict";
                continue;
            }
            if incumbent
                && g.requires
                    .iter()
                    .any(|p| p.eval(&values) != Scalar::Bool(true))
            {
                state.admitted = None;
                state.tripped = true;
                trips.insert(i);
                decisions[i] = "ongoing_violation";
                continue;
            }
            if !incumbent {
                state.admitted = None;
            }
            if !g.modes.is_empty() {
                let fresh: Vec<_> = active
                    .iter()
                    .filter(|a| !state.blocked.contains(*a) && state.admitted.as_ref() != Some(*a))
                    .cloned()
                    .collect();
                if incumbent && !fresh.is_empty() {
                    state.blocked.extend(fresh);
                    denied.insert(i);
                    decisions[i] = "incumbent_conflict";
                } else if !incumbent
                    && (active.len() > 1 || active.iter().any(|a| state.blocked.contains(a)))
                {
                    state.blocked.extend(active.iter().cloned());
                    denied.insert(i);
                    decisions[i] = "admission_conflict";
                } else if !incumbent && active.len() == 1 {
                    if g.requires
                        .iter()
                        .all(|p| p.eval(&values) == Scalar::Bool(true))
                    {
                        state.admitted = active.iter().next().cloned();
                    } else {
                        state.blocked.extend(active.iter().cloned());
                        denied.insert(i);
                        decisions[i] = "prestart_require";
                    }
                } else if !incumbent && !neutral {
                    unreachable!();
                }
                if state.admitted.is_none()
                    && active.is_empty()
                    && g.safe.iter().any(|(k, v)| values[k] != *v)
                {
                    denied.insert(i);
                    decisions[i] = "no_activity";
                }
            } else if g
                .requires
                .iter()
                .any(|p| p.eval(&values) != Scalar::Bool(true))
            {
                if state.admitted.is_some() {
                    state.admitted = None;
                    state.tripped = true;
                    trips.insert(i);
                    decisions[i] = "ongoing_violation";
                } else {
                    state.pending_denial = true;
                    denied.insert(i);
                    decisions[i] = "prestart_require";
                }
            } else if !neutral {
                state.admitted = Some("require_only".into());
            } else {
                state.admitted = None;
            }
        }
        // A denied newcomer is not part of the final candidate. Retain the
        // incumbent component before interpreting sibling ongoing predicates.
        let mut incumbent_denials: BTreeSet<_> = decisions
            .iter()
            .enumerate()
            .filter(|(_, decision)| **decision == "incumbent_conflict")
            .map(|(i, _)| i)
            .collect();
        loop {
            let old = incumbent_denials.len();
            let resources: BTreeSet<_> = incumbent_denials
                .iter()
                .flat_map(|i| self.plan.groups[*i].safe.keys().cloned())
                .collect();
            for (i, group) in self.plan.groups.iter().enumerate() {
                if group.safe.keys().any(|key| resources.contains(key)) {
                    incumbent_denials.insert(i);
                }
            }
            if old == incumbent_denials.len() {
                break;
            }
        }
        for i in incumbent_denials {
            if decisions[i] == "ongoing_violation" {
                trips.remove(&i);
                next.states[i] = self.states[i].clone();
                decisions[i] = "overlap_denial";
            }
            denied.insert(i);
        }
        // A trip propagates through the connected overlap component, never via priority.
        loop {
            let old = trips.len();
            let affected: BTreeSet<_> = trips
                .iter()
                .flat_map(|i| self.plan.groups[*i].safe.keys().cloned())
                .collect();
            for (i, g) in self.plan.groups.iter().enumerate() {
                if g.safe.keys().any(|k| affected.contains(k)) {
                    trips.insert(i);
                }
            }
            if trips.len() == old {
                break;
            }
        }
        for i in &trips {
            let g = &self.plan.groups[*i];
            for (k, v) in &g.safe {
                projected.insert(k.clone(), *v);
            }
            let mut component = BTreeSet::from([*i]);
            loop {
                let old = component.len();
                let keys: BTreeSet<_> = component
                    .iter()
                    .flat_map(|j| self.plan.groups[*j].safe.keys().cloned())
                    .collect();
                for j in &trips {
                    if self.plan.groups[*j].safe.keys().any(|k| keys.contains(k)) {
                        component.insert(*j);
                    }
                }
                if old == component.len() {
                    break;
                }
            }
            let recovered = component.iter().all(|j| decisions[*j] == "neutral");
            next.states[*i].tripped = !recovered;
            next.states[*i].admitted = None;
            next.states[*i].pending_denial = false;
            if decisions[*i] == "allow" {
                decisions[*i] = "overlap_trip";
            }
        }
        // Denial retains the last actual emission on the affected component; the first denial emits no protected keys.
        loop {
            let old = denied.len();
            let affected: BTreeSet<_> = denied
                .iter()
                .flat_map(|i| self.plan.groups[*i].safe.keys().cloned())
                .collect();
            for (i, g) in self.plan.groups.iter().enumerate() {
                if !trips.contains(&i) && g.safe.keys().any(|k| affected.contains(k)) {
                    denied.insert(i);
                }
            }
            if old == denied.len() {
                break;
            }
        }
        let mut released_resources: BTreeSet<_> = releases
            .iter()
            .filter(|i| denied.contains(i))
            .flat_map(|i| self.plan.groups[*i].safe.keys().cloned())
            .collect();
        loop {
            let old = released_resources.len();
            for i in &denied {
                let group = &self.plan.groups[*i];
                if group
                    .safe
                    .keys()
                    .any(|key| released_resources.contains(key))
                {
                    released_resources.extend(group.safe.keys().cloned());
                }
            }
            if old == released_resources.len() {
                break;
            }
        }
        let mut suppressed = BTreeSet::new();
        for i in &denied {
            if trips.contains(i) {
                continue;
            }
            let g = &self.plan.groups[*i];
            if self.states[*i].admitted.is_none() && next.states[*i].admitted.is_some() {
                next.states[*i].admitted = None;
                next.states[*i].blocked.extend(
                    g.modes
                        .iter()
                        .filter(|mode| {
                            inputs.get(&self.plan.modes[*mode]) == Some(&Value::Bool(true))
                        })
                        .cloned(),
                );
                if g.modes.is_empty() {
                    next.states[*i].pending_denial = true;
                }
                decisions[*i] = "overlap_denial";
            }
            for (k, v) in &g.safe {
                if released_resources.contains(k) {
                    projected.insert(k.clone(), *v);
                } else if let Some(v) = self.previous.get(k) {
                    projected.insert(k.clone(), *v);
                } else {
                    suppressed.insert(k.clone());
                }
            }
        }
        let safe: NamedValues = self
            .plan
            .outputs
            .iter()
            .filter(|(_, a)| !suppressed.contains(*a))
            .map(|(p, a)| (p.clone(), Value::Bool(projected[a])))
            .collect();
        for g in &self.plan.groups {
            if g.safe.keys().all(|k| !suppressed.contains(k))
                && g.requires
                    .iter()
                    .any(|p| p.eval(&projected) != Scalar::Bool(true))
            {
                return Err(Error::new(
                    "resource projection violates mandatory predicate",
                ));
            }
        }
        for (k, v) in &projected {
            if !suppressed.contains(k) {
                next.previous.insert(k.clone(), *v);
            }
        }
        let trace = self
            .plan
            .groups
            .iter()
            .enumerate()
            .map(|(i, g)| Observation {
                group: g.name.clone(),
                decision: decisions[i].into(),
                failed_rule: if matches!(decisions[i], "prestart_require" | "ongoing_violation") {
                    g.requires
                        .iter()
                        .position(|p| p.eval(&values) != Scalar::Bool(true))
                } else {
                    None
                },
                admitted_mode: next.states[i].admitted.clone(),
                tripped: next.states[i].tripped,
                binding_hash: self.plan.binding_hash.clone(),
                source_hash: self.plan.source_hash.clone(),
                descriptor_hash: self.plan.descriptor_hash.clone(),
                local_candidate: candidate.clone(),
                final_protected: safe.clone(),
            })
            .collect();
        Ok((next, safe, trace))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        scan::{ScanFrameV1, ScanInput},
        Runtime,
    };
    fn s(out: &mut Vec<u8>, text: &str) {
        out.extend((text.len() as u16).to_le_bytes());
        out.extend(text.as_bytes());
    }
    fn blob(out: &mut Vec<u8>, bytes: &[u8]) {
        out.extend((bytes.len() as u32).to_le_bytes());
        out.extend(bytes);
    }
    fn packet(
        exclusive: bool,
        safe: [bool; 2],
        predicate: Option<Vec<u8>>,
    ) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut inner = b"GFB1\x01\x00".to_vec();
        s(&mut inner, "finite-test");
        inner.extend(1u32.to_le_bytes());
        inner.extend(4u16.to_le_bytes());
        for name in ["auto", "manual", "request", "valve"] {
            s(&mut inner, name);
            inner.push(1);
        }
        inner.extend(1u16.to_le_bytes());
        s(&mut inner, "remembered");
        inner.extend([1, 0]);
        inner.extend(1u16.to_le_bytes());
        s(&mut inner, "allpaths");
        inner.extend(0i32.to_le_bytes());
        blob(&mut inner, &[5, 1]);
        inner.extend(1u16.to_le_bytes());
        inner.extend(0u16.to_le_bytes());
        blob(&mut inner, &[3, 2, 0]);
        inner.extend(2u16.to_le_bytes());
        for (name, index) in [("pump", 2), ("valve", 3)] {
            s(&mut inner, name);
            inner.push(1);
            blob(&mut inner, &[3, index, 0]);
        }
        inner.extend(0u16.to_le_bytes());
        let mut activation = b"GFRB\x01\x00".to_vec();
        s(&mut activation, "revision1");
        s(&mut activation, &"a".repeat(64));
        activation.extend(2u16.to_le_bytes());
        for name in ["pump", "valve"] {
            s(&mut activation, name);
            activation.push(1);
            s(&mut activation, &format!("stable/{name}"));
        }
        activation.extend(2u16.to_le_bytes());
        for name in ["pump", "valve"] {
            s(&mut activation, name);
            s(&mut activation, name);
        }
        activation.extend(if exclusive { 2u16 } else { 0 }.to_le_bytes());
        if exclusive {
            for name in ["auto", "manual"] {
                s(&mut activation, &format!("rules/{name}"));
                s(&mut activation, name);
                s(&mut activation, &format!("stable-mode/{name}"));
            }
        }
        let mut implication = vec![5, 2];
        s(&mut implication, "pump");
        implication.push(2);
        s(&mut implication, "valve");
        let predicate = predicate.unwrap_or(implication);
        let mut wrapper = b"GFB1\x11\x00".to_vec();
        blob(&mut wrapper, &inner);
        s(&mut wrapper, &"b".repeat(64));
        s(&mut wrapper, &"c".repeat(64));
        blob(&mut wrapper, &activation);
        wrapper.extend(1u16.to_le_bytes());
        s(&mut wrapper, "rules");
        s(&mut wrapper, "pump");
        wrapper.extend(if exclusive { 2u16 } else { 0 }.to_le_bytes());
        if exclusive {
            for name in ["auto", "manual"] {
                s(&mut wrapper, &format!("rules/{name}"));
            }
        }
        wrapper.extend(1u16.to_le_bytes());
        blob(&mut wrapper, &predicate);
        wrapper.extend(2u16.to_le_bytes());
        for (name, v) in [("pump", safe[0]), ("valve", safe[1])] {
            s(&mut wrapper, name);
            wrapper.push(u8::from(v));
        }
        let mut scan = b"GFRS\x01\x00".to_vec();
        s(&mut scan, &"a".repeat(64));
        (wrapper, activation, scan)
    }
    fn setup(exclusive: bool) -> (Runtime, Vec<u8>, Vec<u8>, ResourceBindingRegistry) {
        let (bytes, activation, scan) = packet(exclusive, [false, true], None);
        let registry = ResourceBindingRegistry::new();
        let mut runtime = Runtime::new(32);
        runtime.install(Module::load(&bytes).unwrap(), false);
        runtime
            .activate_with_resource_binding(&activation, &registry)
            .unwrap();
        (runtime, activation, scan, registry)
    }
    fn run(runtime: &mut Runtime, scan: &[u8], row: [bool; 4]) -> crate::TickRecord {
        for (name, v) in ["auto", "manual", "request", "valve"].into_iter().zip(row) {
            runtime.set_input(name, Value::Bool(v)).unwrap();
        }
        runtime.tick_with_resource_binding(scan).unwrap().clone()
    }
    fn vals(pump: bool, valve: bool) -> NamedValues {
        [
            ("pump".into(), Value::Bool(pump)),
            ("valve".into(), Value::Bool(valve)),
        ]
        .into_iter()
        .collect()
    }
    #[test]
    fn finite_wire_independently_rejects_unsafe_fallback_bad_type_and_old_header() {
        let (mut bytes, _, _) = packet(true, [false, true], None);
        assert!(Module::load(&bytes).is_ok());
        bytes[4] = 1;
        assert!(Module::load(&bytes).is_err());
        assert!(Module::load(&packet(true, [true, false], None).0)
            .unwrap_err_message()
            .contains("violates"));
        assert!(Module::load(&packet(true, [false, true], Some(vec![1, 0, 0, 0, 0])).0).is_err());
        let (mut bytes, _, _) = packet(true, [false, true], None);
        bytes.push(0);
        assert!(Module::load(&bytes).is_err());
    }
    #[test]
    fn first_prestart_denial_emits_nothing_and_recovery_requires_false_then_fresh() {
        let (mut r, _, scan, _) = setup(true);
        let denied = run(&mut r, &scan, [true, false, true, false]);
        assert!(denied.safe_intents.is_empty());
        assert_eq!(denied.resource_trace[0].failed_rule, Some(0));
        assert_eq!(r.state("remembered"), Some(Value::Bool(true)));
        assert!(run(&mut r, &scan, [true, false, true, true])
            .safe_intents
            .is_empty());
        run(&mut r, &scan, [false, false, false, true]);
        assert_eq!(
            run(&mut r, &scan, [true, false, true, true]).safe_intents,
            vals(true, true)
        );
    }
    #[test]
    fn newcomer_conflict_preserves_incumbent_and_has_no_queued_start() {
        let (mut r, _, scan, _) = setup(true);
        let admitted = run(&mut r, &scan, [true, false, true, true]);
        assert_eq!(
            run(&mut r, &scan, [true, true, true, false]).safe_intents,
            admitted.safe_intents
        );
        assert_eq!(
            r.journal().back().unwrap().resource_trace[0]
                .admitted_mode
                .as_deref(),
            Some("rules/auto")
        );
        assert_eq!(
            run(&mut r, &scan, [false, true, true, true]).safe_intents,
            vals(false, true)
        );
        assert_eq!(
            run(&mut r, &scan, [false, true, true, true]).safe_intents,
            vals(false, true)
        );
        run(&mut r, &scan, [false, false, false, true]);
        assert_eq!(
            run(&mut r, &scan, [false, true, true, true]).safe_intents,
            vals(true, true)
        );
    }
    #[test]
    fn overlapping_require_only_cannot_trip_on_rejected_newcomer_and_release_is_order_independent()
    {
        for reverse in [false, true] {
            let (mut runtime, _, scan, _) = setup(true);
            let guard = runtime.resource_guard.as_mut().unwrap();
            let mut sibling = guard.plan.groups[0].clone();
            sibling.name = "sibling".into();
            sibling.modes.clear();
            guard.plan.groups.push(sibling);
            guard.states.push(GroupState::default());
            if reverse {
                guard.plan.groups.reverse();
                guard.states.reverse();
            }
            let accepted = run(&mut runtime, &scan, [true, false, true, true]);
            let rejected = run(&mut runtime, &scan, [true, true, true, false]);
            assert_eq!(rejected.safe_intents, accepted.safe_intents);
            assert!(rejected.resource_trace.iter().all(|trace| !trace.tripped));
            assert_eq!(
                run(&mut runtime, &scan, [false, true, true, true]).safe_intents,
                vals(false, true)
            );
            assert_eq!(
                run(&mut runtime, &scan, [false, true, true, true]).safe_intents,
                vals(false, true)
            );
        }
    }
    #[test]
    fn ongoing_violation_uses_authored_non_off_and_neutral_then_fresh() {
        let (mut r, _, scan, _) = setup(true);
        run(&mut r, &scan, [true, false, true, true]);
        let trip = run(&mut r, &scan, [true, false, true, false]);
        assert_eq!(trip.safe_intents, vals(false, true));
        assert!(trip.resource_trace[0].tripped);
        assert_eq!(
            run(&mut r, &scan, [true, false, true, true]).safe_intents,
            vals(false, true)
        );
        assert!(!run(&mut r, &scan, [false, false, false, true]).resource_trace[0].tripped);
        assert_eq!(
            run(&mut r, &scan, [true, false, true, true]).safe_intents,
            vals(true, true)
        );
    }
    #[test]
    fn require_only_denial_and_trip_need_authored_request_neutral() {
        let (mut r, _, scan, _) = setup(false);
        assert!(run(&mut r, &scan, [false, false, true, false])
            .safe_intents
            .is_empty());
        assert!(run(&mut r, &scan, [false, false, true, true])
            .safe_intents
            .is_empty());
        run(&mut r, &scan, [false, false, false, true]);
        run(&mut r, &scan, [false, false, true, true]);
        assert!(run(&mut r, &scan, [false, false, true, false]).resource_trace[0].tripped);
        assert_eq!(
            run(&mut r, &scan, [false, false, true, true]).safe_intents,
            vals(false, true)
        );
        run(&mut r, &scan, [false, false, false, true]);
        assert_eq!(
            run(&mut r, &scan, [false, false, true, true]).safe_intents,
            vals(true, true)
        );
    }
    #[test]
    fn shared_registry_refuses_second_writer_and_drop_releases() {
        let (r, activation, _, registry) = setup(true);
        let mut second = Runtime::new(2);
        second.install(
            Module::load(&packet(true, [false, true], None).0).unwrap(),
            false,
        );
        assert!(second
            .activate_with_resource_binding(&activation, &registry)
            .unwrap_err()
            .message()
            .contains("writer"));
        drop(r);
        second
            .activate_with_resource_binding(&activation, &registry)
            .unwrap();
    }
    #[test]
    fn bad_binding_frame_rolls_back_state_guard_journal_and_scan_sequence() {
        let (r, _, scan, _) = setup(true);
        let mut driver = r.into_scan_driver();
        let frame = ScanFrameV1 {
            scan_id: 0,
            logical_time_ms: 0,
            inputs: ["auto", "manual", "request", "valve"]
                .into_iter()
                .zip([true, false, true, true])
                .map(|(n, v)| ScanInput {
                    name: n.into(),
                    value: Value::Bool(v),
                })
                .collect(),
        };
        assert!(driver.scan(frame.clone()).is_err());
        let mut wrong = scan.clone();
        *wrong.last_mut().unwrap() = b'd';
        assert!(driver
            .scan_with_resource_binding(frame.clone(), &wrong)
            .is_err());
        assert!(driver.runtime().journal().is_empty());
        assert_eq!(
            driver.runtime().state("remembered"),
            Some(Value::Bool(false))
        );
        assert_eq!(driver.next_scan_id(), Some(0));
        let good = driver.scan_with_resource_binding(frame, &scan).unwrap();
        assert_eq!(good.trace.safe_intents, vals(true, true));
        assert_eq!(good.trace.tick, 1);
    }
    trait LoadError {
        fn unwrap_err_message(self) -> String;
    }
    impl LoadError for Result<Module> {
        fn unwrap_err_message(self) -> String {
            match self {
                Err(e) => e.message().into(),
                Ok(_) => panic!("expected invalid module"),
            }
        }
    }
}
