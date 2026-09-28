<!-- translation-source: examples/tutorial/01-latch.ghost.md -->
[English original](01-latch.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 자기유지 펌프 튜토리얼

링크된 원본 문서가 작은 제어의 정본이다. `01-latch.ghost`는 실행 불가한 과거 증거로만 보존한다.
Markdown 설명은 실행되지 않으며 최상위 `ghost` 코드 블록만 소스다.

새 시작 입력이 없으면 `watering` 상태는 이전 값을 유지한다. 두 입력이 한 tick에 모두
true여도 정지 요청이 시작보다 우선한다.

```ghost
control LatchingPump {
  input start: Bool;
  input stop: Bool;

  output pump, valve: Bool;
  state watering: Bool = false;

  // stop wins when start and stop arrive in the same tick.
  watering' = !stop && (start || watering);

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
