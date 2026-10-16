# Latching pump tutorial

This document is the canonical small control; `01-latch.ghost` is retained only
as non-executable historical evidence. The Markdown
prose is not executable; only the top-level `ghost` fence is the source.

The `watering` state holds its previous value when there is no new start. A stop
request has priority over start, including when both inputs are true in one tick.

```ghost
control LatchingPump {
  input start: Bool;
  input stop: Bool;

  output pump, valve: Bool;
  state watering: Bool = false;
  state restart_blocked: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);

  // Revision issue531-approved-fault-restart-v1: explicit authored fault policy.
  // Faults block restart until a healthy START off-to-on request.
  restart_blocked' = if !start_good || !stop_good then true
                     else if !start_requested then false else restart_blocked;
  watering' = !stop_requested && (watering || (start_requested && !restart_blocked));

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

The new revision `issue531-approved-fault-restart-v1` explicitly handles faults.
A START fault inhibits new starts; an active run may continue with healthy,
released STOP. A STOP fault releases the run. After a fault stops or blocks a
run, healthy START must turn off then on before restarting. START is a logical
request; this example does not require a physical button. The exact previous
source is retained under tests/fixtures/history/issue531.

Expected healthy trace for the unchanged companion CSV:

| tick | start | stop | watering' | pump / valve |
|---:|:---:|:---:|:---:|:---:|
| 1 | true | false | true | on / on |
| 2 | false | false | true | on / on |
| 3 | true | true | false | off / off |
| 4 | false | false | false | off / off |
| 5 | true | false | true | on / on |
