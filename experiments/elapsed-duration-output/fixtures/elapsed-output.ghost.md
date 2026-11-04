# Elapsed state duration output

<!-- ghostflow:anchor id=GF-ELAPSED-DURATION kind=intent status=confirmed origin=user -->
> Toggle the held state on healthy true input. Track the state's start time, request the candidate Bool state, and expose the elapsed Duration evaluated from the previous timer snapshot.

Source: https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6483394125

```ghost
control ElapsedOutput {
  input trigger: Bool;
  state held: Bool = false;
  output relay: Bool;
  held' = if (trigger |> recover(false)) then !held else held;
  relay <- held';
  timer age = elapsed(held);
  output age_ms: Duration;
  age_ms <- age;
}
```
