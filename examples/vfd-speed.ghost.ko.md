<!-- translation-source: examples/vfd-speed.ghost.md -->
[영문 원문](vfd-speed.ghost.md)

Start와 stop은 누르고 있는 동안 true입니다. 전위차계 입력의 유효 범위는 0~10 V입니다. 속도 지령은 운전(run) 신호와 독립적입니다.

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
