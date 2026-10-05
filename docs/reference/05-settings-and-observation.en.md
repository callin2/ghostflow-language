<!-- translation-source: docs/reference/05-settings-and-observation.md -->
[Korean original](05-settings-and-observation.md)

# 5. Settings and observation

[Complete contents](../LANGUAGE-REFERENCE.en.md) · [Previous: Sensors, constraints, and control](04-sensors-constraints-control.en.md) · [Next: Composition and replay](06-composition-and-replay.en.md)

A GhostFlow program distinguishes adjustable values from values produced during execution. `config` is an adjustment point intentionally exposed by the author; `state`, timers, inputs, and outputs are values for observing execution. This distinction prevents operators from confusing changing irrigation duration with arbitrarily modifying the current timer. It also lets screens use the same types and validation rules without reinterpreting source.

## 5.1 `config` declarations

The following is settled source notation.

```ghost
control OperatorSettings {
  config duration: Duration = 5min {
    min = 1min;
    max = 20min;
    step = 1min;
    access = operator;
    label = "관수 시간";
  }

  config duty: Percent = 50% {
    min = 0%;
    max = 100%;
    step = 10%;
    access = designer;
    label = "출력 비율";
  }

  config enabled: Bool = false {
    access = operator;
    label = "자동 관수 사용";
  }
}
```

`config name: Type = default { ... }` declares a typed stream with payload type `Type` and initial emission `ok(default)`. It combines the name, source initial value, and validation metadata in one declaration. `access` is change permission and does not change the stream's type. Configs that disallow operator changes follow the same Result reading rules. For an unchanging computational constant, use a constant expression in an ordinary `let`.

| Item | Meaning | Rule |
|---|---|---|
| Type | Value meaning and representation range | The same type rules apply to executable expressions and settings input. |
| Default | Payload of the first `ok` emission | Part of canonical `.ghost.md`, not an error fallback. |
| `min`, `max` | Closed permitted range | Same type, with `min <= max`; both endpoints are permitted. |
| `step` | Permitted grid based on `min` | Must exceed 0; reject values whose `(value - min)` does not fit the step. A Temperature difference is TemperatureDelta. |
| `access = operator` | Setting an operator may change | Only typed settings events within the declared range are permitted. |
| `access = designer` | Value chosen by the source author | Cannot be changed through operating settings events. |
| `label` | Human-readable display name | Not an identifier; changes neither meaning nor permissions. |

Enum members can also declare a display label: `type Phase = Idle { label = "대기"; } | Running;`.
This optional plain-text metadata does not change the member name, ordinal or control
execution. Unlabeled members display their source name. Empty or whitespace-only labels,
duplicate labels and unsupported member options are errors. The compiler emits the
label as `enumMembers[].displayLabel` in Interaction Schema `0.3`; web, HMI and mobile
consumers share that metadata. See the [Interaction contract](../../contracts/interaction-v0/README.md).

There is no `apply` field. Both `apply = stopped` and `apply = live` are syntax errors. `operator` settings always follow the atomic live event semantics in §5.2. This rule is fixed in the declaration itself to avoid a second settings system for selecting application timing.

Numeric setting defaults must also lie within `min..max` and fit the step grid based on `min`. `Bool` already defines its two selectable values in the type and has no numeric range or increment. `false`, `0`, and `0%` are valid explicit values rather than absence. Unknown targets, duplicate targets, and unauthorized changes are rejected before stream admission. If the payload of an identified, authorized change fails type, range, or increment validation, it produces the error emission in §5.2. Failed payloads are not applied as successful values.

An `Int` setting's default, `min`, `max`, and `step` are all signed 32-bit integers. `step` is positive, and both the default and `max` must lie on the integer grid starting at `min`. For example, `min = -2; max = 4; step = 2;` permits `-2, 0, 2, 4`. Fractions or floating-point tolerances are not rounded into inclusion in the integer grid.

**Why:** Integer settings such as counts must select permitted values exactly. Integers outside the grid must not pass through tolerance even with large increments, and both endpoints of the closed range must actually be selectable.

For `Temperature`, `min`, `max`, and the default are absolute temperatures, while `step` is `TemperatureDelta`. For example, declare `min = 10°C; max = 30°C; step = 0.5Δ°C;`. Other physical quantities use the difference types defined by the operation table in §2.9. Settings grids for nominal types without general arithmetic are checked only against that type's canonical magnitude; this internal check does not permit new arithmetic operations in programs.

For `Date` settings, the default, `min`, and `max` are `Date`; `step` is a positive `Int` number of days. For example, `step = 1;` selects calendar dates one day at a time from `min`. `TimeOfDay` and `DateTime` settings have defaults and ranges of their respective time types; `step` is a positive `Duration` such as `1min`. Their grids are checked using differences in milliseconds since midnight and UTC epoch milliseconds, respectively. There is no midnight wrapping or time-zone inference. This settings validation does not permit extra program arithmetic such as `DateTime - DateTime` or `TimeOfDay + Duration`.

**Why:** Date selection intervals are calendar days; time-value selection intervals have millisecond resolution. A calendar day is not converted into 24 hours of actual operation in an arbitrary time zone. The settings form and runtime check the same set of permitted values.

Schedule lists use the form ``config times: TimeSlots<15min, 8> = [time`06:00`];``. This type's grid and maximum element count define its permitted range. It does not use `min`, `max`, or `step`. List validation and `DailySlots` connections follow [§3.6](03-time-and-schedules.md#36-선택된-dailyslots).

A settings descriptor supplies a stable setting ID, source name, type, default, access permissions, range, increment, label, and source/intent provenance. Renderers can use this information to create typed forms such as Duration inputs, Bool selections, and ranged numeric inputs. Sliders, dials, coordinates, colors, and layout are decided by the renderer. Do not infer settings identity or validation rules from a `label` or widget shape.

A `Temperature` settings descriptor must include the selected `displayUnit` (`°C` or `K`) separately from the canonical `K` value. Live events changing only the number preserve the existing `displayUnit`. To change the unit, the event must specify the new unit. Missing or ambiguous units are errors before application; do not infer display units from canonical values or magnitudes or choose a default unit.

### Defaults and effective values

A default is the initial payload defined by source. An effective observation is the latest `Result<Type, SettingsFault>` read by an expression at a particular execution position.

```text
First observation                       → ok(source initial value)
Later accepted normal emission          → ok(new payload)
Later accepted error emission           → fault(SettingsFault)
```

Observers must be able to distinguish `defaultValue`, current Result status and payload or fault, settings revision, and application position. Previous successful values may be retained as history but must not be supplied as effective values hiding the current fault.

## 5.2 Source changes and operating settings changes

These changes have different meanings.

| Change | Identity changed | Meaning |
|---|---|---|
| Editing source defaults, expressions, declarations | document revision, source digest, usually program artifact | New canonical `.ghost.md` candidate for review |
| Operating settings event | settings revision and effective event position | Effective value change within the same source, Program, and run |

Source editing modifies the original Markdown. It must be a new document revision preserving prose, comments, fences, line breaks, and original bytes, rather than masquerading as a settings overlay. Intent anchors, confirmed premises, unconfirmed assumptions, and source-map provenance are revalidated on the new revision. Conversely, operating settings do not change source literals or recompile. API/Web/FSD consumers submit a new `.ghost.md` candidate for a permanent default edit, and submit a typed settings event to tune the same Program during operation. Do not revive the deleted source-candidate helper as an implicit fallback or leave it as an active consumer path. This distinction makes it reviewable whether “change 5 minutes to 10 minutes” means a permanent default edit or settings for this operation.

### Settings streams and current observations

A settings producer may be a WebUI, network message, MQTT, or a physical control such as EC11. Replacing the producer changes neither consumer program expressions nor stream meaning. Language semantics do not require a particular protocol, RxJS, or UI library.

`access` is permission to edit values. It does not prohibit a legitimate producer from reporting an error for a `designer` or read-only config or recovering to its declared initial payload. Changing to another payload remains value editing and undergoes authorization checks. Before admission, the host verifies the source and permissions of producer observations and operator edits. An origin label on a packet alone is not authentication; consumer expressions do not branch on origin.

Each stream supplies a valid initial value once, then ordered `ok(value)` or `fault(reason)` observations. Fault does not terminate the stream. A subsequent normal emission may recover it. Lack of messages alone does not create a fault; an unavailable decision is an explicit `fault(SettingsUnavailable)` emission under the producer contract.

Ordinary control expressions explicitly handle both rails with existing Result syntax.

```ghost
config duration: Duration = 5min {
  min = 1min; max = 20min; step = 1min; access = operator;
}
let within_duration = case duration {
  ok(value) => age < value;
  fault(reason) => false;
};
```

Here, `false` is error handling chosen by the author. The language does not choose stop, the default, or the previous successful value instead. Existing Result operations such as `map`, `and_then`, and `recover` may also be used according to their type rules. `TimeSlots` has the same successful/error observations, and its consuming `DailySlots` handles errors directly. Lists are not converted into arbitrary scalars.

All consumers read the same config observation at one logical evaluation position. A schedule's `every` and a control expression's operating duration must not read separate copies of a setting. An emission arriving during evaluation does not alter that evaluation's immutable view and is placed at the next ordered position. This evaluation boundary implements stream semantics; it does not define settings as scan-loop-only commands. The DI snapshot is also fixed within the same evaluation, but ordinary Bool inputs are not required to carry settings revisions or EventIds.

### Atomic live event

Related changes to several settings are one atomic live emission with an explicit target set.

1. Verify the Program targeted by the event and its baseline settings revision.
2. Verify a nonempty, identified target set without duplicates and the producer's permissions. Reject corrupt envelopes, unknown targets, other Programs, stale baseline revisions, and authorization failures before admission. Do not create error emissions on unidentifiable streams.
3. Validate all payloads of the identified operation together against type, range, increment, and list-capacity rules. If all are valid, emit `ok(value)` to all targets together. If any fails, emit `fault(SettingsInvalid)` to all targets together. Do not change only the valid subset to `ok`. Preserve causes and affected items in diagnostic provenance. Explicit producer unavailability also emits `fault(SettingsUnavailable)` to the entire target group. A group containing different explicit fault codes is rejected as an inconsistent packet. Do not guess arbitrary error precedence. An actual payload validation failure produces a `SettingsInvalid` observation for the whole group.
4. An accepted success or error emission has a settings revision and effective position; all target observations become effective together from that position. Nontarget streams do not change.
5. Retain the same canonical source, compiled Program, and `runId`.
6. Do not initialize state or timers. Current control expressions read the new effective values and determine the results.

Do not confuse acceptance of a `fault` emission with transport rejection. The error rail is also new state observed by the consumer. A subsequent control evaluation failure does not cancel an already accepted emission. If an API submits a not-yet-accepted emission and evaluation as one transaction, transaction failure leaves the emission unaccepted; it can be retried with the same identity. Do not respond that an unaccepted operation is already effective. Producer retransmission does not apply the same emission twice.

Thus, shortening `duration` from 10 minutes to 5 minutes during operation allows the already elapsed time to be compared with the new limit at the next decision. It does not implicitly wait for the “next round,” stop, reset, recompile, or a new run. A settings event also does not force a particular output. Output changes arise from the authored control expression.

Do not add application-timing fields to settings declarations. To retain operating duration chosen at startup, the program stores the setting in its own state at the starting transition and reads that value. Stop procedures needed for program or firmware replacement also do not apply to operating settings events.

### Lifecycle and temporary settings

A temporary setting is an operating setting with a defined lifetime, rather than separate source. It must specify the target Program, setting ID, typed value, actor, permissions, reason, creation event, settings revision, starting position, lifetime, expiry, rollback provenance, and return target. Do not automatically attach previous overrides to another Program revision. Revalidate and explicitly approve them for the new revision.

The latest Result and revision of accepted ordinary live settings persist through actual device restart. If the final observation was a fault, restore the fault rather than replacing it with the initial value. When a latest observation exists to restore, apply its history after the initial emission before the first control decision. Restart creates a new `runId`.

A temporary change is **one layer of overlay** above ordinary settings. It adds no source keyword and is defined through the following settings-event semantics.

| Item | Settled rule |
|---|---|
| Lifetime | The requester explicitly specifies `Run` or `Until(DateTime)`. Reject omitted lifetimes. |
| `Run` | Valid only in the current run. Remove the overlay when the run ends. |
| `Until` | Store absolute expiry and exact Program identity. Remains valid before expiry across restarts of the same Program. |
| Return value | Validated ordinary settings value immediately preceding the temporary change. Do not arbitrarily substitute the source default. |
| Nesting | Reject another temporary change if the same setting has an active temporary change. Explicitly cancel it first. |
| New ordinary setting | Remove that setting's overlay and apply the new ordinary value in the same event. An old expiry does not overwrite the new value. |
| Expiry/cancellation | Atomic settings event targeting the original overlay ID. Retain completed settings revision and application position. |
| Return failure | Do not record successful return. Report settings validity as unavailable and do not commit decisions requiring that setting. Physical-output responses follow the installation's explicit failure contract. |

Reject a new temporary request if trusted time is unavailable to determine `Until` expiry. If the validity of an already applied value can no longer be determined, do not continue reading it as valid. Complete restoration and expiry decisions at restart before the first control decision. Temporary events grouping different settings have the same lifetime; application and return are all-or-nothing. To change part of such a group with an ordinary change, submit cancellation of the entire group and the new values as one event.

**Why:** To prevent temporary values from becoming permanent or late expiry from undoing a newer operator decision. Expiry time and temporary values are operator choices; the language does not choose arbitrary operating durations.

### Restart and memory restoration

A new run starts from declared state initial values and new timer baselines. Time spent powered off is not added to `elapsed`. Persistence of ordinary settings and state restoration are separate. When a host offers checkpoint restoration, it must verify Program, instance, state schema, and monotonic-time continuity and receive an explicit execution request specifying the checkpoint and restoration permission policy. Do not restore timer or filter memory whose continuity cannot be proven. Restoration failure is observable; do not initialize while reporting successful restoration.

When a restart reason is required, use the exact reserved runtime-owned lifecycle input contract below. There is no dedicated `on_restart` statement. These ports read directly as scalar values, without `Result<T, SensorFault>` acquisition, and cannot have optional markers or conditioning settings. Other external inputs retain the canonical quality contract.

```ghost
type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
input restart_reason: RestartReason;
input restart_event: Bool;
```

These exact reserved declarations are a control-body fragment. The host explicitly supplies the hardware-confirmed reason, or `Unknown` when evidence is unavailable, and whether the boot event remains pending. `PowerOn` alone does not establish recovery from a power outage. The reason is fixed for the run; the framed runtime owns and injects both values. Callers cannot supply them in scan frames or through ordinary input setters. When the event is pending, `restart_event` is true in the first successfully committed scan and false afterward. A rejected scan leaves it pending. The host sets it false when replacing a program after the boot event was already consumed. The author defines automatic resumption, waiting, or cancellation followed by returning to the original position through state transitions. This contract supplies an event and cause; it does not restore VM or timer memory. The Driver's installation contract owns physical outputs before the first decision.

## 5.3 Renderer-independent observation model

Observation contracts convey meaning without specifying screens.

| Concept | Question answered | Time meaning |
|---|---|---|
| descriptor | What can be read or changed? | Static source/Program meaning |
| snapshot | What are the values in one completed decision? | One completed scan |
| event | What occurred, in what order? | Ordered occurrence within a run |
| command result | How did the execution boundary handle a request? | Command lifecycle |
| alarm | What condition arose and cleared? | Raise/clear events and current state |
| explanation | What evaluation supports the current result? | Same completed scan |

This contract contains no widgets, layouts, coordinates, colors, or screen-specific visibility policy. Multiple renderers may show the same descriptors and execution identities differently, but do not change values, permissions, validation, or command availability.

### Descriptors and snapshots

A descriptor has a public semantic ID, name, kind, source type, read/write/execute permissions, and source/intent provenance. State, timers, exact counters, settings, inputs, outputs, commands, and alarms are classified by their respective declared meanings. Do not infer a counter from a name like `count` or a value that looks integer-shaped.

Changing settings and observing them are different capabilities. Seeing a value in a `state`, timer, or output descriptor creates no write permission. Metadata producers and renderers cannot add `write` or `execute` permissions absent from source. Command permission does not imply direct internal-state write permission; operator settings permission does not imply source-edit permission.

A snapshot is bound to exactly one completed scan. Observations distinguish the following.

- `ready`: An actual value exists, including `false` and `0`.
- `unavailable`: No value exists at that completion point, with a reason.
- `error`: The descriptor could not be observed.
- `stale`: A result obtained by the consumer comparing expected identity, rather than a status asserted by the payload itself.

A valid stateless control may have an empty descriptor list with an identified schema; its completed snapshot also has an empty observation list. This is not observation failure. Do not add artificial Bool state or timers to fill the screen.

The descriptor for `timer age = elapsed(phase)` directly identifies the original enum `phase` as its subject. Do not expose a synthesized Bool clock as public meaning for internal calculation or display. Bool subjects also count time since their last committed change, whether true-to-false or false-to-true.

### Events, command results, and alarms

A snapshot alone cannot reveal an alarm raised and cleared between refreshes. Events have per-run ordering and must identify duplicates. If records disappear beyond the retention range or a connection breaks, explicitly report sequence gaps or missed ranges. Do not reconstruct intermediate events from the last snapshot.

Command results preserve request reception, rejection, starting, completion, cancellation, and failure as distinct outcomes. `received → rejected | started → completed | cancelled | failed` is lifecycle notation explaining these distinctions, rather than settled source syntax or a record enum/transition schema. Command IDs and execution identities must match; renderers or callbacks do not infer a separate state machine. Report a gap if bounded history loses records before export. Alarms use both current active status and raise/clear events to preserve brief occurrences. Final command/alarm record serialization and transport belong to the execution environment's observation contract. The language has no separate `command` or `alarm` source declarations or severity keywords. Control responses use explicit typed inputs and state expressions. An explicit external descriptor contract connects which inputs are command requests and which observations are exposed as alarms; do not infer them automatically from names or Bool values alone.

### Explanation DAG

An explanation is a directed acyclic graph connecting one output result to actually evaluated inputs, state, timers, named intermediate values, predicates, and constraints. Shared conditions remain one stable node. A renderer may expand it like a tree rooted at a particular output if needed.

Each completed scan's evaluation requires at least the meaning of `evaluated`, actual value/status, and `supportsResult`. Do not show short-circuited, unevaluated branches as actual evidence. If AND is false, evaluated false children may participate in explaining the result; if OR is true, all evaluated true children may participate. Do not arbitrarily choose one winner. This graph is a proof path for the evaluation result, rather than a claim of counterfactual causation that “the result would have differed without this condition.”

Explanations cover both output ON and OFF, requested intent and constrained safe intent. Do not use private compiler slot names as public semantic IDs. Nodes must be traceable to source nodes/spans, intent anchors, and canonical document revisions.

## 5.4 Identity and physical-fact boundaries

Observation and settings records do not mix the following identities.

```text
source document + immutable revision + source digest
Program/module + artifact digest
settings revision + effective event position
behavior instance and installation/binding revision (when composed)
runId + completed scanId + logical time
event/command/alarm sequence identity
```

`scanId` is only ordering within one run. If reset or actual restart creates a new run, even the same `scanId = 0` is a different occurrence. A settings live event does not change `runId`. Joining snapshots and explanations from different sources, Programs, settings, bindings, or runs is treated as stale or mismatch.

GhostFlow observes inputs and control decisions. `pump = true` is output intent and does not prove electrical energization, rotation, or flow. Preserve requested intent, safe intent, host/Driver application results, and actual feedback separately. Without feedback, the result is unknown. Do not turn an explanation that a low-water signal blocked irrigation into a claim that “the tank was actually empty.”

## 5.5 Design rationale and evidence

Typed settings give code, validation, and automatically generated forms the same meaning. Atomic events eliminate moments when only some values are applied. Separating snapshots and events preserves both current values and past occurrences. Exact identity and provenance prevent incorrectly connecting different executions with the same name. Maintaining physical-fact boundaries prevents simulation and UI from inventing device success.

Rationale: [Language model](../LANGUAGE.md), [Control surface](../LANGUAGE-SURFACE.md), [Intent anchors](../INTENT-ANCHOR-MAP.md), [Interaction v0](../../contracts/interaction-v0/README.md), [#68](https://github.com/callin2/ghostflow-language/issues/68), [#70](https://github.com/callin2/ghostflow-language/issues/70), [#73](https://github.com/callin2/ghostflow-language/issues/73), [#74](https://github.com/callin2/ghostflow-language/issues/74), [#88](https://github.com/callin2/ghostflow-language/issues/88), [#89](https://github.com/callin2/ghostflow-language/issues/89), [#105](https://github.com/callin2/ghostflow-language/issues/105), [#110](https://github.com/callin2/ghostflow-language/issues/110).
