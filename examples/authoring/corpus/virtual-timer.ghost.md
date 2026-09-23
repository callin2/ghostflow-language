# Virtual two-second pump limit

<!-- ghostflow:anchor id=GF-CORPUS-TIMER-INTENT kind=intent status=confirmed origin=user -->
> For this example, stop the pump after two seconds of continuous requested operation.

```ghost
control VirtualTimer {
  input start, stop: Bool;
  output pump: Bool;
  config max_run: Duration = 2s;
  type Phase = Idle | Running | Done;
  // ghostflow:link id=GF-CORPUS-TIMER-INTENT relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-CORPUS-TIMER-INTENT relation=implements
  timer age = elapsed(phase);

  phase' = case phase {
    Idle => if start && !stop then Running else Idle;
    Running =>
      if stop then Idle
      else if age >= max_run then Done
      else Running;
    Done => if !start then Idle else Done;
  };

  // ghostflow:link id=GF-CORPUS-TIMER-INTENT relation=implements
  pump <- phase' == Running;
}
```
