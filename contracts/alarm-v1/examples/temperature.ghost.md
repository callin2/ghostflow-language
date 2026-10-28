# Software temperature alarm observation

<!-- ghostflow:anchor id=GF-ALARM-TEMPERATURE kind=assumption status=unconfirmed origin=ai -->
This software test condition is active above 30 degrees. If the temperature
observation is unavailable, retain the previous condition. Its alarm meaning is
supplied explicitly by the external descriptor. This is no physical safety claim.

```ghost
control TemperatureObservation {
  input temperature, divisor: Number;
  output ratio: Number;
  // ghostflow:link id=GF-ALARM-TEMPERATURE relation=assumes
  state hot: Bool = false;
  // ghostflow:link id=GF-ALARM-TEMPERATURE relation=assumes
  state observed: Number = 0;
  // ghostflow:link id=GF-ALARM-TEMPERATURE relation=assumes
  hot' = case temperature { ok(value) => value > 30; fault(_) => hot; };
  // ghostflow:link id=GF-ALARM-TEMPERATURE relation=assumes
  observed' = case temperature { ok(value) => value; fault(_) => observed; };
  // ghostflow:link id=GF-ALARM-TEMPERATURE relation=assumes
  ratio <- 1 / (divisor |> recover(1));
}
```
