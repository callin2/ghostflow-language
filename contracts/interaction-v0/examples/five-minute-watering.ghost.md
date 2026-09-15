# Five-minute watering interaction fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-WATERING-V0 kind=intent status=confirmed origin=user -->
The authored state records whether watering is active. `age` is the elapsed
time since that state changed; it is not accumulated pump-on time.

```ghost
control FiveMinuteWatering {
  input start, stop: Bool;
  config watering_limit: Duration = 5min;
  output pump: Bool;

  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V0 relation=implements
  state pressure: Number = 0;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V0 relation=implements
  state moisture: Percent = 0%;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V0 relation=implements
  state watering: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V0 relation=implements
  timer age = elapsed(watering);

  watering' = !stop && (start || watering) && age < watering_limit;
  pump <- watering';
}
```
