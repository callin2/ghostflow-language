# Compiler correctness adversarial example

```ghost
control PercentState {
  state amount: Percent = 90%;
  amount' = amount + 20%;
  output value: Percent;
  value <- amount';
}
```
