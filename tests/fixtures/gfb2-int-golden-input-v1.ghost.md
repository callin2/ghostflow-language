# Explicit exact-integer quality-input revision

This virtual display fixture retains its previous selected value while the
producer is unknown. The source-local display starts at zero; acquisition
quality remains a distinct Result. Historical version-2 bytes are unchanged.

```ghost
control ExactIntegerGoldenInput {
  input selected: Int;
  state remembered: Int = 0;
  let displayed = case selected { ok(value) => value; fault(_) => remembered; };
  remembered' = displayed;
  state minimum: Int = -2147483648;
  state zero: Int = 0;
  state maximum: Int = 2147483647;
  output selected_out: Int;
  output minimum_out: Int;
  output zero_out: Int;
  output maximum_out: Int;
  selected_out <- displayed;
  minimum_out <- minimum;
  zero_out <- zero;
  maximum_out <- maximum;
}
```
