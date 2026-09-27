Start and stop are true while pressed. The potentiometer input is valid from 0 to 10 V. The speed reference is independent of the run signal.

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;

  output run: Bool;
  output speed_v, speed_hz: Number;

  state running: Bool = false;

  // Start latches ON. Stop takes priority.
  running' = !stop && (start || running);
  run <- running';

  // Speed reference remains independent of Run.
  speed_v <- potentiometer_v;
  speed_hz <- potentiometer_v * 5;
}
```
