# Compiler correctness adversarial example

```ghost
fn guarded(enabled: Bool, divisor: Number) -> Number { if enabled then 1.0 / divisor else 7.0 }
fn unsafe(value: Number) -> Number { 1.0 / value }
control UnselectedFaults {
  state zero: Number = 0.0;
  let unavailable: Result<Number, SensorFault> = fault(Disconnected);
  let transform = map(unsafe) >> recover(9.0);
  output conditional, recovered: Number;
  output conjunction, disjunction: Bool;
  conditional <- guarded(false, zero);
  recovered <- unavailable |> transform;
  conjunction <- false && (1.0 / zero > 0.0);
  disjunction <- true || (1.0 / zero > 0.0);
}
```
