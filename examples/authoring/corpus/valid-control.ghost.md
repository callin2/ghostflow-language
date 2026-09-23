# Confirmed pump request

<!-- ghostflow:anchor id=GF-CORPUS-VALID-INTENT kind=intent status=confirmed origin=user -->
> Run the pump while start is active and stop is not active.

```ghost
control ValidPump {
  input start, stop: Bool;
  output pump: Bool;
  // ghostflow:link id=GF-CORPUS-VALID-INTENT relation=implements
  pump <- start && !stop;
}
```
