<!-- translation-source: examples/curriculum/pc-09-sequential-water-supply.ghost.md -->
[Korean original](pc-09-sequential-water-supply.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-09 — Sequential valve and pump water supply

<!-- ghostflow:anchor id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Confirm the valve is open before running the pump. When
> watering time ends, stop the pump first and then close the valve. Represent
> output commands separately from the device's physical position.

The linked original is the sole canonical literate executable source for PC-09. It preserves
and compares [tutorial/02 time-based sequencing](../tutorial/02-watering.ghost.md)
and [tutorial/04 shared pump](../tutorial/04-extra-valves.ghost.md). Tutorial/02
is a basic example that sequences stages by time alone; tutorial/04 covers the
separate arbitration problem when multiple controls share one pump. This lesson
replaces neither. It adds valve feedback and pump-first stopping to one watering sequence.

## Intent and normalization

An operator might say, “Open the valve when watering starts. After confirming it
is open, run the pump for five minutes. Stop the pump first, then close the
valve.” GhostFlow normalizes that intent as follows.

- `start_request` is a momentary new watering request. Accept it only after a closed position is confirmed and a stable scan observes the request released.
- `open_limit` and `close_limit` are device-position observations. An energized contactor output alone does not mean the valve actually moved.
- After the valve opens, its open feedback must remain true for `settle_delay` before starting the pump. Run the pump for `watering_time`.
- At the scan where watering time expires, turn off the pump. The next logical scan is `PumpStopping` with all outputs off; close the valve starting on the following scan.
- If `stop_ok` or `overload_ok` is lost, enter `Interrupted` immediately. If both limits are true, `FeedbackFault` takes priority. Turn off all outputs. Restoring conditions alone does not restart.

## GhostFlow source

This explicit input revision consumes producer quality, not physical button diagnostics. Good(false) remains a normal observation. Unknown requests cannot establish a new request or released request, and unknown limits cannot establish a position or conflict. The existing watering deadline still stops the pump. In PumpStopping, unavailable limits defer closure with all outputs off. In Closing, unavailable limits retain Closing and inhibit its close command; restored healthy closed feedback finishes in Idle, while other healthy nonconflicting feedback permits closure to resume. This lesson adds no opening or closing timeout. Existing protection permission requires confirmed Good(true). No new START input or global restart policy is added.

```ghost
// Source revision: issue531-producer-quality-pc09-v1
control SequentialWaterSupply {
  input start_request, open_limit, close_limit, stop_ok, overload_ok: Bool;
  output valve_open_contactor, valve_close_contactor, pump_contactor: Bool;

  let start_request_true = case start_request { ok(value) => value; fault(_) => false; };
  let start_request_false = case start_request { ok(value) => !value; fault(_) => false; };
  let open_limit_true = case open_limit { ok(value) => value; fault(_) => false; };
  let open_limit_false = case open_limit { ok(value) => !value; fault(_) => false; };
  let close_limit_true = case close_limit { ok(value) => value; fault(_) => false; };
  let close_limit_false = case close_limit { ok(value) => !value; fault(_) => false; };
  let stop_ok_true = case stop_ok { ok(value) => value; fault(_) => false; };
  let stop_ok_false = case stop_ok { ok(value) => !value; fault(_) => false; };
  let overload_ok_true = case overload_ok { ok(value) => value; fault(_) => false; };
  let overload_ok_false = case overload_ok { ok(value) => !value; fault(_) => false; };
  let limits_good = case open_limit { ok(_) => case close_limit { ok(_) => true; fault(_) => false; }; fault(_) => false; };

  let settle_delay = 2s;
  let watering_time = 5min;

  type Phase = Idle | Opening | Settling | Watering | PumpStopping | Closing | FeedbackFault | Interrupted;
  // ghostflow:link id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 relation=implements
  state request_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 relation=implements
  timer age = elapsed(phase);

  let permit = stop_ok_true && overload_ok_true;
  let conflict = open_limit_true && close_limit_true;
  let known_closed = close_limit_true && open_limit_false;
  let start_event = request_armed && start_request_true;

  request_armed' = phase == Idle && permit && !conflict && known_closed && start_request_false;

  phase' = case phase {
    Idle =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if start_event && known_closed then Opening
      else Idle;

    Opening =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if open_limit_true && close_limit_false then Settling
      else Opening;

    Settling =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if limits_good && (open_limit_false || close_limit_true) then FeedbackFault
      else if limits_good && age >= settle_delay then Watering
      else Settling;

    Watering =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if limits_good && (open_limit_false || close_limit_true) then FeedbackFault
      else if age >= watering_time then PumpStopping
      else Watering;

    PumpStopping =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if limits_good && (open_limit_false || close_limit_true) then FeedbackFault
      else if limits_good then Closing
      else PumpStopping;

    Closing =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if close_limit_true && open_limit_false then Idle
      else Closing;

    FeedbackFault =>
      if conflict || !permit then FeedbackFault
      else if start_request_false && known_closed then Idle
      else FeedbackFault;

    Interrupted =>
      if conflict || !permit then Interrupted
      else if start_request_false && known_closed then Idle
      else Interrupted;
  };

  valve_open_contactor <- phase' == Opening;
  valve_close_contactor <- phase' == Closing && limits_good;
  pump_contactor <- phase' == Watering;
  mutex(valve_open_contactor, valve_close_contactor);
}
```

`Opening`, `Settling`, `Watering`, `PumpStopping`, and `Closing` are logical
phases. `valve_open_contactor` and `valve_close_contactor` are commands to their
contactors; `open_limit` and `close_limit` indicate observed physical position.
Thus, remaining in `Opening` for a long time means “the open command is still
requested” and “open completion has not been confirmed.” It does not guarantee
the valve actually moved.

In tutorial/02's time-only sequence, time advances the next phase. PC-09's pump
start also requires open-position feedback and a settling interval. Tutorial/04's
shared-pump example addresses the separate need for global arbitration when
multiple controls request the same output resource. This lesson's
`pump_contactor` belongs to one sequential control and does not claim to solve
resource arbitration with other controls.

If feedback never arrives, this lesson remains in `Opening` or `Closing`.
Timeout, fault latching, alarm, reset, and a safe valve-closing policy after a
fault are covered by PC-10. `mutex` and logical outputs do not replace hardware
interlocks, emergency stop, or overload protection.

## 검증 경계

`tools/check-pc-09.mjs` creates a fresh WASM `ControlRuntime` for each scenario
and does not rebuild the existing WASM artifact. It checks `stateBefore`,
`stateAfter`, `requested`, `safe`, and nondecreasing `nowMs`. PASS means the
compiler/WASM virtual trace matches expectations; it is not physical evidence
of contactor closure, valve movement, pump rotation, or water flow.
