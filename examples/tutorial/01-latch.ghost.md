# Latching pump tutorial

This document explains the same small control as `01-latch.ghost`. The Markdown
prose is not executable; only the top-level `ghost` fence is the source.

The `watering` state holds its previous value when there is no new start. A stop
request has priority over start, including when both inputs are true in one tick.

```ghost
control LatchingPump {
  input start: Bool;
  input stop: Bool;

  output pump, valve: Bool = false;
  state watering: Bool = false;

  // stop wins when start and stop arrive in the same tick.
  watering' = !stop && (start || watering);

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

Expected trace for the companion CSV:

| tick | start | stop | watering' | pump / valve |
|---:|:---:|:---:|:---:|:---:|
| 1 | true | false | true | on / on |
| 2 | false | false | true | on / on |
| 3 | true | true | false | off / off |
| 4 | false | false | false | off / off |
| 5 | true | false | true | on / on |
