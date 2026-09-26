# Exact counter interaction fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-EXACT-COUNTER-V0 kind=intent status=confirmed origin=user -->
The accepted count is an authored counter. The exact sample and approximate
measurement remain ordinary states even when their runtime values look integral.

```ghost
control ExactCounter {
  input selected: Int;
  output selected_out: Int;

  // ghostflow:link id=GF-INT-FIXTURE-EXACT-COUNTER-V0 relation=implements meaning=counter
  state accepted_count: Int = 0;
  // ghostflow:link id=GF-INT-FIXTURE-EXACT-COUNTER-V0 relation=implements
  state exact_sample: Int = 0;
  // ghostflow:link id=GF-INT-FIXTURE-EXACT-COUNTER-V0 relation=implements
  state measurement: Number = 0.0;

  accepted_count' = selected;
  exact_sample' = selected;
  selected_out <- selected;
}
```
