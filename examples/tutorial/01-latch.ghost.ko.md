<!-- translation-source: examples/tutorial/01-latch.ghost.md -->
[English original](01-latch.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 자기유지 펌프 튜토리얼

링크된 원본 문서가 작은 제어의 정본이다. `01-latch.ghost`는 실행 불가한 과거 증거로만 보존한다.
Markdown 설명은 실행되지 않으며 최상위 `ghost` 코드 블록만 소스다.

새 시작 입력이 없으면 `watering` 상태는 이전 값을 유지한다. 두 입력이 한 tick에 모두
true여도 정지 요청이 시작보다 우선한다.

새 revision `issue531-approved-fault-restart-v1`은 입력 고장 정책을 명시한다.
START 고장은 새 시작을 차단하지만 STOP이 정상이고 해제되어 있으면 기존 운전을
유지한다. STOP 고장은 운전을 해제한다. 고장으로 정지한 후에는 입력이 정상으로
복구되고 START를 껐다 켜야 재시작한다. 물리 버튼의 존재를 강제하지 않는다.
이전 문서의 정확한 bytes는 tests/fixtures/history/issue531에 보존되어 있다.

```ghost
control LatchingPump {
  input start: Bool;
  input stop: Bool;

  output pump, valve: Bool;
  state watering: Bool = false;
  state restart_blocked: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);

  // Revision issue531-approved-fault-restart-v1: explicit authored fault policy.
  // Faults block restart until a healthy START off-to-on request.
  restart_blocked' = if !start_good || !stop_good then true
                     else if !start_requested then false else restart_blocked;
  watering' = !stop_requested && (watering || (start_requested && !restart_blocked));

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

함께 제공된 CSV의 기대 추적:

| tick | start | stop | watering' | pump / valve |
|---:|:---:|:---:|:---:|:---:|
| 1 | true | false | true | on / on |
| 2 | false | false | true | on / on |
| 3 | true | true | false | off / off |
| 4 | false | false | false | off / off |
| 5 | true | false | true | on / on |
