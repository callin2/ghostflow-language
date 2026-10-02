# Numeric moisture threshold to virtual relay 1

This deterministic HIL case proves a software-provided numeric moisture value
drives the `pump` intent below the 42.5 threshold. The virtual output profile
keeps the physical relay latch off while preserving the `RO1` installation.

```ghost
control NumericThresholdVirtualRo1 {
  input moisture: Number;
  output pump: Bool;
  pump <- moisture < 42.5;
}
```
