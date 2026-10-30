# Compiler correctness adversarial example

```ghost
control TimerBoundary {
  input enabled: Bool;
  let active = enabled |> recover(false);
  timer hot_for = continuous_true(active);
  output age: Duration;
  output done: Bool;
  age <- hot_for;
  done <- hot_for >= 1000ms;
}
```
