# Irrigation runtime fixture

This canonical literate fixture supplies the portable-core host tests. It is a
virtual control fixture, not hardware or deployment evidence.

This explicit revision, issue531-approved-fault-restart-v1, retains healthy STOP
and low-water priority. START faults inhibit new starts; STOP/low-water faults
release the run. Recovery requires a healthy START off-to-on request. Fault
quality/reason remains in the acquisition and Result trace; low_fault records
the asserted or unavailable protection condition. The exact predecessor is
retained under tests/fixtures/history/issue531. No physical START button or
hardware acceptance is implied.

```ghost
control irrigation {
  input start, stop, low_water: Bool;
  input moisture: Number;
  state watering: Bool = false;
  state low_fault: Bool = false;
  state restart_blocked: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let low_good = case low_water { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);
  let low_requested = low_water |> recover(true);
  output pump, valve: Bool;

  // Revision issue531-approved-fault-restart-v1: protection faults release the run.
  low_fault' = low_requested;
  restart_blocked' = if !start_good || !stop_good || !low_good then true
                     else if !start_requested then false else restart_blocked;
  watering' = if stop_requested || low_requested then false
              else watering || (start_requested && !restart_blocked);
  pump <- watering';
  valve <- watering';
}
```
