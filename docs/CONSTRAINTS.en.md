<!-- translation-source: docs/CONSTRAINTS.md -->
[Korean original](CONSTRAINTS.md)

# GhostFlow common constraints and sensor signal contract

The 2026-10-05 external-input revision uses `input` for quality-bearing declarations. Existing conditioning and explicit `Result` fault branches are unchanged; prior `sensor` excerpts remain under `tests/fixtures/history/issue531/`.

2026-09-24 · Common design contract.
Current syntax and semantics for operating settings follow [Reference §5.1–5.2](reference/05-settings-and-observation.md).
See [implementation scope](IMPLEMENTATION.md) and [traceability](TRACEABILITY.md) for execution coverage.
This is a subsequent contract for the [selected control syntax](LANGUAGE-SURFACE.md).

The canonical authored surface is named `constraints` inside one `.ghost.md`
control. Local Bool output constraints, shared resource policies and accounting
use named groups but have distinct targets and execution contracts. Follow
[Reference §4.8](reference/04-sensors-constraints-control.en.md#48-common-constraints-notation-and-operations).
The existing standalone `constraints Name { ... }` examples below are **Station
adapter examples**. Retain that bounded `ghostrules` path only for the actual
programming-book WASM simulation, `tools/station-demo.mjs` and the fixed Station
artifact consumed by `bindStationPolicy`. It is neither generic canonical syntax
nor arbitrary PID safety enforcement. Historical notation alone does not justify
another compatibility path. The CLI extracts top-level `ghost` fences and rejects
plain `.ghost` input. `compileConstraints` is the Station adapter's internal
lowerer, not a generic solver. Do not confuse shared descriptor validation with
actual binding and enforcement.

## Canonical local, shared and accounting boundaries

Complete canonical files are [the executable local envelope](../examples/constraint-envelope.ghost.md)
and [the checked shared contract with its complete logical mapping](../examples/shared-constraint-contract.ghost.md).
`validateResourceConstraintBinding` validates revision, exact canonical source/artifact
digests, every required stable resource identity and typed port, and every finite
exclusive-mode input. It rejects missing/extra mappings, disguised duplicate
resource identities or ports, and host-supplied policy fields. Validation returns
`executable: false`; it grants neither admission nor output authority.
To select execution, pass the validated compilation and binding together to
`compileBoundResourceControl(compilation, binding)`. This explicit path emits a
bounded Bool GFB17 module with a shared Rust guard. Compiling canonical source
alone does not silently turn the checked descriptor into an executable artifact.
This is a reference logical binding contract, not a physical output ABI.

Executable groups support at most one exclusive activity set. Multiple exclusive statements remain checked source but require separate execution integration; reject them rather than flattening their distinct sets. The authored global safe vector must also satisfy mandatory local constraints.

This is a complete local-constraint control. Local constraints apply only to
this control's outputs and execute through ordinary Bool lowering. Existing
ungrouped `require` and `mutex` retain the same meaning.

```ghost
control LocalPump {
  input request, valve_ready: Bool;
  output pump, valve: Bool;
  pump <- request;
  valve <- valve_ready;
  constraints LocalRules {
    require at safe_output pump => valve;
  }
}
```

A shared resource policy states its scope with `constraints Name for resource`.
This is **complete checked source producing a non-executable descriptor**.
`ghostc` source checking validates declarations, types, finite sets and safe-value
relations. `compileControl` and composition reject this policy while its executable
binding is absent. Separate explicit bound compilation selects execution.

```ghost
control SharedPumpPolicy {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, pump_request, valve_request: Bool;
  output pump, valve: Bool;
  pump <- pump_request;
  valve <- valve_request;
  constraints SharedRules for station {
    exclusive at admission { automatic, manual };
    require at safe_output pump1.on => any_on({ valve1 });
    safe { pump1 = false; valve1 = true; }
  }
}
```

`safe` explicitly assigns every Bool resource in the finite referenced set and
must satisfy all mandatory output relations. These values are pump OFF and valve
ON, not a hidden all-OFF default. Do not assume the source `pump`/`valve` requests
have been connected to physical resources. Validated stable resource identities
and typed port mappings plus explicit bound activation enable the logical
enforcement described below.
Former top-level resource-policy files also remain checked non-control artifacts,
never enforced controls. Do not invent `station`, `use`, `bind` or session syntax.

## Shared Bool execution

See [bound-resource-execution](../examples/bound-resource-execution.ghost.md)
for the complete executable example, explicit binding and recorded inputs/results.
The #157 shared checking example above retains its existing non-executable
descriptor contract.

The bound profile in [#158](https://github.com/callin2/ghostflow-language/issues/158)
executes one Bool control and a finite resource set through a shared Rust tick
guard. Every output must be resource-bound with an authored complete safe vector.
The binding pins #157's exact canonical source/descriptor digests, revision,
stable IDs and Bool mode-input/output mappings. Supply it explicitly on module
activation as GFRB1 and supply the same binding identity as a GFRS1 packet on every
scan. Rust APIs are `activate_with_resource_binding(bytes, &ResourceBindingRegistry)`,
`tick_with_resource_binding(bytes)` and `ScanDriver::scan_with_resource_binding(frame, bytes)`.
Missing or mismatched
binding fails closed. An ordinary loader may parse the module, but ordinary
activate/tick/scan cannot bypass the guard. Execution is not a JavaScript filter
added after publishing outputs.

GFB17 wraps only existing GFB1 v1 or v3 programs with every input/output port Bool,
including the guard in their commit boundary. Automatic, manual and fallback
source using short-circuit evaluation lowers to v3. Other inner profiles are
unsupported. Outputs from every supported branch pass
through the same Rust guard. Context schedules, objectives/PID, import composition
and group overlaps with ambiguous safety meaning are rejected outside this bounded
profile. The installation authority must make every logical writer use the same
`ResourceBindingRegistry`. Native activation receives a shared Arc registry; the
WASM ABI shares one registry across all handles within an instance. Both refuse
a second active writer for the same stable resource ID. The Node reference wrapper
also checks different WASM instances through one module registry. Station and Bool
resource IDs are both covered. Separate installation registries do not certify
physical exclusion across installations. This does not provide cooperative
multi-VM arbitration, session leases or a general
physical output ABI. Existing Station adapter, accounting execution paths and
nonblocking `check` remain unchanged.

Mandatory group conditions combine as AND. A new activity claim conflicting with
the current admission is denied while incumbent admission and previous safe
outputs remain. A requested candidate violating a mandatory output relation
before starting creates neither new admission nor protected output. A denied
newcomer must be observed false before requesting admission with a fresh true claim.
The first
denial has an empty output set because no previous output exists; otherwise retain
the previously committed safe values. Do not invent prestart replacement outputs
from the descriptor's safe vector.

If an already admitted execution's requested candidate violates a mandatory
relation, transition to its authored resource-specific safe vector. Preserve
safe behavior with some outputs ON, such as pump=false and valve=true. Normal
inputs after a trip do not automatically restart execution. An exclusive group
requires an observation with all claims false, followed by a fresh claim satisfying
every admission condition. A require-only group establishes a recovery baseline
when its requested map equals the authored safe map, then checks a fresh departure.
Trips propagate across the transitively connected component of groups sharing
protected resources. Authored safe values must agree on shared resources;
unrelated groups retain their admission. Revalidate the final safe candidate
against the AND of every mandatory shared and local constraint.
Do not hide the old claim in a retry queue. Distinguish raw claims from
admitted activity and requested from final safe values, retaining the cause,
group, binding and scan evidence.

A successfully evaluated denial commits ordinary VM state. Denial does not mean
cancelling the program's job/session or restoring every state to its previous value.

A binding error or VM failure rolls back VM state, guard admission and trace
together. Do not partially change protected state or commit rejected-scan evidence.
Logical safe outputs differ from Driver applied and physical feedback confirmed.
Actual Driver sequencing, physical safety devices and field installation are
outside this profile's validation scope.

Accounting declares the existing `resource` and `account`, then uses
`constraints Budget { limit used(account, basis) <= bound { ... } }`.
Do not replace local Bool conditions or shared admission with a usage ledger.
[Reference §3.10](reference/03-time-and-schedules.en.md#310-time-based-usage-constraints)
defines the usage stage, basis and persistence.

Constraints form the **permitted region** for requests, including goals/PID.
Local constraints affect only their own control; shared constraints apply to all
automatic, manual and fallback paths using the same resource. A predicted violation
before starting denies new admission. During execution, follow the authored
resource-specific safe behavior rather than unconditionally turning everything
OFF. This distinction does not implement a general output ABI or physical safe
sequence. Do not generalize the existing narrower PID engine contract into
arbitrary resource-policy enforcement.

All mandatory conditions combine as AND. Decide admission first, check safe_output
relations on the requested candidate, then let the Driver apply it. Arbitration
priority chooses within the permitted region; it cannot bypass mandatory
constraints, binding, provenance or recovery requirements. Retain violation causes
separately from denials and safe transitions. Normal observations do not create new
start authority; retries and recovery follow the same rules. `check pump_capacity`
is a nonblocking advisory in the Station adapter below, not a mandatory require.
`warn` and `monitor` are unsupported; do not silently promote warnings to safety
requires or commands.

## Direction established in this conversation

- Automatic operation, manual operation, and configuration mode of the same watering facility are mutually exclusive.
- Automatic↔manual and operation→configuration transitions require the user's explicit stop and completion of stopping.
- Structural changes follow explicit stop and Configure procedures. Limited runtime-adjustable properties follow the atomic-event contract during operation below.
- [2026-09-20 revision: the previous decision, "all application of operating conditions is allowed only in stopped configuration mode," was replaced under #110 solely for runtime-adjustable property values. Stop and Configure procedures for structural changes remain.]
- Declare interlocks, simultaneous valve-count limits, facility capacity, and daily operation time as common constraints. Facility-wide constraints continue to apply when individual controls are added.
- Provide sensor-noise and data-disconnection handling as named signal operations with bounded resources.
- Guarantee clock-correction duplicate prevention and daily usage limits separately.
- **All supplementary device information, including pressure, flow, and performance curves, is optional.** Basic watering, mode interlocks, valve-count limits, and time limits must be usable without entering that information.

These are user decisions concretizing the earlier automatic/manual-request priority and preemption proposal.
A policy immediately executing manual requests during automatic operation solely by priority does not apply to this facility.

## Where constraints are described

`constraints` is a named group of rules.
Attach local constraints inside a control and shared constraints to a facility scope defined by the device profile.
When multiple controls reference the same pump, they share constraints and usage for one physical pump ID.

This and the subsequent standalone groups are facility examples for the fixed Station adapter.
`station`, `pump1`, `settings`, and `starts` connect to stable IDs of facilities/settings/schedules.
`pump1.valves` is a finite valve set with preregistered supply relationships.
Do not connect by discovery order or display name.

Station adapter example — bounded standalone rules for the fixed facility adapter.

```text
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);

  // Stop condition for applying structural configuration (lowerer rule: configureOnly); distinct from operator setting events
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);

  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
}
```

`automatic`, `manual`, and `configuring` are permitted mode/session active states of the same facility, not incoming request buttons themselves.
The mode manager owns one `Stopped | Auto | Manual | Configure` value; those names derive from it.
`exclusive` can also be used for general groups of activities.

| Kind | Meaning | Default handling on violation |
|---|---|---|
| exclusive | Modes/activities that cannot be simultaneously active | Reject conflicting new entry |
| allow ... only when | Preconditions for entry/configuration application | Reject the request, retain existing state |
| require | Final-output invariant of a facility | Permission check before starting and safety monitoring during execution |
| limit | Upper bound on cumulative time/count/consumption | Check remaining budget and block operation at the limit |
| once ... per occurrence | Duplicate suppression per scheduled occurrence | Do not re-execute an already accepted occurrence |
| check | Non-blocking analysis using optional information | Pass / Violation / Unknown diagnostic; does not block execution |
| warn ... when | Future design notation; currently rejected by both parsers | Record a warning event with cause and target |

Local-control one-line Bool `require` and this Station adapter have different execution paths.
A warning is not an exception allowing a constraint violation; clearing it does not release mandatory constraints.
The host owns notification delivery and does not repeatedly send the same violation to users every tick.

The checking stage is determined by a constraint's target.
`count_on`/output relationships apply to final output candidates; `enter`/`apply` to request entry; `pump_capacity` to new-work permission.
Do not implicitly mix these stages. General expressions lacking a defined target stage receive compilation diagnostics.

## Shared pumps across multiple controls

The session/arbitration explanation in this section is the facility contract of
the fixed Station adapter below. The bound Bool profile above permits one active
writer; it does not claim multi-VM session arbitration or physical usage rights.

The shared-resource manager is the sole output writer for a physical pump.
Individual controls' outputs are requests, not last-writer-wins GPIO writes.
A `false` request from an inactive control cannot interrupt watering owned by another control.
Use an explicit facility-stop request if another control must be stopped.

The initial shared-pump policy is **exclusive ownership for the entire watering session**.
Ownership is retained through valve opening, pump operation, pump OFF between phases, and valve cleanup.
Another control does not acquire ownership merely because the pump briefly turns off between these stages.
The pump does not immediately start merely because a valve is open; follow the owner's phase outputs and the device's safe application sequence.

Arbitrate every start request in the same tick from one snapshot.
Permit only requests securing both ownership and time budget.
The Driver applies outputs after logical permission commits; if persistent reservation is needed, postpone output start until that succeeds too.
Use the same request ID on process retries.
This process does not guarantee physically simultaneous application of multiple GPIOs.

Under a policy preserving existing scheduled times, a new control is permitted only if its full session upper bound and cleanup time fit into a vacant interval.
Do not check only whether the pump is currently OFF.
Watering-phase timers do not start while awaiting resources.
Request order is determined by acceptance order and stable IDs; queue length and expiry are bounded.
Shared concurrent operation or preemption is a separate opt-in policy and does not release mode interlocks.

### Example: applying the same rules to two existing and two added valves

This case binds the existing and new controls' pumps to physical `pump1`, and their valve ports to `valve1`–`valve4` respectively in installation configuration.
These connections are device bindings required for control, not pressure/flow metadata.
The following rules attach to that facility.

Station adapter example — bounded standalone rules for the fixed facility adapter.

```ghost
constraints SharedPump {
  // pump1.valves는 두 control을 합친 네 밸브의 집합이다.
  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);

  // 자동/수동과 control 수에 관계없이 물리 펌프 하나의 사용량이다.
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
}
```

While the existing task owns the session, a new task cannot start even if the pump briefly turns OFF.
It is permitted after the existing task finishes if its entire session fits before the next schedule.
These rules alone do not implement an arbiter. Specific syntax connecting session ownership and permission inputs is later scope.
Do not substitute output OR or last-writer-wins between the two controls.

## Mode interlocks and completed stopping

Mode exclusivity applies to every control and manual UI command connected to the same facility.
Multiple automatic controls of one pump coordinate resource use under the same Auto mode.
Do not automatically impose one global mode on independent facilities.

```text
Auto or Manual
  → explicit stop request
  → stop procedure for ongoing work / inhibit new starts
  → stopping complete
  → Stopped
  → request entry into Auto, Manual, or Configure
```

`enter` rules check requests to enter modes other than Stopped.
They do not block the stop request itself.
A temporarily off pump or waiting for the next schedule while in Auto does not permit direct transition to Manual/Configure.

The Configure configuration session and `apply(settings)` in this section mean structural configuration changes.
Restarting is prohibited during that session.
Validate and atomically apply structural changes; close the configuration session and return to Stopped before accepting separate operating-mode entry.
Remote APIs undergo the same checks. Disabled screen controls alone do not implement constraints.

If requests to enter different modes conflict in one tick, reject them all and retain the existing mode.
Retransmitting the same request ID does not process it twice.
Stop is processed before mode entry and new-watering permission in that tick; it increments the stop generation and discards uncommitted requests of the previous generation.
Even if the previous snapshot was Stopped, do not permit a new start arriving with Stop in the same tick.

`stopped(station)` does not simply mean the pump request is false.
It means ongoing watering and cleanup have finished, facility ownership has been returned, and stop confirmation for that device profile is complete.
If feedback exists, check actual stop/valve state.
Without feedback, state the limitation that confirmation rests on commands and the stop procedure established at installation.
Do not claim one mode enum substitutes for physical interlocks or guarantees of actual-state feedback.

Record stop evidence separately as `CommandedStop`, where the Driver reports safe-output application and completes configured cleanup/wait procedures, and `VerifiedStop`, where actual feedback is also confirmed.
The basic configuration permits CommandedStop and does not make feedback sensors mandatory.
It does not display this as verified actual stopping.
If the device does not respond or safe-output application fails, sending a command alone does not establish completed stopping.
Only user-added rules may require VerifiedStop.
Initial safe-output sequence/wait values may use device-driver defaults; separately display the limitation that their suitability must be checked for a particular installation.

Stop requests also cancel/invalidate pending starts.
Do not queue a mode-change request during operation and later transition automatically without the user's knowledge.
Restart requires a new explicit request.
Distinguish editing source-document descriptions during configuration from applying operating conditions to a physical device.

Structural Configure application is one facility revision including relevant control versions, port/supply relationships, constraints, schedule structures, optional checks, and relevant metadata.
Report application success only after validating the whole candidate and completing an atomic persistent replacement of the active revision.
After power loss, select only the complete previous or new revision; do not mix parts.
Requests include the revision and stop generation at authoring time.
If they mismatch when permission is evaluated, reject them rather than automatically reinterpreting them with new meaning.
This revision is not a reset key for actual-usage/duplicate-prevention ledgers.

### Runtime-adjustable properties and structural changes

Syntax and application semantics of operating settings are defined by [Reference §5.1–5.2](reference/05-settings-and-observation.md).
`access = operator` in `config` metadata declares operator-changeable settings.
Values marked `access = designer` or lacking declared operator access cannot be changed through operating-setting events.
There is no `apply` field. The current compiler rejects both `apply = stopped` and `apply = live`.

Executable program/rules, device binding/profile, dependency, and schedule structure changes are structural changes.
Explicitly exposed values such as schedule start times and Duration do not become structural changes merely because they belong to a schedule.
Making an optional check mandatory is a rule change.
Structural changes follow explicit stop and Configure procedures and are distinct from operating-setting events.

Each operator action is one atomic live event containing the settings to change together.
Validate the whole batch; reject it entirely if any value is invalid.
Rejection does not stop independent ordinary operating rules.
Read new values from the application position of a valid event, without waiting for the next watering cycle or new run.
Do not change snapshots during evaluation; event/scan order follows Reference §5.2.
Retain source/bytecode, program identity, and run identity; record settings revision and effective event position.
Do not implicitly initialize state or timers.

Canonical Temperature values and preservation of `displayUnit` follow [Reference §5.1](reference/05-settings-and-observation.md#51-config-선언).
Settings changes to a Range in progress follow [Reference §3.5](reference/03-time-and-schedules.md#35-schedule의-공통-의미).

Accepted ordinary operating settings survive physical ESP restart.
Restart creates a new run and does not mean automatic restoration of previous program state.
Authored rules determine restart response; electrical-output obligations before the first decision remain at the Device boundary.
Do not impose one automatic/manual boot policy universally.
Shared-resource arbitration, station mode transitions, usage ledgers, and explicit stop procedures continue to apply.
Updating an ESP's program/module or firmware stops every device task controlled by that ESP.

### Example: operating-setting declaration and structural Configure application

The following is an operating-setting declaration fragment inside a control body.

```ghost
config water1_time: Duration = 5min { min = 1min; max = 30min; step = 1min; access = operator; }
```

An operator change to this declaration is an atomic live emission to the same program's typed Result stream.
Consumers handle the current observation with `case water1_time { ok(value) => ...; fault(reason) => ...; }`.
Delivery is separated from consumer source. The same setting change does not edit a source literal or recompile.
The precise boundary is recorded in `docs/OPERATOR-SETTINGS-STREAM.md`.

`settings` in the separate constraint below is a **structural configuration revision**.
This is not an example attaching a stop condition to operator changes of `water1_time` above.
`mode` and `station` are names supplied by the facility manager.

Station adapter example — bounded standalone rules for the fixed facility adapter.

```ghost
constraints EditInterlock {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);

  allow apply(settings)
    only when mode == Configure && stopped(station);
}
```

The `configureOnly` rule in `tools/constraints.mjs` and station `apply_config` are stopped Configure paths.
Accept a new operating request after validating and applying a structural candidate.
Do not conflate validation/application of operating-setting events with physical CommandedStop/VerifiedStop semantics.

### 2026-09-20 research record and subsequent decision

The research then recorded in [language #89](https://github.com/callin2/ghostflow-language/issues/89) and [system #54](https://github.com/callin2/farm_studio_system/issues/54) discussed live property events starting from stopped-setting application and source-edit/recompilation paths.
The `apply = stopped` example, unsettled exposure syntax, and `settings.valid` design sketches from that time are historical records, not current executable syntax or replacement contracts.
Operator-setting syntax and atomic live semantics settled since 2026-09-22 follow Reference §5.1–5.2 above.

## Device supplementary information is optional

Device supplementary information such as pressure, flow, pump curves, power consumption, and pipe losses is not mandatory input for basic programs.
Distinguish it from minimum binding identifying devices and connecting output ports.
Installing feedback sensors that report actual state is not universally mandatory either.

| Configuration | Available features | When supplementary information is absent |
|---|---|---|
| Basic control | Schedules, sequential control, automatic/manual/configuration interlocks | Still usable |
| Directly declared rules | At most 2 simultaneous valves, at most 1 hour per day | Checkable without pressure/flow |
| Optional capacity analysis `check` | Diagnose excess capacity using supplied device information | Only that analysis is Unknown (insufficient information); no operation blocking |
| User-added mandatory capacity rule `require` | Permit only requests with verified capacity | Cannot permit starts for the facility subject to that rule; this is not the default |

Do not replace missing values with zero, infinite capacity, or normal values.
Optional fields are Option; analysis results carry Pass / Violation / Unknown and a reason.
Unknown means insufficient information or outside analysis scope, neither an error nor a pass.
Do not send repeated fault notifications for unentered data. Display unverified items in the analysis screen.

With partial information, perform only checks with complete inputs and leave the others Unknown.
Do not display a passed flow-limit check as a complete hydraulic-safety guarantee including pressure verification.
Invalid directly entered values/units can be diagnosed during editing and rejected on application; omitting a field is not itself an error.

### Example: basic rules and optional analysis for the same facility

The following basic rules can be used even when no pressure/flow information is entered.

Station adapter example — bounded standalone rules for the fixed facility adapter.

```ghost
constraints BasicWatering {
  require count_on(pump1.valves) <= 2;
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
}
```

Add the following rules only when capacity analysis is desired.
Both groups can apply together.

Station adapter example — bounded standalone rules for the fixed facility adapter.

```ghost
constraints CapacityAdvice {
  check pump_capacity(pump1);
}
```

| Capacity information/request | CapacityAdvice result | New start satisfying basic interlocks |
|---|---|---|
| Required information not entered | Unknown: insufficient information | Not blocked by this check |
| Sufficient model/conditions, within capacity | Pass: check passed under that model | Not blocked by this check |
| Sufficient model/conditions, above capacity | Violation: excess-capacity warning | This check itself does not block |

Users wanting to block even the last row select the explicit mandatory `require` in the next section.
In no case does entering device information automatically strengthen basic rules.

Entering supplementary information or discovering a device does not automatically add mandatory operating conditions.
Promotion to a mandatory rule is a structural change to executable RULES.
Explicitly stop and change, verify, and apply it through Configure; it is not a live-event target for runtime-adjustable properties.
When removing information needed by an already active mandatory rule, modify or remove and validate that rule too.
Do not silently disable a mandatory rule because its information disappears.

## Optional pump-capacity and water-pressure models

A valve-count limit is expressed as a finite count constraint such as `count_on(...) <= 2`.
Check the total of every valve connected to the same pump, rather than the two valves belonging to each control.

A more accurate model needs per-zone demanded flow, required minimum pressure/head, pipe losses, and pump performance.
Demands from parallel zones can be summed under a common pressure condition, but do not use a model simply adding "pressure consumption" and subtracting it from rated pump pressure.
The actual pump operating point is determined by pump and system curves.
[KSB operating-point explanation](https://www.ksb.com/en-global/centrifugal-pump-lexicon/o)

Conservative flow limits or permitted valve combinations per operating condition verified at installation can be added to the profile only when desired.
The following is a syntax sketch for optional analysis.

Station adapter example — bounded standalone rules for the fixed facility adapter.

```text
constraints PumpCapacity {
  check pump_capacity(pump1);
}
```

`pump_capacity` compares all requests for the same pump against the selected capacity model.
It returns a Violation warning when excess is confirmed under verified conditions, Pass within that model's scope when conditions/data are sufficient and within capacity, or Unknown when data/conditions are insufficient.
This `check` is warning/analysis functionality, not an operation-permission rule.
Diagnostics retain the supported model and its premises.

For example, a flow-budget model compares `flow_budget` under defined pressure/pipe conditions with per-zone `demand_flow` under the same conditions.
Comparing pressure and flow with different units is a type error.
This optional model's implementation uses defined fields and units rather than guessing arbitrary metadata semantics.

Only when users select it as a mandatory start condition do they add the following.

```text
require pump_capacity(pump1) == Pass;
```

Then neither Violation nor Unknown permits new work.
Basic control without a declared check has no such condition.
Do not require detailed device specifications to be entered first just to run basic control.
This is a metadata-based start-permission rule; separate output/sensor rules handle fault/emergency-stop monitoring during execution.

When a newly added mandatory check lacks data, reject application of that candidate configuration and retain the existing configuration.
If a previously valid active mandatory check later becomes Unknown, block new starts subject to it.
Do not automatically delete the existing mandatory rule and downgrade to basic operation.

Pump-curve/pipe-model analysis and generation of permitted combinations can run on a PC.
The MCU checks the result through bounded table lookup or comparison.
Analysis guarantees hold only within profile assumptions and actual verification scope.
Distinguish omitting an analysis when information is absent from treating a user-declared mandatory capacity check as successful.

With a mandatory capacity rule, do not arbitrarily close one valve to split work when capacity is exceeded.
Check a new task's entire resource demand, then permit its start or reject/queue it.
For faults confirmed during execution, apply that facility's stop procedure and output safety constraints.

## Theory of constraint composition and implementation boundaries

Interlocks can be modeled as a kind of constraint: conditions that must hold together.
Require behavior satisfying all mandatory constraints together. Different tools address this.

| Theory/technique | Applicable problem | Proposed execution location |
|---|---|---|
| Invariants/finite state machines | Mode exclusivity, allowed transitions, output conditions | Compile-time checks + MCU monitor |
| Constraint satisfaction problems (CSP), SAT/SMT | Rule contradictions, static capacity conditions, possible combinations | PC/host analysis |
| Temporal logic/runtime verification | Confirmation within a time limit, cumulative time, ordering | Transform restricted syntax into small state machines |
| assume–guarantee contracts | Composition of device/control/shared-facility conditions and guarantees | Host analysis + runtime monitoring of required assumptions |

The [Z3 logic guide](https://microsoft.github.io/z3guide/docs/logic/propositional-logic/) provides a foundation for logical satisfiability and contradiction checking.
[Kind 2/Lustre contracts](https://kind.cs.uiowa.edu/kind2_user_doc/2_input/1_lustre.html) are a concrete reference for composing assumptions, guarantees, and modes and checking invariants/reachability.

Logical constraints combine by AND, but choosing which request to accept is a separate arbitration policy.
Constraints define the permitted region; arbitration selects deterministically within it.
Do not weaken mandatory constraints with priority scores.

A SAT check for one tick is not proof of safety for all time.
A model that always stops can satisfy safety constraints while never watering, so check reachability of expected operating states too.
Analysis unknown/timeout is not successful proof; record analysis scope and failure reason.

The MCU runs only supported constraints using bounded comparisons, counters, state machines, or permitted-combination lookups.
Do not require a general-purpose SMT solver or unbounded combination search each tick.
Diagnose rules that cannot compile to this profile.

Do not apply the existing bool requires/mutex false-directed iterative algorithm unchanged to general constraints.
Mode entry/resource permission/time monitoring/output blocking each needs defined execution semantics.
Facility and local contracts apply together; a control cannot release shared constraints.

## Sensor noise and disconnection

For example, the following sketches syntax for a new sensor-processing declaration.
Internal state for each operation is generated as explicit sensor-graph nodes.

```text
input moisture: Percent {
  sample = 1s;
  valid = 0% .. 100%;
  filter = median(5);
  stale_after = 3s;
  recover_after = 3 samples;
}

signal dry = hysteresis(moisture,
  on_below: 30%,
  off_above: 35%,
  initial: false);
```

median(5) is the median of the five most recent valid new samples.
Hysteresis changes to true below 30% and false above 35%, retaining the previous value at the boundaries and between them.
Statically determine the order of pre-filter input validation, filtering, condition evaluation, and fault handling.
The [TI explanation](https://www.ti.com/tool/CIRCUIT060078) describes how hysteresis with separate upper/lower bounds reduces repeated switching around noise.

The detailed sensor-processing contract is:

- Reading the same physical sample in several ticks does not insert it again into the filter window or recovery counter. The driver supplies new-sample identity and time.
- Measure freshness from the time of the last actual valid sample. Recomputing a filter result does not refresh stale time.
- This example can use the last sample until the next arrives, but it is Stale after 3 seconds. Explicit Disconnected/Invalid faults are forwarded immediately. Do not smooth errors away.
- Initially, quality is NotReady until five valid samples accumulate. After a fault, reset the filter window; recovery requires both 3 consecutive new valid samples and filter readiness. Therefore this example's median window needs at least 5 samples to become ready again.
- Hysteresis also preserves Reading/Result quality. On a fault, do not emit the last true as normal; control logic handles it with case/recover, for example. Initial/recovery state is false.
- If retaining the last value through short disconnections is needed, make it a separate extension specifying a timeout and Held quality. Unlimited last-value retention is not the default for every sensor.
- Compute each sensor's processing delay separately. Do not universally apply ordinary moisture-sensor smoothing delays to protective signals.

The reading type is `Result<T, SensorFault>`, using `Disconnected | Stale | Invalid | NotReady` here.
While an actual fault remains, emit it.
When new valid samples have begun arriving but readiness/consecutive-recovery conditions are not yet met, emit `Err(NotReady)`.
Do not emit a partial-window median/moving average as normal.
`recover(default)` merely transforms this Err to a substitute value as a pure operation; it neither satisfies recovery counters nor erases original fault records.

Median and moving averages start from an empty window during initialization/recovery and require N valid new samples.
EMA seeds from the first valid sample and emits no normal result until configured consecutive-recovery samples are satisfied.
Filter readiness and sensor recovery are separate conditions that must both hold.
Composing filtering and hysteresis preserves quality until explicit case/recover handling.

Sensor-node checkpoints include source ID, source epoch, last sample ID, sample time, time epoch, filter state, quality, and recovery counter in one logical tick.
Do not apply retransmitted samples twice with the same cursor, or treat a source restart/time-epoch change as an ordinary new consecutive sample.
The default actual-reboot policy clears sensor windows and freshness and prepares again from NotReady.
Do not immediately restore old normal values.
Persistent resumption of sensor state is a separate opt-in; if a consistent checkpoint and time/source continuity cannot be confirmed, use the same initialization policy.
Exact ghost replay uses recorded sample identities, times, and quality together with the corresponding checkpoint.

### Example: connecting noise/disconnection-processed values to watering decisions

The following is a complete design example for a control with an installed moisture sensor.
Assume start requests were delivered after facility-mode and resource-ownership checks.
No pressure/flow information is used.

```ghost
control MoistureDemand {
  input start, stop: Bool;

  input moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }

  signal dry = hysteresis(moisture,
    on_below: 30%,
    off_above: 35%,
    initial: false);

  let dry_ok = case dry {
    ok(value) => value;
    fault(_)  => false;
  };

  state watering: Bool = false;
  output pump, valve: Bool;

  watering' = !stop && dry_ok && (start || watering);
  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

With raw new samples of 28%, 29%, 90%, 28%, 29%, the fifth sample makes the median ready at 29%.
Before that it is NotReady, so dry_ok=false.
When ready dry is true, start begins and latches watering intent.
Start does not store a request that briefly appeared and disappeared before readiness.
Afterward, a filtered value of 32% retains the previous true; above 35% changes it to false.
Reaching the stale limit since the last valid sample or receiving an explicit fault makes dry_ok=false and releases watering intent.
Actual output cleanup follows the Driver/facility stop procedure.

Three normal samples after a fault do not prepare median(5), so it remains NotReady.
Even after five samples accumulate and recovery conditions hold, if start=false and the latch is released, watering does not automatically resume.
Sensor recovery and new operating permission are separate decisions.

## MCU resource costs

| Processing | Retained state | Form of per-sample cost |
|---|---|---|
| debounce | Stable value, candidate value, candidate-start time | Fixed number of comparisons and time comparison |
| hysteresis | Previous decision value | Two boundary comparisons |
| Stale monitoring | Last valid time, quality | Fixed time comparison |
| EMA | Previous average and initialization state | Fixed number of arithmetic operations |
| Moving average N | N values, sum, index | Fixed number of ring-buffer updates |
| median N | N values and index | Comparisons/sorting with fixed upper bound N |
| Daily time limit | Date/budget/counter/interval times | Fixed time accumulation and comparison |

Data for five 32-bit samples is 20 bytes; for 64-bit samples it is 40 bytes.
This counts sample storage only; timestamps, quality, indices, initialization state, sorting scratch, and additional storage depending on sorting method are separate.
The current core's number is f64; actual representation size must be determined by the compilation profile.
Do not claim total RAM is 20 bytes.

As an example of a filter with fixed state size, [CMSIS-DSP biquad](https://arm-software.github.io/CMSIS-DSP/main/group__BiquadCascadeDF1.html) uses fixed state per stage.
This is a design reference, not a claim that the ARM implementation is used unchanged on ESP32.

The compiler must calculate memory and operation-cost bounds from sensor counts, window sizes, timer counts, fixed-set sizes, maximum requests, and trace sizes.
Coordinate bus reads with control ticks; update filters only on new samples.
Filter state, quality, and timers also belong in ghost checkpoints.
Measure execution time and memory on the actual target board. This does not mean the current MVP verifies these bounds.
New arithmetic/unit/signal opcode support is also required.

Limits are supplied in target-board/runtime profiles; users are not required to enter every value.
Reject activation of candidates exceeding the selected configuration's RAM, scratch, stack, execution-cost, or persistent-storage bounds, retaining the existing configuration.
Do not allocate sensor-processing state of unselected device strategies.
Do not secretly exclude advanced mandatory rules and execute because the selected configuration lacks resources.
Exact board-specific figures and maximum supported window sizes are determined after implementation/measurement.

Optional intermediate traces are not a success condition for basic control execution.
The default proposal is to overwrite the oldest diagnostics in a fixed-length ring buffer and display lost counts/intervals.
Records include logical tick, node ID, sample ID, and quality; raw/filtered values are optional.
Loss of intermediate traces alone does not stop basic operation.
Input journals and checkpoints for exact replay are distinct from intermediate traces; mark intervals with lost input records as unreplayable.
Persistent daily-limit/once ledgers are separate data needed for execution permission and must not be silently overwritten.

## Daily operation limits and duplicate execution

`on_time(pump1)` is the duration of final applied ON commands for the same physical pump.
Combine automatic/manual and multiple-control usage into one facility counter.
Do not count rejected requests or wait times.
Profiles counting physical-running feedback are defined separately.
Overlapping requests from two controls do not count the same pump's actual command interval twice.

Measure interval length with monotonic time. Day means a calendar date in the specified local time zone.
Operation crossing midnight is counted separately per date.
This differs from a rolling 24-hour total or maximum continuous-operation duration and does not prohibit using each date's budget before and after midnight.

An active counting interval has a trusted local date and a monotonic deadline for the next midnight.
Clock correction must not redistribute date-specific usage in already committed intervals.
If date boundaries become ambiguous during correction, postpone new schedule/budget updates; stop the ongoing interval within its secured budget and monotonic cutoff.
Specify boundary-resynchronization procedures and permitted correction ranges in the installation profile.
Implementations that unconditionally reset counters to zero from the current wall-clock date every tick are prohibited.

Before starting, check the task's required budget.
Secure time budget together with shared-pump ownership and settle it after use.
If stopping at the limit is required, block early considering the next output-application interval and stop delay.
The target execution contract must specify whether one tick of overrun is allowed or the Driver turns OFF at the exact limit time.

Reserved budgets require a finite upper bound on ON time.
Calculate fixed sequential watering from the execution plan.
Manual operation without an end time can receive a finite lease within remaining budget and a forced-stop time.
Therefore users need not always enter a duration for manual operation.
Lease extensions are allowed only after successfully reserving new budget.
Fixed plans crossing midnight must secure each date's budget according to verified date boundaries, or be restricted to plans that do not cross that boundary.

"One hour per day" alone does not eliminate duplicate schedules.
Two executions of a 5-minute task still total less than one hour.
`once` uses separate occurrence IDs/acceptance records.

- Identify occurrences by schedule ID, service date, and slot ID; do not accept them again.
- Simple document/program revision changes do not reset execution records or usage.
- When the clock moves backward, restore usage and occurrence records for existing dates; do not create new budget.
- Do not unconditionally recognize abnormal forward clock movement as a new daily budget. Postpone schedule/budget updates and diagnose time-trust issues.
- Preserve required occurrence records and budgets across reboot. Flash writes can be bounded by persistently reserving budget/occurrences before output permission and settling after use.
- If power loss makes usage uncertain, treat unsettled reservations as used or postpone resumption. Do not reset counters to zero. Some scheduled work may fail to execute as a consequence; do not claim physical exactly-once execution.

Occurrences arriving in the same tick as Stop terminate as `SkippedByStop` before new permission.
Already accepted occurrences cancelled by stop remain `Cancelled` and are not automatically reaccepted.
Settle budgets from confirmed actual-application intervals; handle uncertain quantities conservatively.
Cancellation and budget return are one persistent change. Failure to store termination records postpones new starts.
Selecting Auto again does not resurrect terminated occurrences.

Storage can be bounded by maximum schedules, daily slots, and retention days.
Even when old occurrence records are deleted, retain a persistent date-progress watermark and retention boundary so past times outside retention are not accepted as new occurrences.
Diagnose storage failures/insufficient capacity and postpone new starts.
A schedule time-zone or grid/slot-identity change requires explicit ID migration or a new schedule ID.
Simple display-name/document edits do not change IDs.
A new schedule ID does not reset the pump's shared daily usage either.

Reservation units avoiding continuous high-frequency flash writes, counter overflow, retention days, and clock-correction ranges belong to the installation profile's resource/recovery policy.
A rolling 24h limit needs separate window/interval-storage bounds and must not be used interchangeably with day notation.

### Example: declaring multiple scheduled times and a daily limit together

The first block is a schedule declaration inside a scheduled control.
The second is a facility rule connecting that schedule's starts and physical pump1.
These are fragments omitting actual watering phases and mode/ownership bindings.

```ghost
schedule starts: DailySlots<15min> {
  timezone = "Asia/Seoul";
  selected = [06:00, 06:15, 12:30, 18:45];
}
```

Station adapter example — bounded standalone rules for the fixed facility adapter.

```ghost
constraints DailyWatering {
  once starts per occurrence;
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
}
```

If each schedule has a planned pump-ON upper bound of 10 minutes, the four planned executions total 40 minutes.
Actual usage counts ON intervals from output application through stopping, rather than simply recording schedule count multiplied by 10 minutes.
The following independent expected cases explain the rule.

| Situation | Expected behavior |
|---|---|
| Completed 06:00 schedule observed again after clock correction | once blocks the same occurrence |
| Already used 55 minutes today; new task has 10-minute ON upper bound | Remaining 5 minutes does not permit the entire plan |
| Manual operation after 40 minutes of automatic use | Permitted only within the same pump's remaining budget |
| Power loss during watering | Recover unsettled persistent reservations; do not restart daily usage at zero |

This example's daily limit is based on local calendar dates, not a rolling 24-hour limit.

## Acceptance scenarios

| Situation | Expected result |
|---|---|
| Manual-entry request during automatic operation | Reject and guide to explicit stop; no automatic preemption |
| Mode transition and structural-setting application arrive in the same tick | Evaluate from previous committed mode/stop conditions; no bypass application |
| Auto and Manual entry requests arrive in the same tick | Reject all conflicting entries; retain existing mode |
| Stop and scheduled occurrence arrive in the same tick | Stop first; no new output, occurrence recorded as terminated |
| Valve cleanup continues after stop request | Configure entry prohibited |
| Runtime-adjustable setting event during operation | Validate entirely and apply as one event; record effective event position and new settings revision |
| One invalid value in a runtime-adjustable batch during operation | Reject entire event; no partial value/state/output change |
| Structural settings or program/profile changes during operation | Reject; explicit stop and Configure procedure required |
| No supplementary device information such as pressure/flow entered | Basic watering, mode/valve-count/time interlocks usable |
| Fields required by optional capacity check absent | Only that analysis Unknown; no zero substitution, operation blocking, or repeated fault notifications |
| Flow known for only some zones | Perform only checks with sufficient information; do not display complete capacity verification success |
| User adds mandatory capacity require but information is insufficient | Diagnose configuration application/reject start; do not pass unknown values |
| Different controls each request 2 valves on the same pump | Check facility total of 4; start only permitted work |
| Inactive control requests pump=false | Does not turn off current owner's pump |
| Pump briefly off between a control's phases | Retain watering-session ownership; do not permit another control |
| Power loss during structural Configure application | Recover only complete old/new revision; no partial relationships/constraints |
| Contradictory mandatory constraint added | Reject new configuration or display verification failure; no partial existing-configuration change |
| Same sensor sample read over several ticks | No duplicate median/recovery-counter update |
| Sensor fluctuates around threshold | Retain decision within configured hysteresis interval |
| Filter computation continues without new physical samples | Stale based on last sample |
| One normal value received after sensor fault | Check readiness/recovery; do not immediately permit operation |
| Consecutive-recovery sample count smaller than median window | NotReady until both hold; no normal partial-window value |
| Old normal sensor value stored after actual reboot | Default prepares again from NotReady; old values do not permit operation |
| Intermediate diagnostic trace full | Defined overwrite and loss indication; separate from control/mandatory persistent ledgers |
| Advanced-feature resource limits exceeded | Reject candidate activation, retain existing configuration; no automatic mandatory-rule deletion |
| Clock moved back before the same scheduled time | No same-occurrence re-execution or usage reduction |
| 5-minute task mistakenly requested twice | once blocks duplicate; daily limit alone is not credited with prevention |
| New 10-minute task after 55 minutes used | Reject start/wait for next permitted interval because whole-task budget is insufficient |
| Manual 25-minute request after 40 minutes of automatic use | Check against the same pump's 20-minute remaining budget |
| Manual operation without entered duration | Bound by finite lease and cutoff within remaining budget |
| Clock moves backward during schedule crossing midnight | Do not redistribute committed usage; postpone ambiguous new-date budget update |
| Clock moves before retained occurrence records | Watermark/retention-boundary checks postpone new acceptance |
| Reboot during watering | Recover from persistent reservations/counters; do not initialize as a new daily budget |

These scenarios are design acceptance conditions, not records of current executable tests passing.
