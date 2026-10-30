# Compiler correctness adversarial example

```ghost
control FaultOrder {
  input choose: Bool;
  state zero: Number = 0.0;
  state too_big: Number = 2147483648.0;
  state committed: Int = 0;
  committed' = committed + 1;
  output value: Bool;
  value <- if (choose |> recover(false)) then (int_exact(1.0 / zero) == 0 || int_exact(too_big) == 0)
    else (int_exact(too_big) == 0 || int_exact(1.0 / zero) == 0);
}
```
