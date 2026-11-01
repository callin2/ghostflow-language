<!-- translation-source: examples/station-rules.ghost.md -->
[영문 원문](station-rules.ghost.md)

# 공유 스테이션 정책

이 정본 문서형 소스는 공유 펌프 하나에 대한 호스트 소유 스테이션 한도와 모드
인터록을 선언합니다. 유한한 **Station adapter profile**, 즉 `ghostrules`와
`bindStationPolicy`가 소비하는 고정된 유한 규칙 집합입니다. 일반적인
control 소유 제약 문법이 아닙니다.

이 profile에는 구체적인 소비자가 두 개 있습니다. station 데모와
programming-book의 Station WASM 테스트입니다. 이 profile은 이 소비자들이 계속
동작하도록 유지됩니다. 임의의 공유 자원 출력 정책을 가능하게 하지는 않습니다.

호스트는 다음을 명시적으로 바인딩해야 합니다.

- station, pump1, settings, starts의 identity(정체성)
- 모드와 활동(activity) 별칭
- 유한한 밸브 개수(valve-count) 설정

완전한 바인딩과 실행 가능한 Station 생명주기는
`tests/programming-book-simulation.test.mjs`와 `tests/policy.test.mjs`에서
검사합니다. 고정된 Station 계약이 정지 동작을 소유하며, 이 소스는 일반적인 물리
안전 시퀀스를 정의하지 않습니다. `check pump_capacity`는 권고용일 뿐입니다.
control 하나가 소유하는 완전한 local 허용 범위는
[constraint-envelope.ghost.md](constraint-envelope.ghost.md)를 보세요.

`Station::session_actual_on_ms(session_id)`(Rust)와 WASM 래퍼의
`sessionActualOnMs(sessionId)`는 일치하는 활성 세션에서 적용된 펌프 ON 시간의
누적값을 밀리초 단위로 읽습니다.

- WASM 결과는 정확한 `BigInt`입니다.
- getter는 시간을 진행하지 않습니다. `advance`를 포함한 기존의 시각 지정 Station
  연산이 호스트의 `reportApplied` 상태를 적분합니다.
- OFF 구간에서도 세션 합계는 유지됩니다. 예를 들어 10초 ON, 10초 OFF, 다시 20초
  ON이면 시각 40,000ms에서 `30_000n`이 됩니다.
- `dailyUsedMs`는 세션이 durable하게 종료(finish)될 때까지 정산되지 않습니다.
- 없거나, ID가 다르거나, 종료되었거나, 복원된 세션은 0을 반환하지 않습니다.
  Rust는 `SessionMismatch`를 반환하고 래퍼는 예외를 던집니다.
- 복원은 기존의 보수적인 예약과 복구 계약을 유지합니다. 활성 세션의 카운터는
  복원하지 않습니다.

이 관찰값은 유한한 Station adapter에만 속합니다. 일반적인 작업 카운터, phase
age, 연속 ON 타이머, 또는 요청·안전·확인된 출력의 accounting(사용량 집계)을
정의하지 않습니다. 호스트 테스트의 applied 상태는 픽스처이며 물리 피드백이
아닙니다.
[Reference §3.4](../docs/reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)에서
구분한 내용은 [#208](https://github.com/callin2/ghostflow-language/issues/208)의
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
