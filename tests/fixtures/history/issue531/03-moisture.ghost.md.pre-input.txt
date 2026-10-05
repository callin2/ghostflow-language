# Moisture-gated watering

The authored intent keeps watering on only when a valid, dry moisture signal is
present; a fault or stop input clears the latch.

```ghost
control MoistureDemand {
  input start, stop: Bool;
  sensor moisture: Percent {
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
  watering' = !stop && dry_ok && (start || watering);
  valve <- watering';
  pump <- watering';
  require pump => valve;
}
```
