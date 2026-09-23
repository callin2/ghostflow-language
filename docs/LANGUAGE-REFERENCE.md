# GhostFlow Language Reference

GhostFlow는 센서와 사용자 입력으로부터 **상태의 변화와 장치에 대한 출력 의도**를
기술하는 반응형 제어 언어다. 이 reference는 언어의 철학, 문법, 의미, 타입 규칙,
사용 제약과 각 기능을 도입한 이유를 설명하는 공통 기준 문서다.

동작별 코딩 예제는 [GhostFlow Coding FAQ](language_faq.md)를 참조한다.

## 전체 목차

| 장 | 내용 |
|---|---|
| [1. 소스와 문법](reference/01-source-and-syntax.md) | 문서형 소스, 코드 블록, 의도 anchor/link, 어휘·이름·범위·선언 구조 |
| [2. 타입·표현식·상태](reference/02-types-expressions-state.md) | 리터럴·정수·단위, 연산자·우선순위, 함수·분기, tick·상태·출력 |
| [3. 시간과 예약](reference/03-time-and-schedules.md) | 시각·경과 시간, 타이머, DailySlots·Solar·Cron·Periodic, 달력·자연 사건·fallback |
| [4. 센서·제약·제어](reference/04-sensors-constraints-control.md) | 품질·필터·히스테리시스, 장치 능력·적응, 공유 자원·모드·시간 예산, 연속 제어 |
| [5. 설정과 관찰](reference/05-settings-and-observation.md) | typed 설정과 자동 입력창, live 변경, 임시값, snapshot·event·command·alarm·설명 |
| [6. 합성과 재현](reference/06-composition-and-replay.md) | 동작 합성·import·instance·port·binding, semantic DAG, 구문 확장, replay·ghost·교체 |
| [7. 의미 보존 규칙과 색인](reference/07-semantic-rules-and-index.md) | 오류의 구분, 변환의 동등성, 전체 표기·기호·용어·원문별 찾아보기 |
| [8. FAQ 요구와 계층별 책임](reference/08-language-runtime-and-device-boundaries.md) | FAQ 전체의 언어·컴파일러·런타임·환경·Driver·binding·UI 책임, 생명주기와 필요한 계약 |

각 장은 이 문서의 일부다. 특정 기능은 목차에서 해당 장을 바로 읽을 수 있다.
모든 표기를 찾으려면 [문법 색인](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기)을 사용한다.
FAQ의 요구를 지원하려면 어느 계층에 무엇이 필요한지는 [8장 책임표](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표)를 참조한다.

## 읽는 규칙

- **문법**은 소스에서 사용하는 표기와 그 의미를 설명한다.
- **설계 표기**는 설계 문서·논의에 등장한 개념을 설명한다. 확정된 표기와 임의로 혼합하지 않는다.
- **규칙**은 타입, 범위, 평가, 오류, 시간과 상태의 의미를 정의한다.
- **Why**는 해당 기능이 필요한 이유와 지키려는 언어 원칙을 설명한다.
- 예제의 **단편**은 주변 선언을 생략한 설명이다. 완전한 문서 예제와 구분한다.
- 기술적 문법·의미 결정은 각 장의 규칙을 따른다. 현장 운전 선택은 명시적 인자로 남기며 숨은 정책으로 채우지 않는다.

2026-09-22의 문법 정책 정리는 이 Reference의 규범적 결정이다.
이전 설계 스케치와 표기가 충돌하면 이 문서의 정확한 타입·문법·평가 규칙을 따른다.
사용자가 정할 운전 값과 외부 책임은 [§8.6](reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책)에 구분한다.

서로 다른 시기의 문서가 충돌하면 해당 범위를 명시적으로 변경한 후속 결정을 따른다.
예를 들어 운영 설정의 적용 의미는 [#105](https://github.com/callin2/ghostflow-language/issues/105)와
[#110](https://github.com/callin2/ghostflow-language/issues/110)의 **동일 프로그램·동일 실행 안의 atomic live event**를 따른다.
이 결정으로 설비의 모드 전환이나 임의 상태 쓰기의 의미까지 바꾸지는 않는다.

## 설계 철학

### 1. 의도와 규칙을 함께 읽는다

제어 프로그램은 “어떤 조건에서 무엇을 하는가”뿐 아니라 “왜 그렇게 하는가”를 담아야 한다.
조건을 읽을 수 있어도 그 조건을 선택한 이유가 사라지면 변경의 타당성을 판단하기 어렵다.
GhostFlow는 설명과 코드를 같은 문서에 두고, 의도·전제·가정과 선언·식을 연결한다.
확인되지 않은 가정은 사용자 의도로 둔갑하지 않는다.

**이어지는 기능:** literate `.ghost.md`, 의도 anchor/link, 원본 판본과 provenance,
설명 그래프와 변경 이력의 의미.

### 2. 입력, 판단, 효과의 경계를 드러낸다

언어는 입력으로부터 출력 의도를 계산한다. Driver는 그 의도를 실제 환경에 적용한다.
물리 장치의 위치와 배선이 판단식에 숨어 있지 않아야 한다.
이 경계가 있어야 같은 규칙을 실제 운전, 설명, 가상 실행에서 사용할 수 있다.
출력 의도가 참이라는 사실을 물리 장치가 움직였다는 확인으로 해석하지 않는다.

**이어지는 기능:** typed input/output, `<-`, requested/safe intent,
논리 포트와 binding, 효과 없는 ghost 실행.

### 3. 기억은 상태에, 계산은 순수 함수에 둔다

자기유지·누적 횟수·운전 단계에는 기억이 필요하다.
그 기억을 함수 호출의 숨은 부작용이나 문장 실행 순서에 맡기지 않는다.
순수 함수는 값을 변환하고, `state`는 이전 판단과 다음 판단 사이의 기억을 담당한다.
피드백은 반드시 명시적인 상태 경계를 통과한다.

**이어지는 기능:** `state`, 다음 상태 식, `let`, 순수 함수, 조합 순환 제한,
명시적인 지연과 합성의 상태 격리.

### 4. 같은 실행 조건이면 같은 판단을 얻는다

입력·이전 상태·유효 설정·시간 조건이 같으면 결과도 같아야 한다.
하나의 tick에서 상태 식은 같은 이전 상태를 읽고 결과를 함께 확정한다.
임의의 문장 순서나 숨은 시계 읽기가 제어 결과를 바꾸지 않게 한다.

**이어지는 기능:** input snapshot, 원자적 상태 전이, 명시적 시간,
설정 event의 적용 위치, replay·branch 비교.

### 5. 값의 의미를 타입으로 보존한다

횟수, 시간, 수분율, 압력과 참·거짓은 같은 종류의 값이 아니다.
모두 숫자로 표시할 수 있다는 이유로 구분을 없애지 않는다.
계산에서 어떤 변환과 반올림을 선택했는지 드러내고 정밀도 손실을 숨기지 않는다.

**이어지는 기능:** `Int`, `Number`, `Duration`, `Percent`, 유한 enum,
명시적 정수 변환, 물리량·단위·차원, typed 설정.

### 6. 시간은 제어의 입력과 상태 관계다

“오전 6시에 시작”과 “5분 동안 운전”은 다른 의미다.
기다리는 동안에도 정지와 센서 입력을 판단해야 한다.
예약 발생, 연속 경과, 누적 사용량, 반복 주기와 달력 조건을 구분한다.

**이어지는 기능:** DateTime과 단조 시간, elapsed·연속 Bool 타이머,
Pulse·Window·Run, 발생 identity, 시간 예산과 자연 사건 fallback.

### 7. 오류와 정보 부족을 숨기지 않는다

센서가 없거나 고장 났다는 사실은 정상값 0이 아니다.
자연 사건의 예측을 모른다는 사실은 운전 조건이 거짓이라는 뜻과도 다르다.
대체 판단은 명시하고 원래의 오류·불확실성·선택 이유를 보존한다.

**이어지는 기능:** Option과 Result의 구분, `ok`/`fault`, 품질 보존,
NotReady·Stale, Unknown, 명시적 fallback·복구·판단 근거.

### 8. 제약과 판단의 근거를 읽을 수 있게 한다

개별 control이 원하는 동작과 설비 전체가 허용하는 동작은 다를 수 있다.
제약을 여러 식에 복사하면 빠뜨리거나 서로 다르게 고치기 쉽다.
허용 조건과 중재 규칙을 드러내고 요청이 차단된 이유를 설명할 수 있게 한다.

**이어지는 기능:** `require`, `mutex`, 공통 constraints, 공유 자원·모드,
운전 시간 한도, requested/safe 구분과 explanation.

### 9. 운영 조절점과 화면을 같은 의미로 연결한다

운영자가 바꿀 “5분”은 이름과 타입, 기본값, 범위와 권한을 가진 설정이다.
화면은 이 의미를 받아 시간 입력창을 만들 수 있어야 한다.
설정값을 바꾸는 행위가 제어 규칙을 새로 작성하거나 내부 상태를 임의로 바꾸는 행위가 되지 않게 한다.

**이어지는 기능:** typed config metadata, 기본값과 유효값, atomic live 변경,
화면 독립 descriptor, settings revision.

### 10. 조합해도 책임과 비용을 추적할 수 있게 한다

기존 동작을 재사용할 때 어느 원본에서 왔는지, 무엇에 연결됐는지,
누가 같은 물리 자원을 사용하는지 알 수 있어야 한다.
복잡한 조합도 끝나지 않는 계산이나 무제한 숨은 작업을 만들지 않아야 한다.

**이어지는 기능:** import identity, behavior instance, typed logical port,
명시적인 binding, 유한 계약, bounded state·시간·자원, 의미 DAG와 의도 추적.

## 설계에 영향을 준 관점

[원래 언어 설계](LANGUAGE.md#1-언어의-방향)는 다음 선호를 언어의 선택과 연결한다.
이 표는 문법의 별칭 목록이 아니라 각 관점에서 가져온 이유를 설명한다.

| 관점 | GhostFlow에서 중요하게 본 점 |
|---|---|
| YAML | 선언의 계층과 읽기 쉬운 이름·타입·설정 |
| Literate CoffeeScript | 설명과 실행 규칙을 같은 문서에서 읽는 방식 |
| 함수형·function-level composition | 순수한 값 변환을 조합하고 기억을 명시하는 방식 |
| Railway-oriented programming | 정상값과 오류를 같은 명시적 흐름에서 다루는 방식 |
| Cycle.js | 입력 Source와 출력 Intent, 실제 효과의 Driver 경계 |
| Cypher query | 장치의 의미 있는 capability를 명시적으로 선택하는 방식 |
| Meta Lua | 코드를 데이터로 다루되 구문 확장의 의미와 경계를 검증하는 방식 |
| Observable·marimo·D3.js | 코드와 연결하여 값·상태·변화·판단을 관찰하는 방식 |
| Elm·Rust | 타입과 분기 검사를 통한 명확한 오류 경계와 예측 가능한 실행 |

## 이 reference를 유지하는 규칙

언어 의미를 변경하면 해당 장의 **문법·규칙·예제·Why**를 함께 갱신한다.
FAQ에 새로운 요구를 추가하면 [8장 책임표와 계약 경계](reference/08-language-runtime-and-device-boundaries.md)에도 연결한다.
설계 근거는 해당 절과 [원문별 색인](reference/07-semantic-rules-and-index.md#78-원문에서-reference로-찾아가기)에 연결한다.
이 reference는 하나의 문서 집합이다. 다른 프로젝트에 독립적인 사본을 만들어 의미를 나누지 않는다.
