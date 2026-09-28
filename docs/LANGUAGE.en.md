<!-- translation-source: docs/LANGUAGE.md -->
[Korean original](LANGUAGE.md)

# GhostFlow language contract · design draft

2026-09-05. Defines the common execution contract of the new language.
The currently selected authoring syntax is [control syntax](LANGUAGE-SURFACE.md).
The [literate format](LITERATE.md) allows the same code to be written inside Markdown.
The [common constraints/sensor contract](CONSTRAINTS.md) defines subsequent design decisions for mode interlocks, optional device information, sensor processing, and time limits.
The current executable implementation is a finite subset of control/literate and compatible S-expression/GFB1.
Implementation scope and replay evidence follow the [implementation contract](IMPLEMENTATION.md) and [traceability](TRACEABILITY.md).

The common semantics and A/B/C notation established in the 0.2 design remain below.
Where specific vocabulary or source format differs, subsequent control/literate documents take precedence. For constraints and application of operating settings, the subsequent common constraints contract takes precedence.
The [three syntax examples](LANGUAGE-EXAMPLES.md) are preserved as the initial comparison record.

The previous specification is preserved unchanged in [LANGUAGE-MVP-0.1.md](LANGUAGE-MVP-0.1.md).
Current bytecode follows [GFB1](BYTECODE.md).
Sensor ok/fault handling, static pure functions, and document-form source are implemented; general Result/ADT, higher-order function composition, strategy-specific inputs, and macros are not.

## 1. Language direction

GhostFlow is a control language that receives sensor inputs as streams and combines pure computation with explicit state transitions to produce device intents.
It selects a strategy within the same program according to current device capabilities, and re-executes identical inputs to compare behavior before and after a change.

Preferences confirmed in the original conversation and judgments made in this design are recorded separately in [DESIGN-NOTES.md](DESIGN-NOTES.md).

| Preference | Reflection in language/tools |
|---|---|
| YAML | Hierarchical declarations, `name: type`, readable settings |
| Literate CoffeeScript | Indentation, concise functions, explanations combined with executable code |
| Cypher query | Capability patterns and explicit device-selection clauses |
| Meta Lua | Compile-time extension treating syntax as data |
| Functional/function-level composition | Pure functions, value piping, and function composition |
| Railway-oriented programming | Successful and error values handled in the same flow |
| Cycle.js | Input Source and output Intent separated by a Driver boundary |
| Observable·marimo·D3.js | Intermediate values, state, and changes observed beside code |
| Elm/Rust stability | Type, branch, and resource validation; a predictable execution foundation |

Alternative A was compared as YAML-centered declarative syntax, B as Literate CoffeeScript-centered flow syntax, and C as Cypher-centered query syntax.
Subsequent discussion selected control syntax centered on braces, expressions, next state, and output connections as the basic direction.
Literate is a source format above that syntax. The common execution contract below also applies to this choice.

## 2. Program model

```text
candidate_state = transition(old_state, input_snapshot, selected_strategy)
requested       = intents(old_state, candidate_state, input_snapshot)
safe            = safety(requested, constraints)
```

If computation succeeds, candidate_state and safe results are committed as one logical tick.
The host Driver subsequently applies physical outputs.
Logical atomicity does not mean multiple GPIOs change physically at the same instant.

| Element | Meaning |
|---|---|
| module / version | Stable module ID and state-schema version |
| input | Typed sample supplied each tick; semantically `Signal<T>` |
| state | Value retained between ticks and its initial default |
| Function | Pure, statically interpretable value transformation |
| strategy | Device query, strategy-specific inputs, computation, transition, intents |
| let / with | Named stateless intermediate computation |
| next | Definition of next state |
| output / intent / emit | Declare a type and request this tick's capability output intent through exactly one connection expression |
| safety | requires / mutex constraints applied to final outputs |

Combinational cycles in the expression graph are compilation errors.
Feedback crosses an explicit boundary, such as state, that reads a previous-tick value.
State not defined in next is retained.
Two definitions of one state or output in the same strategy are an error.

### Example: input → state → output in the selected syntax

Below is a complete source example in the selected control syntax.
It compiles with `ghostc` and runs on a host connected to a sensor manifest.
This example assumes a low-water sensor is installed, but provides no supplementary information such as pressure or flow.
It does not mean installing a low-water sensor is a common mandatory condition for every program.

```ghost
fn hold(start: Bool, blocked: Bool, previous: Bool) -> Bool {
  !blocked && (start || previous)
}

control WateringDemand {
  input start, stop: Bool;
  sensor low_water: Bool;

  output pump, valve: Bool;
  state watering: Bool = false;

  let water_ok = case low_water {
    ok(low)  => !low;
    fault(_) => false;
  };

  let blocked = stop || !water_ok;
  watering' = hold(start, blocked, watering);

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

`watering` is memory, `watering'` is the candidate committed this tick, and `<-` is output intent.
Function `hold` itself has no hidden memory. Start and stop are bool samples, not edge events.

`output name: Type;` declares only an intent port's type.
Every output name must have exactly one `name <- expression;` connection; an initial value in the declaration is prohibited.
This connection expression is the logical intent requested by the VM this tick.
The host/Driver separately owns startup/fail-safe policy that keeps outputs OFF or stops applying them on boot, computation failure, or host disconnection.
Safety policy is not implicitly established by an output declaration's default value.
The following expected results supply inputs in order from initial watering=false.

| tick | start | stop | low_water | watering' | valve / pump intent |
|---|---|---|---|---|---|
| 1 | true | false | ok(false) | true | ON / ON |
| 2 | false | false | ok(false) | true | ON / ON |
| 3 | false | false | fault(Stale) | false | OFF / OFF |
| 4 | false | false | ok(false) | false | OFF / OFF |
| 5 | true | true | ok(false) | false | OFF / OFF |

Sensor recovery alone does not revive the latch; stop takes priority when start and stop are both true.
This is a pure control-computation example.
Facility mode entry, shared-pump ownership, and staggered physical pump/valve application belong to the facility manager and Driver in the [common constraints contract](CONSTRAINTS.md). The code above does not implement them all.

## 3. Vocabulary and types

Identifiers in the new syntax are `[A-Za-z_][A-Za-z0-9_]*` and case-sensitive.
Dots separate paths such as `input.start`, `state.watering`, and `next.watering`.
The existing `low-water` is written `low_water` in new examples, but an explicit rename mapping is required when migrating an actual module.

Reserved words cannot be names.
Input, state, strategy, and function names must each be unique in their respective scope.
Strategy inputs cannot shadow common inputs. Local computations cannot shadow functions or reserved namespaces.
Function parameters exist only inside their own function.

Alternative B uses two-space indentation and rejects tabs. Indent after a block introducer.
Alternative A parses restricted YAML. Alternative C separates blocks with clauses and end.
All three alternatives use `#` comments. Call parentheses are retained.
Line continuation is allowed within open parentheses or after a comma.

Currently implemented basic value types are bool and finite IEEE 754 binary64 number.
Only true/false are bool literals; strings/numbers have no truthiness or implicit conversion.
Numbers begin with decimal integer or fractional notation; NaN/Infinity are rejected.
Module version is a u32 integer literal; strategy priority is an i32 integer literal.
The document's 0.2, module version, and bytecode format version are separate identifiers.
The [exact integer contract](EXACT-INTEGER-CONTRACT.md) for R14 review proposes a third scalar, `Int/i32`.
Do not mark it implemented before N2–N4 are complete.

Sensor samples are represented by `Result<T, SensorFault>`.
Constructors are `Ok(value)` and `Err(fault)`; the initial SensorFault set is `Disconnected | Stale | Invalid`.
Using Result directly as bool/number is a type error.
State requires a constant initial value matching its declared type.

The subsequent sensor-processing contract adds `NotReady` before filter readiness.
Missing optional device information (Option) is distinct from a fault in an installed sensor (Result).
Basic control and interlocks can be used without supplying supplementary pressure/flow information.
Detailed rules follow [CONSTRAINTS.md](CONSTRAINTS.md).

General ADTs, fault-specific pattern matching, and time/physical-unit types are later extensions.
When adding branch syntax, exhaustive branch checking is required.
The language does not guarantee device faults disappear. Its objective is to block type, reference, and resource errors and unhandled language exceptions.

The minimal design for DateTime, monotonic elapsed time, recurring schedules, natural events, work calendars, and mandatory fallback is in [TIME-AND-SCHEDULE-CONTRACT.md](TIME-AND-SCHEDULE-CONTRACT.md).
Current `Duration`/DailySlots/Solar implementation boundaries and T2–T4 proposals are explicitly distinguished.

## 4. Expressions and function composition

Common expressions are literals, references, calls, function definitions, parentheses, and the following operators.

| Stronger binding → weaker binding | Rule |
|---|---|
| References/calls/parentheses | `f(x)`, `input.x`, `(expr)` |
| Comparison | `< <= > >= is isnt`; chained comparison rejected |
| not | Bool negation; `not x is y` means `not (x is y)` |
| and | Two bool values, left-associative |
| or | Two bool values, left-associative |
| >> | Unary function composition, left-associative |
| \|> | Value piping, left-associative |
| if / then / else | Conditional expression whose two result types match |

The body of `(args) -> expr` is the entire expression following it.
Parenthesize a function expression if its boundary is ambiguous.
Use parentheses when combining comparisons and pipes.
is/isnt are equality/inequality between values of the same type.
Ordering comparisons are currently allowed only on number.
If the integer contract is adopted, ordering between two `Int` values is also allowed, while mixed comparisons are rejected.
`type is number` in a device query is a separate type-tag comparison.

Functions and operations at this stage must be pure and guaranteed to terminate.
Side effects or error-avoidance patterns relying on short-circuit evaluation are prohibited.
All branches are type-checked; safe expressions may be precomputed.
Arithmetic/division error rules will be defined by a subsequent numeric profile.
The minimal range, operation, and conversion proposal for exact integers, and implementation acceptance vectors, are separated into [EXACT-INTEGER-CONTRACT.md](EXACT-INTEGER-CONTRACT.md).
That link is a design proposal, not a claim that current parser/GFB/VM supports `Int`.
Current GFB1 has only `Number/f64` arithmetic opcodes, with no integer opcodes or remainder operation.

```ghost
latch = (start, stop, held) -> not stop and (start or held)
is_dry = map(below(35)) >> recover(false)
```

`x |> f` means `f(x)`; `f >> g` means `(x) -> g(f(x))`.
Neither creates new state. Latch memory exists only in state.watering supplied by the caller.

Function types are inferred from the body and uses; failure to determine a unique type is an error.
Recursion and dynamic function selection are outside scope.
Function composition and library functions are statically specialized into a graph, so dynamic closures are not required on the MCU.

## 5. Streams and Railway error flow

An input field's type notation is the sample type for one tick.
`start: bool` means the current sample of a `Signal<bool>` port.
input.start is the current sample; functions and operations apply each tick.
There is no hidden asynchronous queue or separate subscription scheduler.
Event and timer semantics will be defined separately in the next revision.

| Function | Meaning |
|---|---|
| below(limit) | Function receiving number and returning `value < limit` |
| map(f) | Transforms Ok(x) to Ok(f(x)); forwards Err(e) unchanged |
| and_then(f) | When f returns Result, connects Ok(x) to f(x); retains Err |
| recover(default) | Converts Ok(x) to x, Err(e) to default of the same type |

map/and_then/recover calls produce a resulting unary function.
The example's is_dry is `Result<number, SensorFault> -> bool`.
Here map transforms Result; it is not a separate stream-scheduling operation.

```ghost
dry = input.moisture |> map(below(35)) |> recover(false)
blocked = input.stop or (input.low_water |> recover(true))
```

Raw input faults remain in the journal regardless of whether computation occurs or recover is used.
Thus recover is a pure value transformation and does not erase an error from the record.
The examples block watering conditions using recover(true) for low-water errors and recover(false) for moisture-condition errors.

### Example: converting errors into control values without hiding them

The preceding pipe example preserves alternative B notation.
In the selected syntax, the same judgment can be read through explicit branches as follows.
This is a fragment inside a control declaring `sensor moisture: Percent;`.

```ghost
let dry = case moisture {
  ok(value) => value < 35%;
  fault(_)  => false;
};
```

For moisture `ok(25%)`, dry=true; for `ok(40%)`, false; for `fault(Disconnected)` or `fault(NotReady)`, also false.
The last two cases replace only the decision value with false; the original sensor fault remains in the input record.
Do not display this as "sensor normal."
Examples with noise processing and recovery operations are in the [sensor contract](CONSTRAINTS.md).

## 6. Device query

A device profile is a set of semantic capabilities supplied by the host.
The initial query model is `(kind, name, type)`; the same (kind, name) cannot be duplicated.

```ghost
match (pump:actuator<bool>), (valve:actuator<bool>),
      (low_water:sensor<bool>), (moisture:sensor<number>)
```

Names such as pump are semantic roles defined by the profile, not database row variables iterating over multiple devices.
Each item is a capability-presence condition; commas mean AND.
`sensor<number>` is the payload type. The Driver wraps and supplies samples as `Result<number, SensorFault>`.

Omitting a type, as in `(moisture:sensor)`, checks presence.
A type condition may be added with `where moisture.type is number`.
Where permits only kind/name/type of names appearing in match, comparisons with constants, and and/or/not.
input/state/next and current moisture values cannot be read in device-selection where.

This draft has no variable-length paths, relationship traversal, dynamic bindings, or per-query-result-row execution.
Extending a profile into a graph requires verification of unique bindings and traversal-cost bounds.

A strategy selects the single matching strategy with the highest priority.
A tie at the highest priority is an ambiguity error; no match is an activation error.
There is no declaration-order overwrite.

Common input is required by every strategy; strategy input is required only when that strategy is selected.
The profile checks intent-target and sensor-input capabilities, including their types.
Host inputs such as buttons undergo separate port-binding checks.
A missing sample itself is a tick-submission error, distinct from a correctly submitted Err sample.

The profile does not change during a tick.
Fault, recovery, and configuration changes are applied at a boundary after candidate-profile verification and strategy selection.
Fault inputs are handled immediately by the current strategy; a fallback lowering the protection level follows an explicit host operating policy.
The examples declare no automatic fallback.

## 7. Tick and state reads

1. Freeze strategy, profile revision, common/strategy inputs, and old state.
2. Compute let/with and every next definition from old state and the same inputs.
3. Construct complete candidate state, retaining old values for fields without transitions.
4. Compute intent/emit. State still reads old; next reads candidate.
5. Compute safe intent satisfying every safety constraint.
6. Logically commit state, output results, and execution records together.
7. Only the host of the actual execution applies safe intent to the Driver.

state.x is previous state in every expression; next.x is next state only in intent/emit.
Names do not change meaning during computation.
Reading next.y in a next definition is an error. let/with does not permit next references.

A/B let definitions are pure and have acyclic dependencies.
Aliases in C's single with clause are computed independently from the same old snapshot and do not reference each other.
With performs no row filtering or aggregation.
Output and state definitions are static and complete each tick.

On tick failure, state and ordinary output results are not partially committed.
The error is returned to the host, which applies its specified safe-output policy.
User code does not permit sleep, direct GPIO writes, unbounded loops/recursion, dynamic memory sizes, network calls, or runtime code generation.

### Example: every next state reads the same previous state

The following is a design example in the selected syntax, checking state exchange without device outputs.

```ghost
control SnapshotPair {
  input swap: Bool;
  state left: Bool = true;
  state right: Bool = false;

  left'  = if swap then right else left;
  right' = if swap then left else right;
}
```

On the first tick with swap=true, `(left, right)` changes from `(true, false)` to `(false, true)`.
Reordering the two transition expressions produces the same result.
Changing it as follows violates the design contract.

```ghost
// 잘못된 전이식: 다음 상태 참조는 출력식에서만 허용한다.
right' = left';
```

The `left'` on the right must be diagnosed as a compilation error rather than read according to computation order.

## 8. Output constraints

Requires makes target false when prerequisite is false.
Mutex makes every output in a group false if multiple outputs in it are true.
A uses lists; B uses `pump requires valve` and `mutex forward, reverse`; C uses `requires pump, valve` and `mutex forward, reverse`.

Targets must be bool intents present in every strategy.
Requires takes two different names; mutex takes 2–32 different names.
Constraints do not create true values.

The following defines these two bool-output constraints independently of declaration order.

1. Check all constraint violations against the same snapshot of current candidate outputs.
2. Simultaneously make the union of outputs selected for shutdown false.
3. Repeat until nothing changes.

An output that becomes false does not become true again.
With N bool outputs, at most N rounds contain changes.
The final result must satisfy every constraint.
Fault records include violated constraints and blocked output IDs.

Latched state is not physical feedback.
Safety blocking an output does not implicitly overwrite state.
Actual valve opening/pump operation is modeled with separate sensor inputs.
Physical default outputs on removal, device loss, or host failure belong to the Driver/host contract.

Extension to mode, shared-facility, and time constraints follows [CONSTRAINTS.md](CONSTRAINTS.md).
Output blocking, new-work permission, mode transitions, and warning analysis have different execution semantics.
Do not handle every arbitrary condition with the false-directed iteration algorithm above.
Multiple controls using one device must jointly obey that device's shared constraints.

### Example: output intent and blocked result differ

```ghost
control OutputGuard {
  input pump_request, valve_request: Bool;
  output pump, valve: Bool;

  valve <- valve_request;
  pump  <- pump_request;
  require pump => valve;
}
```

For requests `(pump=true, valve=false)`, requested retains and records those values; safe is `(pump=false, valve=false)`.
The valve is not automatically turned on to meet the condition.
This too is a logical-output example; it does not replace actual valve-open confirmation or mode interlocks.

## 9. Literate, code-as-data, and observability

Document-form `.ghost.md` source extracts top-level ghost code fences from Markdown in document order and passes them to the same parser.
One control may span several blocks; the entire joined source must be valid ordinary syntax.
No per-block execution semantics are added.
Explanations, ordinary code fences, and visualization results are not executed.
The detailed extraction, diagnostic, and original-location mapping contract follows [LITERATE.md](LITERATE.md).

Ordinary source and document-form source lead to the same AST and type graph.
The pipeline is `source → AST → syntax expansion → type graph → verification → bytecode`.
The graph is canonical for execution semantics; document prose, comments, and formatting are preserved as separate source information.
Do not assume all syntax surfaces can be converted into one another losslessly.

Inputs, named computations, state, intents, and constraints receive stable node IDs and source ranges.
An editor must allow current values, faults, change times, and influencing inputs to be inspected at code locations.
Local names such as blocked/dry are identified with the strategy name.
Intermediate-value tracing on the MCU is optional and size-bounded.
On a PC, values must be recomputable from recorded inputs.

Document, form, and graph edits undergo the same checks.
Graph edits alone do not regenerate explanatory paragraphs.
Macro calls are edited as original units; expanded results are observed separately.
Human-written explanations are retained while handling data and code together.

## 10. Compile-time syntax extension

Meta Lua was interpreted as a preference for Metalua's compile-time metaprogramming.
Syntax/quote/splice notation is proposed in the [example extension sketch](LANGUAGE-EXAMPLES.md).
Initial scope is typed expression templates; unrestricted syntax redefinition requires later review.

Macros receive ASTs, not runtime values, and produce ASTs.
Hygienic expansion must avoid capturing caller names.
After expansion, type, state-boundary, cycle, and resource verification is repeated.
New names and expansion size are bounded. Recursive expansion and reads of external files, networks, or clocks are prohibited.
Exceeding a limit is a compilation error.

Ordinary functions suffice for actual value transformations.
Even with macros, the design must require neither a macro processor nor a Lua runtime on the MCU.

## 11. Time travel and ghost comparison

The journal/checkpoint contract needs:

- Timeline/branch ID, logical tick, and base checkpoint.
- Module hash/schema version, profile revision, selected strategy, and selection reason.
- Inputs and faults, old/candidate state, requested/safe intent, and constraint intervention.
- Node IDs linking code locations; intermediate-value traces are optional and bounded.

Branch at a recorded time while preserving the original execution.
A Ghost runs in a separate instance of the same Rust core and has no physical effect sink.
Rewind is not a command moving a device to a past position.

Comparison aligns on the same logical tick and displays differences in state, requested outputs, safe outputs, and faults.
Wall clock is input data; logical tick defines order.
When branching to a profile with an additional sensor, if its input is absent from the record, an explicit virtual input trace must be supplied.
Missing sensor values are not automatically fabricated.

Sensor-processing state, mode/shared-resource permissions, cumulative limits, and schedule-occurrence records are also included in traces/checkpoints using those features.
Ghost virtual execution records do not modify or rewind a physical facility's persistent usage/schedule records.

A ghost with fixed recorded inputs shows differences in control decisions.
Predicting how changed pump behavior affects actual moisture requires a separate environment model.

## 12. Module replacement, deployment, and execution targets

Modules compiled and verified on the host are handled under the same execution contract in ESP-IDF Rust and WASM.
Users upload, activate, and remove logic modules. The host verifies ports, output ownership, profiles, and resource bounds.
Detailed syntax for multi-module connections and output arbitration is later scope.

Replacement commits at a tick boundary after candidate-module validation, strategy selection, state-compatibility checks, and ghost comparison when needed.
Failure retains the existing module.
Module/program replacement and firmware updates stop every device task controlled by the same ESP.
Changes to profile, binding, dependency, schedule structure, or rules also require an explicit stop and Configure procedure.
Limited runtime-adjustable properties differ from the structural-change path; syntax and semantics for applying them during operation follow [Reference §5.1–5.2](reference/05-settings-and-observation.md).
See the [implementation scope](IMPLEMENTATION.md) for execution boundaries.
Tick-boundary application does not substitute for the stop requirement of structural changes.
State with the same module ID and same name/type is migrated.
New fields take defaults; removed fields are removed.
A type change for the same name is rejected until explicit migration is supported.
An identifier spelling change is not treated as automatic state migration.

On replacement, clear the old input cache and receive complete inputs for the new schema again.
The host handles removed outputs under its release policy.
Boot uses declared defaults; persistent-state restoration must be a separate host policy verifying revision.
Daily budgets and duplicate-schedule prevention records are host-owned persistent state of the physical facility, distinct from ordinary control initial values.
Module replacement, reboot, or ghost rewind must not reset them to zero.

System/Logic/Profile/Web-assets updates are provided through the same OTA experience.
Partitions, slots, and transport paths belong to the host and are not exposed in control syntax.
Manifest and deployment-protocol implementation is excluded from this syntax-comparison work.

### 12.1 Compatible device replacement is not control-program replacement

Control programs use logical device contracts rather than models or addresses of actual sensors/actuators.
If the Driver and installation binding connect a different device satisfying the same contract, control source and the compiled Program must be retained.
Device replacement alone must not require recompilation.
The Driver owns device-specific communication and raw-value interpretation.

The same contract includes semantics/units, quality/time/error rules, and required capabilities, as well as types.
Changing sensor rules in source is a source change, distinct from a physical connection change.
This separation does not imply dynamic Driver installation or replacement without stopping.
Deployment cycles for Driver/firmware and installation binding are managed separately from control-source editions.

**Why:** to reuse the same control intent with different devices and prevent hardware replacement from causing unnecessary rewriting/recompilation of control rules.
Detailed rules follow [Language Reference §6.3 compatible device replacement and independence from recompilation](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성).

## 13. Implementation status and acceptance criteria

The following status is confirmed by reading current code.
Do not interpret new-specification requirements as completed implementation.

| Item | Current reference implementation | Remaining design/productization scope |
|---|---|---|
| Input syntax | control + literate + compatible S-expression | adapt, macros, multiple modules |
| Types/functions | Bool/Number/Percent/Duration, enum, static fn, sensor case | General ADT, higher-order function composition |
| Input schema | Every input required each tick | Common + selected-strategy inputs |
| State reads | state=old, next=candidate | Preserve and formalize this meaning |
| Safety constraints | false-only snapshot fixed point, requires-any | General logical-expression/optimization solver |
| Shared facilities/modes | Rust station + WASM API + static policy binding | Physical-device Driver/deployment approval boundary |
| Device supplementary-information analysis | Pass/Violation/Unknown for optional integer flow | Physical pressure/curve model, notification delivery |
| Sensor signal processing | Finite filters, hysteresis, quality, recovery | Actual board WCET/memory measurement |
| Time constraints | Monotonic timer, date-specific budget/occurrence ledger, desktop storage | MCU NVS, RTC trust, power-loss verification |
| Hot-swap type changes | Reject module renames and VM Bool↔Number changes for the same state name | Nominal enum schemas, explicit migration, host bundle replacement |
| Profile changes | Immediately clear active strategy | Commit at boundary after candidate validation |
| rewind/replay | Bounded journal, rewind deleting subsequent records | Branch preserving original, version/profile records |
| IR/source maps | Original AST node locations and literate line mapping | bytecode PC→node tracing, public typed graph |
| Resources | Expression-stack limits, Vec/Map allocations during tick | Verify state/trace/whole-tick resource bounds |
| Deployment | ESP32/WASM-based code | End-to-end verification of replacement/recovery/output-release contracts |

Current verifier limits are 128 each for inputs/states/intents, 32 strategies, 128 constraints, 4096 bytes per expression/query blob, and 128 for expression/query stacks.
These are initial reference limits, not verification of the maximum cost of new features.
Specifications and checks must be established together so new compiler/loaders apply the same limits.

Surface syntax for simple expressions can lower to existing opcodes.
Result, strategy inputs, and tracing information need explicit lowering or format extensions.
Do not claim current GFB1 supports them unchanged.
Unsupported modules must be rejected rather than silently changing semantics.

Use the following acceptance criteria when implementing the selected syntax.

1. Execute the common scenarios of all three examples in the selected syntax and compare against expectations.
2. Reordering next/intent definitions preserves results; invalid next references are rejected.
3. Requires chains and mutex satisfy final constraints regardless of declaration order.
4. Diagnose strategy conflicts, loss of mandatory devices, missing inputs, and Result type misuse.
5. Failed module/profile replacement does not partially change existing execution.
6. Ghost branches show differences at the same tick without touching original history or actual outputs.
7. Verify resource limits after function/macro expansion and link error locations to original text.

## 14. Syntax references

Alternative A's hierarchy, scalars, and block strings come from [YAML 1.2.2](https://yaml.org/spec/1.2.2/).
GhostFlow accepts a single document and restricted scalar/map/list structures; duplicate keys, anchors/aliases, merge keys, and user tags are rejected.
Only true/false and decimal numbers are interpreted as defined literals.
Other type notation and expression scalars are preserved as strings and parsed by GhostFlow.

The idea of writing explanations and code together comes from [Literate CoffeeScript](https://coffeescript.org/#literate).
Original Literate CoffeeScript uses indented code blocks.
Alternative B is a separate design selecting explicit ghost fences to distinguish executable blocks.

Device-pattern readability draws on [Cypher MATCH](https://neo4j.com/docs/cypher-manual/current/clauses/match/).
GhostFlow strategy/next/emit and type-parameter notation are original proposals.

Compile-time extension constructing ASTs draws on [Metalua](https://github.com/fab13n/metalua) and its [compiler documentation](https://github.com/fab13n/metalua/blob/master/README-compiler.md).
The original syntax and GhostFlow's proposed notation are distinguished.
