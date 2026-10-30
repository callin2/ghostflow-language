# Compiler correctness adversarial example

```ghost
control IntegerOracle {
      input left, right: Int;
      let a = left |> recover(0);
      let b = right |> recover(1);
      state committed: Int = 0;
      committed' = committed + 1;
      output value, accepted: Int;
      value <- a % b;
      accepted <- committed';
    }
```
