# Quantity execution parity fixture

Canonical compiler input for native/WASM conformance, not a reader example.
The input tape supplies Temperature in K, CO2Concentration and RelativeHumidity
as ratios, Pressure in Pa, FlowRate in m3/s, Duration in ms, and Percent in percent.
Literal conversions and dimensional arithmetic belong to the compiler/shared core.

This explicit input revision preserves the original healthy arithmetic oracle.
Fault branches retain authored fixture state; acquisition faults are supplied evidence.

```ghost
control QuantityParity {
  input ambient: Temperature;
  input co2: CO2Concentration;
  input pressure: Pressure;
  input humidity: RelativeHumidity;
  input flow: FlowRate;
  input interval: Duration;
  input requested: Percent;
  state retained_ambient: Temperature = 25°C;
  let scalar_ambient = case ambient { ok(observed) => observed; fault(_) => retained_ambient; };
  retained_ambient' = scalar_ambient;
  state retained_co2: CO2Concentration = 800ppm;
  let scalar_co2 = case co2 { ok(observed) => observed; fault(_) => retained_co2; };
  retained_co2' = scalar_co2;
  state retained_pressure: Pressure = 1.2kPa;
  let scalar_pressure = case pressure { ok(observed) => observed; fault(_) => retained_pressure; };
  retained_pressure' = scalar_pressure;
  state retained_humidity: RelativeHumidity = 70%RH;
  let scalar_humidity = case humidity { ok(observed) => observed; fault(_) => retained_humidity; };
  retained_humidity' = scalar_humidity;
  state retained_flow: FlowRate = 7.5L/min;
  let scalar_flow = case flow { ok(observed) => observed; fault(_) => retained_flow; };
  retained_flow' = scalar_flow;
  state retained_interval: Duration = 8s;
  let scalar_interval = case interval { ok(observed) => observed; fault(_) => retained_interval; };
  retained_interval' = scalar_interval;
  state retained_requested: Percent = 50%;
  let scalar_requested = case requested { ok(observed) => observed; fault(_) => retained_requested; };
  retained_requested' = scalar_requested;
  state accepted: Number = 0;
  accepted' = accepted + 1;
  output cooling, ventilation, pressure_ok, dry: Bool;
  output delta: TemperatureDelta;
  output delivered: Volume;
  output target: Temperature;
  output concentration: CO2Concentration;
  output pressure_limit: Pressure;
  output duty: Percent;
  output duration: Duration;
  output count: Number;
  cooling <- scalar_ambient > 77°F;
  ventilation <- scalar_co2 > 800ppm;
  pressure_ok <- scalar_pressure >= 1.2kPa;
  dry <- scalar_humidity < 70%RH;
  delta <- scalar_ambient - 25°C;
  delivered <- scalar_flow * scalar_interval;
  target <- 77°F;
  concentration <- 800ppm;
  pressure_limit <- 1.2kPa;
  duty <- scalar_requested;
  duration <- scalar_interval;
  count <- accepted';
}
```
