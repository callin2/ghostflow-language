# Independent Bool acquisition recovery

<!-- ghostflow:anchor id=GF-TWO-SENSOR kind=intent status=confirmed origin=user -->
> Each output requests its own healthy input value and requests false for its own acquisition fault.

```ghost
control TwoSensorRecover {
  input left: Bool;
  input right: Bool;
  output left_out: Bool;
  output right_out: Bool;
  // ghostflow:link id=GF-TWO-SENSOR relation=implements
  left_out <- left |> recover(false);
  // ghostflow:link id=GF-TWO-SENSOR relation=implements
  right_out <- right |> recover(false);
}
```
