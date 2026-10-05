# Declared setting used by the timer

<!-- ghostflow:anchor id=GF-CORPUS-SETTING-INTENT kind=intent status=confirmed origin=user -->
> Keep the pump on until the declared run duration has elapsed.

Explicit new input revision: issue531-approved-fault-restart-v1. A START
acquisition fault inhibits a new run while an existing run keeps its elapsed
duration limit. Recovery requires a healthy START release before another start.
The predecessor is retained separately under tests/fixtures/history/issue531.

```ghost
control SettingPump {
  input start: Bool;
  output pump: Bool;
  config run_duration: Duration = 2s;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  state running: Bool = false;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  state restart_blocked: Bool = false;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  timer age = elapsed(running);
  let effective_duration = case run_duration {
    ok(value) => value;
    fault(_) => 0ms;
  };
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  restart_blocked' = if !start_good then true else if !start_requested then false else restart_blocked;
  running' = if age >= effective_duration then false
    else if !start_good then running
    else if !start_requested then false
    else if restart_blocked then running
    else true;
  // ghostflow:link id=GF-CORPUS-SETTING-INTENT relation=implements
  pump <- running';
}
```
