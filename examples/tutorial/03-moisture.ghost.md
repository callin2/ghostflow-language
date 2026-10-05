# Moisture-gated watering

The authored intent keeps watering on only when a valid, dry moisture signal is
present; a fault or stop input clears the latch.

This producer-quality revision keeps the authored moisture-fault branch. START and STOP explicitly handle unavailable producer observations; healthy button values do not infer physical faults. The predecessor is retained at `tests/fixtures/history/issue531/03-moisture.ghost.md.pre-input.txt`.

```ghost
// Source revision: issue531-producer-quality-tutorial03-v1
control MoistureDemand {
  input start, stop: Bool;
  input moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  state watering: Bool = false;
  output pump, valve: Bool;
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);
  watering' = !stop_requested && dry_ok && (start_requested || watering);
  valve <- watering';
  pump <- watering';
  require pump => valve;
}
```
