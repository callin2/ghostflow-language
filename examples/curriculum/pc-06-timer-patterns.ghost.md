# PC-06 — 유지 요청과 독립 타이머 패턴

<!-- ghostflow:anchor id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 kind=intent status=confirmed origin=imported -->
> 교육용 시나리오: 하나의 제어함에서 지연 ON, 지연 OFF, 최대 운전시간을
> 함께 다루는 방법을 학습한다. 같은 입력을 여러 번 읽는 유지 수요와,
> 한 번의 버튼 변화로 시작하는 momentary START 사건을 구별하는 예제다.

이 문서는 PC-06의 유일한 canonical literate 실행 원본이다. 기존 교재의
[E08 DelayedStart](../../docs/ProgrammingInGhostflow.md#e08--입력이-2초-유지되면-켜기)와
[tutorial/02-watering](../tutorial/02-watering.ghost.md)를 보존하고 참조한다.
E08은 하나의 상태와 `elapsed(phase)`를 소개하고, tutorial 예제는 실제 급수
순서를 보여 준다. 이 과는 그 지식을 세 개의 독립적인 요구 채널로 확장한다.

`on_delay_request`, `off_delay_request`, `limited_request`는 momentary START 사건이 아니라
현재 유지되고 있는 수요다. 입력이 참인 동안 각각의 요구가 계속 존재한다.
`stop_ok`가 거짓이면 세 채널은 모두 즉시 안전한 유휴 상태로 돌아간다.
`on_delay`와 `off_delay`는 각 채널의 지연이고, `max_run`은 LIMIT 채널의
하드 최대 운전시간이다. 이 예제는 물리적 안전장치나 실제 부하의 동작을
보장하지 않는다.

이 명시적 input revision은 생산자 품질을 사용하며 버튼의 물리적 고장을 추론하지 않는다. Good(false)는 정상 관측이다. 미상 요청·위치·모드 관측으로 새 요청, 요청 해제, 위치 또는 모드를 확정하지 않으며 전이를 뒷받침하는 관측이 없으면 기존 상태를 유지한다. 기존 보호 허가는 확인된 Good(true)를 요구하며 기존 하드 시간 제한은 계속 적용된다. 새 START 입력이나 전역 재시작 정책은 추가하지 않는다.

```ghost
// Source revision: issue531-producer-quality-pc06-v1
control TimerPatterns {
  input on_delay_request, off_delay_request, limited_request, stop_ok: Bool;
  output on_delayed, off_delayed, limited_run: Bool;

  let on_delay_request_true = case on_delay_request { ok(value) => value; fault(_) => false; };
  let on_delay_request_false = case on_delay_request { ok(value) => !value; fault(_) => false; };
  let off_delay_request_true = case off_delay_request { ok(value) => value; fault(_) => false; };
  let off_delay_request_false = case off_delay_request { ok(value) => !value; fault(_) => false; };
  let limited_request_true = case limited_request { ok(value) => value; fault(_) => false; };
  let limited_request_false = case limited_request { ok(value) => !value; fault(_) => false; };
  let stop_ok_true = case stop_ok { ok(value) => value; fault(_) => false; };
  let stop_ok_false = case stop_ok { ok(value) => !value; fault(_) => false; };

  let on_delay = 2s;
  let off_delay = 3s;
  let max_run = 10s;

  type OnPhase = OnIdle | OnWaiting | OnActive;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  state on_phase: OnPhase = OnIdle;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  timer on_age = elapsed(on_phase);

  type OffPhase = OffIdle | OffActive | OffHolding;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  state off_phase: OffPhase = OffIdle;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  timer off_age = elapsed(off_phase);

  type LimitPhase = LimitIdle | LimitRunning | LimitReached;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  state limit_phase: LimitPhase = LimitIdle;
  // ghostflow:link id=GF-INT-PC06-INDEPENDENT-TIMERS-V1 relation=implements
  timer limit_age = elapsed(limit_phase);

  on_phase' = case on_phase {
    OnIdle => if stop_ok_true && on_delay_request_true then OnWaiting else OnIdle;
    OnWaiting =>
      if !stop_ok_true || on_delay_request_false then OnIdle
      else if on_delay_request_true && on_age >= on_delay then OnActive
      else OnWaiting;
    OnActive => if !stop_ok_true || on_delay_request_false then OnIdle else OnActive;
  };

  off_phase' = case off_phase {
    OffIdle => if stop_ok_true && off_delay_request_true then OffActive else OffIdle;
    OffActive =>
      if !stop_ok_true then OffIdle
      else if off_delay_request_false then OffHolding
      else OffActive;
    OffHolding =>
      if !stop_ok_true then OffIdle
      else if off_delay_request_true then OffActive
      else if off_age >= off_delay then OffIdle
      else OffHolding;
  };

  limit_phase' = case limit_phase {
    LimitIdle => if stop_ok_true && limited_request_true then LimitRunning else LimitIdle;
    LimitRunning =>
      if !stop_ok_true || limited_request_false then LimitIdle
      else if limit_age >= max_run then LimitReached
      else LimitRunning;
    LimitReached =>
      if !stop_ok_true || limited_request_false then LimitIdle
      else LimitReached;
  };

  on_delayed <- on_phase' == OnActive;
  off_delayed <- off_phase' == OffActive || off_phase' == OffHolding;
  limited_run <- limit_phase' == LimitRunning;
}
```

각 상태와 타이머는 서로 독립적이다. 따라서 OFF-delay 채널의 운전 요구를 놓은 뒤 3초를
기다리는 동안에도 LIMIT의 10초 최대시간은 별도의 `limit_age`로 계산된다.
LIMIT가 `LimitReached`에 도달하면 수요가 계속 참이어도 자동으로 다시
`LimitRunning`으로 돌아가지 않는다. 수요를 놓았다가 다시 요청해야 새 운전이
시작된다. 출력은 현재 상태가 아니라 계산된 다음 상태에서 읽으므로 상태가
전이되는 tick에 출력도 그 결과를 반영한다.

검증기는 같은 논리 시각과 입력 테이프를 x1, x1000 두 가지 벽시계 pacing
라벨로 실행한다. 실제로 기다리거나 VM 입력을 변형하지 않으며 두 결과가
같아야 한다. 이 비교는 제어 로직이 웹 호스트의 가속 구현이 아니라 논리
`nowMs`에 의존한다는 것을 보여 준다.
