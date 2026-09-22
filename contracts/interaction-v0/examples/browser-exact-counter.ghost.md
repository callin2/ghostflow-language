# Browser exact counter interaction fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-BROWSER-EXACT-COUNTER-V0 kind=intent status=confirmed origin=user -->
Count each accepted DI1 scan exactly. Keep the counter renderer independent and
retain the standard eight Boolean virtual input and output ports.

```ghost
control BrowserExactCounter {
  input DI1, DI2, DI3, DI4: Bool;
  input DI5, DI6, DI7, DI8: Bool;
  output RO1, RO2, RO3, RO4: Bool;
  output RO5, RO6, RO7, RO8: Bool;

  // ghostflow:link id=GF-INT-FIXTURE-BROWSER-EXACT-COUNTER-V0 relation=implements meaning=counter
  state accepted_count: Int = 0;

  accepted_count' = if DI1 then accepted_count + 1 else accepted_count;
  RO1 <- DI1;
  RO2 <- false;
  RO3 <- false;
  RO4 <- false;
  RO5 <- false;
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;
}
```
