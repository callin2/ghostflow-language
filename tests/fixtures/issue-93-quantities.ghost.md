# Quantity execution parity fixture

Canonical compiler input for native/WASM conformance, not a reader example.
The input tape supplies Temperature in K, CO2Concentration and RelativeHumidity
as ratios, Pressure in Pa, FlowRate in m3/s, Duration in ms, and Percent in percent.
Literal conversions and dimensional arithmetic belong to the compiler/shared core.

```ghost
control QuantityParity {
  input ambient: Temperature;
  input co2: CO2Concentration;
  input pressure: Pressure;
  input humidity: RelativeHumidity;
  input flow: FlowRate;
  input interval: Duration;
  input requested: Percent;
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
  cooling <- ambient > 77°F;
  ventilation <- co2 > 800ppm;
  pressure_ok <- pressure >= 1.2kPa;
  dry <- humidity < 70%RH;
  delta <- ambient - 25°C;
  delivered <- flow * interval;
  target <- 77°F;
  concentration <- 800ppm;
  pressure_limit <- 1.2kPa;
  duty <- requested;
  duration <- interval;
  count <- accepted';
}
```
