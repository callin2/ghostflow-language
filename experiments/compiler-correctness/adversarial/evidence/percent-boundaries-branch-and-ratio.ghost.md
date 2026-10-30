# Compiler correctness adversarial example

```ghost
fn raise(value: Percent) -> Percent { value + 20% }
control PercentMatrix {
  input observed: Percent;
  input enabled: Bool;
  let a = observed |> recover(0%);
  let active = enabled |> recover(false);
  output value: Percent;
  output ratio: Number;
  value <- if active then raise(a) else 0.5%;
  ratio <- a / 0.5%;
}
```
