<!-- translation-source: examples/vfd-speed.input-v1.ghost.md -->
[영문 원문](vfd-speed.input-v1.ghost.md)

# VFD 속도 — 명시적 입력 revision

<!-- source-revision: issue531-input-quality-vfd-v1 -->

Start와 stop은 누르고 있는 동안 true입니다. 생산자(producer)는 전위차계 관측값을
볼트 단위로 제공하며, 의도된 운전 범위는 그대로 0~10 V입니다. 속도는 Run과
독립적입니다. 이 가상 예제는 기존의 정상 동작인 레벨 감응형(level-sensitive) 래치를
유지합니다. 사용할 수 없는 START는 운전을 시작할 수 없고, 사용할 수 없는 STOP은
Run을 차단합니다. 이는 producer quality를 처리하는 명시적 소스 분기이며, 물리 버튼
진단이 아닙니다. 속도 표시는 0 V에서 시작하고, 품질을 사용할 수 없으면 마지막으로
받아들인 관측값을 기억합니다. 이 표시 초기화는 합성된 Good 샘플이 아닙니다.
이전 소스와 시나리오는 과거 증거로 그대로 보존됩니다.

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
