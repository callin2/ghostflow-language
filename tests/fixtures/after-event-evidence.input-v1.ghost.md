# Evidence after event

```ghost
control AfterEventEvidence {
  event started: Event;
  input valve_open: Bool;
  signal opened = after_event(started, valve_open, window: 10s, quality: measured);
  output confirmed: Bool;
  confirmed <- after_event_any(opened) |> recover(false);
}
```
