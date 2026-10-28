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

`Station::session_actual_on_ms(session_id)`와 WASM wrapper의
`sessionActualOnMs(sessionId)`는 ID가 일치하는 활성 세션의 적용된 펌프 ON
누적 밀리초를 읽습니다. WASM 결과는 정확한 `BigInt`입니다.
getter는 시간을 진행하지 않습니다. `advance`를 포함한 기존 Station의
시각 지정 연산이 호스트의 `reportApplied` 상태를 적분합니다.
10초 ON, 10초 OFF, 20초 ON이면 시각 40,000ms에서 `30_000n`입니다.
OFF 구간에도 세션 누적값을 유지합니다. `dailyUsedMs`는 durable finish에서
정산합니다. 없거나 ID가 다르거나 종료·복원된 세션은 0을 반환하지 않고
Rust에서 `SessionMismatch`를 반환하며 wrapper에서는 예외를 던집니다.
복원은 기존의 보수적인 예약량과 recovery 계약을 유지하며 활성 세션의
카운터를 복원하지 않습니다.

이 관측값은 유한한 Station adapter에 속합니다. 일반 작업 카운터, phase age,
연속 ON timer, requested·safe·confirmed 출력 accounting을 정의하지 않습니다.
호스트 검사의 applied 상태는 fixture이며 물리 피드백이 아닙니다.
[Reference §3.4](../docs/reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)의
구분은 [#208](https://github.com/callin2/ghostflow-language/issues/208)의
별도 계약으로 남습니다.

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
