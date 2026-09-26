# 7. 의미 보존 규칙과 문법 색인

[Language Reference](../LANGUAGE-REFERENCE.md) · [앞 장: 합성·재현](06-composition-and-replay.md) · [다음: 계층별 책임](08-language-runtime-and-device-boundaries.md)

## 7.1 이 장의 목적

한 기능의 문법을 아는 것과 여러 기능을 함께 썼을 때 같은 의미를 유지하는 것은 다르다.
이 장은 언어 전체에 적용되는 의미 보존 규칙과 찾아보기 표를 제공한다.
표의 단어는 키워드, 설정 키, 내장 연산, 설계 개념을 함께 포함한다.
이 목록 전체가 예약어 집합이라는 뜻은 아니다. 각 항목의 문법과 적용 위치는 연결된 장을 따른다.

## 7.2 잘못된 프로그램과 외부의 실패

**Why.** 제어식이 잘못된 경우와 센서가 고장 난 경우를 같은 것으로 처리하면,
고쳐야 할 프로그램과 대응해야 할 현장 상황을 구분할 수 없다.

| 구분 | 예 | 언어에서의 의미 |
|---|---|---|
| 이름·구문 오류 | 정의되지 않은 이름, 모호한 선언, 고립된 의도 링크 | 어떤 규칙인지 유일하게 해석할 수 없다. |
| 타입 오류 | Int 변수와 Number 변수의 암묵적 혼합, Duration과 횟수 혼동 | 의미가 다른 값을 같은 것으로 취급했다. |
| 분기·정의 오류 | 빠진 enum 경우, 같은 출력의 중복 연결 | 결과가 완전하거나 유일하게 정의되지 않았다. |
| 상태 경계 오류 | 다음 상태 식에서 다른 다음 상태 읽기, 조합 순환 | 같은 판단 안에 숨은 순서나 무한 의존을 만들었다. |
| 값 계산의 오류 | 범위를 벗어난 정수 연산, 0 나눗셈, 유효하지 않은 숫자 변환 | 정상 결과를 만들 수 없다. 성공한 tick으로 부분 확정하지 않는다. |
| 센서 fault | Disconnected, Invalid, Stale, NotReady | 입력 데이터가 정상 측정 조건을 만족하지 않는다. 명시적 오류 흐름으로 다룬다. |
| 일정의 Unknown | 시각·위치·예측·달력 정보가 없음 | 발생 여부를 결정할 근거가 없다. False나 허가로 꾸미지 않는다. |
| 알려진 불충족 | 정상 수분값이 관수 조건을 만족하지 않음 | 판단은 정상적으로 끝났고 조건 결과가 False다. |
| 설정 변경 거절 | 범위·증분·권한 위반 | 요청한 설정 event 전체를 적용하지 않는다. 기존 유효 설정을 보존한다. |
| 관측 부재·불일치 | 값 없음, 다른 소스 판본이나 다른 실행의 snapshot | 현재 프로그램의 정상 관측값으로 합치지 않는다. |

센서 fault를 정상 payload처럼 산술·논리에 바로 넣지 않는다.
대체값을 선택하는 식은 그 선택의 의미를 드러내야 한다.
대체값이 있다는 이유로 원래 오류와 출처를 지우지 않는다.
설정 요청의 거절과 제어 tick의 계산 실패 역시 서로 다른 사건이다.

## 7.3 거짓·없음·불확실함은 다르다

**Why.** 제어 허가는 근거가 있어야 한다. 값이 없다는 사실을 부정해서 허가를 만들 수 없다.

| 값 또는 상태 | 해석 |
|---|---|
| `false` | 정상적인 Bool 값 |
| `0` | 해당 타입에서 정상적으로 표현한 값 |
| optional capability 없음 | 설치 구성이 그 능력을 제공하지 않음 |
| sensor fault | 설치된 센서를 정상적으로 읽을 수 없음 |
| `Unknown(reason)` | 판단에 필요한 정보가 부족함 |
| 빈 관측 목록 | 해당 프로그램에 공개할 내부 관측 항목이 없음 |

Bool 계산, 품질 처리, 존재 검사를 혼합하지 않는다.
예를 들어 “수분 센서 없음”, “수분 센서 고장”, “수분율 0%”는 세 가지 다른 조건이다.
`!Unknown`을 운전 허가로 해석하지 않는다.

## 7.4 의미가 유지되는 변환

**Why.** 식을 짧게 만들거나 공통 계산을 합치는 일이 제어 결과를 바꾸면,
작성자가 검토한 프로그램과 실제 의미가 달라진다.

표현을 바꾸더라도 다음 사항을 함께 보존해야 한다.

1. 입력과 값의 타입, 이전 상태와 다음 상태의 경계.
2. 성공한 상태 전이와 requested/safe 출력의 의미.
3. 오류 조건과 오류 발생이 성공한 판단을 막는 의미.
4. 시간·예약 발생·설정 event가 판단에 반영되는 순서.
5. 원본 선언과 설명에 대한 추적 관계.

`a * 0`을 `0`으로 바꾸는 경우도 값만 같다는 이유로 충분하지 않다.
그 변환이 원래 식에서 관찰되는 오류나 필요한 의존 관계를 없애는지 함께 판단해야 한다.
정적 의존 목록은 “읽을 수 있는 입력”이며 실제 실행에서 결과를 뒷받침한 경로와 같지 않다.

표현식이 합쳐지거나 제거되더라도 원본 의도·주석·소스 판본의 연결은 사라지지 않는다.
변환된 표현이 새로운 독립 정본이 되지 않는다.
근거: [언어 설계](../LANGUAGE.md), [원본과 안전 관찰](../SOURCE-SAFETY-TRACE.md),
[#42의 의미 동등성·원문 보존 결정](https://github.com/callin2/ghostflow-language/issues/42).

## 7.5 선언과 표기 찾아보기

| 표기·개념 | 찾아볼 장 |
|---|---|
| `.ghost.md`, `ghost` fence, 주석·문단·여러 코드 블록 | [1. 소스와 문법](01-source-and-syntax.md) |
| `ghostflow:anchor`, `ghostflow:link`, intent/premise/assumption | [1. 소스와 문법](01-source-and-syntax.md) |
| `control`, 식별자, 범위, 이름 해석, 세미콜론 | [1. 소스와 문법](01-source-and-syntax.md) |
| `input`, `output`, `state`, `config`, `let` | [2. 타입·식·상태](02-types-expressions-state.md), [5. 설정](05-settings-and-observation.md) |
| `fn`, 인자·결과 타입, 순수 함수 | [2. 타입·식·상태](02-types-expressions-state.md) |
| `type`, `case`, `in` | [2. 타입·식·상태](02-types-expressions-state.md) |
| `Bool`, `Int`, `Number`, `Percent`, `Duration` | [2. 타입·식·상태](02-types-expressions-state.md) |
| 물리량·단위·차원·표시 단위와 제어 의미 | [2. 타입·식·상태](02-types-expressions-state.md) |
| `if ... then ... else`, 평가와 오류 | [2. 타입·식·상태](02-types-expressions-state.md) |
| `x'`, `<-`, tick | [2. 타입·식·상태](02-types-expressions-state.md) |
| `+`, `-`, `*`, `/`, `div`, `%`, 비교, `!`, `&&`, `\|\|` | [2. 타입·식·상태](02-types-expressions-state.md) |
| `number`, `int_exact`, `int_floor`, `int_ceil`, `int_trunc`, `int_nearest_even` | [2. 타입·식·상태](02-types-expressions-state.md) |
| 함수 합성·값 전달, `>>`, `\|>`, `map`, `and_then`, `recover` | [2. 타입·식·상태](02-types-expressions-state.md), [4. 센서와 제어](04-sensors-constraints-control.md) |
| `Date`, `TimeOfDay`, `DateTime`, 벽시계·단조시간·논리시간 | [3. 시간과 예약](03-time-and-schedules.md) |
| `timer`, `elapsed`, phase age, 연속 Bool 시간 | [3. 시간과 예약](03-time-and-schedules.md) |
| `schedule`, `DailySlots`, `TimeSlots`, `timezone`, `selected`, `.due`, `.missed` | [3. 시간과 예약](03-time-and-schedules.md) |
| `Solar`, 일출·일몰·달·조석, 위치·예측 맥락 | [3. 시간과 예약](03-time-and-schedules.md) |
| `Schedule`, TriggerRule, DayRule, Pulse, Window, Run, Range | [3. 시간과 예약](03-time-and-schedules.md) |
| Cron, Periodic, 업무일·휴일·제외일, DST | [3. 시간과 예약](03-time-and-schedules.md) |
| fallback, Unknown, 지연 시작·관측 공백·중복 발생 | [3. 시간과 예약](03-time-and-schedules.md) |
| `sensor`, `sensor?`, `signal`, `ok`, `fault`, Result·Option | [4. 센서와 제어](04-sensors-constraints-control.md) |
| `sample`, `valid`, `filter`, `stale_after`, `recover_after`, `samples` | [4. 센서와 제어](04-sensors-constraints-control.md) |
| median, 이동평균, EMA, hysteresis, on_below, off_above, initial | [4. 센서와 제어](04-sensors-constraints-control.md) |
| `adapt`, capability, 전략 선택 | [4. 센서와 제어](04-sensors-constraints-control.md) |
| 장치 질의의 `match`, `where`, `strategy`, `priority` | [4. 센서와 제어](04-sensors-constraints-control.md) |
| `require`, `mutex`, `constraints`, `exclusive`, `allow` | [4. 센서와 제어](04-sensors-constraints-control.md) |
| `check`, `limit`, `once ... per occurrence`; `warn` (설계, parser 미지원) | [4. 센서와 제어](04-sensors-constraints-control.md) |
| count_on, any_on, 공유 자원·모드·중재 | [4. 센서와 제어](04-sensors-constraints-control.md) |
| 일일 ON-time, rolling-window budget | [4. 센서와 제어](04-sensors-constraints-control.md) |
| objective, PI/PID, 연속 actuator feedback | [4. 센서와 제어](04-sensors-constraints-control.md) |
| temporal evidence, fallback, bounded adaptation | [4. 센서와 제어](04-sensors-constraints-control.md) |
| min/max/step, access, label, 기본값·유효값 | [5. 설정과 관찰](05-settings-and-observation.md) |
| atomic live setting, 설정 revision, 임시값·만료·복귀 | [5. 설정과 관찰](05-settings-and-observation.md) |
| 관찰 계약: counter, descriptor, snapshot, event, command result, alarm | [5. 설정과 관찰](05-settings-and-observation.md) |
| explanation, evaluated/value/supportsResult, provenance | [5. 설정과 관찰](05-settings-and-observation.md) |
| behavior 합성·import·instance·논리 포트·binding | [6. 합성과 재현](06-composition-and-replay.md) |
| semantic DAG, 명시적 지연·상태 경계·실행 격리 | [6. 합성과 재현](06-composition-and-replay.md) |
| syntax/quote/splice, 위생적 구문 확장 | [6. 합성과 재현](06-composition-and-replay.md) |
| checkpoint·replay·ghost·branch·프로그램 교체 | [6. 합성과 재현](06-composition-and-replay.md) |

각 표기의 허용 위치와 필수 필드는 연결한 본문 절을 따른다.
폐기한 별칭은 §1.6의 거부 규칙을 따른다. 색인의 일반 개념을 소스 키워드로 추론하지 않는다.

## 7.6 기호 찾아보기

| 기호 | 문맥에 따른 역할 |
|---|---|
| `{ }` | 범위·함수·case·설정 블록 또는 `in`의 유한 집합 |
| `( )` | 호출 인자 또는 식의 묶음 |
| `[ ]` | 예약의 선택 시각 등 선언에서 허용한 목록 |
| `:` | 타입 선언 또는 이름 붙인 인자 |
| `;` | 선언·식 정의의 경계 |
| `,` | 여러 이름·인자·집합 원소의 구분 |
| `=` | 정의·초기값·설정 항목 |
| `'` | 다음 상태 |
| `<-` | 출력 연결 |
| `->` | 함수 결과 타입 |
| `=>` | case 분기 또는 제약 관계; 일반 식의 임의 연산자가 아님 |
| `\|` | enum의 대안 |
| `?` | 선택적 센서 |
| `.` | 문맥이 정한 멤버·이름 공간 참조 |
| `..` | 센서의 유효 범위 |
| `_` | 사용하지 않는 fault 패턴 바인딩 |
| `//` | 코드의 한 줄 주석 |

## 7.7 용어

| 용어 | 정의 |
|---|---|
| 정본 소스 | 설명·의도·실행 규칙을 함께 보존한 원본 문서 |
| Program | 실행 규칙의 identity를 가진 프로그램 |
| Run | 그 프로그램을 한 번 시작하여 이어가는 실행의 identity |
| Tick / scan | 입력을 받아 논리 판단을 확정하는 단위. 문맥별 관측 경계를 함께 읽는다. |
| Previous / candidate state | 판단 전 확정 상태 / 이번 판단에서 계산한 다음 상태 |
| Requested / safe intent | 제어식이 요청한 출력 / 제약을 거친 출력 의도 |
| Setting | 프로그램이 변경 가능성을 선언한 조절값 |
| Occurrence | 일정 규칙에서 나온 하나의 식별 가능한 발생 |
| Provenance | 값·판단·설명이 어느 원본과 의도에서 왔는지 나타내는 연결 |
| Logical port / physical binding | 제어의 의미 있는 연결점 / 그것을 실제 설비에 연결하는 관계 |
| Semantic DAG | 제어 의미와 의존 관계를 나타내는 그래프. 화면 배치 그래프와 구분한다. |
| Driver | 논리 입력과 물리 신호, 출력 의도와 실제 효과를 연결하는 경계 |

## 7.8 원문에서 reference로 찾아가기

이 표는 설계 항목의 위치를 찾기 위한 색인이다. 이슈 상태나 작업 진척을 나타내지 않는다.

| 설계 근거 | Reference의 위치 |
|---|---|
| [DESIGN-NOTES](../DESIGN-NOTES.md), [LANGUAGE](../LANGUAGE.md) §1–2 | [첫 문서의 철학](../LANGUAGE-REFERENCE.md), 2장 실행 모델 |
| LANGUAGE §3–4, [LANGUAGE-SURFACE](../LANGUAGE-SURFACE.md), [Programming in GhostFlow](../ProgrammingInGhostflow.md) §2·5·9·부록 A/B | 1–2장 어휘·문법·타입·함수·규칙 |
| [LITERATE](../LITERATE.md), [INTENT-ANCHOR-MAP](../INTENT-ANCHOR-MAP.md), [#31](https://github.com/callin2/ghostflow-language/issues/31), [#60](https://github.com/callin2/ghostflow-language/issues/60) | 1장 문서와 의도 |
| [정수 계약](../EXACT-INTEGER-CONTRACT.md), [#22](https://github.com/callin2/ghostflow-language/issues/22), [#93](https://github.com/callin2/ghostflow-language/issues/93) | 2장 정수·단위 타입 |
| [시간 계약](../TIME-AND-SCHEDULE-CONTRACT.md), [연속 타이머](../CONTINUOUS-BOOL-TIMER-CONTRACT.md), [Solar](../SOLAR-SCHEDULE.md), [#23](https://github.com/callin2/ghostflow-language/issues/23), [#46](https://github.com/callin2/ghostflow-language/issues/46), [#90](https://github.com/callin2/ghostflow-language/issues/90) | 3장 전체 |
| [CONSTRAINTS](../CONSTRAINTS.md), LANGUAGE §5–8, [#3](https://github.com/callin2/ghostflow-language/issues/3) | 4장 오류·센서·장치·제약 |
| [#94](https://github.com/callin2/ghostflow-language/issues/94), [#95](https://github.com/callin2/ghostflow-language/issues/95), [#96](https://github.com/callin2/ghostflow-language/issues/96) | 4장 연속 제어·적응·rolling budget |
| [#68](https://github.com/callin2/ghostflow-language/issues/68), [#70](https://github.com/callin2/ghostflow-language/issues/70), [#73](https://github.com/callin2/ghostflow-language/issues/73), [#74](https://github.com/callin2/ghostflow-language/issues/74), [#88](https://github.com/callin2/ghostflow-language/issues/88), [interaction contract](../../contracts/interaction-v0/README.md) | 5장 설정·관찰·설명 |
| [#89](https://github.com/callin2/ghostflow-language/issues/89), [#105](https://github.com/callin2/ghostflow-language/issues/105), [#110](https://github.com/callin2/ghostflow-language/issues/110) | 5장 live 설정 의미 |
| [#99](https://github.com/callin2/ghostflow-language/issues/99)와 연결된 #100–108 설계 기록 | 6장 합성·identity·binding·설명, 5장 설정 |
| LANGUAGE §9–12, [문법 비교의 구문 확장](../LANGUAGE-EXAMPLES.md), Programming in GhostFlow §10–12 | 1장 문서, 6장 합성·확장·재현 |
| [SOURCE-SAFETY-TRACE](../SOURCE-SAFETY-TRACE.md), [#42](https://github.com/callin2/ghostflow-language/issues/42) | 5장 설명, 이 장의 의미 보존 |
| [Coding FAQ 1–41](../language_faq.md) | [8장 전체 책임표](08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표), [언어 결정과 작성자 정책](08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책) |

언어의 새 결정을 추가할 때 해당 기능의 본문, Why, 예제, 이 색인을 함께 갱신한다.

[전체 목차](../LANGUAGE-REFERENCE.md) · [다음 장: 계층별 책임](08-language-runtime-and-device-boundaries.md)
