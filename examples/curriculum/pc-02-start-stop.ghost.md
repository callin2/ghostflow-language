# PC-02 — START / STOP 자기유지와 새 시작 허가

> 학습 시나리오: START를 눌러 운전을 시작하고, STOP이 들어오면 즉시
> 멈춘다. STOP에서 복귀할 때 START를 계속 누르고 있더라도, START를
> 놓았다가 다시 눌러야 재시작한다.

이 문서는 PC-02의 유일한 실행 원본이다. 기본 자기유지와 `pump`가 `valve`를
요구하는 관계는 교재 [E03](../../docs/ProgrammingInGhostflow.md#ch03)에
보존되어 있다. 여기서는 그 위에 정지 경로, 새 시작 사건, 재시작 억제를 명시한다.

`stop_ok`는 정지 경로가 허용된 논리 입력이다. STOP이 활성화되면 `false`가
공급된다. 실제 STOP 접점의 NO/NC 극성과 전기적 안전회로는 장치 어댑터의
입력 의미이며, 이 가상 예제는 정규화된 Bool만 받는다.

```ghost
control StartStopPump {
  input start, stop_ok: Bool;
  output valve, pump: Bool;

  state armed: Bool = false;
  state running: Bool = false;

  let start_event = armed && start;

  running' = stop_ok && (start_event || running);
  armed' = stop_ok && !start;

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
