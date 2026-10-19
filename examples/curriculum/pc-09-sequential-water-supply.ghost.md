# PC-09 — 밸브·펌프 순차 급수

<!-- ghostflow:anchor id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 kind=intent status=confirmed origin=imported -->
> 교육용 시나리오: 밸브가 열린 위치를 확인한 다음 펌프를 운전하고, 급수
> 시간이 끝나면 펌프를 먼저 멈춘 뒤 밸브를 닫는다. 출력 명령과 장치의
> 물리적 위치를 분리해 표현한다.

이 문서는 PC-09의 유일한 canonical literate 실행 원본이다. 기존
[tutorial/02 시간 순차제어](../tutorial/02-watering.ghost.md)와
[tutorial/04 공유 펌프 예제](../tutorial/04-extra-valves.ghost.md)를 보존하고
대조한다. tutorial/02는 시간만으로 단계를 이어 가는 기본 예제이고, tutorial/04는 여러
control이 공유 펌프를 사용할 때의 별도 중재 문제를 보여 준다. 이 과는 그
둘을 대체하지 않고, 하나의 급수 순서 안에서 밸브 피드백과 펌프 선행 정지를
추가한다.

## 의도와 정규화

사용자는 “급수를 시작하면 밸브를 열고, 열린 것을 확인한 다음 펌프를
5분 돌려 주세요. 펌프를 먼저 멈추고 밸브를 닫아 주세요”라고 설명할 수
있다. GhostFlow는 그 의도를 다음처럼 정규화한다.

- `start_request`는 순간적인 새 급수 요청이다. 닫힌 위치를 확인하고 요청이
  해제된 안정 scan을 본 뒤 다시 들어온 요청만 새 운전으로 인정한다.
- `open_limit`와 `close_limit`은 장치 위치의 관측값이다. 접촉기 출력이 켜진
  것만으로 밸브가 실제로 움직였다고 간주하지 않는다.
- 밸브가 열린 뒤 `settle_delay`만큼 열린 피드백을 계속 유지해야 펌프를
  시작한다. 펌프는 `watering_time` 동안 운전한다.
- 급수 시간이 끝나는 경계 scan에서 펌프를 끄고, 다음 논리 scan은 모든
  출력이 꺼진 `PumpStopping`으로 둔다. 그 다음 scan부터 밸브를 닫는다.
- `stop_ok` 또는 `overload_ok`가 사라지면 즉시 `Interrupted`, 두 limit가
  동시에 참이면 우선 `FeedbackFault`가 되며 모든 출력은 꺼진다. 복구만으로
  자동 재시작하지 않는다.

## GhostFlow source

이 명시적 input revision은 생산자 품질을 사용하며 버튼의 물리적 고장을 추론하지 않는다. Good(false)는 정상 관측이다. 미상 요청으로 새 요청이나 요청 해제를 확정하지 않고, 미상 limit로 위치나 충돌을 확정하지 않는다. 기존 급수 시간 제한은 계속 펌프를 정지시킨다. PumpStopping에서 limit 관측 불가는 모든 출력을 끈 채 닫힘을 보류한다. Closing에서 limit 관측 불가는 Closing을 유지하고 닫힘 명령을 차단한다. 정상 닫힌 위치가 다시 관측되면 Idle로 끝나며, 그 밖의 정상 비충돌 관측에서는 닫힘을 재개한다. 이 과에는 열림·닫힘 timeout을 추가하지 않는다. 기존 보호 허가는 확인된 Good(true)를 요구한다. 새 START 입력이나 전역 재시작 정책은 추가하지 않는다.

```ghost
// Source revision: issue531-producer-quality-pc09-v1
control SequentialWaterSupply {
  input start_request, open_limit, close_limit, stop_ok, overload_ok: Bool;
  output valve_open_contactor, valve_close_contactor, pump_contactor: Bool;

  let start_request_true = case start_request { ok(value) => value; fault(_) => false; };
  let start_request_false = case start_request { ok(value) => !value; fault(_) => false; };
  let open_limit_true = case open_limit { ok(value) => value; fault(_) => false; };
  let open_limit_false = case open_limit { ok(value) => !value; fault(_) => false; };
  let close_limit_true = case close_limit { ok(value) => value; fault(_) => false; };
  let close_limit_false = case close_limit { ok(value) => !value; fault(_) => false; };
  let stop_ok_true = case stop_ok { ok(value) => value; fault(_) => false; };
  let stop_ok_false = case stop_ok { ok(value) => !value; fault(_) => false; };
  let overload_ok_true = case overload_ok { ok(value) => value; fault(_) => false; };
  let overload_ok_false = case overload_ok { ok(value) => !value; fault(_) => false; };
  let limits_good = case open_limit { ok(_) => case close_limit { ok(_) => true; fault(_) => false; }; fault(_) => false; };

  let settle_delay = 2s;
  let watering_time = 5min;

  type Phase = Idle | Opening | Settling | Watering | PumpStopping | Closing | FeedbackFault | Interrupted;
  // ghostflow:link id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 relation=implements
  state request_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC09-SEQUENTIAL-WATERING-V1 relation=implements
  timer age = elapsed(phase);

  let permit = stop_ok_true && overload_ok_true;
  let conflict = open_limit_true && close_limit_true;
  let known_closed = close_limit_true && open_limit_false;
  let start_event = request_armed && start_request_true;

  request_armed' = phase == Idle && permit && !conflict && known_closed && start_request_false;

  phase' = case phase {
    Idle =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if start_event && known_closed then Opening
      else Idle;

    Opening =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if open_limit_true && close_limit_false then Settling
      else Opening;

    Settling =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if limits_good && (open_limit_false || close_limit_true) then FeedbackFault
      else if limits_good && age >= settle_delay then Watering
      else Settling;

    Watering =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if limits_good && (open_limit_false || close_limit_true) then FeedbackFault
      else if age >= watering_time then PumpStopping
      else Watering;

    PumpStopping =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if limits_good && (open_limit_false || close_limit_true) then FeedbackFault
      else if limits_good then Closing
      else PumpStopping;

    Closing =>
      if conflict then FeedbackFault
      else if !permit then Interrupted
      else if close_limit_true && open_limit_false then Idle
      else Closing;

    FeedbackFault =>
      if conflict || !permit then FeedbackFault
      else if start_request_false && known_closed then Idle
      else FeedbackFault;

    Interrupted =>
      if conflict || !permit then Interrupted
      else if start_request_false && known_closed then Idle
      else Interrupted;
  };

  valve_open_contactor <- phase' == Opening;
  valve_close_contactor <- phase' == Closing && limits_good;
  pump_contactor <- phase' == Watering;
  mutex(valve_open_contactor, valve_close_contactor);
}
```

`Opening`, `Settling`, `Watering`, `PumpStopping`, `Closing`은 논리적 순서다.
`valve_open_contactor`와 `valve_close_contactor`는 각각 접촉기에 보낼 명령이고,
`open_limit`·`close_limit`은 위치가 실제로 관측되었음을 나타내는 입력이다.
따라서 `Opening`에 오래 남는 것은 “열림 명령이 계속 요청되고 있음”과 “열림
완료가 확인되지 않음”을 동시에 보여 주며, 밸브가 실제로 움직였다는 보장은
아니다.

tutorial/02의 time-only sequence에서는 시간이 지나면 다음 단계로 넘어가지만,
PC-09의 펌프 시작은 열린 위치 피드백과 안정 시간을 함께 요구한다. tutorial/04의
공유 펌프 사례는 여러 control이 같은 출력 자원을 요구할 때의 전역 중재가
필요하다는 별도 문제다. 이 과의 `pump_contactor`는 단일 순차 control의
출력이며, 다른 control과의 자원 중재를 해결한다고 주장하지 않는다.

응답이 없는 `Opening`과 `Closing`은 이 학습 과에서 해당 상태에 계속 남는다.
timeout, fault latch, alarm, reset, fault 발생 시 안전한 밸브 닫기 정책은
PC-10의 범위다. `mutex`와 논리 출력은 하드웨어 인터록·비상정지·과부하
보호를 대체하지 않는다.

## 검증 경계

`tools/check-pc-09.mjs`는 각 시나리오마다 새 WASM `ControlRuntime`을 만들고
기존 WASM artifact를 재빌드하지 않는다. `stateBefore`, `stateAfter`,
`requested`, `safe` 및 단조 증가 `nowMs`를 검사한다. PASS는 compiler/WASM
virtual trace가 기대와 일치한다는 뜻이며, 접촉기 폐쇄·밸브 이동·펌프 회전·
물의 흐름에 대한 physical evidence가 아니다.
