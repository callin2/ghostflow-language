# Pump request with a misspelled input

<!-- ghostflow:anchor id=GF-CORPUS-TYPO-INTENT kind=intent status=confirmed origin=user -->
> Run the pump while start is active and stop is not active.

```ghost
control TypoPump {
  input start, stop: Bool;
  output pump: Bool;
  // ghostflow:link id=GF-CORPUS-TYPO-INTENT relation=implements
  pump <- strt && !stop;
}
```
