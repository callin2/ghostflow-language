# Elapsed state epoch initialization and reset

<!-- ghostflow:anchor id=GF-ELAPSED-EPOCH kind=intent status=confirmed origin=user -->
> Toggle the held state on healthy true input. Track the current state's start time from the first scan and reset it only when that state changes.

```ghost
control SensorToggle {
  input trigger: Bool;
  state held: Bool = false;
  output relay: Bool;
  held' = if (trigger |> recover(false)) then !held else held;
  relay <- held';
  timer age = elapsed(held);
}
```
