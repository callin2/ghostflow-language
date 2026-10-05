# Pump request with a misspelled input

<!-- ghostflow:anchor id=GF-CORPUS-TYPO-INTENT kind=intent status=confirmed origin=user -->
> Run the pump while start is active and stop is not active.

Explicit input-quality-v1 source revision. Unknown requests retain authored state and cannot create a new request; known STOP or a known released START cancels it. Original source bytes and dated benchmark evidence remain separately preserved.

```ghost
control TypoPump {
  input start, stop: Bool;
  output pump: Bool;
  // ghostflow:link id=GF-CORPUS-TYPO-INTENT relation=implements
  state requested: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => requested; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  requested' = if stop_good && stop_value then false
    else if start_good && !start_value then false
    else if start_good && stop_good then start_value && !stop_value
    else requested;
  // ghostflow:link id=GF-CORPUS-TYPO-INTENT relation=implements
  pump <- strt && !stop_value;
}
```
