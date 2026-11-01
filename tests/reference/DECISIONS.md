<!-- translation-source: tests/reference/DECISIONS.en.md -->

[영문 원문](DECISIONS.en.md)

# 기존 결정 대기 49건의 확정 추적

개별 Reference 수용 사례를 처음 작성했을 때 그중 49건은 상태가 `decision`이었습니다. 기대 의미가 아직 확정되지 않은 문법이나 정책에 달려 있었기 때문입니다. 이제 49건은 모두 확정되었습니다. 이 표는 각 사례를 그 의미를 정의하는 현재 Reference 절과, 지금 그 사례를 검증하는 형태에 대응시킵니다.

현장별 값은 확정을 기다리는 문법 결정이 **아닙니다**. 운전 시간, 허용 품질, 장치 선택, gain이 그 예입니다. 이런 값은 프로그램이나 설치 계약에 명시하는 인자입니다. 이 구분은 [Reference §8.6](../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책)을 따릅니다.

표 읽는 법:

- **ID** — 수용 사례 식별자입니다. `REF-NN-…`은 Reference `NN`장에 속합니다(`00`은 [언어 Reference](../../docs/LANGUAGE-REFERENCE.md) 개요입니다).
- **확정된 결정 요지** — 이전 결정 대기를 해소한 규칙입니다.
- **Reference** — 지금 그 규칙을 소유하는 절입니다. 링크는 정본인 한국어 장을 가리킵니다.
- **검증 형태** — [수용 테스트 README](README.md)에 정의된 사례 상태입니다.
  - `executable`(41건): 확정된 문법에 대한 컴파일러 수용/거부 사례로, 실제 CLI로 실행합니다.
  - `specified`(8건): 입력, 동작, 기대 결과를 문서로 정의한 runtime·환경·Driver·UI·도구 계약입니다. 활성 외부 oracle 링크가 있을 때만 `externally-covered`로 집계하며, 그렇지 않으면 TODO로 남습니다. 어느 쪽도 CLI 실행 통과로 집계하지 않습니다.

| ID | 확정된 결정 요지 | Reference | 검증 형태 |
|---|---|---|---|
| `REF-00-010` | 재사용한 두 instance는 서로 격리된 기억과 provenance를 유지합니다. | [docs/LANGUAGE-REFERENCE.md §10](<../../docs/LANGUAGE-REFERENCE.md#10-잘-만든-예제-두-개를-가져왔으면-함께-쓸-수-있어야죠>) | `specified` |
| `REF-01-044` | 제거된 purefn 별칭은 fn으로 조용히 해석하지 않고, migration 진단과 함께 거부합니다. | [01-source-and-syntax.md](<../../docs/reference/01-source-and-syntax.md#16-대표-표기-참고-별칭과-역사적-대안>) | `executable` |
| `REF-01-045` | control 값 선언은 선언 종류가 달라도 하나의 namespace를 공유합니다. 같은 이름을 두 번 선언할 수 없습니다. | [01-source-and-syntax.md](<../../docs/reference/01-source-and-syntax.md#17-소스-규칙의-장별-경계>)<br>[01-source-and-syntax.md](<../../docs/reference/01-source-and-syntax.md#이름-범위와-해석>) | `executable` |
| `REF-01-056` | 기대 numeric 타입이 없으면 정수 모양 리터럴은 Int이고, 소수점이나 지수가 있는 리터럴은 Number입니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-057` | 이미 정해진 Number 문맥에서는 정수 모양 리터럴이 처음부터 Number입니다. runtime Int-to-Number 변환이 아닙니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-058` | 뒤에 오는 사용처가 untyped let의 initializer 타입을 거꾸로 바꾸는 일은 절대 없습니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-059` | 서로 충돌하는 numeric 기대 타입은 진단을 냅니다. 컴파일러는 overload를 추측하지 않습니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-060` | Int 리터럴은 원래 십진 digit으로 signed 32-bit 범위를 검사합니다. 음의 경계에서는 -2147483648만 허용합니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>)<br>[02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#23-정확한-정수-설계>) | `executable` |
| `REF-01-061` | digit separator는 Int 리터럴 계약에 포함되지 않습니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-065` | Int/Number 변환은 반올림 정책을 이름으로 드러내고, 소수부 때문인 실패(fractional)와 범위 초과(out-of-range) 원인을 구분합니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#명시적-변환>) | `executable` |
| `REF-01-086` | if, &&, \|\|는 왼쪽부터 결정적으로 단락 평가하므로, 선택되지 않아 runtime fault를 낼 수 있는 식은 절대 실행되지 않습니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#조건식>) | `specified` |
| `REF-01-092` | 일반 함수 이름은 값으로 저장할 수 없습니다. 언어는 일반 고차 함수나 runtime 함수 선택을 도입하지 않습니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#27-순수-함수와-계산-조합>) | `executable` |
| `REF-01-106` | Temperature, Pressure, FlowRate는 승인된 단위 suffix가 붙은 리터럴을 사용합니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#29-물리량과-단위>) | `executable` |
| `REF-01-107` | 서로 다른 두 nominal quantity의 비교는 거부합니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#29-물리량과-단위>) | `executable` |
| `REF-01-108` | Percent 위치(position)와 RelativeHumidity는 화면에서 비슷해 보여도 서로 다른 nominal 타입입니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#29-물리량과-단위>) | `executable` |
| `REF-01-109` | 범용 Date, TimeOfDay, DateTime 값은 각각 date, time, datetime tagged literal을 사용합니다. DateTime에는 offset이 필요합니다. | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#210-확정된-타입-경계>)<br>[03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#date-timeofday-datetime>) | `executable` |
| `REF-03-008` | date/time/datetime tagged literal은 정확한 Gregorian·millisecond 정밀도 값을 만듭니다. DateTime은 Z 또는 -14:00부터 +14:00까지의 숫자 offset을 요구합니다. | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#date-timeofday-datetime>) | `executable` |
| `REF-03-015` | continuous_true(Bool)는 끊기지 않고 참인 구간을 재는 공개 timer 선언입니다. 경과 시간(elapsed)이나 누적 ON 시간과는 구분됩니다. | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#33-bool이-연속으로-참인-시간>) | `executable` |
| `REF-03-024` | trigger와 basis는 별도의 typed field입니다. Daily schedule은 timezone, DST, basis, when, clock, gap, recovery, fallback을 명시합니다. | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#35-schedule의-공통-의미>) | `executable` |
| `REF-03-036` | Periodic은 every에 양의 Duration, 명시적인 anchor와 interval_change, 그리고 공통 schedule 정책을 요구합니다. | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#periodic>) | `executable` |
| `REF-03-038` | Cron은 minute, hour, day-of-month, month, day-of-week 순서의 cron5 리터럴과 함께 명시적 timezone, DST 정책, 공통 정책을 요구합니다. | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#cron5>) | `executable` |
| `REF-03-050` | resource/event/account/used/rolling/local_day/limit 문법은 stage, persistence, reservation을 명시하고, 시간 예산, event 횟수, occurrence once를 서로 분리합니다. | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#310-시간-기반-사용량-제약>)<br>[03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#311-확정된-시간-문법과-경계>) | `executable` |
| `REF-04-004` | below, map, and_then, recover는 compatible quantity를 따르고 Result 오류를 보존하는 순수 변환입니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#41-sensor와-result-품질>) | `executable` |
| `REF-04-020` | debounce는 후보가 양의 안정 Duration 전체 동안 바뀌지 않을 때만 안정값을 바꿉니다. 안정값, 후보, 후보의 단조 시작 시각을 보존합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#bounded-signal-연산의-설계-계약>) | `executable` |
| `REF-04-021` | moving_average(n)는 최근 n개의 유효한 새 numeric sample만 평균합니다. 부분 window는 NotReady이며, 상태는 n개로 제한됩니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#bounded-signal-연산의-설계-계약>) | `executable` |
| `REF-04-022` | ema alpha는 유한하며 0<alpha<=1입니다. ema는 첫 유효 sample로 seed하고, 복구 전에는 정상 결과를 내지 않습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#bounded-signal-연산의-설계-계약>) | `executable` |
| `REF-04-025` | condition for d는 양의 Duration 전체 동안 끊김 없이 admissible한 true를 요구합니다. false나 허용되지 않는 quality는 이를 reset합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-026` | within d는 기준 사건 뒤의 half-open 구간 안에서만 조건이 성립한 것으로 인정합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-027` | average(x,d)는 quality를 고려하고 timestamp가 붙은 observation만 사용합니다. 드문드문한 sample을 연속적인 measured truth로 보간하지 않습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-028` | min/max는 window 안의 admissible observation에 대한 극값만 계산합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-029` | window_rate는 지원되는 ordered numeric payload의 두 관측 차이를 경과 시간으로 나눕니다. 결과는 식 전용 Rate<Q>이며, 저장하거나 제한 없는 산술에 쓸 수 없습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-031` | hold는 명시적 Duration과 quality 정책 안에서만 이전 값을 유지하고, Held provenance를 냅니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-035` | 선택적 capability는 adapt strategy의 match 안에서만 읽습니다. 선택은 i32 priority가 최대인 match 하나를 고르며, 부재(absence)를 0이나 정상값으로 바꾸는 일은 절대 없습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#45-선택-sensor와-capability>) | `executable` |
| `REF-04-037` | where는 match된 capability metadata와 상수 Bool 조합만 읽습니다. sample, state, next state, 현재 값은 절대 읽지 않습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#46-device-query와-strategy-선택>) | `executable` |
| `REF-04-044` | exclusive, allow enter, require, limit, once, check, warn은 각자 고유한 적용 단계와 결과를 가집니다. 필수 제약은 모두 AND로 결합되며, priority가 이를 완화하는 일은 없습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#48-공통-constraints-표기와-연산>) | `executable` |
| `REF-04-045` | count_on은 final candidate 안의 서로 다른 물리 항목을 세고, any_on은 명시적인 유한 집합을 검사합니다. 빈 집합이면 각각 0과 false입니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#48-공통-constraints-표기와-연산>) | `executable` |
| `REF-04-050` | 같은 tick의 요청은 하나의 snapshot에서 lease와 budget을 함께 예약하며, bounded queue/expiry와 명시적 tie 정책을 사용합니다. concurrency와 preemption은 opt-in입니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#49-공유-자원과-arbitration>) | `executable` |
| `REF-04-058` | continuous objective는 quality measure, compatible target, semantic actuator target, controller 정책, 그리고 capability와 교집합을 취한 output range를 연결합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#412-continuous-control-objective>) | `executable` |
| `REF-04-059` | PI/PID는 양의 sample period, compatible finite value, direction, 차원을 가진 gain, output clamp, anti-windup, enable, bumpless transfer, fault, restart 정책을 모두 명시해야 합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#pipid-의미에-필요한-항목>) | `executable` |
| `REF-04-061` | degraded fallback은 capability, admissible quality, output bounds, authority를 명시합니다. 전역 constraints, resource, mode를 우회하는 일은 절대 없습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#413-explicit-fallback과-degraded-control>) | `executable` |
| `REF-04-063` | adaptation은 program이나 output에 대한 직접 권한이 아니라 typed setting/setpoint에 대한 bounded proposal입니다. value, source/model, evidence, program/settings identity를 담습니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#414-bounded-adaptation>) | `executable` |
| `REF-04-067` | Reference 04에서 확정한 control 표면은 다른 장이 소유한 경계, 즉 rolling accounting, 일반 quantity/quality, binding/settings record와 일관성을 유지합니다. | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#416-확정된-control-문법과-장별-경계>) | `specified` |
| `REF-05-018` | 임시 설정은 하나의 Program에 결속되며, 다른 Program으로 자동 이관되지 않습니다. | [05-settings-and-observation.md](<../../docs/reference/05-settings-and-observation.md#생명주기와-임시-설정>) | `specified` |
| `REF-06-010` | 정확한 문서 digest로 고정한 import의 instance와 typed port를 연결할 수 있습니다. | [06-composition-and-replay.md](<../../docs/reference/06-composition-and-replay.md#64-import와-연결의-문법>) | `executable` |
| `REF-06-023` | typed expression macro는 quote/splice 확장 뒤 일반 상태·타입 검사를 거칩니다. | [06-composition-and-replay.md](<../../docs/reference/06-composition-and-replay.md#610-syntax-quote-splice의-문법>) | `executable` |
| `REF-08-013` | 달력·DST 제공자는 §3의 명시 정책과 동일한 occurrence 결과를 공급합니다. | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
| `REF-08-014` | typed 슬롯 설정의 live 변경과 운전 길이 변경은 각자 자신의 타입을 유지합니다. | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
| `REF-08-015` | state 초기화와 일반 config 지속성은 별개의 관심사입니다. 정전 시간은 elapsed에 더하지 않습니다. | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
| `REF-08-016` | 설치 binding과 Driver 배포 형식은 source grammar 밖에 있는 환경 계약입니다. | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
