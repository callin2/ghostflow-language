<!-- translation-source: docs/LANGUAGE-SURFACE.md -->
[Korean original](LANGUAGE-SURFACE.md)

# GhostFlow selected syntax · control

Status: a finite subset of the selected syntax is implemented. Extension sketches such as `adapt` are not implemented.
Read the [implementation scope](IMPLEMENTATION.md) and [executable tutorial](TUTORIAL.md) together.
After the initial [A/B/C comparison](LANGUAGE-EXAMPLES.md), control syntax centered on braces, expressions, and output connections was selected as the basic direction, and literate packaging was added.

## Core notation

| Notation | Meaning |
|---|---|
| `control Name { ... }` | Scope of a control program and deployment unit |
| `input start: Bool;` | Input supplied by the host each tick |
| `sensor moisture: Percent;` | Measurement payload type; reads distinguish success from errors |
| `sensor moisture?: Percent;` | Sensor capability whose installation is optional |
| `output pump: Bool;` | Type declaration for an output intent port |
| `state watering: Bool = false;` | State retained between ticks and its initial value |
| `let name = expression;` | Stateless computation |
| `watering' = expression;` | Definition of next state |
| `pump <- watering';` | Connect computed output intent to a port |
| `require pump => valve;` | Output constraint requiring the valve to be true when the pump is true |

Names are ASCII identifiers. Type names are written as `Bool`, `Percent`, `Duration`, and so on.
Semicolons terminate declarations and expression definitions; braces indicate scope.
Indentation is used for readability. Code comments use `//`. Document explanations can be written freely in literate form.

Computations use `!`, `&&`, `||`, comparison operators, parentheses, and ordinary function calls.
`if condition then a else b` and `case` return values. `case` must handle every case.
`in {A, B}` tests membership in a finite set of values.

```text
fn latch(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}
```

Functions are pure and return their final expression.
Static inline calls and declaration-order-independent let computation are currently supported; recursion and cycles are rejected.
Higher-order functions and macros are later extensions.

## State, sensors, and outputs

`watering` is previous state; `watering'` is computed next state.
State definitions are computed from the same inputs and previous state, and committed together.
They correspond to `state.watering` and `next.watering` in the earlier draft.
At this stage, next-state references are allowed only in output expressions.
Expressions in which state transitions read one another's next state are rejected.

```text
let water_ok = case low_water {
  ok(low)  => !low;
  fault(_) => false;
};
```

A sensor's declared type is its successful payload; an actual read is that value or a fault.
Even when a fault is handled with a substitute value, the original input error is recorded.
Input/output names are unique within a control.
Outputs declare only their type and must have exactly one connection with the same name, `name <- expression;`.
An output connection defines the intent computed for this tick. An initial value cannot be written in the declaration, and the connection cannot be omitted.

`require` is a pure output constraint.
Initial support is limited to requires and mutex for bool outputs.
For example, `pump => (valve1 || valve2)` blocks the pump if no valve-open intent exists; `!(valve1 && valve2)` blocks both if both are requested.
Multiple constraints compute their blocking sets from the same candidate snapshot and apply them repeatedly.
This does not define an automatic resolution policy for arbitrary logical expressions.

The subsequent [common constraints contract](CONSTRAINTS.md) defines named `constraints` groups, mode-entry interlocks, shared-facility limits, duplicate-schedule prevention, and optional capacity analysis.
The bool output blocking algorithm above is not generalized to every constraint.
Automatic, manual, and configuration modes of the same facility are exclusive.
Structural changes are applied in Configure after an explicit stop.
Operator setting declarations and atomic live event semantics follow [Reference §5.1–5.2](reference/05-settings-and-observation.md).
Distinguish syntax/metadata support from host support for executing live events; see the [implementation scope](IMPLEMENTATION.md) for execution coverage.

Sensor median filters, hysteresis, stale monitoring, and recovery conditions are connected through the manifest and Rust sensor runtime.
Quality, including `NotReady` before readiness, is recorded in host traces.

## Device adaptation and time

`adapt` selects a computation method from a confirmed device profile.
For example, optional sensor moisture may be read only inside `has moisture`.
A temporarily faulty installed sensor is distinguished from one that is not installed.
Profile replacement occurs at a tick boundary.
Priority notation for overlapping capability conditions still needs to be settled.

Device supplementary information such as pressure and flow is entirely optional.
Basic control and interlocks can be used without it.
Insufficient information for optional analysis `check` yields Unknown and does not block operation.
Successful verification becomes a start condition only when the user explicitly marks that analysis as a mandatory `require`.
The detailed distinction follows the [optional-information contract](CONSTRAINTS.md).

`schedule starts: DailySlots<15min>` is a setting selecting multiple slots among 96 times per day in a local time zone.
Duplicate slots and times outside the 15-minute grid are rejected.
`starts.due` is a bool sample occurring once on the tick that passes a selected time.
During ordinary time progression, the same date/slot does not occur twice.
The example does not retrospectively execute schedules from before boot, or store schedules arriving during operation.
Stable occurrence IDs, persistent execution records during clock correction/reboot, and per-facility cumulative time limits follow the [common constraints contract](CONSTRAINTS.md).
A daily limit does not substitute for duplicate prevention.
Detailed slot normalization rules for DST and schedule edits will be settled before implementing time syntax.

`timer age = elapsed(phase)` is monotonic elapsed time since the last committed change of phase.
The timer resets to zero when the tick changing phase commits; subsequent ticks read elapsed time.
Its initial value is zero, and internal timer state is included in checkpoint/replay.
This declaration creates neither a wait command nor a separate execution thread.

`2s` and `5min` are Duration literals.
A phase transitions at most once per tick, advancing on the first tick satisfying its condition.
The delay is at least the requested value; in normal operation its error is bounded by tick resolution.

## Control examples to copy and read

The latching and schedule examples below compile with `ghostc` and run on a manifest host.
The final `adapt` block is an **unimplemented design example** explicitly rejected by the compiler.
Names and values are minimal so the reader can see one control's inputs, state, and output connections in one place.

### Stop-priority latching control

```text
control LatchingPump {
  input start: Bool;
  input stop: Bool;
  input enabled: Bool;

  output pump, valve: Bool;
  state running: Bool = false;

  // stop과 start가 같은 tick에 오면 stop이 이긴다.
  running' = !stop && enabled && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```

`running` is the previous tick's latched state; `running'` is the value to commit this tick.
Even if `start` is a one-tick pulse, `running` retains it from the next tick onward.
On a tick with `stop`, `enabled == false`, or both, `running'` and both outputs become false.
Consequently, providing `start` and `stop` simultaneously does not restart the control.

Here `enabled` is a local permission input, and the one-line `require` represents a relationship between bool outputs.
Do not interpret this control alone as implementing automatic/manual/configuration mode transitions, shared-pump session ownership with other controls, or a total valve-count limit.
Facility-wide interlocks and arbitration belong to the mode manager and shared-facility constraints in the [common constraints contract](CONSTRAINTS.md).
Feedback sensors, pressure, and flow are not mandatory inputs to this basic example.

Computing output intent and the actual output's start, stop, and safe state on failure are different boundaries.
The GhostFlow VM only computes connection expressions and safety constraints and returns requested/safe intent.
The host/Driver owns the fail-safe policy that turns all outputs OFF on boot, failure, or disconnection, and its application timing.
Do not interpret the omitted initial value of an `output` declaration as expressing such a policy.

### Single-valve watering example illustrating schedules and timers

The following **design example** reduces the schedule/phase-transition portions of the [literate watering example](../examples/scheduled-watering.ghost.md) to a single-valve control.
The complete two-valve example is in the linked file. Below, input declarations, state transitions, and output connections can be read together.

```text
control TimedWatering {
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 18:45];
  }

  output pump, valve: Bool;
  type Phase = Idle | Open1 | Water1 | Stop1;

  state phase: Phase = Idle;
  timer age = elapsed(phase);

  phase' = case phase {
    Idle =>
      if starts.due then Open1 else Idle;

    Open1 =>
      if age >= 2s then Water1 else Open1;

    Water1 =>
      if age >= 5min then Stop1 else Water1;

    Stop1 =>
      if age >= 2s then Idle else Stop1;
  };

  valve <- phase' in {Open1, Water1, Stop1};
  pump  <- phase' in {Water1};
  require pump => valve;
}
```

Expected behavior is as follows.
`Idle` changes to `Open1` only on the tick passing a selected 06:00 or 18:45 slot.
When entry into `Open1` commits, `age` becomes zero. After at least 2 seconds the phase changes to `Water1`, then after at least another 5 minutes to `Stop1`.
`Stop1` is also retained for at least 2 seconds before returning to `Idle`.
Because each phase transition occurs only once per tick, one long tick does not pass through all phases at once.

This code explains the normal schedule/timer operation path. It does not represent an independently safe complete facility program.
`pump` turns on only in Water1. In Stop1, it stays off while the valve cleanup interval elapses.
External Stop, shared-resource permission, duplicate-occurrence suppression, and daily limits are not implicit in this state machine; their scope follows the [common constraints contract](CONSTRAINTS.md).

### Optional moisture adaptation: syntax-unsettled sketch

`examples/scheduled-watering.ghost.md` contains no `adapt` notation.
The following is therefore an **extension sketch** showing only the intent of the `has moisture` guarded scope described above, not code establishing complete syntax or an execution contract.

```text
// 확장 스케치 — 실제 adapt 블록의 표기와 우선순위는 아직 미확정.
// has moisture 보호 범위 안에서만 optional moisture를 읽는다.
has moisture {
  // 정상 moisture 값을 이용해 관수 시간을 조정하는 계산을 둘 수 있다.
  // 일시적 sensor fault는 설치 없음과 구분해 별도로 처리한다.
}

// moisture가 없으면 기본 시간표/타이머 control은 그대로 동작한다.
```

Moisture is thus an optional capability used only in a profile where it is installed. It is not required to begin basic watering.
Moisture filtering, fault, and recovery handling follow the [sensor contract](CONSTRAINTS.md); exact `adapt` block notation is later scope.
Supplementary information such as pressure and flow is likewise not forced into basic control.
To make advanced analysis a mandatory start condition, the user must explicitly add a `require`.

## Literate is document-form input for the same language

Formal GhostFlow input consists only of `.ghost.md` literate documents.
One control may be split into several ghost blocks between explanatory paragraphs; extracted code lowers to the same type and execution model.
Ordinary `.ghost` raw material is only historical evidence, not compiler input or a fallback.
The detailed extraction/source-map contract is in [LITERATE.md](LITERATE.md).

The [literate watering example](../examples/scheduled-watering.ghost.md) is the formal executable example.
The reference implementation of current control syntax, time functionality, and literate runs using GFB1 and a manifest.
Unimplemented extensions are distinguished in the [implementation boundary](IMPLEMENTATION.md).
The principles of determinism, error recording, ghost execution, and module replacement from the [0.2 common contract](LANGUAGE.md) are inherited.
