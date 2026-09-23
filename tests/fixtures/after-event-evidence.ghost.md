# Evidence after event

```ghost
control AfterEventEvidence {
  event started: Event;
  sensor valve_open: Bool;
  signal opened = after_event(started, valve_open, window: 10s, quality: measured);
  output confirmed: Bool;
  confirmed <- opened |> recover(false);
}
```
