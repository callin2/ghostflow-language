<!-- translation-source: docs/ProgrammingInGhostflow.md -->

[Korean original](ProgrammingInGhostflow.md)

# Programming in GhostFlow

The 2026-10-05 external-input revision uses `input` for quality-bearing declarations. Existing conditioning and explicit `Result` fault branches remain source-authored policies. Prior `sensor` excerpts are retained under `tests/fixtures/history/issue531/`; imported source revisions require a separately verified closure.

Examples that previously used plain observations now expose `observed_*` producer channels and handle their `Result` explicitly. `remembered_*` and `displayed_*` initialize source-local memory; they do not assert that the producer supplied a healthy false or zero. Unknown observations retain established memory and cannot authorize a new guarded transition. A current healthy STOP or removed permission takes precedence, and an existing maximum run duration still expires. Acquisition quality does not assert a physical button or equipment failure. These are explicit illustrative revisions; retained healthy datasets keep their original logical field names through an explicit test adapter.

Write device behavior as code, then understand it by running it

**Revised edition · English translation · based on the Language Reference**

## Before you begin

Imagine wanting a lamp to turn on when you press a switch, water to run at a set time, or a pump to stop when water is low.

Each task is simple on its own. But as conditions grow and devices work together, it becomes harder to see what turns on, when it happens, and why it stops.

GhostFlow is a language for writing these conditions and actions as code. It describes how states change in response to sensors or user input, and what actions to request from devices.

This book does not ask you to memorize the grammar before writing a program. First
predict the result, change one thing, and find the tick where the result changes.
We begin with one switch, but quickly reach questions that occur in real
installations. Which input wins when start and stop arrive together? What can you
trust when a sensor chatters or becomes stale? Does ON on a screen mean that the
device physically turned on?

Getting the answer right matters less than keeping the evidence. For each example,
write down the inputs and previous state, predict the next state and the
requested/safe intent, then compare them with the run. When your prediction differs,
that difference is the concept worth learning.

For exact syntax and behavior rules, see the [Language Reference](LANGUAGE-REFERENCE.md). This guide teaches through examples; the Reference defines the language. If their explanations differ, follow the Reference. When syntax changes, update the Reference first, then align this guide's examples.

For questions that come up while writing code, also see the [GhostFlow Coding FAQ](language_faq.md).

### Before reading the examples

An example in this guide does not mean that its feature is ready to use on a physical board.

Compilation, support in the execution environment, and the behavior of a real device each need separate verification. This guide explains how to write and read code according to the current specification. It does not claim that every feature is implemented or ready for board deployment.

The exact claims of this edition cover whether source follows the current Language
Reference, what the current compiler and logical execution paths check, and which
exercises the public reader can open. They do not claim physical verification on
a particular board, wiring harness, sensor, or actuator. The current checkout's
[Implementation](IMPLEMENTATION.md), [feature maturity and executable evidence](REFERENCE-FEATURE-STATUS.md),
and tests define the implementation evidence.

In the public reader catalog, the controls from E01–E33 except E11, PC-01–PC-10,
and tutorial/03–04 run when their required browser capabilities are admitted. E11
is a canonical-notation explanation, not an executable control. E34–E37 compile,
but the current browser cabinet cannot admit `Int`, `DateTime`, and the new
natural-event host facts, so they are checked in a separate host profile.
`station-rules` is also a separate-host policy grammar. E90–E102 check expected
diagnostics rather than successful execution. These categories tell you where
evidence is available; they are not a ranking of the features.

### How to read the examples

**Run each example separately.** Every `ghost` example is an independent program. Do not join all the book's examples into one file and run them together.

**Explanations are part of the program document.** An actual program is written as a `.ghost.md` document. If its code is split across several top-level `ghost` blocks, read the blocks from top to bottom as one control program. Keep the paragraphs and explanations of why the program should behave a certain way in the source document too.

**Distinguish code output from device behavior.** An output here is a value that requests an action from a device. Producing a value that says to turn on a pump does not turn on a real pump by itself. A binding connects that value to a GPIO or relay, and a Driver handles the hardware. Reading sensor values is also handled there.

For exact notation, see the [Reference syntax index](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기). The [design philosophy](LANGUAGE-REFERENCE.md#설계-철학) explains why the language is designed this way. [Reference Chapter 8](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표) describes responsibilities across the language, execution environment, and device.

### How are the examples checked?

The [example execution check](../tests/programming-book-simulation.test.mjs) compiles original examples, runs them with specified inputs and test times, then checks state changes, requested intent, and safe intent.

Examples need different inputs and execution environments, so their checks vary.

Controls from E01–E33 except E11 are checked in the execution profile selected by
the public reader. E02/E08 receive configuration Results and context facts; E09
receives civil schedule facts. E10/E14 and tutorial/03 receive sensor samples and
the capabilities they need. PC-01–PC-10 and tutorial/03–04 also run in the browser
when those capabilities are admitted. E34–E37 and `station-rules` use the separate
host profiles described above.

General input and state examples check logical results from the shared Rust core.
The browser reader presents the same meaning through a WASM path. Both paths
observe inputs, state, requested/safe intent, and diagnostics; neither establishes
a physical device effect.

tutorial/04 checks schedule events and sequential outputs in the existing `ControlRuntime`/`DailySlots` WASM host. station-rules compiles a policy with `ghostrules`, binds it, then checks output authorization and `Stop` in WASM `GhostFlowStation`. These advanced examples are checked separately from the `ghostsim` CLI path.

E11 explains notation. E90–E102 check whether the compiler reports expected errors
for intentionally invalid code. Diagrams and explanations of program composition
are not executed. Source-mutation experiments are checked separately from the originals.

To run the example check directly, you need Node dependencies and native/WASM artifacts built from the same revision. Then run `node --test tests/programming-book-simulation.test.mjs`. See [Verification](VERIFICATION.md) for the full build and verification sequence.

The compiler check in `tests/docs-runnable-examples.test.mjs` can run without building the runtime.

Chapter 14 contains E16–E22, which cover temperature and climate sensors. Chapter
15 and advanced examples E23–E37 go deeper into physical quantities, observation,
exact counts, and natural time. Evidence for control calculations and import
packages is split across `tests/programming-book-simulation.test.mjs`,
`tests/programming-climate.test.mjs`, and
`tests/programming-book-import-package.test.mjs`.

These steps check program logic and calculations. Whether real sensors and devices behave as intended must be verified separately.

## Contents

### From PLC to GhostFlow — start with practice

The ten-stage practice path starts with buttons and lamps. It then covers START/STOP, motors, interlocks, limits, timers, water levels, Manual/Auto operation, sequential control, and fault recovery.

At each stage, first consider how the device should behave. Then see how to express that behavior in GhostFlow code.

### Browse by topic

1. [One switch and one output](#ch01)
2. [Names, values, types, and expressions](#ch02) · [Quantity-to-type lookup](#quantity-type-lookup)
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
13. [Built-in functions and operations](#ch13)
14. [Temperature units and air-VPD control](#ch14)
15. [Named physical quantities and units](#ch15)

Appendices: [A. Specification guide](#appendix-a) · [B. Learning through errors](#appendix-b) · [C. Document maintenance rules](#appendix-c) · [D. Examples by audience](#appendix-d)


<a id="ch01"></a>
## 1. One switch and one output

When control programming starts with an input wired straight to an output, it is
reasonable to wonder why a language is needed at all. The simplicity is the point.
Before running E01, write the lamp value for three ticks: `false → true → false`.
Once the result matches, ask where each value came from. Separating the contact,
normalized input, logical output, and real relay gives you the same reading method
for every more complicated program in the book.

### E01 — Connecting an input to an output

The first program turns the LED on when the switch is on and off when the switch is off.

```ghost
// E01
// Explicit quality-input revision: acquisition faults request lamp OFF.
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on |> recover(false);
}
```

This revised example reads the external input as `Result<Bool, SensorFault>`.
Healthy false/true retain the existing table; NotReady, Disconnected, Stale and
Invalid explicitly request lamp OFF. This is the confirmed policy of this example,
not a language default or evidence of physical contact OFF. Input faults and
provenance remain recorded. This switch-following example adds no START button
or running memory. The previous E01 source is preserved in the
[prior-code record](historical/2026-10-05-input-531-book-excerpts.md).

`control FollowSwitch` gives this decision a name and a boundary. Values crossing
in are `input`; calculated values crossing out are `output`. No hidden wiring or
device choice sits between them. Read `lamp <- switch_on |> recover(false)` with the arrow: “this
tick's lamp request came from switch_on.” Even two `Bool` values can explain the
origin of an output, which is the first useful result.

| Input `switch_on` | Output `lamp` |
|---|---|
| `false` | `false` |
| `true` | `true` |

The table shows two possible moments. Release→press→release is not a third value;
it is a **transition scenario** that visits the rows over time. Keeping the table
and scenario distinct prevents “what is true now?” from being confused with “how
did we arrive here?”

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
boundary and pass a `false` or `true` Bool payload in a healthy observation to
GhostFlow. Preserve the observation's quality and identity; a broken delivery
path is a fault, not the healthy value false.

Briefly, relays create physical contact paths, PLCs process the inputs with DI and ladder/function blocks,
and GhostFlow connects normalized semantic inputs to declared output calculations.
These examples explain logical calculations. Verification of actual contacts, electrical wiring, PLC input modules,
or device outputs falls within binding and Driver contracts.

### The unit for reading execution: tick

One control evaluation is a **tick**. Every expression in that tick sees one
captured input set. Do not imagine separate expressions reading a switch at
different physical moments; a new input set arrives with the next tick.

E01 has no memory, so the same input observation always produces the same output. If a healthy trace
first shows `switch_on` and `lamp` disagreeing, inspect normalization, binding,
or the Driver before blaming this expression. Chapter 3 adds `state`, after which
the same current input can produce different results because the past differs.

The information connecting `switch_on` to DI1 and `lamp` to RO1 is mapping outside the program.
Names do not automatically determine hardware ports. This lets the same calculation connect
to virtual switches/LEDs and device I/O.

### Try changing it

Before changing the connection to `lamp <- case switch_on { ok(value) => !value; fault(_) => false; };`, draw the new table on
paper. Because `!` flips true and false, both output cells should change. Restore
the original after checking it, then change only the input name. Behavior stays the
same while a reader's interpretation changes: a first exercise in separating a
calculation edit from an explanation edit.

<a id="ch02"></a>
## 2. Names, values, types, and expressions

Many field mistakes begin because two people read `30` as 30 percent and 30
seconds, not because the arithmetic is difficult. Here names and types catch that
misunderstanding early. Before running E02, predict the rows for 29%, 30%, and 31%,
then change only `<` to `<=`. If exactly one boundary changes, you can see how a
type and a small expression narrow the decision.

### Notation separating statements

In the current syntax, declarations and expression definitions end with `;`.
A newline does not have to guess whether a statement ended, so a long expression
can span lines without changing meaning. `{ }` creates scope, while indentation
helps people see the structure. Appendix A identifies the few positions, such as a
function's final expression, where the semicolon is optional.

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

`Int`, `Number`, `Percent`, and `Duration` ask different questions even
when their text looks similar. A `Percent` cannot be compared directly with a
`Number`, because 30% must not quietly pretend to be a measurement whose value
happens to be 30. Use `Int` for exact counts and repetitions and `Number` for
approximate measurements. Exact ranges and conversions follow
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
Chapter 15 gives examples of mixing units and operating across physical quantities.

<a id="quantity-type-lookup"></a>
### Find the type for your measurement

Even when measuring Celsius, the type name is `Temperature`. Do not declare a
type named `Celsius` or `Fahrenheit`. Put the unit on the value: declare
`input air: Temperature;` and write a threshold as `30°C`.
`30°C`, `86°F`, and `303.15K` represent the same absolute temperature.
[Chapter 14](#ch14) continues with unit conversions and temperature control.

| Measurement | Declaration type | Example value | Input declaration |
| --- | --- | --- | --- |
| Absolute temperature | `Temperature` | `30°C` | `input air: Temperature;` |
| Temperature difference | `TemperatureDelta` | `5Δ°C` | `input rise: TemperatureDelta;` |
| Relative humidity | `RelativeHumidity` | `70%RH` | `input humidity: RelativeHumidity;` |
| Percentage, such as tank level | `Percent` | `70%` | `input level: Percent;` |
| Carbon dioxide concentration | `CO2Concentration` | `800ppm` | `input co2: CO2Concentration;` |
| Flow rate | `FlowRate` | `5L/min` | `input flow: FlowRate;` |
| Pressure | `Pressure` | `1.2kPa` | `input pressure: Pressure;` |
| Vapor pressure deficit | `VaporPressureDeficit` | `1.2kPaVPD` | `input vpd: VaporPressureDeficit;` |
| Photosynthetic photon flux density | `PPFD` | `500umol/m2/s` | `input light: PPFD;` |
| Voltage | `Voltage` | `24V` | `input supply: Voltage;` |
| Elapsed time | `Duration` | `5s` | `input delay: Duration;` |

`70%RH` and `70%`, and `1.2kPaVPD` and `1.2kPa`, have different types.
Absolute temperature and temperature difference are also distinct. Inputs read
as quality-bearing `Result` values, so handle healthy/fault branches explicitly
before extracting or comparing the value. This table chooses no fault fallback
or control policy. The complete unit and operation rules follow
[Reference §2.9](reference/02-types-expressions-state.en.md#29-physical-quantities-and-units).

### E02 — Naming inputs, settings, and calculations separately

Turn on the water-supply output when water level is below the setting.

```ghost
// E02
control ThresholdControl {
  state displayed_pump: Bool = false;
  displayed_pump' = if level_good then low else displayed_pump;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_level: Percent = 0%;
  let level_good = case observed_level { ok(_) => true; fault(_) => false; };
  let level = case observed_level { ok(value) => value; fault(_) => remembered_level; };
  remembered_level' = level;
  input observed_level: Percent;
  config threshold: Percent = 30%;
  let low = case threshold {
    ok(value) => level < value;
    fault(_) => false;
  };

  output pump: Bool;
  pump <- displayed_pump';
}
```

`level` is an observation supplied every tick. `threshold` is exposed as
`config` for adjustment, while `low` is this tick's calculation rather than
stored state. Because the three have distinct names, a trace can ask whether the
water fell, the setting changed, or the comparison changed. Changing the default
in source creates a new document revision.
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

Moving `low` below the output connection produces the same calculation. The
compiler follows dependencies instead of overwriting values from top to bottom, so
a layout edit can remain distinct from a decision edit. A cyclic pair of `let`
definitions is rejected because neither result provides a starting point.

**Small experiment:** If `<` becomes `<=`, which single table row changes?

<a id="ch03"></a>
## 3. What it means to remember state

Current input is not enough when a pump must keep running after START is released.
In PC-02, a held START must not restart immediately after STOP clears. These
exercises ask both what to remember and what an event must make you forget. Hide
the next-state column in each table and predict it first. The PC path extends that
small memory into motors, reversal, levels, mode transfer, sequences, and fault
recovery.

### E03 — Stop-priority self-holding

Keep running after briefly pressing and releasing Start; stop when Stop is pressed.

```ghost
// E03
// Explicit quality-input revision: protective faults stop; recovery needs healthy START release/repress.
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  state restart_blocked: Bool = false;
  output valve, pump: Bool;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);
  let acquisition_fault = !start_good || !stop_good;
  restart_blocked' = if acquisition_fault then true
    else if !start_requested then false else restart_blocked;
  running' = !stop_requested && (running || (start_requested && !restart_blocked));
  valve <- running';
  pump <- running';

  require pump => valve;
}
```

This explicit new revision preserves healthy self-holding and stop priority.
A START acquisition fault prevents a new start. An active run continues only
while STOP is healthy and released. A STOP acquisition fault clears running
memory and requests pump/valve OFF. Observing a fault on either input blocks
restart. After a fault stop, holding START cannot restart the run: observe START
released while both inputs are healthy, then press again. An initially healthy
pressed START still starts immediately, preserving the original healthy behavior.
This policy applies to the existing START circuit; it does not add START buttons
to lamps or automatic controllers. Driver application needs separate evidence.
The previous E03 source is preserved in the
[prior-code record](historical/2026-10-05-input-531-book-excerpts.md).

`running` is the remembered value at the start of a tick; `running'` is the next
value calculated from the current inputs. Read the apostrophe as **prime**. The two
names keep “running before STOP was observed” separate from “state to commit after
STOP has been handled.”

Read the expression aloud: “Keep running if stop is not pressed and either start
is pressed or the system was already running.” If that sentence is not the field
requirement, fix the requirement before rearranging parentheses. When both buttons
are pressed, `!stop_requested` is false, so stop wins. That simultaneous-input row turns
the phrase “stop priority” into observable behavior.

| tick | start | stop | Previous `running` | Next `running'` | pump |
|---|---|---|---|---|---|
| 1 | false | false | false | false | false |
| 2 | true | false | false | true | true |
| 3 | false | false | true | true | true |
| 4 | true | true | true | false | false |
| 5 | false | false | false | false | false |

The output reads `running'`, so it turns on in the tick that observes START.
Change only one line to `pump <- running;` and the old state delays it by a tick.
Run both versions with the same inputs and find their first difference: behavior
changed because of **which point in time the value belongs to**, not statement position.

### PC-02 — START / STOP waiting for a fresh start

PC-02 through PC-10 are an optional field-problem route, not a mandatory grammar
sequence. PC-02–03 cover restart and motor permission, PC-04–05 direction and
position, PC-06–08 time, levels, and mode, and PC-09–10 the whole sequence and
recovery. Each preserves the earlier example and adds one burden.

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
Retain [tutorial/03](../examples/tutorial/03-moisture.ghost.md)'s continuous-sensor median/quality/hysteresis example separately.

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

The user explained this choice in [#149](https://github.com/callin2/ghostflow-language/issues/149):
the React/ObservableHQ influence is control evaluated within an event stream with
an explicit next-state result. The educational premise was that recursive or
loop-shaped control may be hard for electricians to trace. E04 makes the boundary
concrete: read the previous `a` and `b`, describe `a'` and `b'`, then commit both.
This is a readability goal, not a general judgment about electricians. Use the
ASCII apostrophe (`'`) shown in E04. The issue's conversational backtick and later
assistant proposals do not add syntax, time-travel or causal-explanation features.
The execution rules are in [Reference §2.8](reference/02-types-expressions-state.en.md#28-tick-and-state-snapshot).

A successful tick calculates candidate next from this tick's input snapshot and previous state, then requested and safe intents,
and atomically commits state and intent records. A runtime fault in a selected expression rejects the tick without partial updates.
Output-constraint blocking differs from this evaluation failure and does not cancel the successful tick's state commit.

<a id="ch04"></a>
## 4. Output intent and final outputs

When a screen says the pump is ON but no water moves, one Boolean cannot explain
the situation. The code may have requested ON, a constraint may have blocked it,
the Driver may not have applied it, or feedback may not have confirmed it. In E05,
set `request=true` and `valve_ready=false`, then predict where requested and safe
intent diverge. This turns “why did it not turn on?” into a question about evidence.

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
  state displayed_pump: Bool = false;
  displayed_pump' = if request_good && !request then false else if request_good then request else displayed_pump;
  state displayed_valve: Bool = false;
  displayed_valve' = if valve_ready_good && !valve_ready then false else if valve_ready_good then valve_ready else displayed_valve;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_request: Bool = false;
  let request_good = case observed_request { ok(_) => true; fault(_) => false; };
  let request = case observed_request { ok(value) => value; fault(_) => remembered_request; };
  remembered_request' = request;
  state remembered_valve_ready: Bool = false;
  let valve_ready_good = case observed_valve_ready { ok(_) => true; fault(_) => false; };
  let valve_ready = case observed_valve_ready { ok(value) => value; fault(_) => remembered_valve_ready; };
  remembered_valve_ready' = valve_ready;
  input observed_request: Bool;
  input observed_valve_ready: Bool;
  output pump, valve: Bool;

  pump <- displayed_pump';
  valve <- displayed_valve';
  require pump => valve;
}
```

| request | valve_ready | Candidate pump / valve | Final pump / valve |
|---|---|---|---|
| false | false | false / false | false / false |
| true | true | true / true | true / true |
| true | false | true / false | false / false |

The last row is the reason for the example. The pump request from `<-` is true,
but `require` makes safe intent false. `pump => valve` says the valve must
already be requested when the pump is requested. The runtime does not secretly
turn the valve on to satisfy the rule. The trace shows which request was abandoned.

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
  state displayed_forward: Bool = false;
  displayed_forward' = if forward_button_good && !forward_button then false else if forward_button_good then forward_button else displayed_forward;
  state displayed_reverse: Bool = false;
  displayed_reverse' = if reverse_button_good && !reverse_button then false else if reverse_button_good then reverse_button else displayed_reverse;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_forward_button: Bool = false;
  let forward_button_good = case observed_forward_button { ok(_) => true; fault(_) => false; };
  let forward_button = case observed_forward_button { ok(value) => value; fault(_) => remembered_forward_button; };
  remembered_forward_button' = forward_button;
  state remembered_reverse_button: Bool = false;
  let reverse_button_good = case observed_reverse_button { ok(_) => true; fault(_) => false; };
  let reverse_button = case observed_reverse_button { ok(value) => value; fault(_) => remembered_reverse_button; };
  remembered_reverse_button' = reverse_button;
  input observed_forward_button: Bool;
  input observed_reverse_button: Bool;
  output forward, reverse: Bool;

  forward <- displayed_forward';
  reverse <- displayed_reverse';
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

### Named local groups and the shared resource envelope

E05/E06 constrain outputs of their own control. Putting the same rule in a named
local group such as `constraints LocalRules { require pump => valve; }` preserves
its scope and Bool constraint meaning. Constraints form the permitted region for
goals; all mandatory conditions combine as AND. Priority or optional nonblocking
analysis does not release mandatory conditions.

Continue with the [complete bound execution example](../examples/bound-resource-execution.ghost.md).
Checking `constraints SharedRules for station` alone does not execute protected
outputs. The checked descriptor from `compileSourceSync` needs explicit
`compileBoundResourceControl` binding to exact source/artifact identities, stable
IDs and mode/output mappings. Its artifact checks every supported automatic,
manual and fallback path through the same guard during actual Rust/WASM scans.
This is not a JavaScript filter added after output publication.

The example's authored safe vector turns the pump OFF and leaves the valve ON
when a relation is violated during execution. A prestart violation denies new
admission; a conflicting newcomer neither takes incumbent admission nor enters
a hidden queue. Normal conditions alone do not clear a trip. Exclusive groups
need a neutral observation followed by a fresh claim; require-only groups need
requested=authored safe followed by a fresh request. Connected groups recover
together in one scan. Successfully evaluated denial commits ordinary state;
binding/VM errors roll back state, guard and trace.

This is logical execution of one Bool GFB1 v1/v3 control with every output
explicitly mapped. The installation authority shares the writers' registry,
refusing a second active writer for the same stable ID. Separate installation
registries do not certify physical exclusion. Arbitrary PID, context,
shared-policy import composition, cooperative multi-VM arbitration and physical
safe sequencing have separate boundaries. Do not replace E05/E06's existing
results or replay records with those of this new example. [Reference §4.8](reference/04-sensors-constraints-control.en.md#48-common-constraints-notation-and-operations)
and [the constraint contract](CONSTRAINTS.en.md#shared-bool-execution) distinguish
source, binding, admission and safe-output evidence.

<a id="ch05"></a>
## 5. Separating calculations with functions

Copy a latch expression into several places and eventually one copy will acquire a
different stop priority. A function is less about saving lines than naming one
decision so it can be reviewed once. In E07, calculate `hold` and `permitted`
separately before composing them. Predict whether toggling `enabled` restarts the
control without START; the answer makes the absence of hidden function state clear.

### E07 — Extracting the self-holding calculation into a function

```ghost
// E07
fn hold(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}

control FunctionLatch {
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_start: Bool = false;
  let start_good = case observed_start { ok(_) => true; fault(_) => false; };
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_stop: Bool = false;
  let stop_good = case observed_stop { ok(_) => true; fault(_) => false; };
  let stop = case observed_stop { ok(value) => value; fault(_) => remembered_stop; };
  remembered_stop' = stop;
  state remembered_enabled: Bool = false;
  let enabled_good = case observed_enabled { ok(_) => true; fault(_) => false; };
  let enabled = case observed_enabled { ok(value) => value; fault(_) => remembered_enabled; };
  remembered_enabled' = enabled;
  input observed_start: Bool;
  input observed_stop: Bool;
  input observed_enabled: Bool;
  state running: Bool = false;
  output pump: Bool;

  fn permitted(request: Bool, allow: Bool) -> Bool {
    request && allow
  }

  running' = if stop_good && stop then false else if enabled_good && !enabled then false else if start_good && stop_good && enabled_good then (permitted(hold(start, stop, running), enabled)) else running;
  pump <- running';
}
```

Parameters after `fn` gather the evidence the decision needs; `-> Bool` states
the result promise. The final expression is the result, so there is no separate
`return`. Reading `hold(start, stop, running)` exposes all dependencies at the call site.

When `enabled=false`, `permitted` returns false and next state turns off.
Turning it true again does not restart operation because remembered state is
already false. The function calculates from arguments and hides no separate memory.

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

“Turn on after two seconds” cannot mean pausing execution for two seconds. The
controller must still read STOP and evaluate other controls. E08 makes waiting
visible as a `Waiting` state plus elapsed time. Predict the next state at 1999ms,
2000ms, and 2001ms, then release START halfway through. Time flows continuously,
but observation and transition happen at ticks.

### E08 — Turning on after an input persists for two seconds

```ghost
// E08
control DelayedStart {
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_start: Bool = false;
  let start_good = case observed_start { ok(_) => true; fault(_) => false; };
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  input observed_start: Bool;
  config delay: Duration = 2s;
  type Phase = Idle | Waiting | Running;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  output motor: Bool;

  phase' = if start_good then (case delay {
    ok(value) => case phase {
      Idle => if start then Waiting else Idle;
      Waiting =>
        if !start then Idle
        else if age >= value then Running else Waiting;
      Running => if start then Running else Idle;
    };
    fault(_) => Idle;
  }) else phase;

  motor <- phase' == Running;
}
```

`type Phase = ...` names the three situations that waiting must distinguish. A
single Bool would hide “not started” and “waiting” inside the same off value.
`case phase` selects one expression for the current stage. Every case must be
covered, so adding a stage later reveals any missing decision.

`delay` is `Result<Duration, SettingsFault>`. Compare time with its payload only in `ok(value)`.
On a config fault, this example cancels the pending wait and transitions to `Idle`, keeping output intent off.
A later valid config and `start=true` begin a new wait. `2s` is the initial `ok` payload, not an error fallback.
This is this example's policy, not a language/Driver default or a physical fail-safe guarantee.

`elapsed(phase)` is **elapsed time since phase's last committed change**. Zero is
the commit point of the tick changing `Idle` to `Waiting`. Idle time before
START is not part of the wait, and releasing then pressing START does not splice
the old wait onto the new one.
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
An explicitly configured greenhouse-temperature plant model is supported; its virtual application and feedback are not physical device evidence.
Piped mode advances only at explicit scans; interactive TTY supplies elapsed wall time.
Schedules, sensors, and certified intervals require the corresponding host capabilities. Follow
[Authoring and virtual simulation architecture](LLM-TOOLCHAIN-ARCHITECTURE.md#reproduce-the-public-path) for execution paths and reproduction commands.

**Small experiment:** Move the tick after 2999ms to 3500ms. The motor turns on at that tick.
The timer condition is two seconds, but observation and transition occur at tick times.

<a id="ch07"></a>
## 7. Starting at scheduled times

Watering at 06:00 and watering for five minutes both concern time, but they use
different clocks. The first needs civil time and a time zone; the second needs
monotonic elapsed time after an event. In E09, imagine the 06:00 event arrives and
the wall clock then moves backward. The five-minute run should remain stable. That
prediction explains why DST, clock gaps, provider failure, and fallback are explicit.

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

`DailySlots<15min>` selects from a 15-minute grid in each local date, rejecting an
off-grid value such as 06:07 instead of rounding it. `starts.due` projects whether
an occurrence arrived on this tick; admission and missed/unknown evidence stay
separate. Pulse basis, trusted clock, 60-second gap, recovery, and fallback are
explicit so a later review cannot invent a perfect-clock assumption.

| Event | Previous stage | Next stage | pump |
|---|---|---|---|
| Selected start event | Idle | Watering | true |
| Less than five minutes elapsed | Watering | Watering | true |
| First tick with at least five minutes elapsed | Watering | Idle | false |

`in {Watering}` checks set membership. With multiple states,
list values of the same type, such as `phase' in {Opening, Watering, Closing}`.

This source has no queue. Another start event arriving during Watering is not stored.
Schedule occurrence identity, duplicate suppression, missed handling, and replay evidence follow Reference §3.5. Do not arbitrarily catch up overlaps or omissions from other schedules.

**Reading question:** Does the Watering branch read another start event to change its end time?
The two selected times here are more than five minutes apart. This is branch reading,
not an execution scenario injecting a hidden `starts.due` input into the public simulator.

### Calendar time and natural events

Calendar time, schedules, and monotonic elapsed time are different input meanings. Dates and times are tagged literals; recurring schedules use type-specific `schedule` declarations. Exact notation for `DailySlots`, `Periodic`, `cron5`, solar/lunar/tide context, time zones, gap recovery, and mandatory fallback follows [Reference §3](reference/03-time-and-schedules.md).

Sunrise/sunset, tide predictions, calendar, and clock data depend on external provider/Driver contracts. Source specifies reference events and fallback. Do not hide prediction data in a single Bool or assume time is always trusted. Read Reference policies and supply required environmental capabilities through bindings.

<a id="ch08"></a>
## 8. Sensor values and quality

Choose the input type using the [quantity-to-type lookup](#quantity-type-lookup).
For example, a Celsius measurement uses `Temperature` and a value such as `30°C`.

Suppose moisture alternates between `29%, 31%, 29%`. A single threshold makes the
water request alternate too. Then one `90%` appears: did the soil suddenly become
wet, or did one reading spike? If the sensor disconnects after its last reading,
how long should that number still be trusted?

These are different questions. E10 checks measurement quality, chooses a recent
median, separates the ON and OFF thresholds, then checks whether the user permits
watering. Follow raw value, filtered value, decision and requested output in turn.
The program has several parts because the questions deserve separate answers.

The moisture percentages and 30%/35% thresholds are illustrative logical values,
not universal agricultural recommendations for soils, crops or sensor calibration.
This chapter verifies a water request; actual flow needs separate device and feedback evidence.

### Input values and measured values

The earlier `input level: Percent` declared a value supplied by the host for the current calculation.
Actual sensors have states such as not ready, disconnected, and stale measurements, as well as values.
When reading `input`, also handle whether a healthy value was obtained.

### E10 — Deciding water supply from fluctuating moisture values

```ghost
// E10
control MoistureControl {
  state displayed_pump: Bool = false;
  displayed_pump' = if enabled_good && !enabled then false else if enabled_good then enabled && need_water else displayed_pump;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_enabled: Bool = false;
  let enabled_good = case observed_enabled { ok(_) => true; fault(_) => false; };
  let enabled = case observed_enabled { ok(value) => value; fault(_) => remembered_enabled; };
  remembered_enabled' = enabled;
  input observed_enabled: Bool;
  input moisture: Percent {
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
  pump <- displayed_pump';
}
```

`sample = 1s` describes the desired measurement interval. It creates neither a
sensor-reading thread nor a fresh observation each second. The host supplies
samples with their original timestamps and identities. `valid` defines the valid
range. The filter accepts fresh valid samples within that range. Reading one
sample in several ticks neither fills the window nor refreshes its timestamp.

`median(3)` picks the middle of the last three valid values. Sorting
`29%, 90%, 28%` gives `28%, 29%, 90%`, so the result is `29%`. One large value
does not immediately mean wet soil. With only two samples, the middle is not ready:
the initial two samples yield `NotReady`, and this example's fault branch keeps
the water request off.

`hysteresis` separates on and off thresholds. For healthy measurements, a filtered value below
30% turns the dry state on, and above 35% turns it off. Between the thresholds,
retain the previous decision. Exactly 30% or 35% also retains it.
Thus, fluctuation near 30% does not invert the output each time.

Between `30%` and `35%`, a number does not establish a new conclusion: it keeps
the previous one. The same `33%` can therefore keep watering after a dry reading,
but does not start watering from the initial state. This small difference adds
memory to a threshold comparison.

Now set `enabled=true` and supply these raw samples in order, one fresh healthy
observation each second. Cover the table and first predict which row turns the request off.

| New raw sample | Median of the latest three | `dry` result | Requested `pump` |
|---|---|---|---|
| `31%` | Window incomplete | `fault(NotReady)` | `false` |
| `29%` | Window incomplete | `fault(NotReady)` | `false` |
| `90%` | `31%` | `ok(false)` | `false` |
| `28%` | `29%` | `ok(true)` | `true` |
| `30%` | `30%` | `ok(true)` | `true` |
| `34%` | `30%` | `ok(true)` | `true` |
| `36%` | `34%` | `ok(true)` | `true` |
| `38%` | `36%` | `ok(false)` | `false` |

The request is still on when the raw value reaches `36%`: the filtered value is
`34%`. After `38%` arrives, the window `34%, 36%, 38%` has median `36%`, above
35%, and turns the decision off. Comparing only raw value and output can look
surprising; following the intermediate values explains it.

Next stop supplying new samples. When age from the last sample's original timestamp
reaches exactly 3 seconds, the result is `Stale`. Compare 2999ms and 3000ms.
Reevaluation or retransmitting the same sample does not extend that deadline.

A fault is not a normal moisture value. It clears the filter window and resets
hysteresis to `initial: false`. When healthy samples resume, `recover_after = 1 samples`
does not by itself allow immediate recovery: this filter also needs **three fresh
valid samples**. If the recovered median is `33%`, the old `true` decision does
not return; the initial `false` decision remains.

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
  input moisture?: Percent;
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

E14 distinguishes an absent sensor from a fault in an installed sensor. With no
input installed it selects `Baseline`; with an installed sensor whose value is
unavailable it follows the fault branch inside `WithMoisture`. Both requests are
false, but their evidence differs. Equal output does not mean equal reasoning.

**Change one thing:** While E10 produces `ok(true)`, turn only `enabled` off.
The decision remains; the pump request stops. Enabling it again restores the
request only while quality remains healthy. Separating decision and permission
avoids inventing a new sensor state for a user operation.

Also predict what happens when both thresholds are made equal. Current
`hysteresis` requires `on_below < off_above`, so this edit should produce a
diagnostic rather than a healthy execution. Show raw and filtered values together,
and inspect quality and request separately. E10 has no `require` or `mutex`, so
safe equals requested here; that equality does not confirm physical pumping.

<a id="ch09"></a>
## 9. Reading expressions precisely

The shorter an expression looks, the more readily we import rules from another
language. This chapter uses small counterexamples instead of a grammar recital.
Choose one normal value and one fault for division, conditionals, and `case`, then
predict the result. E11's canonical notation makes the same shape carry the same
meaning in reviews and searches.

### E12 — Numbers and operators

```ghost
// E12
control NumbersAndOperators {
  state displayed_sum: Number = 0;
  displayed_sum' = if a_good && b_good then a + b else displayed_sum;
  state displayed_difference: Number = 0;
  displayed_difference' = if a_good && b_good then a - b else displayed_difference;
  state displayed_product: Number = 0;
  displayed_product' = if a_good && b_good then a * b else displayed_product;
  state displayed_quotient: Number = 0;
  displayed_quotient' = if a_good && b_good then a / b else displayed_quotient;
  state displayed_negative: Number = 0;
  displayed_negative' = if a_good then -a else displayed_negative;
  state displayed_equal: Bool = false;
  displayed_equal' = if a_good && b_good then a == b else displayed_equal;
  state displayed_different: Bool = false;
  displayed_different' = if a_good && b_good then a != b else displayed_different;
  state displayed_less: Bool = false;
  displayed_less' = if a_good && b_good then a < b else displayed_less;
  state displayed_at_most: Bool = false;
  displayed_at_most' = if a_good && b_good then a <= b else displayed_at_most;
  state displayed_greater: Bool = false;
  displayed_greater' = if a_good && b_good then a > b else displayed_greater;
  state displayed_at_least: Bool = false;
  displayed_at_least' = if a_good && b_good then a >= b else displayed_at_least;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_a: Number = 0;
  let a_good = case observed_a { ok(_) => true; fault(_) => false; };
  let a = case observed_a { ok(value) => value; fault(_) => remembered_a; };
  remembered_a' = a;
  state remembered_b: Number = 0;
  let b_good = case observed_b { ok(_) => true; fault(_) => false; };
  let b = case observed_b { ok(value) => value; fault(_) => remembered_b; };
  remembered_b' = b;
  input observed_a: Number;
  input observed_b: Number;
  output sum, difference, product, quotient, negative: Number;
  output equal, different, less, at_most, greater, at_least: Bool;

  sum <- displayed_sum';
  difference <- displayed_difference';
  product <- displayed_product';
  quotient <- displayed_quotient';
  negative <- displayed_negative';
  equal <- displayed_equal';
  different <- displayed_different';
  less <- displayed_less';
  at_most <- displayed_at_most';
  greater <- displayed_greater';
  at_least <- displayed_at_least';
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
  state displayed_result: Number = 0;
  displayed_result' = if a_good && b_good then if zero then 0 else a / denominator else displayed_result;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_a: Number = 0;
  let a_good = case observed_a { ok(_) => true; fault(_) => false; };
  let a = case observed_a { ok(value) => value; fault(_) => remembered_a; };
  remembered_a' = a;
  state remembered_b: Number = 0;
  let b_good = case observed_b { ok(_) => true; fault(_) => false; };
  let b = case observed_b { ok(value) => value; fault(_) => remembered_b; };
  remembered_b' = b;
  input observed_a: Number;
  input observed_b: Number;
  let zero = b == 0;
  let denominator = if zero then 1 else b;
  output result: Number;

  result <- displayed_result';
}
```

With `a=6, b=2`, the result is `3`; with `a=6, b=0`, it is `0`. The useful
discovery is that division is never evaluated on the zero branch. Still, `0` is
this program's policy, not the language's universal answer. A domain that must
distinguish zero from fault should preserve the error instead.

### E11 — Using only canonical notation

New programs use `fn`, `type Mode = Off | On;`, `running' = ...;`, and `if c then a else b`. `purefn`, `enum` syntax, `next running`, `input.start`, `state.running`, and `ifthenelse(...)` are not permitted aliases. If you see these in older documents, follow the migration explanation in [Reference §1.6](reference/01-source-and-syntax.md#16-대표-표기-참고-별칭과-역사적-대안).

<a id="ch10"></a>
## 10. Stopping, changing, and comparing

The anxious question after changing control code is whether only the intended
behavior changed. Answer it by feeding two revisions the same inputs and logical
times. The first differing tick shows how one expression propagates into state,
intent, and constraints. This comparison habit becomes the basis for understanding
import replacement and replay.

The two expressions below look similar enough to pass as a parenthesis cleanup.
Place both against the same recording, using E03's stop-priority latch as the baseline.

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

When reviewing a trace or designing an observation view, compare the selected
tick's `start`, previous `running`, and next `running'` with source. Follow the
conditions that contribute to `pump`, and compare candidate and final values when
a constraint changes an output. This is observation and UI design guidance, not
a claim that the current reader provides source-selection or dependency-tracing UI.

The observation screen needs to answer four questions.

- From which inputs and previous state was this value calculated?
- What are the next state and output intent?
- Which constraint permitted or blocked it?
- At which tick do the original and modified versions first differ?

Observable values and evidence kinds follow [Reference §5](reference/05-settings-and-observation.md). Screen presentation must preserve the meaning of the corresponding descriptor.

<a id="ch11"></a>
## 11. Files and literate programs

Months after a fault, the reason for a condition matters as much as the condition
itself. E15 keeps that reasoning beside executable source instead of squeezing it
into leftover comments. Changing prose changes the document revision, while only
the `ghost` blocks carry execution meaning. Save and check the `.ghost.md`
document itself rather than copying its blocks into a second source.

### One file and one control

An executable document has one root `control`, so no filename or deployment
convention must guess which control starts. Reuse pins the revision and digest of
a complete `.ghost.md` definition with document-scope `import`, then composes
it with `instance` and `connect`. Rejecting wildcard imports and a second root
keeps reviewed identity aligned with executable structure.

The single-root rule provides the skeleton of an executable definition. It prevents an ambiguous root when composing several imported definitions as instances.

### E15 — Writing explanation and code in the same document

Consider saving the following entire content as `follow-switch.ghost.md`.
The quoted canonical document retains its Korean prose and exact source identity.
Its heading means “Output following input”; the first paragraph says “Declare the
switch and LED values,” and the paragraph between code blocks says “The output
follows the switch value on every tick.” This English reading projection translates
the explanation without creating a second independently editable canonical source.

````markdown
# 입력을 따라가는 출력

스위치와 LED의 값을 선언한다.

```ghost
// E15
control LiterateSwitch {
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_switch_on: Bool = false;
  let switch_on_good = case observed_switch_on { ok(_) => true; fault(_) => false; };
  let switch_on = case observed_switch_on { ok(value) => value; fault(_) => remembered_switch_on; };
  remembered_switch_on' = switch_on;
  input observed_switch_on: Bool;
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

Files do not become related merely by sharing a directory. `import` names immutable
source identity; `instance` and `connect` expose typed logical ports. When the
original changes, review a new revision instead of silently picking it up. That is
the minimum needed to reproduce the claim that today's composition uses yesterday's
reviewed component.

Distinguish compiler contract checking of pinned imports, instances, and ports from runtime execution.
The fixed source closures of E22 and E31 are also verified through browser Worker/WASM
execution. That evidence does not cover arbitrary compositions or installation profiles.
For a single-control exercise, save the entire document as in E15,
then check and compile it from the language repository root:

```sh
node tools/ghostc.mjs --check follow-switch.ghost.md
node tools/ghostc.mjs follow-switch.ghost.md build/follow-switch.gfb
```

Node dependencies are required. GFB, manifest, and source map are derived artifacts; `.ghost.md` remains the editable original.
Do not compile this whole book as one executable document.

<a id="ch12"></a>
## 12. One device, multiple controls

Watering and ventilation may each work alone yet conflict over one pump or power
budget. This chapter pins imported revisions and exposes relationships through
instances and typed ports instead of copying files together. Before replacement,
write down which ports and resource contracts must remain stable. Composition pays
off when it lets you prove what changed and what stayed the same.

Each definition has one root. A composition creates instances of imported controls
and connects logical ports, leaving a type and origin to inspect at every arrow.
If two instances want one physical resource, connections alone cannot resolve it:
resource identity and contracts must be explicit, while output intent remains
distinct from physical confirmation.

```text
definition revision → import → instance + typed connect
                   → semantic composition → bound runtime
```

Use `adapt`, capability checks, common constraints, shared resources, replay, and hot replacement only at their prescribed locations and with their defined types and contracts. Syntax and semantic DAG rules follow [Reference §6](reference/06-composition-and-replay.md); device/Driver/binding responsibilities follow [Reference §8](reference/08-language-runtime-and-device-boundaries.md). Do not assume an arbitrary separate policy language inside ordinary `control`.

<a id="ch13"></a>
## 13. Built-in functions and operations

This is the chapter where a familiar function name is most dangerous. First mark
whether the return type is a `Result`, whether the operation remembers samples,
and whether it needs an external clock or natural-event provider. A call may be a
value calculation, stateful signal, schedule descriptor, or host policy; each has
different observable evidence. Treat the catalog below as a map for repeating
those questions, not as a list of names to memorize.

A builtin is an operation the compiler already knows. A `fn` is a calculation you declare, such as E07's function. A familiar name does not make a function builtin: there are no general `abs`, `min`, `max`, `clamp`, `sqrt`, `pow` or `round` expression functions. Declare a suitable `fn` when the language permits its calculation.

Read the call names and signatures in this chapter against the current Language
Reference and compiler registry. It covers all **48 primary callable spellings**
and **3 additional host-policy spellings**. The tables distinguish ordinary calls,
declaration constructors and restricted transforms. Signatures below are fragments;
the linked tests contain complete examples. They are not extra independent source documents.

First ask where the operation is permitted. Then inspect its input and result types. Finally ask whether it remembers samples or state, requires a clock/provider, or returns a fault. A successful compile can produce a checked descriptor rather than executable control. Even executable control needs the stated runtime inputs and bindings. None of these operations proves physical output effect.

### 13.1 Numbers and explicit Result construction

Use conversions when the intended numeric representation changes. `Int` is exact signed 32-bit; `Number` is floating point. These functions take exactly one positional argument. For example, `int_floor(-1.2)` is -2, while `int_trunc(-1.2)` is -1. A halfway value such as 2.5 rounds to 2 with nearest-even; 3.5 rounds to 4.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `number` | `number(x: Int) -> Number`: change representation explicitly | Ordinary expression, no state. [Integer examples](../tests/int-compiler.test.mjs). |
| `int_exact` | `int_exact(x: Number) -> Int`: require an integral value | Reject fractional or out-of-range values. [Conversions](../tests/dynamic-int-conversions.test.mjs). |
| `int_floor` | `int_floor(x: Number) -> Int`: round toward negative infinity | Converted value must fit Int. [Conversions](../tests/dynamic-int-conversions.test.mjs). |
| `int_ceil` | `int_ceil(x: Number) -> Int`: round toward positive infinity | Converted value must fit Int. [Conversions](../tests/dynamic-int-conversions.test.mjs). |
| `int_trunc` | `int_trunc(x: Number) -> Int`: discard fraction toward zero | Converted value must fit Int. [Conversions](../tests/dynamic-int-conversions.test.mjs). |
| `int_nearest_even` | `int_nearest_even(x: Number) -> Int`: nearest integer, ties to even | Converted value must fit Int. [Conversions](../tests/dynamic-int-conversions.test.mjs). |
| `ok` | `ok(value: T) -> Result<T,E>`: construct success | An expected Result type determines T and compiler-owned E. [Result examples](../tests/result-control.test.mjs). |
| `fault` | `fault(reason: E) -> Result<T,E>`: construct failure | Expected Result type required; keep the typed reason and source origin. [Result examples](../tests/result-control.test.mjs). |
| `rate` | `rate(delta: Q-difference, time: Duration) -> Rate<Q>`: build a comparison rate | Expected Rate context; positive time; Temperature uses TemperatureDelta. Canonical difference is divided by seconds. [Rate examples](../tests/window-control.test.mjs). |

Invalid constant conversions fail compilation. Dynamic numeric errors prevent successful evaluation; they are not sensor Results that `recover` can catch. `Rate<Q>` is expression-only: use a `window_rate` signal and a `rate` threshold for comparison. It is not a general config/state/input/output storage type.
Source: [expression calls](../tools/control.mjs), [integer contract](EXACT-INTEGER-CONTRACT.md).

### 13.2 Keep quality until you choose a response

A sensor's failed reading is not a normal zero. A Result pipeline carries either a value or its error. E10 demonstrates explicit failure handling. Use `result |> map(transform)`, `result |> and_then(transform)` or `result |> recover(default)`; `>>` combines static transforms. These are compiler-known transforms, not arbitrary first-class functions.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `map` | `map(T -> U)`: Result<T,E> -> Result<U,E> | Unary named fn or `below(limit)`; U must not be Result. Preserve failure. [Pipelines](../tests/result-control.test.mjs). |
| `and_then` | `and_then(T -> Result<U,E>)`: Result<T,E> -> Result<U,E> | Unary named fn; same E required. Existing failure bypasses the transform. [Pipelines](../tests/result-control.test.mjs). |
| `recover` | `recover(default: T)`: Result<T,E> -> T | Explicit same-type fallback; records the fault and origin in trace. `recover(false)` is an author decision. [Provenance](../tests/result-provenance.test.mjs). |
| `below` | `below(limit: T)`: transform T -> Bool using strict `<` | Only as a map transform. Ordered numeric, Rate, DateTime or TimeOfDay; same-type limit. and_then(below(...)) is rejected because Bool is not Result. [Pipelines](../tests/result-control.test.mjs). |

Source: [static transform lowering](../tools/control.mjs). Recovering a value does not make the original measurement trustworthy.
For E10's Percent sensor, the fragment `moisture |> map(below(30%)) |> recover(false)` requests false on fault. This threshold calculation has no hysteresis memory.

### 13.3 Filter samples, then use hysteresis to retain a decision

A filter smooths measured values. Hysteresis remembers a Bool decision across a band. They solve different problems and can be used together. Declare a numeric sensor and select one filter with `filter = ...`. Filters consume new valid physical samples; repeated scans do not add sample weight.
For example, E10's `filter = median(3);` selects three actual samples, while `filter = ema(alpha: 0.25);` gives each new sample one quarter of the update weight.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `median` | `median(n)`: middle of the last n valid samples | Sensor filter only; constant odd integer 1..31. Partial window is NotReady. [Filters](../tests/signals-wasm.test.mjs). |
| `moving_average` | `moving_average(n)`: arithmetic mean of last n valid samples | Sensor filter only; constant integer 1..31. Partial window is NotReady. [Filters](../tests/signals-wasm.test.mjs). |
| `ema` | `ema(alpha: Number)`: weighted new sample and previous value | Sensor filter only; constant finite 0 < alpha <= 1. Seed first valid sample; recovery rules still apply. [Filters](../tests/signals-wasm.test.mjs). |
| `hysteresis` | `hysteresis(sensor, on_below: T, off_above: T, initial: Bool) -> Result<Bool,SensorFault>` | Signal declaration; direct numeric sensor; constant thresholds with same T and on_below < off_above. [Hysteresis boundaries and faults](../tests/signals-wasm.test.mjs). |

Consider E10's moisture control: `signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);`.
Below 30% sets dry true. Above 35% sets it false. Every value in the **closed band [30%,35%]**, including both equalities, preserves the prior Bool while quality is good. This prevents small fluctuations from switching the decision repeatedly.

The following sequence refers to good filtered readings, after readiness, rather than raw samples before the filter.

| Good filtered moisture | Retained dry value | Reason |
|---|---|---|
| 30% after startup | false | Equality retains initial false. |
| 35% | false | Upper equality also retains false. |
| 29% | true | Strictly below lower threshold. |
| 30% | true | Lower equality retains true. |
| 33% | true | Inside the band. |
| 35% | true | Upper equality retains true. |
| 36% | false | Strictly above upper threshold. |

`initial` is the starting retained value, not permission to ignore a missing sample. Before readiness, or after Disconnected/Stale/Invalid, the public result is a fault. Processing resets to initial; good samples must satisfy recovery/filter requirements again. A recovered in-band sample therefore starts from initial, rather than continuing the pre-fault decision. If initial is true, it still does not turn a failed Result into `ok(true)`. E10 chooses its output response using `case`.

The [Rust conditioner](../crates/ghostflow-core/src/signals.rs) uses strict comparisons and resets hysteresis processing on faults. The linked WASM test contains “retains either prior state exactly at both thresholds” and fault/recovery examples. This chapter describes those contracts; editing documentation does not create a new hardware test.

### 13.4 Time, samples and events are different evidence

Declare these operations with `signal name = constructor(...);`. A monotonic timer counting scans is not proof that a physical condition remained true between scans. Use certified evidence when continuity matters.
For a declared Temperature sensor, `signal recent = hold_last(temperature, for_at_most: 2min, quality: measured);` limits reuse of its last good sample. It still needs an explicit Result response before an output can use it.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `debounce` | `debounce(source, stable_for: Duration, initial: T) -> T or Result<T,E>`: accept a stable candidate | Bool or finite enum; positive constant duration and matching constant initial. Candidate changes restart its age; faults reset. Sample sources preserve lineage; plain values use scans. [Debounce](../tests/debounce-control.test.mjs). |
| `true_for` | `true_for(BoolSensor, duration: Duration, quality: measured) -> Result<Bool,SensorFault>`: prove continuous true | Direct declared Bool sensor, positive constant duration. Driver-certified intervals; false/inadmissible quality resets. Boundary reaching duration is true. [Certified source](../tests/fixtures/true-for-certified.ghost.md). |
| `after_event` | `after_event(Event, BoolSensor, window: Duration, quality: measured)`: retain per-event evidence | Positive constant window; event identities and predicate samples required. Predicate is tested in [eventTime,eventTime+window). Signal itself is not scalar. [Event source](../tests/fixtures/after-event-evidence.ghost.md). |
| `after_event_any` | `after_event_any(signal) -> Result<Bool,SensorFault>`: project existential event result | One after_event signal. Decisive true can establish any; otherwise unresolved identities/faults remain relevant. [Projection examples](../tests/after-event-control.test.mjs). |
| `after_event_all` | `after_event_all(signal) -> Result<Bool,SensorFault>`: project universal event result | One after_event signal. Decisive false can establish all=false; empty/pending sets without decisive evidence yield NotReady, not automatic permission. [Projection examples](../tests/after-event-control.test.mjs). |
| `window_average` | `window_average(source, over: Duration, quality: measured, max_age: Duration)` | Result<numeric/physical,SensorFault> with physical sample lineage. Return same payload, except Int -> Number. [Windows](../tests/window-control.test.mjs). |
| `window_min` | `window_min(source, over: Duration, quality: measured, max_age: Duration)` | Same admissible payloads as average; Result of the minimum, same payload type. [Windows](../tests/window-control.test.mjs). |
| `window_max` | `window_max(source, over: Duration, quality: measured, max_age: Duration)` | Same admissible payloads as average; Result of the maximum, same payload type. [Windows](../tests/window-control.test.mjs). |
| `window_rate` | `window_rate(source, over: Duration, quality: measured, max_age: Duration) -> Result<Rate<Q>,SensorFault>` | Supported linear physical quantity; earliest/latest observations at distinct times. Temperature difference uses delta K. Number/Int/Percent, RelativeHumidity, CO2 and Acidity are not accepted inputs. [Rate examples](../tests/window-control.test.mjs). |
| `hold_last` | `hold_last(source, for_at_most: Duration, quality: measured) -> Result<T,SensorFault>`: temporarily reuse a good sample | Physical lineage required; positive constant duration. Preserve actual timestamp, held age and masked fault; never refresh it by reevaluation. [Hold examples](../tests/hold-last-control.test.mjs). |
| `elapsed` | `elapsed(state) -> Duration`: age since a state change | Timer declaration only; declared state, explicit monotonic clock; resets on change. [E08](#ch06). |
| `continuous_true` | `continuous_true(BoolExpression) -> Duration`: age of continuously true scan observations | Timer declaration only; starts at zero on first true scan, resets on false. It does not certify the unobserved interval. [Timer examples](../tests/compiler.test.mjs). |

Window `over` and `max_age` are positive constant Durations. Use actual admissible observations in **(now-over,now]**, without interpolation. No observations, or newest age **>= max_age**, means NotReady. A current source fault is preserved. A rate requires two distinct observation times. Window composition retains aggregate/sample provenance; clock-only scans do not fabricate new observations.

An after_event-only program with any/all projection can compile to executable control with event-runtime bindings. An unprojected after_event, or its combination with natural conditions, can produce an `executable:false` temporal descriptor. `after_event_for` is covered under unsupported names below.
Source: [signal/timer lowering](../tools/control.mjs), [temporal Reference](reference/04-sensors-constraints-control.md).

### 13.5 Natural facts and schedule policy constructors

A provider supplies observations or predictions; the program decides what they permit. These two ordinary calls return uncertainty explicitly.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `calendar_is` | ``calendar_is(calendar, day`workday` or day`offday` or day`holiday`) -> Result<Bool,CalendarFault>`` | Typed WorkCalendar or HolidayCalendar with an explicit UTC binding in GFB18. Missing, outside-coverage, expired or untrusted-clock facts preserve a fault; handle it explicitly before negating the successful Bool. [Executed calendar boundaries](../tests/reference-calendar-boundary.test.mjs). |
| `tide_is` | ``tide_is(provider, tide`spring` or tide`neap`) -> Result<Bool,TemporalContextFault>`` | Declared TidePredictions provider. Missing/stale prediction or clock context is a fault. [Natural conditions](../tests/natural-condition-contract.test.mjs). |
| `moon_is` | ``moon_is(provider, moon`phase`) -> Result<Bool,TemporalContextFault>`` | LunarEphemeris provider; phases: new, waxing_crescent, first_quarter, waxing_gibbous, full, waning_gibbous, last_quarter, waning_crescent. [Natural conditions](../tests/natural-condition-contract.test.mjs). |

The tagged literals in these signatures are notation fragments. These calls require runtime/provider facts and cannot capture a global calendar or provider inside a pure fn.

The following constructors are valid only in schedule fields. They do not return freely stored expression values. Durations here are positive constants.
For example, `gap = skip_after(10min);` declares a gap policy. Tide's `basis = run(5min, within(10min));` allows admission within ten minutes, then runs for five minutes from admission.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `instant` | `instant(DateTime)`: absolute Periodic anchor | Constant DateTime; current executable slice uses preserve_anchor and pulse. [Periodic](../tests/periodic-cron-policy.test.mjs). |
| `civil` | `civil(Date, TimeOfDay)`: civil Periodic anchor | Constant date/time; checked descriptor contract, outside current Periodic bytecode slice. [Periodic](../tests/periodic-cron-policy.test.mjs). |
| `skip_after` | `skip_after(Duration)`: bound acceptable observation gap | Schedule gap field; larger gaps use explicit skip/baseline policy. [Policies](../tests/periodic-cron-policy.test.mjs). |
| `range` | `range(Duration)`: planned interval | Schedule basis; nonoverlap must be provable and cancel_when explicit. Fixed UTC ranges have a bounded execution slice; general civil ranges remain descriptor scope. [Range contract](../tests/schedule-descriptor-artifact.test.mjs). |
| `run` | `run(Duration, within(Duration))`: Tide run from admission | Tide basis; first Duration is run length. Admission must occur inside the grace interval. [Tide](../tests/natural-schedule-contract.test.mjs). |
| `within` | `within(Duration)`: Tide admission grace | Only second argument of Tide run; [planned,planned+grace), exact end excluded. It does not extend run length. [Tide](../tests/natural-schedule-contract.test.mjs). |
| `hold_trusted` | `hold_trusted(Duration, terminal: skip)`: bounded trusted-time hold | Solar/Tide clock field; positive constant, prior trusted evidence and run/time continuity required. Exact expiry skips. E36. [Execution](../tests/programming-natural-examples.test.mjs). |
| `fixed_time` | `fixed_time(TimeOfDay literal, terminal: skip)`: fixed-time fallback | Solar fallback only; constant TimeOfDay literal and explicit terminal skip. Do not transfer it to Tide. E36/E101. [Execution](../tests/programming-natural-examples.test.mjs). |

Current executable schedules use baseline recovery. Solar and Tide support `trusted_only` or `hold_trusted` with a positive constant Duration and `terminal: skip`. Solar also supports `fixed_time(TimeOfDay, terminal: skip)` fallback; Tide fallback is `skip`. Daily/slots/Cron use pulse; Periodic requires instant+preserve_anchor; Tide uses run+within. Fixed UTC `range` has a separate bounded execution slice; this does not make every civil descriptor executable. See E36–E37 below and the [fallback checks](../tests/natural-fallback-compiler.test.mjs).
Source: [schedule lowering and slice selection](../tools/control.mjs), [time Reference](reference/03-time-and-schedules.md).

### 13.6 Account for use before granting more

An account records evidence, rather than predicting use from an animation or requested output. Applied receipts differ from requested intent; durable accounting needs a ledger and verified resource bindings.
For a bound resource pump, the declaration fragment `account pumping = on_time(pump, stage: applied, persistence: durable);` chooses applied evidence. The linked accounting examples also declare the resource and limit policies.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `on_time` | `on_time(resource, stage: applied, persistence: durable)`: Duration account | Account declaration; bounded executable slice accepts durable/applied only. Requested/safe/confirmed alternatives can be checked but are not this executable binding. [Accounting](../tests/accounting-syntax.test.mjs). |
| `count_events` | `count_events(Event, over: local_day("zone"), persistence: durable)`: event account | Account declaration; .count returns Result<Int,AccountingFault>. Executable slice requires durable/local_day; duplicate event identities do not double count. [Accounting](../tests/accounting-syntax.test.mjs). |
| `used` | `used(account, rolling(Duration))`: inspect accounted Duration | Only accounting constraint limit position. Executable limit uses <=, positive bound/reserve and on_unknown=block. [Limits](../tests/accounting-syntax.test.mjs). |
| `rolling` | `rolling(Duration)`: trailing accounting basis | Positive constant duration; count_events rolling is descriptor/check scope, outside executable event-count slice. [Limits](../tests/accounting-syntax.test.mjs). |
| `local_day` | `local_day("timezone")`: civil-day accounting basis | Nonempty literal timezone; clock/calendar/ledger required. It is not a fixed 24-hour rolling window. [Accounting](../tests/accounting-syntax.test.mjs). |
| `count_on` | `count_on({resources}) -> Int`: count true candidate resources | Named resource constraints, not ordinary expressions. Finite distinct Bool resource set; empty -> 0. Host policy binding required. [Named constraints](../tests/named-constraints.test.mjs). |
| `any_on` | `any_on({resources}) -> Bool`: test candidate resources | Same restricted context; empty -> false. Evaluation stage is declared by the constraint. [Named constraints](../tests/named-constraints.test.mjs). |

A standalone named resource policy becomes a host-policy artifact. It is not ordinary VM control. Source: [accounting/resource constraints](../tools/control.mjs).

### 13.7 PID constructors belong to an objective

A controller computes requested targets. Later constraints may restrict them. These constructors set gains and restart policy; they are not general unit-algebra functions. The current native binding is a Temperature sensor, Temperature config target and `ContinuousActuator<Percent>`, with output minimum 0%. Non-PID controller kinds can carry binding-required metadata; a parsed `pi` or `on_off` is not proof of a running controller.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `proportional_gain` | `proportional_gain(output: Percent, error: TemperatureDelta)`: P gain | PID kp field; constants, output >=0, error >0; output/error. [Controller examples](../tests/gfb7-pid-contract.test.mjs). |
| `integral_gain` | `integral_gain(output: Percent, error: TemperatureDelta, time: Duration)`: I gain | PID ki; same bounds plus time >0; output/error/seconds. [Controller examples](../tests/gfb7-pid-contract.test.mjs). |
| `derivative_gain` | `derivative_gain(output: Percent, error: TemperatureDelta, time: Duration)`: D gain | PID kd; same bounds plus time >0; output*seconds/error. [Controller examples](../tests/gfb7-pid-contract.test.mjs). |
| `reset` | `reset(output: Percent)`: explicit restart target | PID restart field; constant inside objective output range. First accepted sample initializes tracking; it is not an arbitrary state reset call. [Controller examples](../tests/gfb7-pid-contract.test.mjs). |

Zero gain output disables that term. Period must be positive and late_after >= period. Explicit direction, bias, anti-windup, disabled/transfer, fault and restart policies govern lifecycle; stale/missing measurements are not silently accepted. See [controller lowering](../tools/control.mjs) and [continuous control Reference](reference/04-sensors-constraints-control.md).
For example, `kp = proportional_gain(output: 2%, error: 1Δ°C);` declares two percentage points per degree of temperature error. `restart = reset(output: 0%);` explicitly chooses the first tracked target.

### 13.8 The separate host-policy grammar

The `ghostrules` adapter checks a narrow station-policy grammar. Its apparent calls are contextual forms, not additions to ordinary control expressions. Existing [station rules](../examples/station-rules.ghost.md) and [constraint tests](../tests/constraints.test.mjs) demonstrate complete policies.

| Builtin | Signature and purpose | Context, boundaries and example |
|---|---|---|
| `stopped` | `stopped(station)`: require stopped station | Only allow enter/apply policy conditions with their specified mode. Host station state, not physical motor proof. [Rules](../examples/station-rules.ghost.md). |
| `pump_capacity` | `pump_capacity(pump)`: request a capacity check | Only require ... == Pass or check policy clauses. Host policy artifact; not a numeric capacity expression. [Rules](../examples/station-rules.ghost.md). |
| `day` | `day("timezone")`: civil day for a daily limit | Only `limit on_time(pump) <= Duration per day("zone")`; valid IANA timezone, nonempty <=128 chars. [Rules](../examples/station-rules.ghost.md). |

In this grammar `count_on(pump.valves)`, `any_on(pump.valves)` and `on_time(pump)` are restricted forms with different argument shapes from §13.6. They produce max-valves, pump-needs-valve and daily-limit policy clauses. Do not move these spellings into arbitrary `let` expressions. `exclusive`, `allow`, `require`, `limit`, `once` and `check` introduce clauses. `warn` is rejected.
Source: [host-policy parser](../tools/constraints.mjs).

### 13.9 Adjacent syntax and unavailable alternatives

The following are useful alongside builtins, but are **not callable functions**.

| Syntax | Meaning and current boundary |
|---|---|
| Daily, DailySlots<15min>, Periodic, Cron, Solar, Tide | Schedule declaration types. DailySlots execution uses a fixed 15-minute grid; Cron has five validated fields. |
| pulse; time/date/datetime/cron5/day/sun/tide/moon tagged literals | Policy value and typed notation. ``sun`rise` ``/``sun`set` `` are not sunrise()/sunset() calls. |
| TimeSlots<grid,capacity> | Config type: positive grid dividing 24h, positive capacity, finite unique aligned TimeOfDay list. No TimeSlots(...) call. |
| `Result<T,E>`; `Rate<Q>` | Typed result and expression-only rate. E is compiler-owned; nested Result payload is rejected. |
| schedule.due; schedule.active; schedule.missed | Bool projections; .missed requires exposed projection. Active occurrence is not applied output. No method calls. |
| eventAccount.count | Result<Int,AccountingFault> projection; only count_events accounts. |
| resource.on/position/valves | Contextual resource/policy endpoints, not generic methods. |
| sample, valid, filter, stale_after, recover_after, samples | Sensor declaration fields/notation. In particular stale_after is not an expression call. |
| on_below, off_above, initial; min, max, step, access, label | Named arguments or config fields, not functions. |
| if/case/in; >> and \|>; fn/type/state/config/timer/signal | Syntax, operators and declarations. Qualified input.name/state.name/next.name are removed aliases. |

[Parser and member/type rules](../tools/control.mjs) define these positions. The complete types and units are in [Reference Chapter 2](reference/02-types-expressions-state.md).

| Selected/reference spelling | Current status; do not claim execution |
|---|---|
| after_event_for(signal, EventId) | Reference describes per-identity projection, but current compiler has no call dispatcher; unknown function. Use supported any/all only when their meaning matches intent. |
| window(Duration) schedule basis | Design alternative, not accepted current basis. This is distinct from supported window_average/min/max/rate signals. |
| run(Duration, on_time) | Design alternative; supported Tide run requires within(Duration). |
| range(Duration); civil(Date,TimeOfDay) | Checked descriptor contracts as explained above; not current bytecode slices. |
| PID checkpoint; degraded Name | Selected design alternatives unsupported by current native PID fault/restart policies. |
| ifthenelse, purefn, enum, next | Removed aliases. Use canonical if ... then ... else, fn, type and primed state. |

A name in a diagnostic is not evidence of support. That is why the table separates
design alternatives from current calls. Check the compiler path and artifact kind.
The [chapter coverage check](../tests/programming-builtins.test.mjs) aligns both
languages with callable dispatch; it does not establish physical usefulness.

<a id="ch14"></a>
## 14. Temperature units and air-VPD control

25°C and 77°F describe the same air with different numbers. The same number 25
with a different unit can describe a completely different condition. Feed the
same physical temperature to E16–E18 and predict equal heater decisions. In the
VPD examples, change only temperature or humidity and observe which demand changes
first. Separating conversion from policy lets you resolve calculation errors and
policy disagreements in different places.

### One physical temperature, three source units

A Temperature sensor retains its physical type across Celsius, Fahrenheit, and
Kelvin source/display units; runtime representation is canonical kelvin. The three
heater examples express one physical rule: below 18°C request ON, above 22°C
request OFF, and at either boundary or inside the band retain the previous good
decision. Reading the table across checks that conversion preserves the boundary.

Quality travels with the calculation. Before the first sample the sensor is
NotReady. The last good sample remains usable between deliveries until age >= 3s,
when it becomes Stale. A fault inhibits demand and resets hysteresis to initial
false; these median(1) examples recover after one new good sample. “A number was
seen before” and “the number is trustworthy now” are different claims.

| Physical boundary | Celsius | Fahrenheit | Kelvin |
|---|---|---|---|
| Lower heater threshold | 18°C | 64.4°F | 291.15K |
| Upper heater threshold | 22°C | 71.6°F | 295.15K |
| Heater valid range | −40–50°C | −40–122°F | 233.15–323.15K |

Literal conversion is exact before binary64 rounding. Do not feed a value such as 64.4 directly to a canonical runtime sample: 64.4°F means 291.15K. Driver bindings identify the supplied unit and quantity. See [physical types](reference/02-types-expressions-state.md) and [hysteresis](#ch13).

### E16 — Celsius heater

```ghost
// E16
control CelsiusHeater {
  input air: Temperature {
    sample = 1s;
    valid = -40°C .. 50°C;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal cold = hysteresis(air,
    on_below: 18°C, off_above: 22°C, initial: false);
  output heater: Bool;
  heater <- cold |> recover(false);
}
```

### E17 — Fahrenheit heater

```ghost
// E17
control FahrenheitHeater {
  input air: Temperature {
    sample = 1s;
    valid = -40°F .. 122°F;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal cold = hysteresis(air,
    on_below: 64.4°F, off_above: 71.6°F, initial: false);
  output heater: Bool;
  heater <- cold |> recover(false);
}
```

### E18 — Kelvin heater

```ghost
// E18
control KelvinHeater {
  input air: Temperature {
    sample = 1s;
    valid = 233.15K .. 323.15K;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal cold = hysteresis(air,
    on_below: 291.15K, off_above: 295.15K, initial: false);
  output heater: Bool;
  heater <- cold |> recover(false);
}
```

### Air VPD from temperature and relative humidity

Air VPD is saturation vapour pressure minus actual air vapour pressure. For simultaneous air temperature T in °C and air relative humidity RH, use `0.6108 * exp(17.27*T/(T+237.3)) * (1-RH/100)` kPa. The saturation relation and relative-humidity definition come from [FAO-56, Chapter 3, equations 10–11](https://www.fao.org/4/x0490e/x0490e07.htm). This is an instantaneous air calculation, not FAO's daily evapotranspiration estimate. Leaf VPD additionally depends on leaf temperature; it is not calculated here.

GhostFlow has no exp builtin. Each complete example authors `exp_0_3_1` as an ordinary pure fn: a fixed 14th-order Taylor polynomial, evaluated in Horner form. The declared air sensor domain is **0–50°C**, so the exponent is **0–3.006**, inside the function's stated 0–3.1 domain. Outside that temperature range the sensor returns Invalid and the formula is not evaluated. Do not extrapolate the approximation. The [independent numerical check](../tests/programming-climate.test.mjs) compares real runtime values with host Math.exp on a 0.1°C grid and humidity boundaries, requiring absolute error <= **0.001 kPa**. It checks all three originals, rather than copying their polynomial into an expected-value implementation.

`(t - 0°C) / 1Δ°C` explicitly obtains a Number in Celsius. `rh / 100%RH` explicitly normalizes typed humidity, using [the RH ratio contract](reference/02-types-expressions-state.md). The final multiplication by `0.6108kPaVPD` preserves VaporPressureDeficit. RelativeHumidity is air humidity, not E10's soil-moisture Percent.

Light is typed **PPFD**, using `umol/m2/s` (µmol·m⁻²·s⁻¹). It counts photosynthetically relevant photons. Lux is illuminance weighted for human vision; there is no universal lux-to-PPFD conversion. Use a verified PPFD sensor/binding. Light **gates output eligibility** and never modifies calculated VPD at fixed T/RH.

### Three independent teaching policies

Thresholds are illustrative source intent, not universal crop recommendations. A humidifier demand is not proof that humidity rises; ventilation depends on outdoor conditions; irrigation demand is not a soil-water estimate or a pump sequence. These examples have no greenhouse physical model. The installation owns actuator binding, suitability and physical effect verification.

| Example | ON | OFF | Light gate |
|---|---|---|---|
| E19 humidification demand | VPD > 1.2 kPa | VPD < 1.0 kPa | PPFD >= 200 µmol·m⁻²·s⁻¹ |
| E20 ventilation demand | VPD < 0.4 kPa | VPD > 0.6 kPa | PPFD >= 200 µmol·m⁻²·s⁻¹ |
| E21 irrigation demand | VPD > 1.0 kPa | VPD < 0.8 kPa | PPFD >= 300 µmol·m⁻²·s⁻¹ |

A calculated Result is not a declared sensor, so the sensor-only hysteresis constructor cannot consume it. The explicit Bool state below expresses the same strict ON/OFF/dead-band intent. Temperature/RH faults clear demand. Night or light fault inhibits the output while climate demand may remain remembered. Recovery uses current good evidence; no timer or extra automatic mode is introduced. `air_vpd_value = 0` on climate fault is an explicit display placeholder. **Read vpd_valid with it**: false does not mean measured zero VPD. A light fault inhibits the output without invalidating a still-good T/RH calculation.

### E19 — High-VPD humidification demand

```ghost
// E19
fn exp_0_3_1(x: Number) -> Number {
  1 + x / 1 * (1 + x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6 * (1 + x / 7 * (1 + x / 8 * (1 + x / 9 * (1 + x / 10 * (1 + x / 11 * (1 + x / 12 * (1 + x / 13 * (1 + x / 14 * (1))))))))))))))
}
fn air_vpd(t: Temperature, rh: RelativeHumidity) -> VaporPressureDeficit {
  0.6108kPaVPD * exp_0_3_1(
    17.27 * ((t - 0°C) / 1Δ°C) / (((t - 0°C) / 1Δ°C) + 237.3)
  ) * (1 - rh / 100%RH)
}
control HumidificationDemand {
  input air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  let climate: Result<VaporPressureDeficit, SensorFault> = case air {
    ok(t) => case humidity {
      ok(rh) => ok(air_vpd(t, rh));
      fault(reason) => fault(reason);
    };
    fault(reason) => fault(reason);
  };
  let daylight = case light {
    ok(ppfd) => ppfd >= 200umol/m2/s;
    fault(_) => false;
  };
  state demand: Bool = false;
  demand' = case climate {
    ok(value) => if value > 1.2kPaVPD then true
      else if value < 1.0kPaVPD then false else demand;
    fault(_) => false;
  };
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, humidify_demand: Bool;
  air_vpd_value <- climate |> recover(0kPaVPD);
  vpd_valid <- case climate { ok(_) => true; fault(_) => false; };
  humidify_demand <- daylight && demand';
}
```

### E20 — Low-VPD ventilation demand

```ghost
// E20
fn exp_0_3_1(x: Number) -> Number {
  1 + x / 1 * (1 + x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6 * (1 + x / 7 * (1 + x / 8 * (1 + x / 9 * (1 + x / 10 * (1 + x / 11 * (1 + x / 12 * (1 + x / 13 * (1 + x / 14 * (1))))))))))))))
}
fn air_vpd(t: Temperature, rh: RelativeHumidity) -> VaporPressureDeficit {
  0.6108kPaVPD * exp_0_3_1(
    17.27 * ((t - 0°C) / 1Δ°C) / (((t - 0°C) / 1Δ°C) + 237.3)
  ) * (1 - rh / 100%RH)
}
control VentilationDemand {
  input air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  let climate: Result<VaporPressureDeficit, SensorFault> = case air {
    ok(t) => case humidity {
      ok(rh) => ok(air_vpd(t, rh));
      fault(reason) => fault(reason);
    };
    fault(reason) => fault(reason);
  };
  let daylight = case light {
    ok(ppfd) => ppfd >= 200umol/m2/s;
    fault(_) => false;
  };
  state demand: Bool = false;
  demand' = case climate {
    ok(value) => if value < 0.4kPaVPD then true
      else if value > 0.6kPaVPD then false else demand;
    fault(_) => false;
  };
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, ventilate_demand: Bool;
  air_vpd_value <- climate |> recover(0kPaVPD);
  vpd_valid <- case climate { ok(_) => true; fault(_) => false; };
  ventilate_demand <- daylight && demand';
}
```

### E21 — VPD and light irrigation demand

```ghost
// E21
fn exp_0_3_1(x: Number) -> Number {
  1 + x / 1 * (1 + x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6 * (1 + x / 7 * (1 + x / 8 * (1 + x / 9 * (1 + x / 10 * (1 + x / 11 * (1 + x / 12 * (1 + x / 13 * (1 + x / 14 * (1))))))))))))))
}
fn air_vpd(t: Temperature, rh: RelativeHumidity) -> VaporPressureDeficit {
  0.6108kPaVPD * exp_0_3_1(
    17.27 * ((t - 0°C) / 1Δ°C) / (((t - 0°C) / 1Δ°C) + 237.3)
  ) * (1 - rh / 100%RH)
}
control IrrigationDemand {
  input air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  let climate: Result<VaporPressureDeficit, SensorFault> = case air {
    ok(t) => case humidity {
      ok(rh) => ok(air_vpd(t, rh));
      fault(reason) => fault(reason);
    };
    fault(reason) => fault(reason);
  };
  let daylight = case light {
    ok(ppfd) => ppfd >= 300umol/m2/s;
    fault(_) => false;
  };
  state demand: Bool = false;
  demand' = case climate {
    ok(value) => if value > 1.0kPaVPD then true
      else if value < 0.8kPaVPD then false else demand;
    fault(_) => false;
  };
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, irrigation_demand: Bool;
  air_vpd_value <- climate |> recover(0kPaVPD);
  vpd_valid <- case climate { ok(_) => true; fault(_) => false; };
  irrigation_demand <- daylight && demand';
}
```

### E22 — Run two existing VPD controls together through imports

E22 does not copy the E19 or E20 source. It imports complete `.ghost.md`
documents generated from those two original sections, pinned by exact revision
and SHA-256. One raw sample packet for `air`, `humidity`, and `light` fans out
to both instances, while each instance retains its own sensor conditioner and
`demand` state. The root exposes both demands. Its common VPD observation uses
the `high` instance's `air_vpd_value` and `vpd_valid`, calculated from the same
inputs.

```ghost
// E22
import HighVpd from "./E19.ghost.md"
  revision "c8a5d37ac09230a9011291a3ae3b053d1bc22773"
  sha256 "7bc10efed87a3db2bbf2e5b56fbf0d6c9a45b54117104d3fa0948baa01f695b4";
import LowVpd from "./E20.ghost.md"
  revision "c8a5d37ac09230a9011291a3ae3b053d1bc22773"
  sha256 "9928297e43cd7c9790e6ca5178e71f4fd815223654fcd0b16fcc9605ea24bf38";
control CombinedVpdDemands {
  input air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, humidify_demand, ventilate_demand: Bool;
  instance high: HighVpd;
  instance low: LowVpd;
  connect high.air <- air;
  connect high.humidity <- humidity;
  connect high.light <- light;
  connect low.air <- air;
  connect low.humidity <- humidity;
  connect low.light <- light;
  connect air_vpd_value <- high.air_vpd_value;
  connect vpd_valid <- high.vpd_valid;
  connect humidify_demand <- high.humidify_demand;
  connect ventilate_demand <- low.ventilate_demand;
}
```

### Run, observe and change one input

Compile each E16–E21 fence separately as a complete .ghost.md document, as in E15. Compile E22 with the generated `examples/programming-book-imports` source closure. Run `node --test tests/programming-climate.test.mjs tests/programming-book-simulation.test.mjs tests/programming-book-import-package.test.mjs` for compiler and actual ghostsim/WASM scans; native/WASM artifacts must have matching build provenance. [Verification](VERIFICATION.md) describes the build prerequisites. The test writes disposable scenario artifacts and never drives hardware.

The online reader defaults to a coordinated **24-hour synthetic daily profile**, using the time-dependent sensor source introduced with E10. Temperature, RH and PPFD vary linearly between the following knots and repeat continuously. Temperature never decreases during 06–18; light is exactly zero during 18–06. This is an illustrative input trajectory, not a greenhouse model or actuator feedback. Each declared sample interval supplies new typed sensor evidence; the actual WASM program computes VPD and control demand.

| Simulated hour | Air °C | RH % | PPFD µmol·m⁻²·s⁻¹ | Observe |
|---|---|---|---|---|
| 00 | 18 | 90 | 0 | Initial heater OFF; light-gated demands OFF |
| 03 | 17 | 92 | 0 | Heater ON |
| 06 | 16 | 94 | 0 | Sunrise; heater ON |
| 09 | 22 | 85 | 500 | Low-VPD ventilation ON; heater retains ON at exact 22°C |
| 12 | 28 | 60 | 1000 | Humidification and irrigation demand ON; heater/ventilation OFF |
| 15 | 31 | 45 | 650 | High-VPD demands remain ON |
| 18 | 31 | 60 | 0 | Sunset; light-gated demands OFF |
| 21 | 23 | 80 | 0 | Night cooling; heater still OFF |
| 24 | 18 | 90 | 0 | Continuous loop boundary; heater turns ON only below 18°C |

Run each example from simulated 00:00. E16–E21 default to 1000× speed and a 24-hour timing chart; compare 09, 12, 15 and 18. Actual wall-clock throughput depends on the computer. Speed changes simulated time per wall-clock time; it does not change thresholds or the daily profile. Pause freezes simulation time. Heater ON at 09 disappears as temperature rises strictly above 22°C. These are independent programs, so no interlock between heater and ventilation is implied. Unit selection changes entry/display units without changing physical values: 17°C = 62.6°F = 290.15K. E16–E18 must make identical decisions across the day.

Constant-value and manual single-packet modes remain useful for individual boundary experiments. They are optional debugging sources, rather than substitutes for observing changing daily decisions.

For Stale, use single-packet mode or stop sample delivery, then advance simulation time to the declared 3s boundary. Repeated constant-source samples are fresh evidence and should not become stale. To demonstrate Disconnected, choose that sample quality; a newly delivered failure remains a failure. Do not simulate disconnection by repeatedly reusing an old Good packet as if it were fresh.

For the heater, observe 18 → 17 → 18 → 22 → 23°C, then a sensor fault and recovery. For each VPD controller, hold temperature at 25°C, change RH to cross its thresholds, and then change only PPFD. Compare requested/safe demand, air_vpd_value and vpd_valid. Try absent, Invalid, Disconnected and stale samples; each relevant fault must inhibit output immediately. Change T/RH together when checking the numerical relation. Do not interpret logical demand, a successful scan or a virtual actuator as a physically confirmed effect.

<a id="ch15"></a>
## 15. Named physical quantities and units

A numeric result is not necessarily a meaningful result. Flow multiplied by time
can produce volume; adding voltage to flow is a broken question even though both
operands contain numbers. In E33, predict that conversions within one quantity
succeed while mixed quantities are diagnosed. A compiler rejection here is a
field misunderstanding found before execution.

Chapter 6 covers `Duration`; Chapter 7 covers dates and times. This chapter focuses on the
17 named physical quantities whose units change how a measurement is understood. Keeping
their types instead of converting them to untyped `Number` lets the compiler catch
comparisons between unrelated sensor readings. `Rate<Q>` is derived in time windows and
is expression-only, not a separate physical quantity catalog entry; Chapter 13 covers it.

### Each physical quantity has its own type

These literals show valid spellings for each type. Reference §2.9 lists every accepted
unit and its canonical unit. GhostFlow converts different units of the same type to the
canonical unit in an expression. Conversion does not change the quantity's type.

| Named type | Literal example | Meaning |
|---|---|---|
| `Temperature` | `25°C`, `77°F`, `298.15K` | Absolute temperature |
| `TemperatureDelta` | `5Δ°C`, `9Δ°F` | Difference in temperature |
| `RelativeHumidity` | `70%RH` | Relative humidity |
| `Pressure` | `100kPa` | Pressure |
| `VaporPressureDeficit` | `1kPaVPD` | Difference between saturation and actual vapor pressure |
| `CO2Concentration` | `800ppm` | Carbon dioxide mole fraction |
| `FlowRate` | `5L/min` | Volumetric flow rate |
| `Volume` | `20L` | Volume |
| `Length` | `35cm` | Length |
| `Irradiance` | `300W/m2` | Radiant power per area |
| `PPFD` | `600umol/m2/s` | Photosynthetic photon flux per area and time |
| `Energy` | `1kWh` | Energy |
| `Power` | `150W` | Power |
| `ElectricalCurrent` | `800mA` | Electric current |
| `Voltage` | `24V` | Voltage |
| `Conductivity` | `1.5mS/cm` | Electrical conductivity |
| `Acidity` | `6.5pH` | Acidity measure |

### Units of the same quantity can be combined

`25°C` and `77°F` have different numbers and unit spellings, but both are `Temperature`.
Either can be compared with a sensor value of that type. `5Δ°C` and `9Δ°F` are also the
same temperature difference. An absolute temperature and a temperature difference are
different types. Subtracting two temperatures produces `TemperatureDelta`; adding or
subtracting a delta to a temperature is allowed. Adding two absolute temperatures is not.

GhostFlow does not perform arbitrary dimensional algebra. It allows addition and subtraction
of the same linear quantity, comparisons of the same type, and multiplication or division
by a numeric scalar. Products between quantities are limited to defined relationships:
`FlowRate * Duration -> Volume`, `Power * Duration -> Energy`, and
`Voltage * ElectricalCurrent -> Power`. Undefined combinations such as `Pressure + Length`
and implicit conversion to untyped `Number` are errors.

| Valid expression | Result | Invalid mixture example |
|---|---|---|
| `room < 25°C && room < 77°F` | Temperature comparisons | `room + room` — adding absolute temperatures |
| `change >= 5Δ°C && change >= 9Δ°F` | Temperature-difference comparisons | `room > change` — comparing temperature with a delta |
| `flow * 1min` | `Volume` | `flow + 20L` — adding flow rate and volume |
| `voltage * current` | `Power` | `pressure > vpd` — comparing pressure and VPD |
| `power * 1h` | `Energy` | `irradiance > ppfd` — comparing different light quantities |

### Keep sensor light units distinct

Greenhouse sensors may report related light measurements in different units.
`Irradiance` in `W/m2` is radiant power reaching an area. `PPFD` in `umol/m2/s` counts
photons in the photosynthetically active band. They have different physical types, so
they cannot be compared directly or use each other's thresholds. There is no universal
conversion factor without a validated conversion that accounts for the spectrum.

The current quantity catalog has no `Lux` type. Do not relabel a lux sensor value as PPFD.
Lux measures illuminance weighted for human vision. A verified conversion must account for
the light spectrum, sensor calibration, and optics. Declare that conversion at a sensor
binding or validated preprocessing boundary, and keep the resulting type consistent with
the actual unit. Declare sensors separately when they measure different quantities.

### E33 — Check mixed units and quantities in one control

This example uses all named physical quantities in the supported catalog. It shows both
allowed relationships such as temperature/delta, flow/volume, and voltage/current, and
separate sensor declarations for radiant irradiance and PPFD.

```ghost
// E33
control PhysicalQuantityUnits {
  state displayed_temperature_ok: Bool = false;
  displayed_temperature_ok' = if air_good then air >= 25°C && air >= 77°F else displayed_temperature_ok;
  state displayed_change_ok: Bool = false;
  displayed_change_ok' = if temperature_change_good then temperature_change >= 5Δ°C && temperature_change >= 9Δ°F else displayed_change_ok;
  state displayed_humidity_ok: Bool = false;
  displayed_humidity_ok' = if humidity_good then humidity >= 70%RH else displayed_humidity_ok;
  state displayed_pressure_ok: Bool = false;
  displayed_pressure_ok' = if pressure_good then pressure >= 100kPa else displayed_pressure_ok;
  state displayed_vpd_ok: Bool = false;
  displayed_vpd_ok' = if vpd_good then vpd >= 1kPaVPD else displayed_vpd_ok;
  state displayed_co2_ok: Bool = false;
  displayed_co2_ok' = if co2_good then co2 >= 800ppm else displayed_co2_ok;
  state displayed_volume_ok: Bool = false;
  displayed_volume_ok' = if tank_volume_good then tank_volume >= 20L else displayed_volume_ok;
  state displayed_length_ok: Bool = false;
  displayed_length_ok' = if pipe_length_good then pipe_length >= 35cm else displayed_length_ok;
  state displayed_energy_ok: Bool = false;
  displayed_energy_ok' = if stored_energy_good then stored_energy >= 1kWh else displayed_energy_ok;
  state displayed_power_ok: Bool = false;
  displayed_power_ok' = if rated_power_good then rated_power >= 150W else displayed_power_ok;
  state displayed_current_ok: Bool = false;
  displayed_current_ok' = if current_good then current >= 800mA else displayed_current_ok;
  state displayed_voltage_ok: Bool = false;
  displayed_voltage_ok' = if voltage_good then voltage >= 24V else displayed_voltage_ok;
  state displayed_conductivity_ok: Bool = false;
  displayed_conductivity_ok' = if conductivity_good then conductivity >= 1.5mS/cm else displayed_conductivity_ok;
  state displayed_acidity_ok: Bool = false;
  displayed_acidity_ok' = if acidity_good then acidity <= 6.5pH else displayed_acidity_ok;
  state displayed_pumped_volume: Volume = 0L;
  displayed_pumped_volume' = if flow_good then flow * 1min else displayed_pumped_volume;
  state displayed_motor_power: Power = 0W;
  displayed_motor_power' = if current_good && voltage_good then motor_load else displayed_motor_power;
  state displayed_hourly_energy: Energy = 0Wh;
  displayed_hourly_energy' = if current_good && voltage_good then motor_load * 1h else displayed_hourly_energy;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_air: Temperature = 0°C;
  let air_good = case observed_air { ok(_) => true; fault(_) => false; };
  let air = case observed_air { ok(value) => value; fault(_) => remembered_air; };
  remembered_air' = air;
  state remembered_temperature_change: TemperatureDelta = 0Δ°C;
  let temperature_change_good = case observed_temperature_change { ok(_) => true; fault(_) => false; };
  let temperature_change = case observed_temperature_change { ok(value) => value; fault(_) => remembered_temperature_change; };
  remembered_temperature_change' = temperature_change;
  state remembered_humidity: RelativeHumidity = 0%RH;
  let humidity_good = case observed_humidity { ok(_) => true; fault(_) => false; };
  let humidity = case observed_humidity { ok(value) => value; fault(_) => remembered_humidity; };
  remembered_humidity' = humidity;
  state remembered_pressure: Pressure = 0kPa;
  let pressure_good = case observed_pressure { ok(_) => true; fault(_) => false; };
  let pressure = case observed_pressure { ok(value) => value; fault(_) => remembered_pressure; };
  remembered_pressure' = pressure;
  state remembered_vpd: VaporPressureDeficit = 0kPaVPD;
  let vpd_good = case observed_vpd { ok(_) => true; fault(_) => false; };
  let vpd = case observed_vpd { ok(value) => value; fault(_) => remembered_vpd; };
  remembered_vpd' = vpd;
  state remembered_co2: CO2Concentration = 0ppm;
  let co2_good = case observed_co2 { ok(_) => true; fault(_) => false; };
  let co2 = case observed_co2 { ok(value) => value; fault(_) => remembered_co2; };
  remembered_co2' = co2;
  state remembered_flow: FlowRate = 0L/min;
  let flow_good = case observed_flow { ok(_) => true; fault(_) => false; };
  let flow = case observed_flow { ok(value) => value; fault(_) => remembered_flow; };
  remembered_flow' = flow;
  state remembered_tank_volume: Volume = 0L;
  let tank_volume_good = case observed_tank_volume { ok(_) => true; fault(_) => false; };
  let tank_volume = case observed_tank_volume { ok(value) => value; fault(_) => remembered_tank_volume; };
  remembered_tank_volume' = tank_volume;
  state remembered_pipe_length: Length = 0m;
  let pipe_length_good = case observed_pipe_length { ok(_) => true; fault(_) => false; };
  let pipe_length = case observed_pipe_length { ok(value) => value; fault(_) => remembered_pipe_length; };
  remembered_pipe_length' = pipe_length;
  state remembered_stored_energy: Energy = 0Wh;
  let stored_energy_good = case observed_stored_energy { ok(_) => true; fault(_) => false; };
  let stored_energy = case observed_stored_energy { ok(value) => value; fault(_) => remembered_stored_energy; };
  remembered_stored_energy' = stored_energy;
  state remembered_rated_power: Power = 0W;
  let rated_power_good = case observed_rated_power { ok(_) => true; fault(_) => false; };
  let rated_power = case observed_rated_power { ok(value) => value; fault(_) => remembered_rated_power; };
  remembered_rated_power' = rated_power;
  state remembered_current: ElectricalCurrent = 0A;
  let current_good = case observed_current { ok(_) => true; fault(_) => false; };
  let current = case observed_current { ok(value) => value; fault(_) => remembered_current; };
  remembered_current' = current;
  state remembered_voltage: Voltage = 0V;
  let voltage_good = case observed_voltage { ok(_) => true; fault(_) => false; };
  let voltage = case observed_voltage { ok(value) => value; fault(_) => remembered_voltage; };
  remembered_voltage' = voltage;
  state remembered_conductivity: Conductivity = 0mS/cm;
  let conductivity_good = case observed_conductivity { ok(_) => true; fault(_) => false; };
  let conductivity = case observed_conductivity { ok(value) => value; fault(_) => remembered_conductivity; };
  remembered_conductivity' = conductivity;
  state remembered_acidity: Acidity = 0pH;
  let acidity_good = case observed_acidity { ok(_) => true; fault(_) => false; };
  let acidity = case observed_acidity { ok(value) => value; fault(_) => remembered_acidity; };
  remembered_acidity' = acidity;
  input observed_air: Temperature;
  input observed_temperature_change: TemperatureDelta;
  input observed_humidity: RelativeHumidity;
  input observed_pressure: Pressure;
  input observed_vpd: VaporPressureDeficit;
  input observed_co2: CO2Concentration;
  input observed_flow: FlowRate;
  input observed_tank_volume: Volume;
  input observed_pipe_length: Length;
  input irradiance: Irradiance {
    sample = 1s; valid = 0W/m2 .. 1500W/m2;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input ppfd: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input observed_stored_energy: Energy;
  input observed_rated_power: Power;
  input observed_current: ElectricalCurrent;
  input observed_voltage: Voltage;
  input observed_conductivity: Conductivity;
  input observed_acidity: Acidity;

  output temperature_ok, change_ok, humidity_ok, pressure_ok, vpd_ok: Bool;
  output co2_ok, volume_ok, length_ok, irradiance_ok, ppfd_ok: Bool;
  output energy_ok, power_ok, current_ok, voltage_ok, conductivity_ok, acidity_ok: Bool;
  output pumped_volume: Volume;
  output motor_power: Power;
  output hourly_energy: Energy;

  let motor_load = voltage * current;
  temperature_ok <- displayed_temperature_ok';
  change_ok <- displayed_change_ok';
  humidity_ok <- displayed_humidity_ok';
  pressure_ok <- displayed_pressure_ok';
  vpd_ok <- displayed_vpd_ok';
  co2_ok <- displayed_co2_ok';
  volume_ok <- displayed_volume_ok';
  length_ok <- displayed_length_ok';
  irradiance_ok <- case irradiance { ok(value) => value >= 300W/m2; fault(_) => false; };
  ppfd_ok <- case ppfd { ok(value) => value >= 600umol/m2/s; fault(_) => false; };
  energy_ok <- displayed_energy_ok';
  power_ok <- displayed_power_ok';
  current_ok <- displayed_current_ok';
  voltage_ok <- displayed_voltage_ok';
  conductivity_ok <- displayed_conductivity_ok';
  acidity_ok <- displayed_acidity_ok';
  pumped_volume <- displayed_pumped_volume';
  motor_power <- displayed_motor_power';
  hourly_energy <- displayed_hourly_energy';
}
```

`pressure > vpd`, `irradiance > ppfd`, `humidity > 70%`, `air + air`, and
`flow + tank_volume` are rejected because their types differ or the operation is
undefined. Before silencing the diagnostic with a conversion, ask whether the
physical question makes sense. Display units of one quantity can use an allowed
conversion; a different quantity, such as a light conversion, needs separately
verified provenance and accuracy. Type checks do not replace calibration or
equipment limits, but they make the questions for those checks precise.

<a id="appendix-a"></a>
## Appendix A. Specification guide

Use this appendix after the main text gives you a concept and you need its exact
boundary. There is no need to memorize it front to back. Let it route a declaration
to its Reference rule, rationale, and diagnostics.

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

A useful diagnostic says which promise was broken, not merely that something is
wrong. E90–E102 are experiments whose expected outcome is failure. Predict the
diagnostic location and reason, and leave only one error at a time so the language
boundary remains visible.

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
  let level: Number = 0;
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
  input moisture: Percent;
  output pump: Bool;
  pump <- moisture < 30%;
}
```

Do not directly compare a sensor as if it were its payload. Use `case` or an explicit Result transform from Reference §2.5.

<a id="appendix-c"></a>
## Appendix C. Document maintenance rules

The examples are teaching fragments and checked contracts at the same time.
Preserving anchors, example IDs, canonical fences, and translation correspondence
keeps the reader and regression tests pointed at the same source. Keep source
distinct from projections so new prose does not create a second executable origin.

A time-varying teaching example cannot prove its intent with one constant valid
input. Keep independent checkpoints before ON, at the ON boundary, through the
retained band, and at OFF. A daily trace complements fault and strict-boundary
scans rather than replacing them.

The Language Reference is normative. For conflicts or missing examples found in this guide, check the relevant Reference section before correcting them. Syntax/semantic changes update Reference syntax, rules, reasons, and examples, then synchronize this guide's learning path and code. Link implementation boundaries needed for learning to evidence documents; maintain changing progress, test counts, artifact hashes, and supported-board lists there. Reuse `tests/docs-runnable-examples.test.mjs` for compiler checks. After book changes, run `npm run generate:pc01` to refresh derived provenance; preserve historical replay and benchmark evidence.

<a id="appendix-d"></a>
## Appendix D. Examples by audience

A PLC developer may enter through interlocks, a web developer through observation,
and a firmware developer through the binding boundary. E23–E32 offer those
different entrances and return to the same requested/safe/applied/confirmed model.
Start with the role nearest yours, then reread the same trace using another role's
question.

These ten programs show the questions different jobs bring to one trace. Pick one
and change its input order: a PLC developer may seek the first blocking condition,
a web developer the evidence to display, and a firmware developer the boundary
between a logical value and a pin. Each is independent and executable. Its result
is logical evidence; boards, Drivers, wiring, and field checks remain responsible
for contacts, valves, and motors.

### E23 — PLC developers: trace a fault from its cause to the output

> “No more guessing why the system stopped.”

When a conveyor stops unexpectedly, the useful question is “Which condition stopped it?” This program drops the running state and remembers the jam as soon as the input clears in a scan. Even after the cause is gone, resetting the fault does not restart the conveyor until the operator releases and presses Start again.

Run one scan with `start=true`, `jam_clear=false`, and `reset=false`. `fault_latched` and `fault_lamp` turn on while `running` and `conveyor` turn off. Clear the jam, then reset: only the fault memory clears, while the drive remains stopped. You can follow the inputs and state used for each output directly in the source. The electrical meaning of a jam detector and the emergency-stop circuit still need separate design.

```ghost
// E23
control TraceableConveyor {
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_start: Bool = false;
  let start_good = case observed_start { ok(_) => true; fault(_) => false; };
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_stop: Bool = false;
  let stop_good = case observed_stop { ok(_) => true; fault(_) => false; };
  let stop = case observed_stop { ok(value) => value; fault(_) => remembered_stop; };
  remembered_stop' = stop;
  state remembered_jam_clear: Bool = false;
  let jam_clear_good = case observed_jam_clear { ok(_) => true; fault(_) => false; };
  let jam_clear = case observed_jam_clear { ok(value) => value; fault(_) => remembered_jam_clear; };
  remembered_jam_clear' = jam_clear;
  state remembered_reset: Bool = false;
  let reset_good = case observed_reset { ok(_) => true; fault(_) => false; };
  let reset = case observed_reset { ok(value) => value; fault(_) => remembered_reset; };
  remembered_reset' = reset;
  input observed_start: Bool;
  input observed_stop: Bool;
  input observed_jam_clear: Bool;
  input observed_reset: Bool;
  state running: Bool = false;
  state fault_latched: Bool = false;
  state start_armed: Bool = true;
  let fault_next = (fault_latched && !reset) || !jam_clear;

  fault_latched' = if jam_clear_good && !jam_clear then true else if start_good && stop_good && jam_clear_good && reset_good then (fault_next) else fault_latched;
  start_armed' = if stop_good && stop then false else if jam_clear_good && !jam_clear then false else if start_good && stop_good && jam_clear_good && reset_good then (!fault_next && !start) else start_armed;
  running' = if stop_good && stop then false else if jam_clear_good && !jam_clear then false else if start_good && stop_good && jam_clear_good && reset_good then (!stop && jam_clear && !fault_latched && (running || (start_armed && start))) else running;

  output conveyor, fault_lamp: Bool;
  conveyor <- running';
  fault_lamp <- fault_latched';
}
```

### E24 — Web developers: separate the screen’s target from device feedback

> “Now program the world beyond the screen.”

Clicking “open” on a dashboard does not mean a valve has reached its open position. Web developers already distinguish requested state from a server response, but device interfaces often collapse both into the same green icon. Here, `target_open` remembers the requested command while the limit input reports confirmation separately.

Set `open_request` for one scan and the command stays active. The “moving” indicator stays on until `open_limit` becomes true. A close request takes priority over an open request. The interface can render the target, output command, and physical feedback as separate values. The installation and device diagnostics determine whether the limit signal represents the actual position accurately.

```ghost
// E24
control ValvePanelState {
  state displayed_open_confirmed: Bool = false;
  displayed_open_confirmed' = if open_limit_good && !open_limit then false else if open_limit_good then open_limit else displayed_open_confirmed;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_open_request: Bool = false;
  let open_request_good = case observed_open_request { ok(_) => true; fault(_) => false; };
  let open_request = case observed_open_request { ok(value) => value; fault(_) => remembered_open_request; };
  remembered_open_request' = open_request;
  state remembered_close_request: Bool = false;
  let close_request_good = case observed_close_request { ok(_) => true; fault(_) => false; };
  let close_request = case observed_close_request { ok(value) => value; fault(_) => remembered_close_request; };
  remembered_close_request' = close_request;
  state remembered_stop: Bool = false;
  let stop_good = case observed_stop { ok(_) => true; fault(_) => false; };
  let stop = case observed_stop { ok(value) => value; fault(_) => remembered_stop; };
  remembered_stop' = stop;
  state remembered_open_limit: Bool = false;
  let open_limit_good = case observed_open_limit { ok(_) => true; fault(_) => false; };
  let open_limit = case observed_open_limit { ok(value) => value; fault(_) => remembered_open_limit; };
  remembered_open_limit' = open_limit;
  input observed_open_request: Bool;
  input observed_close_request: Bool;
  input observed_stop: Bool;
  input observed_open_limit: Bool;
  state target_open: Bool = false;

  target_open' = if close_request_good && close_request then false else if stop_good && stop then false else if open_request_good && close_request_good && stop_good && open_limit_good then (!stop && !close_request && (open_request || target_open)) else target_open;

  output open_command, close_command, moving_open, open_confirmed: Bool;
  open_command <- !stop && target_open';
  close_command <- !stop && !target_open';
  moving_open <- !stop && target_open' && !open_limit;
  open_confirmed <- displayed_open_confirmed';
  require !(open_command && close_command);
}
```

### E25 — Firmware developers: catch conflicting direction commands before flashing

> “Run the logic before you energize a relay.”

Forward and reverse requests can arrive in the same scan through buttons, network packets, or contact bounce. This example refuses to choose one arbitrarily and turns both drive commands off. Change the inputs in PIG to explore a normal request, a lost stop permission, and a conflict before putting the logic on a board.

This is a first step for understanding logical priority before a firmware upload. Software mutual exclusion alone cannot prevent simultaneous contactor operation or motor coast-down. The device needs appropriate electrical and mechanical interlocks and independent protection. Systems that require a reversal delay need explicit state and feedback as well.

```ghost
// E25
control DirectionRequestGate {
  state displayed_forward_command: Bool = false;
  displayed_forward_command' = if forward_request_good && !forward_request then false else if reverse_request_good && reverse_request then false else if stop_ok_good && !stop_ok then false else if forward_request_good && reverse_request_good && stop_ok_good then stop_ok && forward_request && !reverse_request else displayed_forward_command;
  state displayed_reverse_command: Bool = false;
  displayed_reverse_command' = if forward_request_good && forward_request then false else if reverse_request_good && !reverse_request then false else if stop_ok_good && !stop_ok then false else if forward_request_good && reverse_request_good && stop_ok_good then stop_ok && reverse_request && !forward_request else displayed_reverse_command;
  state displayed_conflict: Bool = false;
  displayed_conflict' = if forward_request_good && !forward_request then false else if reverse_request_good && !reverse_request then false else if forward_request_good && reverse_request_good then forward_request && reverse_request else displayed_conflict;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_stop_ok: Bool = false;
  let stop_ok_good = case observed_stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok = case observed_stop_ok { ok(value) => value; fault(_) => remembered_stop_ok; };
  remembered_stop_ok' = stop_ok;
  state remembered_forward_request: Bool = false;
  let forward_request_good = case observed_forward_request { ok(_) => true; fault(_) => false; };
  let forward_request = case observed_forward_request { ok(value) => value; fault(_) => remembered_forward_request; };
  remembered_forward_request' = forward_request;
  state remembered_reverse_request: Bool = false;
  let reverse_request_good = case observed_reverse_request { ok(_) => true; fault(_) => false; };
  let reverse_request = case observed_reverse_request { ok(value) => value; fault(_) => remembered_reverse_request; };
  remembered_reverse_request' = reverse_request;
  input observed_stop_ok: Bool;
  input observed_forward_request: Bool;
  input observed_reverse_request: Bool;
  output forward_command, reverse_command, conflict: Bool;

  forward_command <- displayed_forward_command';
  reverse_command <- displayed_reverse_command';
  conflict <- displayed_conflict';
  require !(forward_command && reverse_command);
}
```

### E26 — AI developers: keep reviewable intent beside generated rules

> “Even when AI writes it, the reason for the behavior must remain.”

A generated control program compiling does not confirm what the generator intended. Reviewers need one document that connects the field assumptions, the rule that encodes them, and the input sequences worth simulating. A `.ghost.md` file keeps prose and executable code in one source, and the compiler reads its top-level `ghost` fences with their original locations.

The rule below requests a pump only when the watering window is open, the soil needs water, and the source is ready. In a real project, mark assumptions such as sensor polarity and unresolved field decisions in the prose, then have a responsible person confirm them in a source revision. The document format cannot guarantee AI accuracy, but it prevents the review target from hiding inside generated code.

```ghost
// E26
control ReviewedWateringRule {
  state displayed_pump_request: Bool = false;
  displayed_pump_request' = if soil_needs_water_good && !soil_needs_water then false else if source_ready_good && !source_ready then false else if watering_window_good && !watering_window then false else if soil_needs_water_good && source_ready_good && watering_window_good then watering_window && soil_needs_water && source_ready else displayed_pump_request;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_watering_window: Bool = false;
  let watering_window_good = case observed_watering_window { ok(_) => true; fault(_) => false; };
  let watering_window = case observed_watering_window { ok(value) => value; fault(_) => remembered_watering_window; };
  remembered_watering_window' = watering_window;
  state remembered_soil_needs_water: Bool = false;
  let soil_needs_water_good = case observed_soil_needs_water { ok(_) => true; fault(_) => false; };
  let soil_needs_water = case observed_soil_needs_water { ok(value) => value; fault(_) => remembered_soil_needs_water; };
  remembered_soil_needs_water' = soil_needs_water;
  state remembered_source_ready: Bool = false;
  let source_ready_good = case observed_source_ready { ok(_) => true; fault(_) => false; };
  let source_ready = case observed_source_ready { ok(value) => value; fault(_) => remembered_source_ready; };
  remembered_source_ready' = source_ready;
  input observed_watering_window: Bool;
  input observed_soil_needs_water: Bool;
  input observed_source_ready: Bool;
  output pump_request: Bool;

  pump_request <- displayed_pump_request';
}
```

### E27 — ESP32 and controller-board makers: connect I/O counts to real uses

> “Give a good board more ways to be useful.”

A data sheet listing eight inputs and eight outputs still leaves customers guessing what they can build. This example connects a grow light, circulation fan, drain pump, and warning output to operating conditions. A board maker can show the logical roles customers could map to their own hardware.

Output names represent device roles, not GPIO numbers. The board binding and driver decide which channel drives `grow_light` and which sensor supplies `source_ready`. This lets a manufacturer publish a project example with a board-specific wiring map instead of promising that one source works automatically on every board.

```ghost
// E27
control BoardShowcase {
  state displayed_grow_light: Bool = false;
  displayed_grow_light' = if enabled_good && !enabled then false else if light_schedule_good && !light_schedule then false else if enabled_good && light_schedule_good then enabled && light_schedule else displayed_grow_light;
  state displayed_circulation_fan: Bool = false;
  displayed_circulation_fan' = if enabled_good && !enabled then false else if ventilation_request_good && !ventilation_request then false else if enabled_good && ventilation_request_good then enabled && ventilation_request else displayed_circulation_fan;
  state displayed_drain_pump: Bool = false;
  displayed_drain_pump' = if drain_path_ready_good && !drain_path_ready then false else if drain_request_good && !drain_request then false else if enabled_good && !enabled then false else if drain_path_ready_good && drain_request_good && enabled_good then enabled && drain_request && drain_path_ready else displayed_drain_pump;
  state displayed_warning: Bool = false;
  displayed_warning' = if drain_path_ready_good && drain_path_ready then false else if drain_request_good && !drain_request then false else if drain_path_ready_good && drain_request_good then drain_request && !drain_path_ready else displayed_warning;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_enabled: Bool = false;
  let enabled_good = case observed_enabled { ok(_) => true; fault(_) => false; };
  let enabled = case observed_enabled { ok(value) => value; fault(_) => remembered_enabled; };
  remembered_enabled' = enabled;
  state remembered_light_schedule: Bool = false;
  let light_schedule_good = case observed_light_schedule { ok(_) => true; fault(_) => false; };
  let light_schedule = case observed_light_schedule { ok(value) => value; fault(_) => remembered_light_schedule; };
  remembered_light_schedule' = light_schedule;
  state remembered_ventilation_request: Bool = false;
  let ventilation_request_good = case observed_ventilation_request { ok(_) => true; fault(_) => false; };
  let ventilation_request = case observed_ventilation_request { ok(value) => value; fault(_) => remembered_ventilation_request; };
  remembered_ventilation_request' = ventilation_request;
  state remembered_drain_request: Bool = false;
  let drain_request_good = case observed_drain_request { ok(_) => true; fault(_) => false; };
  let drain_request = case observed_drain_request { ok(value) => value; fault(_) => remembered_drain_request; };
  remembered_drain_request' = drain_request;
  state remembered_drain_path_ready: Bool = false;
  let drain_path_ready_good = case observed_drain_path_ready { ok(_) => true; fault(_) => false; };
  let drain_path_ready = case observed_drain_path_ready { ok(value) => value; fault(_) => remembered_drain_path_ready; };
  remembered_drain_path_ready' = drain_path_ready;
  input observed_enabled: Bool;
  input observed_light_schedule: Bool;
  input observed_ventilation_request: Bool;
  input observed_drain_request: Bool;
  input observed_drain_path_ready: Bool;
  output grow_light, circulation_fan, drain_pump, warning: Bool;

  grow_light <- displayed_grow_light';
  circulation_fan <- displayed_circulation_fan';
  drain_pump <- displayed_drain_pump';
  warning <- displayed_warning';
}
```

### E28 — Panel builders and integrators: wait for valve confirmation before requesting the pump

> “Deliver the reason for the behavior along with the equipment.”

Commissioning often exposes the difference between “command the valve open” and “receive the open limit.” Treating them as the same condition can request the pump before the piping state is confirmed. This example remembers the fill request but blocks the pump output until it receives open feedback.

Set `fill_request` while `valve_open_limit=false`: only the valve command turns on. When the limit becomes true, the pump request turns on in the next scan. A stop or full-source input clears the state and stops both outputs. The installer must still define the limit polarity, valve timeout, and recovery after a stop for the actual site.

```ghost
// E28
control ConfirmedValveFill {
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_fill_request: Bool = false;
  let fill_request_good = case observed_fill_request { ok(_) => true; fault(_) => false; };
  let fill_request = case observed_fill_request { ok(value) => value; fault(_) => remembered_fill_request; };
  remembered_fill_request' = fill_request;
  state remembered_stop_ok: Bool = false;
  let stop_ok_good = case observed_stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok = case observed_stop_ok { ok(value) => value; fault(_) => remembered_stop_ok; };
  remembered_stop_ok' = stop_ok;
  state remembered_valve_open_limit: Bool = false;
  let valve_open_limit_good = case observed_valve_open_limit { ok(_) => true; fault(_) => false; };
  let valve_open_limit = case observed_valve_open_limit { ok(value) => value; fault(_) => remembered_valve_open_limit; };
  remembered_valve_open_limit' = valve_open_limit;
  state remembered_source_full: Bool = false;
  let source_full_good = case observed_source_full { ok(_) => true; fault(_) => false; };
  let source_full = case observed_source_full { ok(value) => value; fault(_) => remembered_source_full; };
  remembered_source_full' = source_full;
  input observed_fill_request: Bool;
  input observed_stop_ok: Bool;
  input observed_valve_open_limit: Bool;
  input observed_source_full: Bool;
  state filling: Bool = false;

  filling' = if stop_ok_good && !stop_ok then false else if source_full_good && source_full then false else if fill_request_good && stop_ok_good && valve_open_limit_good && source_full_good then (stop_ok && !source_full && (fill_request || filling)) else filling;

  output valve_open_command, pump_command: Bool;
  valve_open_command <- filling';
  pump_command <- filling' && valve_open_limit;
  require pump_command => valve_open_command;
}
```

### E29 — Maintenance teams: leave a clue that separates waiting from failure

> “Leave a repair trail that survives the original author.”

Someone inheriting a machine needs to see both the request and the feedback to answer “Why hasn’t the pump started?” This controller keeps the pump off while it waits for the valve to open, and turns on `waiting_for_valve`. When the limit arrives, the waiting indicator turns off and the pump command appears. Losing stop permission clears both outputs and the waiting indicator.

This indicator does not decide whether the valve has exceeded its normal travel time. The interface and logs should keep “waiting” distinct from a timeout fault, and the handover notes should identify the limit input’s channel, polarity, and inspection method. The goal is to help the next maintainer know which input to inspect without calling the original author.

```ghost
// E29
control ValveWaitDiagnosis {
  state displayed_valve_open_command: Bool = false;
  displayed_valve_open_command' = if fill_request_good && !fill_request then false else if stop_ok_good && !stop_ok then false else if fill_request_good && stop_ok_good then fill_request && stop_ok else displayed_valve_open_command;
  state displayed_pump_command: Bool = false;
  displayed_pump_command' = if fill_request_good && !fill_request then false else if stop_ok_good && !stop_ok then false else if valve_open_limit_good && !valve_open_limit then false else if fill_request_good && stop_ok_good && valve_open_limit_good then fill_request && stop_ok && valve_open_limit else displayed_pump_command;
  state displayed_waiting_for_valve: Bool = false;
  displayed_waiting_for_valve' = if fill_request_good && !fill_request then false else if stop_ok_good && !stop_ok then false else if valve_open_limit_good && valve_open_limit then false else if fill_request_good && stop_ok_good && valve_open_limit_good then fill_request && stop_ok && !valve_open_limit else displayed_waiting_for_valve;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_fill_request: Bool = false;
  let fill_request_good = case observed_fill_request { ok(_) => true; fault(_) => false; };
  let fill_request = case observed_fill_request { ok(value) => value; fault(_) => remembered_fill_request; };
  remembered_fill_request' = fill_request;
  state remembered_stop_ok: Bool = false;
  let stop_ok_good = case observed_stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok = case observed_stop_ok { ok(value) => value; fault(_) => remembered_stop_ok; };
  remembered_stop_ok' = stop_ok;
  state remembered_valve_open_limit: Bool = false;
  let valve_open_limit_good = case observed_valve_open_limit { ok(_) => true; fault(_) => false; };
  let valve_open_limit = case observed_valve_open_limit { ok(value) => value; fault(_) => remembered_valve_open_limit; };
  remembered_valve_open_limit' = valve_open_limit;
  input observed_fill_request: Bool;
  input observed_stop_ok: Bool;
  input observed_valve_open_limit: Bool;
  output valve_open_command, pump_command, waiting_for_valve: Bool;

  valve_open_command <- displayed_valve_open_command';
  pump_command <- displayed_pump_command';
  waiting_for_valve <- displayed_waiting_for_valve';
}
```

### E30 — Farmers and operators: choose when to water; let the controller repeat it

> “The farmer decides. The machine repeats.”

An irrigation policy is not just a moisture reading. The farmer’s crop and work decisions appear here as `enabled` and `watering_window`; the controller requests water only when the soil is dry during that chosen window and the source is ready. If the source is unavailable, it exposes the reason to the operator.

`watering_window` is not a hidden default that stands in for the calendar, weather, or work plan. It is an input supplied by the execution environment according to a schedule the farmer chose. The operator can change the window or moisture rule and let the controller repeat the same decision. Sensor placement and calibration, water volume, and crop-specific thresholds still belong to field practice.

```ghost
// E30
control FarmerDirectedWatering {
  state displayed_pump_request: Bool = false;
  displayed_pump_request' = if enabled_good && !enabled then false else if soil_needs_water_good && !soil_needs_water then false else if source_ready_good && !source_ready then false else if watering_window_good && !watering_window then false else if enabled_good && soil_needs_water_good && source_ready_good && watering_window_good then enabled && watering_window && soil_needs_water && source_ready else displayed_pump_request;
  state displayed_source_attention: Bool = false;
  displayed_source_attention' = if enabled_good && !enabled then false else if soil_needs_water_good && !soil_needs_water then false else if source_ready_good && source_ready then false else if watering_window_good && !watering_window then false else if enabled_good && soil_needs_water_good && source_ready_good && watering_window_good then enabled && watering_window && soil_needs_water && !source_ready else displayed_source_attention;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_enabled: Bool = false;
  let enabled_good = case observed_enabled { ok(_) => true; fault(_) => false; };
  let enabled = case observed_enabled { ok(value) => value; fault(_) => remembered_enabled; };
  remembered_enabled' = enabled;
  state remembered_watering_window: Bool = false;
  let watering_window_good = case observed_watering_window { ok(_) => true; fault(_) => false; };
  let watering_window = case observed_watering_window { ok(value) => value; fault(_) => remembered_watering_window; };
  remembered_watering_window' = watering_window;
  state remembered_soil_needs_water: Bool = false;
  let soil_needs_water_good = case observed_soil_needs_water { ok(_) => true; fault(_) => false; };
  let soil_needs_water = case observed_soil_needs_water { ok(value) => value; fault(_) => remembered_soil_needs_water; };
  remembered_soil_needs_water' = soil_needs_water;
  state remembered_source_ready: Bool = false;
  let source_ready_good = case observed_source_ready { ok(_) => true; fault(_) => false; };
  let source_ready = case observed_source_ready { ok(value) => value; fault(_) => remembered_source_ready; };
  remembered_source_ready' = source_ready;
  input observed_enabled: Bool;
  input observed_watering_window: Bool;
  input observed_soil_needs_water: Bool;
  input observed_source_ready: Bool;
  output pump_request, source_attention: Bool;

  pump_request <- displayed_pump_request';
  source_attention <- displayed_source_attention';
}
```

### E31 — Makers and automation learners: bring watering and ventilation examples together

> “Plenty of examples. Hard to combine them?”

This example imports the original irrigation program E21 and ventilation program E20 instead of copying either one. The root control connects the same air, humidity, and light inputs to both programs while keeping their sensor processing and internal state separate. It exposes their outputs independently as `irrigation_demand` and `ventilate_demand`.

Both demands can be true at once. Before connecting them to shared power or outputs, decide which combinations are allowed and define any priority. The imports pin each original revision and hash. Check the combined program's memory and compute needs before placing it on the board.

```ghost
// E31
import Irrigation from "./E21.ghost.md"
  revision "c8a5d37ac09230a9011291a3ae3b053d1bc22773"
  sha256 "089daea1b525b0be49685b3595554bfb1aa67091fc995da2d65fb0ef9a24357d";
import Ventilation from "./E20.ghost.md"
  revision "c8a5d37ac09230a9011291a3ae3b053d1bc22773"
  sha256 "9928297e43cd7c9790e6ca5178e71f4fd815223654fcd0b16fcc9605ea24bf38";
control CombinedGreenhouseDemands {
  input air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  output irrigation_demand, ventilate_demand: Bool;
  instance watering: Irrigation;
  instance fan: Ventilation;
  connect watering.air <- air;
  connect watering.humidity <- humidity;
  connect watering.light <- light;
  connect fan.air <- air;
  connect fan.humidity <- humidity;
  connect fan.light <- light;
  connect irrigation_demand <- watering.irrigation_demand;
  connect ventilate_demand <- fan.ventilate_demand;
}
```

### E32 — Open-source users: own the control rule before the hardware

> “The control should survive the company.”

Even if a device vendor or online service changes, users should be able to read and keep the rule they approved. This standalone example takes soil moisture and its threshold as inputs, and spells out the comparison in the source. A subscription screen or remote account is not the private source of the control decision.

Keeping the `.ghost.md` file with the Language Reference and compiler revision preserves material for review and regeneration. Running it on another board still depends on that board’s supported runtime and I/O bindings. Program ownership does not guarantee portability, but it keeps the control intent from being trapped in a binary only one supplier can read.

```ghost
// E32
control OwnedWateringRule {
  state displayed_pump_request: Bool = false;
  displayed_pump_request' = if soil_moisture_good && threshold_good then soil_moisture < threshold else displayed_pump_request;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_soil_moisture: Percent = 0%;
  let soil_moisture_good = case observed_soil_moisture { ok(_) => true; fault(_) => false; };
  let soil_moisture = case observed_soil_moisture { ok(value) => value; fault(_) => remembered_soil_moisture; };
  remembered_soil_moisture' = soil_moisture;
  state remembered_threshold: Percent = 0%;
  let threshold_good = case observed_threshold { ok(_) => true; fault(_) => false; };
  let threshold = case observed_threshold { ok(value) => value; fault(_) => remembered_threshold; };
  remembered_threshold' = threshold;
  input observed_soil_moisture: Percent;
  input observed_threshold: Percent;
  output pump_request: Bool;
  pump_request <- displayed_pump_request';
}
```

You do not need to read all ten examples. Follow one from input to output intent,
then find the same evidence distinction in another role's example. GhostFlow's
promise is less the declaration that a device moved than the reason another person
can review and continue the decision.

## Exact counts and natural time: executable R14–R17 examples

The final advanced group covers boundaries that cannot be rounded into “close
enough.” Scan counts need exact `Int`, absolute time needs offset-bearing
`DateTime`, and sunrise or tide needs provider evidence plus fallback. E34–E37
currently run in a separate host profile, so their absence from the browser cabinet
does not mean the language lacks them. Fix the input evidence and compare just
before, exactly at, and just after each boundary.

The four examples ask one question in different forms: what exact evidence lets us
say a boundary was crossed? E34 uses scan count, E35 a UTC instant, E36 a sunrise
occurrence, and E37 a tide occurrence. [Reference 02](reference/02-types-expressions-state.en.md)
and [Reference 03](reference/03-time-and-schedules.en.md) define the rules; the
table routes each decision to reproducible execution evidence.

| Item | Adopted decision and work | Execution evidence |
|---|---|---|
| R14 exact counts | #22/#24/#25: checked i32 Int, explicit conversion, reject overflowing ticks | E34/E98, [integer checks](../tests/int-compiler.test.mjs), [division and boundaries](../tests/int-division-identity.test.mjs) |
| R15 absolute time | #27: DateTime with an offset, exact UTC instant, Duration shifts | E35/E99, [DateTime execution](../tests/date-time-control.test.mjs) |
| R16 calendar/natural schedules | #28 and #401/#403: Solar pulse, Tide run/within, provider and occurrence identity | E36/E37, [natural schedules](../tests/natural-schedule-contract.test.mjs), [Solar scan parity](../tests/solar-scanframe-native-wasm.test.mjs) |
| R17 uncertain-time policy | #29: bounded hold_trusted, Solar fixed_time, explicit terminal skip | E36/E100–E102, [fallback compilation](../tests/natural-fallback-compiler.test.mjs), [fallback execution](../tests/natural-fallback-runtime.test.mjs) |

The current compiler emits executable bytecode for E34–E37. The error examples below are complete programs intentionally rejected by that compiler. Run each fence separately. [Document compilation checks](../tests/docs-runnable-examples.test.mjs) verify identical source in both languages and intended diagnostics; [book execution checks](../tests/programming-natural-examples.test.mjs) exercise E34–E37 host behavior. Compilation and host runtime checks do not establish Device deployment or physical output confirmation.

### E34 — Count true scans exactly

Add one on every successful scan with `add=true`. This counts scans, rather than rising edges, so holding true increments on every scan. The output reads `count'` after parallel update. Adding at the Int maximum rejects the tick with `integer-overflow` and commits neither new state nor output intent. It does not hide overflow by wrapping or saturation.

```ghost
// E34
control ExactScanCount {
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_add: Bool = false;
  let add_good = case observed_add { ok(_) => true; fault(_) => false; };
  let add = case observed_add { ok(value) => value; fault(_) => remembered_add; };
  remembered_add' = add;
  input observed_add: Bool;
  state count: Int = 0;
  output total: Int;
  count' = if add_good then (if add then count + 1 else count) else count;
  total <- count';
}
```

### E35 — Compare an absolute window with explicit offsets

The local spelling 06:30+09:00 and the previous day's 21:30Z identify the same UTC instant. `now` is a typed DateTime supplied by the environment; this expression does not guess a number's meaning or clock trust. The window includes its start and excludes its end. `5min` is a fixed Duration, not a calendar month or timezone change. Out-of-domain DateTime input or a shift result is rejected without partial state updates.

```ghost
// E35
control AbsoluteWindow {
  state displayed_in_window: Bool = false;
  displayed_in_window' = if now_good then now >= start && now < end else displayed_in_window;
  state displayed_same_instant: Bool = false;
  displayed_same_instant' = if true then start == datetime`2026-09-29T21:30:00Z` else displayed_same_instant;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_now: DateTime = datetime`1970-01-01T00:00:00Z`;
  let now_good = case observed_now { ok(_) => true; fault(_) => false; };
  let now = case observed_now { ok(value) => value; fault(_) => remembered_now; };
  remembered_now' = now;
  input observed_now: DateTime;
  output in_window, same_instant: Bool;
  let start = datetime`2026-09-30T06:30:00+09:00`;
  let end = start + 5min;
  in_window <- displayed_in_window';
  same_instant <- displayed_same_instant';
}
```

### E36 — Sunrise pulses with bounded clock and fixed-time fallback

Request a start pulse at the occurrence thirty minutes after sunrise when `enabled`. `start` is not an all-day state and adds no duration run. The environment supplies trusted clock and location/Solar calculation evidence. Within the same run/time continuity, `hold_trusted` extends a previously received trusted snapshot using monotonic time for less than two minutes. Without that prior evidence, or at the exact two-minute boundary, it skips. Held time is not recorded as trusted wall time.

When the Solar event is unavailable, use the explicit alternative at UTC 06:30. This fallback still needs a valid trusted or bounded held clock. Unavailable time becomes neither zero nor now; its terminal policy is skip. First observation and baseline recovery after a large gap do not retroactively start past occurrences. Schedule evidence distinguishes admission, unknown and fallback reasons.

```ghost
// E36
control SolarFallbackStart {
  state displayed_start: Bool = false;
  displayed_start' = if true then dawn.due else displayed_start;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_enabled: Bool = false;
  let enabled_good = case observed_enabled { ok(_) => true; fault(_) => false; };
  let enabled = case observed_enabled { ok(value) => value; fault(_) => remembered_enabled; };
  remembered_enabled' = enabled;
  input observed_enabled: Bool;
  schedule dawn: Solar {
    timezone = "UTC";
    latitude = 37;
    longitude = 127;
    at = sun`rise + 30min`;
    basis = pulse;
    when = enabled_good && enabled;
    clock = hold_trusted(2min, terminal: skip);
    gap = skip_after(60s);
    recovery = baseline;
    fallback = fixed_time(time`06:30`, terminal: skip);
  }
  output start: Bool;
  start <- displayed_start';
}
```

### E37 — Admit before high tide, then run on monotonic time

Planned time is thirty minutes before high tide from provider `harbor_tides`. With valid fresh predictions, trusted clock and `allowed=true`, admit once inside [planned, planned+10min). The exact end is excluded. Run for five minutes from admission; late admission does not extend run length. `stop=true` cancels through `cancel_when`. Even if new admission becomes unavailable, an already admitted run proceeds on monotonic time subject to cancellation and run/time continuity rules.

Missing/stale predictions or an Unknown clock do not admit new runs. `fallback=skip` neither proves physical fail-safe behavior nor invents predictions. `pump` is output intent, separate from safe/applied/confirmed physical facts. Provider station/revision/occurrence and clock snapshots are environmental inputs; the code contains no addresses or installation credentials.

```ghost
// E37
control TideRun {
  state displayed_pump: Bool = false;
  displayed_pump' = if true then high.active else displayed_pump;
  // Source-local display memory is initialized here; faults remain producer unknown.
  state remembered_allowed: Bool = false;
  let allowed_good = case observed_allowed { ok(_) => true; fault(_) => false; };
  let allowed = case observed_allowed { ok(value) => value; fault(_) => remembered_allowed; };
  remembered_allowed' = allowed;
  state remembered_stop: Bool = false;
  let stop_good = case observed_stop { ok(_) => true; fault(_) => false; };
  let stop = case observed_stop { ok(value) => value; fault(_) => remembered_stop; };
  remembered_stop' = stop;
  input observed_allowed: Bool;
  input observed_stop: Bool;
  provider harbor_tides: TidePredictions;
  schedule high: Tide {
    source = harbor_tides;
    timezone = "UTC";
    at = tide`high - 30min`;
    basis = run(5min, within(10min));
    when = allowed_good && allowed;
    cancel_when = stop_good && stop;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- displayed_pump';
}
```

### E98 — Reject implicit Int and Number mixing

Here count is Int and measurement is Number. The compiler rejects this code. If approximate calculation is intended, write `number(count)` explicitly. To convert to an exact count, choose `int_exact` or an explicit rounding conversion and its error policy.

```ghost-error
control MixedCount {
  let count: Int = 1;
  let measurement: Number = 1.5;
  output total: Number;
  total <- count + measurement;
}
```

### E99 — Reject DateTime without an offset

Local time alone does not identify a UTC instant. Supply Z or a numeric offset; do not guess an IANA zone.

```ghost-error
control MissingOffset {
  output ready: Bool;
  ready <- datetime`2026-09-30T06:30:00` < datetime`2026-09-30T07:00:00Z`;
}
```

### E100 — Keep Solar fallback explicit

Behavior when data is missing is part of the source contract. A schedule missing mandatory fallback emits no bytecode. If skip is selected, write `fallback = skip;`.

```ghost-error
control MissingSolarFallback {
  schedule dawn: Solar {
    timezone = "UTC"; latitude = 37; longitude = 127; at = sun`rise`;
    basis = pulse; when = true; clock = trusted_only;
    gap = skip_after(60s); recovery = baseline;
  }
  output start: Bool;
  start <- dawn.due;
}
```

### E101 — Keep Solar fixed-time fallback out of Tide

The current fixed_time execution slice is Solar only. Tide fallback is skip; fixed time is not treated as an occurrence from a high-tide prediction.

```ghost-error
control UnsupportedTideFallback {
  provider predictions: TidePredictions;
  schedule high: Tide {
    source = predictions; timezone = "UTC"; at = tide`high`;
    basis = run(5min, within(10min)); when = true; cancel_when = false;
    clock = trusted_only; gap = skip_after(60s); recovery = baseline;
    fallback = fixed_time(time`06:30`, terminal: skip);
  }
  output pump: Bool;
  pump <- high.active;
}
```

### E102 — Specify the end of clock hold

`hold_trusted(2min)` alone hides what happens after the hold expires. The currently supported explicit terminal policy is `terminal: skip`.

```ghost-error
control MissingHoldTerminal {
  schedule dawn: Solar {
    timezone = "UTC"; latitude = 37; longitude = 127; at = sun`rise`;
    basis = pulse; when = true; clock = hold_trusted(2min);
    gap = skip_after(60s); recovery = baseline; fallback = skip;
  }
  output start: Bool;
  start <- dawn.due;
}
```
