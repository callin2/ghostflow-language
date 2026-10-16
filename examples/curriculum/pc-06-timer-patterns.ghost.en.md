<!-- translation-source: examples/curriculum/pc-06-timer-patterns.ghost.md -->
[Korean original](pc-06-timer-patterns.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-06 — Maintained requests and independent timer patterns

<!-- ghostflow:anchor id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Learn how to combine delayed ON, delayed OFF, and maximum
> run time in one control cabinet. This example distinguishes maintained demand,
> which stays true across scans, from a momentary START event triggered by a press.

The linked original is the sole canonical literate executable source for PC-06. It preserves
and references lesson [E08 DelayedStart](../../docs/ProgrammingInGhostflow.md#e08--입력이-2초-유지되면-켜기)
and [tutorial/02-watering](../tutorial/02-watering.ghost.md). E08 introduces a
state and `elapsed(phase)`; the tutorial shows a watering sequence. This lesson
extends those ideas to three independent demand channels.

`on_delay_request`, `off_delay_request`, and `limited_request` are maintained
demands, not momentary START events. Each demand remains present while its input
is true. If `stop_ok` becomes false, all three channels immediately return to a
safe idle state. `on_delay` and `off_delay` set each channel's delay; `max_run`
is the LIMIT channel's hard maximum run time. This example guarantees neither
physical safety devices nor actual load behavior.

This explicit input revision consumes producer quality, not physical button diagnostics. Good(false) remains a normal observation. Unknown request/position/mode observations do not establish a new request, released request, position, or mode; existing state is retained where no observation justifies a transition. Existing protection permission requires a confirmed Good(true), and existing hard time limits remain effective. No new START input or global restart policy is added.

```ghost
// Source revision: issue531-producer-quality-pc06-v1
control TimerPatterns {
  input on_delay_request, off_delay_request, limited_request, stop_ok: Bool;
  output on_delayed, off_delayed, limited_run: Bool;

  let on_delay_request_true = case on_delay_request { ok(value) => value; fault(_) => false; };
  let on_delay_request_false = case on_delay_request { ok(value) => !value; fault(_) => false; };
  let off_delay_request_true = case off_delay_request { ok(value) => value; fault(_) => false; };
  let off_delay_request_false = case off_delay_request { ok(value) => !value; fault(_) => false; };
  let limited_request_true = case limited_request { ok(value) => value; fault(_) => false; };
  let limited_request_false = case limited_request { ok(value) => !value; fault(_) => false; };
  let stop_ok_true = case stop_ok { ok(value) => value; fault(_) => false; };
  let stop_ok_false = case stop_ok { ok(value) => !value; fault(_) => false; };

  let on_delay = 2s;
  let off_delay = 3s;
  let max_run = 10s;

  type OnPhase = OnIdle | OnWaiting | OnActive;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  state on_phase: OnPhase = OnIdle;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  timer on_age = elapsed(on_phase);

  type OffPhase = OffIdle | OffActive | OffHolding;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  state off_phase: OffPhase = OffIdle;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  timer off_age = elapsed(off_phase);

  type LimitPhase = LimitIdle | LimitRunning | LimitReached;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  state limit_phase: LimitPhase = LimitIdle;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  timer limit_age = elapsed(limit_phase);

  on_phase' = case on_phase {
    OnIdle => if stop_ok_true && on_delay_request_true then OnWaiting else OnIdle;
    OnWaiting =>
      if !stop_ok_true || on_delay_request_false then OnIdle
      else if on_delay_request_true && on_age >= on_delay then OnActive
      else OnWaiting;
    OnActive => if !stop_ok_true || on_delay_request_false then OnIdle else OnActive;
  };

  off_phase' = case off_phase {
    OffIdle => if stop_ok_true && off_delay_request_true then OffActive else OffIdle;
    OffActive =>
      if !stop_ok_true then OffIdle
      else if off_delay_request_false then OffHolding
      else OffActive;
    OffHolding =>
      if !stop_ok_true then OffIdle
      else if off_delay_request_true then OffActive
      else if off_age >= off_delay then OffIdle
      else OffHolding;
  };

  limit_phase' = case limit_phase {
    LimitIdle => if stop_ok_true && limited_request_true then LimitRunning else LimitIdle;
    LimitRunning =>
      if !stop_ok_true || limited_request_false then LimitIdle
      else if limit_age >= max_run then LimitReached
      else LimitRunning;
    LimitReached =>
      if !stop_ok_true || limited_request_false then LimitIdle
      else LimitReached;
  };

  on_delayed <- on_phase' == OnActive;
  off_delayed <- off_phase' == OffActive || off_phase' == OffHolding;
  limited_run <- limit_phase' == LimitRunning;
}
```

Each state and timer is independent. Thus, while the OFF-delay channel waits
three seconds after its demand is released, LIMIT's ten-second maximum is still
measured by its own `limit_age`. Once LIMIT reaches `LimitReached`, it does not
return automatically to `LimitRunning` while demand remains true. The demand
must be released and requested again to start a new run. Outputs are derived
from the computed next state, so they reflect a transition in the same tick.

The checker runs the same logical timestamps and input tape under two wall-clock
pacing labels, x1 and x1000. It does not actually wait or change VM inputs, and
the results must match. This comparison shows that the control logic depends on
logical `nowMs`, not on an accelerated Web-host implementation.
