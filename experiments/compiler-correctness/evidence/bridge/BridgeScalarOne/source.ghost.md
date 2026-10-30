# BridgeScalarOne

```ghost
control BridgeScalarOne {
  input raw_a: Bool;
  input raw_b: Bool;

  output a, b: Bool;
  a <- true;
  b <- false;
  require a => b;
  require a => b;
}
```
