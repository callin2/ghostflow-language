<!-- translation-source: examples/irrigation.ghost.md -->
[English original](irrigation.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 관개 런타임 픽스처

링크된 원본이 정본 리터레이트 픽스처이며 이식 가능한 코어의 호스트 테스트에 사용된다. 이는 가상
제어 픽스처이며 하드웨어나 배포 증거가 아니다.

명시적 revision issue531-approved-fault-restart-v1은 정상 STOP과 저수위 보호의
우선순위를 유지한다. START 고장은 새 시작을 차단하며 STOP/저수위 입력 고장은
운전을 해제한다. 복구 후 정상 START를 껐다 켜야 재시작한다. 고장의 품질과
이유는 취득 및 Result trace에 남고 low_fault는 보호 조건의 발생 또는 사용할 수
없는 상태를 기록한다. 정확한 이전 문서는 tests/fixtures/history/issue531에 보존한다.
물리 START 버튼이나 하드웨어 검증을 의미하지 않는다.

```ghost
control irrigation {
  input start, stop, low_water: Bool;
  input moisture: Number;
  state watering: Bool = false;
  state low_fault: Bool = false;
  state restart_blocked: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let low_good = case low_water { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);
  let low_requested = low_water |> recover(true);
  output pump, valve: Bool;

  // Revision issue531-approved-fault-restart-v1: protection faults release the run.
  low_fault' = low_requested;
  restart_blocked' = if !start_good || !stop_good || !low_good then true
                     else if !start_requested then false else restart_blocked;
  watering' = if stop_requested || low_requested then false
              else watering || (start_requested && !restart_blocked);
  pump <- watering';
  valve <- watering';
}
```
