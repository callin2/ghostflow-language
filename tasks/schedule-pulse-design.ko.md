<!-- translation-source: tasks/schedule-pulse-design.md -->

[영문 원본](schedule-pulse-design.md)

# Solar pulse schedule admission 설계

상태: 승인된 architecture; 범위가 제한된 native admission slice 구현 및
테스트 완료. GFB/WASM/provider binding, 자원 proof, 영속 replay는 미완료다.

## 범위와 기준

[Reference §3.5](../docs/reference/03-time-and-schedules.md#35-schedule의-공통-의미)는
schedule을 타입이 지정된 반응형 값으로 정의한다. Provider는 계획된 occurrence를
식별한다. Portable 실행은 수용된 snapshot에서 admission을 판단한다.
술어를 충족하지 못한 pulse는 종결되며 절대 대기열에 넣지 않는다. 판단은 안정된
occurrence 식별자, clock/provider 맥락, 명시적 처분을 보존한다.

첫 완전한 slice는 다음을 갖춘 Solar다.

- `basis = pulse`;
- 작성된 Bool `when` 술어;
- `clock = trusted_only`;
- `gap = skip_after(positive constant Duration)`;
- `recovery = baseline`;
- `fallback = skip`.

REF-03-042와 REF-03-045에 필요한 소스/runtime 경로를 다룬다. Daily는
IANA/DST trigger provider가 완성될 때까지 거부된다. Parser만의 수용으로는
REF-03-024를 충족하지 못한다. `window`, `run`, `hold_trusted`, `fixed_time`도
이 slice의 명시적 구현 공백으로 남는다. 전체 Reference 계약은 계속 필수다.

## 결정

### Provider fact는 admission 판단이 아니다

외부의 검증된 provider는 명시적인 coverage 구간에 대해 범위가 제한되고 완전한
Solar occurrence fact 집합을 공급한다. `.due`는 절대 공급하지 않는다.
각 fact는 provider/context revision, source local date, 안정된 source occurrence key,
계획된 wall instant와 가용 여부 또는 구체적인 temporal-context fault를 식별한다.
정적 소스 descriptor는 schedule 식별자, timezone, 위치, rise/set, offset을 공급한다.
Activation profile은 수용된 snapshot별 fact와 coverage를 제한한다.
기대 polling 주기는 이런 상한이 아니다.

이 분리는 임의 IANA provider capability를 보존한다. Portable Rust Solar 구현과
JavaScript SunCalc adapter는 각자 지원하는 zone의 reference provider로 남을 수 있다.
그러나 compiler 수용이 언어를 그 구현들로 제한하지는 않는다.
Activation은 호환되는 provider를 연결해야 한다.

### Rust가 admission과 clock 상태를 소유한다

하나의 portable Rust engine이 신뢰 clock 검증, baseline/recovery 상태,
wall 및 단조 상한 기록, gap 처분, occurrence 중복 방지, pulse 결과를 소유한다.
JavaScript는 이 상태 기계를 복제하지 않는다. Engine은 tick의 나머지 부분과
함께 준비되며 전체 VM 판단이 성공한 뒤에만 commit된다.

`ClockSnapshot`은 수용된 단조 시각, 선택적 wall time, 신뢰 여부,
clock revision, 선택적 uncertainty를 담는다. `trusted_only`에는 신뢰된
wall time이 필요하다. Wall time이 없으면 불명으로 남는다. Uncertainty가
없으면 `None`으로 남고 절대 0으로 대체하지 않는다. 다만 그 사실만으로
그 밖에는 신뢰된 wall instant를 Unknown으로 만들지는 않는다.
향후 `hold_trusted` 정책은 수용 전에 HeldClock age와 uncertainty 증가를
정의해야 한다. 이 첫 slice는 이를 구현하지 않는다.

### Prelude 순서는 의존성에 따른다

작성된 `when` 식은 input, sensor Result, 다른 stateful signal projection에
의존할 수 있다. 향후 temporal 식도 schedule projection을 소비할 수 있다.
고정된 “schedule 다음 window” 또는 “window 다음 schedule” 순서는 잘못이다.

컴파일러는 하나의 이종 same-tick prelude 의존 graph를 만든다.
각 stateful descriptor는 타입이 지정된 의존성을 기록한다.
위상 순서를 생성하고 source 위치와 함께 cycle을 거부한다. Schedule 술어는
의존성이 준비된 뒤에만 선택된 same-tick projection을 읽는다.
어떤 descriptor도 뒤의 prelude slot을 읽을 수 없다.
작성된 transition과 intent는 전체 prelude 뒤에 남는다.

## 종단 간 경로

### 소스와 컴파일러

Solar는 모든 trigger와 공통 정책 필드를 정확히 한 번씩 받는다.

```ghost
schedule dawn: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise + 30min`;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

현재 tagged Solar parser를 재사용하여 rise/set과 0을 포함하는
`[-24h, +24h]`의 정확한 정수 Duration offset을 처리한다.
공통 필드를 타입이 지정된 AST node로 파싱한다. `when`은 prelude로
컴파일되는 Bool 식이며 provider나 JavaScript host가 평가하지 않는다.
위에서 지원하는 세 정책 형태는 명시적 descriptor 값으로 lowering한다.
누락, 중복, 잘못된 형태, 미지원 정책에는 위치 정보가 있는 진단을 낸다.
현재 하드코딩된 60초, baseline, skip을 조용히 대신 넣지 않는다.

Semantic descriptor는 아직 바이트 배치를 지정하지 않으면서 다음을 담는다.

- 안정된 선언 site와 이름;
- Solar trigger fact: timezone, latitude, longitude, event, offset;
- 정책: pulse, trusted-only, 양의 gap 밀리초, baseline, skip;
- 컴파일된 Bool 술어와 이종 prelude 의존성;
- provider 요구와 생성 fact binding;
- 타입이 지정된 `.due` projection 식별자.

다음 구현 단계는 제한된 GFB wire를 명세하고 독립적으로 테스트해야 한다.
이 문서는 format version, 필드 폭, opcode를 선택하지 않는다.

### Provider와 host 경계

Native와 WASM host는 동일하게 검증된 semantic fact를 공급한다.

- clock: 단조 시각, 선택적 wall time, 신뢰 여부, clock revision, 선택적 uncertainty;
- provider coverage: 제한된 구간과 완전하게 정렬된 가용/fault fact 집합.
  각 fact는 안정된 source occurrence key, 계획된 wall time, source local date,
  provider revision, context revision을 갖는다.

Host는 envelope와 binding을 검증한다. Core는 준비 전에 영역과
descriptor/fact 관계를 다시 검증한다. 공개 ControlRuntime API는 호출자가
계산한 Solar `due` 값 대신 clock/provider fact를 받는다.
Native scan fixture도 같은 fact를 사용한다. 기존 DailySlots due 경로는
별도 대체 전까지 남는다. Provider 부재나 미지원 맥락은 사유가 있는
Unknown이 되며 일반 false가 되지 않는다.

Core 판단 API는 clock snapshot과 안정되고 제한된 provider fact coverage 집합을
받는다. 준비된 schedule projection과 관측을 반환하며, 시간을 얻거나
provider를 조회하거나 영속 Station ledger를 변경하지 않는다.

Host는 현재 및 이전 local date만 열거하고 완전하다고 해서는 안 된다.
허용된 gap은 여러 Solar occurrence를 포함할 수 있다. Coverage 누락은
occurrence가 없었다는 증거가 아니라 Unknown이다.

### Portable admission

수용된 snapshot마다 Rust engine은 다음을 수행한다.

1. 공급된 영역과 연속 수용된 단조 delta 및 양의 wall delta를 검증한다.
2. 첫 사용이나 복구 때 catch-up 없이 baseline을 설정한다.
3. 완전한 provider coverage를 검증하고 provider revision과 독립적으로
   통과한 모든 Solar occurrence를 식별한다.
4. 이전 유효 wall instant와 현재 유효 wall instant 사이의 각 crossing을
   감지한다. 신뢰된 wall 상한 기록은 별개이며 보정과 중복 방지에 쓰고,
   crossing 구간으로 쓰지 않는다.
5. 연속 수용된 단조 delta와 양의 wall delta에 `skip_after`를 적용한다.
   작성된 상한보다 큰 delta가 admission과 교차하면 해당 occurrence를
   `ObservationGap`으로 종결한다. Delta는 상한 기록에서 계산하지 않는다.
6. 정확히 crossing tick에서 컴파일된 술어를 평가한다.
7. 참이면 한 번 admit하고, 거짓이면 `ConditionsFalseAtPulse`로 종결한다.
8. `fallback = skip`을 거쳐 Unknown 사유/revision을 보존하며
   `.due = false`로 투영한다.
9. 상한 기록, 처분, 관측을 VM 트랜잭션과 함께 준비한다.

Wall rollback은 occurrence를 다시 준비 상태로 만들지 않는다.
Provider 보정은 metadata를 바꾸며 안정된 occurrence 식별자는 바꾸지 않는다.
이후 식이나 intent가 실패하면 schedule 후보를 rollback하므로
동일하게 수용된 재시도는 crossing을 한 번 본다.

### 선택된 동작: 여러 crossing

작성된 gap 상한이 하루보다 길면 하나의 수용 구간에서 여러 Solar occurrence를
통과할 수 있다. 연속 수용된 scan이 같은 schedule의 새 occurrence를 두 개 이상
통과하면 새로 통과한 모든 occurrence를 missed로 종결하고 아무것도 admit하거나
실행하지 않는다. 새로 통과한 occurrence가 하나면 일반 pulse admission을 따른다.
Engine과 wire는 여전히 제한되고 완전한 coverage fact를 담아야 한다.
어떤 구현도 scan 주기로 occurrence coverage를 도출해서는 안 된다.

### Native admission slice 근거

`crates/ghostflow-core/src/solar_admission.rs`는 연결된 schedule 하나의
준비된 clone-before-commit clock/terminal ledger를 소유한다.
Baseline, crossing 하나의 술어 admission 또는 종결 false, 상한 기록 전
보정 억제, observation-gap 종결, multiple-crossing missed/미실행,
명시적 술어 평가, 오래된 stage 거부, stage 폐기를 통한 rollback을 검증한다.
집중 사례 7건은 `crates/ghostflow-core/tests/solar_admission.rs`에 있다.
`build/solar-admission-red.log`는 최초 API 누락을 기록하고,
`build/solar-admission-green7.log`는 현재 9/9 통과를 기록한다.
이는 범위가 제한된 native 선행 구현이다. 완전한 provider coverage,
IANA 지원, source lowering, GFB/WASM ABI, settings binding, 영속 replay를 주장하지 않는다.

### Runtime, trace, replay

GFB prelude는 타입이 지정된 Bool `.due` projection을 생성한다.
Runtime, legacy WASM, framed WASM, native ScanDriver는 모두 같은 Rust
admission engine을 실행한다. Checkpoint와 replay는 clock 상한 기록,
trust/recovery 상태, occurrence 종결 기록, 정확한 prelude 의존 상태를 보존한다.

수용된 각 scan은 Bool과 별도로 schedule 관측을 담는다.

- schedule site/name과 검증된 definition 식별자;
- `False | Due | Unknown(reason)`;
- `Before`, `PredicateFalse`, `AlreadyAdmitted`,
  `ConditionsFalseAtPulse`, `ObservationGap` 등의 처분;
- 알려진 경우 안정된 occurrence 식별자, 계획된 wall time, source local date;
- provider, context, clock revision;
- 선택된 술어 의존성과 fallback projection.

Replay는 live provider를 조회하지 않고 이 기록과 `.due`를 재현해야 한다.
거부된 scan은 준비된 schedule 관측을 공개하지 않는다.

### Manifest, source trace, package

Manifest는 정확한 descriptor, provider 요구, 생성 fact binding을 기록한다.
Source trace는 descriptor와 `.due` 소비자를 schedule 선언에 연결하고
술어 의존성을 작성된 node에 연결한다. 정본 restore는 descriptor 순서,
site, binding, 의존성, bytecode 대응을 검증한다.
가변 manifest 설명문을 신뢰하지 않는다.

JavaScript와 Rust package validator에는 동일한 정확한 schema가 필요하다.
Trigger, 정책, provider binding, 의존성, site, projection의 서명된 변조는
target loader 전에 실패해야 한다. Provider 관측은 runtime fact로 남으며
서명된 manifest에 복사하지 않는다.

## 호환을 끊는 대체 의무

새 경로가 native와 두 WASM adapter를 통과한 뒤:

- Solar v3 opt-in과 `acceptSolar`를 제거한다;
- 축소된 Solar descriptor와 Solar 생성 `__gf_schedule_due_*` 입력을 제거한다;
- ControlRuntime과 native schedule tape에서 호출자 제공 Solar due 값을 제거한다.
  DailySlots due 경로는 자체 대체 경로가 수용될 때까지 유지한다;
- JavaScript `SolarSchedule.poll`에서 admission, 상한 기록, gap, recovery 상태를
  제거한다. 필요하면 provider 계산 adapter만 유지한다;
- 미리 계산된 due bit를 replay하는 native/WASM parity 테스트를 명시적
  clock/provider fact와 절대 schedule 관측으로 대체한다;
- 공통 정책 필드를 생략한 옛 Solar 예제와 테스트를 제거한다;
- `scheduled-admission.mjs`를 별도의 하류 deployment adapter로 audit한다.
  새 검증된 compiled occurrence 경로가 실제로 그 계약을 대체하는 경우에만
  다시 연결하거나 제거한다. 무관한 DailySlots admission 지원은 삭제하지 않는다;
- Rust Station occurrence ledger는 검증된 occurrence 식별자로 연결하여
  하류의 영속 start 중재를 위해 유지한다.

이는 pre-1.0 대체다. 옛 descriptor, host due 주입, 축약 소스 문법에 대한
활성 compatibility 경로는 없다.

## 결정적인 RED 수용 테스트

1. 정확한 REF-03-042와 REF-03-045의 두 경계가 하나의 엄격한 descriptor로
   컴파일된다. 누락/중복 정책 필드와 미지원 정책 형태는 소스 위치에서 거부한다.
2. `when = false`인 Solar crossing은 `ConditionsFalseAtPulse`를 기록한다.
   이후 참이 되어도 해당 occurrence를 대기열에 넣거나 다시 준비하지 않는다.
3. Gap 상한과 같은 delta는 관측 가능하다. 더 큰 delta는 통과한 occurrence를
   `ObservationGap`으로 종결한다.
4. 없거나 신뢰되지 않은 wall time과 provider fault는 due false로 투영하면서
   서로 다른 Unknown 사유와 revision을 유지한다. 복구는 baseline만 설정한다.
5. Wall rollback, provider revision 변경, 중복 fact는 admit된 occurrence를 중복시키지 않는다.
6. 이후 VM 산술 fault는 admission을 rollback한다. 동일한 clock,
   occurrence, 술어의 재시도는 한 번 admit하고 관측 하나를 전진시킨다.
7. 앞선 window/signal에 의존하는 술어는 위상 순서로 평가한다.
   역방향 의존 cycle은 거부한다. 선언 순서는 출력을 바꾸지 않는다.
8. Native, legacy WASM, framed WASM은 하나의 fact tape에서 같은 절대 due 값,
   처분, 식별자, trace 기록을 생성한다. Checkpoint, rewind, temporal replay도 이를 보존한다.
9. 모든 정책, provider binding, 의존성, site의 서명 package 변조는
   loader 호출 전에 거부한다.
10. 단계적 대체 동안 옛 축약 Solar 문법, 호출자 due 주입, 미지원 Daily,
    window/run/held-clock 정책은 계속 거부한다.
11. 새로 통과한 Solar fact 두 개 이상을 포함한 gap은 모든 occurrence를 missed로
    기록하고 아무것도 admit하지 않으며 재시도 간 두 식별자를 모두 보존한다.
    짝이 되는 single-crossing 사례는 일반 pulse admission을 유지한다.
    불완전한 provider coverage는 거부하거나 Unknown으로 남는다.

## 남은 schedule 작업

- 완전한 IANA/DST missing/repeated provider fact를 갖춘 Daily와 DailySlots
  (REF-03-024와 §3.6), live TimeSlots settings 포함;
- Window/Run admission, 취소, 단조 active duration;
- 명시적 uncertainty와 HeldClock provenance를 갖춘 `hold_trusted`;
- Solar `fixed_time` 종결 fallback과 공유 local-date occurrence ledger;
- At, Periodic, Cron, Tide, work calendar, 자연 provider 보정/철회 규칙;
- 영속적인 프로그램 간 occurrence 이관, 전체 Station 통합,
  남은 accounting/resource 제약.

어느 항목도 Solar pulse slice에서 기본값이나 compatibility 근사 구현을 받지 않는다.
