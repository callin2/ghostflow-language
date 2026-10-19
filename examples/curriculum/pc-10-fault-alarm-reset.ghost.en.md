<!-- translation-source: examples/curriculum/pc-10-fault-alarm-reset.ghost.md -->
[Korean original](pc-10-fault-alarm-reset.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-10 — Sequential water supply with fault, alarm, and reset

<!-- ghostflow:anchor id=GF-INT-PC10-FAULT-ALARM-RESET-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Open and confirm the valve before running the pump. A
> normal STOP halts without fault. An emergency-stop observation, overload,
> sensor conflict, lost feedback, unavailable drive, or movement timeout latches
> its cause and stops safely. Low source water is a special case: only with the
> valve confirmed open may the pump stop first and the valve then close.

The linked original is the sole canonical literate executable source for PC-10. PC-09
[sequential valve/pump water supply](pc-09-sequential-water-supply.ghost.md)
preserves the normal sequence and feedback; [PC-05 limit feedback](pc-05-limit-feedback.ghost.md)
preserves valve-position observations. This lesson replaces neither. It adds
timeout, fault-cause latching, alarm, and reset semantics.

## Learning I/O and the first control-cabinet budget

This example is **not a wiring diagram or firmware contract that can be mapped
one-to-one onto an initial 8DI device.** It is a standalone learning interface
that separates semantic inputs so the reader can follow the control intent.

```text
Inputs (9 Bool)
  start_request, reset_request, stop_ok, emergency_stop_ok, overload_ok,
  source_water_ok, valve_drive_ok, open_limit, close_limit

Outputs (4 Bool)
  valve_open_contactor, valve_close_contactor, pump_contactor, alarm
```

The common semantic budget for a complete watering control cabinet has **eight**
existing signals: `START`, `STOP`, `MODE`, tank low, tank high, open limit,
close limit, and overload. It needs **three** more for `RESET`, an E-stop status
observation, and source-water-low. Separating `valve_drive_ok` makes **12
meanings** total. This example's nine inputs represent the meanings PC-10 needs
for its safety behavior. `MODE` and tank upper/lower limits are separate PC-08/
PC-07 concerns and are not falsely combined here.

The actual installation must choose one of the following; the choice has not
yet been decided for any particular installation.

- Aggregate several causes through an external safety chain. Without separate observations, GhostFlow cannot explain each cause individually.
- Represent START/MODE/RESET as authenticated host commands while retaining STOP and the physical safety circuit as wired signals.
- Expand the DI set to observe each cause directly.

The E-stop is an **external hardwired safety chain** that removes energy.
`emergency_stop_ok` is an observation input describing its state. GhostFlow
outputs or the alarm do not guarantee that contactor energy is removed.

## Intent and settled safety rules

- Normal `stop_ok == false` is not a fault. Return to `Idle` immediately with every MCU motion output off and alarm off. Require the closed position to be externally confirmed, then require START to be released and pressed again. Never restart automatically.
- `FaultCause` latches the first cause. If several causes occur in one scan, choose in this order: `EmergencyStop > Overload > ValveDriveUnavailable > SensorConflict > FeedbackLost > OpenTimeout/CloseTimeout > LowSourceWater`. Later changes to live inputs do not change the latched cause, but the current condition preventing closure can be observed separately in the trace.
- The `Opening` and `Closing` timeouts are 10 seconds. If the target limit is observed on the scan at exactly 10 seconds, the limit takes precedence over timeout. Do not skip multiple states in one scan.
- Only `LowSourceWater` permits a conditional orderly close. If the open position is already confirmed and STOP/E-stop/overload/valve-drive/sensor conditions permit closure, first turn off all motion outputs for one logical scan in `FaultPumpStopping`, then command closure only in `FaultClosing`. Otherwise enter all-off `Faulted` immediately. `FaultClosing` ends on close-limit feedback, timeout, or motion inhibition while retaining the original fault cause.
- Reset is allowed only when the latched cause and all current fault conditions are clear and `known_closed` is true. Once those conditions hold, RESET must be released and pressed again. Holding RESET while conditions clear does not reset. Reset returns only to `Idle`/OFF; it does not replace START.

## GhostFlow source

This explicit input revision consumes producer quality, not physical button diagnostics. Good(false) remains a normal observation. Unknown motion permission or position observations authorize no motion, conditional fault closure, reset, or request rearming. An existing fault cause remains latched; without one, the existing Idle/OFF path is used. Only known observations establish the physical-condition cause labels, while an unconfirmed target at the existing hard deadline can still establish OpenTimeout or CloseTimeout. No new START input or global restart policy is added.

```ghost
// Source revision: issue531-producer-quality-pc10-v1
control FaultAlarmResetWaterSupply {
  input start_request, reset_request, stop_ok, emergency_stop_ok, overload_ok,
    source_water_ok, valve_drive_ok, open_limit, close_limit: Bool;
  output valve_open_contactor, valve_close_contactor, pump_contactor, alarm: Bool;

  let start_request_true = start_request |> recover(false);
  let start_request_false = !(start_request |> recover(true));
  let reset_request_true = reset_request |> recover(false);
  let reset_request_false = !(reset_request |> recover(true));
  let stop_ok_true = stop_ok |> recover(false);
  let stop_ok_false = !(stop_ok |> recover(true));
  let emergency_stop_ok_true = emergency_stop_ok |> recover(false);
  let emergency_stop_ok_false = !(emergency_stop_ok |> recover(true));
  let overload_ok_true = overload_ok |> recover(false);
  let overload_ok_false = !(overload_ok |> recover(true));
  let source_water_ok_true = source_water_ok |> recover(false);
  let source_water_ok_false = !(source_water_ok |> recover(true));
  let valve_drive_ok_true = valve_drive_ok |> recover(false);
  let valve_drive_ok_false = !(valve_drive_ok |> recover(true));
  let open_limit_true = open_limit |> recover(false);
  let open_limit_false = !(open_limit |> recover(true));
  let close_limit_true = close_limit |> recover(false);
  let close_limit_false = !(close_limit |> recover(true));
  let stop_ok_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let emergency_stop_ok_good = case emergency_stop_ok { ok(_) => true; fault(_) => false; };
  let overload_ok_good = case overload_ok { ok(_) => true; fault(_) => false; };
  let source_water_ok_good = case source_water_ok { ok(_) => true; fault(_) => false; };
  let valve_drive_ok_good = case valve_drive_ok { ok(_) => true; fault(_) => false; };
  let open_limit_good = case open_limit { ok(_) => true; fault(_) => false; };
  let close_limit_good = case close_limit { ok(_) => true; fault(_) => false; };
  let motion_observations_good = stop_ok_good && emergency_stop_ok_good && overload_ok_good && source_water_ok_good && valve_drive_ok_good && open_limit_good && close_limit_good;

  let settle_delay = 2s;
  let watering_time = 5min;
  let opening_timeout = 10s;
  let closing_timeout = 10s;

  type Phase = Idle | Opening | Settling | Watering | PumpStopping | Closing |
    FaultPumpStopping | FaultClosing | Faulted;
  type FaultCause = None | EmergencyStop | Overload | LowSourceWater |
    ValveDriveUnavailable | SensorConflict | FeedbackLost | OpenTimeout | CloseTimeout;

  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state fault_cause: FaultCause = None;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state request_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state reset_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  timer age = elapsed(phase);

  let normal_permit = stop_ok_true && emergency_stop_ok_true && overload_ok_true && source_water_ok_true && valve_drive_ok_true;
  let fault_motion_permit = stop_ok_true && emergency_stop_ok_true && overload_ok_true && valve_drive_ok_true;
  let conflict = open_limit_true && close_limit_true;
  let known_closed = close_limit_true && open_limit_false;
  let known_open = open_limit_true && close_limit_false;
  let start_event = request_armed && start_request_true;
  let reset_event = reset_armed && reset_request_true;
  let fault_cleared = case fault_cause {
    None => true;
    EmergencyStop => emergency_stop_ok_true;
    Overload => overload_ok_true;
    LowSourceWater => source_water_ok_true;
    ValveDriveUnavailable => valve_drive_ok_true;
    SensorConflict => !conflict;
    FeedbackLost => known_closed;
    OpenTimeout => known_closed;
    CloseTimeout => known_closed;
  };
  let fault_free_now = emergency_stop_ok_true && overload_ok_true && source_water_ok_true &&
    valve_drive_ok_true && !conflict;
  // Every FaultCause-specific clear condition is implied by fault_free_now and known_closed.
  let reset_allowed = stop_ok_good && fault_cause != None && fault_free_now && known_closed;
  let immediate_cause =
    if emergency_stop_ok_false then EmergencyStop
    else if overload_ok_false then Overload
    else if valve_drive_ok_false then ValveDriveUnavailable
    else if conflict then SensorConflict
    else if phase in {Settling, Watering, PumpStopping} && open_limit_good && close_limit_good && !known_open then FeedbackLost
    else if phase == Opening && !open_limit_true && age >= opening_timeout then OpenTimeout
    else if phase == Closing && !close_limit_true && age >= closing_timeout then CloseTimeout
    else if source_water_ok_false && phase in {Idle, Opening, Settling, Watering, PumpStopping} then LowSourceWater
    else None;

  let any_immediate_cause = emergency_stop_ok_false || overload_ok_false || valve_drive_ok_false || conflict ||
    (phase in {Settling, Watering, PumpStopping} && open_limit_good && close_limit_good && !known_open) ||
    (phase == Opening && !open_limit_true && age >= opening_timeout) ||
    (phase == Closing && !close_limit_true && age >= closing_timeout) ||
    (source_water_ok_false && phase in {Idle, Opening, Settling, Watering, PumpStopping});

  request_armed' = phase == Idle && fault_cause == None && normal_permit && !conflict && known_closed && start_request_false;
  reset_armed' = phase == Faulted && reset_allowed && reset_request_false;
  fault_cause' =
    if phase == Faulted && reset_event && reset_allowed then None
    else if fault_cause != None then fault_cause
    else immediate_cause;

  phase' = if source_water_ok_false && phase in {Settling, Watering, PumpStopping} && known_open && fault_motion_permit then FaultPumpStopping
    else if any_immediate_cause then Faulted
    else if !motion_observations_good then if fault_cause != None then Faulted else Idle
    else if phase in {Idle, Opening, Settling, Watering, PumpStopping, Closing} && stop_ok_false then Idle
    else case phase {
    Idle =>
      if start_event && known_closed then Opening
      else Idle;

    Opening =>
      if known_open then Settling
      else Opening;

    Settling =>
      if age >= settle_delay then Watering
      else Settling;

    Watering =>
      if age >= watering_time then PumpStopping
      else Watering;

    PumpStopping =>
      Closing;

    Closing =>
      if known_closed then Idle
      else Closing;

    FaultPumpStopping =>
      if !fault_motion_permit || conflict then Faulted
      else FaultClosing;

    FaultClosing =>
      if !fault_motion_permit || conflict then Faulted
      else if known_closed then Faulted
      else if age >= closing_timeout then Faulted
      else FaultClosing;

    Faulted =>
      if reset_event && reset_allowed then Idle
      else Faulted;
  };

  // Exact next-phase projections avoid expanding the full phase decision once per output.
  let transition_permitted = !any_immediate_cause && motion_observations_good &&
    !(phase in {Idle, Opening, Settling, Watering, PumpStopping, Closing} && stop_ok_false);
  let next_open = transition_permitted &&
    ((phase == Idle && start_event && known_closed) || (phase == Opening && !known_open));
  let next_close = transition_permitted &&
    (phase == PumpStopping || (phase == Closing && !known_closed) ||
      (phase == FaultPumpStopping && fault_motion_permit && !conflict) ||
      (phase == FaultClosing && fault_motion_permit && !conflict && !known_closed && age < closing_timeout));
  let next_pump = transition_permitted &&
    ((phase == Settling && age >= settle_delay) || (phase == Watering && age < watering_time));
  let next_alarm = if any_immediate_cause then true
    else if !motion_observations_good then fault_cause != None
    else if phase in {FaultPumpStopping, FaultClosing} then true
    else if phase == Faulted then !(reset_event && reset_allowed)
    else false;

  valve_open_contactor <- next_open;
  valve_close_contactor <- next_close;
  pump_contactor <- next_pump;
  alarm <- next_alarm;
  mutex(valve_open_contactor, valve_close_contactor);
  require !(pump_contactor && valve_open_contactor);
  require !(pump_contactor && valve_close_contactor);
}
```

The alarm in `FaultPumpStopping` indicates the cause has already been reported;
its three motion outputs are off for one logical scan so the pump stops before
the valve closes. The `FaultClosing` command requests closure in software only.
It does not claim that the E-stop hardwired chain removed energy or that the
valve physically moved.

## Verification boundary

`tools/check-pc-10.mjs` creates a fresh `ControlRuntime` for each scenario and
does not rebuild the existing WASM artifact. A compiler/WASM trace PASS proves
that GhostFlow's virtual state/output calculation matches expectations. Web UX,
MCU upload, contactor closure, valve movement, pump rotation, flow, and physical
acceptance of the external safety chain are outside this example and checker.
