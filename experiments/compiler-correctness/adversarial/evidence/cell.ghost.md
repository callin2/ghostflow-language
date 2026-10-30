# Compiler correctness adversarial example

```ghost
control Cell { input enabled: Bool; state total: Int = 0; total' = if (enabled |> recover(false)) then total + 1 else total; output value: Int; value <- total'; }
```
