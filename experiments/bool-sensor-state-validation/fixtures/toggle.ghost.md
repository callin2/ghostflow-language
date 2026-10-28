# Bool sensor state toggle

<!-- ghostflow:anchor id=GF-SENSOR-STATE kind=intent status=confirmed origin=user -->
> Toggle the held state on each healthy true input. Preserve it on healthy false or any sensor fault. Request the candidate state at the output.

Source: https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6478702192

```ghost
control SensorToggle {
  input trigger: Bool;
  state held: Bool = false;
  output relay: Bool;
  held' = if (trigger |> recover(false)) then !held else held;
  relay <- held';
}
```
