# Explicit quality-input golden revision

This virtual conformance source is a new revision. The historical GFB1 vector
and its source hashes remain independent evidence. Producer faults retain the
source-local running memory; its initial false is not a healthy input sample.

```ghost
control gfb1_golden_input {
  input enabled: Bool;
  state running: Bool = false;
  running' = case enabled { ok(value) => value; fault(_) => running; };
  output pump: Bool;
  pump <- !running';
}
```
