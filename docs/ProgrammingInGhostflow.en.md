<!-- translation-source: docs/ProgrammingInGhostflow.md -->

[Korean original](ProgrammingInGhostflow.md)

# Programming in GhostFlow

Reading, running, and explaining electrical control as code

**User guide · Language Reference basis · dev reviewed 2026-09-28**

## This document's role

GhostFlow is a reactive control language describing state changes and device output intent from sensors and user inputs. This document provides a learning path for reading and writing your first programs. The [Language Reference](LANGUAGE-REFERENCE.md) and its detailed chapters define normative syntax, types, evaluation, and time contracts. See the [GhostFlow Coding FAQ](language_faq.md) for answers to particular coding situations.

If this document differs from the Reference, follow the Reference. These examples demonstrate notation and semantics selected in the current specification. They do not claim completed implementation, runtime availability, or board deployability. Reflect syntax changes in the Reference first, then align this guide's examples.

This review uses dev revision `3982e6bf71cf5880286fcea017cb355ab222428d`. Check subsequent implementation scope in
[Implementation](IMPLEMENTATION.md) and [feature maturity and executable evidence](REFERENCE-FEATURE-STATUS.md).
The [Semantic Kernel 0.1 review plan](plans/2026-09-28-semantic-kernel.md) provides background for the frozen minimum semantic contract.
The whole Reference and this whole book are not included in that stable scope.

The independent controls E01–E10 and E12–E14, and E15's literate document, are checked by the current compiler tests.
E11 is notation guidance. E08's enum/elapsed, E09's schedule, and E10/E14's sensor/adaptation include
features outside the frozen core. Compilation does not establish activation of required runtime capabilities
or physical device behavior. Do not read Chapters 11–12's composition/replacement contracts as completed implementation instructions.

### How to read

- Each `ghost` example is an independent program. Do not concatenate all examples into one file.
- An actual program is a complete `.ghost.md` document. Top-level `ghost` fences combine in document order into one control root. Paragraphs and intent explanations remain part of the source document.
- Outputs here are logical intent. Physical GPIO, relays, and sensor collection belong to bindings and Drivers.
- Find exact syntax in the [Reference syntax index](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기). See [Language Reference](LANGUAGE-REFERENCE.md#설계-철학) for design philosophy and [Reference Chapter 8](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표) for responsibilities by layer.

## Contents

### First practical path — from PLC to GhostFlow

The ten-stage learning path starts with buttons and lamps, then extends to START/STOP, motors, interlocks, limits, timers,
water levels, Manual/Auto, sequential control, and fault recovery. Examine each stage's control intent separately
from its language examples.

### Language chapters

1. [One switch and one output](#ch01)
2. [Names, values, types, and expressions](#ch02)
3. [What it means to remember state](#ch03)
4. [Output intent and final outputs](#ch04)
5. [Separating calculations with functions](#ch05)
6. [Control that waits for time](#ch06)
7. [Starting at scheduled times](#ch07)
8. [Sensor values and quality](#ch08)
9. [Reading expressions precisely](#ch09)
10. [Stopping, changing, and comparing](#ch10)
11. [Files and literate programs](#ch11)
12. [One device, multiple controls](#ch12)

Appendices: [A. Specification guide](#appendix-a) · [B. Learning through errors](#appendix-b)

<a id="ch01"></a>
## 1. One switch and one output

### E01 — Connecting an input to an output

The first program turns the LED on when the switch is on and off when the switch is off.

```ghost
// E01
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on;
}
```

`control FollowSwitch` declares the program's name and scope.
`input` is a value coming from outside; `output` is a value sent outside.
`Bool` has two values: `true` and `false`.

`lamp <- switch_on` means “in this output calculation, lamp follows switch_on.”
Reading `<-` from right to left reveals where the value comes from.

| Input `switch_on` | Output `lamp` |
|---|---|
| `false` | `false` |
| `true` | `true` |

The table shows the two possible Bool values. Release→press→release is not a third value,
but a **transition scenario** passing through these two rows over time.

### Distinguishing contacts, PLC inputs, and GhostFlow inputs

In relay circuits, NO (normally open) and NC (normally closed) give different physical continuity when contacts are at rest
and pressed. A PLC reads that electrical state through DI,
and normalizes it into program meaning according to wiring and input-module polarity. GhostFlow's
`switch_on` is already a normalized logical input. This example therefore has the following boundaries.

| Layer | NO | NC | Value passed to GhostFlow |
|---|---|---|---|
| At rest | Contact discontinuous | Contact continuous | `switch_on = false` |
| Pressed | Contact continuous | Contact discontinuous | `switch_on = true` |

Reversed raw contact behavior with NC is an input normalization issue. An NC contact
does not by itself mean adding `!` in the program. Specify normalization at the wiring/input-module
boundary and pass only a `false` or `true` Bool to GhostFlow.

Briefly, relays create physical contact paths, PLCs process the inputs with DI and ladder/function blocks,
and GhostFlow connects normalized semantic inputs to declared output calculations.
These examples explain logical calculations. Verification of actual contacts, electrical wiring, PLC input modules,
or device outputs falls within binding and Driver contracts.

### The unit for reading execution: tick

Here, one control calculation is called a **tick**. Within a tick,
read one captured input set. The next tick reads a new set.

This program needs no memory. The same inputs therefore produce the same outputs.
Chapter 3 adds `state` to remember values from previous ticks.

The information connecting `switch_on` to DI1 and `lamp` to RO1 is mapping outside the program.
Names do not automatically determine hardware ports. This lets the same calculation connect
to virtual switches/LEDs and device I/O.

### Try changing it

Change the connection to `lamp <- !switch_on;`. `!` inverts true and false.
Before running the code, predict the two output cells in the table above.

<a id="ch02"></a>
## 2. Names, values, types, and expressions

### Notation separating statements

In the current syntax, declarations and expression definitions end with `;`. `{ }` defines scope; indentation
aligns text for human readers. Neither two-space nor four-space indentation is mandatory.
A newline cannot replace a semicolon. Semicolons are optional in some positions,
such as the final expression in a function body or the end of a block. Appendix A covers these separately.

Names start with an English letter or underscore and can have subsequent digits. They are case-sensitive,
so `start` and `Start` differ. Do not use reserved words or the internal `__gf_` prefix as names.
Write Korean explanations in `//` comments or literate prose. Identifiers themselves currently use ASCII.

### Basic values and types

| Type | Example | Meaning |
|---|---|---|
| `Bool` | `true`, `false` | True or false |
| `Int` | `120`, `-2` | Exact signed 32-bit integer |
| `Number` | `3`, `0.5`, `-2` | General numeric values, represented internally as f64 |
| `Percent` | `30%` | Percentage values. Literal/input range is 0–100 |
| `Duration` | `250ms`, `2s`, `5min`, `1h` | Nonnegative time length with millisecond resolution |

`Int`, `Number`, `Percent`, and `Duration` are types with different meanings. For example,
`Percent` and `Number` cannot be compared directly. `Int` is an exact integer for quantities and counts;
`Number` is approximate numeric data for measurements and similar uses. Exact ranges and conversions follow
[Reference §2.1–2.3](reference/02-types-expressions-state.md#21-값-종류).

Without an expected numeric type, whole-number literals are `Int`; decimal or exponent literals are `Number`.
In an already established `Number` context, `3` is interpreted as Number from the start.

`Duration` literals use nonnegative integers with `ms`, `s`, `min`, or `h` units.
Write half a second as `500ms`. Detailed ranges and operations follow Reference §3.1.

`"Asia/Seoul"` is used in time-zone settings; `06:00` is used in schedule settings.
Do not confuse these with general string or time-value syntax.

### Exact counts and approximate measurements

Counted values, such as fruit quantities or repetition counts, must be exact integers. For example, `120 + 1`
must be exactly `121`. In contrast, measured real values such as temperature `24.3` can be approximate
within tolerances defined by the sensor and domain.

GhostFlow represents exact counts with signed 32-bit `Int`. Out-of-range values and invalid conversions
produce diagnostics or explicit runtime faults instead of silently wrapping or rounding.
Use `Number` for measured real values. See [Reference §2.3](reference/02-types-expressions-state.md#23-정확한-정수-설계) for details.

Dates and times use `date`, `time`, and `datetime` tagged literals. DateTime requires
a time-zone offset. Date/time and monotonic elapsed time have different meanings.
Follow [Reference §3.1](reference/03-time-and-schedules.md#31-시간값과-시계-영역).

Distinguish values whose units affect control decisions, such as temperature, flow, and voltage, from general `Number`.
For example, `25°C` for `Temperature`, `5L/min` for `FlowRate`, and `24V` for `Voltage` have fixed physical quantity types and units.
Allowed units, conversions, and operations follow
[Reference §2.9](reference/02-types-expressions-state.md#29-물리량과-단위).
`Rate<Q>` is an expression-only temporal-window type, not a general input/output/state type.

### E02 — Naming inputs, settings, and calculations separately

Turn on the water-supply output when water level is below the setting.

```ghost
// E02
control ThresholdControl {
  input level: Percent;
  config threshold: Percent = 30%;
  let low = case threshold {
    ok(value) => level < value;
    fault(_) => false;
  };

  output pump: Bool;
  pump <- low;
}
```

`level` is an input supplied every tick. `threshold` is an adjustable value exposed as `config`,
and `low` is the calculation comparing them. Changing a default in source creates a new document revision.
Operational changes can be applied as typed atomic live events only for settings exposed with `access = operator`.
The metadata contract follows [Reference §5](reference/05-settings-and-observation.md#51-config-선언).
Reading `config threshold: Percent` yields `Result<Percent, SettingsFault>`.
Its initial value is `ok(30%)`; later error observations do not automatically recover to the default.
This example chooses `low=false` on fault. This is not a language-wide fallback or a physical fail-safe guarantee.
`let` names a calculation; it is not stored memory.

| `level` | Healthy `threshold` payload | `low` / `pump` |
|---|---|---|
| `29%` | `30%` | `true` |
| `30%` | `30%` | `false` |
| `31%` | `30%` | `false` |

Placing `low`'s definition after the output connection yields the same calculation. The compiler follows
dependencies rather than declaration order. Cyclic `let` definitions requiring one another's results are disallowed.

**Small experiment:** If `<` becomes `<=`, which single table row changes?

<a id="ch03"></a>
## 3. What it means to remember state

### E03 — Stop-priority self-holding

Keep running after briefly pressing and releasing Start; stop when Stop is pressed.

```ghost
// E03
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  output valve, pump: Bool;

  running' = !stop && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```

`running` is the value remembered at tick start. `running'` is the next value calculated
in this tick. Read the trailing apostrophe as **prime**.

In words, the expression says “if Stop is not pressed, and Start is pressed or operation was already running,
continue running.” If both buttons are pressed, `!stop` is false, so Stop wins.

| tick | start | stop | Previous `running` | Next `running'` | pump |
|---|---|---|---|---|---|
| 1 | false | false | false | false | false |
| 2 | true | false | false | true | true |
| 3 | false | false | true | true | true |
| 4 | true | true | true | false | false |
| 5 | false | false | false | false | false |

The output reads `running'`, so it turns on in the starting tick.
Changing to `pump <- running;` outputs the previous value, delaying by one tick in this example.
The difference is **which point in time the referenced value belongs to**, rather than statement position.

### PC-02 — START / STOP waiting for a fresh start

Keep E03's basic self-holding unchanged. PC-02 adds `stop_ok`, `armed`, `running`, and `start_event`
in a [separate literate original](../examples/curriculum/pc-02-start-stop.ghost.md) to express stop priority and restart inhibition.
If START remains held when returning from STOP, it is not a fresh start event, so outputs remain off.
Release START and press again to turn on `running'` and pump/valve outputs. This example
does not replace E03. Verify actual contact/relay operation under a separate installation contract.

### PC-03 — Motor contactor commands and overload permission

In its [canonical literate original](../examples/curriculum/pc-03-motor-contactor.ghost.md), PC-03 connects
PC-02's fresh start event and self-holding to motor control commands. `stop_ok` and
`overload_ok` are normalized permission inputs. Electrical/device adapters define NC contact wiring
and polarity; this program reads only Bool meanings.

The key expressions are `permit = stop_ok && overload_ok`, `start_event = armed && start`,
`running' = permit && (start_event || running)`, `armed' = permit && !start`,
and `motor_contactor <- running'`.

`motor_contactor` is one logical command for the MC coil. It is not feedback or proof of MC main-contact closure,
motor power, or motor rotation. Distinguish the main circuit (breaker, MC main contacts, overload relay, motor)
from the control circuit (control power, STOP, overload protection contact, START/MC auxiliary-contact self-holding branch, MC coil).
Software commands do not replace independent electrical protection.
Alarms, fault latch/reset, timers, sensor feedback, and hardware operation are outside
this curriculum/learning scenario's scope.

This example distinguishes `requested` intent from `safe` results. Relay/MC/motor
physical evidence is not part of the language's output intent.

### PC-04 — Forward/reverse direction-change interlock

Run PC-04 from its [canonical literate original](../examples/curriculum/pc-04-direction-interlock.ghost.md).
Retain [E06 — Requesting both directions at once](#e06--requesting-both-directions-at-once)
as the basic example where `mutex` blocks both outputs when both become candidates. PC-04
does more than copy that constraint: it specifies logical forward/reverse operating states and a stopped wait between direction changes.

`forward_start` and `reverse_start` are momentary start inputs; `stop_ok` and `overload_ok`
are normalized permission inputs that are true when healthy. States are `Stopped | Forward | Reverse | WaitForward |
WaitReverse`, initially `start_armed=false`. If both starts arrive together, stop without
inventing priority. A fresh opposite-direction press while running first transitions to Wait,
immediately turning off both contactor commands. Turn on the opposite direction only after
the configured `reversal_wait = 2s`. If a fresh direction request changes the target while waiting,
move to the corresponding Wait state and restart the wait.
Do not retain an old target and start against the operator's fresh request.

`forward_contactor` and `reverse_contactor` are only logical commands for contactor coils. `mutex`
is a software backstop. Actual equipment also needs electrical and mechanical interlocks. Two elapsed seconds
do not prove the motor has physically stopped; express zero-speed feedback
through separate inputs and Driver contracts.

### PC-05 — Confirming valve end positions with limit feedback

Run PC-05 from its [canonical literate original](../examples/curriculum/pc-05-limit-feedback.ghost.md).
Retain and reference E06 and PC-04, using `Phase`, `elapsed(phase)`, next state,
and output connections to distinguish commands from observed completion.

Receive momentary `open_request`/`close_request`, end-position observations `open_limit`/`close_limit`,
and permissions `stop_ok`/`overload_ok`. Start in `Stopped` without inventing an initial position.
If a limit previously observed while stopped disappears, do not trust past state alone.
Both limits true lead to `SensorConflict`, with both outputs off. A fresh opposite-direction
request takes priority over the target limit, switching off both coil commands and resuming motion only at the two-second boundary.

Handle `Opening`/`Closing` without end-position arrival through timeout and fault policies. Commands and
end-position observations are separate values. Physical stopping belongs to the Driver and safety chain.

### PC-06 — Reading ON-delay, OFF-delay, and maximum operation separately

PC-06's [canonical literate original](../examples/curriculum/pc-06-timer-patterns.ghost.md)
shows three timer meanings with independent states. `on_delay_request` turns on after persisting for two seconds,
`off_delay_request` stays on three more seconds after demand disappears, and `limited_request`
turns off at ten seconds and cannot restart until demand is released. These three inputs are
currently maintained operating demands, not momentary button events.

Keeping these meanings out of a shared timer prevents OFF-delay from secretly extending maximum operating time.
`stop_ok=false` bypasses even OFF-delay and immediately turns off all three outputs. Evaluate immediately before, at, and after boundaries,
and cancellation/re-request, with the same logical tick rules. Do not confuse wall-clock speed with logical time semantics.

### PC-07 — Remembering state between two water-level switches

PC-07's [canonical literate original](../examples/curriculum/pc-07-tank-hysteresis.ghost.md)
covers digital two-point water-level control. `low_level_reached` and `high_level_reached` are
normalized observations that water has reached each physical switch. Start `Filling` below the lower level,
retain that state between lower and upper limits, and stop at the upper limit. An initially intermediate level
does not turn on because there was no previous low-level event.

An upper limit true with a lower limit false contradicts the physical order, so output is
off in `SensorConflict`. The conflict-clearing scan first returns to `Idle`, then normal evaluation resumes.
Do not mix common stop/protection and fault latch/reset into this water-level concept; combine them in PC-08/PC-10.
Retain tutorial/03's continuous-sensor median/quality/hysteresis example separately.

### PC-08 — Changing output ownership between manual and automatic

PC-08's [canonical literate original](../examples/curriculum/pc-08-manual-auto.ghost.md)
connects PC-03's manual start/self-holding and PC-07's automatic demand to one pump.
If `manual_mode_request` and `auto_mode_request` are both false, use `Off`; if only one is true,
use that mode; if both are true, use `ModeConflict`. Pump commands are always off
on conflict, Off, and mode-change scans.

`manual_start` is a momentary start event; `auto_demand` is maintained automatic demand.
The shared `request_armed` recognizes a new true as a start event only after first observing
the selected demand false in a stable mode. Thus, changing modes while running or recovering
stop/overload permission does not restart with demand already on. Losing demand during Auto
immediately stops operation. Retain [station-rules.ghost.md](../examples/station-rules.ghost.md) and
[tutorial/04](../examples/tutorial/04-extra-valves.ghost.md)
as advanced material on multiple controls and shared-resource arbitration.

This example handles mode conflicts through explicit state and output expressions. Coil closure or pump rotation
requires separate device confirmation.

### PC-09 — Turning on the pump after confirming opening

PC-09's [canonical literate original](../examples/curriculum/pc-09-sequential-water-supply.ghost.md)
specifies `Idle → Opening → Settling → Watering → PumpStopping → Closing → Idle`.
Distinguish an enabled valve-opening output from observation that the valve physically reached the open position.
`open_limit` must remain confirmed for two seconds before the pump turns on. On the scan
ending five minutes of irrigation, turn off the pump first. Turn on the closing contactor from the next logical scan,
ensuring output order without inventing another delay.

All outputs turn off if open-position feedback disappears, both limits turn on together, or stop/overload permission disappears.
Do not restart merely because the cause clears. Observe the closed position and released START,
then require a fresh START. Opening/closing nonresponse timeouts, fault latch, alarm,
reset, and fault-specific safe recovery belong to PC-10.

Retain tutorial/02's time-only sequence and tutorial/04's shared-pump arbitration across controls,
because they have different learning intents. This example treats logical commands, valve movement,
pump rotation, and flow observations as separate contracts.

### PC-10 — Capturing fault causes and recovering safely

PC-10's [canonical literate original](../examples/curriculum/pc-10-fault-alarm-reset.ghost.md)
adds fault causes, alarms, and reset to PC-09's sequential operation. The GhostFlow blocks in that document
are the sole executable original. The following explanations or extracted code do not become independently editable originals.
Preserve PC-01–PC-09's learning intents. This lesson adds only the new intent of fault detection and recovery.

Safety evaluation priority is `EmergencyStop > Overload > ValveDriveUnavailable >
SensorConflict > FeedbackLost > OpenTimeout/CloseTimeout > LowSourceWater`.
If several causes occur in one scan, latch the first in this order as `FaultCause`.
Subsequent live input changes do not overwrite it. An external hardwired
safety chain must cut energy on emergency stop. GhostFlow observation inputs and alarms do not guarantee
that physical cutoff or actual equipment operation.

Normal `STOP` is not a fault. When `stop_ok == false`, immediately turn off all motion outputs and the alarm,
return to `Idle`, and do not restart automatically. A fault clears only through a RESET release/repress procedure,
after both the latched cause and all current fault conditions have cleared and `known_closed` is confirmed.
Release RESET once and press again. A remaining secondary live fault blocks RESET.
RESET only returns to `Idle`; it does not replace START. A released START must be observed,
then a fresh `START` is required to run again.

`LowSourceWater` exceptionally performs an orderly close only with a confirmed open valve and closing-drive permission.
In `FaultPumpStopping`, turn the pump off first for one logical scan,
then request valve closing in `FaultClosing`. Other fault/safety conditions immediately
become all-off faults. Opening/closing timeouts are ten seconds each. At the exact boundary,
observation of the target limit takes priority over timeout.

This example does not confuse semantic DI with physical wiring. The first cabinet's existing meanings,
`START`, `STOP`, `MODE`, tank upper/lower limits, open/close limits, and overload, total eight DI.
Separating `RESET`, E-stop observation, source-water-low, and valve-drive-ok gives 12 meanings total.
An 8DI installation therefore needs a site-specific choice among external safety-chain aggregation,
authenticated host commands, or DI expansion. Do not silently combine or omit meanings.

Current `require` syntax expresses only Bool **output relationships**. Specify input safety conditions and fault priorities
in `phase` transitions and output expressions. Thus,
do not interpret `require` alone as expressing the entire input safety policy.

This example distinguishes logical intent from feedback inputs. Language semantics alone do not establish physical acceptance
of Web UI, MCU upload, contactor energy cutoff, valve movement, or pump rotation.

### E04 — Multiple states change together

```ghost
// E04
control TwoStates {
  state a: Bool = true;
  state b: Bool = false;
  output out_a, out_b: Bool;

  a' = b;
  b' = a;
  out_a <- a';
  out_b <- b';
}
```

After the first tick, `a=false`, `b=true`. After the second,
`a=true`, `b=false` again. Both expressions read the same previous state to exchange values.
Do not read this as top-to-bottom assignment that overwrites `a` first.

Currently, next-state references are permitted only in output expressions. Code such as `b' = a';`
using another state's next value in a state transition is rejected. Name shared calculations
with `let` when multiple transitions need them.

**Design reason:** Explicit previous and next states preserve the “basis for this evaluation”
while updating state simultaneously. This distinction grounds timing comparisons and values displayed beside source.

A successful tick calculates candidate next from this tick's input snapshot and previous state, then requested and safe intents,
and atomically commits state and intent records. A runtime fault in a selected expression rejects the tick without partial updates.
Output-constraint blocking differs from this evaluation failure and does not cancel the successful tick's state commit.

<a id="ch04"></a>
## 4. Output intent and final outputs

“Final outputs” in this chapter means the runtime's **safe intent**. `<-` creates **requested intent**, which constraints restrict.
**Applied** is evidence of a command applied by a Driver; **confirmed** is separate feedback evidence such as a limit or encoder.
A true safe intent does not establish relay or pump operation. Read
[Reference §4.7](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed) and the
[physical Driver boundary](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary) together.

### E05 — Requests to turn on and permitted outputs

The calculation “please turn on the pump” may differ from the decision “the pump may turn on.”
This time, deliberately make the values differ.

```ghost
// E05
control PumpPermission {
  input request, valve_ready: Bool;
  output pump, valve: Bool;

  pump <- request;
  valve <- valve_ready;
  require pump => valve;
}
```

| request | valve_ready | Candidate pump / valve | Final pump / valve |
|---|---|---|---|
| false | false | false / false | false / false |
| true | true | true / true | true / true |
| true | false | true / false | false / false |

In the last row, pump intent from `<-` is true, but `require` blocks it.
`pump => valve` requires the valve to be requested too when the pump is requested.
It turns the pump off instead of forcing the valve on to satisfy the condition.

```text
request ─────────────→ pump intent ──┐
                                    ├─ require check ─→ final pump
valve_ready ─────────→ valve intent ─┘
```

`valve_ready` is only an input name in this example. Input mapping explains which sensor or calculation
supplies it. The complete explanation needs both “why the output is true”
and “where the input came from.”

### E06 — Requesting both directions at once

```ghost
// E06
control DirectionInterlock {
  input forward_button, reverse_button: Bool;
  output forward, reverse: Bool;

  forward <- forward_button;
  reverse <- reverse_button;
  mutex(forward, reverse);
}
```

If both inputs are true, both outputs become false. Neither the first-written output nor the first-pressed button
automatically has priority. `require !(forward && reverse);` also
blocks simultaneous requests for these outputs.

With connected constraints, apply them while reflecting blocking results until nothing changes further.
For example, another constraint turning a valve off also turns off a pump requiring that valve.
Current local Bool constraints lower true outputs to false. They are not a language feature
automatically finding a combination satisfying arbitrary logical expressions.

Blocking an output through a constraint does not automatically revert `state`.
To move to a stopped state, express that transition in the program too.

**Small experiment:** Change E03 to `pump <- start;` and release Start.
Can you separately explain `running` remaining true and `pump` turning off?

<a id="ch05"></a>
## 5. Separating calculations with functions

### E07 — Extracting the self-holding calculation into a function

```ghost
// E07
fn hold(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}

control FunctionLatch {
  input start, stop, enabled: Bool;
  state running: Bool = false;
  output pump: Bool;

  fn permitted(request: Bool, allow: Bool) -> Bool {
    request && allow
  }

  running' = permitted(hold(start, stop, running), enabled);
  pump <- running';
}
```

`fn` defines a function; `-> Bool` is its result type. The final body expression is its result,
so no separate `return` statement is used. Write calls as `hold(start, stop, running)`.

Both functions receive values and return calculated values. If `enabled=false`, `permitted`
returns false, so next state is also off. While `enabled=true`, this is E03's self-holding.

Current functions receive external inputs, state, and settings as parameters instead of reading them directly.
Needed values appear at the call site, making dependencies readable. For example, attempting to read
global `running` directly inside `hold` is rejected.

Functions are statically expanded at compile time. Recursive and cyclic calls are rejected.
Do not create time-blocking execution flows or private mutable state inside functions.
Express memory with `state` and time with the next chapter's timers.

**Small experiment:** In `permitted(hold(...), enabled)`, if `enabled` becomes false
and then true again, will operation resume without Start? Extend E03's state table.

<a id="ch06"></a>
## 6. Control that waits for time

### E08 — Turning on after an input persists for two seconds

```ghost
// E08
control DelayedStart {
  input start: Bool;
  config delay: Duration = 2s;
  type Phase = Idle | Waiting | Running;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  output motor: Bool;

  phase' = case delay {
    ok(value) => case phase {
      Idle => if start then Waiting else Idle;
      Waiting =>
        if !start then Idle
        else if age >= value then Running else Waiting;
      Running => if start then Running else Idle;
    };
    fault(_) => Idle;
  };

  motor <- phase' == Running;
}
```

`type Phase = ...` defines a type of named finite states.
`case phase` selects the expression for the current stage to calculate the next stage.
All cases must be covered, and both `if` results must have the same type.

`delay` is `Result<Duration, SettingsFault>`. Compare time with its payload only in `ok(value)`.
On a config fault, this example cancels the pending wait and transitions to `Idle`, keeping output intent off.
A later valid config and `start=true` begin a new wait. `2s` is the initial `ok` payload, not an error fallback.
This is this example's policy, not a language/Driver default or a physical fail-safe guarantee.

`elapsed(phase)` is **elapsed time since phase's last committed change**.
The timer resets to zero at the commit point of the tick changing `Idle` to `Waiting`.
Transition at the first tick where the condition is true; do not skip several stages in one tick.

| Logical time | start | Stage read | age read | Next stage | motor |
|---|---|---|---|---|---|
| 0ms | false | Idle | 0ms | Idle | false |
| 1000ms | true | Idle | 1000ms | Waiting | false |
| 2999ms | true | Waiting | 1999ms | Waiting | false |
| 3000ms | true | Waiting | 2000ms | Running | true |
| 4000ms | false | Running | 1000ms | Idle | false |

The starting point is not the physical button-change time. It is the tick in this example
that reads the change and transitions to `Waiting`. Thus two seconds are counted from 1000ms.

### Acceleration changes time progression

Running simulation at ten times speed does not change `2s` in source to `200ms`.
Advance logical time faster than real waiting time. Given identical logical times and inputs per tick,
the same evaluation must result regardless of speed.

The boundaries for timer calculation time, DI input sets, and final RO outputs must be shared.
Native and WASM execute expressions, state, timers, and constraints in the same Rust core. The host supplies inputs,
logical time, and scan opportunities; actual Device I/O Drivers form a separate boundary.
Concrete frame and Driver APIs are host contracts. Do not add platform branches to this source.

The current CLI simulator provides virtual I/O displaying inputs and requested/safe intents.
It has no plant model automatically deriving tank levels or sensor values from pump intent.
Piped mode advances only at explicit scans; interactive TTY supplies elapsed wall time.
Schedules, sensors, and certified intervals require the corresponding host capabilities. Follow
[Authoring and virtual simulation architecture](LLM-TOOLCHAIN-ARCHITECTURE.md#reproduce-the-public-path) for execution paths and reproduction commands.

**Small experiment:** Move the tick after 2999ms to 3500ms. The motor turns on at that tick.
The timer condition is two seconds, but observation and transition occur at tick times.

<a id="ch07"></a>
## 7. Starting at scheduled times

### E09 — Running five minutes at two times each day

```ghost
// E09
control ScheduledPulse {
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 18:45];
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  let run_time = 5min;
  type Phase = Idle | Watering;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  output valve, pump: Bool;

  phase' = case phase {
    Idle => if starts.due then Watering else Idle;
    Watering => if age >= run_time then Idle else Watering;
  };

  valve <- phase' in {Watering};
  pump <- phase' == Watering;
  require pump => valve;
}
```

`DailySlots<15min>` selects times on a 15-minute grid within local dates. Duplicate slots and off-grid times are rejected. `starts.due` is a schedule projection; occurrence admission and missed/unknown reasons are retained as separate observations. This schedule specifies pulse basis, a trusted clock, a 60-second observation gap, baseline recovery, and skip fallback. See [Reference §3.5–3.6](reference/03-time-and-schedules.md#36-선택된-dailyslots).

| Event | Previous stage | Next stage | pump |
|---|---|---|---|
| Selected start event | Idle | Watering | true |
| Less than five minutes elapsed | Watering | Watering | true |
| First tick with at least five minutes elapsed | Watering | Idle | false |

`in {Watering}` checks set membership. With multiple states,
list values of the same type, such as `phase' in {Opening, Watering, Closing}`.

This source has no queue. Another start event arriving during Watering is not stored.
Schedule occurrence identity, duplicate suppression, missed handling, and replay evidence follow Reference §3.5. Do not arbitrarily catch up overlaps or omissions from other schedules.

**Small experiment:** If `starts.due=true` is supplied again during Watering, will the end time
move later? The answer lies in what the Watering branch reads.

### Calendar time and natural events

Calendar time, schedules, and monotonic elapsed time are different input meanings. Dates and times are tagged literals; recurring schedules use type-specific `schedule` declarations. Exact notation for `DailySlots`, `Periodic`, `cron5`, solar/lunar/tide context, time zones, gap recovery, and mandatory fallback follows [Reference §3](reference/03-time-and-schedules.md).

Sunrise/sunset, tide predictions, calendar, and clock data depend on external provider/Driver contracts. Source specifies reference events and fallback. Do not hide prediction data in a single Bool or assume time is always trusted. Read Reference policies and supply required environmental capabilities through bindings.

<a id="ch08"></a>
## 8. Sensor values and quality

### Input values and measured values

The earlier `input level: Percent` declared a value supplied by the host for the current calculation.
Actual sensors have states such as not ready, disconnected, and stale measurements, as well as values.
When reading `sensor`, also handle whether a healthy value was obtained.

### E10 — Deciding water supply from fluctuating moisture values

```ghost
// E10
control MoistureControl {
  input enabled: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(3);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  let need_water = case dry {
    ok(value) => value;
    fault(_) => false;
  };

  output pump: Bool;
  pump <- enabled && need_water;
}
```

`sample` describes the desired measurement interval. This declaration does not create
a thread directly reading a sensor; the host supplies timestamped measurements.
`valid` is the valid range; `median(3)` filters the median of three valid measurements.
`stale_after` defines staleness; `recover_after` defines recovery conditions.
Consider both filter-window readiness and satisfaction of recovery conditions.

`hysteresis` separates on and off thresholds. For healthy measurements, a filtered value below
30% turns the dry state on, and above 35% turns it off. Between the thresholds,
retain the previous decision. Exactly 30% or 35% also retains it.
Thus, fluctuation near 30% does not invert the output each time.

For example, if three values entering a ready filter are `29%, 90%, 28%`, their median is `29%`.
With healthy quality and `enabled=true`, that value leads to a dry decision and water-supply request.

`ok(value)` names a healthy result. `_` in `fault(_)` means the specific error value
is unused in this calculation. Even if `false` is chosen as the fallback value, original quality information
remains in execution records. Here, `ok` and `fault` are case patterns. The current language also provides
`ok(...)`/`fault(...)` constructors for built-in `Result<T, E>` with compiler-owned fault types, and static
`map`, `and_then`, and `recover` transforms. Distinguish these from user-defined error ADTs or general higher-order functions.
Follow [Reference §2.5](reference/02-types-expressions-state.md#25-sensor-결과와-명시적-오류-흐름).

### E14 — An optional sensor

```ghost
// E14
control OptionalMoisture {
  sensor moisture?: Percent;
  output request: Bool;
  adapt moisture_policy {
    strategy WithMoisture priority 100 match (moisture: sensor<Percent>) {
      request <- case moisture {
        ok(value) => value < 30%;
        fault(_) => false;
      };
    }
    strategy Baseline priority 0 match always {
      request <- false;
    }
  }
}
```

`?` is declaration information indicating an optional installation capability.
Compare the installed sensor's healthy value in `WithMoisture`; request false on faults.
When uninstalled, `Baseline` requests false. `?` alone does not generate a fallback strategy.
Detailed rules follow [Reference §4.5–4.6](reference/04-sensors-constraints-control.md#45-선택-sensor와-capability).

**Small experiment:** What happens if E10's on/off thresholds are identical?
For evaluation, should the chart show raw measurements or filtered results?

<a id="ch09"></a>
## 9. Reading expressions precisely

### E12 — Numbers and operators

```ghost
// E12
control NumbersAndOperators {
  input a, b: Number;
  output sum, difference, product, quotient, negative: Number;
  output equal, different, less, at_most, greater, at_least: Bool;

  sum <- a + b;
  difference <- a - b;
  product <- a * b;
  quotient <- a / b;
  negative <- -a;
  equal <- a == b;
  different <- a != b;
  less <- a < b;
  at_most <- a <= b;
  greater <- a > b;
  at_least <- a >= b;
}
```

With `a=6`, `b=2`, numeric outputs in order are `8, 4, 12, 3, -6`.
Bool outputs are `false, true, false, false, true, true`.
Number outputs can also be observed logically, but cannot be directly mapped to Bool relay ports.

Precedence from strongest to weakest is as follows.

| Rank | Notation |
|---|---|
| 1 | Parentheses, function calls, member/next-state references |
| 2 | Unary `!`, `-` |
| 3 | `*`, `/` |
| 4 | `+`, `-` |
| 5 | `in {…}` |
| 6 | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| 7 | `&&` |
| 8 | `||` |

Binary operations with the same precedence group from the left. `6 - 2 - 1` means `(6 - 2) - 1`.
Use parentheses or named `let` calculations to separate complex conditions for reading.

`=>` differs from ordinary arithmetic/logical operators. It denotes output-constraint relationships
and case-branch connections; it cannot be inserted arbitrarily into ordinary expressions.

### E13 — Having conditionals versus skipping calculation

`if`, `&&`, and `||` evaluate deterministically from left to right with short-circuiting. Runtime faults
in unselected branches do not occur, but all branches undergo static type checking. For example:

```ghost
// E13
control SafeDivision {
  input a, b: Number;
  let zero = b == 0;
  let denominator = if zero then 1 else b;
  output result: Number;

  result <- if zero then 0 else a / denominator;
}
```

With `a=6, b=2`, select `3`; with `a=6, b=0`, select `0`.
For zero, `0` is the fallback result chosen by this program. In domains that do not need
such a choice, exposing the error may be more appropriate.

### E11 — Using only canonical notation

New programs use `fn`, `type Mode = Off | On;`, `running' = ...;`, and `if c then a else b`. `purefn`, `enum` syntax, `next running`, `input.start`, `state.running`, and `ifthenelse(...)` are not permitted aliases. If you see these in older documents, follow the migration explanation in [Reference §1.6](reference/01-source-and-syntax.md#16-대표-표기-참고-별칭과-역사적-대안).

<a id="ch10"></a>
## 10. Stopping, changing, and comparing

An important experiment for understanding GhostFlow is running two code versions with identical inputs.
Use E03's stop-priority self-holding as the baseline.

```text
Original A: running' = !stop && (start || running);
Modified B: running' = start || (!stop && running);
```

With `start=true`, `stop=true`, A produces false and B true.
A small change in parentheses and the position of `start` changes priority for simultaneous inputs.

| Previous running | start | stop | A's next value | B's next value |
|---|---|---|---|---|
| false | true | false | true | true |
| true | false | false | true | true |
| true | true | true | false | true |
| true | false | true | false | false |

### Comparison experiment sequence

1. Preserve original source and each tick's inputs/logical time.
2. Define state at the comparison starting point. For comparison from the beginning, start from each program's initial state.
3. Create a modified version while retaining the original.
4. Supply both programs with the same input record at the same times.
5. Compare state, output intent, constraint decisions, and final outputs side by side.

Changing state structure requires separate rules for migrating existing checkpoints.
Starting the book's first experiment with replay from initial state makes comparison conditions explicit.

### Which values should appear beside source?

In the editing experience we are building together, place `start`, previous `running`, and next `running'`
for the selected tick beside source. Selecting `pump` traces the conditions from which its value flowed.
If a constraint changed an output, show both candidate and final values.

The observation screen needs to answer four questions.

- From which inputs and previous state was this value calculated?
- What are the next state and output intent?
- Which constraint permitted or blocked it?
- At which tick do the original and modified versions first differ?

Observable values and evidence kinds follow [Reference §5](reference/05-settings-and-observation.md). Screen presentation must preserve the meaning of the corresponding descriptor.

<a id="ch11"></a>
## 11. Files and literate programs

### One file and one control

The execution root is one `control`. Declare reuse across files with document-scope `import`
pinning complete `.ghost.md` definition revisions and digests.
Compose imported controls with `instance` and `connect`. Wildcard imports and a second
root control are disallowed. Detailed syntax follows [Reference §6](reference/06-composition-and-replay.md#64-import와-연결의-문법).

The single-root rule provides the skeleton of an executable definition. It prevents an ambiguous root when composing several imported definitions as instances.

### E15 — Writing explanation and code in the same document

Consider saving the following entire content as `follow-switch.ghost.md`.

````markdown
# 입력을 따라가는 출력

스위치와 LED의 값을 선언한다.

```ghost
// E15
control LiterateSwitch {
  input switch_on: Bool;
  output lamp: Bool;
```

출력은 매 tick 스위치의 값을 따른다.

```ghost
  lamp <- switch_on;
}
```
````

The compiler joins exact top-level `ghost` code blocks in document order.
Above, one `control` is merely split into two blocks; it does not create two programs.
Explanatory paragraphs do not execute, and error locations link to the original document.

Ordinary paragraphs, other info strings, and nested fences in lists/quotes are not executable code.
Exact extraction rules are in [Reference §1.1](reference/01-source-and-syntax.md#11-왜-문서-하나가-소스인가).

### Files and program composition

File placement does not replace import relationships. `import` specifies immutable source identity; `instance` and `connect` connect typed logical ports. Review changed originals as new revisions. Imports, instances, bindings, and provenance follow [Reference §6.2–6.7](reference/06-composition-and-replay.md).

Distinguish compiler contract checking of pinned imports, instances, and ports from runtime execution.
Composition runtime activation is not a completed feature. For a single-control exercise, save the entire document as in E15,
then check and compile it from the language repository root:

```sh
node tools/ghostc.mjs --check follow-switch.ghost.md
node tools/ghostc.mjs follow-switch.ghost.md build/follow-switch.gfb
```

Node dependencies are required. GFB, manifest, and source map are derived artifacts; `.ghost.md` remains the editable original.
Do not compile this whole book as one executable document.

<a id="ch12"></a>
## 12. One device, multiple controls

Each definition has one control root. Program reuse is expressed by creating instances of imported controls and connecting logical ports. Sharing a physical resource requires explicit identity and resource contracts. Distinguish control output intent from physical confirmation of final device effects.

```text
definition revision → import → instance + typed connect
                   → semantic composition → bound runtime
```

Use `adapt`, capability checks, common constraints, shared resources, replay, and hot replacement only at their prescribed locations and with their defined types and contracts. Syntax and semantic DAG rules follow [Reference §6](reference/06-composition-and-replay.md); device/Driver/binding responsibilities follow [Reference §8](reference/08-language-runtime-and-device-boundaries.md). Do not assume an arbitrary separate policy language inside ordinary `control`.

<a id="appendix-a"></a>
## Appendix A. Specification guide

This table guides you from learning chapters to normative syntax. It does not replace the full grammar or an implementation support list.

| Topic | Language Reference |
|---|---|
| `.ghost.md`, fence extraction, anchors, names, declaration skeletons | [Chapter 1](reference/01-source-and-syntax.md) |
| Types, integers, Result, expressions, functions, ticks, state | [Chapter 2](reference/02-types-expressions-state.md) |
| Duration, time, timers, schedules, solar/lunar/tide | [Chapter 3](reference/03-time-and-schedules.md) |
| Sensor quality, filters, capabilities, constraints, resources | [Chapter 4](reference/04-sensors-constraints-control.md) |
| Typed config, live updates, observation descriptors | [Chapter 5](reference/05-settings-and-observation.md) |
| Import, instance, connect, macro, replay, replacement | [Chapter 6](reference/06-composition-and-replay.md) |
| Errors, uncertainty, syntax index | [Chapter 7](reference/07-semantic-rules-and-index.md) |
| Language/runtime/Driver/binding/UI responsibilities | [Chapter 8](reference/08-language-runtime-and-device-boundaries.md) |
| Frequently asked coding examples | [GhostFlow Coding FAQ](language_faq.md) |

<a id="appendix-b"></a>
## Appendix B. Learning through errors

These short error examples exercise Reference rules. Read each independently.
`ghost-error` is a presentation tag marking error examples in this guide. Actual `.ghost.md`
execution fences use exactly `ghost`. Do not place the error code below in an executable program.

### E90 — Missing semicolon

```ghost-error
control MissingSemicolon {
  input start: Bool
  output pump: Bool;
  pump <- start;
}
```

A newline does not replace the end of a declaration. `;` is required after the declaration.

### E91 — Comparing different types

```ghost-error
control MixedTypes {
  input level: Number;
  output pump: Bool;
  pump <- level < 30%;
}
```

`Number` and `Percent` do not undergo implicit conversion.

### E92 — Next-state dependency

```ghost-error
control NextDependency {
  state a: Bool = false;
  state b: Bool = false;
  output lamp: Bool;
  a' = !a;
  b' = a';
  lamp <- b';
}
```

Within one tick, next-state expressions read the previous state snapshot. They do not chain reads of other states' next values.

### E93 — Two root controls

```ghost-error
control First { output lamp: Bool; lamp <- false; }
control Second { output lamp: Bool; lamp <- true; }
```

A program has one execution root control. To reuse several controls, use import/instance/connect from Reference Chapter 6.

### E94 — Exceeding the mutable integer range

```ghost-error
control OutOfRange {
  let count = 2147483648;
  output lamp: Bool;
  lamp <- false;
}
```

`Int` literals must fit the signed 32-bit range. See [Reference §2.3](reference/02-types-expressions-state.md#23-정확한-정수-설계) for integer ranges and conversions.

### E95 — Missing enum case

```ghost-error
control MissingCase {
  type Mode = Off | On;
  state mode: Mode = Off;
  output lamp: Bool;
  lamp <- case mode { Off => false; };
}
```

`case` must handle all possible enum members.

### E96 — Duplicate output connection

```ghost-error
control DuplicateOutput {
  output lamp: Bool;
  lamp <- false;
  lamp <- true;
}
```

An output needs one connection. Statement order does not overwrite an earlier connection.

### E97 — Unhandled sensor Result

```ghost-error
control BareSensor {
  sensor moisture: Percent;
  output pump: Bool;
  pump <- moisture < 30%;
}
```

Do not directly compare a sensor as if it were its payload. Use `case` or an explicit Result transform from Reference §2.5.

<a id="appendix-c"></a>
## Appendix C. Document maintenance rules

The Language Reference is normative. For conflicts or missing examples found in this guide, check the relevant Reference section before correcting them. Syntax/semantic changes update Reference syntax, rules, reasons, and examples, then synchronize this guide's learning path and code. Link implementation boundaries needed for learning to evidence documents; maintain changing progress, test counts, artifact hashes, and supported-board lists there. Reuse `tests/docs-runnable-examples.test.mjs` for compiler checks. After book changes, run `npm run generate:pc01` to refresh derived provenance; preserve historical replay and benchmark evidence.
