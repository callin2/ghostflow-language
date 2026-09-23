# Pump request with an unresolved duration

<!-- ghostflow:anchor id=GF-CORPUS-ASSUMPTION-INTENT kind=intent status=confirmed origin=user -->
> Run the pump while start is active and stop is not active.

<!-- ghostflow:anchor id=GF-CORPUS-MAX-DURATION kind=assumption status=unconfirmed origin=ai -->
> The maximum run duration is not specified. Ask the user before adding a limit.

```ghost
control AssumptionPump {
  input start, stop: Bool;
  output pump: Bool;
  // ghostflow:link id=GF-CORPUS-ASSUMPTION-INTENT relation=implements
  pump <- start && !stop;
}
```
