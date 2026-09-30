use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;

pub mod accounting;
pub mod after_event;
pub mod context_runtime;
#[cfg(test)]
mod context_runtime_tests;
pub mod context_schedule;
pub mod context_vm;
pub mod controller;
pub mod cron_schedule;
pub mod daily_slots;
pub mod estimate_evidence;
pub mod keyboard;
pub mod natural_context;
pub mod objective_vm;
pub mod range_schedule;
pub mod resource_policy;
pub mod scan;
pub mod schedule_clock;
pub mod schedule_vm;
pub mod settings_stream;
pub mod signals;
pub mod solar;
pub mod solar_admission;
pub mod solar_runtime;
pub mod station;
pub mod temporal;
pub mod temporal_evidence;
pub mod temporal_runtime;
pub mod temporal_vm;
mod trace_json;
pub mod true_for;
pub mod true_for_runtime;
pub mod true_for_vm;
pub mod work_calendar;

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
    fn from_byte(value: u8, format_version: u16) -> Result<Self> {
        match value {
            1 => Ok(Self::Bool),
            2 => Ok(Self::Number),
            3 if matches!(format_version, 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) => {
                Ok(Self::Int)
            }
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
    result_trace_bound: usize,
}
#[derive(Clone)]
struct Constraint {
    kind: u8,
    names: Vec<String>,
}

#[derive(Clone)]
pub struct Module {
    fingerprint: u64,
    format_version: u16,
    name: String,
    version: u32,
    inputs: Vec<Field>,
    states: Vec<Field>,
    strategies: Vec<Strategy>,
    constraints: Vec<Constraint>,
    temporal: Option<temporal_vm::TemporalRequirements>,
    schedules: Option<schedule_vm::ScheduleRequirements>,
    true_fors: Option<true_for_vm::TrueForRequirements>,
    objective: Option<objective_vm::ObjectiveDescriptor>,
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
        let format_version = reader.u16()?;
        if !matches!(
            format_version,
            1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
        ) {
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
            let value_type = Type::from_byte(reader.u8()?, format_version)?;
            let default = match value_type {
                Type::Bool => Value::Bool(false),
                Type::Number => Value::Number(0.0),
                Type::Int => Value::Int(0),
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
            let value_type = Type::from_byte(reader.u8()?, format_version)?;
            let default = match value_type {
                Type::Bool => match reader.u8()? {
                    0 => Value::Bool(false),
                    1 => Value::Bool(true),
                    _ => return Err(Error::new("invalid bool default")),
                },
                Type::Number => Value::Number(reader.f64()?),
                Type::Int => Value::Int(reader.i32()?),
            };
            states.push(Field {
                name,
                value_type,
                default,
            });
        }

        let mut temporal = if matches!(format_version, 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12) {
            Some(temporal_vm::TemporalRequirements::load_header(
                &mut reader,
                &inputs,
                format_version >= 5,
            )?)
        } else {
            None
        };
        let mut schedules = matches!(format_version, 5 | 6 | 8 | 9 | 10 | 11 | 12).then(|| {
            schedule_vm::ScheduleRequirements {
                strategies: Vec::new(),
            }
        });
        let mut true_fors = (format_version == 6).then(|| true_for_vm::TrueForRequirements {
            strategies: Vec::new(),
        });
        let strategy_count = reader.u16()? as usize;
        if strategy_count == 0 || strategy_count > MAX_STRATEGIES {
            return Err(Error::new("invalid strategy count"));
        }
        let mut has_int_expression = false;
        let mut strategies = Vec::with_capacity(strategy_count);
        names.clear();
        for _ in 0..strategy_count {
            let strategy_name = reader.string()?;
            if !names.insert(strategy_name.clone()) {
                return Err(Error::new("duplicate strategy"));
            }
            let priority = reader.i32()?;
            let query = reader.blob()?;
            verify_query(&query, format_version)?;

            let (windows, schedule_count, true_for_count, mut result_trace_bound) =
                if matches!(format_version, 5 | 6 | 8 | 9 | 10 | 11 | 12) {
                    let loaded = schedule_vm::load_prelude(
                        &mut reader,
                        &inputs,
                        &states,
                        &temporal.as_ref().expect("format 5 header").roots,
                        format_version,
                    )?;
                    let schedule_count = loaded.schedules.len();
                    let true_for_count = loaded.true_fors.len();
                    if let Some(requirements) = &mut true_fors {
                        requirements.strategies.push(true_for_vm::TrueForStrategy {
                            name: strategy_name.clone(),
                            signals: loaded.true_fors,
                        });
                    }
                    schedules
                        .as_mut()
                        .expect("format 5 schedules")
                        .strategies
                        .push(schedule_vm::ScheduleStrategy {
                            name: strategy_name.clone(),
                            schedules: loaded.schedules,
                            prelude: loaded.order,
                        });
                    (
                        loaded.windows,
                        schedule_count,
                        true_for_count,
                        loaded.marker_count,
                    )
                } else if let Some(temporal) = &temporal {
                    let (windows, markers) =
                        temporal_vm::load_windows(&mut reader, &inputs, &states, &temporal.roots)?;
                    (windows, 0, 0, markers)
                } else {
                    (Vec::new(), 0, 0, 0)
                };

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
                let ty = verify_expression_with_prelude(
                    &expression,
                    &inputs,
                    &states,
                    false,
                    format_version,
                    &windows,
                    schedule_count,
                    true_for_count,
                )?;
                let (uses_int, marker_count) = expression_metadata(&expression)?;
                has_int_expression |= uses_int;
                result_trace_bound += marker_count;
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
                let value_type = Type::from_byte(reader.u8()?, format_version)?;
                let expression = reader.blob()?;
                if verify_expression_with_prelude(
                    &expression,
                    &inputs,
                    &states,
                    true,
                    format_version,
                    &windows,
                    schedule_count,
                    true_for_count,
                )? != value_type
                {
                    return Err(Error::new("intent type mismatch"));
                }
                let (uses_int, marker_count) = expression_metadata(&expression)?;
                has_int_expression |= uses_int;
                result_trace_bound += marker_count;
                intents.push(Intent {
                    name,
                    value_type,
                    expression,
                });
            }
            if let Some(temporal) = &mut temporal {
                temporal.strategies.push(temporal_vm::TemporalStrategy {
                    name: strategy_name.clone(),
                    windows,
                });
            }
            strategies.push(Strategy {
                name: strategy_name,
                priority,
                query,
                transitions,
                intents,
                result_trace_bound,
            });
        }

        if format_version == 4
            && temporal.as_ref().is_some_and(|requirements| {
                requirements
                    .strategies
                    .iter()
                    .all(|strategy| strategy.windows.is_empty())
            })
        {
            return Err(Error::new("GFB format 4 requires a window"));
        }
        if format_version == 5
            && schedules.as_ref().is_some_and(|requirements| {
                requirements
                    .strategies
                    .iter()
                    .all(|s| s.schedules.is_empty())
            })
        {
            return Err(Error::new("GFB format 5 requires a schedule"));
        }
        if format_version == 8
            && !schedules.as_ref().is_some_and(|r| {
                r.strategies.iter().any(|s| {
                    s.schedules
                        .iter()
                        .any(|d| matches!(d, schedule_vm::PulseDescriptor::Daily(_)))
                })
            })
        {
            return Err(Error::new("GFB format 8 requires a Daily schedule"));
        }
        if format_version == 9
            && !schedules.as_ref().is_some_and(|r| {
                r.strategies.iter().any(|s| {
                    s.schedules
                        .iter()
                        .any(|d| matches!(d, schedule_vm::PulseDescriptor::DailySlots(_)))
                })
            })
        {
            return Err(Error::new("GFB format 9 requires a DailySlots schedule"));
        }
        if let Some(requirements) = &true_fors {
            if requirements
                .strategies
                .iter()
                .all(|strategy| strategy.signals.is_empty())
            {
                return Err(Error::new("GFB format 6 requires true_for"));
            }
            requirements.validate_bindings(temporal.as_ref().expect("format 6 header"))?;
        }
        if format_version == 12
            && !schedules.as_ref().is_some_and(|requirements| {
                requirements.strategies.iter().any(|strategy| {
                    strategy.schedules.iter().any(|entry| {
                        matches!(
                            entry,
                            schedule_vm::PulseDescriptor::Context(context_vm::ScheduleDescriptor {
                                definition: context_vm::ScheduleDefinition::UtcRange { .. },
                                ..
                            })
                        )
                    })
                })
            })
        {
            return Err(Error::new("GFB format 12 requires UTC Range"));
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
        let has_int_type = inputs
            .iter()
            .chain(&states)
            .any(|field| field.value_type == Type::Int)
            || strategies
                .iter()
                .flat_map(|strategy| &strategy.intents)
                .any(|intent| intent.value_type == Type::Int);
        if format_version == 2 && !has_int_type && !has_int_expression {
            return Err(Error::new("unsupported GFB format 2 without Int"));
        }
        let objective_count = if matches!(format_version, 7 | 11 | 12) {
            reader.u16()?
        } else {
            0
        };
        if objective_count > 1 || format_version == 7 && objective_count != 1 {
            return Err(Error::new("invalid objective count"));
        }
        let objective = if objective_count == 1 {
            if states.len() == MAX_STATES || strategies.iter().any(|s| s.intents.len() == 128) {
                return Err(Error::new("objective resource limit exceeded"));
            }
            let descriptor = objective_vm::ObjectiveDescriptor::load(
                &mut reader,
                &inputs,
                &strategies,
                matches!(format_version, 11 | 12),
            )?;
            if matches!(format_version, 11 | 12)
                && !schedules.as_ref().is_some_and(|requirements| {
                    requirements.strategies.iter().all(|strategy| {
                        strategy.schedules.iter().any(|entry| {
                            matches!(entry, schedule_vm::PulseDescriptor::Config(config)
                        if config.semantic_type == "Temperature"
                            && config.value_input == descriptor.target_input
                            && Some(config.ok_input) == descriptor.target_ok_input)
                        })
                    })
                })
            {
                return Err(Error::new(
                    "objective target must bind a Temperature config Result",
                ));
            }
            Some(descriptor)
        } else {
            None
        };
        if !reader.finished() {
            return Err(Error::new("trailing module bytes"));
        }
        Ok(Self {
            fingerprint,
            format_version,
            name,
            version,
            inputs,
            states,
            strategies,
            constraints,
            temporal,
            schedules,
            true_fors,
            objective,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn version(&self) -> u32 {
        self.version
    }
    /// Verified requirements only. Loading does not activate or execute windows.
    pub fn temporal_requirements(&self) -> Option<&temporal_vm::TemporalRequirements> {
        self.temporal.as_ref()
    }
    /// Verified descriptors and dependency order only; activation requires schedule bindings.
    pub fn schedule_requirements(&self) -> Option<&schedule_vm::ScheduleRequirements> {
        self.schedules.as_ref()
    }
    /// Verified structure only; execution still requires certified interval bindings.
    pub fn true_for_requirements(&self) -> Option<&true_for_vm::TrueForRequirements> {
        self.true_fors.as_ref()
    }

    fn reject_unbound_schedules(&self) -> Result<()> {
        if self.true_fors.is_some() {
            return Err(Error::new("true_for activation requires runtime bindings"));
        }
        if self.schedules.as_ref().is_some_and(|requirements| {
            requirements
                .strategies
                .iter()
                .any(|strategy| !strategy.schedules.is_empty())
        }) {
            return Err(Error::new("schedule activation requires runtime bindings"));
        }
        Ok(())
    }
    pub fn input_fields(&self) -> impl Iterator<Item = (&str, Type)> {
        self.inputs
            .iter()
            .map(|field| (field.name.as_str(), field.value_type))
    }
    /// Declared state names, machine types and initial values for artifact binding checks.
    pub fn state_fields(&self) -> impl Iterator<Item = (&str, Type, Value)> {
        self.states
            .iter()
            .map(|field| (field.name.as_str(), field.value_type, field.default))
    }
    pub fn output_fields(&self) -> impl Iterator<Item = (&str, Type)> {
        self.strategies
            .iter()
            .flat_map(|strategy| strategy.intents.iter())
            .map(|intent| (intent.name.as_str(), intent.value_type))
            .chain(
                self.objective
                    .iter()
                    .map(|objective| (objective.output.as_str(), Type::Number)),
            )
    }

    pub fn objective_requirements(&self) -> Option<&objective_vm::ObjectiveDescriptor> {
        self.objective.as_ref()
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
pub struct ResultTraceEvent {
    pub site: u32,
    pub choice: u16,
    pub origin: u32,
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
    pub result_trace: Vec<ResultTraceEvent>,
    pub window_trace: Vec<temporal_runtime::WindowTrace>,
    pub true_for_trace: Vec<true_for_runtime::TrueForTrace>,
    pub schedule_trace: Vec<solar_admission::SolarStageResult>,
    pub context_trace: Vec<context_vm::Observation>,
}

impl TickRecord {
    /// Stable diagnostic encoding shared by native, WASM and bounded replay sinks.
    pub fn write_json(&self, out: &mut impl fmt::Write) -> fmt::Result {
        trace_json::record(out, self)
    }
    pub fn to_json(&self) -> String {
        let mut out = String::new();
        self.write_json(&mut out)
            .expect("String formatting cannot fail");
        out
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
    temporal: Option<temporal_runtime::TemporalRuntime>,
    true_for_runtime: Option<true_for_runtime::TrueForRuntime>,
    solar_runtime: Option<solar_runtime::SolarRuntime>,
    context_runtime: Option<context_runtime::ContextRuntime>,
    objective_runtime: Option<controller::Pid>,
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
            temporal: None,
            true_for_runtime: None,
            solar_runtime: None,
            context_runtime: None,
            objective_runtime: None,
        }
    }
    pub fn install(&mut self, module: Module, preserve_state: bool) {
        // Installation is an explicit new temporal execution session.
        if module.temporal.is_some()
            || self.temporal.is_some()
            || module.objective.is_some()
            || self.objective_runtime.is_some()
        {
            self.journal.clear();
            self.next_tick = 1;
        }
        self.temporal = None;
        self.true_for_runtime = None;
        self.solar_runtime = None;
        self.context_runtime = None;
        self.objective_runtime = None;
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
        if module.objective.is_some() || self.objective_runtime.is_some() {
            return Err(Error::new(
                "objective hot swap requires explicit controller migration",
            ));
        }
        module.reject_unbound_schedules()?;
        if let Some(previous) = &self.module {
            previous.reject_unbound_schedules()?;
        }
        if module.temporal.is_some() || self.temporal.is_some() {
            return Err(Error::new("temporal activation requires runtime bindings"));
        }
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
        self.objective_runtime = None;
        self.solar_runtime = None;
        self.true_for_runtime = None;
        if self.temporal.is_some() {
            self.journal.clear();
        }
        self.temporal = None;
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
        m.reject_unbound_schedules()?;
        if m.temporal.is_some() {
            return Err(Error::new("temporal activation requires runtime bindings"));
        }
        let selected = select_strategy(m, &self.capabilities)?;
        if let Some(objective) = &m.objective {
            if self.objective_runtime.is_some() {
                return Err(Error::new("objective is already activated"));
            }
            if !self.capabilities.iter().any(|cap| {
                cap.kind == "actuator"
                    && cap.name == objective.output
                    && cap.value_type == Type::Number
            }) {
                return Err(Error::new("objective requires numeric actuator capability"));
            }
            self.objective_runtime = Some(controller::Pid::new(objective.config)?);
        }
        self.active_strategy = Some(selected);
        Ok(())
    }
    pub fn active_strategy(&self) -> Option<&str> {
        let m = self.module.as_ref()?;
        Some(&m.strategies[self.active_strategy?].name)
    }
    /// Activate a context module with explicit provider bindings. No host-computed projections.
    pub fn activate_with_context(
        &mut self,
        activation: &context_runtime::Activation,
    ) -> Result<()> {
        if self.active_strategy.is_some()
            || self.solar_runtime.is_some()
            || self.context_runtime.is_some()
            || self.temporal.is_some()
            || self.true_for_runtime.is_some()
        {
            return Err(Error::new("context session is already activated"));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        if !matches!(module.format_version, 10 | 11 | 12) {
            return Err(Error::new(
                "context activation requires GFB10, GFB11 or GFB12",
            ));
        }
        if module
            .temporal
            .as_ref()
            .is_some_and(|r| r.strategies.iter().any(|s| !s.windows.is_empty()))
        {
            return Err(Error::new(
                "context and interval window preludes cannot be mixed",
            ));
        }
        let selected = select_strategy_bound(module, &self.capabilities)?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no context requirements"))?;
        let runtime = context_runtime::ContextRuntime::new(
            &requirements.strategies[selected].schedules,
            activation,
        )?;
        let objective_runtime = module
            .objective
            .as_ref()
            .map(|objective| {
                if !self.capabilities.iter().any(|cap| {
                    cap.kind == "actuator"
                        && cap.name == objective.output
                        && cap.value_type == Type::Number
                }) {
                    return Err(Error::new("objective requires numeric actuator capability"));
                }
                controller::Pid::new(objective.config)
            })
            .transpose()?;
        self.objective_runtime = objective_runtime;
        self.context_runtime = Some(runtime);
        self.active_strategy = Some(selected);
        Ok(())
    }
    pub fn tick_with_context(
        &mut self,
        clock: schedule_clock::ClockSnapshot<'_>,
        facts: &context_runtime::Facts,
    ) -> Result<&TickRecord> {
        if !self
            .module
            .as_ref()
            .is_some_and(|m| matches!(m.format_version, 10 | 11 | 12))
        {
            return Err(Error::new("context facts require GFB10, GFB11 or GFB12"));
        }
        self.tick_inner(None, Some((clock, facts)))
    }
    pub fn context_checkpoint(&self) -> Result<Vec<u8>> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("context is not active"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no context requirements"))?;
        self.context_runtime
            .as_ref()
            .ok_or_else(|| Error::new("no context runtime"))?
            .snapshot(
                &requirements.strategies[selected].schedules,
                module.fingerprint,
            )
    }
    pub fn context_state_json(&self) -> Result<String> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("context is not active"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no context requirements"))?;
        self.context_runtime
            .as_ref()
            .ok_or_else(|| Error::new("no context runtime"))?
            .state_json(
                &requirements.strategies[selected].schedules,
                module.fingerprint,
            )
    }
    /// Restore durable identities and settings before the new run's first scan.
    pub fn restore_context_checkpoint(&mut self, bytes: &[u8]) -> Result<()> {
        if self.next_tick != 1 {
            return Err(Error::new("restore context before the first scan"));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("context is not active"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no context requirements"))?;
        let restored = self
            .context_runtime
            .as_ref()
            .ok_or_else(|| Error::new("no context runtime"))?
            .restored(
                &requirements.strategies[selected].schedules,
                module.fingerprint,
                bytes,
            )?;
        self.context_runtime = Some(restored);
        Ok(())
    }
    /// Export bounded durable Solar terminal identities for the exact Program.
    /// This is not a scalar-state or clock-continuity checkpoint.
    pub fn solar_checkpoint(&self) -> Result<Vec<u8>> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("Solar is not active"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no Solar requirements"))?;
        self.solar_runtime
            .as_ref()
            .ok_or_else(|| Error::new("no Solar runtime"))?
            .snapshot(
                &requirements.strategies[selected].schedules,
                module.fingerprint,
            )
    }

    /// Restore before the first tick; malformed data leaves the runtime unchanged.
    /// The new run retains its fresh boot epoch and baseline clock semantics.
    pub fn restore_solar_checkpoint(&mut self, bytes: &[u8]) -> Result<()> {
        if self.next_tick != 1 {
            return Err(Error::new("restore Solar before the first scan"));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("Solar is not active"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no Solar requirements"))?;
        let restored = self
            .solar_runtime
            .as_ref()
            .ok_or_else(|| Error::new("no Solar runtime"))?
            .restored(
                &requirements.strategies[selected].schedules,
                module.fingerprint,
                bytes,
            )?;
        self.solar_runtime = Some(restored);
        Ok(())
    }

    /// Observe Solar admission while the host explicitly pauses execution.
    /// Only schedule clocks and terminal identities commit. No authored predicate,
    /// scalar state, inputs, intents, tick journal or scan sequence is evaluated.
    /// The clock uses the same program-logical domain as framed Solar scans; it
    /// may freeze during pause while actual wall time and trust remain supplied.
    pub fn observe_solar_paused(
        &mut self,
        clock: schedule_clock::ClockSnapshot<'_>,
        facts: &[solar_runtime::SolarInput<'_>],
    ) -> Result<()> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("Solar is not active"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no Solar requirements"))?;
        let staged = self
            .solar_runtime
            .as_ref()
            .ok_or_else(|| Error::new("no Solar runtime"))?
            .observe_paused(&requirements.strategies[selected].schedules, clock, facts)?;
        self.solar_runtime = Some(staged);
        Ok(())
    }

    /// Bind provider occurrence facts to a schedule-only GFB5 module.
    /// Provider code must derive facts from the installed descriptor, including
    /// timezone/location/offset and complete coverage. No host due bit is accepted.
    pub fn activate_with_solar(
        &mut self,
        activation: &solar_runtime::SolarActivation,
    ) -> Result<()> {
        if self
            .module
            .as_ref()
            .is_some_and(|m| matches!(m.format_version, 8 | 9))
        {
            return Err(Error::new("civil schedules require schedule activation"));
        }
        self.activate_schedule_core(activation)
    }
    pub fn activate_with_schedules(
        &mut self,
        activation: &solar_runtime::SolarActivation,
    ) -> Result<()> {
        if !self
            .module
            .as_ref()
            .is_some_and(|m| matches!(m.format_version, 8 | 9))
        {
            return Err(Error::new("schedule activation requires GFB8 or GFB9"));
        }
        self.activate_schedule_core(activation)
    }
    fn activate_schedule_core(
        &mut self,
        activation: &solar_runtime::SolarActivation,
    ) -> Result<()> {
        if self.active_strategy.is_some()
            || self.temporal.is_some()
            || self.true_for_runtime.is_some()
            || self.solar_runtime.is_some()
        {
            return Err(Error::new("temporal session is already activated"));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("module has no schedule requirements"))?;
        if module
            .temporal
            .as_ref()
            .is_some_and(|r| r.strategies.iter().any(|s| !s.windows.is_empty()))
            || module
                .true_fors
                .as_ref()
                .is_some_and(|r| r.strategies.iter().any(|s| !s.signals.is_empty()))
        {
            return Err(Error::new("mixed solar preludes are not executable"));
        }
        let selected = select_strategy_bound(module, &self.capabilities)?;
        let runtime = solar_runtime::SolarRuntime::new(
            &requirements.strategies[selected].schedules,
            activation,
        )?;
        self.solar_runtime = Some(runtime);
        self.active_strategy = Some(selected);
        Ok(())
    }
    pub fn tick_with_solar(
        &mut self,
        clock: schedule_clock::ClockSnapshot<'_>,
        facts: &[solar_runtime::SolarInput<'_>],
    ) -> Result<&TickRecord> {
        if self
            .module
            .as_ref()
            .is_some_and(|m| matches!(m.format_version, 8 | 9))
        {
            return Err(Error::new("civil schedules require schedule facts"));
        }
        if facts
            .iter()
            .flat_map(|f| f.facts.rows)
            .any(|r| r.fold != 0 || r.slot_key != 0 || r.minute_of_day != 0)
        {
            return Err(Error::new("Solar facts cannot contain a civil fold"));
        }
        self.tick_inner(Some((clock, facts)), None)
    }
    pub fn tick_with_schedules(
        &mut self,
        clock: schedule_clock::ClockSnapshot<'_>,
        facts: &[solar_runtime::ScheduleInput<'_>],
    ) -> Result<&TickRecord> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        if module.format_version != 8 {
            return Err(Error::new("GFSF2 schedule facts require GFB8"));
        }
        self.tick_with_schedule_inputs(clock, facts)
    }
    pub fn tick_with_daily_slots(
        &mut self,
        clock: schedule_clock::ClockSnapshot<'_>,
        facts: &[solar_runtime::ScheduleInput<'_>],
    ) -> Result<&TickRecord> {
        if !self.module.as_ref().is_some_and(|m| m.format_version == 9) {
            return Err(Error::new("GFSF3 schedule facts require GFB9"));
        }
        self.tick_with_schedule_inputs(clock, facts)
    }
    fn tick_with_schedule_inputs(
        &mut self,
        clock: schedule_clock::ClockSnapshot<'_>,
        facts: &[solar_runtime::ScheduleInput<'_>],
    ) -> Result<&TickRecord> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let selected = self
            .active_strategy
            .ok_or_else(|| Error::new("no active strategy"))?;
        let requirements = module
            .schedules
            .as_ref()
            .ok_or_else(|| Error::new("no schedule requirements"))?;
        solar_runtime::validate_kinds(&requirements.strategies[selected].schedules, facts)?;
        let shared: Vec<_> = facts
            .iter()
            .map(|f| solar_runtime::SolarInput {
                site: f.site,
                facts: f.facts,
            })
            .collect();
        self.tick_inner(Some((clock, &shared)), None)
    }
    /// Native direct-source certified interval execution. Mixed preludes and replay
    /// require separate integration and remain rejected.
    pub fn activate_with_certified_intervals(
        &mut self,
        activation: &true_for_runtime::TrueForActivation,
    ) -> Result<()> {
        if self.true_for_runtime.is_some()
            || self.temporal.is_some()
            || self.active_strategy.is_some()
        {
            return Err(Error::new("temporal session is already activated"));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let requirements = module
            .true_fors
            .as_ref()
            .ok_or_else(|| Error::new("module has no certified interval requirements"))?;
        if module.schedules.as_ref().is_some_and(|requirements| {
            requirements
                .strategies
                .iter()
                .any(|strategy| !strategy.schedules.is_empty())
        }) || module.temporal.as_ref().is_some_and(|requirements| {
            requirements
                .strategies
                .iter()
                .any(|strategy| !strategy.windows.is_empty())
        }) {
            return Err(Error::new(
                "mixed certified interval preludes are not executable",
            ));
        }
        let roots: BTreeSet<u32> = requirements
            .strategies
            .iter()
            .flat_map(|strategy| strategy.signals.iter().map(|signal| signal.source_tag))
            .collect();
        if !roots
            .iter()
            .copied()
            .eq(activation.certified_bool_roots.iter().copied())
        {
            return Err(Error::new(
                "certified interval activation root contract mismatch",
            ));
        }
        let selected = select_strategy_bound(module, &self.capabilities)?;
        let runtime = true_for_runtime::TrueForRuntime::new(
            &requirements.strategies[selected].signals,
            activation,
            self.journal_capacity,
            module.strategies[selected].result_trace_bound,
        )?;
        self.true_for_runtime = Some(runtime);
        self.active_strategy = Some(selected);
        Ok(())
    }
    pub fn certified_interval_memory_bytes(&self) -> Option<usize> {
        self.true_for_runtime
            .as_ref()
            .map(|runtime| runtime.memory_bytes)
    }
    /// Activate window execution with driver facts and an explicit temporal-only budget.
    /// Repeated activation is rejected; install explicitly starts a new session.
    pub fn activate_with_temporal(
        &mut self,
        activation: &temporal_runtime::TemporalActivation,
    ) -> Result<()> {
        self.activate_with_temporal_limit(activation, activation.budget.max_bytes)
    }
    fn activate_with_temporal_limit(
        &mut self,
        activation: &temporal_runtime::TemporalActivation,
        max_bytes: usize,
    ) -> Result<()> {
        if self.temporal.is_some() {
            return Err(Error::new("temporal session is already activated"));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        module.reject_unbound_schedules()?;
        let requirements = module
            .temporal
            .as_ref()
            .ok_or_else(|| Error::new("module has no temporal requirements"))?;
        let selected = select_strategy(module, &self.capabilities)?;
        let temporal = temporal_runtime::TemporalRuntime::new(
            requirements,
            selected,
            activation,
            self.journal_capacity,
            max_bytes,
            module.strategies[selected].result_trace_bound,
            module.fingerprint,
            &module.strategies[selected].name,
        )?;
        self.temporal = Some(temporal);
        self.active_strategy = Some(selected);
        Ok(())
    }
    /// Reserved peak temporal-owned bytes, excluding scalar storage and caller clones.
    pub fn temporal_memory_bytes(&self) -> Option<usize> {
        self.temporal.as_ref().map(|temporal| temporal.memory_bytes)
    }
    pub fn temporal_resource_report(&self) -> Option<&temporal_runtime::TemporalResourceReport> {
        self.temporal.as_ref().map(|temporal| &temporal.report)
    }
    pub fn plan_temporal(
        &self,
        activation: &temporal_runtime::TemporalActivation,
    ) -> Result<temporal_runtime::TemporalResourceReport> {
        self.plan_temporal_journal(activation, self.journal_capacity)
    }
    fn plan_temporal_journal(
        &self,
        activation: &temporal_runtime::TemporalActivation,
        journal: usize,
    ) -> Result<temporal_runtime::TemporalResourceReport> {
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        module.reject_unbound_schedules()?;
        let requirements = module
            .temporal
            .as_ref()
            .ok_or_else(|| Error::new("module has no temporal requirements"))?;
        let selected = select_strategy(module, &self.capabilities)?;
        Ok(temporal_runtime::TemporalPlan::new(
            requirements,
            selected,
            activation,
            journal,
            module.strategies[selected].result_trace_bound,
            module.fingerprint,
            &module.strategies[selected].name,
        )?
        .report)
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
        if matches!(m.format_version, 10 | 11 | 12)
            && (name.starts_with("__gf_natural_")
                || name.starts_with("__gf_accounting_")
                || (matches!(m.format_version, 11 | 12) && name.starts_with("__gf_config_")))
        {
            return Err(Error::new(
                "Rust provider projections are not caller inputs",
            ));
        }
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
        self.tick_inner(None, None)
    }
    fn tick_inner(
        &mut self,
        solar: Option<(
            schedule_clock::ClockSnapshot<'_>,
            &[solar_runtime::SolarInput<'_>],
        )>,
        context: Option<(schedule_clock::ClockSnapshot<'_>, &context_runtime::Facts)>,
    ) -> Result<&TickRecord> {
        if self.context_runtime.is_some() != context.is_some() {
            return Err(Error::new("context tick requires activated typed evidence"));
        }
        if self.solar_runtime.is_some() != solar.is_some() {
            return Err(Error::new(
                "solar tick requires activated occurrence bindings",
            ));
        }
        let m = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let si = self
            .active_strategy
            .ok_or_else(|| Error::new("runtime is not active"))?;
        let strategy = &m.strategies[si];
        let mut iv: Vec<Value> = self
            .inputs
            .iter()
            .enumerate()
            .map(|(i, v)| {
                if matches!(m.format_version, 10 | 11 | 12)
                    && (m.inputs[i].name.starts_with("__gf_natural_")
                        || m.inputs[i].name.starts_with("__gf_accounting_")
                        || (matches!(m.format_version, 11 | 12)
                            && m.inputs[i].name.starts_with("__gf_config_")))
                {
                    return Ok(m.inputs[i].default);
                }
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
        let mut result_trace = ResultTraceBuffer {
            events: Vec::new(),
            bound: strategy.result_trace_bound,
        };
        if self.temporal.is_some() || self.true_for_runtime.is_some() {
            result_trace
                .events
                .try_reserve_exact(strategy.result_trace_bound)
                .map_err(|_| Error::new("temporal-allocation-failed"))?;
            if result_trace.events.capacity() > strategy.result_trace_bound {
                return Err(Error::new("temporal-budget-exceeded"));
            }
        }
        let context_stage = if let Some(runtime) = &self.context_runtime {
            let (snapshot, facts) = context.ok_or_else(|| Error::new("missing context frame"))?;
            let temporal = m
                .temporal
                .as_ref()
                .ok_or_else(|| Error::new("context clock binding"))?;
            if temporal_runtime::exact(iv[usize::from(temporal.now_input)])?
                != snapshot.monotonic_ms
                || temporal_runtime::exact(iv[usize::from(temporal.time_epoch_input)])?
                    != runtime.boot_epoch
                || snapshot.boot_epoch != runtime.boot_epoch
            {
                return Err(Error::new("context clock binding mismatch"));
            }
            let requirements = m
                .schedules
                .as_ref()
                .ok_or_else(|| Error::new("missing context requirements"))?;
            Some(runtime.stage(
                &requirements.strategies[si].schedules,
                snapshot,
                facts,
                &mut iv,
                &self.state,
                &mut result_trace,
                m.fingerprint,
                self.next_tick,
            )?)
        } else {
            None
        };
        let objective_stage = match (&m.objective, &self.objective_runtime) {
            (Some(descriptor), Some(runtime)) => Some(descriptor.stage(
                runtime,
                clock.ok_or_else(|| Error::new("objective requires monotonic clock"))? as u64,
                &iv,
            )?),
            (None, None) => None,
            _ => return Err(Error::new("objective runtime binding mismatch")),
        };
        let solar_stage = if let Some(runtime) = &self.solar_runtime {
            let (snapshot, facts) = solar.expect("checked solar inputs");
            let temporal = m.temporal.as_ref().expect("solar clock binding");
            if temporal_runtime::exact(iv[usize::from(temporal.now_input)])?
                != snapshot.monotonic_ms
                || temporal_runtime::exact(iv[usize::from(temporal.time_epoch_input)])?
                    != runtime.boot_epoch
                || snapshot.boot_epoch != runtime.boot_epoch
            {
                return Err(Error::new("solar clock binding mismatch"));
            }
            Some(runtime.stage(
                &m.schedules.as_ref().expect("solar descriptors").strategies[si].schedules,
                snapshot,
                facts,
                &iv,
                &self.state,
                &mut result_trace,
            )?)
        } else {
            None
        };
        let schedule_projections = if let Some(stage) = &context_stage {
            stage.projections.as_slice()
        } else {
            solar_stage
                .as_ref()
                .map_or(&[][..], |stage| stage.projections.as_slice())
        };
        let evaluated = (|| {
            let window_trace = if let Some(temporal) = &mut self.temporal {
                temporal.stage(
                    m.temporal.as_ref().expect("activated temporal module"),
                    &iv,
                    &self.state,
                    &mut result_trace,
                )?
            } else {
                Vec::new()
            };
            let true_for_trace = if let Some(runtime) = &mut self.true_for_runtime {
                let temporal = m.temporal.as_ref().expect("certified clock bindings");
                runtime.stage(
                    &m.true_fors
                        .as_ref()
                        .expect("certified requirements")
                        .strategies[self.active_strategy.expect("active strategy")]
                    .signals,
                    temporal::TimeContext {
                        epoch: temporal_runtime::exact(iv[usize::from(temporal.time_epoch_input)])?,
                        now_ms: temporal_runtime::exact(iv[usize::from(temporal.now_input)])?,
                    },
                    &iv,
                )?
            } else {
                Vec::new()
            };
            let projections = self
                .temporal
                .as_ref()
                .map_or(&[][..], |temporal| temporal.projections.as_slice());
            let true_for_projections = self
                .true_for_runtime
                .as_ref()
                .map_or(&[][..], |runtime| runtime.projections.as_slice());
            for t in &strategy.transitions {
                next[t.state_index] = eval_expression_with_preludes(
                    &t.expression,
                    &iv,
                    &self.state,
                    None,
                    &mut result_trace,
                    projections,
                    true_for_projections,
                    schedule_projections,
                )?;
            }
            let mut requested = BTreeMap::new();
            for intent in &strategy.intents {
                let value = eval_expression_with_preludes(
                    &intent.expression,
                    &iv,
                    &self.state,
                    Some(&next),
                    &mut result_trace,
                    projections,
                    true_for_projections,
                    schedule_projections,
                )?;
                debug_assert_eq!(value.value_type(), intent.value_type);
                requested.insert(intent.name.clone(), value);
            }
            Ok((requested, window_trace, true_for_trace))
        })();
        let (mut requested, window_trace, true_for_trace) = match evaluated {
            Ok(values) => values,
            Err(error) => {
                if let Some(temporal) = &mut self.temporal {
                    temporal.rollback();
                }
                if let Some(runtime) = &mut self.true_for_runtime {
                    runtime.rollback();
                }
                return Err(error);
            }
        };
        if let (Some(descriptor), Some(stage)) = (&m.objective, &objective_stage) {
            requested.insert(
                descriptor.output.clone(),
                Value::Number(stage.result.requested_percent),
            );
        }
        let (mut safe, faults, safety_trace) = apply_safety(requested.clone(), &m.constraints);
        if let (Some(descriptor), Some(stage)) = (&m.objective, &objective_stage) {
            safe.insert(
                descriptor.output.clone(),
                Value::Number(stage.result.safe_percent),
            );
        }
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
            result_trace: result_trace.events,
            window_trace,
            true_for_trace,
            schedule_trace: solar_stage
                .as_ref()
                .map_or_else(Vec::new, |stage| stage.trace.clone()),
            context_trace: context_stage
                .as_ref()
                .map_or_else(Vec::new, |stage| stage.trace.clone()),
        };
        if let Some(temporal) = &mut self.temporal {
            temporal.commit(
                self.next_tick,
                clock.expect("temporal clock binding") as u64,
            );
        }
        if let Some(runtime) = &mut self.true_for_runtime {
            runtime.commit();
        }
        if let Some(stage) = solar_stage {
            self.solar_runtime
                .as_mut()
                .expect("solar runtime")
                .commit(stage);
        }
        if let Some(stage) = objective_stage {
            self.objective_runtime
                .as_mut()
                .expect("objective runtime")
                .commit(stage);
        }
        if let Some(stage) = context_stage {
            self.context_runtime = Some(stage.runtime);
        }
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
        if self.objective_runtime.is_some() {
            return Err(Error::new(
                "objective rewind requires controller checkpoint support",
            ));
        }
        if self.solar_runtime.is_some() {
            return Err(Error::new("solar rewind requires checkpoint support"));
        }
        if self.true_for_runtime.is_some() {
            return Err(Error::new("true_for rewind requires checkpoint support"));
        }
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
        let restored_state = m
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
        if let Some(temporal) = &mut self.temporal {
            temporal.restore_tick(tick)?;
        }
        self.state = restored_state;
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
    /// Compare retained inputs from the earliest retained checkpoint under a
    /// supplied module and capability set, including intentional branch runs.
    pub fn replay(
        &self,
        module: Module,
        caps: &[Capability],
        count: usize,
    ) -> Result<Vec<TickRecord>> {
        if self.objective_runtime.is_some() || module.objective.is_some() {
            return Err(Error::new(
                "objective replay requires controller checkpoint support",
            ));
        }
        if self.temporal.is_some() || self.true_for_runtime.is_some() || module.temporal.is_some() {
            return Err(Error::new(
                "temporal replay requires explicit bindings and peak budget",
            ));
        }
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
            g.next_tick = initial.tick;
        }
        for r in self.journal.iter().take(count) {
            for (n, v) in &r.inputs {
                g.set_input(n, *v)?;
            }
            g.tick()?;
        }
        Ok(g.journal.into_iter().collect())
    }
    /// Replay retained records with the installed module and active capability context.
    /// The VM checks its own module/strategy identity; source and settings revisions
    /// belong to the caller's recorded execution context.
    pub fn replay_current(&self, count: usize) -> Result<Vec<TickRecord>> {
        if count == 0 || count > self.journal.len() {
            return Err(Error::new(
                "replay count exceeds retained records or is zero",
            ));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?;
        let strategy = self
            .active_strategy()
            .ok_or_else(|| Error::new("no active strategy"))?;
        if self.journal.iter().take(count).any(|record| {
            record.module_fingerprint != module.fingerprint || record.strategy != strategy
        }) {
            return Err(Error::new(
                "replay requires the recorded module and strategy",
            ));
        }
        self.replay(module.clone(), &self.capabilities, count)
    }
    /// Replay retained temporal history using explicit scratch and combined peak budgets.
    /// Returned records own their evidence; caller retention after return is not bounded here.
    pub fn replay_with_temporal(
        &self,
        module: Module,
        caps: &[Capability],
        count: usize,
        activation: &temporal_runtime::TemporalActivation,
        max_peak_temporal_bytes: usize,
    ) -> Result<Vec<TickRecord>> {
        self.replay_temporal_range(
            module,
            caps,
            0,
            count.min(self.journal.len()),
            activation,
            max_peak_temporal_bytes,
        )
    }

    /// Fork the installed temporal program without changing the live execution.
    pub fn replay_current_with_temporal(
        &self,
        count: usize,
        activation: &temporal_runtime::TemporalActivation,
        max_peak_temporal_bytes: usize,
    ) -> Result<Vec<TickRecord>> {
        self.replay_current_temporal_range(0, count, activation, max_peak_temporal_bytes)
    }
    pub fn plan_current_temporal_replay(
        &self,
        count: usize,
        activation: &temporal_runtime::TemporalActivation,
    ) -> Result<temporal_runtime::TemporalReplayResourceReport> {
        self.plan_current_temporal_replay_range(0, count, activation, false)
    }
    fn plan_current_temporal_replay_range(
        &self,
        skip: usize,
        count: usize,
        activation: &temporal_runtime::TemporalActivation,
        framed: bool,
    ) -> Result<temporal_runtime::TemporalReplayResourceReport> {
        if count == 0 || skip > self.journal.len() || count > self.journal.len() - skip {
            return Err(Error::new(
                "temporal replay count exceeds retained records or is zero",
            ));
        }
        let source = self
            .temporal
            .as_ref()
            .ok_or_else(|| Error::new("no temporal session to replay"))?;
        source.check_activation_profile(activation)?;
        let ghost = self.plan_temporal_journal(activation, count)?;
        if ghost.strategy != source.report.strategy {
            return Err(Error::new("incompatible temporal replay strategy"));
        }
        temporal_runtime::TemporalReplayResourceReport::new(
            &source.report,
            ghost,
            count,
            self.journal.len() - skip,
            framed,
        )
    }

    fn replay_current_temporal_range(
        &self,
        skip: usize,
        count: usize,
        activation: &temporal_runtime::TemporalActivation,
        max_peak_temporal_bytes: usize,
    ) -> Result<Vec<TickRecord>> {
        if count == 0 || skip > self.journal.len() || count > self.journal.len() - skip {
            return Err(Error::new(
                "temporal replay count exceeds retained records or is zero",
            ));
        }
        let module = self
            .module
            .as_ref()
            .ok_or_else(|| Error::new("no module installed"))?
            .clone();
        self.replay_temporal_range(
            module,
            &self.capabilities,
            skip,
            count,
            activation,
            max_peak_temporal_bytes,
        )
    }

    fn replay_temporal_range(
        &self,
        module: Module,
        caps: &[Capability],
        skip: usize,
        count: usize,
        activation: &temporal_runtime::TemporalActivation,
        max_peak_temporal_bytes: usize,
    ) -> Result<Vec<TickRecord>> {
        let source = self
            .temporal
            .as_ref()
            .ok_or_else(|| Error::new("no temporal session to replay"))?;
        let original = self.module.as_ref().expect("temporal session has module");
        if original.temporal != module.temporal {
            return Err(Error::new("incompatible temporal replay descriptors"));
        }
        if original.input_fields().ne(module.input_fields())
            || original
                .states
                .iter()
                .map(|field| (&field.name, field.value_type))
                .ne(module
                    .states
                    .iter()
                    .map(|field| (&field.name, field.value_type)))
        {
            return Err(Error::new("incompatible temporal replay binding layout"));
        }
        let mut replay = Runtime::new(count.max(1));
        replay.install(module, false);
        for capability in caps {
            replay.add_capability(capability.clone())?;
        }
        if count > 0 {
            source.check_activation_profile(activation)?;
        }
        let plan = temporal_runtime::TemporalReplayResourceReport::new(
            &source.report,
            replay.plan_temporal(activation)?,
            count,
            self.journal.len() - skip,
            false,
        )?;
        if !plan.ghost_fits_budget || plan.required_peak_temporal_bytes > max_peak_temporal_bytes {
            return Err(Error::new("temporal-budget-exceeded"));
        }
        let available = plan.ghost_bytes;
        replay.activate_with_temporal_limit(activation, available)?;
        if replay.temporal.as_ref().expect("activated replay").strategy != source.strategy {
            return Err(Error::new("incompatible temporal replay strategy"));
        }
        if let Some(first) = self.journal.get(skip).filter(|_| count > 0) {
            let target = replay.module.as_ref().expect("installed replay module");
            let restored = target
                .states
                .iter()
                .map(|field| {
                    first
                        .state_before
                        .get(&field.name)
                        .copied()
                        .filter(|v| v.value_type() == field.value_type)
                        .ok_or_else(|| Error::new("incompatible journal state"))
                })
                .collect::<Result<Vec<_>>>()?;
            replay.last_time_ms = replay
                .temporal
                .as_mut()
                .expect("activated replay")
                .seed_from(source, first.tick - 1)?
                .map(|time| time as f64);
            replay.state = restored;
            replay.next_tick = first.tick;
        }
        for record in self.journal.iter().skip(skip).take(count) {
            for (name, value) in &record.inputs {
                replay.set_input(name, *value)?;
            }
            replay.tick()?;
        }
        let mut records = Vec::new();
        records
            .try_reserve_exact(count)
            .map_err(|_| Error::new("temporal-allocation-failed"))?;
        if records.capacity() != count {
            return Err(Error::new("temporal-budget-exceeded"));
        }
        records.extend(replay.journal);
        Ok(records)
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
    m.reject_unbound_schedules()?;
    select_strategy_bound(m, caps)
}
fn select_strategy_bound(m: &Module, caps: &[Capability]) -> Result<usize> {
    let mut winner: Option<(usize, i32)> = None;
    let mut ambiguous = false;
    for (i, s) in m.strategies.iter().enumerate() {
        if !eval_query(&s.query, caps, m.format_version)? {
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

#[cfg(test)]
fn verify_expression(
    code: &[u8],
    inputs: &[Field],
    states: &[Field],
    allow_next: bool,
    format_version: u16,
) -> Result<Type> {
    verify_expression_with_windows(code, inputs, states, allow_next, format_version, &[])
}

#[cfg(test)]
fn verify_expression_with_windows(
    code: &[u8],
    inputs: &[Field],
    states: &[Field],
    allow_next: bool,
    format_version: u16,
    windows: &[temporal_vm::WindowDescriptor],
) -> Result<Type> {
    verify_expression_with_prelude(
        code,
        inputs,
        states,
        allow_next,
        format_version,
        windows,
        0,
        0,
    )
}

fn verify_expression_with_prelude(
    code: &[u8],
    inputs: &[Field],
    states: &[Field],
    allow_next: bool,
    format_version: u16,
    windows: &[temporal_vm::WindowDescriptor],
    schedule_count: usize,
    true_for_count: usize,
) -> Result<Type> {
    let mut r = Reader::new(code);
    let mut stack: [Option<Type>; MAX_STACK] = [None; MAX_STACK];
    let mut len = 0;
    let mut reachable = true;
    let mut joins: BTreeMap<usize, Vec<Option<Type>>> = BTreeMap::new();
    loop {
        if joins
            .first_key_value()
            .is_some_and(|(target, _)| *target < r.at)
        {
            return Err(Error::new("jump target is not an instruction boundary"));
        }
        if let Some(incoming) = joins.remove(&r.at) {
            if reachable && stack[..len] != incoming {
                return Err(Error::new("branch stack mismatch"));
            }
            len = incoming.len();
            stack[..len].copy_from_slice(&incoming);
            reachable = true;
        }
        if r.finished() {
            break;
        }
        if !reachable {
            return Err(Error::new("unreachable expression instruction"));
        }
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
            op @ 13..=17 => {
                let b = type_pop(&mut stack, &mut len)?;
                let a = type_pop(&mut stack, &mut len)?;
                if op == 13 {
                    if a != b {
                        return Err(Error::new("eq types"));
                    }
                } else if a != b || !matches!(a, Type::Number | Type::Int) {
                    return Err(Error::new("numeric operands"));
                }
                type_push(&mut stack, &mut len, Type::Bool)?
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
                if format_version < 2 {
                    return Err(Error::new("integer opcode requires GFB format 2"));
                }
                r.i32()?;
                type_push(&mut stack, &mut len, Type::Int)?
            }
            24 => {
                if format_version < 2 {
                    return Err(Error::new("integer opcode requires GFB format 2"));
                }
                if type_pop(&mut stack, &mut len)? != Type::Int {
                    return Err(Error::new("integer negation expects Int"));
                }
                type_push(&mut stack, &mut len, Type::Int)?
            }
            25..=29 => {
                if format_version < 2 {
                    return Err(Error::new("integer opcode requires GFB format 2"));
                }
                let right = type_pop(&mut stack, &mut len)?;
                let left = type_pop(&mut stack, &mut len)?;
                if left != Type::Int || right != Type::Int {
                    return Err(Error::new("integer arithmetic expects Int operands"));
                }
                type_push(&mut stack, &mut len, Type::Int)?;
            }
            op @ 30..=31 => {
                if !matches!(format_version, 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("branch opcode requires GFB format 3"));
                }
                let target = r.jump_target()?;
                if op == 30 && type_pop(&mut stack, &mut len)? != Type::Bool {
                    return Err(Error::new("branch condition must be Bool"));
                }
                if let Some(incoming) = joins.get(&target) {
                    if stack[..len] != *incoming {
                        return Err(Error::new("branch stack mismatch"));
                    }
                } else {
                    joins.insert(target, stack[..len].to_vec());
                }
                reachable = op == 30;
            }
            32..=47 => {
                if !matches!(format_version, 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("compact Number opcode requires GFB format 3"));
                }
                type_push(&mut stack, &mut len, Type::Number)?;
            }
            op @ 48..=53 => {
                if !matches!(format_version, 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("conversion opcode requires GFB format 3"));
                }
                let (source, target) = if op == 48 {
                    (Type::Int, Type::Number)
                } else {
                    (Type::Number, Type::Int)
                };
                if type_pop(&mut stack, &mut len)? != source {
                    return Err(Error::new("conversion operand type"));
                }
                type_push(&mut stack, &mut len, target)?;
            }
            54 => {
                if !matches!(format_version, 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("Duration guard requires GFB format 3"));
                }
                if type_pop(&mut stack, &mut len)? != Type::Number {
                    return Err(Error::new("Duration guard expects Number"));
                }
                type_push(&mut stack, &mut len, Type::Number)?;
            }
            55 => {
                if !matches!(format_version, 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("DateTime guard requires GFB format 3"));
                }
                if type_pop(&mut stack, &mut len)? != Type::Number {
                    return Err(Error::new("DateTime guard expects Number"));
                }
                type_push(&mut stack, &mut len, Type::Number)?;
            }
            56 => {
                if !matches!(format_version, 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("Result trace requires GFB format 3"));
                }
                if r.u32()? == 0 {
                    return Err(Error::new("Result trace site must be positive"));
                }
                if type_pop(&mut stack, &mut len)? != Type::Number
                    || type_pop(&mut stack, &mut len)? != Type::Number
                {
                    return Err(Error::new("Result trace metadata expects Number"));
                }
                let payload = type_pop(&mut stack, &mut len)?;
                type_push(&mut stack, &mut len, payload)?;
            }
            57 => {
                if !matches!(format_version, 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("temporal projection requires GFB format 4"));
                }
                let slot = r.u16()?;
                let field = r.u8()?;
                type_push(
                    &mut stack,
                    &mut len,
                    temporal_vm::projection_type(windows, slot, field)?,
                )?;
            }
            58 => {
                if !matches!(format_version, 5 | 6 | 8 | 9 | 10 | 11 | 12) {
                    return Err(Error::new("schedule projection requires GFB format 5"));
                }
                let slot = r.u16()?;
                let field = r.u8()?;
                type_push(
                    &mut stack,
                    &mut len,
                    schedule_vm::projection_type(schedule_count, slot, field, format_version)?,
                )?;
            }
            59 => {
                if format_version != 6 {
                    return Err(Error::new("true_for projection requires GFB format 6"));
                }
                let slot = r.u16()?;
                let field = r.u8()?;
                type_push(
                    &mut stack,
                    &mut len,
                    true_for_vm::projection_type(true_for_count, slot, field)?,
                )?;
            }
            _ => return Err(Error::new("unknown expression opcode")),
        }
    }
    if len != 1 {
        return Err(Error::new("expression result count"));
    }
    Ok(stack[0].unwrap())
}

fn expression_metadata(code: &[u8]) -> Result<(bool, usize)> {
    let mut reader = Reader::new(code);
    let mut uses_int = false;
    let mut markers = 0;
    while !reader.finished() {
        match reader.u8()? {
            1 => {
                reader.take(1)?;
            }
            2 => {
                reader.f64()?;
            }
            3..=5 => {
                reader.u16()?;
            }
            23 => {
                reader.i32()?;
                uses_int = true;
            }
            24..=29 | 48..=53 => uses_int = true,
            30..=31 => {
                reader.u16()?;
            }
            10 | 13..=17 | 19..=22 | 32..=47 | 54..=55 => {}
            56 => {
                reader.u32()?;
                markers += 1;
            }
            57 | 58 | 59 => {
                reader.take(3)?;
            }
            _ => return Err(Error::new("unknown expression opcode")),
        }
    }
    Ok((uses_int, markers))
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
struct ResultTraceBuffer {
    events: Vec<ResultTraceEvent>,
    bound: usize,
}

#[cfg(test)]
fn eval_expression(
    code: &[u8],
    inputs: &[Value],
    state: &[Value],
    next: Option<&[Value]>,
) -> Result<Value> {
    let mut trace = ResultTraceBuffer {
        events: Vec::new(),
        bound: expression_metadata(code)?.1,
    };
    eval_expression_traced(code, inputs, state, next, &mut trace)
}

#[cfg(test)]
fn eval_expression_traced(
    code: &[u8],
    inputs: &[Value],
    state: &[Value],
    next: Option<&[Value]>,
    trace: &mut ResultTraceBuffer,
) -> Result<Value> {
    eval_expression_with_windows(code, inputs, state, next, trace, &[])
}

fn eval_expression_with_windows(
    code: &[u8],
    inputs: &[Value],
    state: &[Value],
    next: Option<&[Value]>,
    trace: &mut ResultTraceBuffer,
    windows: &[[Value; 8]],
) -> Result<Value> {
    eval_expression_with_preludes(code, inputs, state, next, trace, windows, &[], &[])
}
fn eval_expression_with_preludes(
    code: &[u8],
    inputs: &[Value],
    state: &[Value],
    next: Option<&[Value]>,
    trace: &mut ResultTraceBuffer,
    windows: &[[Value; 8]],
    true_fors: &[[Value; 7]],
    schedules: &[[Value; 3]],
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
            op @ 13..=17 => {
                let b = value_pop(&s, &mut n)?;
                let a = value_pop(&s, &mut n)?;
                let v = match (op, a, b) {
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
                    29 if left == i32::MIN && right == -1 => Some(0),
                    29 => left.checked_rem(right),
                    _ => unreachable!(),
                }
                .ok_or_else(|| Error::new("integer-overflow"))?;
                value_push(&mut s, &mut n, Value::Int(value))?;
            }
            op @ 30..=31 => {
                let target = r.jump_target()?;
                let jump = if op == 30 {
                    let Value::Bool(condition) = value_pop(&s, &mut n)? else {
                        return Err(Error::new("branch condition must be Bool"));
                    };
                    !condition
                } else {
                    true
                };
                if jump {
                    r.at = target;
                }
            }
            op @ 32..=47 => {
                value_push(&mut s, &mut n, Value::Number(f64::from(op - 32)))?;
            }
            48 => {
                let Value::Int(value) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("conversion operand type"));
                };
                value_push(&mut s, &mut n, Value::Number(f64::from(value)))?;
            }
            op @ 49..=53 => {
                let Value::Number(value) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("conversion operand type"));
                };
                if op == 49 && value.fract() != 0.0 {
                    return Err(Error::new("integer-conversion-fractional"));
                }
                let rounded = match op {
                    49 => value,
                    50 => value.floor(),
                    51 => value.ceil(),
                    52 => value.trunc(),
                    53 => value.round_ties_even(),
                    _ => unreachable!(),
                };
                if !(f64::from(i32::MIN)..=f64::from(i32::MAX)).contains(&rounded) {
                    return Err(Error::new("integer-conversion-out-of-range"));
                }
                value_push(&mut s, &mut n, Value::Int(rounded as i32))?;
            }
            54 => {
                let Value::Number(value) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("Duration guard expects Number"));
                };
                if !value.is_finite()
                    || value.fract() != 0.0
                    || !(0.0..=9_007_199_254_740_991.0).contains(&value)
                {
                    return Err(Error::new("duration-out-of-range"));
                }
                value_push(&mut s, &mut n, Value::Number(value))?;
            }
            55 => {
                let Value::Number(value) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("DateTime guard expects Number"));
                };
                if !value.is_finite()
                    || value.fract() != 0.0
                    || !(0.0..=253_402_300_799_999.0).contains(&value)
                {
                    return Err(Error::new("datetime-out-of-range"));
                }
                value_push(&mut s, &mut n, Value::Number(value))?;
            }
            57 => {
                let slot = usize::from(r.u16()?);
                let field = usize::from(r.u8()?);
                let value = windows
                    .get(slot)
                    .and_then(|window| window.get(field))
                    .copied()
                    .ok_or_else(|| Error::new("temporal projection unavailable"))?;
                value_push(&mut s, &mut n, value)?;
            }
            58 => {
                let slot = usize::from(r.u16()?);
                let field = usize::from(r.u8()?);
                let value = schedules
                    .get(slot)
                    .and_then(|schedule| schedule.get(field))
                    .copied()
                    .ok_or_else(|| Error::new("schedule projection unavailable"))?;
                value_push(&mut s, &mut n, value)?;
            }
            59 => {
                let slot = usize::from(r.u16()?);
                let field = usize::from(r.u8()?);
                let value = true_fors
                    .get(slot)
                    .and_then(|signal| signal.get(field))
                    .copied()
                    .ok_or_else(|| Error::new("true_for projection unavailable"))?;
                value_push(&mut s, &mut n, value)?;
            }
            56 => {
                let site = r.u32()?;
                let Value::Number(origin) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("Result trace metadata expects Number"));
                };
                let Value::Number(choice) = value_pop(&s, &mut n)? else {
                    return Err(Error::new("Result trace metadata expects Number"));
                };
                if !origin.is_finite()
                    || origin.fract() != 0.0
                    || !(0.0..=u32::MAX as f64).contains(&origin)
                    || !choice.is_finite()
                    || choice.fract() != 0.0
                    || !(0.0..=u16::MAX as f64).contains(&choice)
                {
                    return Err(Error::new("result-trace-out-of-range"));
                }
                if site == 0 || n == 0 || trace.events.len() >= trace.bound {
                    return Err(Error::new("Result trace instruction bound exceeded"));
                }
                trace.events.push(ResultTraceEvent {
                    site,
                    choice: choice as u16,
                    origin: origin as u32,
                });
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
fn verify_query(code: &[u8], format_version: u16) -> Result<()> {
    eval_query(code, &[], format_version).map(|_| ())
}
fn eval_query(code: &[u8], caps: &[Capability], format_version: u16) -> Result<bool> {
    let mut r = Reader::new(code);
    let mut s = [false; MAX_STACK];
    let mut n = 0;
    while !r.finished() {
        match r.u8()? {
            1 => {
                let kind = r.string()?;
                let name = r.string()?;
                let ty = Type::from_byte(r.u8()?, format_version)?;
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
    fn jump_target(&mut self) -> Result<usize> {
        let offset = self.u16()? as usize;
        if offset == 0 {
            return Err(Error::new("jump must advance"));
        }
        self.at
            .checked_add(offset)
            .filter(|target| *target <= self.bytes.len())
            .ok_or_else(|| Error::new("jump target outside expression"))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
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
    fn conditional_expression(condition: bool, yes: &[u8], no: &[u8]) -> Vec<u8> {
        let mut code = vec![1, u8::from(condition), 30];
        code.extend(((yes.len() + 3) as u16).to_le_bytes());
        code.extend(yes);
        code.push(31);
        code.extend((no.len() as u16).to_le_bytes());
        code.extend(no);
        code
    }

    #[test]
    fn short_circuit_verifies_both_paths_and_executes_only_selected_path() {
        let fault = expression_ints(1, 0, 28);
        for condition in [false, true] {
            let code = conditional_expression(condition, &expression_int(7), &fault);
            assert_eq!(
                verify_expression(&code, &[], &[], false, 3).unwrap(),
                Type::Int
            );
            if condition {
                assert_eq!(
                    eval_expression(&code, &[], &[], None).unwrap(),
                    Value::Int(7)
                );
            } else {
                assert_eq!(
                    eval_expression(&code, &[], &[], None)
                        .unwrap_err()
                        .message(),
                    "integer-division-by-zero"
                );
            }
        }
        let nested = conditional_expression(false, &fault, &expression_int(9));
        let mut code = expression_int(2);
        code.extend(conditional_expression(true, &nested, &fault));
        code.push(25);
        assert_eq!(
            verify_expression(&code, &[], &[], false, 3).unwrap(),
            Type::Int
        );
        assert_eq!(
            eval_expression(&code, &[], &[], None).unwrap(),
            Value::Int(11)
        );
    }

    #[test]
    fn short_circuit_rejects_malformed_control_flow_and_stack_joins() {
        let valid = conditional_expression(true, &[1, 1], &[1, 0]);
        assert!(verify_expression(&valid, &[], &[], false, 3).is_ok());
        for format in [1, 2] {
            assert!(verify_expression(&valid, &[], &[], false, format).is_err());
        }
        for format in [1, 2, 3] {
            for code in [
                vec![1, 1, 1, 0, 11],
                vec![1, 1, 1, 0, 12],
                vec![1, 1, 1, 1, 1, 0, 18],
            ] {
                assert!(verify_expression(&code, &[], &[], false, format).is_err());
            }
        }
        for code in [
            vec![1, 1, 30],             // truncated displacement
            vec![1, 1, 30, 0, 0],       // zero displacement
            vec![1, 1, 30, 255, 255],   // out of bounds
            vec![1, 1, 30, 1, 0, 1, 1], // target inside immediate
            vec![1, 1, 31, 2, 0, 1, 0], // unreachable instruction
            vec![30, 1, 0, 10],         // condition underflow
            {
                let mut code = expression_int(1);
                code.extend([30, 2, 0, 1, 1]);
                code
            }, // non-Bool condition
            conditional_expression(true, &[1, 1], &expression_int(1)), // type mismatch
            conditional_expression(true, &[1, 1, 1, 0], &[1, 0]), // height mismatch
            conditional_expression(true, &[1, 1], &[10]), // unselected underflow
            conditional_expression(true, &[1, 1], &[3, 0, 0]), // unselected bad input
            conditional_expression(true, &[1, 1], &[255]), // unselected unknown opcode
            conditional_expression(true, &[1, 1], &vec![1; (MAX_STACK + 1) * 2]),
        ] {
            assert!(
                verify_expression(&code, &[], &[], false, 3).is_err(),
                "accepted {code:?}"
            );
        }
    }

    #[test]
    fn integer_minimum_remainder_negative_one_is_zero() {
        assert_eq!(
            eval_expression(&expression_ints(i32::MIN, -1, 29), &[], &[], None).unwrap(),
            Value::Int(0)
        );
    }

    #[test]
    fn compact_number_constants_preserve_number_type_and_require_format_three() {
        for value in 0..=15 {
            let code = [32 + value];
            assert_eq!(
                verify_expression(&code, &[], &[], false, 3).unwrap(),
                Type::Number
            );
            assert_eq!(
                eval_expression(&code, &[], &[], None).unwrap(),
                Value::Number(f64::from(value))
            );
            for format in [1, 2] {
                assert!(verify_expression(&code, &[], &[], false, format).is_err());
            }
            assert!(!expression_metadata(&code).unwrap().0);
        }
    }

    #[test]
    fn dynamic_conversion_opcodes_check_profiles_and_operand_types() {
        let number = {
            let mut bytes = vec![2];
            bytes.extend(1.5f64.to_le_bytes());
            bytes
        };
        for opcode in 48..=53 {
            let mut valid = if opcode == 48 {
                expression_int(7)
            } else {
                number.clone()
            };
            valid.push(opcode);
            assert_eq!(
                verify_expression(&valid, &[], &[], false, 3).unwrap(),
                if opcode == 48 {
                    Type::Number
                } else {
                    Type::Int
                }
            );
            assert!(expression_metadata(&valid).unwrap().0);
            for format in [1, 2] {
                assert!(verify_expression(&valid, &[], &[], false, format).is_err());
            }
            assert!(verify_expression(&[opcode], &[], &[], false, 3).is_err());
            assert!(verify_expression(&[1, 1, opcode], &[], &[], false, 3).is_err());
            let mut wrong = if opcode == 48 {
                number.clone()
            } else {
                expression_int(7)
            };
            wrong.push(opcode);
            assert!(verify_expression(&wrong, &[], &[], false, 3).is_err());
        }
    }

    #[test]
    fn duration_guard_verifies_profile_and_preserves_only_valid_milliseconds() {
        let input = Field {
            name: "value".into(),
            value_type: Type::Number,
            default: Value::Number(0.0),
        };
        let code = [3, 0, 0, 54];
        assert_eq!(
            verify_expression(&code, &[input.clone()], &[], false, 3).unwrap(),
            Type::Number
        );
        assert!(!expression_metadata(&code).unwrap().0);
        for format in [1, 2] {
            assert!(verify_expression(&code, &[input.clone()], &[], false, format).is_err());
        }
        for invalid in [vec![54], vec![1, 1, 54], {
            let mut code = expression_int(0);
            code.push(54);
            code
        }] {
            assert!(verify_expression(&invalid, &[], &[], false, 3).is_err());
        }
        for value in [0.0, 1.0, 9_007_199_254_740_991.0] {
            assert_eq!(
                eval_expression(&code, &[Value::Number(value)], &[], None).unwrap(),
                Value::Number(value)
            );
        }
        for value in [
            -1.0,
            0.5,
            9_007_199_254_740_992.0,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
        ] {
            assert_eq!(
                eval_expression(&code, &[Value::Number(value)], &[], None)
                    .unwrap_err()
                    .message(),
                "duration-out-of-range"
            );
        }
    }

    #[test]
    fn datetime_guard_verifies_profile_and_preserves_only_valid_epoch_milliseconds() {
        let input = Field {
            name: "value".into(),
            value_type: Type::Number,
            default: Value::Number(0.0),
        };
        let code = [3, 0, 0, 55];
        assert_eq!(
            verify_expression(&code, &[input.clone()], &[], false, 3).unwrap(),
            Type::Number
        );
        assert!(!expression_metadata(&code).unwrap().0);
        for format in [1, 2] {
            assert!(verify_expression(&code, &[input.clone()], &[], false, format).is_err());
        }
        for invalid in [vec![55], vec![1, 1, 55], {
            let mut code = expression_int(0);
            code.push(55);
            code
        }] {
            assert!(verify_expression(&invalid, &[], &[], false, 3).is_err());
        }
        for value in [0.0, 1.0, 253_402_300_799_999.0] {
            assert_eq!(
                eval_expression(&code, &[Value::Number(value)], &[], None).unwrap(),
                Value::Number(value)
            );
        }
        for value in [
            -1.0,
            0.5,
            253_402_300_800_000.0,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
        ] {
            assert_eq!(
                eval_expression(&code, &[Value::Number(value)], &[], None)
                    .unwrap_err()
                    .message(),
                "datetime-out-of-range"
            );
        }
    }

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
            temporal: None,
            schedules: None,
            true_fors: None,
            format_version: 2,
            objective: None,
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
                result_trace_bound: 0,
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
                verify_expression(&code, &[], &[], false, 2).unwrap(),
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
    fn result_trace_is_transactional_and_reproduced_by_ghost_replay_and_rewind() {
        let mut module = int_atomicity_module(12, 28);
        module.format_version = 3;
        let expression = &mut module.strategies[0].transitions[0].expression;
        expression.extend([2]);
        expression.extend(3_f64.to_le_bytes());
        expression.extend([2]);
        expression.extend(17_f64.to_le_bytes());
        expression.extend([56]);
        expression.extend(5_u32.to_le_bytes());
        module.strategies[0].result_trace_bound = expression_metadata(expression).unwrap().1;
        let mut runtime = Runtime::new(3);
        runtime.install(module.clone(), false);
        runtime.activate().unwrap();
        for rhs in [3, 2] {
            runtime.set_input("rhs", Value::Int(rhs)).unwrap();
            let record = runtime.tick().unwrap();
            assert_eq!(record.result_trace.len(), 1);
            let event = &record.result_trace[0];
            assert_eq!((event.site, event.choice, event.origin), (5, 3, 17));
        }
        let before: Vec<_> = runtime.journal().iter().map(TickRecord::to_json).collect();
        runtime.set_input("rhs", Value::Int(0)).unwrap();
        assert_eq!(
            runtime.tick().unwrap_err().message(),
            "integer-division-by-zero"
        );
        assert_eq!(
            runtime
                .journal()
                .iter()
                .map(TickRecord::to_json)
                .collect::<Vec<_>>(),
            before
        );
        let replay = runtime.replay(module, &[], 2).unwrap();
        assert_eq!(
            replay.iter().map(TickRecord::to_json).collect::<Vec<_>>(),
            before
        );
        runtime.rewind(replay[0].tick).unwrap();
        runtime.set_input("rhs", Value::Int(2)).unwrap();
        assert_eq!(runtime.tick().unwrap().to_json(), before[1]);
    }

    #[test]
    fn retained_plain_core_replay_preserves_logical_tick_after_rollover() {
        let module = int_atomicity_module(12, 28);
        let mut runtime = Runtime::new(2);
        runtime.install(module.clone(), false);
        runtime.activate().unwrap();
        assert!(runtime.replay(module.clone(), &[], 1).unwrap().is_empty());
        assert!(runtime.replay_current(1).is_err());
        for rhs in [3, 2] {
            runtime.set_input("rhs", Value::Int(rhs)).unwrap();
            runtime.tick().unwrap();
        }
        runtime.set_input("rhs", Value::Int(0)).unwrap();
        assert_eq!(
            runtime.tick().unwrap_err().message(),
            "integer-division-by-zero"
        );
        runtime.set_input("rhs", Value::Int(4)).unwrap();
        runtime.tick().unwrap();
        let original: Vec<_> = runtime.journal().iter().map(TickRecord::to_json).collect();
        assert_eq!(runtime.journal().front().unwrap().tick, 2);
        let replayed = runtime.replay(module.clone(), &[], 2).unwrap();
        assert_eq!(
            replayed.iter().map(TickRecord::to_json).collect::<Vec<_>>(),
            original
        );
        assert_eq!(
            runtime
                .replay_current(2)
                .unwrap()
                .iter()
                .map(TickRecord::to_json)
                .collect::<Vec<_>>(),
            original
        );
        assert_eq!(
            runtime
                .journal()
                .iter()
                .map(TickRecord::to_json)
                .collect::<Vec<_>>(),
            original
        );
        assert!(runtime.replay(module.clone(), &[], 0).unwrap().is_empty());
        assert_eq!(runtime.replay(module.clone(), &[], 3).unwrap().len(), 2);
        assert!(runtime.replay_current(0).is_err());
        assert!(runtime.replay_current(3).is_err());

        let mut alternate = module;
        alternate.fingerprint += 1;
        let compared = runtime.replay(alternate.clone(), &[], 2).unwrap();
        assert_eq!(
            compared
                .iter()
                .map(|record| record.tick)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        runtime.hot_swap(alternate).unwrap();
        assert!(runtime.replay_current(2).is_err());
    }

    #[test]
    fn result_trace_enforces_derived_instruction_bound_and_preserves_payload_bits() {
        let mut code = vec![2];
        code.extend((-0_f64).to_le_bytes());
        code.push(2);
        code.extend(0_f64.to_le_bytes());
        code.push(2);
        code.extend(0_f64.to_le_bytes());
        code.push(56);
        code.extend(1_u32.to_le_bytes());
        assert_eq!(
            verify_expression(&code, &[], &[], false, 3).unwrap(),
            Type::Number
        );
        assert_eq!(expression_metadata(&code).unwrap(), (false, 1));
        let mut trace = ResultTraceBuffer {
            events: Vec::new(),
            bound: 1,
        };
        let Value::Number(payload) =
            eval_expression_traced(&code, &[], &[], None, &mut trace).unwrap()
        else {
            panic!("Number payload");
        };
        assert_eq!(payload.to_bits(), (-0_f64).to_bits());
        assert_eq!(
            eval_expression_traced(&code, &[], &[], None, &mut trace)
                .unwrap_err()
                .message(),
            "Result trace instruction bound exceeded"
        );
        assert_eq!(trace.events.len(), 1);
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
                verify_expression(&code, &[], &[], false, 1).unwrap(),
                Type::Number
            );
            assert_eq!(
                eval_expression(&code, &[], &[], None).unwrap(),
                Value::Number(expected)
            );
        }
        assert!(eval_expression(&expression_numbers(1.0, 0.0, 22), &[], &[], None).is_err());
        assert!(eval_expression(&expression_numbers(f64::MAX, 2.0, 21), &[], &[], None).is_err());
        assert!(verify_expression(&[1, 1, 1, 0, 19], &[], &[], false, 1).is_err());
        assert!(verify_expression(&[19], &[], &[], false, 1).is_err());
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
            result_trace: Vec::new(),
            window_trace: Vec::new(),
            true_for_trace: Vec::new(),
            schedule_trace: Vec::new(),
            context_trace: Vec::new(),
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
        assert!(eval_query(&[5, 1], &[], 1).unwrap());
        assert!(!eval_query(&[5, 0], &[], 1).unwrap());
        assert!(verify_query(&[5, 2], 1).is_err());
        assert!(verify_query(&[5], 1).is_err());
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
