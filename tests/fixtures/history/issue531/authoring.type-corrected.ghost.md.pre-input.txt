# Bool output uses a Bool input

<!-- ghostflow:anchor id=GF-CORPUS-TYPE-INTENT kind=intent status=confirmed origin=user -->
> The pump output is true while start is active.

```ghost
control TypePump {
  input start: Bool;
  output pump: Bool;
  // ghostflow:link id=GF-CORPUS-TYPE-INTENT relation=implements
  pump <- start;
}
```
