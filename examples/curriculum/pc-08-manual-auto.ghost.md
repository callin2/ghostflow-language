# PC-08 — 수동·자동 운전 모드와 공통 허가

> 교육용 시나리오: 하나의 펌프를 수동 운전과 자동 운전으로 선택하고, 두
> 모드에 공통으로 적용되는 정지·과부하 허가를 다룬다. 모드 전환이나 허가
> 복구만으로 장비가 몰래 재기동하지 않도록, 새 운전 요청을 다시 확인한다.

이 문서는 PC-08의 유일한 canonical literate 실행 원본이다. 기존
[PC-03 수동 시작·자기유지](./pc-03-motor-contactor.ghost.md)와
[PC-07 자동 수요](./pc-07-tank-hysteresis.ghost.md)를 결합하되 두 원본을
대체하지 않는다. 기존 [station mode 규칙](../station-rules.ghost.md)과
[공유 펌프 예제](../tutorial/04-extra-valves.ghost.md)는 복수 control 중재라는
고유한 심화 범위로 보존한다.

## 의도와 정규화

사용자는 “수동으로 켜거나 자동 수요가 있을 때 펌프를 운전하되, 정지 또는
과부하 허가가 사라지면 즉시 멈추고 허가가 돌아와도 저절로 다시 켜지지 않게
해 주세요”라고 설명할 수 있다. 이 문서에서 그 말을 다음처럼 정규화한다.

- `manual_mode_request`와 `auto_mode_request`는 유지되는 모드 선택 입력이다.
- 둘 다 거짓이면 `Off`, 하나만 참이면 해당 모드, 둘 다 참이면
  `ModeConflict`다. 충돌에서는 출력이 항상 꺼진다.
- `manual_start`는 순간적인 수동 시작 사건이다. 한 번 성공하면 Manual에서
  `Running`을 유지한다. 입력을 계속 누르고 있어도 허가 복구 뒤 재기동 사건으로
  재사용하지 않는다.
- `auto_demand`는 유지되는 자동 수요지만, 안정된 Auto에서 먼저 거짓을
  관찰해 재무장한 뒤 새로 참이 되어야 시작한다.
- `stop_ok`와 `overload_ok`는 두 모드의 공통 허가다. 어느 하나라도 거짓이면
  즉시 정지하고, 허가만 복구되어서는 재기동하지 않는다.

`Mode`와 `RunPhase`는 논리 상태이며 `pump_contactor`는 다음 scan의 상태를
반영하는 논리 코일 명령이다. 실제 접촉기 폐쇄, 주회로 전압, 펌프 회전은 이
예제의 증거 범위가 아니다. 실제 설비에는 비상정지·열동계전기·전기적 인터록
등의 독립적인 하드웨어 보호가 필요하다.

## GhostFlow source

```ghost
control ManualAutoPump {
  input manual_mode_request, auto_mode_request, manual_start, auto_demand, stop_ok, overload_ok: Bool;
  output pump_contactor: Bool;

  type Mode = Off | Manual | Auto | ModeConflict;
  state mode: Mode = Off;

  type RunPhase = Stopped | Running;
  state run_phase: RunPhase = Stopped;
  state request_armed: Bool = false;

  let permit = stop_ok && overload_ok;
  let requested_mode = if manual_mode_request && auto_mode_request then ModeConflict
    else if manual_mode_request then Manual
    else if auto_mode_request then Auto
    else Off;
  let mode_changed = requested_mode != mode;
  let selected_request = if requested_mode == Manual then manual_start
    else if requested_mode == Auto then auto_demand
    else false;
  let request_event = request_armed && selected_request;

  mode' = requested_mode;

  request_armed' = if mode_changed || !permit || requested_mode == Off || requested_mode == ModeConflict then false
    else if !selected_request then true
    else false;

  run_phase' = case run_phase {
    Stopped =>
      if mode_changed || requested_mode == Off || requested_mode == ModeConflict || !permit then Stopped
      else if request_event then Running
      else Stopped;

    Running =>
      if mode_changed || requested_mode == Off || requested_mode == ModeConflict || !permit then Stopped
      else if requested_mode == Auto && !auto_demand then Stopped
      else Running;
  };

  pump_contactor <- run_phase' == Running;
}
```

모드 선택이 바뀌는 scan에는 `mode'`가 새 모드를 기록하더라도
`run_phase'`는 반드시 `Stopped`가 된다. Auto에 들어올 때 이미 유지 중인
`auto_demand`는 그 scan에 시작하지 않고, Auto에서 거짓을 한 번 관찰해
`request_armed`가 참이 된 뒤 다시 참이 될 때만 시작한다. 같은
`request_armed`가 Manual의 새 START 사건도 판정하므로, 허가가 끊겼다가 돌아온
동안 계속 눌린 START 역시 재시작으로 해석되지 않는다. Auto 운전 중 수요가
사라지면 그 scan에 정지하고 다음 새 수요를 받을 준비를 한다.

## 릴레이·PLC와의 비교

릴레이/PLC에서는 모드 선택 접점, START 자기유지 접점, 공통 정지·과부하 NC
경로를 여러 rung에 반복 배치할 수 있다. GhostFlow에서는 `mode`와
`run_phase`를 별도 상태로 두고, 공통 `permit`을 모든 운전 경로의 앞단에
공유한다. 따라서 “어느 모드에서 왜 펌프가 켜졌는가”를 모드 선택 → 새 시작
사건/재무장 → 공통 허가 → 다음 상태 → 코일 연결 순서로 추적할 수 있다.

이 과는 모드와 공통 허가만 다룬다. 타이머, 순차 밸브, 장비 간 자원 충돌,
timeout/fault latch, UI, 펌웨어 export, 물리 출력 보증은 각각 후속 과제의
범위이며 이 source에 암묵적으로 추가하지 않는다.

## 검증 경계

`tools/check-pc-08.mjs`는 각 시나리오마다 새 WASM `ControlRuntime`을 만들고
같은 기존 compiler·literate extractor·adapter·WASM artifact를 사용한다.
`stateBefore`, `stateAfter`, `requested`, `safe`와 단조 증가 `nowMs`를
검증하고, 기대 레코드와 관련 실행 파일의 SHA-256을 출력한다. checker의
PASS는 virtual/compiler/WASM 논리 trace가 일치한다는 뜻이며, 실제 릴레이
동작이나 펌프 운전을 의미하지 않는다.
