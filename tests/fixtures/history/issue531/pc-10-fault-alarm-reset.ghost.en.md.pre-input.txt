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

```ghost
control FaultAlarmResetWaterSupply {
  input start_request, reset_request, stop_ok, emergency_stop_ok, overload_ok,
    source_water_ok, valve_drive_ok, open_limit, close_limit: Bool;
  output valve_open_contactor, valve_close_contactor, pump_contactor, alarm: Bool;

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

  let normal_permit = stop_ok && emergency_stop_ok && overload_ok && source_water_ok && valve_drive_ok;
  let fault_motion_permit = stop_ok && emergency_stop_ok && overload_ok && valve_drive_ok;
  let conflict = open_limit && close_limit;
  let known_closed = close_limit && !open_limit;
  let known_open = open_limit && !close_limit;
  let start_event = request_armed && start_request;
  let reset_event = reset_armed && reset_request;
  let fault_cleared = case fault_cause {
    None => true;
    EmergencyStop => emergency_stop_ok;
    Overload => overload_ok;
    LowSourceWater => source_water_ok;
    ValveDriveUnavailable => valve_drive_ok;
    SensorConflict => !conflict;
    FeedbackLost => known_closed;
    OpenTimeout => known_closed;
    CloseTimeout => known_closed;
  };
  let fault_free_now = emergency_stop_ok && overload_ok && source_water_ok &&
    valve_drive_ok && !conflict;
  let reset_allowed = fault_cause != None && fault_cleared && fault_free_now && known_closed;
  let immediate_cause =
    if !emergency_stop_ok then EmergencyStop
    else if !overload_ok then Overload
    else if !valve_drive_ok then ValveDriveUnavailable
    else if conflict then SensorConflict
    else if phase in {Settling, Watering, PumpStopping} && !known_open then FeedbackLost
    else if phase == Opening && !open_limit && age >= opening_timeout then OpenTimeout
    else if phase == Closing && !close_limit && age >= closing_timeout then CloseTimeout
    else if !source_water_ok && phase in {Idle, Opening, Settling, Watering, PumpStopping} then LowSourceWater
    else None;

  request_armed' = phase == Idle && fault_cause == None && normal_permit && !conflict && known_closed && !start_request;
  reset_armed' = phase == Faulted && reset_allowed && !reset_request;
  fault_cause' =
    if phase == Faulted && reset_event && reset_allowed then None
    else if fault_cause != None then fault_cause
    else immediate_cause;

  phase' = case phase {
    Idle =>
      if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if start_event && known_closed then Opening
      else Idle;

    Opening =>
      if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if known_open then Settling
      else Opening;

    Settling =>
      if immediate_cause == LowSourceWater && known_open && fault_motion_permit then FaultPumpStopping
      else if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if age >= settle_delay then Watering
      else Settling;

    Watering =>
      if immediate_cause == LowSourceWater && known_open && fault_motion_permit then FaultPumpStopping
      else if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if age >= watering_time then PumpStopping
      else Watering;

    PumpStopping =>
      if immediate_cause == LowSourceWater && known_open && fault_motion_permit then FaultPumpStopping
      else if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else Closing;

    Closing =>
      if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if known_closed then Idle
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

  valve_open_contactor <- phase' == Opening;
  valve_close_contactor <- phase' in {Closing, FaultClosing};
  pump_contactor <- phase' == Watering;
  alarm <- phase' in {FaultPumpStopping, FaultClosing, Faulted};
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
