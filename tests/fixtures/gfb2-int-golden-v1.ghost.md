# Exact integer GFB vector

```ghost
control ExactIntegerGolden {
  input selected: Int;
  state minimum: Int = -2147483648;
  state zero: Int = 0;
  state maximum: Int = 2147483647;
  output selected_out: Int;
  output minimum_out: Int;
  output zero_out: Int;
  output maximum_out: Int;
  selected_out <- selected;
  minimum_out <- minimum;
  zero_out <- zero;
  maximum_out <- maximum;
}
```
