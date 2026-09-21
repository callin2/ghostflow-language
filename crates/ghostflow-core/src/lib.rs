use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;

pub mod scan;
pub mod signals;
pub mod solar;
pub mod station;

const MAX_INPUTS: usize = 128;
const MAX_STATES: usize = 128;
const MAX_STRATEGIES: usize = 32;
const MAX_EXPR_BYTES: usize = 4096;
const MAX_STACK: usize = 128;
const MAX_MODULE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Type {
    Bool = 1,
    Number = 2,
    Int = 3,
}

impl Type {
    fn from_byte(value: u8) -> Result<Self> {
        match value {
            1 => Ok(Self::Bool),
            2 => Ok(Self::Number),
            _ => Err(Error::new("invalid type")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value {
    Bool(bool),
    Number(f64),
    Int(i32),
}

impl Value {
    pub fn value_type(self) -> Type {
        match self {
            Self::Bool(_) => Type::Bool,
            Self::Number(_) => Type::Number,
            Self::Int(_) => Type::Int,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    message: String,
}

impl Error {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Capability {
    pub kind: String,
    pub name: String,
    pub value_type: Type,
}

impl Capability {
    pub fn new(kind: impl Into<String>, name: impl Into<String>, value_type: Type) -> Self {
        Self {
            kind: kind.into(),
            name: name.into(),
            value_type,
        }
    }
}

#[derive(Clone)]
struct Field {
    name: String,
    value_type: Type,
    default: Value,
}
#[derive(Clone)]
struct Transition {
    state_index: usize,
    expression: Vec<u8>,
}
#[derive(Clone)]
struct Intent {
    name: String,
    value_type: Type,
    expression: Vec<u8>,
}
#[derive(Clone)]
struct Strategy {
    name: String,
    priority: i32,
    query: Vec<u8>,
    transitions: Vec<Transition>,
    intents: Vec<Intent>,
}
#[derive(Clone)]
struct Constraint {
    kind: u8,
    names: Vec<String>,
}

#[derive(Clone)]
pub struct Module {
    fingerprint: u64,
    name: String,
    version: u32,
    inputs: Vec<Field>,
    states: Vec<Field>,
    strategies: Vec<Strategy>,
    constraints: Vec<Constraint>,
}

impl Module {
    pub fn load(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MODULE_BYTES {
            return Err(Error::new("module byte limit exceeded"));
        }
        let fingerprint = bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
        let mut reader = Reader::new(bytes);
        if reader.take(4)? != b"GFB1" {
            return Err(Error::new("invalid GFB1 magic"));
        }
        if reader.u16()? != 1 {
            return Err(Error::new("unsupported GFB format"));
        }
        let name = reader.string()?;
        let version = reader.u32()?;

        let input_count = reader.u16()? as usize;
        if input_count > MAX_INPUTS {
            return Err(Error::new("input limit exceeded"));
        }
        let mut inputs = Vec::with_capacity(input_count);
        let mut names = BTreeSet::new();
        for _ in 0..input_count {
            let name = reader.string()?;
            if !names.insert(name.clone()) {
                return Err(Error::new("duplicate input"));
            }
            let value_type = Type::from_byte(reader.u8()?)?;
            let default = match value_type {
                Type::Bool => Value::Bool(false),
                Type::Number => Value::Number(0.0),
                Type::Int => return Err(Error::new("unsupported GFB format")),
            };
            inputs.push(Field {
                name,
                value_type,
                default,
            });
        }

        let state_count = reader.u16()? as usize;
        if state_count > MAX_STATES {
            return Err(Error::new("state limit exceeded"));
        }
        let mut states = Vec::with_capacity(state_count);
        names.clear();
        for _ in 0..state_count {
            let name = reader.string()?;
            if !names.insert(name.clone()) {
                return Err(Error::new("duplicate state"));
            }
            let value_type = Type::from_byte(reader.u8()?)?;
            let default = match value_type {
                Type::Bool => match reader.u8()? {
                    0 => Value::Bool(false),
                    1 => Value::Bool(true),
                    _ => return Err(Error::new("invalid bool default")),
                },
                Type::Number => Value::Number(reader.f64()?),
                Type::Int => return Err(Error::new("unsupported GFB format")),
            };
            states.push(Field {
                name,
                value_type,
                default,
            });
        }

        let strategy_count = reader.u16()? as usize;
        if strategy_count == 0 || strategy_count > MAX_STRATEGIES {
            return Err(Error::new("invalid strategy count"));
        }
        let mut strategies = Vec::with_capacity(strategy_count);
        names.clear();
        for _ in 0..strategy_count {
            let strategy_name = reader.string()?;
            if !names.insert(strategy_name.clone()) {
                return Err(Error::new("duplicate strategy"));
            }
            let priority = reader.i32()?;
            let query = reader.blob()?;
            verify_query(&query)?;

            let transition_count = reader.u16()? as usize;
            if transition_count > state_count {
                return Err(Error::new("invalid transition count"));
            }
            let mut transitions = Vec::with_capacity(transition_count);
            let mut changed = BTreeSet::new();
            for _ in 0..transition_count {
                let state_index = reader.u16()? as usize;
                if state_index >= state_count || !changed.insert(state_index) {
                    return Err(Error::new("invalid transition target"));
                }
                let expression = reader.blob()?;
                let ty = verify_expression(&expression, &inputs, &states, false)?;
                if ty != states[state_index].value_type {
                    return Err(Error::new("transition type mismatch"));
                }
                transitions.push(Transition {
                    state_index,
                    expression,
                });
            }

            let intent_count = reader.u16()? as usize;
            if intent_count > 128 {
                return Err(Error::new("intent limit exceeded"));
            }
            let mut intents = Vec::with_capacity(intent_count);
            let mut intent_names = BTreeSet::new();
            for _ in 0..intent_count {
                let name = reader.string()?;
                if !intent_names.insert(name.clone()) {
                    return Err(Error::new("duplicate intent"));
                }
                let value_type = Type::from_byte(reader.u8()?)?;
                let expression = reader.blob()?;
                if verify_expression(&expression, &inputs, &states, true)? != value_type {
                    return Err(Error::new("intent type mismatch"));
                }
                intents.push(Intent {
                    name,
                    value_type,
                    expression,
                });
            }
            strategies.push(Strategy {
                name: strategy_name,
                priority,
                query,
                transitions,
                intents,
            });
        }

        let constraint_count = reader.u16()? as usize;
        if constraint_count > 128 {
            return Err(Error::new("constraint limit exceeded"));
        }
        let mut constraints = Vec::with_capacity(constraint_count);
        for _ in 0..constraint_count {
            let kind = reader.u8()?;
            if !(1..=3).contains(&kind) {
                return Err(Error::new("invalid constraint kind"));
            }
            let count = reader.u16()? as usize;
            if !(2..=32).contains(&count) || (kind == 1 && count != 2) {
                return Err(Error::new("invalid constraint arity"));
            }
            let mut items = Vec::with_capacity(count);
            for _ in 0..count {
                items.push(reader.string()?);
            }
            if items.iter().collect::<BTreeSet<_>>().len() != items.len() {
                return Err(Error::new("duplicate constraint member"));
            }
            constraints.push(Constraint { kind, names: items });
        }
        for constraint in &constraints {
            for strategy in &strategies {
                for name in &constraint.names {
                    match strategy.intents.iter().find(|intent| &intent.name == name) {
                        Some(intent) if intent.value_type == Type::Bool => {}
                        _ => {
                            return Err(Error::new(
                                "constraint requires a bool intent in every strategy",
                            ))
                        }
                    }
                }
            }
        }
        if !reader.finished() {
            return Err(Error::new("trailing module bytes"));
        }
        Ok(Self {
            fingerprint,
            name,
            version,
            inputs,
            states,
            strategies,
            constraints,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn version(&self) -> u32 {
        self.version
    }
    pub fn input_fields(&self) -> impl Iterator<Item = (&str, Type)> {
        self.inputs
            .iter()
            .map(|field| (field.name.as_str(), field.value_type))
    }
    pub fn output_fields(&self) -> impl Iterator<Item = (&str, Type)> {
        self.strategies
            .iter()
            .flat_map(|strategy| strategy.intents.iter())
            .map(|intent| (intent.name.as_str(), intent.value_type))
    }
}

pub type NamedValues = BTreeMap<String, Value>;

const SAFETY_TRACE_MAX_CONSTRAINTS: usize = 128;
const SAFETY_TRACE_MAX_NAMES: usize = 32;

#[derive(Clone, Debug)]
pub struct SafetyTrace {
    pub constraints: Vec<SafetyTraceConstraint>,
}

#[derive(Clone, Debug)]
pub struct SafetyTraceConstraint {
    pub index: usize,
    pub kind: &'static str,
    pub names: Vec<String>,
    /// The first observed rule violation only; this is not a complete causality graph.
    pub first_violation: Option<SafetyTraceViolation>,
    pub final_evaluation: SafetyTraceFinal,
}

#[derive(Clone, Debug)]
pub struct SafetyTraceViolation {
    pub round: usize,
    pub values: NamedValues,
    pub blocked: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct SafetyTraceFinal {
    pub round: usize,
    pub values: NamedValues,
    pub satisfied: bool,
}

#[derive(Clone, Debug)]
pub struct TickRecord {
    pub module_fingerprint: u64,
    pub tick: u64,
    pub strategy: String,
    pub inputs: NamedValues,
    pub state_before: NamedValues,
    pub state_after: NamedValues,
    pub requested_intents: NamedValues,
    pub safe_intents: NamedValues,
    pub faults: Vec<String>,
    pub safety_trace: SafetyTrace,
}

impl TickRecord {
    /// Stable, dependency-free diagnostic encoding shared by native and WASM runners.
    pub fn to_json(&self) -> String {
        fn text(value: &str) -> String {
            let mut out = String::from("\"");
            for ch in value.chars() {
                match ch {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
                    c => out.push(c),
                }
            }
            out.push('"');
            out
        }
        fn values(items: &NamedValues) -> String {
            format!(
                "{{{}}}",
                items
                    .iter()
                    .map(|(name, value)| {
                        let encoded = match value {
                            Value::Bool(v) => v.to_string(),
                            Value::Number(v) => v.to_string(),
                            Value::Int(v) => v.to_string(),
                        };
                        format!("{}:{}", text(name), encoded)
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        fn strings(items: &[String]) -> String {
            format!(
                "[{}]",
                items
                    .iter()
                    .map(|item| text(item))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        fn safety_trace(trace: &SafetyTrace) -> String {
            let constraints = trace.constraints.iter().map(|constraint| {
                let first = constraint.first_violation.as_ref().map_or_else(|| "null".to_string(), |violation| {
                    format!("{{\"round\":{},\"values\":{},\"blocked\":{}}}", violation.round, values(&violation.values), strings(&violation.blocked))
                });
                format!("{{\"index\":{},\"kind\":{},\"names\":{},\"firstViolation\":{},\"final\":{{\"round\":{},\"values\":{},\"satisfied\":{}}}}}",
                    constraint.index, text(constraint.kind), strings(&constraint.names), first,
                    constraint.final_evaluation.round, values(&constraint.final_evaluation.values), constraint.final_evaluation.satisfied)
            }).collect::<Vec<_>>().join(",");
            format!(
                "{{\"format\":\"GhostFlow/safety-trace-v1\",\"constraints\":[{}]}}",
                constraints
            )
        }
        format!("{{\"tick\":{},\"module\":\"{:016x}\",\"strategy\":{},\"inputs\":{},\"stateBefore\":{},\"stateAfter\":{},\"requested\":{},\"safe\":{},\"faults\":[{}],\"safetyTrace\":{}}}",
            self.tick, self.module_fingerprint, text(&self.strategy), values(&self.inputs),
            values(&self.state_before), values(&self.state_after), values(&self.requested_intents),
            values(&self.safe_intents), self.faults.iter().map(|fault| text(fault)).collect::<Vec<_>>().join(","), safety_trace(&self.safety_trace))
    }
}

pub struct Runtime {
    module: Option<Module>,
    capabilities: Vec<Capability>,
    active_strategy: Option<usize>,
    inputs: Vec<Option<Value>>,
    state: Vec<Value>,
    safe_intents: NamedValues,
    journal: VecDeque<TickRecord>,
    journal_capacity: usize,
    next_tick: u64,
    last_time_ms: Option<f64>,
}

impl Runtime {
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            module: None,
            capabilities: vec![],
            active_strategy: None,
            inputs: vec![],
            state: vec![],
            safe_intents: BTreeMap::new(),
            journal: VecDeque::new(),
            journal_capacity: journal_capacity.clamp(1, 4096),
            next_tick: 1,
            last_time_ms: None,
        }
    }
    pub fn install(&mut self, module: Module, preserve_state: bool) {
        let old = if preserve_state {
            self.named_state()
        } else {
            BTreeMap::new()
        };
        self.state = module
            .states
            .iter()
            .map(|f| {
                old.get(&f.name)
                    .copied()
                    .filter(|v| v.value_type() == f.value_type)
                    .unwrap_or(f.default)
            })
            .collect();
        self.inputs = vec![None; module.inputs.len()];
        self.safe_intents.clear();
        self.active_strategy = None;
        self.module = Some(module);
        self.last_time_ms = None;
    }
    pub fn hot_swap(&mut self, module: Module) -> Result<()> {
        if let Some(previous) = &self.module {
            if previous.name != module.name {
                return Err(Error::new("hot swap requires the same module identity"));
            }
            for field in &module.states {
                if previous
                    .states
                    .iter()
                    .any(|old| old.name == field.name && old.value_type != field.value_type)
                {
                    return Err(Error::new("state type change requires explicit migration"));
                }
            }
        }
        let selected = select_strategy(&module, &self.capabilities)?;
        let old = self.named_state();
        let state = module
            .states
            .iter()
            .map(|f| {
                old.get(&f.name)
                    .copied()
                    .filter(|v| v.value_type() == f.value_type)
                    .unwrap_or(f.default)
            })
            .collect();
        self.inputs = vec![None; module.inputs.len()];
        self.state = state;
        self.safe_intents.clear();
        self.active_strategy = Some(selected);
        self.module = Some(module);
        Ok(())
    }
    pub fn uninstall(&mut self) {
        self.module = None;
        self.inputs.clear();
        self.state.clear();
        self.safe_intents.clear();
        self.active_strategy = None;
    }
    pub fn clear_capabilities(&mut self) {
        self.capabilities.clear();
        self.active_strategy = None;
    }
    pub fn add_capability(&mut self, c: Capability) -> Result<()> {
        if self
            .capabilities
            .iter()
            .any(|x| x.kind == c.kind && x.name == c.name)
        {
            return Err(Error::new("duplicate capability"));
        }
        self.capabilities.push(c);
        self.active_strategy = None;
        Ok(())
    }
    pub fn activate(&mut self) -> Result<()> {
        let m = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        self.active_strategy = Some(select_strategy(m, &self.capabilities)?);
        Ok(())
    }
    pub fn active_strategy(&self) -> Option<&str> {
        let m = self.module.as_ref()?;
        Some(&m.strategies[self.active_strategy?].name)
    }
    pub fn set_input(&mut self, name: &str, value: Value) -> Result<()> {
        let m = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let i = m
            .inputs
            .iter()
            .position(|f| f.name == name)
            .ok_or_else(|| Error::new(format!("unknown input {name}")))?;
        if m.inputs[i].value_type != value.value_type() {
            return Err(Error::new("input type mismatch"));
        }
        if matches!(value,Value::Number(v) if !v.is_finite()) {
            return Err(Error::new("non-finite input"));
        }
        self.inputs[i] = Some(value);
        Ok(())
    }
    pub fn tick(&mut self) -> Result<&TickRecord> {
        let m = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let si = self
            .active_strategy
            .ok_or_else(|| Error::new("runtime is not active"))?;
        let strategy = &m.strategies[si];
        let iv: Vec<Value> = self
            .inputs
            .iter()
            .enumerate()
            .map(|(i, v)| {
                v.ok_or_else(|| Error::new(format!("missing input {}", m.inputs[i].name)))
            })
            .collect::<Result<_>>()?;
        let clock = m
            .inputs
            .iter()
            .position(|f| f.name == "__gf_now_ms")
            .map(|index| match iv[index] {
                Value::Number(value)
                    if value >= 0.0 && value <= 9_007_199_254_740_991.0 && value.fract() == 0.0 =>
                {
                    Ok(value)
                }
                _ => Err(Error::new(
                    "clock must be exact nonnegative integer milliseconds",
                )),
            })
            .transpose()?;
        if clock
            .zip(self.last_time_ms)
            .is_some_and(|(now, last)| now < last)
        {
            return Err(Error::new("monotonic clock moved backwards"));
        }
        let next_tick = self
            .next_tick
            .checked_add(1)
            .ok_or_else(|| Error::new("tick counter exhausted"))?;
        let mut next = self.state.clone();
        for t in &strategy.transitions {
            next[t.state_index] = eval_expression(&t.expression, &iv, &self.state, None)?;
        }
        let mut requested = BTreeMap::new();
        for intent in &strategy.intents {
            let value = eval_expression(&intent.expression, &iv, &self.state, Some(&next))?;
            debug_assert_eq!(value.value_type(), intent.value_type);
            requested.insert(intent.name.clone(), value);
        }
        let (safe, faults, safety_trace) = apply_safety(requested.clone(), &m.constraints);
        let rec = TickRecord {
            module_fingerprint: m.fingerprint,
            tick: self.next_tick,
            strategy: strategy.name.clone(),
            inputs: named(&m.inputs, &iv),
            state_before: named(&m.states, &self.state),
            state_after: named(&m.states, &next),
            requested_intents: requested,
            safe_intents: safe.clone(),
            faults,
            safety_trace,
        };
        self.next_tick = next_tick;
        self.last_time_ms = clock.or(self.last_time_ms);
        self.state = next;
        self.safe_intents = safe;
        self.inputs.fill(None);
        self.journal.push_back(rec);
        while self.journal.len() > self.journal_capacity {
            self.journal.pop_front();
        }
        Ok(self.journal.back().expect("inserted"))
    }
    /// Supplies explicit monotonic time; no wall clock is read inside the VM.
    pub fn tick_at(&mut self, milliseconds: u64) -> Result<&TickRecord> {
        if milliseconds > 9_007_199_254_740_991 {
            return Err(Error::new("clock exceeds exact number range"));
        }
        if self
            .module
            .as_ref()
            .is_some_and(|m| m.inputs.iter().any(|f| f.name == "__gf_now_ms"))
        {
            self.set_input("__gf_now_ms", Value::Number(milliseconds as f64))?;
        }
        self.tick()
    }
    pub fn clear_inputs(&mut self) {
        self.inputs.fill(None);
    }
    pub fn state(&self, name: &str) -> Option<Value> {
        let m = self.module.as_ref()?;
        m.states
            .iter()
            .position(|f| f.name == name)
            .map(|i| self.state[i])
    }
    pub fn intent(&self, name: &str) -> Option<Value> {
        self.safe_intents.get(name).copied()
    }
    pub fn journal(&self) -> &VecDeque<TickRecord> {
        &self.journal
    }
    pub fn rewind(&mut self, tick: u64) -> Result<()> {
        let m = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let r = self
            .journal
            .iter()
            .find(|r| r.tick == tick)
            .cloned()
            .ok_or_else(|| Error::new("tick not retained"))?;
        if r.module_fingerprint != m.fingerprint {
            return Err(Error::new("rewind requires the recorded module version"));
        }
        self.state = m
            .states
            .iter()
            .map(|f| {
                r.state_after
                    .get(&f.name)
                    .copied()
                    .filter(|v| v.value_type() == f.value_type)
                    .ok_or_else(|| Error::new("incompatible journal state"))
            })
            .collect::<Result<_>>()?;
        self.safe_intents = r.safe_intents;
        while self.journal.back().is_some_and(|x| x.tick > tick) {
            self.journal.pop_back();
        }
        self.next_tick = tick + 1;
        self.last_time_ms = match r.inputs.get("__gf_now_ms") {
            Some(Value::Number(value)) => Some(*value),
            _ => None,
        };
        self.inputs.fill(None);
        Ok(())
    }
    pub fn replay(
        &self,
        module: Module,
        caps: &[Capability],
        count: usize,
    ) -> Result<Vec<TickRecord>> {
        let mut g = Runtime::new(count.max(1));
        g.install(module, false);
        for c in caps {
            g.add_capability(c.clone())?;
        }
        g.activate()?;
        if let Some(initial) = self.journal.front().filter(|_| count > 0) {
            if let Some(target) = g.module.as_ref() {
                for (i, f) in target.states.iter().enumerate() {
                    if let Some(v) = initial
                        .state_before
                        .get(&f.name)
                        .filter(|v| v.value_type() == f.value_type)
                    {
                        g.state[i] = *v;
                    }
                }
            }
        }
        for r in self.journal.iter().take(count) {
            for (n, v) in &r.inputs {
                g.set_input(n, *v)?;
            }
            g.tick()?;
        }
        Ok(g.journal.into_iter().collect())
    }
    fn named_state(&self) -> NamedValues {
        self.module
            .as_ref()
            .map(|m| named(&m.states, &self.state))
            .unwrap_or_default()
    }
}

fn named(fields: &[Field], values: &[Value]) -> NamedValues {
    fields
        .iter()
        .zip(values)
        .map(|(f, v)| (f.name.clone(), *v))
        .collect()
}
fn select_strategy(m: &Module, caps: &[Capability]) -> Result<usize> {
    let mut winner: Option<(usize, i32)> = None;
    let mut ambiguous = false;
    for (i, s) in m.strategies.iter().enumerate() {
        if !eval_query(&s.query, caps)? {
            continue;
        }
        match winner {
            None => {
                winner = Some((i, s.priority));
                ambiguous = false
            }
            Some((_, p)) if s.priority > p => {
                winner = Some((i, s.priority));
                ambiguous = false
            }
            Some((_, p)) if s.priority == p => ambiguous = true,
            _ => {}
        }
    }
    if ambiguous {
        return Err(Error::new("ambiguous winning device strategies"));
    }
    winner
        .map(|x| x.0)
        .ok_or_else(|| Error::new("no device strategy matches capabilities"))
}
fn trace_names(constraint: &Constraint) -> Vec<String> {
    constraint
        .names
        .iter()
        .take(SAFETY_TRACE_MAX_NAMES)
        .cloned()
        .collect()
}

fn trace_values(values: &NamedValues, names: &[String]) -> NamedValues {
    names
        .iter()
        .filter_map(|name| values.get(name).map(|value| (name.clone(), *value)))
        .collect()
}

fn constraint_kind(constraint: &Constraint) -> &'static str {
    match constraint.kind {
        1 => "requires",
        3 => "requires-any",
        _ => "mutex",
    }
}

fn constraint_blocked(values: &NamedValues, constraint: &Constraint) -> Vec<String> {
    let on = |name: &String| matches!(values.get(name), Some(Value::Bool(true)));
    if constraint.kind == 1 || constraint.kind == 3 {
        if on(&constraint.names[0]) && !constraint.names[1..].iter().any(on) {
            return vec![constraint.names[0].clone()];
        }
    } else if constraint.names.iter().filter(|name| on(name)).count() > 1 {
        return constraint
            .names
            .iter()
            .filter(|name| on(name))
            .cloned()
            .collect();
    }
    vec![]
}

fn apply_safety(
    mut values: NamedValues,
    constraints: &[Constraint],
) -> (NamedValues, Vec<String>, SafetyTrace) {
    let mut faults = BTreeSet::new();
    let mut trace = SafetyTrace {
        constraints: constraints
            .iter()
            .take(SAFETY_TRACE_MAX_CONSTRAINTS)
            .enumerate()
            .map(|(index, constraint)| {
                let names = trace_names(constraint);
                SafetyTraceConstraint {
                    index,
                    kind: constraint_kind(constraint),
                    names: names.clone(),
                    first_violation: None,
                    final_evaluation: SafetyTraceFinal {
                        round: 0,
                        values: trace_values(&values, &names),
                        satisfied: false,
                    },
                }
            })
            .collect(),
    };
    // Every round reads one candidate snapshot. Only true -> false is possible.
    for round in 0..=values.len() {
        let mut blocked = BTreeSet::new();
        for (index, c) in constraints.iter().enumerate() {
            let rule_blocked = constraint_blocked(&values, c);
            if let Some(record) = trace.constraints.get_mut(index) {
                if !rule_blocked.is_empty() && record.first_violation.is_none() {
                    record.first_violation = Some(SafetyTraceViolation {
                        round,
                        values: trace_values(&values, &record.names),
                        blocked: rule_blocked
                            .iter()
                            .filter(|name| record.names.contains(name))
                            .cloned()
                            .collect(),
                    });
                }
            }
            if c.kind == 1 || c.kind == 3 {
                if !rule_blocked.is_empty() {
                    blocked.insert(c.names[0].clone());
                    faults.insert(format!(
                        "requires:{}:{}",
                        c.names[0],
                        c.names[1..].join("|")
                    ));
                }
            } else if !rule_blocked.is_empty() {
                blocked.extend(rule_blocked);
                faults.insert(format!("mutex:{}", c.names.join(",")));
            }
        }
        if blocked.is_empty() {
            for (index, c) in constraints
                .iter()
                .enumerate()
                .take(SAFETY_TRACE_MAX_CONSTRAINTS)
            {
                let record = &mut trace.constraints[index];
                record.final_evaluation = SafetyTraceFinal {
                    round,
                    values: trace_values(&values, &record.names),
                    satisfied: constraint_blocked(&values, c).is_empty(),
                };
            }
            break;
        }
        for name in blocked {
            values.insert(name, Value::Bool(false));
        }
    }
    (values, faults.into_iter().collect(), trace)
}

fn verify_expression(
    code: &[u8],
    inputs: &[Field],
    states: &[Field],
    allow_next: bool,
) -> Result<Type> {
    let mut r = Reader::new(code);
    let mut stack: [Option<Type>; MAX_STACK] = [None; MAX_STACK];
    let mut len = 0;
    while !r.finished() {
        match r.u8()? {
            1 => {
                if r.u8()? > 1 {
                    return Err(Error::new("invalid bool"));
                }
                type_push(&mut stack, &mut len, Type::Bool)?
            }
            2 => {
                r.f64()?;
                type_push(&mut stack, &mut len, Type::Number)?
            }
            op @ 3..=5 => {
                let i = r.u16()? as usize;
                if op == 3 {
                    type_push(
                        &mut stack,
                        &mut len,
                        inputs
                            .get(i)
                            .ok_or_else(|| Error::new("input range"))?
                            .value_type,
                    )?
                } else {
                    if op == 5 && !allow_next {
                        return Err(Error::new("next outside intent"));
                    }
                    type_push(
                        &mut stack,
                        &mut len,
                        states
                            .get(i)
                            .ok_or_else(|| Error::new("state range"))?
                            .value_type,
                    )?
                }
            }
            10 => {
                if type_pop(&mut stack, &mut len)? != Type::Bool {
                    return Err(Error::new("not type"));
                }
                type_push(&mut stack, &mut len, Type::Bool)?
            }
            op @ 11..=17 => {
                let b = type_pop(&mut stack, &mut len)?;
                let a = type_pop(&mut stack, &mut len)?;
                if op == 11 || op == 12 {
                    if a != Type::Bool || b != Type::Bool {
                        return Err(Error::new("bool operands"));
                    }
                } else if op == 13 {
                    if a != b {
                        return Err(Error::new("eq types"));
                    }
                } else if a != b || !matches!(a, Type::Number | Type::Int) {
                    return Err(Error::new("numeric operands"));
                }
                type_push(&mut stack, &mut len, Type::Bool)?
            }
            18 => {
                let no = type_pop(&mut stack, &mut len)?;
                let yes = type_pop(&mut stack, &mut len)?;
                if type_pop(&mut stack, &mut len)? != Type::Bool || yes != no {
                    return Err(Error::new("if types"));
                }
                type_push(&mut stack, &mut len, yes)?
            }
            19..=22 => {
                let right = type_pop(&mut stack, &mut len)?;
                let left = type_pop(&mut stack, &mut len)?;
                if left != Type::Number || right != Type::Number {
                    return Err(Error::new("arithmetic expects numbers"));
                }
                type_push(&mut stack, &mut len, Type::Number)?;
            }
            23 => {
                r.i32()?;
                type_push(&mut stack, &mut len, Type::Int)?
            }
            24 => {
                if type_pop(&mut stack, &mut len)? != Type::Int {
                    return Err(Error::new("integer negation expects Int"));
                }
                type_push(&mut stack, &mut len, Type::Int)?
            }
            25..=29 => {
                let right = type_pop(&mut stack, &mut len)?;
                let left = type_pop(&mut stack, &mut len)?;
                if left != Type::Int || right != Type::Int {
                    return Err(Error::new("integer arithmetic expects Int operands"));
                }
                type_push(&mut stack, &mut len, Type::Int)?;
            }
            _ => return Err(Error::new("unknown expression opcode")),
        }
    }
    if len != 1 {
        return Err(Error::new("expression result count"));
    }
    Ok(stack[0].unwrap())
}
fn type_push(s: &mut [Option<Type>; MAX_STACK], n: &mut usize, v: Type) -> Result<()> {
    if *n >= MAX_STACK {
        return Err(Error::new("stack limit"));
    }
    s[*n] = Some(v);
    *n += 1;
    Ok(())
}
fn type_pop(s: &mut [Option<Type>; MAX_STACK], n: &mut usize) -> Result<Type> {
    if *n == 0 {
        return Err(Error::new("stack underflow"));
    }
    *n -= 1;
    Ok(s[*n].take().unwrap())
}
fn eval_expression(
    code: &[u8],
    inputs: &[Value],
    state: &[Value],
    next: Option<&[Value]>,
) -> Result<Value> {
    let mut r = Reader::new(code);
    let mut s = [Value::Bool(false); MAX_STACK];
    let mut n = 0;
    while !r.finished() {
        match r.u8()? {
            1 => {
                let b = r.u8()?;
                value_push(&mut s, &mut n, Value::Bool(b != 0))?
            }
            2 => {
                let v = r.f64()?;
                value_push(&mut s, &mut n, Value::Number(v))?
            }
            3 => {
                let i = r.u16()? as usize;
                value_push(
                    &mut s,
                    &mut n,
                    *inputs.get(i).ok_or_else(|| Error::new("input range"))?,
                )?
            }
            4 => {
                let i = r.u16()? as usize;
                value_push(
                    &mut s,
                    &mut n,
                    *state.get(i).ok_or_else(|| Error::new("state range"))?,
                )?
            }
            5 => {
                let i = r.u16()? as usize;
                value_push(
                    &mut s,
                    &mut n,
                    *next
                        .and_then(|x| x.get(i))
                        .ok_or_else(|| Error::new("next range"))?,
                )?
            }
            10 => {
                let Value::Bool(a) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("not type"));
                };
                value_push(&mut s, &mut n, Value::Bool(!a))?
            }
            op @ 11..=17 => {
                let b = value_pop(&s, &mut n)?;
                let a = value_pop(&s, &mut n)?;
                let v = match (op, a, b) {
                    (11, Value::Bool(x), Value::Bool(y)) => Value::Bool(x && y),
                    (12, Value::Bool(x), Value::Bool(y)) => Value::Bool(x || y),
                    (13, x, y) => Value::Bool(x == y),
                    (14, Value::Number(x), Value::Number(y)) => Value::Bool(x < y),
                    (15, Value::Number(x), Value::Number(y)) => Value::Bool(x <= y),
                    (16, Value::Number(x), Value::Number(y)) => Value::Bool(x > y),
                    (17, Value::Number(x), Value::Number(y)) => Value::Bool(x >= y),
                    (14, Value::Int(x), Value::Int(y)) => Value::Bool(x < y),
                    (15, Value::Int(x), Value::Int(y)) => Value::Bool(x <= y),
                    (16, Value::Int(x), Value::Int(y)) => Value::Bool(x > y),
                    (17, Value::Int(x), Value::Int(y)) => Value::Bool(x >= y),
                    _ => return Err(Error::new("binary types")),
                };
                value_push(&mut s, &mut n, v)?
            }
            18 => {
                let no = value_pop(&s, &mut n)?;
                let yes = value_pop(&s, &mut n)?;
                let Value::Bool(c) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("if condition"));
                };
                value_push(&mut s, &mut n, if c { yes } else { no })?
            }
            op @ 19..=22 => {
                let right = value_pop(&s, &mut n)?;
                let left = value_pop(&s, &mut n)?;
                let (Value::Number(left), Value::Number(right)) = (left, right) else {
                    return Err(Error::new("arithmetic expects numbers"));
                };
                if op == 22 && right == 0.0 {
                    return Err(Error::new("division by zero"));
                }
                let value = match op {
                    19 => left + right,
                    20 => left - right,
                    21 => left * right,
                    22 => left / right,
                    _ => unreachable!(),
                };
                if !value.is_finite() {
                    return Err(Error::new("non-finite arithmetic result"));
                }
                value_push(&mut s, &mut n, Value::Number(value))?;
            }
            23 => {
                let value = r.i32()?;
                value_push(&mut s, &mut n, Value::Int(value))?;
            }
            24 => {
                let Value::Int(value) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("integer negation expects Int"));
                };
                let value = value
                    .checked_neg()
                    .ok_or_else(|| Error::new("integer-overflow"))?;
                value_push(&mut s, &mut n, Value::Int(value))?;
            }
            op @ 25..=29 => {
                let right = value_pop(&s, &mut n)?;
                let left = value_pop(&s, &mut n)?;
                let (Value::Int(left), Value::Int(right)) = (left, right) else {
                    return Err(Error::new("integer arithmetic expects Int operands"));
                };
                if matches!(op, 28 | 29) && right == 0 {
                    return Err(Error::new("integer-division-by-zero"));
                }
                let value = match op {
                    25 => left.checked_add(right),
                    26 => left.checked_sub(right),
                    27 => left.checked_mul(right),
                    28 => left.checked_div(right),
                    29 => left.checked_rem(right),
                    _ => unreachable!(),
                }
                .ok_or_else(|| Error::new("integer-overflow"))?;
                value_push(&mut s, &mut n, Value::Int(value))?;
            }
            _ => return Err(Error::new("unknown expression opcode")),
        }
    }
    if n != 1 {
        return Err(Error::new("expression result count"));
    }
    Ok(s[0])
}
fn value_push(s: &mut [Value; MAX_STACK], n: &mut usize, v: Value) -> Result<()> {
    if *n >= MAX_STACK {
        return Err(Error::new("stack limit"));
    }
    s[*n] = v;
    *n += 1;
    Ok(())
}
fn value_pop(s: &[Value; MAX_STACK], n: &mut usize) -> Result<Value> {
    if *n == 0 {
        return Err(Error::new("stack underflow"));
    }
    *n -= 1;
    Ok(s[*n])
}
fn verify_query(code: &[u8]) -> Result<()> {
    eval_query(code, &[]).map(|_| ())
}
fn eval_query(code: &[u8], caps: &[Capability]) -> Result<bool> {
    let mut r = Reader::new(code);
    let mut s = [false; MAX_STACK];
    let mut n = 0;
    while !r.finished() {
        match r.u8()? {
            1 => {
                let kind = r.string()?;
                let name = r.string()?;
                let ty = Type::from_byte(r.u8()?)?;
                if n >= MAX_STACK {
                    return Err(Error::new("query stack"));
                }
                s[n] = caps
                    .iter()
                    .any(|c| c.kind == kind && c.name == name && c.value_type == ty);
                n += 1
            }
            op @ 2..=3 => {
                let count = r.u16()? as usize;
                if count == 0 || count > n {
                    return Err(Error::new("query group"));
                }
                let start = n - count;
                let value = if op == 2 {
                    s[start..n].iter().all(|x| *x)
                } else {
                    s[start..n].iter().any(|x| *x)
                };
                n = start;
                s[n] = value;
                n += 1
            }
            4 => {
                if n == 0 {
                    return Err(Error::new("query underflow"));
                }
                s[n - 1] = !s[n - 1]
            }
            5 => {
                let value = r.u8()?;
                if value > 1 || n >= MAX_STACK {
                    return Err(Error::new("invalid query bool or stack limit"));
                }
                s[n] = value == 1;
                n += 1;
            }
            _ => return Err(Error::new("query opcode")),
        }
    }
    if n != 1 {
        return Err(Error::new("query result count"));
    }
    Ok(s[0])
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    fn finished(&self) -> bool {
        self.at == self.bytes.len()
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(n)
            .filter(|e| *e <= self.bytes.len())
            .ok_or_else(|| Error::new("truncated bytecode"))?;
        let out = &self.bytes[self.at..end];
        self.at = end;
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn f64(&mut self) -> Result<f64> {
        let v = f64::from_le_bytes(self.take(8)?.try_into().unwrap());
        if !v.is_finite() {
            return Err(Error::new("non-finite number"));
        }
        Ok(v)
    }
    fn string(&mut self) -> Result<String> {
        let n = self.u16()? as usize;
        if n == 0 || n > 128 {
            return Err(Error::new("identifier byte limit"));
        }
        String::from_utf8(self.take(n)?.to_vec()).map_err(|_| Error::new("invalid UTF-8"))
    }
    fn blob(&mut self) -> Result<Vec<u8>> {
        let n = self.u32()? as usize;
        if n > MAX_EXPR_BYTES {
            return Err(Error::new("expression byte limit"));
        }
        Ok(self.take(n)?.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn expression_int(value: i32) -> Vec<u8> {
        let mut code = vec![23];
        code.extend(value.to_le_bytes());
        code
    }
    fn expression_ints(left: i32, right: i32, opcode: u8) -> Vec<u8> {
        let mut code = expression_int(left);
        code.extend(expression_int(right));
        code.push(opcode);
        code
    }
    fn int_atomicity_module(second_default: i32, second_opcode: u8) -> Module {
        let mut first_transition = vec![4, 0, 0];
        first_transition.extend(expression_int(1));
        first_transition.push(25);
        let second_transition = vec![4, 1, 0, 3, 0, 0, second_opcode];
        Module {
            fingerprint: 85,
            name: "int-atomicity".into(),
            version: 1,
            inputs: vec![Field {
                name: "rhs".into(),
                value_type: Type::Int,
                default: Value::Int(0),
            }],
            states: vec![
                Field {
                    name: "first".into(),
                    value_type: Type::Int,
                    default: Value::Int(10),
                },
                Field {
                    name: "second".into(),
                    value_type: Type::Int,
                    default: Value::Int(second_default),
                },
            ],
            strategies: vec![Strategy {
                name: "control".into(),
                priority: 0,
                query: vec![5, 1],
                transitions: vec![
                    Transition {
                        state_index: 0,
                        expression: first_transition,
                    },
                    Transition {
                        state_index: 1,
                        expression: second_transition,
                    },
                ],
                intents: vec![Intent {
                    name: "first".into(),
                    value_type: Type::Int,
                    expression: vec![5, 0, 0],
                }],
            }],
            constraints: vec![],
        }
    }
    #[test]
    fn int_arithmetic_is_exact_with_signed_division_and_remainder() {
        for (opcode, left, right, expected) in [
            (25, 2, 3, 5),
            (26, 2, 3, -1),
            (27, 46_340, 46_340, 2_147_395_600),
            (28, 7, 3, 2),
            (28, -7, 3, -2),
            (28, 7, -3, -2),
            (28, -7, -3, 2),
            (29, 7, 3, 1),
            (29, -7, 3, -1),
        ] {
            let code = expression_ints(left, right, opcode);
            assert_eq!(
                verify_expression(&code, &[], &[], false).unwrap(),
                Type::Int
            );
            assert_eq!(
                eval_expression(&code, &[], &[], None).unwrap(),
                Value::Int(expected)
            );
        }
    }
    #[test]
    fn int_negation_and_comparison_preserve_i32_semantics() {
        let mut negation = expression_int(-7);
        negation.push(24);
        assert_eq!(
            eval_expression(&negation, &[], &[], None).unwrap(),
            Value::Int(7)
        );
        for (opcode, expected) in [(14, true), (15, true), (16, false), (17, false)] {
            assert_eq!(
                eval_expression(&expression_ints(-2, 1, opcode), &[], &[], None).unwrap(),
                Value::Bool(expected)
            );
        }
    }
    #[test]
    fn int_faults_have_stable_reasons() {
        for (code, reason) in [
            (expression_ints(i32::MAX, 1, 25), "integer-overflow"),
            (expression_ints(i32::MIN, 1, 26), "integer-overflow"),
            (expression_ints(46_341, 46_341, 27), "integer-overflow"),
            (expression_ints(i32::MIN, -1, 28), "integer-overflow"),
            (expression_ints(1, 0, 28), "integer-division-by-zero"),
            (expression_ints(1, 0, 29), "integer-division-by-zero"),
        ] {
            assert_eq!(
                eval_expression(&code, &[], &[], None)
                    .unwrap_err()
                    .message(),
                reason
            );
        }
        let mut negation = expression_int(i32::MIN);
        negation.push(24);
        assert_eq!(
            eval_expression(&negation, &[], &[], None)
                .unwrap_err()
                .message(),
            "integer-overflow"
        );
    }
    #[test]
    fn int_overflow_rejects_tick_before_state_intent_or_journal_commit() {
        let mut runtime = Runtime::new(4);
        runtime.install(int_atomicity_module(i32::MAX, 25), false);
        runtime.activate().unwrap();
        runtime.set_input("rhs", Value::Int(0)).unwrap();
        runtime.tick().unwrap();
        assert_eq!(runtime.state("first"), Some(Value::Int(11)));
        assert_eq!(runtime.intent("first"), Some(Value::Int(11)));
        assert_eq!(runtime.journal().len(), 1);

        runtime.set_input("rhs", Value::Int(1)).unwrap();
        assert_eq!(runtime.tick().unwrap_err().message(), "integer-overflow");
        assert_eq!(runtime.state("first"), Some(Value::Int(11)));
        assert_eq!(runtime.intent("first"), Some(Value::Int(11)));
        assert_eq!(runtime.journal().len(), 1);
    }
    #[test]
    fn int_division_by_zero_rejects_tick_before_state_intent_or_journal_commit() {
        let mut runtime = Runtime::new(4);
        runtime.install(int_atomicity_module(12, 28), false);
        runtime.activate().unwrap();
        runtime.set_input("rhs", Value::Int(3)).unwrap();
        runtime.tick().unwrap();
        assert_eq!(runtime.state("first"), Some(Value::Int(11)));
        assert_eq!(runtime.state("second"), Some(Value::Int(4)));

        runtime.set_input("rhs", Value::Int(0)).unwrap();
        assert_eq!(
            runtime.tick().unwrap_err().message(),
            "integer-division-by-zero"
        );
        assert_eq!(runtime.state("first"), Some(Value::Int(11)));
        assert_eq!(runtime.state("second"), Some(Value::Int(4)));
        assert_eq!(runtime.intent("first"), Some(Value::Int(11)));
        assert_eq!(runtime.journal().len(), 1);
    }
    fn expression_numbers(left: f64, right: f64, opcode: u8) -> Vec<u8> {
        let mut code = vec![2];
        code.extend(left.to_le_bytes());
        code.push(2);
        code.extend(right.to_le_bytes());
        code.push(opcode);
        code
    }
    #[test]
    fn arithmetic_is_verified_and_rejects_nonfinite_results() {
        for (opcode, expected) in [(19, 9.0), (20, 3.0), (21, 18.0), (22, 2.0)] {
            let code = expression_numbers(6.0, 3.0, opcode);
            assert_eq!(
                verify_expression(&code, &[], &[], false).unwrap(),
                Type::Number
            );
            assert_eq!(
                eval_expression(&code, &[], &[], None).unwrap(),
                Value::Number(expected)
            );
        }
        assert!(eval_expression(&expression_numbers(1.0, 0.0, 22), &[], &[], None).is_err());
        assert!(eval_expression(&expression_numbers(f64::MAX, 2.0, 21), &[], &[], None).is_err());
        assert!(verify_expression(&[1, 1, 1, 0, 19], &[], &[], false).is_err());
        assert!(verify_expression(&[19], &[], &[], false).is_err());
    }
    #[test]
    fn safety_rechecks_or_after_mutex_regardless_of_source_order() {
        let initial: NamedValues = ["pump", "a", "b"]
            .into_iter()
            .map(|name| (name.into(), Value::Bool(true)))
            .collect();
        let mut rules = vec![
            Constraint {
                kind: 3,
                names: vec!["pump".into(), "a".into(), "b".into()],
            },
            Constraint {
                kind: 2,
                names: vec!["a".into(), "b".into()],
            },
        ];
        let (forward, faults, _) = apply_safety(initial.clone(), &rules);
        rules.reverse();
        let (reverse, _, _) = apply_safety(initial, &rules);
        assert_eq!(forward, reverse);
        assert!(forward.values().all(|value| *value == Value::Bool(false)));
        assert_eq!(faults.len(), 2);
    }
    #[test]
    fn safety_requires_chain_reaches_fixed_point() {
        let initial = [("pump", true), ("valve", true), ("permit", false)]
            .into_iter()
            .map(|(name, value)| (name.into(), Value::Bool(value)))
            .collect();
        let rules = vec![
            Constraint {
                kind: 1,
                names: vec!["pump".into(), "valve".into()],
            },
            Constraint {
                kind: 1,
                names: vec!["valve".into(), "permit".into()],
            },
        ];
        assert_eq!(apply_safety(initial, &rules).0["pump"], Value::Bool(false));
    }
    #[test]
    fn safety_trace_records_first_pass_block_and_final_no_block_round() {
        let initial = [("pump", true), ("permit", false)]
            .into_iter()
            .map(|(name, value)| (name.into(), Value::Bool(value)))
            .collect();
        let rules = vec![Constraint {
            kind: 1,
            names: vec!["pump".into(), "permit".into()],
        }];
        let (safe, _, trace) = apply_safety(initial, &rules);
        let rule = &trace.constraints[0];
        let first = rule.first_violation.as_ref().unwrap();
        assert_eq!(safe["pump"], Value::Bool(false));
        assert_eq!(first.round, 0);
        assert_eq!(first.values["pump"], Value::Bool(true));
        assert_eq!(first.blocked, vec!["pump"]);
        assert_eq!(rule.final_evaluation.round, 1);
        assert_eq!(rule.final_evaluation.values["pump"], Value::Bool(false));
        assert!(rule.final_evaluation.satisfied);
        let encoded = TickRecord {
            module_fingerprint: 0,
            tick: 1,
            strategy: "test".into(),
            inputs: BTreeMap::new(),
            state_before: BTreeMap::new(),
            state_after: BTreeMap::new(),
            requested_intents: BTreeMap::new(),
            safe_intents: safe,
            faults: vec![],
            safety_trace: trace,
        }
        .to_json();
        assert!(encoded.contains("\"format\":\"GhostFlow/safety-trace-v1\""));
        assert!(encoded.contains("\"firstViolation\":{\"round\":0"));
    }
    #[test]
    fn safety_trace_records_cascaded_requires_in_later_round() {
        let initial = [("pump", true), ("valve", true), ("permit", false)]
            .into_iter()
            .map(|(name, value)| (name.into(), Value::Bool(value)))
            .collect();
        let rules = vec![
            Constraint {
                kind: 1,
                names: vec!["pump".into(), "valve".into()],
            },
            Constraint {
                kind: 1,
                names: vec!["valve".into(), "permit".into()],
            },
        ];
        let (_, _, trace) = apply_safety(initial, &rules);
        assert_eq!(
            trace.constraints[0].first_violation.as_ref().unwrap().round,
            1
        );
        assert_eq!(
            trace.constraints[1].first_violation.as_ref().unwrap().round,
            0
        );
        assert_eq!(trace.constraints[0].final_evaluation.round, 2);
        assert!(trace
            .constraints
            .iter()
            .all(|rule| rule.final_evaluation.satisfied));
    }
    #[test]
    fn safety_trace_records_mutex_and_satisfied_false_target() {
        let mutex_initial = [("a", true), ("b", true)]
            .into_iter()
            .map(|(name, value)| (name.into(), Value::Bool(value)))
            .collect();
        let mutex = vec![Constraint {
            kind: 2,
            names: vec!["a".into(), "b".into()],
        }];
        let (_, _, mutex_trace) = apply_safety(mutex_initial, &mutex);
        let mutex_rule = &mutex_trace.constraints[0];
        assert_eq!(mutex_rule.kind, "mutex");
        assert_eq!(
            mutex_rule.first_violation.as_ref().unwrap().blocked,
            vec!["a", "b"]
        );
        assert_eq!(mutex_rule.final_evaluation.round, 1);

        let false_target = [("pump", false), ("permit", false)]
            .into_iter()
            .map(|(name, value)| (name.into(), Value::Bool(value)))
            .collect();
        let requires = vec![Constraint {
            kind: 1,
            names: vec!["pump".into(), "permit".into()],
        }];
        let (_, _, trace) = apply_safety(false_target, &requires);
        assert!(trace.constraints[0].first_violation.is_none());
        assert_eq!(trace.constraints[0].final_evaluation.round, 0);
        assert_eq!(
            trace.constraints[0].final_evaluation.values["pump"],
            Value::Bool(false)
        );
        assert!(trace.constraints[0].final_evaluation.satisfied);
    }
    #[test]
    fn safety_trace_bounds_one_snapshot_pair_per_rule() {
        let initial = (0..33)
            .map(|index| (format!("v{index}"), Value::Bool(false)))
            .collect();
        let names = (0..33).map(|index| format!("v{index}")).collect::<Vec<_>>();
        let rules = (0..129)
            .map(|_| Constraint {
                kind: 2,
                names: names.clone(),
            })
            .collect::<Vec<_>>();
        let (_, _, trace) = apply_safety(initial, &rules);
        assert_eq!(trace.constraints.len(), 128);
        assert!(trace.constraints.iter().all(|rule| rule.names.len() == 32));
        assert!(trace
            .constraints
            .iter()
            .all(|rule| rule.first_violation.is_none()));
        assert!(trace
            .constraints
            .iter()
            .all(|rule| rule.final_evaluation.values.len() == 32));
    }
    #[test]
    fn constant_query_and_bounds_are_verified() {
        assert!(eval_query(&[5, 1], &[]).unwrap());
        assert!(!eval_query(&[5, 0], &[]).unwrap());
        assert!(verify_query(&[5, 2]).is_err());
        assert!(verify_query(&[5]).is_err());
        assert!(Module::load(&vec![0; MAX_MODULE_BYTES + 1]).is_err());
    }
    #[test]
    fn loader_rejects_every_truncation_and_never_panics_on_single_byte_corruption() {
        for end in 0..MODULE.len() {
            assert!(
                Module::load(&MODULE[..end]).is_err(),
                "accepted truncation at {end}"
            );
        }
        for index in 0..MODULE.len() {
            for replacement in [0, 0xff] {
                let mut changed = MODULE.to_vec();
                changed[index] = replacement;
                // Some mutations are valid alternate programs. This corpus tests
                // total/bounded decoding, not authenticity or semantic identity.
                assert!(std::panic::catch_unwind(|| Module::load(&changed)).is_ok());
            }
        }
    }
    #[test]
    fn failed_hot_swap_preserves_original_program_state() {
        let module = Module::load(MODULE).unwrap();
        let mut runtime = Runtime::new(16);
        runtime.install(module.clone(), false);
        for name in ["pump", "valve"] {
            runtime
                .add_capability(Capability::new("actuator", name, Type::Bool))
                .unwrap();
        }
        runtime.activate().unwrap();
        submit(&mut runtime, true, false, false, 90.0);
        runtime.tick().unwrap();
        assert_eq!(runtime.intent("pump"), Some(Value::Bool(true)));
        let mut bad = module.clone();
        bad.states[0].value_type = Type::Number;
        bad.states[0].default = Value::Number(0.0);
        assert!(runtime.hot_swap(bad).is_err());
        assert_eq!(runtime.state("watering"), Some(Value::Bool(true)));
        assert_eq!(runtime.intent("pump"), Some(Value::Bool(true)));
        let mut renamed = module;
        renamed.name = "another".into();
        assert!(runtime.hot_swap(renamed).is_err());
        assert_eq!(runtime.intent("pump"), Some(Value::Bool(true)));
    }
    #[test]
    fn output_intents_exist_only_after_a_successful_tick_and_reset_at_hot_swap() {
        let module = Module::load(MODULE).unwrap();
        let mut runtime = Runtime::new(16);
        runtime.install(module.clone(), false);
        for name in ["pump", "valve"] {
            runtime
                .add_capability(Capability::new("actuator", name, Type::Bool))
                .unwrap();
        }

        // Installation and activation select code but do not invent an output
        // intent. The host/driver owns its physical safe state until a complete
        // input snapshot commits the first tick.
        assert_eq!(runtime.intent("pump"), None);
        runtime.activate().unwrap();
        assert_eq!(runtime.intent("pump"), None);
        assert!(runtime.tick().is_err());
        assert_eq!(runtime.intent("pump"), None);
        assert!(runtime.journal().is_empty());

        submit(&mut runtime, true, false, false, 90.0);
        runtime.tick().unwrap();
        assert_eq!(runtime.intent("pump"), Some(Value::Bool(true)));
        assert_eq!(runtime.journal().len(), 1);

        // A missing next snapshot is atomic and retains the last committed VM
        // intent. A successful module replacement instead clears it, requiring
        // the host to hold safe output until the replacement's first tick.
        assert!(runtime.tick().is_err());
        assert_eq!(runtime.intent("pump"), Some(Value::Bool(true)));
        assert_eq!(runtime.journal().len(), 1);
        runtime.hot_swap(module).unwrap();
        assert_eq!(runtime.intent("pump"), None);
        assert!(runtime.tick().is_err());
        assert_eq!(runtime.intent("pump"), None);

        submit(&mut runtime, true, false, false, 90.0);
        runtime.tick().unwrap();
        assert_eq!(runtime.intent("pump"), Some(Value::Bool(true)));
    }
    #[test]
    fn monotonic_input_failure_is_atomic() {
        let mut module = Module::load(MODULE).unwrap();
        module.inputs.push(Field {
            name: "__gf_now_ms".into(),
            value_type: Type::Number,
            default: Value::Number(0.0),
        });
        let mut runtime = Runtime::new(8);
        runtime.install(module, false);
        for name in ["pump", "valve"] {
            runtime
                .add_capability(Capability::new("actuator", name, Type::Bool))
                .unwrap();
        }
        runtime.activate().unwrap();
        submit(&mut runtime, true, false, false, 90.0);
        runtime.tick_at(100).unwrap();
        submit(&mut runtime, false, true, false, 90.0);
        assert!(runtime.tick_at(99).is_err());
        assert_eq!(runtime.state("watering"), Some(Value::Bool(true)));
        assert_eq!(runtime.journal().len(), 1);
        runtime.tick_at(101).unwrap();
        assert_eq!(runtime.state("watering"), Some(Value::Bool(false)));
    }
    const MODULE: &[u8] = include_bytes!("../../../build/irrigation.gfb");
    fn submit(r: &mut Runtime, a: bool, b: bool, c: bool, d: f64) {
        r.set_input("start", Value::Bool(a)).unwrap();
        r.set_input("stop", Value::Bool(b)).unwrap();
        r.set_input("low_water", Value::Bool(c)).unwrap();
        r.set_input("moisture", Value::Number(d)).unwrap();
    }
    #[test]
    fn device_query_replay_and_hot_swap() {
        let module = Module::load(MODULE).unwrap();
        let mut r = Runtime::new(16);
        r.install(module.clone(), false);
        r.add_capability(Capability::new("actuator", "pump", Type::Bool))
            .unwrap();
        r.add_capability(Capability::new("actuator", "valve", Type::Bool))
            .unwrap();
        r.activate().unwrap();
        assert_eq!(r.active_strategy(), Some("control"));
        submit(&mut r, true, false, false, 99.0);
        r.tick().unwrap();
        submit(&mut r, false, false, false, 99.0);
        r.tick().unwrap();
        assert_eq!(r.intent("pump"), Some(Value::Bool(true)));
        r.hot_swap(module.clone()).unwrap();
        assert_eq!(r.state("watering"), Some(Value::Bool(true)));
        r.rewind(1).unwrap();
        let caps = [
            Capability::new("actuator", "pump", Type::Bool),
            Capability::new("actuator", "valve", Type::Bool),
            Capability::new("sensor", "moisture", Type::Number),
        ];
        let ghost = r.replay(module, &caps, 1).unwrap();
        assert_eq!(ghost[0].strategy, "control");
    }
}
