# Compiler correctness adversarial example

```ghost
control Folded {
  state high: Int = 2147483647;
  state n: Number = 2147483647.75;
  output folded, dynamic: Number;
  output truncated_constant, truncated_dynamic: Int;
  folded <- number(2147483647);
  dynamic <- number(high);
  truncated_constant <- int_trunc(2147483647.75);
  truncated_dynamic <- int_trunc(n);
}
```
