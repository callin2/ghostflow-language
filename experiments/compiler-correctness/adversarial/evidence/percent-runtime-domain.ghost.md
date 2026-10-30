# Compiler correctness adversarial example

```ghost
control PercentDomain {
  state a: Percent = 90%;
  output above, below: Percent;
  above <- a + 20%;
  below <- a - 100%;
}
```
