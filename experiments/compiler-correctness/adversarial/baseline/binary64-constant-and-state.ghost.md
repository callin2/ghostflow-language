# Compiler correctness adversarial example

```ghost
control Precision {
  state a: Number = 16777216.0;
  state one: Number = 1.0;
  state third: Number = 0.3333333333333333;
  output constant, dynamic, rational: Number;
  constant <- (16777216.0 + 1.0) - 16777216.0;
  dynamic <- (a + one) - a;
  rational <- third * 3.0;
}
```
