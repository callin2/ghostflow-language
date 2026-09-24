# PC-05 — 리미트 피드백과 밸브 방향전환

<!-- ghostflow:anchor id=GF-INT-PC05-LIMIT-FEEDBACK-V1 kind=intent status=confirmed origin=imported -->
> 교육용 시나리오: 사용자가 제공한 PLC 대체 교육과정의 리미트 스위치 단계를
> 바탕으로 만든 학습 시나리오다. 직접 사용자 발화를 그대로 인용한 문서가 아니다.

이 문서가 PC-05의 유일한 canonical literate 실행 원본이다. 기존 교재
[E06 DirectionInterlock](../../docs/ProgrammingInGhostflow.md#e06--두-방향을-동시에-요청하면)과
[PC-04 방향전환 인터록](./pc-04-direction-interlock.ghost.md)을 보존하고 참조한다.
E06의 `mutex`는 동시 출력 차단을, PC-04의 대기 상태는 반대 방향으로 바로
전환하지 않는 방법을 보여 준다. 이 과는 여기에 밸브의 실제 끝 위치 관측을
추가한다.

`open_request`와 `close_request`는 누르고 있는 동안 참인 momentary 요청이다.
`open_limit`와 `close_limit`은 정규화된 끝 위치 관측이며, 참이면 각각 열린
끝·닫힌 끝에 도달했다는 뜻이다. 출력은 밸브가 실제로 움직였다는 증거가 아니라
열림·닫힘 접촉기 코일에 보낼 논리 명령이다.

```ghost
control LimitFeedbackValve {
  input open_request, close_request, open_limit, close_limit, stop_ok, overload_ok: Bool;
  output valve_open_contactor, valve_close_contactor: Bool;

  let reversal_wait = 2s;

  type Phase = Stopped | Closed | Opening | Open | Closing | WaitOpen | WaitClose | SensorConflict;
  // ghostflow:link id=GF-INT-PC05-LIMIT-FEEDBACK-V1 relation=implements
  state phase: Phase = Stopped;
  // ghostflow:link id=GF-INT-PC05-LIMIT-FEEDBACK-V1 relation=implements
  state request_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC05-LIMIT-FEEDBACK-V1 relation=implements
  timer age = elapsed(phase);

  let permit = stop_ok && overload_ok;
  let conflict = open_limit && close_limit;
  let ambiguous = open_request && close_request;
  let open_event = request_armed && open_request && !close_request;
  let close_event = request_armed && close_request && !open_request;

  request_armed' = permit && !conflict && !open_request && !close_request;

  phase' = case phase {
    Stopped =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if open_event then Opening
      else if close_event then Closing
      else if open_limit && !close_limit then Open
      else if close_limit && !open_limit then Closed
      else Stopped;

    Closed =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if open_event then Opening
      else if close_limit && !open_limit then Closed
      else if open_limit && !close_limit then Open
      else Stopped;

    Opening =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if close_event then WaitClose
      else if open_limit then Open
      else Opening;

    Open =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if close_event then Closing
      else if open_limit && !close_limit then Open
      else if close_limit && !open_limit then Closed
      else Stopped;

    Closing =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if open_event then WaitOpen
      else if close_limit then Closed
      else Closing;

    WaitOpen =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if close_event then WaitClose
      else if open_limit then Open
      else if age >= reversal_wait then Opening
      else WaitOpen;

    WaitClose =>
      if conflict then SensorConflict
      else if !permit || ambiguous then Stopped
      else if open_event then WaitOpen
      else if close_limit then Closed
      else if age >= reversal_wait then Closing
      else WaitClose;

    SensorConflict =>
      if conflict then SensorConflict
      else if open_limit && !close_limit then Open
      else if close_limit && !open_limit then Closed
      else Stopped;
  };

  valve_open_contactor <- phase' == Opening;
  valve_close_contactor <- phase' == Closing;
  mutex(valve_open_contactor, valve_close_contactor);
}
```

모든 상태에서 두 끝 위치가 동시에 참이면 `SensorConflict`가 최우선이고 출력은
꺼진다. 허가 상실이나 두 요청의 동시 입력도 `Stopped`로 만들며 출력은 꺼진다.
처음에는 물리적 위치를 지어내지 않고 `Stopped`에서 시작한다. 그 뒤 정확히 한
끝 위치가 관측될 때만 `Open` 또는 `Closed`로 재조정한다.
정지된 끝 상태에서도 해당 limit 관측이 사라지면 과거 상태만 믿지 않고
`Stopped`로 돌아간다. 반대쪽 limit만 관측되면 그 물리 관측으로 끝 상태를
재조정한다.

이동 중 목표 끝 위치가 관측되면 해당 상태로 멈춘다. 반대 방향의 새 요청이 같은
tick에 들어오면 끝 위치보다 그 새 사건이 우선해 `WaitOpen` 또는 `WaitClose`로
가고 양쪽 명령을 즉시 끈다. 2초가 정확히 경과한 뒤에만 이동을 재개하므로 작업자
요청이 조용히 사라지지 않는다. 대기 중 새 반대 요청은 목표를 바꾸고 전체 대기
시간을 다시 센다.

끝 위치가 오지 않는 경우에는 `Opening` 또는 `Closing`에 남아 명령이 계속 켜진다.
이는 의도적으로 누락된 timeout을 드러내는 학습용 사례이며 배포 가능한 하드웨어
인수가 아니다. PC-10에서 timeout, fault latch, reset을 추가해야 한다. `mutex`는
소프트웨어 backstop일 뿐이고 실제 전기·기계 인터록과 zero-speed 또는 위치 피드백
배선을 대체하지 않는다.

`tools/check-pc-05.mjs`는 각 사례마다 새 WASM `ControlRuntime`을 만들고 기존
WASM을 재빌드하지 않는다. 검사 결과는 compiler/WASM virtual trace이며 접점 폐쇄,
밸브 이동, 유체 흐름의 physical evidence가 아니다.
