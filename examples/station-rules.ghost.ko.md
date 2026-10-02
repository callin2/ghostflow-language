<!-- translation-source: examples/station-rules.ghost.md -->
[English original](station-rules.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 공용 관측소 정책

링크된 원본 정본 제약 문서는 공용 펌프 하나에 대한 호스트 소유 관측소 한도와 모드 인터록을
선언한다.

이 문서는 일반 control-owned 제약 문법이 아니라 `ghostrules`와
`bindStationPolicy`가 소비하는 유한한 **Station adapter profile**입니다.
실제 소비자는 station demo와 programming-book의 Station WASM 검사입니다.
이 소비자를 위해 profile을 유지하며, 임의의 공유 자원 출력 정책을 제공하는
것은 아닙니다.

호스트는 station, pump1, settings, starts의 identity와 mode/activity alias,
유한한 valve-count 설정을 명시적으로 binding해야 합니다. 완전한 binding과
실행 가능한 Station 생명주기는 `tests/programming-book-simulation.test.mjs`와
`tests/policy.test.mjs`에서 검사합니다. 고정된 Station 계약이 stop 동작을
소유하며, 이 소스는 일반적인 물리 안전 시퀀스를 정의하지 않습니다.
`check pump_capacity`는 권고 검사입니다. control 하나의 완전한 local 허용 범위는
[constraint-envelope.ghost.md](constraint-envelope.ghost.md)를 보세요.

```ghost
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
}
```
