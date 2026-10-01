<!-- translation-source: docs/language_faq.md -->

[Korean original](language_faq.md)

# GhostFlow Coding FAQ

This collection answers “How do I code this behavior?”
Each question explains the code, behavior, and reasons for writing it that way.
The [Language Reference](LANGUAGE-REFERENCE.md) defines the language rules.
The language, runtime, Driver, installation, and UI responsibilities for each requirement are listed in
[Reference Chapter 8](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표).

Reviewed against dev on 2026-10-01: [`a7333e56bc25c73fd6167b1182269b96cb671d05`](https://github.com/callin2/ghostflow-language/tree/a7333e56bc25c73fd6167b1182269b96cb671d05).
`[Undecided]` marks an unresolved language/contract decision; `[Partially unsupported]` marks the stated scope unavailable in this dev; `[Changed]` marks advice superseded by this dev. Each status note identifies the affected scope.
An untagged question does not establish physical Device, API, or UI integration verification.

## Questions

1. [How do I write a program file?](#q01)
2. [How do I turn an output on only while a button is held?](#q02)
3. [How do I keep running after releasing Start and stop with the Stop button?](#q03)
4. [How do I run for five minutes after starting and stop automatically? [Changed]](#q04)
5. [How do I turn on after a request persists for two seconds? [Changed]](#q05)
6. [How do I turn off three seconds after the request disappears? [Changed]](#q06)
7. [How do I irrigate every day at 6:00 AM and 6:45 PM?](#q07)
8. [How do I irrigate zone 1 and then zone 2? [Changed]](#q08)
9. [How do I turn on at low moisture without switching repeatedly at the boundary?](#q09)
10. [How do I fill a tank below the lower limit and stop at the upper limit?](#q10)
11. [How do I emit a completion signal after three sensor detections?](#q11)
12. [How do I make “five minutes” an editable field on the screen? [Changed]](#q12)
13. [How do I retain an alarm after the fault clears and release it with Reset?](#q13)
14. [How do I prevent two outputs from turning on together?](#q14)
15. [How do I start 30 minutes after sunrise?](#q15)
16. [How do I reuse the same calculation in several places?](#q16)
17. [How do I implement an interlock?](#q17)
18. [Is self-holding supported?](#q18)
19. [Can I move a particular device when the user cancels partway through?](#q19)
20. [How do I schedule an operation at sunrise?](#q20)
21. [Can I schedule operations by day of the week? [Partially unsupported]](#q21)
22. [Can I control a device based on its accumulated operating time? [Partially unsupported]](#q22)
23. [Can I run cleaning based on the daily operation count regardless of automatic or manual mode?](#q23)
24. [Can I change just the operating time later without a firmware update? [Changed]](#q24)
25. [Can I change a setting field's label and UI component?](#q25)
26. [Can I limit the range of editable setting values?](#q26)
27. [Can I use different settings for each day of the week? [Changed]](#q27)
28. [Can I use different control logic only on public holidays?](#q28)
29. [Can I account for daylight saving time in control?](#q29)
30. [Can I control operations based on high and low tide? [Partially unsupported]](#q30)
31. [Can I control operations based on spring/neap tides or the moon phase? [Changed]](#q31)
32. [Can I code the behavior after power returns following an outage?](#q32)
33. [Can I replace a temperature sensor without changing the control code? [Changed]](#q33)
34. [Are sensor settings separate from GhostFlow source? Do they change at different intervals?](#q34)
35. [Can I replace a sensor without recompiling the control program, like changing only a printer Driver?](#q35)
36. [Should the separation of device replacement and recompilation also be in the language spec?](#q36)
37. [If I connect a button to another GPIO pin, can I just change the input mapping?](#q37)
38. [Can I connect a different relay by changing only the output GPIO mapping?](#q38)
39. [Can I increase the output count with an expansion board such as Waveshare?](#q39)
40. [Can I also map the inputs and outputs of an RS485 I/O expansion board?](#q40)
41. [How do I check or compile a document with the compiler CLI?](#q41)

## How to read the examples

- Each `control` example is an independent program. Do not combine different examples verbatim into one control.
- Place code in top-level `ghost` blocks in a `.ghost.md` document. The first question shows a complete document.
- A **fragment** shows declarations or expressions to place inside an existing control.
- **Design notation** is notation also identified as such in the Reference.
- Each question defines the input names' meanings. A variable name does not automatically determine physical contact polarity or communication method.
- Outputs are logical intent. If you need to confirm that a valve is open, express this with a feedback input separate from the output value.
- Each answer's **Syntax basis** links directly to the Reference chapters and sections for its notation.
  Common `control`, `input`, and `output` declarations follow [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법).

<a id="q01"></a>
## 1. How do I write a program file?

Write a `.ghost.md` document containing both explanation and code.

````markdown
# 버튼으로 램프 켜기

버튼을 누르고 있는 동안 램프를 켠다.

```ghost
control ButtonLamp {
  input button: Bool;
  output lamp: Bool;

  lamp <- button;
}
```
````

People read the Markdown explanation; `ghost` blocks contain the control rules.
Even with several blocks among the explanations, they form one program in document order.
Splitting blocks alone does not create execution stages or waiting periods.

**Why write it this way?** To preserve the behavior and the reason for choosing it in the same document.

**Syntax basis**

- `.ghost.md`, top-level `ghost` blocks: [Reference §1.1 — Execution block extraction](reference/01-source-and-syntax.md#실행-블록-추출)
- `control`, input/output declarations: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- `<-` output connection: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q02"></a>
## 2. How do I turn an output on only while a button is held?

Connect the input to the output because no memory is needed.
Here, `button = true` means pressed and `stop = true` means a stop request.

```ghost
control HoldToRun {
  input button, stop: Bool;
  output pump: Bool;

  pump <- button && !stop;
}
```

Releasing the button or receiving a stop request turns the output intent off in that evaluation.
Even when button and stop are both true, `!stop` makes the output false.

**Why is there no state?** Current inputs alone decide the result; no memory of a previous press is needed.

**Syntax basis**

- `Bool`, `true`/`false`: [Reference §2.1 Value kinds](reference/02-types-expressions-state.md#21-값-종류)
- `&&`, `!`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `<-`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q03"></a>
## 3. How do I keep running after releasing Start and stop with the Stop button?

Remember whether operation is running in `state`. In this example, releasing Stop alone does not restart operation.
The Start button must be released and pressed again.

```ghost
control StartStop {
  input start, stop: Bool;
  output pump: Bool;
  state armed: Bool = false;
  state running: Bool = false;

  let start_event = armed && start;

  armed' = !stop && !start;
  running' = !stop && (start_event || running);
  pump <- running';
}
```

- `running` is the previous running state. It is retained when the button is released after starting.
- `armed` remembers whether release of the Start button was observed while no stop was active.
- A button held from initialization does not start operation. A new press is accepted after release.
- Stop takes priority over self-holding and start requests.

**Why use `running'` for the output?** To reflect a stop in the current evaluation immediately in the output too.

**Syntax basis**

- `state`, previous state and `running'`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `let`: [Reference §2.7 Pure functions and calculation composition](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- `!`, `&&`, `||`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)

Related example: [START/STOP](../examples/curriculum/pc-02-start-stop.ghost.md).

<a id="q04"></a>
## 4. How do I run for five minutes after starting and stop automatically? [Changed]

> **Current dev status:** The duration setting now yields a Result. The age < duration comparison below does not compile without case handling of ok/fault. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Use the running state together with the time elapsed in that state.
End operation when `stop` or `low_water` is true. Ignore new start requests while running.

```ghost
control FiveMinuteRun {
  input start, stop, low_water: Bool;
  output pump, valve: Bool;
  config duration: Duration = 5min;
  state armed: Bool = false;
  state running: Bool = false;
  timer age = elapsed(running);

  let permit = !stop && !low_water;
  let start_event = armed && start;

  armed' = permit && !start;
  running' = if !permit then false
    else if running then age < duration
    else start_event;

  valve <- running';
  pump <- running';
  require pump => valve;
}
```

When `running` becomes true, `age` starts at zero. Operation ends at the first tick where `age >= duration`.
Holding the button does not automatically start another five minutes.
A new press is required to restart after expiry. After a stop or low-water condition, permission must recover and button release must be observed.

**Why not `sleep(5min)`?** Stop and low water must still be evaluated every tick while waiting.

**Syntax basis**

- `config duration: Duration`, `5min`: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언), [§3.1 — Duration](reference/03-time-and-schedules.md#duration)
- `timer age = elapsed(running)`: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- `if ... then ... else`: [Reference §2.6 — Conditional expressions](reference/02-types-expressions-state.md#조건식)
- `require pump => valve`: [Reference §4.7 Output intent and constraints](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)

<a id="q05"></a>
## 5. How do I turn on after a request persists for two seconds? [Changed]

> **Current dev status:** The delay setting now yields a Result. Handle ok/fault with case before the age >= delay comparison below. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Distinguish the state of having received a request from the state of actually being on.

```ghost
control OnDelay {
  input request, stop: Bool;
  output enabled: Bool;
  config delay: Duration = 2s;
  type Phase = Idle | Waiting | Active;
  state phase: Phase = Idle;
  timer age = elapsed(phase);

  phase' = case phase {
    Idle => if request && !stop then Waiting else Idle;
    Waiting => if stop || !request then Idle
      else if age >= delay then Active else Waiting;
    Active => if request && !stop then Active else Idle;
  };

  enabled <- phase' == Active;
}
```

Cancel if the request disappears while waiting. A new request starts a fresh two seconds.
The exact transition occurs at the tick that observes the condition. One long tick does not pass through several stages at once.

**Why are stages needed?** To make “waiting for a request,” “waiting two seconds,” and “on” explicit.

**Syntax basis**

- `type Phase`, `case`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `state phase`, `phase'`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `elapsed(phase)`, `2s`: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간), [§3.1 — Duration](reference/03-time-and-schedules.md#duration)

Related example: [Independent timer patterns](../examples/curriculum/pc-06-timer-patterns.ghost.md).

<a id="q06"></a>
## 6. How do I turn off three seconds after the request disappears? [Changed]

> **Current dev status:** The delay setting now yields a Result. Handle ok/fault with case before the age >= delay comparison below. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Add a holding stage after the request is released. If the request returns while holding, stay on.

```ghost
control OffDelay {
  input request, stop: Bool;
  output enabled: Bool;
  config delay: Duration = 3s;
  type Phase = Idle | Active | Holding;
  state phase: Phase = Idle;
  timer age = elapsed(phase);

  phase' = case phase {
    Idle => if request && !stop then Active else Idle;
    Active => if stop then Idle
      else if !request then Holding else Active;
    Holding => if stop then Idle
      else if request then Active
      else if age >= delay then Idle else Holding;
  };

  enabled <- phase' in {Active, Holding};
}
```

Count three seconds after entering `Holding`. Stop turns the output off without waiting for the delay.
`elapsed(phase)` is elapsed time in the current stage, not accumulated time across several ON intervals.

**Why not share the ON-delay timer?** The start times of different conditions must be remembered separately.

**Syntax basis**

- `type`, `case`, `in {Active, Holding}`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `elapsed(phase)`: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- Distinguishing stage elapsed time from accumulation: [Reference §3.4 Accumulated time and rolling budgets](reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)

<a id="q07"></a>
## 7. How do I irrigate every day at 6:00 AM and 6:45 PM?

Use the schedule's `.due` as the start condition.

```ghost
control DailyWatering {
  input stop: Bool;
  output pump: Bool;
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
  let duration = 5min;
  state running: Bool = false;
  timer age = elapsed(running);

  running' = !stop && (if running then age < duration else starts.due);
  pump <- running';
}
```

`DailySlots<15min>` does not mean run every 15 minutes. It occurs at selected times on a 15-minute grid.
This example does not store schedules arriving while running. It also does not execute schedules that passed while stopped later.

**Why separate the schedule and timer?** Calendar time determines the start; monotonic elapsed time determines operation length.

**Syntax basis**

- `schedule`, `DailySlots<15min>`, `timezone`, `selected`, `.due`: [Reference §3.6 Selected DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)
- Distinguishing schedule occurrences from operation: [Reference §3.5 Common Schedule semantics](reference/03-time-and-schedules.md#35-schedule의-공통-의미)
- `elapsed(running)`: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)

<a id="q08"></a>
## 8. How do I irrigate zone 1 and then zone 2? [Changed]

> **Current dev status:** The watering_time and settle_time settings now yield Results. Handle ok/fault with case before the time comparisons below. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Write the sequence as an enum and connect the outputs permitted in each stage.
This is an example of the normal operating sequence. Each zone proceeds through a two-second wait after requesting valve opening, five minutes of water supply,
and two seconds of cleanup after requesting pump stop.

```ghost
control TwoZones {
  input start: Bool;
  output pump, valve1, valve2: Bool;
  type Phase = Idle | Open1 | Water1 | Stop1 | Open2 | Water2 | Stop2;
  state phase: Phase = Idle;
  state armed: Bool = false;
  timer age = elapsed(phase);
  config watering_time: Duration = 5min;
  config settle_time: Duration = 2s;

  let start_event = armed && start;
  armed' = phase == Idle && !start;

  phase' = case phase {
    Idle => if start_event then Open1 else Idle;
    Open1 => if age >= settle_time then Water1 else Open1;
    Water1 => if age >= watering_time then Stop1 else Water1;
    Stop1 => if age >= settle_time then Open2 else Stop1;
    Open2 => if age >= settle_time then Water2 else Open2;
    Water2 => if age >= watering_time then Stop2 else Water2;
    Stop2 => if age >= settle_time then Idle else Stop2;
  };

  valve1 <- phase' in {Open1, Water1, Stop1};
  valve2 <- phase' in {Open2, Water2, Stop2};
  pump <- phase' in {Water1, Water2};
  require pump => (valve1 || valve2);
  require !(valve1 && valve2);
}
```

Requests during operation are not queued. After completion, the button must be released and pressed again to restart.
The two-second wait in this code does not confirm actual valve opening.
If opening/closing feedback and an interruption path are required, follow the
[Sequential control example using feedback](../examples/curriculum/pc-09-sequential-water-supply.ghost.md).

**Why not write a loop?** Each stage must remember the current stage while evaluating new inputs.

**Syntax basis**

- `type Phase`, `case`, `in { ... }`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `phase'` and simultaneous state transitions: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `elapsed(phase)`: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- `require`, `=>`, output mutual exclusion: [Reference §4.7 Output intent and constraints](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)

<a id="q09"></a>
## 9. How do I turn on at low moisture without switching repeatedly at the boundary?

Use different thresholds for turning on and off. Handle sensor faults explicitly too.

```ghost
control MoistureControl {
  input stop: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  output pump: Bool;

  let requested = case dry {
    ok(value) => value;
    fault(_) => false;
  };
  pump <- requested && !stop;
}
```

Turn on when a healthy moisture value is below 30%; turn off when it exceeds 35%. At either boundary and between them, retain the previous decision.
If filter readiness or recovery conditions are not met, follow the fault path and turn off too.
The sampling interval and limits are choices for this program, not defaults for every sensor.
When healthy measurements recover, operation resumes automatically based on a new moisture evaluation. Add separate state if manual restart is required.

**Why not finish with just `moisture < 30%`?** To handle quality and boundary oscillation together.

**Syntax basis**

- `sensor`, `sample`, `valid`, `filter`, `stale_after`, `recover_after`: [Reference §4.2 Sample contracts and sensor processing order](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- `median`, `signal`, `hysteresis`, named arguments: [Reference §4.3 filter and signal operations](reference/04-sensors-constraints-control.md#43-filter와-signal-연산)
- `case`, `ok(value)`, `fault(_)`: [Reference §4.1 sensor and Result quality](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)

<a id="q10"></a>
## 10. How do I fill a tank below the lower limit and stop at the upper limit?

Remember whether filling is in progress. `low_level_reached` means water has reached the lower level,
and `high_level_reached` means it has reached the upper level.

```ghost
control TankLevel {
  input low_level_reached, high_level_reached: Bool;
  output fill_pump: Bool;
  type Phase = Idle | Filling | SensorConflict;
  state phase: Phase = Idle;
  let conflict = high_level_reached && !low_level_reached;

  phase' = case phase {
    Idle => if conflict then SensorConflict
      else if !low_level_reached then Filling else Idle;
    Filling => if conflict then SensorConflict
      else if high_level_reached then Idle else Filling;
    SensorConflict => if conflict then SensorConflict else Idle;
  };

  fill_pump <- phase' == Filling;
}
```

Do not stop immediately when the water rises above the lower level again. Once filling, continue to the upper level.
Turn off for the contradiction where only the upper-level input is true and the lower-level input is false. After the contradiction clears, pass through Idle once before evaluating again.

**Why not just invert one input?** Different start and end thresholds require the previous operating state.

**Syntax basis**

- `type Phase`, `case`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `state`, `phase'`, `<-`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `if`, `!`, `&&`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)

Original example: [Tank hysteresis](../examples/curriculum/pc-07-tank-hysteresis.ghost.md).

<a id="q11"></a>
## 11. How do I emit a completion signal after three sensor detections?

Count events changing from false to true, rather than ticks that are true.
This example uses the Reference's exact integer type `Int`.

```ghost
control CountThree {
  input detected, reset: Bool;
  output done: Bool;
  state previous: Bool = false;
  state count: Int = 0;
  let rising = detected && !previous;

  previous' = detected;
  count' = if reset then 0
    else if rising && count < 3 then count + 1
    else count;
  done <- count' >= 3;
}
```

A detection signal held true counts only once. This counter stops at three.
If reset and detection occur in the same tick, reset wins. An initially true input counts as the first detection.
When exposing the counter on screen, explicitly specify its counter meaning in the intent link rather than relying on its name.

**Why Int rather than Number?** Counts do not permit approximate values or implicit rounding.

**Syntax basis**

- `Int`, integer operations and comparisons: [Reference §2.3 Exact integer design](reference/02-types-expressions-state.md#23-정확한-정수-설계)
- State memory in `previous`, `count`, and `count'`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- Public meaning of counters: [Reference §5.3 — Descriptors and snapshots](reference/05-settings-and-observation.md#descriptor와-snapshot)

<a id="q12"></a>
## 12. How do I make “five minutes” an editable field on the screen? [Changed]

> **Current dev status:** Setting declarations and live updates are supported. The age < duration advice below uses the earlier scalar-reading model; handle the current setting Result with case. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Declare an operational setting with its type, range, increment, permission, and display name.
Replace the `duration` declaration in [example 4](#q04) with this **fragment**.

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "관수 시간";
}
```

The control expression continues to use `age < duration`.
The screen receives the setting description and creates a time field accepting values from one to 20 minutes in one-minute increments.
The screen chooses whether to use text input, a selection list, or a slider.

An operational setting change is an atomic live event changing effective values in the same program and execution.
When changing multiple values at once, validate all and apply them together. If any is invalid, change none.
Do not reset a running timer to zero.
If a run has already elapsed six minutes and its limit is reduced from ten to five minutes, `age < duration` becomes false in the evaluation reflecting the new value,
and operation ends.

**Why not simply find the `5min` literal on screen?** Not every constant is an operator adjustment point.

**Syntax basis**

- `config`, `min`, `max`, `step`, `access`, `label`: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언)
- Default and effective values: [Reference §5.1 — Default and effective values](reference/05-settings-and-observation.md#기본값과-유효값)
- Atomic changes during execution: [Reference §5.2 — atomic live event](reference/05-settings-and-observation.md#atomic-live-event)

<a id="q13"></a>
## 13. How do I retain an alarm after the fault clears and release it with Reset?

Separate the fault input's current value from the state remembering the fault.
This example handles only alarm memory. `fault_active = true` means the cause remains present.

```ghost
control AlarmMemory {
  input fault_active, reset: Bool;
  output alarm: Bool;
  state latched: Bool = false;
  state reset_armed: Bool = false;
  let reset_event = reset_armed && reset;

  reset_armed' = !fault_active && !reset;
  latched' = fault_active || (latched && !reset_event);
  alarm <- latched';
}
```

`latched` remains even after the fault cause disappears. Clear it only after the cause disappears and reset is released and pressed again.
If fault_active and reset are both true, fault_active wins. Reset is not an equipment restart command.

**Why is this different from `alarm <- fault_active`?** The current cause and memory of a past fault are different information.
For equipment cleanup, position feedback, and multiple fault causes, see the
[Fault and reset example](../examples/curriculum/pc-10-fault-alarm-reset.ghost.md).

**Syntax basis**

- `state latched`, `reset_armed`, next state `'`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `let`, pure event conditions: [Reference §2.7 Pure functions and calculation composition](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- `fault_active || (latched && !reset_event)`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)

<a id="q14"></a>
## 14. How do I prevent two outputs from turning on together?

Express each request, then add a mutual exclusion constraint.

```ghost
control ExclusiveDirections {
  input forward_request, reverse_request: Bool;
  output forward, reverse: Bool;

  forward <- forward_request;
  reverse <- reverse_request;
  require !(forward && reverse);
}
```

When both requests are true, both outputs after constraints are false. Writing order does not choose a winner.
This constraint alone does not create a direction-change delay. If a delay is needed, use the
[Direction-change state and timer example](../examples/curriculum/pc-04-direction-interlock.ghost.md).

**Why not secretly block one output inside the other's expression?** To make each request and the conflict rule independently readable and explainable.

**Syntax basis**

- `require !(forward && reverse)` and mutual exclusion: [Reference §4.7 Output intent and constraints](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- Constraint syntax skeleton: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)

<a id="q15"></a>
## 15. How do I start 30 minutes after sunrise?

Declare a Solar schedule and use `.due` as the start condition.
This **fragment** replaces the `starts` declaration in [example 7](#q07).

```ghost
schedule starts: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise + 30min`;
  fallback = skip;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
}
```

Replace the example coordinates with the target location's coordinates. The existing `duration` and timer determine operating time after `starts.due`.
If sunrise cannot be determined, this example skips a new run. It does not relabel that reason as the normal “not yet time to start.”
`fallback = skip` does not automatically provide a rule canceling an already-started run.

**Why specify location, time zone, and fallback?** Natural events depend on installation context, and decisions when information is unknown must also be explicit.

**Syntax basis**

- `schedule ...: Solar`, location/time zone, ``sun`rise + 30min` ``: [Reference §3.9 — Selected Solar notation](reference/03-time-and-schedules.md#선택된-solar-표기)
- `fallback = skip`: [Reference §3.9 — Fallback and recovery for natural references](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)
- Meaning of `.due`: [Reference §3.5 Common Schedule semantics](reference/03-time-and-schedules.md#35-schedule의-공통-의미)

<a id="q16"></a>
## 16. How do I reuse the same calculation in several places?

Extract a pure function and pass the needed values as arguments.

```ghost
fn permitted(request: Bool, stop: Bool, enabled: Bool) -> Bool {
  request && !stop && enabled
}

control TwoRequests {
  input request1, request2, stop, enabled: Bool;
  output zone1, zone2: Bool;

  zone1 <- permitted(request1, stop, enabled);
  zone2 <- permitted(request2, stop, enabled);
}
```

A function does not remember state between calls. Replicating behavior with timers or self-holding memory
is different from reusing a pure calculation.
Independent state, ports, settings, and connections for such behavior follow [Behavior composition](reference/06-composition-and-replay.md).

**Why not let the function secretly read external state?** To obtain the same result from the same arguments and expose the call's dependencies.

**Syntax basis**

- `fn`, parameters, `-> Bool`, function calls: [Reference §2.7 Pure functions and calculation composition](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- Function declaration syntax skeleton: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- Independence of behaviors with memory: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)

<a id="q17"></a>
## 17. How do I implement an interlock?

An interlock blocks operations with unmet conditions or mutually conflicting operations.
Put operating permission conditions in state transition expressions. Express required relationships between outputs with `require`.

### Run only when conditions are met

Write “run the pump only when valve opening is confirmed and water is not low” as follows.
`valve_open` is an input confirming actual opening, `low_water` detects low water,
and `stop` is a stop request. Do not substitute the valve-opening output value for `valve_open`.

```ghost
control PumpInterlock {
  input start, stop, valve_open, low_water: Bool;
  output pump: Bool;
  state armed: Bool = false;
  state running: Bool = false;

  let permit = !stop && valve_open && !low_water;
  let start_event = armed && start;

  armed' = permit && !start;
  running' = permit && (running || start_event);
  pump <- running';
}
```

Evaluate `permit` every tick even while running. If valve-open confirmation disappears or low water or stop occurs,
turn off both `running'` and pump intent. Recovery of conditions alone does not restart operation.
After permission recovers, release Start and press it again.
This is the restart policy chosen by this example.

### Prevent simultaneous operation of two outputs

Add an output constraint to disallow simultaneous outputs, such as forward and reverse.

```ghost
control DirectionInterlock {
  input forward_request, reverse_request: Bool;
  output forward, reverse: Bool;

  forward <- forward_request;
  reverse <- reverse_request;
  require !(forward && reverse);
}
```

If both requests are true, both constrained outputs are false. The first-written output does not win.
The same mutual exclusion can also be expressed with `mutex(forward, reverse);`.
Write a wait before changing direction with separate state and a timer.

`require pump => valve;` means “pump output intent requires valve output intent.”
Confirm actual valve opening through a separate input, as in the first example.
Output constraints also do not automatically reset state. If a new start is required after conditions clear,
explicitly specify state transitions and restart conditions as in the first example.
This software logic does not replace an emergency stop.

**Why separate these two approaches?** How to change operating state and which output combinations to permit
are control rules that must each be explicit.

**Syntax basis**

- `let permit`, named pure calculations: [Reference §2.7 Pure functions and calculation composition](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- `state`, `running'`, `<-`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `!`, `&&`, `||`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `require`, `mutex`, `=>`, distinguishing requested/safe outputs: [Reference §4.7 Output intent and constraints](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- Declaration forms of `require` and `mutex`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)

<a id="q18"></a>
## 18. Is self-holding supported?

Yes. Remember the previous running state in `state` and reuse that value in the next-state expression.
Basic self-holding that stays on after Start is released is as follows.

```ghost
control SelfHolding {
  input start, stop: Bool;
  output pump: Bool;
  state running: Bool = false;

  running' = !stop && (start || running);
  pump <- running';
}
```

- When `start` is true, `running'` becomes true.
- Even if `start` is false on the next tick, the previous `running` is true, so operation continues.
- When `stop` is true, `running'` is false. Stop takes priority even if Start and Stop arrive together.
- `pump` follows `running'` from the current evaluation.

With this basic expression, releasing Stop while `start` remains true turns operation back on.
If “release Start and press again” is required, also use
[the restart permission state in question 3](#q03).

**Why include the previous state in the expression?** Explicit self-holding memory in `running`
makes the start, hold, and release conditions readable in one expression.

**Syntax basis**

- `state running: Bool = false`, previous state `running`, next state `running'`: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `!stop && (start || running)`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `pump <- running'`: [Reference §1.4 Output connection syntax](reference/01-source-and-syntax.md#14-문법-표기법), [§2.8 Reading next state in outputs](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q19"></a>
## 19. Can I move a particular device when the user cancels partway through?

Yes. On a cancel input, transition to a subsequent action stage and connect its outputs.
This example proceeds through original task stop request → stop confirmation → return device operation → home-position confirmation.
`stopped` and `home` are inputs confirming actual stopping and the home position.

```ghost
control CancelAndReturn {
  input start, cancel, stopped, home: Bool;
  output work, return_device: Bool;
  type Phase = Idle | Working | Stopping | Returning;
  state phase: Phase = Idle;
  state armed: Bool = false;

  let start_event = armed && start;
  armed' = phase == Idle && !start && !cancel;
  phase' = case phase {
    Idle => if !cancel && start_event then Working else Idle;
    Working => if cancel then Stopping else Working;
    Stopping => if !stopped then Stopping else if home then Idle else Returning;
    Returning => if home then Idle else Returning;
  };
  work <- phase' == Working;
  return_device <- phase' == Returning;
  require !(work && return_device);
}
```

`Stopping` waits for feedback that the original task has stopped without sending a new return command.
Command the return device only in `Returning`. Returning continues until home-position confirmation even after cancel is released.
Without stop or home-position confirmation, remain in that stage. This example has no timeout policy.
It does not restart automatically after cancellation. Release Start and Cancel in the waiting state, then provide a new start request.
This example is ordinary task cancellation. Do not use it as a rule permitting additional motion during an emergency stop.

**Why return after stop confirmation?** To prevent the original task and return command from moving the device simultaneously,
and to avoid confusing logical and physical states during cancellation.

**Syntax basis**

- Meaning of phase transitions and state snapshots: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- Device feedback separating requested, applied, and confirmed: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- `type Phase`, `case`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `let`, `if`, Bool operations and comparisons: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)

<a id="q20"></a>
## 20. How do I schedule an operation at sunrise?

Use the `Solar` schedule's `.due` as the start condition. This fragment targets sunrise itself.

```ghost
schedule starts: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise`;
  fallback = skip;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
}
```

Replace the coordinates and time zone with those of the target location. Admit a new occurrence when `starts.due` is true.
The existing `duration` and control state determine operating time. If sunrise cannot be calculated,
skip a new run. `fallback = skip` does not cancel an already-admitted run.

**Why use `.due`?** To separate the occurrence of a natural event from operating state transitions,
preserving the boundary between schedule evaluation and device control.

**Syntax basis**

- `schedule ...: Solar`, ``sun`rise` ``, location/time zone and `fallback`: [Reference §3.9 Selected Solar notation](reference/03-time-and-schedules.md#선택된-solar-표기)
- `.due` and occurrence admission: [Reference §3.5 Common Schedule semantics](reference/03-time-and-schedules.md#35-schedule의-공통-의미)
- `fallback = skip` and recovery: [Reference §3.9 Fallback and recovery for natural references](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)

<a id="q21"></a>
## 21. Can I schedule operations by day of the week? [Partially unsupported]

> **Current dev status:** The day weekday-range filter mon..fri is unsupported. The workday/offday and installation-calendar alternative below is supported. [Current contract](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar).

Express weekday conditions in the schedule's `on` field. For example, to start at 6:00 AM Monday through Friday,
combine the time condition with this weekday condition.
The following is a fragment of selected syntax from the Reference. The current compiler's weekday-range filter does not yet support this notation.
For executable schedules, use ``day`workday` `` or ``day`offday` `` with an installation calendar.

```ghost
on = day`mon..fri`;
```

Apply the weekday filter to the local date of the calculated scheduled start. Public holidays and site workdays follow rules different from weekdays,
so do not interpret ``day`mon..fri` `` as a public holiday calendar.
DST and midnight boundary policies also follow the schedule contract.

**Why separate weekday and time?** The same scheduled time must allow combinations with different date conditions such as weekdays, public holidays, or site workdays.

**Syntax basis**

- `on` and distinguishing weekdays, public holidays, and workdays: [Reference §3.8 DST, midnight, and work calendars](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- Selected schedule semantics of `DailySlots` and `.due`: [Reference §3.6 Selected DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)
- Time zones and local date boundaries: [Reference §3.1 Time values and clock domains](reference/03-time-and-schedules.md#31-시간값과-시계-영역)


<a id="q22"></a>
## 22. Can I control a device based on its accumulated operating time? [Partially unsupported]

> **Current dev status:** The example consuming externally confirmed accumulated Duration is supported. Executable on_time accounts currently support durable applied evidence only; native account execution for requested/safe/confirmed stages is unsupported. [Current contract](../tools/control.mjs#L1521).

Receive accumulated operating time as a `Duration` value and use it in conditions.
First decide **over which period, and what qualifies as operation for accumulation**.

| Desired criterion | Accumulation scope |
|---|---|
| Ten minutes total operation in this task | Sum of ON intervals since task start |
| Twenty minutes of operation in the last hour | A continuously moving one-hour window |
| One hour total operation today | Today's date in the specified time zone |
| One hundred hours total operation since maintenance | Since an explicit maintenance reset |

This control example consumes an accumulated value. `used` is an input summing the same device's confirmed ON intervals
over the chosen scope. `usage_valid` indicates that the aggregation is valid.
This code does not include the declaration generating the accumulated value.

```ghost
control UsageLimit {
  input request, usage_valid: Bool;
  input used: Duration;
  output device: Bool;
  config max_use: Duration = 1h;

  let within_limit = case max_use {
    ok(value) => used < value;
    fault(_) => false;
  };
  device <- request && usage_valid && within_limit;
}
```

Once the total reaches the limit, issue no additional run requests. Strict usage limits including the delay until physical stopping
also require the reservation and settlement rules in Reference §3.10.
`elapsed(running)` measures time since the last state change. It does not sum repeated ON/OFF intervals.

To include both automatic and manual operation, aggregate a common operation record for the same equipment instead of command-specific timers.
Distinguish whether you count output requests, outputs passing constraints, applied commands, or actual feedback.
Without feedback, do not call command application time actual operating time.

Declare accumulated records with `account` and query the last 60 seconds with `used(account, rolling(60s))`.
The `on_time` declaration specifies the target, evidence basis among requested/safe/applied/confirmed, and persistence.
Do not automatically infer task-specific or post-maintenance reset and retention policies from this notation.

**Why is separate accumulation semantics needed?** Checking only continuous operating time misses usage from many short runs.

**Syntax basis**

- `Duration`, `1h`: [Reference §3.1 Time values and clock domains — Duration](reference/03-time-and-schedules.md#duration)
- `&&`, `<`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Difference between `elapsed` and accumulation: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- Accumulation targets/scopes and `account`, `on_time`, `used`: [Reference §3.4 Accumulated time and rolling budgets](reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)
- Combined automatic/manual aggregation and daily limits: [Reference §3.10 Time-based usage constraints](reference/03-time-and-schedules.md#310-시간-기반-사용량-제약)
- `config max_use`: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언)

<a id="q23"></a>
## 23. Can I run cleaning based on the daily operation count regardless of automatic or manual mode?

Combine count conditions with a cleaning sequence.
Instead of counting automatic and manual start commands separately, **count the same device's operations in one place**.
Changing from automatic to manual while the device continues operating does not count as a new operation.

For example, choose the policy “after ten normal-operation starts today in Seoul time, clean once after the current run ends.”
Here, an OFF→ON transition in the operation confirmation signal counts as one operation.
If only completed runs should count, aggregate completion events instead of starts.

This **fragment** reads the daily aggregation. `Int` is the Reference's exact integer type.
`today_starts` is today's combined count of automatic and manual normal operations; `count_valid` is aggregation validity.

```ghost
input today_starts: Int;
input count_valid: Bool;
let wash_due = count_valid && today_starts >= 10;
```

`today_starts` is not a built-in name. This fragment does not declare the daily counter itself.
Declare daily aggregation with `account` and `count_events` from §3.10. Specify input event IDs,
the evidence basis, and date boundaries. Count retransmissions of the same event only once.
`on_time` sums time; `count_events` counts events. Do not interchange them.

The cleaning sequence in the example above is as follows. This describes behavior rather than executable syntax.

```text
Reach ten normal operations today → remember cleaning is needed
Confirm the current normal operation has ended → start the cleaning stage
Confirm cleaning completion → clear the request and remember cleaning completed for that date
```

- Operations turning the same device on for cleaning are excluded from this example's normal-operation count.
- No new normal operation starts during cleaning. Apply the same condition to automatic and manual requests.
- Remember a cleaning request in state. A single-tick pulse can be lost when the device is busy.
- This policy does not cancel an already-remembered cleaning request or cleaning in progress when the date changes.
- Cleaning once daily and cleaning every ten operations are different policies. This example cleans once daily.

The actual daily aggregation contract must define time zone, date boundaries, restoration after restart, clock corrections, and unknown aggregation state.
An ordinary `state count = 0` declaration alone does not create persistent per-date aggregation.
Write the cleaning stages and outputs with enum state, as in [sequential control in question 8](#q08).

**Why count outside operating modes?** Cleaning needs depend on how much the device has been used, rather than who commanded it.

**Syntax basis**

- `Int` and exact counts: [Reference §2.3 Exact integer design](reference/02-types-expressions-state.md#23-정확한-정수-설계)
- `let`, `&&`, `>=`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Cleaning-stage enums and `case`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- Remembering previous inputs, counts, and cleaning requests: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- Distinguishing commands from physical operation: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- Related principles of daily equipment aggregation — time aggregation rules, not count syntax: [Reference §3.10 Time-based usage constraints](reference/03-time-and-schedules.md#310-시간-기반-사용량-제약)

<a id="q24"></a>
## 24. Can I change just the operating time later without a firmware update? [Changed]

> **Current dev status:** Live updates and TimeSlots connections are supported. The age < duration advice below uses the earlier scalar-reading model; handle the current setting Result with case. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Yes. Declare **how long to operate** as an operator-editable `Duration` setting.
This **fragment** replaces the `duration` declaration in [timed operation in question 4](#q04).

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "작동 시간";
}
```

Changing five minutes to ten minutes on screen changes the setting's effective value.
No source edit, program recompilation, firmware update, or restart is required.
This declaration defines the type and range. The screen uses that description to create a field.
Accepted values of ordinary operational settings are preserved across device restarts.

Apply changes within the same execution without resetting elapsed time.
When controlling with `age < duration`, increasing five minutes to ten after three minutes have elapsed evaluates against ten minutes total.
Reducing the limit to five minutes after six have elapsed ends operation at the evaluation reflecting the new value.
“Keep the current task unchanged and use the new time from the next task” requires an explicit control rule
remembering the setting in separate state at task start. It is not the default change semantics of `config`.

**What time to start** is a different setting from operating length.
Connect a `TimeSlots` config instead of the fixed `selected` list in `DailySlots`.
This setting declaration fragment accepts up to eight times on a 15-minute grid.

```ghost
config watering_slots: TimeSlots<15min, 8> = [time`06:00`, time`18:45`] {
  access = operator;
  label = "관수 시작 시각";
}
```

Write `selected = watering_slots;` inside `DailySlots<15min>` in the same control.
Changing times is also a live event without recompilation. Newly added past times are not executed,
and removing a slot alone does not cancel an already-started run.

**Why identify adjustable values in advance?** So the language clearly defines the boundary between what operators may change and changes to program rules themselves.

**Syntax basis**

- `config`, `Duration`, `min`, `max`, `step`, `access`, `label`: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언)
- Source defaults and operational effective values: [Reference §5.1 Default and effective values](reference/05-settings-and-observation.md#기본값과-유효값)
- Changes without recompilation or restart: [Reference §5.2 atomic live event](reference/05-settings-and-observation.md#atomic-live-event)
- Preserving ordinary settings after restart: [Reference §5.2 Lifecycles and temporary settings](reference/05-settings-and-observation.md#생명주기와-임시-설정)
- `elapsed` and existing elapsed time: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- Scheduled times in `selected`: [Reference §3.6 Selected DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)

<a id="q25"></a>
## 25. Can I change a setting field's label and UI component?

Specify a label with the language's `label`. The renderer creating the screen chooses the UI component.
This **fragment** displays the setting from [question 24](#q24) as “Cleaning time.”

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "세척 시간";
}
```

A screen using this declaration can choose an appropriate input method from the following.

| Screen input method | Setting semantics to preserve |
|---|---|
| Time field | Read a Duration value and validate the 1–20-minute range and one-minute increments |
| Selection list | Select allowed values from one to 20 minutes |
| Slider | Apply the same range and increment |

Changing the component still preserves the value's type, range, increment, and change permissions.
`label` is a human-readable name; it does not change the setting ID or permissions.

GhostFlow does not have syntax such as `widget = slider` to specify a particular component.
That choice belongs to the renderer. Saying that the screen can choose does not mean
the language also supplies a menu for operators to change component types directly.

**Why determine screen appearance outside the language?** To edit the same “Cleaning time” setting appropriately on phones and device screens
while retaining identical control semantics and validation rules.

**Syntax basis**

- `config`, `label`, `min`, `max`, `step`, `access`: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언)
- Separating UI appearance from language semantics: [Reference §5.3 Renderer-independent observation model](reference/05-settings-and-observation.md#53-renderer-독립-관찰-모델)
- Descriptions conveying setting IDs, types, and permissions: [Reference §5.3 Descriptors and snapshots](reference/05-settings-and-observation.md#descriptor와-snapshot)

<a id="q26"></a>
## 26. Can I limit the range of editable setting values?

Yes. `min` and `max` define an inclusive allowed range; `step` defines the change increment.
This **fragment** permits operating times from one to 20 minutes in one-minute increments only.

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "작동 시간";
}
```

| Input value | Result |
|---|---|
| One, five, or 20 minutes | Accepted |
| 30 seconds or 21 minutes | Rejected as outside the range |
| One minute 30 seconds | Within range, but rejected for not matching one-minute increments |

`step` is a grid starting at `min`. For example, a one-minute minimum with a two-minute increment
allows one, three, five minutes, and so on. Defaults must also satisfy the range and grid.
Reject values with different units or types too. Do not automatically round values or clamp them to boundaries.

Validation rules apply beyond the slider's displayed range. Other fields and setting requests
follow the same rules. If any value is invalid in a multiple-setting change, apply none.
Declare `access = designer` to disallow operator changes entirely.

**Why specify the range in the language?** So every screen or request path uses only author-permitted values for control.

**Syntax basis**

- `min`, `max`, `step`, default validation and `access`: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언)
- Accepting or rejecting multiple settings together: [Reference §5.2 atomic live event](reference/05-settings-and-observation.md#atomic-live-event)

<a id="q27"></a>
## 27. Can I use different settings for each day of the week? [Changed]

> **Current dev status:** The duration selected by the conditional is also a Result. Handle ok/fault with case before comparing operating time. [Current contract](reference/05-settings-and-observation.md#기본값과-유효값).

Yes. Declare weekday-specific values individually as `config`, then select a value with a conditional expression.
For example, configure five minutes on weekdays and ten on weekends.
Each setting can have its own label and editable range.

This is a **setting selection fragment**. `is_weekday` is an input that is true Monday through Friday
in the specified site time zone. `calendar_valid` indicates that the date determination is valid.
These inputs are not automatically created built-in variables. Their producer supplies the site date and validity.
To restrict the schedule itself by weekday, use the `on = day` filter in Reference §3.8.

```ghost
input is_weekday, calendar_valid: Bool;
config weekday_duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "평일 작동 시간";
}
config weekend_duration: Duration = 10min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "주말 작동 시간";
}
let duration = if is_weekday then weekday_duration else weekend_duration;
let can_start = calendar_valid;
```

Check `can_start` as part of the start condition and use `duration` in the operating-time comparison.
Do not select the weekend setting and start a new run merely because the date is unknown.
This fragment alone does not operate the device. Connect start, stop, and outputs to operating rules.

For separate values Monday through Sunday, similarly define seven settings
and select using an enum weekday input and exhaustive `case` branches.
Public holidays and site workdays are separate conditions from weekdays.

If the `duration` expression above is continuously read during operation, a weekday or setting change makes evaluation use the new value.
To finish the current run with the duration selected on its starting day, remember the selected value in state at start.
Weekday-specific settings do not automatically determine the policy for tasks crossing midnight.

**Why separate settings and selection conditions?** Operators can change only weekday-specific durations while authored control rules retain which value is used on which day.

**Syntax basis**

- Weekday-specific `config`, labels, ranges, and permissions: [Reference §5.1 config declarations](reference/05-settings-and-observation.md#51-config-선언)
- `let` and `if ... then ... else`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Enums for seven weekdays and `case`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- Remembering values at start: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- Weekdays, public holidays, workdays, and date boundaries: [Reference §3.8 DST, midnight, and work calendars](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- Setting changes during execution: [Reference §5.2 atomic live event](reference/05-settings-and-observation.md#atomic-live-event)

<a id="q28"></a>
## 28. Can I use different control logic only on public holidays?

Yes. Use the public-holiday condition to select different control expressions.
You can change operating conditions or sequences, as well as times or setting values.

This example ventilates on ordinary days when people are present or temperature is high,
and on public holidays only when temperature is high.
`is_holiday` is an input determined using the site time zone and chosen public holiday calendar.
`calendar_valid` indicates that the holiday determination for that date is valid.
Neither name is a built-in variable, and this code does not perform a holiday lookup.

```ghost
control HolidayVentilation {
  input is_holiday, calendar_valid: Bool;
  input occupied, hot, stop: Bool;
  output fan: Bool;

  let normal_request = occupied || hot;
  let holiday_request = hot;
  let request = if is_holiday then holiday_request else normal_request;
  fan <- calendar_valid && !stop && request;
}
```

Here, `stop` applies to both branches.
The example explicitly chooses to turn ventilation off when the calendar determination is invalid.
If equipment requires another mandatory action such as high-temperature protection, its unknown-calendar rule must meet that requirement too.
Do not arbitrarily treat an unknown date as an ordinary date or public holiday.

Public holidays are not the same as Saturdays and Sundays. Define the applicable region, whether substitute holidays are included,
and the calendar validity period. Use a site work calendar instead of public holidays if the intended meaning is days the site is closed.
To attach a holiday filter to a schedule, use ``on = day`holiday`;`` and `calendar = holidays;`.
Declare the logical calendar provider with `calendar holidays: HolidayCalendar;`.
This declaration does not automatically create the example's `is_holiday` Bool input.

The example selects a branch for the current date every evaluation. It is not an example of changing
an ongoing sequential task to a different sequence when the date changes. To preserve a started task's sequence,
remember the selected branch in state at start and use the new date's rule only for new tasks.

**Why separate holiday determination and control expressions?** Calendars vary by region, but the program must explicitly show and explain what to do on public holidays.

**Syntax basis**

- `let`, `if ... then ... else`, `||`, `&&`, `!`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `input`, `output`, `<-`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- Public holidays, site workdays, and calendar validity scope: [Reference §3.8 DST, midnight, and work calendars](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- Remembering branches at task start: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q29"></a>
## 29. Can I account for daylight saving time in control?

Yes. Specify an IANA time zone for **schedules based on local time**,
and explicit policies for times disappearing or repeating during daylight saving transitions.
**How long to operate** uses monotonic elapsed time, so daylight saving does not lengthen or shorten it.

This is a schedule declaration **fragment** specifying a time zone.

```ghost
schedule starts: DailySlots<15min> {
  timezone = "America/New_York";
  selected = [06:00];
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

This schedule is based on 6:00 AM local time in New York. It differs from manually adding a fixed UTC offset.
This declaration skips nonexistent times and selects the first occurrence of repeated times.
Reference §3.8 defines these transition policies.

| Transition situation | Policy | Meaning |
|---|---|---|
| Clock moves forward and the scheduled time does not exist | `skip` | Skip that schedule |
| Same situation | `next_valid` | Use the next valid time |
| Clock moves back and the scheduled time occurs twice | `first` | Select only the first |
| Same situation | `second` | Select only the second |
| Same situation | `both` | Select each time as a separate schedule occurrence |
| Same situation | `skip` | Skip that schedule |

Specify policies inside the schedule, such as `dst_missing = skip;` and `dst_repeated = first;`.
Choose the actual policy to match the site's operating intent.
With `both`, the two occurrences have different identifiers.
Whether each actually starts operation depends on control rules such as handling requests while running.
Do not count re-observation of the same schedule after a simple clock correction as a new schedule.

Write operating length after a scheduled start as in [question 7](#q07).
With `timer age = elapsed(running)` and `age < duration`, compare the same monotonic elapsed time
even if the local clock changes during operation.
Do not cancel an already-started run merely because the date or DST interval changes.

**Why separate the two kinds of time?** “6:00 AM local time” means a daily timetable,
whereas “turn the pump on for five minutes” means actual duration.

**Syntax basis**

- Time zones and distinguishing calendar time from monotonic time: [Reference §3.1 Time values and clock domains](reference/03-time-and-schedules.md#31-시간값과-시계-영역)
- `DailySlots`, `timezone`, `selected`: [Reference §3.6 Selected DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)
- Policies for missing and repeated times: [Reference §3.8 DST, midnight, and work calendars](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- Schedule occurrence identity and duplicate suppression: [Reference §3.5 Occurrence identity and duplicate suppression](reference/03-time-and-schedules.md#occurrence-identity와-중복-억제)
- `elapsed(running)`: [Reference §3.2 Elapsed time after state changes](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)

<a id="q30"></a>
## 30. Can I control operations based on high and low tide? [Partially unsupported]

> **Current dev status:** High/low tide and offsets are supported. The run(10min, on_time) notation below is design notation; the compiler supports run(_, within(_)). [Current contract](reference/03-time-and-schedules.md#pulse-window-run-range).

Yes. Use predicted high/low tide times as the basis for schedule occurrences,
and specify offsets before or after them separately from operating length.
These two requirements have different reference times and operating lengths.

```text
30 minutes before high tide → start operation → run for ten minutes
20 minutes after low tide → start operation → run for five minutes
```

Write the first example in a `Tide` schedule as follows. This fragment omits the declared prediction provider and common policies.

```ghost
at = tide`high - 30min`;
basis = run(10min, on_time);
```

The schedule evaluates starting against predicted times. Once started, measure operating length with monotonic time.
Specify the station or prediction model for the tide location, prediction revision, applicable period, and expiry time.
Do not infer site high/low tide times from moon phase alone or assume a fixed number of daily occurrences.

- **High/low tide:** A specific predicted time. It can provide a reference point such as “30 minutes before” or “20 minutes after.”
- **Spring/neap tide:** A classification state or period of tidal range. Use it as a schedule permission condition, rather than treating it as “30 minutes before spring tide.”
- **Actual water level:** A sensor condition separate from predicted time. Connect it separately when control requires actual water-level confirmation.

If predictions are missing or stale, follow the explicit fallback. The minimum policy, `skip`, skips new runs.
Do not execute the same tide event twice when predictions are revised.
Prediction revision or withdrawal alone does not automatically cancel an already-started run,
and restored data does not cause past schedules to execute late.
These rules depend on validity of the prediction data and times used, rather than internet connectivity itself.

**Why separate predicted times and operating length?** So prediction updates do not arbitrarily change an already-started task's duration,
and the tide event that caused its start remains distinguishable.

**Syntax basis**

- High/low tide occurrences, offsets, spring/neap tides, and prediction revisions: [Reference §3.9 Moon and tides](reference/03-time-and-schedules.md#달과-조석)
- Unknown/expired predictions and fallback: [Reference §3.9 Fallback and recovery for natural references](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)
- Schedule starts and `Run` duration: [Reference §3.5 Pulse, Window, Run](reference/03-time-and-schedules.md#pulse-window-run-range)
- Calendar time and monotonic elapsed time: [Reference §3.1 Time values and clock domains](reference/03-time-and-schedules.md#31-시간값과-시계-영역)

<a id="q31"></a>
## 31. Can I control operations based on spring/neap tides or the moon phase? [Changed]

> **Current dev status:** tide_is and moon_is return `Result<Bool, TemporalContextFault>`. Handle ok/fault with case for when = tide_is(...) below. The separate Bool-input fragment remains valid. [Current contract](reference/03-time-and-schedules.md#달과-조석).

Yes. Treat spring/neap tides as **a tidal-range classification state or period**,
and moon phase as a separate condition. When a condition is met, permit a schedule or select
different control rules. Use `tide_is` or `moon_is` in schedule conditions.

| Example desired behavior | Role of the condition |
|---|---|
| Run at 6:00 AM only during neap tides | Neap-tide status permits the timed schedule to start |
| Select a shorter operating duration during spring tides | Spring-tide status selects the setting value |
| Permit schedules only when a specified moon-phase condition is met | Moon-phase determination permits starting |

This Reference fragment connects a declared `TidePredictions` provider to the schedule's permission condition.

```ghost
when = tide_is(harbor_tides, tide`neap`);
```

A **fragment** receiving conditions as inputs and connecting them to control expressions can be written as follows.
`is_neap` is a neap-tide determination from site tide data, `tide_valid` is its validity,
and `schedule_due` means this start event from a separate schedule. These are not built-in variables,
nor declarations calculating tides or querying data.

```ghost
input is_neap, tide_valid, schedule_due: Bool;
let start_allowed = tide_valid && is_neap && schedule_due;
```

Use `start_allowed` as the start condition when the operating state is waiting.
Connecting this single schedule event directly to an operating output does not produce sustained operation.
Maintain operating time after starting with state and a timer as in [question 7](#q07).
If used only for start permission, the end of the neap-tide period does not automatically cancel an ongoing task.

Spring/neap tides are not specific times, so do not attach offsets such as “30 minutes before spring tide.”
For an exact starting point such as “30 minutes before high tide,” use [the high/low tide events in question 30](#q30).
Do not substitute moon phase alone for site spring/neap classification or high-tide times.
The data contract must clearly define spring/neap classification criteria and the evaluation range of moon-phase conditions.
If data is missing or expired, follow the explicit fallback rather than treating it as a normal condition.
The fragment above disallows new runs when validity is false.

**Why distinguish events from state conditions?** Separating “when to start” from “during which period starting is permitted”
avoids the confusion of requesting a new run on every evaluation throughout the same period.

**Syntax basis**

- Classification meaning of spring/neap tides and distinction from moon phase: [Reference §3.9 Moon and tides](reference/03-time-and-schedules.md#달과-조석)
- Established typed notation and external data boundaries: [Reference §3.11 Established time syntax and boundaries](reference/03-time-and-schedules.md#311-확정된-시간-문법과-경계)
- Unknown/expired data and fallback: [Reference §3.9 Fallback and recovery for natural references](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)
- Schedule occurrences and start permission conditions: [Reference §3.5 Common Schedule semantics](reference/03-time-and-schedules.md#35-schedule의-공통-의미)
- `input`, `Bool`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- `let`, `&&`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)

<a id="q32"></a>
## 32. Can I code the behavior after power returns following an outage?

Yes. Specify initial state and subsequent transition conditions to write behavior after restart.
For example, express waiting stopped, running after readiness confirmation, or first executing a home-return stage
with state and input conditions. Do not assume built-in syntax such as `on_power_restore`.

This example chooses **starting from declared initial values without restoring the previous running state**.
After power returns, readiness must be confirmed, and Start must be released and pressed again to run.
`ready` confirms that sensors and devices are ready to start a new run.

```ghost
control RestartAndWait {
  input ready, start, stop: Bool;
  output pump: Bool;
  state armed: Bool = false;
  state running: Bool = false;

  let start_event = armed && start;
  armed' = ready && !stop && !start;
  running' = ready && !stop && (running || start_event);
  pump <- running';
}
```

- At startup, `running` and `armed` are false. Booting with Start held does not automatically run.
- Receive a new start request only after an evaluation where `ready` is true and both Stop and Start are released.
- If `ready` becomes false or `stop` becomes true while running, release operation. A new start request is required even after readiness returns.

If multiple stages such as return or inspection are needed, set the initial enum state to a preparation stage
and transition on device feedback as in [question 19](#q19).
This rule determines output intent after GhostFlow begins evaluation.
The Driver's boot policy determines actual pin/relay states from power-on until the first evaluation.

**Resuming the pre-outage task is a separate policy.** Ordinary operational settings survive restart,
but that alone does not automatically restore operating stages or timers.
To resume, specify which state and times to retain, whether outage time counts as operating time,
and whether current device positions and sensors match the restored state.
This example does not restore such checkpoints.

By default, sensors prepare again from `NotReady` after reboot.
Do not treat an old healthy value as readiness confirmation.
Initial state alone also cannot distinguish power restoration from ordinary restart.
To behave differently only after power restoration, a contract must supply the restart cause through a separate input.

**Why specify a restart policy?** Retained settings, restored task state, and current physical device state
are different facts. Resuming previous operation merely because power returned does not explain the intent.

**Syntax basis**

- `state` initial values, previous/next states, output intent: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `let`, `&&`, `||`, `!`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Preparation/return-stage enums and `case`: [Reference §2.4 Enums and exhaustive branches](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- Sensor reboot and explicit restoration: [Reference §4.2 Sample contracts and sensor processing order](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- Boundaries of setting retention, new executions, and boot outputs: [Reference §5.2 Lifecycles and temporary settings](reference/05-settings-and-observation.md#생명주기와-임시-설정)

<a id="q33"></a>
## 33. Can I replace a temperature sensor without changing the control code? [Changed]

> **Current dev status:** The Number example below remains valid. The statement that dedicated quantity notation is only design scope is outdated. Temperature, TemperatureDelta, and unit literals are now supported. [Current contract](reference/02-types-expressions-state.md#29-물리량과-단위).

**If the same logical input contract is maintained, the control code can stay unchanged.**
The program reads logical roles such as “greenhouse temperature” instead of sensor model names or pin numbers.
Installation bindings connect the actual sensor supplying the value.

This example reads temperature normalized to Celsius.
The input contract of this example specifies that `temperature`'s `Number` value is Celsius.
`Number` itself does not validate temperature units; dedicated physical-quantity notation is within the design scope of Reference §2.9.

```ghost
control TemperatureMonitor {
  sensor temperature: Number;
  output high_temperature, sensor_fault: Bool;

  high_temperature <- case temperature {
    ok(value) => value >= 30.0;
    fault(_) => false;
  };
  sensor_fault <- case temperature {
    ok(_) => false;
    fault(_) => true;
  };
}
```

Replacing sensor A with B preserves this evaluation expression if temperature from the same location is supplied under the same contract.
Sensor errors are distinguished with a separate error output rather than converted to a normal temperature of zero.

| What changes with replacement | Where to handle it |
|---|---|
| Connection address, pin, physical device | Installation binding |
| Communication method, raw-value interpretation, unit conversion | Driver and input supply boundary |
| Comparing logical temperature against 30 degrees | Retain the control expression if the input contract is unchanged |
| Changed measurement target, units, range, sampling period, or quality guarantees | Check contract compatibility and change necessary declarations/rules |

For example, a much slower replacement sensor may fail the existing `stale_after` condition.
Do not call sensors compatible merely because both produce numbers.
Check the replacement sensor's new samples and quality. Do not treat the previous sensor's last healthy value as a measurement from the new sensor.

Preserving control source does not guarantee automatic device discovery or an unchanged Driver.
The new sensor's communication must be supported, and the actual connection and new binding must be verified.
If input is interrupted during replacement, follow the sensor fault handling rules written in the existing program.

**Why separate the logical role and actual sensor?** To reuse the control intent “notify when temperature is high”
without tying it to a manufacturer, communication method, or wiring.

**Syntax basis**

- `sensor`, `ok(value)`, `fault(_)`: [Reference §4.1 sensor and Result quality](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)
- Unit, sample, quality, and recovery contracts: [Reference §4.2 Sample contracts and sensor processing order](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- Distinguishing `Number` from dedicated physical quantities: [Reference §2.1 Value kinds](reference/02-types-expressions-state.md#21-값-종류), [§2.9 Physical quantities and units](reference/02-types-expressions-state.md#29-물리량과-단위)
- `>=` comparison: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Separating logical inputs from installation connections: [Reference §6.3 Parameters, settings, dependencies, and bindings](reference/06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)

<a id="q34"></a>
## 34. Are sensor settings separate from GhostFlow source? Do they change at different intervals?

**Physical sensor connection information is separate from control source and has its own change history.**
However, not all “sensor settings” are external.
Declarations and rules defining how control accepts sensor values belong to GhostFlow source.
The canonical control source here is one `.ghost.md` document.

| Category | Contents | What changes when modified |
|---|---|---|
| GhostFlow source | Logical sensor declarations/types, `sample`, `valid`, `filter`, `stale_after`, `recover_after`, error handling, and control expressions | Source revision; a new Program candidate when execution rules change |
| Installation profile/binding | Connections of logical sensors to actual devices, ports, and addresses; provided capabilities | Installation/profile/binding revision and compatibility validation |
| Operational settings | Overrides of values exposed as `config` in source | Settings revision in the same Program/run |

For example, the logical declaration in [question 33](#q33) remains in source.

```ghost
sensor temperature: Number;
```

Replacing sensor A with B changes the following connection. This is an explanation, not a file format or executable syntax.

```text
Logical sensor temperature → installation binding → actual sensor A
Logical sensor temperature → new binding → actual sensor B
```

If B satisfies the same input contract, control source can remain unchanged.
In contrast, changing the source's `stale_after` declaration from “error if no new measurement for three seconds” to “ten seconds”
changes the control contract itself, so it is a source change.
A field does not automatically become a live operational setting merely because it concerns a sensor.

An operator changing an exposed operating duration from five to ten minutes is another kind of change.
Keep source and Program unchanged and apply only the setting value in the same execution.
This operational setting change path does not change physical bindings or sensor dependencies.

Thus, **change intervals and revisions are separate, but this does not prescribe a storage format of exactly two files**.
Installation information storage, whether files or a database, is separate from the language's `.ghost.md` source contract.
Even when source and bindings change independently, their input contracts must be checked for compatibility when used together.
Do not interpret physical connection changes as immediately applicable during operation like ordinary setting changes.
The installation contract defines the application procedure and revision boundaries for structural changes.

**Why separate lifecycles?** Replacing sensors, changing control rules,
and adjusting operating durations require different validation and change histories.

**Syntax basis**

- Canonical `.ghost.md` document: [Reference §1.1 Why one document is the source](reference/01-source-and-syntax.md#11-왜-문서-하나가-소스인가)
- `sensor` declarations: [Reference §4.1 sensor and Result quality](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)
- Sample/filter/validity rules declared in source: [Reference §4.2 Sample contracts and sensor processing order](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- Logical roles and physical endpoints: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Separate lifecycle for each change: [Reference §6.3 Parameters, settings, dependencies, and bindings](reference/06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)
- Source changes and live setting changes: [Reference §5.2 Source changes and operational setting changes](reference/05-settings-and-observation.md#52-소스-변경과-운영-설정-변경)
- Application boundaries for structural changes and setting changes: [Reference §4.10 Modes and live settings](reference/04-sensors-constraints-control.md#410-mode와-live-settings)

<a id="q35"></a>
## 35. Can I replace a sensor without recompiling the control program, like changing only a printer Driver?

Yes. **If the new sensor satisfies the existing logical input contract, do not recompile the GhostFlow control program.**
This is the same separation as Word using a common printing interface rather than being recompiled for every printer.
The Driver handles sensor-specific communication and data interpretation. Installation bindings connect the sensor to use.

| Analogy | Role in GhostFlow |
|---|---|
| Word document and print request | Control rules and logical inputs/outputs in `.ghost.md` |
| Common printing interface | Logical device contract specifying types, units, quality, and so on |
| Printer selection | Actual device selection in installation bindings |
| Printer Driver | Driver handling device-specific communication and raw-value interpretation |

For example, this **fragment** does not specify the manufacturer or communication method supplying temperature.

```ghost
sensor temperature: Number;
```

If the installation contract defines this value as Celsius temperature, the new Driver supplies values with the same meaning and quality information.
A shared `Number` type alone does not make units or sampling periods compatible.
For a replacement meeting the same contract, retain existing source and the compiled Program, updating only the installation connection.

How Drivers are added or changed is the execution environment's responsibility.
This separation does not imply that Drivers can be dynamically installed on an MCU.
Whether device support requires firmware changes and whether the GhostFlow control program requires recompilation
are separate decisions.

**Why separate them this way?** Handling device-specific differences in Drivers lets the same program run in different installations
without tying control intent to particular hardware.

**Syntax basis**

- `sensor` and healthy-value/error contracts: [Reference §4.1 sensor and Result quality](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)
- Sample/quality information provided by Drivers: [Reference §4.2 Sample contracts and sensor processing order](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- Separating logical ports from physical endpoints: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Bindings changed independently of source: [Reference §6.3 Parameters, settings, dependencies, and bindings](reference/06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)
- Retaining source/Program with compatible replacements: [Reference §6.3 Compatible device replacement and recompilation independence](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)

<a id="q36"></a>
## 36. Should the separation of device replacement and recompilation also be in the language spec?

Yes. Specify it as a rule at the language/device boundary, as well as through usage examples.
The rule is **“replacing a device or Driver that satisfies the same logical device contract does not require control source changes
or Program recompilation.”**

This principle belongs in [§12.1](LANGUAGE.md#121-호환-장치-교체는-제어-프로그램-교체가-아니다) of the language contract
and Reference §6.3. The FAQ explains it through the analogy and example in [question 35](#q35).
It defines logical port, Driver, and binding responsibilities and change boundaries, rather than adding syntax.

**Why:** If this principle appeared only in the FAQ, there would be no criterion for deciding whether program regeneration is appropriate for every device replacement.

**Syntax basis**

- Logical device contracts and physical connections: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Recompilation independence and compatibility conditions: [Reference §6.3 Compatible device replacement and recompilation independence](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)

<a id="q37"></a>
## 37. If I connect a button to another GPIO pin, can I just change the input mapping?

Yes. **If the new pin provides the same button input contract, change only the installation binding
and retain the control source and compiled Program.**
The program reads the logical input `start` instead of a GPIO number.

```ghost
control ButtonRequest {
  input start: Bool;
  output request: Bool;
  request <- start;
}
```

In this example, `start` is contracted to be true when pressed and false when released.
The following describes connections before and after the change; it is not binding-file syntax.

```text
Before: GPIO A → button input Driver → logical input start
After: GPIO B → button input Driver → logical input start
```

Move the button wiring to B and change the actual input connected to `start` to B.
The new pin must be usable as a button input on that board.
Handle physical settings such as LOW/HIGH when pressed and required pull-ups/pull-downs
at the installation/Driver boundary, providing the same true/false meaning to the program.
Do not change logical input names or control expressions to match GPIO numbers.

This differs from a live operational setting changing operating time.
Manage it as a new installation/binding revision and follow the installation contract's application procedure.
No program recompilation does not imply permission to replace wiring during uninterrupted operation.

**Why leave GPIO numbers out of source?** When the button's role remains the same and only the wiring location changes,
there is no reason to change the control intent and program revision too.

**Syntax basis**

- `input start: Bool`, `output`, `<-`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- Separating logical ports from actual pins: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Retaining source/Program with compatible input replacements: [Reference §6.3 Compatible device replacement and recompilation independence](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- Distinguishing physical binding changes from live setting changes: [Reference §4.10 Modes and live settings](reference/04-sensors-constraints-control.md#410-mode와-live-settings)

<a id="q38"></a>
## 38. Can I connect a different relay by changing only the output GPIO mapping?

Yes. **For a relay meeting the same logical output contract, change the output binding
and retain the control source and compiled Program.**
The program uses logical outputs such as `pump` instead of relay GPIO numbers.

```ghost
control PumpRequest {
  input run_request, stop: Bool;
  output pump: Bool;
  pump <- run_request && !stop;
}
```

`pump = true` is a pump run request. It does not directly mean GPIO HIGH.
The following describes connections, rather than binding-file syntax.

```text
Before: logical output pump → output Driver → GPIO A → relay A
After: logical output pump → output Driver → GPIO B → relay B
```

If the new relay turns on at LOW, adjust polarity in Driver/installation settings
to carry out the same run request. Actual output values during boot and faults are also defined at that boundary.
The logical output's `Bool` type alone does not guarantee that the pin supports output, electrical drive conditions,
contact ratings, wiring, and connected loads are compatible.

This example replaces a relay serving the same pump role.
It does not imply that the existing control rules suit different loads or devices with different roles.
Also, a true `pump` does not confirm actual relay-contact or pump operation.
Rules requiring operation confirmation use separate feedback inputs.

Manage output binding changes through installation revisions and application procedures.
The absence of a recompilation requirement does not permit wiring replacement during uninterrupted operation.

**Why separate logical outputs from GPIO?** Control expresses the intent “run the pump,”
and Drivers and installation connections apply it through the electrical signals needed by that relay.

**Syntax basis**

- `input`, `output`, `<-`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- `&&`, `!`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Distinguishing output requests from application and physical confirmation: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- Logical ports and physical endpoints, polarity, and loads: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Retaining source/Program with compatible output replacements: [Reference §6.3 Compatible device replacement and recompilation independence](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- Application boundaries of installation changes: [Reference §4.10 Modes and live settings](reference/04-sensors-constraints-control.md#410-mode와-live-settings)

<a id="q39"></a>
## 39. Can I increase the output count with an expansion board such as Waveshare?

Yes. **Logical outputs can connect to expansion-device channels as well as direct GPIO.**
The Driver handles expansion-device communication and channel control. Bindings connect each logical output to its channel.

```ghost
control TwoRelayRequests {
  input request1, request2: Bool;
  output relay1, relay2: Bool;
  relay1 <- request1;
  relay2 <- request2;
}
```

The following describes installation connections, rather than binding-file syntax.

```text
relay1 → expansion output Driver → expansion board channel 1
relay2 → expansion output Driver → expansion board channel 2
```

For example, the [official Waveshare Modbus RTU Relay 16CH documentation](https://www.waveshare.com/wiki/Modbus_RTU_Relay_16CH)
describes controlling relays through Modbus commands over RS485.
In this case, GhostFlow output bindings connect to device addresses and relay channels instead of direct GPIO numbers.
Do not assume all boards share a communication method merely because the manufacturer is Waveshare.

**Distinguish simple multiplexers from independent output expansion.**
For example, [TI CD74HC4067](https://www.ti.com/product/CD74HC4067) selects a channel to connect to a common signal.
By itself, it is not an output device retaining each of several relays' ON/OFF states.
Independent sustained outputs require an expansion device/circuit that retains each channel's state and a corresponding Driver contract.

Moving existing logical outputs to compatible expansion channels does not require control source changes or recompilation.
However, adding logical outputs and control behavior for new devices is a program change.
The Driver must meet the required channel count, update time, output retention, and communication-failure behavior.
Calculating several outputs in one tick alone does not mean physical relays switch simultaneously.

**Why put expansion methods in the Driver?** So connecting the same control intent to direct GPIO, an expansion chip, or communication-controlled relays
does not require adding bus commands and channel addresses to control code each time.

**Syntax basis**

- Multiple `input`, `output` declarations and `<-`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- Physical endpoints including expansion-device channels: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Compatible binding changes and Program retention: [Reference §6.3 Compatible device replacement and recompilation independence](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- Distinguishing logical commitment from actual output simultaneity: [Reference §2.8 Ticks and state snapshots](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q40"></a>
## 40. Can I also map the inputs and outputs of an RS485 I/O expansion board?

Yes. **Connect each input/output channel of the board to a GhostFlow logical port.**
The Driver reads inputs and sends output commands according to that board's communication protocol.
Do not place RS485 addresses or communication commands in control source.

This is an explanatory example of installation mapping. It is neither executable syntax nor a communication frame format.

```text
Board address 1, DI channel 1 → input Driver → logical input start
Board address 1, DI channel 2 → input Driver → logical input stop
Logical output pump → output Driver → board address 1, DO channel 3
```

The control program using these connections is the same as with direct GPIO.

```ghost
control RemoteIoRequest {
  input start, stop: Bool;
  output pump: Bool;
  pump <- start && !stop;
}
```

This rule outputs while the start input is true. Follow [question 3](#q03) for self-holding behavior.
Manage addresses, channels, communication speed, and frame settings at the installation/Driver boundary.
An RS485 connection alone does not imply identical communication commands.
For example, a Modbus RTU board requires handling that protocol and the board's register/channel definitions.

Input update intervals, validity, and communication failure handling must satisfy the existing logical input contract.
The two Bool inputs in the code do not automatically detect communication failures.
If control must distinguish healthy and faulty measurement inputs, use the `sensor` contract in [question 33](#q33).
Distinguish output command transmission or responses from confirmation of actual contact/equipment operation too.

When moving existing inputs/outputs to compatible RS485 channels, change bindings
and retain control source and the compiled Program. Adding new logical ports or control behavior is a source change.

**Why put communication addresses outside control code?** To use the same start/stop/pump rules
unchanged for both local GPIO and communication-based I/O.

**Syntax basis**

- `input`, `output`, `<-`: [Reference §1.4 Syntax notation](reference/01-source-and-syntax.md#14-문법-표기법)
- `&&`, `!`: [Reference §2.6 Expressions and operators](reference/02-types-expressions-state.md#26-표현식과-연산자)
- Connecting communication-device channels and logical ports: [Reference §6.2 Definitions, instances, and logical ports](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- Retaining source/Program with compatible channel changes: [Reference §6.3 Compatible device replacement and recompilation independence](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- Input sample, quality, and timing contracts: [Reference §4.2 Sample contracts and sensor processing order](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- Output application and actual operation confirmation: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)

<a id="q41"></a>
## 41. How do I check or compile a document with the compiler CLI?

Use the Node.js-based `ghostc` CLI. Node.js 22 or later is required.
Run these commands from the `ghostflow-language` repository root.

```sh
# 산출물을 저장하지 않고 검사
npm run compile -- --check examples/scheduled-watering.ghost.md

# 컴파일하여 산출물 저장
npm run compile -- examples/scheduled-watering.ghost.md build/scheduled-watering.gfb
```

For direct execution, pass the same arguments after `node tools/ghostc.mjs`.
Input is a complete `.ghost.md` document including explanations. Do not extract and pass code blocks separately.
`--check` compiles and checks source but does not write artifacts.
This check does not replace program execution or confirmation of actual sensor/relay behavior.

LLM calls use a TOON request file in the following versioned format. Requests point to the document path
and immutable document/revision IDs. Do not copy code bodies into requests.

```toon
format: GhostFlow/cli-request-v1
operation: check
source:
  path: examples/authoring/pump-rev-2.ghost.md
  documentId: GF-EXAMPLE-PUMP
  revisionId: rev-2
```

The document above contains intent anchors connected to outputs and constraints. Save the TOON content in
`build/request.toon` when running it. Compile requests add `operation: compile` and
`artifactPath`. Results default to TOON;
`--format json` emits the same result as JSON. Compilation errors return exit code 1
and diagnostics with original source locations. Invalid requests return exit code 2 and a `GF_CLI` error.

```sh
node tools/ghostc.mjs --request build/request.toon
node tools/ghostc.mjs --request build/request.toon --format json
```

**Why pass the entire document?** To process execution rules, authoring intent, and source locations as the same canonical revision.

**Syntax basis**

- Canonical `.ghost.md` and execution blocks: [Reference §1.1 Why one document is the source](reference/01-source-and-syntax.md#11-왜-문서-하나가-소스인가)
- Responsibilities of the compiler, execution environment, and Driver: [Reference §8.2 Responsibilities by layer](reference/08-language-runtime-and-device-boundaries.md#82-계층별-책임)
- CLI arguments and execution entry points: [ghostc CLI](../tools/ghostc.mjs), [npm commands and required Node.js version](../package.json)

## When adding a FAQ

Phrase questions as “How do I write this behavior?” rather than “What is this construct?”
Answers include input meanings, code, state/time boundary behavior, and reasons for the implementation.
Always end each answer with **Syntax basis**. List the syntax used,
and attach **Reference chapter/section numbers, section titles, and direct links to those sections** to each item.
Link all syntax beyond common declarations too, and provide example-file links as additional reading.
Distinguish fragments, independent programs, and design notation. Do not silently create new language rules in the FAQ.
