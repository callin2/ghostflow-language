# Bool sensor recovery proof input

<!-- ghostflow:anchor id=GF-BOOL-SENSOR-RECOVER kind=intent status=confirmed origin=user -->
> Request the input value when it is healthy, and request false when acquisition reports a fault.

```ghost
control BoolSensorRecover {
  input di: Bool;
  output output_bit: Bool;
  // ghostflow:link id=GF-BOOL-SENSOR-RECOVER relation=implements
  output_bit <- di |> recover(false);
}
```
