# Declared setting used by the timer

<!-- ghostflow:anchor id=GF-CORPUS-SETTING-INTENT kind=intent status=confirmed origin=user -->
> Keep the pump on until the declared run duration has elapsed.

```ghost
control SettingPump {
  input start: Bool;
  output pump: Bool;
  config run_duration: Duration = 2s;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  state running: Bool = false;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  timer age = elapsed(running);
  let effective_duration = case run_duration {
    ok(value) => value;
    fault(_) => 0ms;
  };
  running' = if !start then false else if age >= effective_duration then false else true;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  pump <- running';
}
```
