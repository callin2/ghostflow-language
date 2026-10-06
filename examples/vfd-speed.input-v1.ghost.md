# VFD speed — explicit input revision

<!-- source-revision: issue531-input-quality-vfd-v1 -->

Start and stop are true while pressed. The producer supplies potentiometer observations
in volts; the intended operating range remains 0 to 10 V. Speed remains independent
of Run. This virtual example keeps its existing healthy level-sensitive latch:
an unavailable START cannot begin a run; unavailable STOP inhibits Run. These are
explicit source branches for producer quality, not physical button diagnostics.
The speed display starts at 0 V and remembers its last accepted observation when
quality is unavailable. That display initialization is not a synthesized Good sample.
The predecessor source and scenario remain intact as historical evidence.

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;
  output run: Bool;
  output speed_v, speed_hz: Number;
  state running: Bool = false;
  state observed_speed_v: Number = 0.0;
  // Preserve the existing healthy STOP priority and level-sensitive latch.
  running' = case stop {
    ok(stopped) => !stopped && (case start { ok(requested) => requested || running; fault(_) => running; });
    fault(_) => false;
  };
  run <- running';
  // Authored display memory is separate from producer acquisition evidence.
  observed_speed_v' = case potentiometer_v { ok(value) => value; fault(_) => observed_speed_v; };
  speed_v <- observed_speed_v';
  speed_hz <- observed_speed_v' * 5;
}
```
