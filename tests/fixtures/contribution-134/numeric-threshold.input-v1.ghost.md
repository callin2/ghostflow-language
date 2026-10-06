# Numeric moisture threshold to virtual relay 1

This deterministic HIL case proves a software-provided numeric moisture value
drives the `pump` intent below the 42.5 threshold. The virtual output profile
keeps the physical relay latch off while preserving the `RO1` installation.

This explicit input revision preserves the original healthy arithmetic oracle.
Fault branches retain authored fixture state; acquisition faults are supplied evidence.

```ghost
control NumericThresholdVirtualRo1 {
  input moisture: Number;
  state retained_moisture: Number = 42.5;
  let scalar_moisture = case moisture { ok(observed) => observed; fault(_) => retained_moisture; };
  retained_moisture' = scalar_moisture;
  output pump: Bool;
  pump <- scalar_moisture < 42.5;
}
```
