# Bool output uses a Bool input

<!-- ghostflow:anchor id=GF-CORPUS-TYPE-INTENT kind=intent status=confirmed origin=user -->
> The pump output is true while start is active.

Explicit input-quality-v1 source revision. Unknown requests retain authored state and cannot create a new request; known STOP or a known released START cancels it. Original source bytes and dated benchmark evidence remain separately preserved.

```ghost
control TypePump {
  input start: Bool;
  output pump: Bool;
  // ghostflow:link id=GF-CORPUS-TYPE-INTENT relation=implements
  state requested: Bool = false;
  requested' = case start { ok(value) => value; fault(_) => requested; };
  // ghostflow:link id=GF-CORPUS-TYPE-INTENT relation=implements
  pump <- requested';
}
```
