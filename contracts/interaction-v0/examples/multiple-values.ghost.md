# Multiple internal values interaction fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 kind=intent status=confirmed origin=user -->
This fixture keeps two independent Boolean states and elapsed timers alongside
a general numeric value and a nominal percentage. It exists to test that later
interaction descriptors follow authored declarations and semantic types rather
than one hard-coded name, one timer, or the JSON runtime value alone.

This explicit #531 input-quality revision retains each previous state when its
input is unavailable. It does not substitute a false/zero acquisition. The
predecessor is kept in `tests/fixtures/history/issue531/consumer-fixtures.pre-input.json`.

```ghost
control MultipleValues {
  input first_enable, second_enable: Bool;
  input sample: Number;
  output first_output, second_output: Bool;

  // ghostflow:link id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 relation=implements
  state first_active: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 relation=implements
  state second_active: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 relation=implements
  state quantity: Number = 0;
  // ghostflow:link id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 relation=implements
  state moisture: Percent = 0%;

  // ghostflow:link id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 relation=implements
  timer first_age = elapsed(first_active);
  // ghostflow:link id=GF-INT-FIXTURE-MULTIPLE-VALUES-V0 relation=implements
  timer second_age = elapsed(second_active);

  first_active' = case first_enable { ok(value) => value; fault(_) => first_active; };
  second_active' = case second_enable { ok(value) => value; fault(_) => second_active; };
  quantity' = case sample { ok(value) => value; fault(_) => quantity; };
  first_output <- first_active';
  second_output <- second_active';
}
```
