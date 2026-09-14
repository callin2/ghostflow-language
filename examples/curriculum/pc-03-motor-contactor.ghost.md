# PC-03 — 모터 접촉기 명령과 과부하 허가

> 교육용 시나리오: PC-02의 자기유지에 모터의 과부하 보호 허가를 하나
> 추가한다. 이 문서는 직접 사용자 발화가 아니라 curriculum/learning
> scenario를 정의한다.

이 문서가 PC-03의 유일한 canonical literate 실행 원본이다. PC-02의 새 시작
사건과 재시작 억제를 재사용하고, 기존 교재 [E03](../../docs/ProgrammingInGhostflow.md#ch03)의
기본 자기유지 예제도 보존한다.

`stop_ok`와 `overload_ok`는 이미 의미가 정규화된 permission 입력이다. 실제
정지 버튼과 과부하 계전기의 NC 배선 및 접점 극성은 전기·장치 어댑터의
범위이며 이 학습 예제는 Bool만 받는다.

```ghost
control MotorContactor {
  input start, stop_ok, overload_ok: Bool;
  output motor_contactor: Bool;

  state armed: Bool = false;
  state running: Bool = false;

  let permit = stop_ok && overload_ok;
  let start_event = armed && start;

  running' = permit && (start_event || running);
  armed' = permit && !start;

  motor_contactor <- running';
}
```

`motor_contactor`는 MC 코일에 보낼 논리 명령이다. 이것은 주접점이 실제로
닫혔다는 증거, 모터에 전원이 공급된다는 증거, 모터가 회전한다는 증거가
아니다. 과부하 계전기가 trip하여 운전 중 `overload_ok=false`가 되면 다음
상태와 명령이 즉시 꺼진다. 보호가 복귀해도 START를 계속 누른 상태에서는
`armed`가 되지 않으므로 자동 재시작하지 않는다. START를 놓아 새 시작을
허가한 뒤 다시 눌러야 한다.

설비에서 주회로는 차단기 → MC 주접점 → 과부하 계전기 → 모터의 전력 경로다.
제어회로는 제어전원에서 STOP·과부하 보호접점과 START/MC 보조접점 자기유지
분기를 거쳐 MC 코일을 여자하는 경로다. 소프트웨어의 코일 명령은 독립적인
전기적 과전류·비상정지·보호 기능을 대체하지 않는다.

이 예제에는 alarm 출력, fault latch/reset, timer, 센서 피드백, 하드웨어 동작,
새 GhostFlow 문법이 없다. 그것들은 뒤의 학습 단계에서 별도로 다룬다.

검증은 `tools/check-pc-03.mjs`가 현재 compiler와 기존 WASM으로 수행하는
virtual/compiler/WASM learning evidence다. 릴레이, MC 주접점, 모터 전원,
모터 회전의 physical evidence는 이 checker의 결과에 포함되지 않는다.
