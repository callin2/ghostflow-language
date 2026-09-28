<!-- translation-source: examples/vfd-speed.ghost.md -->
[English original](vfd-speed.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

누르고 있는 동안 start와 stop은 true다. 전위차계 입력의 유효 범위는 0–10 V다. 속도
지령은 운전 signal과 독립적이다.

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
