<!-- translation-source: examples/curriculum/pc-08-manual-auto.ghost.md -->
[Korean original](pc-08-manual-auto.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-08 — Manual/automatic modes and common permission

<!-- ghostflow:anchor id=GF-INT-PC08-MANUAL-AUTO-REARM-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Select manual or automatic operation for one pump and
> handle stop/overload permissions common to both modes. Require a fresh run
> request so a mode change or permission recovery cannot silently restart equipment.

This is the sole canonical literate executable source for PC-08. It combines
the [PC-03 manual start/latching](./pc-03-motor-contactor.ghost.md) and
[PC-07 automatic demand](./pc-07-tank-hysteresis.ghost.md) examples without
replacing them. The existing [station mode rules](../station-rules.ghost.md)
and [shared pump example](../tutorial/04-extra-valves.ghost.md) are preserved
for their distinct advanced topic of multi-control arbitration.

## Intent and normalization

An operator might say, “Run the pump when I turn it on manually or when there is
automatic demand. Stop immediately if stop or overload permission is lost, and
do not restart automatically when permission returns.” This document normalizes
that intent as follows.

- `manual_mode_request` and `auto_mode_request` are maintained mode-selection inputs.
- If both are false, mode is `Off`; if one is true, that mode is selected; if both are true, mode is `ModeConflict`. Outputs are always off during a conflict.
- `manual_start` is a momentary manual-start event. Once accepted, it keeps `Running` in Manual mode. Holding the input does not reuse it as a restart event after permission recovers.
- `auto_demand` is maintained automatic demand, but it can start only after stable Auto mode first observes it false to rearm, then observes it newly true.
- `stop_ok` and `overload_ok` are common permissions for both modes. If either is false, stop immediately; restoring permission alone does not restart.

`Mode` and `RunPhase` are logical states. `pump_contactor` is a logical coil
command reflecting the next scan's state. Actual contactor closure, main-circuit
voltage, and pump rotation are outside this example's evidence. The installation
requires independent hardware protection such as emergency stop, thermal
overload relay, and electrical interlocks.

## GhostFlow source

```ghost
control ManualAutoPump {
  input manual_mode_request, auto_mode_request, manual_start, auto_demand, stop_ok, overload_ok: Bool;
  output pump_contactor: Bool;

  type Mode = Off | Manual | Auto | ModeConflict;
  // ghostflow:link id=GF-INT-PC08-MANUAL-AUTO-REARM-V1 relation=implements
  state mode: Mode = Off;

  type RunPhase = Stopped | Running;
  // ghostflow:link id=GF-INT-PC08-MANUAL-AUTO-REARM-V1 relation=implements
  state run_phase: RunPhase = Stopped;
  // ghostflow:link id=GF-INT-PC08-MANUAL-AUTO-REARM-V1 relation=implements
  state request_armed: Bool = false;

  let permit = stop_ok && overload_ok;
  let requested_mode = if manual_mode_request && auto_mode_request then ModeConflict
    else if manual_mode_request then Manual
    else if auto_mode_request then Auto
    else Off;
  let mode_changed = requested_mode != mode;
  let selected_request = if requested_mode == Manual then manual_start
    else if requested_mode == Auto then auto_demand
    else false;
  let request_event = request_armed && selected_request;

  mode' = requested_mode;

  request_armed' = if mode_changed || !permit || requested_mode == Off || requested_mode == ModeConflict then false
    else if !selected_request then true
    else false;

  run_phase' = case run_phase {
    Stopped =>
      if mode_changed || requested_mode == Off || requested_mode == ModeConflict || !permit then Stopped
      else if request_event then Running
      else Stopped;

    Running =>
      if mode_changed || requested_mode == Off || requested_mode == ModeConflict || !permit then Stopped
      else if requested_mode == Auto && !auto_demand then Stopped
      else Running;
  };

  pump_contactor <- run_phase' == Running;
}
```

On a scan where mode selection changes, `run_phase'` must become `Stopped`
even though `mode'` records the new mode. An `auto_demand` already held when
entering Auto does not start on that scan. It starts only after Auto observes it
false once, sets `request_armed`, and then sees it true again. The same
`request_armed` logic detects a fresh Manual START event, so a START held through
loss and restoration of permission is not treated as a restart. If demand
disappears during Auto operation, stop on that scan and prepare for the next
fresh demand.

## Comparison with relays and PLCs

Relay/PLC logic may repeat mode-selection contacts, START latching contacts, and
the common stop/overload NC path across several rungs. GhostFlow represents
`mode` and `run_phase` as separate states and shares the common `permit` before
every operating path. This makes it possible to trace “why did the pump turn on
in this mode?” through mode selection → fresh-start event/rearming → common
permission → next state → coil connection.

This lesson covers only modes and common permission. Timers, sequential valves,
resource conflicts between equipment, timeout/fault latching, UI, firmware
export, and physical-output guarantees belong to later tasks and are not added
implicitly to this source.

## Verification boundary

`tools/check-pc-08.mjs` creates a fresh WASM `ControlRuntime` for each scenario
and uses the same existing compiler, literate extractor, adapter, and WASM
artifact. It checks `stateBefore`, `stateAfter`, `requested`, `safe`, and
nondecreasing `nowMs`, then prints hashes for the expected records and relevant
executables. A checker PASS means the virtual/compiler/WASM logical trace
matches; it does not mean an actual relay or pump operated.
