# BridgeScalarTwo

```ghost
control BridgeScalarTwo {
  input raw_a: Bool;
  input raw_b: Bool;
  state counter: Int = 0;
  counter' = counter + 1;
  output a, b: Bool;
  a <- true;
  b <- false;
  mutex(a, b);
  mutex(a, b);
}
```
