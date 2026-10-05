<!-- translation-source: examples/vfd-speed.input-v1.ghost.md -->
[English original](vfd-speed.input-v1.ghost.md)

# VFD 속도 — 명시적 input revision

<!-- source-revision: issue531-input-quality-vfd-v1 -->

start와 stop은 누르는 동안 true다. producer는 전위차계 관측값을 V로 공급하며
의도된 운전 범위는 기존 0~10 V다. 속도 기준은 Run과 독립적이다. 이 가상 예제는
기존 정상 level-sensitive latch를 유지한다. START 관측을 사용할 수 없으면 새 운전을
시작하지 않고, STOP 관측을 사용할 수 없으면 Run을 차단한다. producer quality를
처리하는 명시적 소스 분기이며 물리 버튼 고장을 진단하는 기능이 아니다.
속도 표시는 0 V에서 시작하고 품질이 불명확하면 마지막으로 받은 관측값을 기억한다.
표시 초기값이 가상의 Good sample을 만들지는 않는다. 이전 소스와 scenario는 이력으로 보존한다.

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
