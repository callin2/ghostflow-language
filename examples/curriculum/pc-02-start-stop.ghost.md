# PC-02 — START / STOP 자기유지와 새 시작 허가

<!-- ghostflow:anchor id=GF-INT-PC02-START-STOP-REARM-V1 kind=intent status=confirmed origin=imported -->
> 학습 시나리오: START를 눌러 운전을 시작하고, STOP이 들어오면 즉시
> 멈춘다. STOP에서 복귀할 때 START를 계속 누르고 있더라도, START를
> 놓았다가 다시 눌러야 재시작한다.

이 문서는 PC-02의 유일한 실행 원본이다. 기본 자기유지와 `pump`가 `valve`를
요구하는 관계는 교재 [E03](../../docs/ProgrammingInGhostflow.md#ch03)에
보존되어 있다. 여기서는 그 위에 정지 경로, 새 시작 사건, 재시작 억제를 명시한다.

`stop_ok`는 정지 경로가 허용된 논리 입력이다. STOP이 활성화되면 `false`가
공급된다. 실제 STOP 접점의 NO/NC 극성과 전기적 안전회로는 장치 어댑터의
입력 의미이며, 이 가상 예제는 정규화된 Bool payload와 취득 quality를 받는다.

이 명시적 새 source revision은 기존 정상 START/STOP 시나리오를 보존한다.
START 취득 fault는 새 시작을 막지만 STOP이 정상이고 허가한 현재 운전은 유지한다.
STOP 취득 fault는 운전을 지우고 OFF를 요청한다. 어느 입력이든 fault가 관측되면
`armed`를 지운다. 이후 STOP이 정상이고 운전을 허가한 상태에서 정상 START 해제를
관측한 뒤 다시 눌러야 재시작한다. 취득 fault를 정상 해제로 세어 rearm하지 않는다.
이전 원문은 `tests/fixtures/history/issue531/pc-02-start-stop.ghost.md.pre-input.txt`에 보존한다.

```ghost
// issue531-approved-fault-restart-v1: rearm requires healthy START release.
control StartStopPump {
  input start, stop_ok: Bool;
  output valve, pump: Bool;

  // ghostflow:link id=GF-INT-PC02-START-STOP-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC02-START-STOP-REARM-V1 relation=implements
  state running: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_permitted = stop_ok |> recover(false);
  let start_event = start_good && armed && start_requested;

  running' = stop_permitted && (start_event || running);
  armed' = start_good && stop_good && stop_permitted && !start_requested;

  valve <- running';
  pump <- running';

  require pump => valve;
}
```

`running`은 이전 운전 상태이고 `running'`은 이번 tick의 다음 상태다.
`armed`는 START가 해제된 것을 마지막으로 관측했는지 기억한다. 따라서 새
runtime의 첫 입력이 START를 이미 누른 상태여도 `start_event`가 거짓이고,
STOP에서 복귀할 때도 START를 놓기 전에는 운전을 허가하지 않는다.

이 예제는 실제 릴레이 접점, 모터 회전, 배선 안전회로를 검증하지 않는다.
전용 checker는 실제 GhostFlow compiler와 기존 WASM `ControlRuntime`으로
`stateBefore`, `stateAfter`, `requested`, `safe` 프레임을 비교한다.
