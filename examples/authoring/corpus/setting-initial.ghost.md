# Missing setting declaration

<!-- ghostflow:anchor id=GF-CORPUS-SETTING-INTENT kind=intent status=confirmed origin=user -->
> Keep the pump on until the declared run duration has elapsed.

Explicit input-quality-v1 source revision. Unknown requests retain authored state and cannot create a new request; known STOP or a known released START cancels it. Original source bytes and dated benchmark evidence remain separately preserved.

```ghost
control SettingPump {
  input start: Bool;
  output pump: Bool;
  config run_duration: Duration = 2s;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  state running: Bool = false;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  timer age = elapsed(running);
  let requested = case start { ok(value) => value; fault(_) => running; };
  running' = if !requested then false else if age >= maximum_run then false else true;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  pump <- running';
}
```
