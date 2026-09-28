<!-- translation-source: examples/scheduled-watering.ghost.md -->
[Korean original](scheduled-watering.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# Sequential watering by daily schedule

This document contains both explanation and GhostFlow code. It runs through the
control/literate compiler and manifest-aware host. It is a virtual tutorial,
not physical output. The linked original is the canonical executable program;
`scheduled-watering.ghost` is non-executable historical evidence.

At each selected time, water zone 1 and then zone 2. Both zones share one pump.

```ghost
// Executable with ghostc and the manifest-aware virtual host; no GPIO driver.
control ScheduledWatering {
```

## When does watering start?

The day is divided into 96 slots of 15 minutes each. Select the desired times.
This example starts at 06:00, 06:15, 12:30, and 18:45 Korea time.

```ghost
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 06:15, 12:30, 18:45];
  }
```

## How long does watering run?

Water each zone for five minutes. Wait two seconds after opening a valve before
turning on the pump. After stopping the pump, keep that valve open for two more
seconds. Wait two seconds with both valves closed between zones. These timings
are not sensor values confirming actual device behavior.

```ghost
  let water1_time = 5min;
  let water2_time = 5min;
  let valve_delay = 2s;
  let pump_stop_delay = 2s;
  let switch_delay = 2s;

  output pump, valve1, valve2: Bool;
```

## How far has the sequence progressed?

`phase` is the current step and `age` is the time spent in that step.
When a phase transition commits, `age` resets to zero. Ghost execution restores
the phase and timer state together.

```ghost
  type Phase =
      Idle
    | Open1
    | Water1
    | Stop1
    | Switch
    | Open2
    | Water2
    | Stop2;

  state phase: Phase = Idle;
  timer age = elapsed(phase);
```

## What is the next step?

Accept schedule-start signals only in Idle. Skip a scheduled occurrence that
arrives during operation; do not queue it. Each phase checks elapsed time, so
the control loop is not blocked.

```ghost
  phase' = case phase {
    Idle =>
      if starts.due then Open1 else Idle;

    Open1 =>
      if age >= valve_delay then Water1 else Open1;

    Water1 =>
      if age >= water1_time then Stop1 else Water1;

    Stop1 =>
      if age >= pump_stop_delay then Switch else Stop1;

    Switch =>
      if age >= switch_delay then Open2 else Switch;

    Open2 =>
      if age >= valve_delay then Water2 else Open2;

    Water2 =>
      if age >= water2_time then Stop2 else Water2;

    Stop2 =>
      if age >= pump_stop_delay then Idle else Stop2;
  };
```

## What outputs are requested?

Compute the intended valves and pump for the next phase. Output definitions are
not executed block by block. Candidate outputs for a tick are calculated
together, then constraints are applied.

```ghost
  valve1 <- phase' in {Open1, Water1, Stop1};
  valve2 <- phase' in {Open2, Water2, Stop2};
  pump   <- phase' in {Water1, Water2};

  require pump => (valve1 || valve2);
  require !(valve1 && valve2);
}
```

## Expected sequence

The table below is explanatory material; it is not executable code or program
input. One cycle is about 10 minutes 10 seconds by configuration. Actual phase
transitions also include tick-resolution error.

| Phase | Duration | Pump | Valve 1 | Valve 2 |
|---|---|---|---|---|
| Open1 | 2 seconds | Off | Request open | Request closed |
| Water1 | 5 minutes | On | Request open | Request closed |
| Stop1 | 2 seconds | Off | Request open | Request closed |
| Switch | 2 seconds | Off | Request closed | Request closed |
| Open2 | 2 seconds | Off | Request closed | Request open |
| Water2 | 5 minutes | On | Request closed | Request open |
| Stop2 | 2 seconds | Off | Request closed | Request open |
| Idle | Until next schedule | Off | Request closed | Request closed |
