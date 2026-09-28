<!-- translation-source: examples/curriculum/pc-04-direction-interlock.ghost.md -->
[Korean original](pc-04-direction-interlock.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-04 — Forward/reverse direction-change interlock

<!-- ghostflow:anchor id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: A learning scenario based on the forward/reverse stage of
> the user's PLC-replacement curriculum. This document is not a direct user quote.

This is the sole canonical literate executable source for PC-04. It preserves
and references the existing lesson
[E06 DirectionInterlock](../../docs/ProgrammingInGhostflow.md#e06--두-방향을-동시에-요청하면).
E06 demonstrates a small safety constraint that blocks simultaneous output
requests. This lesson adds a fresh-start event, stopped state, and direction-change wait.

`forward_start` and `reverse_start` are momentary inputs that remain true while
pressed. `stop_ok` and `overload_ok` are normalized inputs that are true when
the stop path and overload protection respectively permit operation. Outputs
are logical commands to the forward/reverse contactor coils, not evidence of
actual motor rotation.

```ghost
control DirectionChangeInterlock {
  input forward_start, reverse_start, stop_ok, overload_ok: Bool;
  output forward_contactor, reverse_contactor: Bool;

  let reversal_wait = 2s;

  type Phase = Stopped | Forward | Reverse | WaitForward | WaitReverse;
  // ghostflow:link id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 relation=implements
  state phase: Phase = Stopped;
  // ghostflow:link id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 relation=implements
  state start_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 relation=implements
  timer age = elapsed(phase);

  let permit = stop_ok && overload_ok;
  let ambiguous = forward_start && reverse_start;
  let forward_event = start_armed && forward_start && !reverse_start;
  let reverse_event = start_armed && reverse_start && !forward_start;

  start_armed' = permit && !forward_start && !reverse_start;

  phase' = case phase {
    Stopped =>
      if !permit || ambiguous then Stopped
      else if forward_event then Forward
      else if reverse_event then Reverse
      else Stopped;

    Forward =>
      if !permit || ambiguous then Stopped
      else if reverse_event then WaitReverse
      else Forward;

    Reverse =>
      if !permit || ambiguous then Stopped
      else if forward_event then WaitForward
      else Reverse;

    WaitForward =>
      if !permit || ambiguous then Stopped
      else if reverse_event then WaitReverse
      else if age >= reversal_wait then Forward
      else WaitForward;

    WaitReverse =>
      if !permit || ambiguous then Stopped
      else if forward_event then WaitForward
      else if age >= reversal_wait then Reverse
      else WaitReverse;
  };

  forward_contactor <- phase' == Forward;
  reverse_contactor <- phase' == Reverse;
  mutex(forward_contactor, reverse_contactor);
}
```

During normal operation, a new press in the opposite direction enters
`WaitForward` or `WaitReverse`. Since `phase'` becomes a wait state in that
transition, both contactor commands turn off immediately in that tick. The
opposite direction is commanded only after two seconds of waiting. Continuing
to hold the same direction button is not a new direction-change event. Pressing
both buttons together or losing stop/overload permission cancels the wait into
`Stopped`. If the operator presses the opposite button during the wait and
changes the target direction again, the control enters the corresponding Wait
state and restarts the full two-second delay. It cannot later start toward the
old target.

`mutex` is a software safety backstop. The actual installation also needs
electrical and mechanical interlocks between the forward/reverse contactors.
The two-second wait does not prove that the motor has stopped, and this learning
example has no zero-speed feedback input. A checker PASS therefore means only
that the virtual/compiler/WASM trace for contactor coil commands matches; it is
not physical acceptance of contact closure, power application, or motor rotation.

`tools/check-pc-04.mjs` creates a fresh WASM runtime for each case and does not
rebuild the existing WASM artifact. It uses actual compiler/WASM traces to check
simultaneous-request blocking and rearming, normal latching, both outputs OFF
immediately after a direction change, the 1999 ms wait, the opposite direction
ON at exactly 2000 ms, stop/overload cancellation during the wait, and target
changes during the wait with the delay restarted.
