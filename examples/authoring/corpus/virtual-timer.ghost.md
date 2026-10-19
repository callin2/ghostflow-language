# Virtual two-second pump limit

<!-- ghostflow:anchor id=GF-CORPUS-TIMER-INTENT kind=intent status=confirmed origin=user -->
> For this example, stop the pump after two seconds of continuous requested operation.

Explicit input-quality-v1 source revision. Unknown requests retain authored state and cannot create a new request; known STOP or a known released START cancels it. Original source bytes and dated benchmark evidence remain separately preserved.

```ghost
control VirtualTimer {
  input start, stop: Bool;
  output pump: Bool;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => false; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  let max_run = 2s;
  type Phase = Idle | Running | Done;
  // ghostflow:link id=GF-CORPUS-TIMER-INTENT relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-CORPUS-TIMER-INTENT relation=implements
  timer age = elapsed(phase);

  phase' = case phase {
    Idle => if start_good && stop_good && start_value && !stop_value then Running else Idle;
    Running =>
      if stop_good && stop_value then Idle
      else if age >= max_run then Done
      else Running;
    Done => if start_good && !start_value then Idle else Done;
  };

  // ghostflow:link id=GF-CORPUS-TIMER-INTENT relation=implements
  pump <- phase' == Running;
}
```
