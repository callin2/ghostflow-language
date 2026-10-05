# PC-04 — 정회전·역회전 방향전환 인터록

<!-- ghostflow:anchor id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 kind=intent status=confirmed origin=imported -->
> 교육용 시나리오: 사용자가 제공한 PLC 대체 교육과정의 정회전/역회전 단계를
> 바탕으로 만든 학습 시나리오다. 직접 사용자 발화를 그대로 인용한 문서가 아니다.

이 문서가 PC-04의 유일한 canonical literate 실행 원본이다. 기존 교재
[E06 DirectionInterlock](../../docs/ProgrammingInGhostflow.md#e06--두-방향을-동시에-요청하면)을
보존하고 참조한다. E06은 동시 출력 요청을 차단하는 작은 안전 제약을 보여 주며,
이 과는 그 위에 새 시작 사건, 정지 상태, 방향전환 대기를 명시한다.

`forward_start`와 `reverse_start`는 누르고 있는 동안 참인 momentary 입력이다.
`stop_ok`와 `overload_ok`는 각각 정지 경로와 과부하 보호가 정상일 때 참인
정규화 입력이다. 출력은 모터의 실제 회전이 아니라 정회전/역회전 접촉기 코일에
보낼 논리 명령이다.

```ghost
control DirectionChangeInterlock {
  input forward_start, reverse_start, stop_ok, overload_ok: Bool;
  output forward_contactor, reverse_contactor: Bool;

  let reversal_wait = 2s;

  type Phase = Stopped | Forward | Reverse | WaitForward | WaitReverse;
  // ghostflow:link id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 relation=implements
  state phase: Phase = Stopped;
  // ghostflow:link id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 relation=implements
  state start_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC04-DIRECTION-INTERLOCK-V1 relation=implements
  timer age = elapsed(phase);

  let permit = stop_ok && overload_ok;
  let ambiguous = forward_start && reverse_start;
  let forward_event = start_armed && forward_start && !reverse_start;
  let reverse_event = start_armed && reverse_start && !forward_start;

  start_armed' = permit && !forward_start && !reverse_start;

  phase' = case phase {
    Stopped =>
      if !permit || ambiguous then Stopped
      else if forward_event then Forward
      else if reverse_event then Reverse
      else Stopped;

    Forward =>
      if !permit || ambiguous then Stopped
      else if reverse_event then WaitReverse
      else Forward;

    Reverse =>
      if !permit || ambiguous then Stopped
      else if forward_event then WaitForward
      else Reverse;

    WaitForward =>
      if !permit || ambiguous then Stopped
      else if reverse_event then WaitReverse
      else if age >= reversal_wait then Forward
      else WaitForward;

    WaitReverse =>
      if !permit || ambiguous then Stopped
      else if forward_event then WaitForward
      else if age >= reversal_wait then Reverse
      else WaitReverse;
  };

  forward_contactor <- phase' == Forward;
  reverse_contactor <- phase' == Reverse;
  mutex(forward_contactor, reverse_contactor);
}
```

정상 운전 중 반대 방향의 새 누름을 받으면 `WaitForward` 또는 `WaitReverse`로
진입한다. 그 전이의 `phase'`가 대기 상태이므로 두 접촉기 명령은 그 tick에
즉시 모두 꺼진다. 대기 중 2초가 경과한 뒤에만 반대 방향 명령을 낸다. 같은
방향 버튼을 계속 누르고 있는 것은 새 방향전환 사건이 아니다. 두 버튼을 동시에
누르거나 정지/과부하 허가가 사라지면 대기 중에도 `Stopped`로 취소한다.
대기 중 작업자가 반대쪽 새 버튼을 눌러 목표 방향을 다시 바꾸면 대응하는 Wait 상태로
옮기고 2초를 처음부터 다시 센다. 따라서 이전 목표 방향으로 뒤늦게 기동하지 않는다.

`mutex`는 소프트웨어 안전 backstop이다. 실제 설비에는 정·역 접촉기의 전기적
상호 인터록과 기계적 인터록이 별도로 필요하다. 2초 대기는 모터가 실제로
정지했다는 증거가 아니며, zero-speed feedback도 이 교육 예제의 입력에는 없다.
따라서 이 checker의 PASS는 접촉기 코일 명령의 virtual/compiler/WASM trace만
뜻하고, 접점 폐쇄·전원 인가·모터 회전의 physical acceptance가 아니다.

`tools/check-pc-04.mjs`는 각 사례마다 새 WASM runtime을 만들고 기존 WASM을
재빌드하지 않는다. 동시 요청 차단과 재무장, 정상 자기유지, 방향전환 직후의
양쪽 OFF, 1999ms 대기, 정확히 2000ms 뒤 반대 방향 ON, 대기 중 stop/overload
취소, 대기 중 목표 변경과 대기시간 재시작을 실제 compiler/WASM trace로 확인한다.
