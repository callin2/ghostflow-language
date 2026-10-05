<!-- translation-source: docs/reference/06-composition-and-replay.md -->
[Korean original](06-composition-and-replay.md)

# 6. Composition, replay, and replacement

[Complete contents](../LANGUAGE-REFERENCE.en.md) · [Previous: Settings and observation](05-settings-and-observation.en.md) · [Next: Semantic rules and index](07-semantic-rules-and-index.en.md)

GhostFlow's unit of reuse is a behavior with meaning and a contract, rather than a code fragment. A behavior preserves control expressions, state, logical ports, settings and dependencies, constraints, and explanation provenance together. Composition is not copying and pasting this unit; it is instantiating an exact definition revision and validating typed relationships.

## 6.1 One semantic model and multiple graphs

Source, control, intent, ports, devices, observations, and events connect through stable identity. The same subject can appear in an editing document, HMI, timeline, simulation, and trace without becoming a new semantic object in each view.

Not all relationships are treated as one universal DAG. Each graph has different edge and cycle semantics.

| Graph | Edge meaning | Cycle rule |
|---|---|---|
| import graph | Definition depends on another definition revision | Reject executable import cycles |
| Computation graph within one tick | Value reads another value of the same decision | Reject combinational cycles |
| State feedback | Reads committed state from the previous tick | Allowed through an explicit state boundary |
| explanation graph | Evaluation evidence supports a result | DAG; reject cycles |
| installation graph | Logical port binds to physical capability | Separate ownership and compatibility rules apply |
| timeline | Occurrences follow in time order | Explicit branches and ordering relationships |

**Why:** Treating execution order, physical connections, and explanatory relationships under the same rules merely because they are lines on a screen creates hidden schedulers or false safety claims.

## 6.2 Definitions, instances, and logical ports

A definition revision identifies immutable canonical `.ghost.md` and its exact imported source closure. An instance is a separate execution unit using that definition within a composition. Even when the same definition is used twice, separate instance IDs, state, timers, settings, bindings, and provenance.

Display names, file locations, and declaration order are not identity. Changing declaration order while retaining the same instance IDs and input/time records must preserve results and identity-keyed traces.

A behavior's port is a typed logical role, rather than a physical pin number.

```text
Port pump of instance irrigation-east
  → installation binding
  → MainPump or board.RO3
```

A logical port preserves direction, semantic type, required or optional dependencies, and ownership requirements. Physical endpoints belong to separate profiles and binding revisions. A `Bool` input does not necessarily consume physical DI. An explicit software input may supply the same logical type.

Preserve existing bindings first and propose remaining capabilities for new ports. Matching types and directions do not prove polarity, loads, fail-safe behavior, or actual wiring. Without evidence, these are `unknown`; do not promote them to compatible or physically verified.

Physical endpoints are not limited to direct MCU GPIO. I/O expander channels and communicating relay channels may also be binding targets if they satisfy the same logical output contract. The Driver and installation connections own bus addresses, channel selection, and transmission procedures. Committing multiple output intentions in one language tick does not guarantee simultaneous physical channel switching.

### External observations and internal computed connections

A root `input` connected to an instance `input` forwards the existing typed-quality
acquisition contract, including sample identity and each declared conditioning
contract. An instance scalar `output` connected to another instance `input` is an
internal computed connection: its actually evaluated value is passed as
`Result.ok(value)`. The receiving definition still handles the Result explicitly
with `case`, `recover`, or another typed Result operation. The connection does not
recover an upstream error by itself; the producing scalar output already expresses
its definition's handling policy.

An internal computed connection creates no acquisition input, Good quality claim,
sample timestamp, sample identity, or sensor fault origin. Optional acquisition and
input conditioning annotations on that receiving port reject instead of being
silently discarded. These annotations remain meaningful for acquisition forwarding.
Committed-state output feedback retains the previous-tick boundary; wrapping a
computed value does not authorize combinational cycles or next-state feedback.
Root external Results cannot connect directly to scalar outputs without authored
Result handling.

**Why:** A calculated value and a producer observation have different evidence.
Reuse keeps the receiving definition's Result contract while preserving the source
of acquisition quality and the explicit state boundary.

## 6.3 Parameters, settings, dependencies, and bindings

These four relationships similarly connect values, but have different lifecycles.

| Relationship | Role | Change effect |
|---|---|---|
| import parameter | Specializes a definition to specific values | New composition/source revision and usually new artifact |
| operator setting | Changes operating values of the same Program | Same Program/run, new settings revision/effective position |
| dependency | Selects required external behavior/capability | Revalidation of pinned closure and compatibility |
| binding | Connects logical ports to installation endpoints | New installation/binding revision |

Do not erase these differences into one untyped `with` map. In particular, operator settings cannot change dependencies or physical wiring; import parameter changes are not handled as live settings.

### Compatible device replacement and independence from recompilation

A GhostFlow Program targets logical port contracts and does not use installation-specific device models, communication addresses, or pins as executable-rule identity. Drivers handle device-specific communication and value interpretation; bindings connect the actual endpoints that supply logical port values or apply outputs.

**Replacing a physical device or Driver that satisfies the same logical device contract does not require editing control source or recompiling the Program.** Retain the canonical `.ghost.md`, source revision, and compiled Program; change the relevant installation profile/binding revision. The execution environment manages the Driver's own deployment revision.

Compatibility is not established merely by matching names or primitive types. The replacement must satisfy the existing program's required direction, meaning, units, ranges, sample timing, quality/error contracts, and capabilities. Source rules such as sensor `sample`, `valid`, `filter`, `stale_after`, and `recover_after` do not automatically adapt to replacement devices. Do not approve a compatible replacement if it cannot satisfy the contract.

Changing the rules in source is a source change. Changing only values exposed through `config` is an operating settings change. Dynamic Driver installation, firmware updates, and physical replacement procedures belong to the execution environment. Reusing a Program does not guarantee uninterrupted replacement or automatic continuity of existing runs and sensor state. Application procedures follow [§4.10](04-sensors-constraints-control.md#410-mode와-live-settings); sample continuity and recovery follow [§4.2](04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서).

**Why:** Just as replacing a printer Driver does not require recompiling a document program, device-specific differences should be handled behind a common contract. This separates control intent from hardware replacement cycles.

## 6.4 Import and connection syntax

Each document still defines one `control`. A document-level import pins a complete `.ghost.md` definition; its control is used as an instance in the body.

```ghost
import Irrigation from "./irrigation.ghost.md"
  revision "rev-42"
  sha256 "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

control Farm {
  input east_start, west_start: Bool;
  output east_pump, west_pump: Bool;
  instance east: Irrigation;
  instance west: Irrigation;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_pump <- east.pump;
  connect west_pump <- west.pump;
}
```

The digest above is a placeholder. Compiling an actual example requires the exact UTF-8 SHA-256 and immutable revision of the referenced document. The path is a locator relative to the importing document, rather than identity. Execution does not read files or networks outside the source closure supplied by the resolver. Browsers and devices resolve against the same complete original-source closure.

```text
import_decl    ::= 'import' Identifier 'from' String
                  'revision' String 'sha256' HexDigestString ';'
parameter_decl ::= 'parameter' Identifier ':' type '=' constant_expr ';'
instance_decl  ::= 'instance' Identifier ':' ImportAlias
                  [ '(' named_constant_args ')' ] ';'
connect_decl   ::= 'connect' sink_port '<-' source_port ';'
```

Parameters are declared inside the definition's control. For example, `parameter duration: Duration = 5min;` is specialized with `instance east: Irrigation(duration = 10min);`. Arguments bind by name; omitted arguments use declared defaults. Reject duplicate or unknown arguments, nonconstants, and type mismatches. Parameters do not change during execution and cannot share names with operator settings. Public top-level functions and types are referenced as `Irrigation.name`. Another control's internal state, let, and timers are inaccessible.

A `connect` source is a root input or instance output; a sink is an instance input or root output. Types must match exactly. Each input has one supplier; all required inputs must be connected. Root outputs are defined by either ordinary `<- expr` or `connect`, never both. Do not erase sensor-port quality into ordinary value ports. Sensor connections are allowed only from root sensors to instance sensors with the same payload type and sample/quality contract. Each instance's declared filter and freshness rules continue to apply.

Sensor connections require matching payload type, optionality and declared sample
interval. Each instance receives the same root raw sample identity, timestamp,
quality and value. A root's already-conditioned reading is not substituted.
Instances own independent filter, recovery and stale state. Function parameters
and case bindings retain lexical scope; definition functions and calls are
isolated per instance.

`bind` is not control source syntax. Installation bindings connect root logical ports to actual endpoints. Do not place GPIO addresses, bus addresses, or credentials in this program.

Composition rules are as follows.

1. Imports pin exact immutable revisions and digests, rather than catalog `latest` or display names.
2. Transitive imports also form a fully pinned closure; reject missing entries, digest mismatches, and import cycles.
3. Canonical source authority remains with each original `.ghost.md`. A composition graph or generated manifest is not a second editable program.
4. Avoid collisions through instance-qualified names without erasing original definition and source-node provenance.
5. Do not include local site bindings, credentials, conversations, or runtime history in reusable definitions.

## 6.5 Invariants of composed execution

Composition preserves single-control tick semantics.

- All state transitions read the same input snapshot and previous state snapshot.
- Do not read a state's next value as a same-tick value from another state transition expression or `let`.
- Only output expressions reference permitted next state.
- State and logical output results commit together as one decision.
- Each instance's state and timers are isolated from other instances.
- Do not use declaration or traversal order as scheduling or priority.
- Reject instantaneous dependency cycles within the same scan before execution. Feedback through committed state from the previous scan is a separate explicit time boundary.
- Check the prohibition on next-state references transitively along port connections. Also reject connecting outputs computed from another instance's next state to same-scan state transitions.
- Each logical output channel has only one authoritative direct definition. Reject competing writers rather than resolving them through last-writer rules.

Resources needing arbitration, such as shared pumps, receive requests through an explicit station/resource manager. Multiple behaviors using the same physical resource do not justify multiple direct output writers. Do not generalize an existing station's pump/valve policy into a universal arbiter for every resource.

## 6.6 Resources and contracts

Composition contracts check the following in their initial scope.

- Port direction and semantic type
- Presence and exact revision of required dependencies
- Import parameter types and bounds
- Exclusive output/resource ownership
- Compatibility with supplied installation contracts

Results distinguish declared assumptions, static checks, runtime-enforced constraints, and physical verification. Reject invalid ports or missing dependencies specifically. Installation suitability without evidence remains `unknown`. Matching channel counts or passing simulation alone do not establish safety or physical suitability.

Diagnostics supply reasons, affected definitions/instances/ports, expected and actual values, evidence revisions, and corrective choices. For example, if two instances claim ownership of one exclusive pump, identify both instances and ports and reject before activation.

## 6.7 Composed explanations and provenance

Composed explanations preserve the following paths.

```text
completed occurrence
→ requested / safe output
→ instance-qualified explanation node and constraint
→ imported definition's source node/span and intent anchor
→ exact source revision and import closure
→ settings revision and binding revision
```

Do not merge traces of multiple instances of one definition merely because their names match. Do not flatten nodes located in different source documents into one synthesized location. When low-water input blocks a pump request, the signal and logical result can be reported, but do not prove the tank's actual physical state. Driver application failures or missing feedback are also displayed separately from requested/safe stages.

## 6.8 Replay, ghost, and branches

Replay recomputes recorded inputs, faults, logical time, and starting checkpoints with the same language semantics. Ghost is a separate instance using the same execution core without a physical effect sink.

Replay/branch records require timeline/branch ID, baseline checkpoint, Program and source closure, instance, settings and binding revisions, `runId`, logical tick, inputs and faults, old/candidate state, requested/safe intent, and constraint interventions. Intermediate traces are bounded optional information.

Create a branch at a particular occurrence while preserving the original timeline. Compare state, requested intent, safe intent, and faults at the same logical tick. Wall clock is input data and does not replace the alignment basis. Do not automatically generate sensor values absent from the record. Supply what-if values as traces identified as virtual inputs.

Rewind does not move actual devices to past states. A ghost branch does not modify actual usage ledgers, schedule occurrence records, or physical installation state. Predicting long-term environmental effects of different outputs requires an environmental model separate from control replay.

**Why:** To reproduce the effects of rule changes on identical inputs while preserving actual devices and original records.

## 6.9 Program hot replacement

Program replacement differs from operator settings events. Validate a candidate with a new source revision or import closure; check port, ownership, profile, resource, and state compatibility; then commit atomically at a tick boundary. If validation fails, retain the previous Program.

Only state explicitly defined with the same name and type under the same module identity policy can transfer. New state uses declared defaults; removed state disappears. Reject same-name type changes, implicit renames, and merging state from different instances without explicit migration. Discard previous input caches and receive a complete input snapshot for the new schema. Removed outputs follow the host's release policy.

The replacement Program has new artifact/source identity and a new run boundary. Do not join old and new traces into one run as though this were a settings change. Persistent records owned by physical installations, such as accumulated usage and schedule deduplication, are not initialized by ordinary control-state migration or ghost rewind.

## 6.10 `syntax`, `quote`, and splice syntax

Pure functions are appropriate for ordinary value reuse. Use compile-time syntax extensions only to construct recurring domain structures themselves. Extensions are limited to typed expression ASTs.

```ghost
syntax hold(start: Expr<Bool>, stop: Expr<Bool>, held: Expr<Bool>): Expr<Bool> {
  quote { !$(stop) && ($(start) || $(held)) }
}

running' = @hold(start, stop, running);
```

Declare `syntax` at document level. Arguments and results are `Expr<T>`, where `T` is a complete value type. The body is one `quote { expr }`. `$(parameter)` splices that AST; `@hold(...)` expands at the call site. Only declared macro argument names are permitted inside splices. `Expr<T>` is not a runtime value type and cannot be stored or returned as input, state, or config. Reject splices outside quotes, unknown arguments, type mismatches, and macros creating declarations.

Spliced names resolve at the call site. Names written directly in quotes resolve at the definition site. Macro arguments or same-name caller locals do not intercept definition-site names. Splicing an argument multiple times places the expression multiple times. Do not assume single evaluation as in a function; each position follows ordinary lazy evaluation rules. Declarations creating memory, such as timers or filters, cannot be hidden inside expression macros.

Expansion does not read runtime values. It must be hygienic and not capture caller names; expanded results undergo type, state-boundary, cycle, and resource checks again. Recursion, external files, network or clock reads, and unlimited AST generation are prohibited. Macro call graphs must be acyclic. Compilation targets specify the maximum permitted expanded node count; exceeding it produces a compile error rather than truncation. This limit is a target resource bound, rather than a setting changing language execution results. Preserve source/intent provenance between original macro calls and generated nodes so explanations can return to human-authored locations. Syntax expansion itself must not become work performed during operation or a new physical effect.

## 6.11 Design rationale and evidence

Pinned imports and separate instance identities support both reuse and reproducibility. Separating logical ports and physical bindings allows the same behavior in different installations. Execution invariants and cycle rejection prevent declaration order from changing results. Replay and effect boundaries allow changes to be compared without moving actual installations. Restricting macros to compile time adds domain notation while preserving execution costs and provenance.

Rationale: [Language model](../LANGUAGE.md), [Syntax alternatives and macro notation](../LANGUAGE-EXAMPLES.md), [Programming in GhostFlow](../ProgrammingInGhostflow.md), [Portable package](../PORTABLE-PACKAGE.md), [#99](https://github.com/callin2/ghostflow-language/issues/99), [#100](https://github.com/callin2/ghostflow-language/issues/100), [#101](https://github.com/callin2/ghostflow-language/issues/101), [#102](https://github.com/callin2/ghostflow-language/issues/102), [#103](https://github.com/callin2/ghostflow-language/issues/103), [#104](https://github.com/callin2/ghostflow-language/issues/104), [#105](https://github.com/callin2/ghostflow-language/issues/105), [#106](https://github.com/callin2/ghostflow-language/issues/106), [#107](https://github.com/callin2/ghostflow-language/issues/107), [#108](https://github.com/callin2/ghostflow-language/issues/108).
