# Programming in GhostFlow

장치의 동작을 코드로 적고, 실행해 보며 이해하기

**사용 안내서 · Language Reference 기준 · 2026-09-28 dev 검토**

## 시작하기 전에

스위치를 누르면 램프가 켜지고, 정해진 시간이 되면 물을 주고, 물이 부족하면 펌프가 멈추게 하고 싶다고 해볼게요.

하나씩 보면 단순한 일이에요. 그런데 조건이 늘어나고 여러 장치가 함께 움직이기 시작하면, 무엇이 언제 켜지고 왜 멈추는지 알아보기 어려워지죠.

GhostFlow는 이런 조건과 동작을 코드로 적는 언어예요. 센서값이나 사용자의 조작에 따라 어떤 상태로 바뀌고, 장치에 어떤 동작을 요청할지 정하는 거예요.

이 안내서에서는 간단한 예제부터 하나씩 읽고 바꿔볼 거예요. 스위치 하나로 출력을 켜고 끄는 것부터 시작해서, 상태를 기억하고, 시간을 기다리고, 센서값에 따라 동작을 바꾸는 프로그램으로 넓혀갑니다.

문법과 동작 규칙을 정확하게 확인할 때는 [Language Reference](LANGUAGE-REFERENCE.md)를 보면 돼요. 이 안내서는 예제로 배우는 글이고, Reference는 언어의 기준을 정한 문서예요. 두 문서의 설명이 다르다면 Reference를 따라주세요. 문법이 바뀔 때도 Reference를 먼저 고치고, 그에 맞춰 이 안내서의 예제를 수정해요.

코드를 작성하다가 궁금한 점이 생기면 [GhostFlow Coding FAQ](language_faq.md)도 함께 참고해주세요.

### 예제를 읽기 전에 알아둘 점

이 안내서에 예제가 있다고 해서, 그 기능을 지금 바로 보드에 올려 쓸 수 있다는 뜻은 아니에요.

코드가 컴파일되는 것, 실행 환경이 그 기능을 지원하는 것, 실제 장치가 의도대로 움직이는 것은 각각 따로 확인해야 해요. 이 안내서는 현재 명세에 맞춰 코드를 어떻게 쓰고 읽는지 설명하지만, 모든 기능의 구현이나 보드 배포가 끝났다는 뜻은 아니에요.

이번 문서 검토는 dev revision `3982e6bf71cf5880286fcea017cb355ab222428d`를 기준으로 했어요. 이후에 어떤 기능이 구현되었고 어디까지 확인했는지는 [Implementation](IMPLEMENTATION.md)과 [기능별 성숙도·실행 근거](REFERENCE-FEATURE-STATUS.md)에서 확인해주세요.

[Semantic Kernel 0.1 검토 계획](plans/2026-09-28-semantic-kernel.ko.md)에는 우선 동작 규칙을 고정하기로 한 핵심 범위와 그 배경이 정리되어 있어요. Reference나 이 안내서에 나오는 모든 기능이 그 범위에 들어가는 것은 아니에요.

E01–E10, E12–E14의 독립 제어 프로그램과 E15의 설명·코드가 함께 있는 문서는 컴파일러 검사 대상이에요. E11은 실행 예제가 아니라 표기를 설명하는 예제예요.

E08의 `enum`·`elapsed`, E09의 일정, E10/E14의 센서·적응 기능에는 아직 그 핵심 범위에 포함되지 않은 내용도 있어요. 11–12장의 프로그램 합성과 교체에 관한 설명도, 구현이 모두 끝난 기능의 사용법으로 받아들이지는 말아주세요.

### 예제는 이렇게 읽어주세요

**예제는 하나씩 따로 실행해주세요.** 각 `ghost` 예제는 독립된 프로그램이에요. 책에 나온 예제를 전부 한 파일에 이어 붙여 실행하는 방식은 아니에요.

**설명도 프로그램의 일부예요.** 실제 프로그램은 `.ghost.md` 문서로 작성해요. 한 프로그램의 코드를 여러 `ghost` 코드 블록으로 나눠 적었다면, 문서 최상위에 있는 블록들을 위에서부터 합쳐 하나의 제어 프로그램으로 읽어요. 코드 사이에 적은 문단이나 “왜 이렇게 동작해야 하는지”에 대한 설명도 소스 문서에 함께 남아요.

**코드의 출력과 실제 장치의 동작은 구분해주세요.** 여기서 출력은 장치에 어떤 동작을 요청할지 계산한 값이에요. 코드에서 펌프를 켜라는 값을 만들었다고 실제 펌프가 바로 켜지는 건 아니에요. 그 값을 어느 GPIO나 릴레이에 연결할지 정하는 설정(binding)과, 하드웨어를 다루는 Driver가 따로 필요해요. 센서에서 값을 읽어오는 일도 이쪽에서 맡아요.

정확한 표기가 궁금하면 [Reference 문법 색인](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기)을 찾아보세요. 왜 이런 방식으로 설계했는지는 [설계 철학](LANGUAGE-REFERENCE.md#설계-철학)에, 언어·실행 환경·장치가 각각 맡는 일은 [Reference 8장](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표)에 정리되어 있어요.

### 예제는 어떻게 확인하나요?

[예제 실행 검사](../tests/programming-book-simulation.test.mjs)에서는 원본 예제를 컴파일한 뒤, 입력값과 시험용 시각을 정해 프로그램을 실행해요. 그런 다음 상태가 어떻게 바뀌었는지, 어떤 출력을 요청했는지(requested intent), 안전 조건을 반영한 출력은 무엇인지(safe intent)를 확인해요.

예제마다 필요한 입력과 실행 환경이 달라서, 검사 방법도 조금씩 달라요.

E01–E10, E12–E15와 PC-01–PC-10은 공개된 `ghostsim` 실행 경로로 검사해요. E02/E08에는 설정 처리 결과(`Result`)와 실행 맥락 정보(`context facts`)를, E09에는 달력·시각을 기준으로 한 일정 정보(`civil schedule facts`)를 넣어요. E10/E14와 tutorial/03에는 센서 샘플을 공급하고, 예제에 필요한 실행 기능(`capability`)도 갖춰줘요.

일반적인 입력·상태 예제는 네이티브 Rust로 실행해요. 해당 입력 처리기(`conditioner`)가 필요한 예제는 같은 핵심 코드를 WASM으로 빌드한 버전을 사용해요.

tutorial/04는 기존에 공개된 `ControlRuntime`·`DailySlots` WASM 실행 환경에서 일정에 따른 이벤트와 순차 출력을 확인해요. station-rules는 `ghostrules`로 컴파일한 정책을 연결한 뒤, WASM `GhostFlowStation`에서 출력 허가와 `Stop` 동작을 확인하고요. 이 두 심화 예제는 `ghostsim` CLI로 실행한 검사와 구분해요.

E11은 표기를 설명하는 예제이고, E90–E97은 일부러 잘못된 코드를 넣었을 때 컴파일러가 예상한 오류를 알려주는지 확인하는 예제예요. 그림이나 프로그램 합성에 관한 설명 자체를 실행하는 것은 아니에요. 소스를 바꿔보는 실험도 원본과 구분해서 검사해요.

직접 검사를 실행하려면 Node 의존성과 같은 revision에서 빌드한 네이티브/WASM 파일이 필요해요. 준비가 끝나면 `node --test tests/programming-book-simulation.test.mjs`를 실행하면 돼요. 전체 빌드와 검증 순서는 [Verification](VERIFICATION.md)에 정리되어 있어요.

컴파일러 검사인 `tests/docs-runnable-examples.test.mjs`는 런타임을 빌드하지 않아도 실행할 수 있어요.

14장에는 온도와 기후 센서를 다루는 E16–E22 예제가 나와요. `ghostsim`의 제어 계산과 별도의 WASM 수치 계산을 확인하는 검사는 `tests/programming-book-simulation.test.mjs`, `tests/programming-climate.test.mjs`, `tests/programming-book-import-package.test.mjs`에 있어요.

여기까지는 프로그램의 논리와 계산을 확인하는 과정이에요. 실제 센서와 장치를 연결했을 때도 의도대로 동작하는지는 별도로 확인해야 해요.

## 목차

### PLC에서 GhostFlow로 — 실습부터 시작하기

버튼과 램프부터 시작하는 10단계 실습 과정이에요. START/STOP, 모터, 인터록, 리미트, 타이머, 수위, 수동/자동 운전, 순차제어와 고장 복구까지 차례로 다뤄요.

각 단계에서는 먼저 “장치가 어떻게 움직여야 하는지”를 살펴보고, 그 동작을 GhostFlow 코드로 어떻게 적는지 확인해주세요.

### 주제별로 살펴보기

1. [스위치 하나와 출력 하나](#ch01)
2. [이름, 값, 타입, 표현식](#ch02)
3. [상태를 기억한다는 것](#ch03)
4. [출력 의도와 최종 출력](#ch04)
5. [함수로 계산을 나누기](#ch05)
6. [시간을 기다리는 제어](#ch06)
7. [시각에 맞추어 시작하기](#ch07)
8. [센서의 값과 품질](#ch08)
9. [식을 정확하게 읽기](#ch09)
10. [멈추고, 바꾸고, 비교하기](#ch10)
11. [파일과 literate 프로그램](#ch11)
12. [하나의 장치, 여러 control](#ch12)
13. [내장함수와 내장 연산](#ch13)
14. [온도 단위와 공기 VPD 제어](#ch14)
15. [이름 있는 물리량과 단위](#ch15)

부록: [A. 명세 길잡이](#appendix-a) · [B. 오류로 배우기](#appendix-b) · [C. 문서 유지 규칙](#appendix-c) · [D. 관심그룹별 예제](#appendix-d)

<a id="ch01"></a>
## 1. 스위치 하나와 출력 하나

### E01 — 입력을 출력에 연결하기

첫 프로그램은 스위치가 켜지면 LED가 켜지고, 스위치가 꺼지면 LED가 꺼진다.

```ghost
// E01
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on;
}
```

`control FollowSwitch`는 프로그램의 이름과 범위를 선언한다.
`input`은 바깥에서 들어오는 값, `output`은 바깥으로 내보낼 값이다.
`Bool`에는 `true`와 `false` 두 값이 있다.

`lamp <- switch_on`은 “이번 출력 계산에서 lamp는 switch_on을 따른다”는 뜻이다.
`<-`를 따라 오른쪽에서 왼쪽으로 읽으면 값의 출처가 보인다.

| 입력 `switch_on` | 출력 `lamp` |
|---|---|
| `false` | `false` |
| `true` | `true` |

표는 Bool의 가능한 값 두 가지를 보여 준다. 해제→누름→해제는 세 번째 값이
아니라 이 두 행을 시간 순서로 거치는 **전이 시나리오**다.

### 접점, PLC 입력, GhostFlow 입력을 나누어 읽기

릴레이 회로에서는 NO(평상시 열림)와 NC(평상시 닫힘)가 접점이 쉬고 있을 때와
눌렸을 때의 물리적 연속성을 다르게 만든다. PLC는 그 전기 상태를 DI에서 읽고,
배선·입력 모듈의 극성을 반영해 프로그램이 사용할 의미로 정규화한다. GhostFlow의
`switch_on`은 이미 정규화된 논리 입력이다. 따라서 이 예제의 경계는 다음처럼
나뉜다.

| 층위 | NO | NC | GhostFlow에 전달하는 값 |
|---|---|---|---|
| 쉬는 상태 | 접점 비연속 | 접점 연속 | `switch_on = false` |
| 누른 상태 | 접점 연속 | 접점 비연속 | `switch_on = true` |

NC에서 raw 접점이 반대로 보이는 것은 입력 정규화의 문제다. 접점 종류가 NC라는
사실 자체가 프로그램에 `!`를 붙인다는 뜻은 아니다. 정규화는 배선·입력 모듈의
경계에서 명시하고, GhostFlow에는 `false` 또는 `true`인 Bool만 전달한다.

짧게 비교하면, 릴레이는 접점의 물리적 경로를 만들고, PLC는 DI와 래더/기능 블록으로
그 입력을 처리하며, GhostFlow는 정규화된 의미 입력을 선언된 출력 계산에 연결한다.
이 문서의 예제는 논리 계산을 설명한다. 실제 접점, 전기 배선, PLC 입력 모듈 또는
장치 출력의 검증은 binding과 Driver 계약의 범위다.

### 실행을 읽는 단위: tick

한 번의 제어 계산을 여기서는 **tick**이라고 부른다. 같은 tick 안에서는 한 번
받아 둔 입력 묶음을 읽는다. 다음 tick에서는 새로운 입력 묶음을 읽는다.

이 프로그램은 값을 기억할 필요가 없다. 따라서 같은 입력에는 같은 출력이 나온다.
3장에서 이전 tick의 값을 기억하는 `state`를 추가한다.

`switch_on`을 DI1에, `lamp`를 RO1에 연결하는 정보는 프로그램 바깥의 매핑이다.
이름만으로 하드웨어 포트가 자동 결정되지는 않는다. 덕분에 같은 계산을 가상
스위치·LED와 장치 I/O에 연결할 수 있다.

### 바꾸어 보기

연결식을 `lamp <- !switch_on;`으로 바꾸자. `!`는 참과 거짓을 뒤집는다.
코드를 실행하기 전에 위 표의 출력 두 칸을 먼저 예측해 보자.


<a id="ch02"></a>
## 2. 이름, 값, 타입, 표현식

### 문장을 구분하는 표기

현재 문법에서 선언과 식 정의는 `;`로 끝난다. `{ }`는 범위이며, 들여쓰기는
사람이 읽기 위한 정렬이다. 공백 두 칸이나 네 칸을 강제하지 않는다.
줄바꿈으로 세미콜론을 대신할 수는 없다. 함수 본문의 마지막 식과 블록 끝처럼
세미콜론이 선택적인 자리도 있다. 부록 A에서 따로 정리한다.

이름은 영문자·밑줄로 시작하고 뒤에 숫자를 붙일 수 있다. 대소문자를 구별하므로
`start`와 `Start`는 다른 이름이다. 예약어와 내부용 `__gf_` 접두사는 이름으로 쓰지 않는다.
한글 설명은 `//` 주석이나 literate 본문에 쓴다. 현재 식별자 자체는 ASCII다.

### 기본 값과 타입

| 타입 | 예 | 읽는 의미 |
|---|---|---|
| `Bool` | `true`, `false` | 참 또는 거짓 |
| `Int` | `120`, `-2` | signed 32-bit 정확한 정수 |
| `Number` | `3`, `0.5`, `-2` | 일반 수치, 내부 표현은 f64 |
| `Percent` | `30%` | 백분율 값. 리터럴·입력 범위는 0~100 |
| `Duration` | `250ms`, `2s`, `5min`, `1h` | 밀리초 해상도의 비음수 시간 길이 |

`Int`, `Number`, `Percent`, `Duration`은 서로 다른 의미의 타입이다. 예를 들어
`Percent`와 `Number`를 그대로 비교할 수 없다. `Int`는 개수·횟수 같은 정확한 정수고,
`Number`는 측정 등에 쓰는 근사 수치다. 정확한 범위와 변환은
[Reference §2.1–2.3](reference/02-types-expressions-state.md#21-값-종류)을 따른다.

기대하는 수치 타입이 없는 정수 모양 리터럴은 `Int`이고, 소수점·지수 리터럴은
`Number`다. 이미 `Number`로 정해진 문맥의 `3`은 처음부터 Number로 해석한다.

`Duration` literal은 음수가 아닌 정수와 `ms`, `s`, `min`, `h` 단위를 사용한다.
반 초는 `500ms`로 쓴다. 자세한 범위와 연산은 Reference §3.1을 따른다.

`"Asia/Seoul"`은 시간대 설정 문맥에서, `06:00`은 일정 설정 문맥에서 사용한다.
일반 문자열이나 시각 값의 문법과 혼동하지 않는다.

### 정확한 계수와 근사 측정

열매 수나 반복 횟수처럼 세는 값은 정확한 정수여야 한다. 예를 들어 `120 + 1`은
정확히 `121`이어야 한다. 반면 온도 `24.3` 같은 측정 실수는 센서와 도메인이 정한
허용 오차 안의 근삿값으로 다룰 수 있다.

GhostFlow는 signed 32-bit `Int`로 정확한 계수를 표현한다. 범위 초과와 잘못된
변환은 조용히 wrap하거나 반올림하지 않고 진단 또는 명시적 runtime fault로 처리한다.
측정 실수는 `Number`를 사용한다. 자세한 규칙은 [Reference §2.3](reference/02-types-expressions-state.md#23-정확한-정수-설계)에서 확인한다.

날짜와 시각은 `date`, `time`, `datetime` tagged literal로 쓴다. DateTime에는
시간대 offset이 필요하다. 날짜시각과 단조 경과시간은 서로 다른 의미다.
[Reference §3.1](reference/03-time-and-schedules.md#31-시간값과-시계-영역)을 따른다.

온도·유량·전압처럼 단위가 판단을 바꾸는 값은 일반 `Number`와 구분한다.
예를 들어 `Temperature`의 `25°C`, `FlowRate`의 `5L/min`, `Voltage`의 `24V`는
고정된 물리량 타입과 단위를 가진다. 허용 단위·변환·연산은
[Reference §2.9](reference/02-types-expressions-state.md#29-물리량과-단위)를 따른다.
`Rate<Q>`는 시간창 계산의 식 전용 타입이며 일반 input/output/state 타입이 아니다.
단위 혼용과 물리량 사이의 연산은 [15장](#ch15)에서 예제로 설명한다.

### E02 — 입력, 설정, 계산에 각각 이름 붙이기

수위가 설정값보다 낮을 때 급수 출력을 켜 보자.

```ghost
// E02
control ThresholdControl {
  input level: Percent;
  config threshold: Percent = 30%;
  let low = case threshold {
    ok(value) => level < value;
    fault(_) => false;
  };

  output pump: Bool;
  pump <- low;
}
```

`level`은 tick마다 공급되는 입력이다. `threshold`는 `config`로 공개한 조절값이고,
`low`는 두 값을 비교한 계산이다. 기본값을 소스에서 바꾸면 새 문서 revision이 된다.
운영 중 변경은 `access = operator`로 공개한 설정에 한해 typed atomic live event로
적용할 수 있다. 메타데이터 계약은 [Reference §5](reference/05-settings-and-observation.md#51-config-선언)를 따른다.
`config threshold: Percent`의 읽기 타입은 `Result<Percent, SettingsFault>`다.
최초 값은 `ok(30%)`이며 이후 오류 observation이 생기면 기본값으로 자동 복구하지 않는다.
이 예제는 fault에서 `low=false`를 선택한다. 언어의 공통 fallback이나 물리 fail-safe 보장은 아니다.
`let`은 저장해 두는 메모리가 아니라 계산에 붙인 이름이다.

| `level` | `threshold`의 정상 payload | `low` / `pump` |
|---|---|---|
| `29%` | `30%` | `true` |
| `30%` | `30%` | `false` |
| `31%` | `30%` | `false` |

`low`의 정의를 출력 연결보다 뒤에 두어도 같은 계산이다. 컴파일러는 선언 순서보다
의존 관계를 따른다. 서로가 서로의 결과를 필요로 하는 순환 `let`은 허용하지 않는다.

**작은 실험:** `<`를 `<=`로 바꾸면 표에서 어느 행만 바뀔까?


<a id="ch03"></a>
## 3. 상태를 기억한다는 것

### E03 — 정지 우선 자기유지

시작 버튼을 잠깐 눌렀다가 떼어도 운전을 유지하고, 정지를 누르면 멈추게 해 보자.

```ghost
// E03
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  output valve, pump: Bool;

  running' = !stop && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```

`running`은 tick 시작 시 기억하고 있던 값이다. `running'`은 이번 tick에서 계산하는
다음 값이다. 끝의 작은 따옴표는 **prime**이라고 읽는다.

식을 말로 읽으면 “정지가 눌리지 않았고, 시작이 눌렸거나 이미 운전 중이었다면
다음에도 운전한다”가 된다. 두 버튼이 동시에 눌리면 `!stop`이 거짓이므로 정지가 이긴다.

| tick | start | stop | 이전 `running` | 다음 `running'` | pump |
|---|---|---|---|---|---|
| 1 | false | false | false | false | false |
| 2 | true | false | false | true | true |
| 3 | false | false | true | true | true |
| 4 | true | true | true | false | false |
| 5 | false | false | false | false | false |

출력에서 `running'`을 읽으므로 시작한 tick에 출력도 켜진다.
`pump <- running;`으로 바꾸면 이전 값을 출력하므로 이 예제에서는 한 tick 늦어진다.
이는 문장 위치가 아니라 **어느 시점의 값을 참조했는가**의 차이다.

### PC-02 — 새 시작을 기다리는 START / STOP

E03의 기본 자기유지는 그대로 보존한다. PC-02는 [별도 literate 원본](../examples/curriculum/pc-02-start-stop.ghost.md)에서
`stop_ok`, `armed`, `running`, `start_event`를 추가해 정지 우선과 재시작 억제를 표현한다.
STOP에서 복귀할 때 START를 계속 누르고 있으면 새 시작 사건이 아니므로 출력은 꺼진 채로
남고, START를 놓았다가 다시 눌러야 `running'`과 펌프·밸브 출력이 켜진다. 이 예제는
E03을 대체하지 않으며, 실제 접점·릴레이 동작은 별도의 설치 계약으로 확인한다.

### PC-03 — 모터 접촉기 명령과 과부하 허가

PC-03은 [canonical literate 원본](../examples/curriculum/pc-03-motor-contactor.ghost.md)에서
PC-02의 새 시작 사건과 자기유지를 모터 제어 명령에 연결한다. `stop_ok`와
`overload_ok`는 모두 정규화된 허가 입력이다. NC 접점의 배선과 극성은 전기·장치
어댑터가 정하며, 이 프로그램은 Bool 의미만 읽는다.

핵심 식은 `permit = stop_ok && overload_ok`, `start_event = armed && start`,
`running' = permit && (start_event || running)`, `armed' = permit && !start`,
`motor_contactor <- running'`이다.

`motor_contactor`는 MC 코일에 대한 논리 명령 하나다. MC 주접점 폐쇄, 모터 전원,
모터 회전의 피드백이나 증명이 아니다. 주회로(차단기·MC 주접점·과부하 계전기·모터)와
제어회로(제어전원·STOP·과부하 보호접점·START/MC 보조접점 자기유지 분기·MC 코일)는
구분해서 읽어야 하며, 소프트웨어 명령은 독립적인 전기적 보호를 대체하지 않는다.
알람, fault latch/reset, timer, 센서 피드백과 하드웨어 동작은 이
curriculum/learning scenario의 범위 밖이다.

이 예제는 `requested` intent와 `safe` 결과를 구분해 설명한다. 릴레이·MC·모터의
physical evidence는 언어의 출력 intent에 포함되지 않는다.

### PC-04 — 정회전·역회전 방향전환 인터록

PC-04는 [canonical literate 원본](../examples/curriculum/pc-04-direction-interlock.ghost.md)에서
실행한다. 기존 [E06 — 두 방향을 동시에 요청하면](#e06--두-방향을-동시에-요청하면)은 보존하며,
두 출력이 동시에 후보가 될 때 `mutex`가 양쪽을 차단하는 기본 예제로 참조한다. PC-04는
그 제약만 복사하지 않고, 정회전·역회전의 논리적 운전 상태와 방향전환 사이의 정지 대기를
명시한다.

입력 `forward_start`, `reverse_start`는 momentary 시작 입력이고 `stop_ok`, `overload_ok`는
정상일 때 참인 정규화 허가 입력이다. 상태는 `Stopped | Forward | Reverse | WaitForward |
WaitReverse`이며, `start_armed=false`에서 시작한다. 두 시작 입력이 함께 들어오면 우선권을
만들지 않고 정지한다. 운전 중 반대 방향의 새 누름은 먼저 Wait 상태로 전이하여 두 접촉기
명령을 즉시 끄고, 설정된 `reversal_wait = 2s`가 경과한 뒤에만 반대 방향을 켠다.
대기 중 새 방향 요청으로 목표가 바뀌면 대응하는 Wait 상태로 옮겨 대기시간을 다시
센다. 이전 목표가 남아 작업자의 새 요청과 반대로 기동하는 경우를 허용하지 않는다.

`forward_contactor`와 `reverse_contactor`는 접촉기 코일에 보낼 논리 명령일 뿐이다. `mutex`는
소프트웨어 backstop이며, 실제 설비에서는 전기적·기계적 인터록이 별도로 필요하다. 2초가
지났다는 사실은 모터가 실제로 정지했다는 증거가 아니며, zero-speed feedback은
별도의 입력과 Driver 계약으로 표현한다.

### PC-05 — 리미트 피드백으로 밸브 끝 위치를 확인하기

PC-05는 [canonical literate 원본](../examples/curriculum/pc-05-limit-feedback.ghost.md)에서
실행한다. 기존 E06과 PC-04를 보존·참조하며 `Phase`, `elapsed(phase)`, 다음 상태와
출력 연결로 명령과 완료 관측을 구분한다.

momentary `open_request`/`close_request`, 끝 위치 관측 `open_limit`/`close_limit`,
허가 `stop_ok`/`overload_ok`를 받는다. 초기 위치를 지어내지 않고 `Stopped`에서
시작하며, 정지 상태에서도 관측하던 limit이 사라지면 과거 상태만 믿지 않는다.
양쪽 limit이 동시에 참이면 `SensorConflict`로 가고 양쪽 출력은 꺼진다. 반대 방향의
새 요청은 목표 limit보다 우선해 양쪽 코일 명령을 끈 뒤 2초 경계에서만 이동을 재개한다.

끝 위치가 오지 않는 `Opening`/`Closing`은 timeout과 fault 정책으로 다룬다. 명령과
끝 위치 관측은 별개의 값이며, physical stop은 Driver와 safety chain의 책임이다.

### PC-06 — ON-delay, OFF-delay, 최대 운전을 따로 읽기

PC-06은 [canonical literate 원본](../examples/curriculum/pc-06-timer-patterns.ghost.md)에서
세 타이머 의미를 독립된 상태로 보여 준다. `on_delay_request`는 2초 유지 뒤 켜지고,
`off_delay_request`는 요구가 사라진 뒤 3초 동안 더 켜지며, `limited_request`는
10초가 되면 꺼진 뒤 요구를 놓기 전에는 다시 시작하지 않는다. 세 입력은 momentary
버튼 사건이 아니라 현재 유지되는 운전 요구다.

세 의미를 한 타이머로 섞지 않으므로 OFF-delay가 최대 운전시간을 몰래 늘리지 않는다.
`stop_ok=false`는 OFF-delay까지 건너뛰어 세 출력을 즉시 끈다. 경계 직전·정확·직후와
취소·재요청은 같은 논리 tick 규칙으로 판단한다. 벽시계 속도와 논리 시간의 의미를
혼동하지 않는다.

### PC-07 — 두 수위 스위치 사이를 상태로 기억하기

PC-07은 [canonical literate 원본](../examples/curriculum/pc-07-tank-hysteresis.ghost.md)에서
디지털 두 점 수위제어를 다룬다. `low_level_reached`와 `high_level_reached`는 물이
각 물리 스위치에 도달했다는 정규화 관측이다. 아래 저수위에서 `Filling`을 시작하고,
하한과 상한 사이에서는 그 상태를 유지하며, 상한 도달 때 멈춘다. 처음부터 중간 수위면
과거의 저수위 사건이 없으므로 켜지 않는다.

상한만 참이고 하한이 거짓이면 물리 순서와 모순되므로 `SensorConflict`에서 출력이
꺼진다. 충돌 해소 scan은 한 번 `Idle`로 복구한 뒤 정상 평가를 재개한다. 공통 정지·
보호와 fault latch/reset은 이 수위 개념에 섞지 않고 PC-08/PC-10에서 결합한다.
기존 [tutorial/03](../examples/tutorial/03-moisture.ghost.md)의 연속 센서 median·quality·hysteresis 예제는 별개로 보존한다.

### PC-08 — 수동·자동의 출력 소유권을 바꾸기

PC-08은 [canonical literate 원본](../examples/curriculum/pc-08-manual-auto.ghost.md)에서
PC-03의 수동 시작·자기유지와 PC-07의 자동 수요를 하나의 펌프에 연결한다.
`manual_mode_request`와 `auto_mode_request`가 둘 다 거짓이면 `Off`, 하나만 참이면
해당 모드, 둘 다 참이면 `ModeConflict`다. 충돌·Off·모드 변경 scan에는 펌프 명령이
항상 꺼진다.

`manual_start`는 momentary 시작 사건이고 `auto_demand`는 유지되는 자동 요구다.
공통 `request_armed`는 안정된 모드에서 선택된 요구가 거짓인 것을 먼저 관찰한 뒤에만
새 참을 시작 사건으로 인정한다. 따라서 운전 중 모드를 바꾸거나 정지·과부하 허가가
복구되어도 이미 켜져 있던 요구로 재기동하지 않는다. Auto 운전 중 수요가 사라지면
즉시 정지한다. 기존 [station-rules.ghost.md](../examples/station-rules.ghost.md)와
[tutorial/04](../examples/tutorial/04-extra-valves.ghost.md)는 복수 control·공유 자원
중재라는 심화 범위로 그대로 보존한다.

이 예제는 모드 충돌을 명시적인 상태와 출력 식으로 다룬다. 코일 폐쇄나 펌프 회전은
별도의 장치 확인이다.

### PC-09 — 열린 것을 확인한 뒤 펌프를 켜기

PC-09는 [canonical literate 원본](../examples/curriculum/pc-09-sequential-water-supply.ghost.md)에서
`Idle → Opening → Settling → Watering → PumpStopping → Closing → Idle` 순서를
명시한다. 밸브 열림 출력이 켜졌다는 사실과 밸브가 실제 열린 위치에 도달했다는 관측을
구분한다. `open_limit`가 확인된 뒤 2초 동안 유지되어야 펌프가 켜지고, 5분 관수가
끝나는 scan에는 펌프를 먼저 끈다. 다음 논리 scan부터 닫힘 접촉기를 켜므로 별도 지연을
지어내지 않으면서 출력 순서를 보장한다.

열린 위치 피드백이 사라지거나 두 limit가 동시에 켜지거나 정지·과부하 허가가 사라지면
모든 출력이 꺼진다. 원인이 사라졌다는 이유만으로 재시작하지 않고, 닫힌 위치와 해제된
START를 본 뒤 새 START를 요구한다. 열림·닫힘 무응답 timeout, 고장 latch, alarm,
reset과 고장별 안전 복구는 PC-10의 책임이다.

기존 tutorial/02의 시간만으로 이어지는 순서와 tutorial/04의 여러 control 간 공유 펌프
중재는 서로 다른 학습 의도이므로 그대로 보존한다. 이 예제는 논리 명령과 밸브 이동·
펌프 회전·유량 관측을 서로 다른 계약으로 다룬다.

### PC-10 — 고장 원인을 붙잡고 안전하게 복구하기

PC-10은 [canonical literate 원본](../examples/curriculum/pc-10-fault-alarm-reset.ghost.md)에서
PC-09의 순차 운전에 fault cause, alarm, reset을 추가한다. 이 문서의 GhostFlow 블록이
유일한 실행 원본이며, 아래 설명이나 추출된 코드가 별도의 편집 가능한 원본이 되지는
않는다. 기존 PC-01~PC-09 예제의 학습 의도는 보존하고, 이 과는 고장 검출과 복구라는
새 의도만 더한다.

안전 판단의 우선순위는 `EmergencyStop > Overload > ValveDriveUnavailable >
SensorConflict > FeedbackLost > OpenTimeout/CloseTimeout > LowSourceWater`다.
동일 scan에 여러 원인이 있으면 이 순서의 최초 원인을 `FaultCause`로 latch하고,
이후 live input 변화가 그 원인을 덮어쓰지 않는다. 비상정지는 외부 hardwired
safety chain이 에너지를 차단해야 하며, GhostFlow의 관측 입력과 alarm은 그 물리
차단이나 실제 장비 동작을 보증하지 않는다.

정상 `STOP`은 고장이 아니다. `stop_ok == false`이면 모든 motion output과 alarm을
즉시 끄고 `Idle`로 돌아가며 자동 재시작하지 않는다. fault는 latch된 원인뿐 아니라
현재의 모든 fault 조건이 해제되고 `known_closed`가 확인된 뒤 RESET을 한 번 놓았다가
다시 누르는 release/repress 절차로만 해제된다. secondary live fault가 남아 있으면
RESET은 차단된다. RESET은 `Idle` 복귀일 뿐 START를 대신하지 않으므로, 해제된
START를 본 뒤 새 `START`가 있어야 다시 운전한다.

`LowSourceWater`는 확인된 열린 밸브와 닫힘 구동 허가가 있을 때만 예외적으로
orderly close한다. `FaultPumpStopping`에서 한 논리 scan 동안 펌프를 먼저 끄고,
그 다음 `FaultClosing`에서 밸브 닫힘을 요청한다. 다른 고장·안전 조건은 즉시
all-off fault로 간주한다. 열림/닫힘 timeout은 각각 10초이며 정확한 경계에서
목표 limit 관측이 timeout보다 우선한다.

이 예제는 semantic DI를 물리 배선과 혼동하지 않는다. 첫 제어함의 기존 의미
`START`, `STOP`, `MODE`, 탱크 상·하한, open/close limit, overload는 8 DI이고,
`RESET`, E-stop 관측, source-water-low, valve-drive-ok를 분리하면 총 12개 의미가
된다. 따라서 8DI 설치에서는 외부 safety-chain 집계, 인증된 host command, DI 확장
중 설치별 선택이 필요하다. 의미를 조용히 합치거나 생략하지 않는다.

현재 `require` 문법은 Bool **출력 관계**만 표현한다. 입력 안전 조건과 fault 우선순위는
`phase` 전이와 출력 식에 명시한다. 그러므로
`require`만으로 입력 안전 정책 전체를 표현한다고 해석하지 않는다.

이 예제의 판단은 논리 intent와 feedback 입력을 구분한다. 언어 의미만으로 Web UI,
MCU upload, 접촉기 에너지 차단, 밸브 이동, 펌프 회전의 physical acceptance를 주장하지 않는다.


### E04 — 여러 상태는 함께 바뀐다

```ghost
// E04
control TwoStates {
  state a: Bool = true;
  state b: Bool = false;
  output out_a, out_b: Bool;

  a' = b;
  b' = a;
  out_a <- a';
  out_b <- b';
}
```

첫 tick 뒤에는 `a=false`, `b=true`가 된다. 둘째 tick 뒤에는 다시
`a=true`, `b=false`가 된다. 두 식 모두 같은 이전 상태를 읽어서 값을 교환한다.
소스를 위에서 아래로 실행하며 `a`를 먼저 덮어쓰는 대입문으로 읽으면 안 된다.

현재 다음 상태 참조는 출력식에서만 허용한다. `b' = a';`처럼 다른 상태의 다음 값을
상태 전이에 사용하는 코드는 거부한다. 여러 전이가 필요한 같은 계산은 `let`으로
이름 붙여 공유할 수 있다.

**설계 이유:** 이전 상태와 다음 상태를 명시하면 “이번 판단의 근거”를 보존하면서
상태를 동시에 갱신할 수 있다. 이 구분이 타이밍 비교와 소스 옆 값 표시의 기준이 된다.

사용자는 [#149](https://github.com/callin2/ghostflow-language/issues/149)에서 이 선택을
설명했어요. React/ObservableHQ에서 차용한 점은 event stream 안에서 제어를 평가하고
next state를 명시적으로 반환하는 방식이에요. recursive 또는 loop 형태의 제어가
전기 기술자에게 추적하기 어려울 수 있다는 것은 사용자의 교육적 전제예요.
E04에서는 이전 `a`, `b`를 읽고 `a'`, `b'`를 기술한 뒤 둘을 함께 확정하므로 시간
경계가 보여요. 이는 가독성의 목표이며 전기 기술자 전체에 대한 일반적 판단이 아니에요.
실행 코드에서는 E04처럼 ASCII apostrophe (`'`)를 써요. 대화의 backtick과 뒤이은
assistant 제안이 추가 문법, time-travel, 인과 설명 기능을 만들지는 않아요.
실행 규칙은 [Reference §2.8](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)을 따라요.

성공한 tick은 이번 입력 snapshot과 이전 state에서 candidate next를 계산하고, requested intent와
safe intent를 계산한 뒤 상태와 intent 기록을 원자적으로 확정한다. 선택된 식의 runtime
fault는 부분 갱신 없이 tick을 거부한다. 출력 제약의 차단은 이 평가 실패와 다르며,
성공한 tick의 상태 확정을 취소하지 않는다.


<a id="ch04"></a>
## 4. 출력 의도와 최종 출력

이 장의 «최종 출력»은 runtime의 **safe intent**다. `<-`는 **requested intent**를 만들고,
제약은 이를 제한한다. **applied**는 Driver가 적용한 command의 근거이고,
**confirmed**는 limit·encoder 같은 별도 feedback의 근거다. safe가 참이어도 실제 릴레이나
펌프가 동작했다고 말할 수 없다. [Reference §4.7](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)과
[물리 Driver 경계](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary)를 함께 읽는다.

### E05 — 켜 달라는 요청과 허용되는 출력

“펌프를 켜 달라”는 계산 결과와 “펌프를 켜도 된다”는 판정은 다를 수 있다.
이번에는 두 값을 일부러 다르게 만들어 보자.

```ghost
// E05
control PumpPermission {
  input request, valve_ready: Bool;
  output pump, valve: Bool;

  pump <- request;
  valve <- valve_ready;
  require pump => valve;
}
```

| request | valve_ready | 후보 pump / valve | 최종 pump / valve |
|---|---|---|---|
| false | false | false / false | false / false |
| true | true | true / true | true / true |
| true | false | true / false | false / false |

마지막 행에서는 `<-`가 만든 펌프 의도가 참이지만 `require`가 차단한다.
`pump => valve`는 펌프가 요청되면 밸브도 요청되어 있어야 한다는 조건이다.
밸브를 강제로 켜서 조건을 맞추지 않고 펌프를 끈다.

```text
request ─────────────→ pump 의도 ──┐
                                  ├─ require 검사 ─→ 최종 pump
valve_ready ─────────→ valve 의도 ─┘
```

이 예제에서 `valve_ready`는 입력 이름일 뿐이다. 그 값이 어떤 센서나 계산에서
왔는지는 입력 매핑이 설명한다. “출력이 참인 이유”와 “입력의 출처”를 함께 보아야
전체 설명이 완성된다.

### E06 — 두 방향을 동시에 요청하면

```ghost
// E06
control DirectionInterlock {
  input forward_button, reverse_button: Bool;
  output forward, reverse: Bool;

  forward <- forward_button;
  reverse <- reverse_button;
  mutex(forward, reverse);
}
```

두 입력이 모두 참이면 두 출력 모두 거짓이 된다. 먼저 쓴 출력이나 먼저 눌린 버튼에
자동으로 우선권을 주지 않는다. `require !(forward && reverse);`도 이 두 출력의
동시 요청을 차단하는 표현이다.

여러 제약이 연결되어 있으면 차단 결과를 반영하며 더 이상 바뀌지 않을 때까지
적용한다. 예를 들어 밸브가 다른 제약 때문에 꺼지면 그 밸브를 요구하는 펌프도 꺼진다.
현재 지역 Bool 제약은 참인 출력을 거짓으로 내리는 방식이며 임의의 논리식을
만족시키는 조합을 자동으로 찾는 언어 기능은 아니다.

중요하게도 제약이 출력을 차단했다고 해서 `state`가 자동으로 되돌아가지는 않는다.
정지 상태로 옮기고 싶다면 그 상태 전이도 프로그램에 표현해야 한다.

**작은 실험:** E03에서 `pump <- start;`로 바꾸고 시작 버튼을 떼 보자.
`running`이 참으로 남는 것과 `pump`가 꺼지는 것을 별도로 설명할 수 있을까?


### 이름 있는 지역 묶음과 공유 자원의 허용 범위

E05·E06은 자기 control의 출력 제약이다. 같은 규칙을
`constraints LocalRules { require pump => valve; }`처럼 이름 있는 지역 묶음에 넣어도
그 범위와 Bool 제약 의미는 같다. 제약은 목표가 움직일 수 있는 허용 영역이며 필수
조건은 모두 AND다. 우선순위나 선택적인 비차단 분석이 필수 조건을 해제하지 않는다.

공유 자원은 [완전한 bound 실행 예제](../examples/bound-resource-execution.ghost.ko.md)로
이어 읽는다. `constraints SharedRules for station`의 검사 결과만으로 보호 출력이
실행되지는 않는다. `compileSourceSync`의 checked descriptor에 정확한 source/artifact,
안정 ID와 mode/output mapping을 명시 결속하는 `compileBoundResourceControl` 단계가
필요하다. 그 artifact는 실제 Rust/WASM scan에서 자동·수동·fallback의 모든 지원
경로를 같은 guard로 검사한다. host가 출력 후 JavaScript filter를 붙이는 방식이 아니다.

예제에서는 실행 중 관계 위반에 pump OFF·valve ON이라는 작성 safe vector를 사용한다.
시작 전 위반은 새 admission을 거부하며, 충돌한 newcomer가 기존 admission을 빼앗거나
숨은 대기열로 들어가지 않는다. trip은 조건 정상화만으로 풀리지 않는다. exclusive
group은 neutral 관측 뒤 새 claim, require-only group은 requested=authored safe 관측
뒤 새 요청이 필요하다. 연결된 group은 같은 scan에서 함께 복구한다. 정상 평가한
denial은 ordinary state를 commit하고, binding/VM 오류는 state·guard·trace를 rollback한다.

이것은 모든 출력을 명시 mapping한 Bool GFB1 v1/v3 control 하나의 논리 실행이다.
설치 authority는 writer의 registry를 공유하며 같은 안정 ID의 두 번째 활성 writer를
허용하지 않는다. 별도 설치 registry가 물리 배타성을 인증하지는 않는다. 임의 PID,
context, shared-policy import composition, 여러 VM의 협력 중재와 물리 안전 순서는
별도 경계다. E05·E06의 기존 결과와 재현 기록을 이 새 예제의 결과로 바꾸지 않는다.
[Reference §4.8](reference/04-sensors-constraints-control.md#48-공통-constraints-표기와-연산)과
[제약 계약](CONSTRAINTS.md#공유-bool-실행)은 source·binding·admission·safe 근거를 구분한다.

<a id="ch05"></a>
## 5. 함수로 계산을 나누기

### E07 — 자기유지 계산을 함수로 꺼내기

```ghost
// E07
fn hold(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}

control FunctionLatch {
  input start, stop, enabled: Bool;
  state running: Bool = false;
  output pump: Bool;

  fn permitted(request: Bool, allow: Bool) -> Bool {
    request && allow
  }

  running' = permitted(hold(start, stop, running), enabled);
  pump <- running';
}
```

`fn`은 함수 정의이고 `-> Bool`은 결과 타입이다. 본문의 마지막 식이 결과이므로
별도의 `return` 문장을 쓰지 않는다. 함수 호출은 `hold(start, stop, running)`처럼 쓴다.

두 함수는 값을 받아 계산한 값을 돌려준다. `enabled=false`이면 `permitted`가
거짓을 반환하므로 다음 상태도 꺼진다. `enabled=true`인 동안은 E03의 자기유지와 같다.

현재 함수는 바깥의 입력·상태·설정값을 직접 가져다 쓰지 않고 매개변수로 받는다.
필요한 값이 호출부에 드러나므로 의존 관계를 읽기 쉽다. 예를 들어 `hold` 안에서
전역 `running`을 직접 읽으려 하면 거부한다.

함수는 컴파일 때 정적으로 펼쳐진다. 재귀 호출과 순환 호출은 거부한다.
함수 내부에 시간 동안 멈추는 실행 흐름이나 자기만의 가변 상태를 만들지 않는다.
기억이 필요하면 `state`, 시간이 필요하면 다음 장의 타이머로 표현한다.

**작은 실험:** `permitted(hold(...), enabled)`에서 `enabled`가 거짓이 되었다가
다시 참이 되면 시작 버튼 없이 운전이 재개될까? E03의 상태 표를 확장해 보자.


<a id="ch06"></a>
## 6. 시간을 기다리는 제어

### E08 — 입력이 2초 유지되면 켜기

```ghost
// E08
control DelayedStart {
  input start: Bool;
  config delay: Duration = 2s;
  type Phase = Idle | Waiting | Running;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  output motor: Bool;

  phase' = case delay {
    ok(value) => case phase {
      Idle => if start then Waiting else Idle;
      Waiting =>
        if !start then Idle
        else if age >= value then Running else Waiting;
      Running => if start then Running else Idle;
    };
    fault(_) => Idle;
  };

  motor <- phase' == Running;
}
```

`type Phase = ...`는 이름 있는 유한 상태들의 타입이다.
`case phase`는 현재 단계에 해당하는 식을 골라 다음 단계를 계산한다.
모든 경우를 적어야 하며 `if`의 두 결과는 같은 타입이어야 한다.

`delay`는 `Result<Duration, SettingsFault>`다. `ok(value)`에서만 그 payload로 시간을 비교한다.
이 예제는 config fault 때 대기를 취소하고 `Idle`로 전이해 출력 intent를 끈다.
이후 유효한 config와 `start=true`를 읽으면 새 대기를 시작한다. `2s`는 최초 `ok`의
payload이며 오류 fallback이 아니다. 이 선택은 이 예제의 정책이고 언어·Driver의
기본 정책이나 물리 fail-safe 보장이 아니다.

`elapsed(phase)`는 **phase가 마지막으로 확정 변경된 이후의 경과 시간**이다.
`Idle`에서 `Waiting`으로 바뀐 tick의 확정 시점에 타이머가 0으로 재설정된다.
조건이 참인 첫 tick에 다음 단계로 바뀌며 한 tick에 여러 단계를 건너뛰지 않는다.

| 논리 시각 | start | 읽는 단계 | 읽는 age | 다음 단계 | motor |
|---|---|---|---|---|---|
| 0ms | false | Idle | 0ms | Idle | false |
| 1000ms | true | Idle | 1000ms | Waiting | false |
| 2999ms | true | Waiting | 1999ms | Waiting | false |
| 3000ms | true | Waiting | 2000ms | Running | true |
| 4000ms | false | Running | 1000ms | Idle | false |

시작 시점은 버튼의 물리적인 변화 시각이 아니라 이 예제에서 그 변화를 읽고
`Waiting`으로 전이한 tick이다. 따라서 1000ms부터 2000ms를 세었다.

### 가속은 시간을 바꾸는 일

시뮬레이션에서 10배속으로 실행해도 소스의 `2s`를 `200ms`로 고치지 않는다.
논리 시각을 실제 대기 시간보다 빠르게 진행시킨다. 각 tick의 논리 시각과 입력이
같다면 배속에 상관없이 같은 판단이 나와야 한다.

타이머 계산에 필요한 시각, DI 입력 묶음, 최종 RO 출력의 경계는 공통이어야 한다.
native와 WASM은 같은 Rust core에서 식·상태·타이머·제약을 실행한다. 호스트는 입력과
논리 시각·scan 기회를 공급하며, Device의 실제 I/O Driver는 별도 경계다.
프레임과 Driver의 구체 API는 호스트 계약이며 이 소스에 플랫폼 분기를 넣지 않는다.

현재 CLI 시뮬레이터는 입력과 requested/safe intent를 보여 주는 가상 I/O다.
펌프 intent로 탱크 수위나 센서값을 자동 생성하는 plant model은 없다.
별도로 명시한 온실 온도 plant model은 지원하며, 그 가상 적용·feedback도 물리 장치의 근거가 아니다.
piped mode는 명시한 scan에서만 진행하고, interactive TTY는 실제 경과시간을 공급한다.
일정·센서·인증 interval은 해당 호스트 capability가 필요하다. 실행 경로와 재현 명령은
[Authoring and virtual simulation architecture](LLM-TOOLCHAIN-ARCHITECTURE.md#reproduce-the-public-path)를 따른다.

**작은 실험:** 2999ms 다음 tick을 3500ms로 옮겨 보자. 모터는 그 tick에서 켜진다.
타이머 조건은 2초지만 관찰과 전이는 tick 시점에서 이루어진다.


<a id="ch07"></a>
## 7. 시각에 맞추어 시작하기

### E09 — 하루의 두 시각에 5분 운전하기

```ghost
// E09
control ScheduledPulse {
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 18:45];
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  let run_time = 5min;
  type Phase = Idle | Watering;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  output valve, pump: Bool;

  phase' = case phase {
    Idle => if starts.due then Watering else Idle;
    Watering => if age >= run_time then Idle else Watering;
  };

  valve <- phase' in {Watering};
  pump <- phase' == Watering;
  require pump => valve;
}
```

`DailySlots<15min>`은 지역 날짜에서 15분 격자의 시각을 선택한다. 중복 slot과 grid 밖 시각은 거부한다. `starts.due`는 schedule projection이며, occurrence의 admission과 missed/unknown 근거는 별도 observation으로 보존한다. 이 일정은 pulse basis, 신뢰 시계, 60초 관측 gap, baseline recovery와 skip fallback을 명시한다. [Reference §3.5–3.6](reference/03-time-and-schedules.md#36-선택된-dailyslots)를 참조한다.

| 사건 | 이전 단계 | 다음 단계 | pump |
|---|---|---|---|
| 선택된 시작 사건 | Idle | Watering | true |
| 5분 미만 경과 | Watering | Watering | true |
| 5분 이상 경과한 첫 tick | Watering | Idle | false |

`in {Watering}`은 집합에 포함되는지 검사한다. 상태가 여러 개면
`phase' in {Opening, Watering, Closing}`처럼 같은 타입의 값들을 나열할 수 있다.

이 소스에는 대기열이 없다. 이미 Watering일 때 다른 시작 사건이 와도 저장하지 않는다.
일정의 occurrence identity, 중복 억제, missed 처리와 replay evidence는 Reference §3.5의 계약을 따른다. 다른 일정의 교차·누락을 임의 catch-up하지 않는다.

**독해 질문:** Watering 분기가 다른 시작 사건을 읽어 종료 시각을 바꾸는가?
현재 선택된 두 시각의 간격은 5분보다 길다. 이 질문은 분기 독해이며,
public simulator에 숨겨진 `starts.due` 입력을 주입하는 실행 시나리오가 아니다.


### 달력 시각과 자연 사건

달력 시각, 일정, 단조 경과시간은 서로 다른 입력 의미다. 날짜와 시각은 tagged literal이며, 반복 일정은 타입별 `schedule` 선언으로 표현한다. `DailySlots`, `Periodic`, `cron5`, solar·lunar·tide context, time zone, gap recovery와 필수 fallback의 정확한 표기는 [Reference §3](reference/03-time-and-schedules.md)을 따른다.

일출·일몰, 조석 예측, 달력과 시계의 데이터는 외부 provider/Driver 계약에 의존한다. 소스는 기준 사건과 fallback을 명시한다. 예측 자료를 Bool 하나로 숨기거나 시각이 항상 신뢰된다고 가정하지 않는다. Reference가 정한 정책을 읽고 필요한 환경 capability를 binding에서 공급한다.

<a id="ch08"></a>
## 8. 센서의 값과 품질

### 입력값과 측정값

앞의 `input level: Percent`는 호스트가 이번 계산에 사용할 값을 공급하는 선언이었다.
실제 센서에는 값뿐 아니라 아직 준비되지 않음, 단절, 오래된 측정 같은 상태가 있다.
`sensor`를 읽을 때는 정상값을 얻었는지 함께 처리한다.

### E10 — 흔들리는 수분값으로 급수 판단하기

```ghost
// E10
control MoistureControl {
  input enabled: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(3);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  let need_water = case dry {
    ok(value) => value;
    fault(_) => false;
  };

  output pump: Bool;
  pump <- enabled && need_water;
}
```

`sample`은 원하는 측정 간격의 정보다. 이 선언은 센서를 직접 읽는 스레드를 만들지
않으며 호스트가 시간표가 붙은 측정값을 공급한다.
`valid`는 유효 범위, `median(3)`은 세 유효 측정의 중앙값 필터다.
`stale_after`는 오래된 측정을 판정하는 기준이고 `recover_after`는 정상 복귀 조건이다.
필터 창이 준비되는 것과 복구 조건을 만족하는 것을 함께 고려해야 한다.

`hysteresis`는 켜지는 경계와 꺼지는 경계를 나눈다. 정상 측정에 대해 필터값이
30% 아래이면 건조 상태로 켜고, 35% 위이면 끈다. 두 경계 사이에서는 이전 판단을
유지한다. 정확히 30% 또는 35%인 경우에도 이전 판단을 유지한다.
따라서 30% 부근에서 값이 흔들릴 때 출력을 매번 반전시키지 않는다.

예를 들어 준비된 필터에 들어온 세 값이 `29%, 90%, 28%`이면 중앙값은 `29%`다.
정상 품질이고 `enabled=true`라면 이 값은 건조 판단과 급수 요청으로 이어진다.

`ok(value)`는 정상 결과에 이름을 붙인다. `fault(_)`의 `_`는 여기서 오류의 구체 값을
계산에 사용하지 않는다는 뜻이다. 대체값을 `false`로 선택해도 원래의 품질 정보는
실행 기록에 남는다. 여기서 `ok`와 `fault`는 case 패턴이다. 현재 언어에는
compiler-owned fault 타입을 가진 내장 `Result<T, E>`의 `ok(...)`·`fault(...)` 생성자와
정적 `map`·`and_then`·`recover` 변환도 있다. 사용자 정의 오류 ADT나 일반 고차 함수와는
구분한다. [Reference §2.5](reference/02-types-expressions-state.md#25-sensor-결과와-명시적-오류-흐름)를 따른다.

### E14 — 선택적인 센서

```ghost
// E14
control OptionalMoisture {
  sensor moisture?: Percent;
  output request: Bool;
  adapt moisture_policy {
    strategy WithMoisture priority 100 match (moisture: sensor<Percent>) {
      request <- case moisture {
        ok(value) => value < 30%;
        fault(_) => false;
      };
    }
    strategy Baseline priority 0 match always {
      request <- false;
    }
  }
}
```

`?`는 센서가 선택적인 설치 능력임을 나타내는 선언 정보다.
설치된 센서의 정상값은 `WithMoisture`에서 비교하고, fault일 때는 거짓을 요청한다.
미설치 때는 `Baseline`이 거짓을 요청한다. `?` 하나만으로 대체 전략이 생성되지는 않는다.
자세한 규칙은 [Reference §4.5–4.6](reference/04-sensors-constraints-control.md#45-선택-sensor와-capability)을 따른다.

**작은 실험:** E10의 켜짐·꺼짐 경계를 똑같이 만들면 어떤 문제가 생길까?
판단할 때 원시 측정값과 필터 결과 중 어느 값을 차트에서 봐야 할까?


<a id="ch09"></a>
## 9. 식을 정확하게 읽기

### E12 — 수치와 연산자

```ghost
// E12
control NumbersAndOperators {
  input a, b: Number;
  output sum, difference, product, quotient, negative: Number;
  output equal, different, less, at_most, greater, at_least: Bool;

  sum <- a + b;
  difference <- a - b;
  product <- a * b;
  quotient <- a / b;
  negative <- -a;
  equal <- a == b;
  different <- a != b;
  less <- a < b;
  at_most <- a <= b;
  greater <- a > b;
  at_least <- a >= b;
}
```

`a=6`, `b=2`일 때 수치 출력은 순서대로 `8, 4, 12, 3, -6`이다.
Bool 출력은 `false, true, false, false, true, true`다.
Number 출력도 논리적으로 관찰할 수 있지만 Bool 릴레이 포트에 그대로 매핑하는 값은 아니다.

우선순위는 강한 쪽부터 다음과 같다.

| 순위 | 표기 |
|---|---|
| 1 | 괄호, 함수 호출, 멤버·다음 상태 참조 |
| 2 | 단항 `!`, `-` |
| 3 | `*`, `/` |
| 4 | `+`, `-` |
| 5 | `in {…}` |
| 6 | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| 7 | `&&` |
| 8 | `||` |

같은 우선순위의 이항 연산은 왼쪽부터 묶인다. `6 - 2 - 1`은 `(6 - 2) - 1`이다.
복잡한 조건은 괄호나 이름 있는 `let`으로 나누어 읽자.

`=>`는 일반 산술·논리 연산자와 다르다. 출력 제약의 관계와 case 분기의 연결 표기로
쓰며 보통 식에 임의로 넣을 수 없다.

### E13 — 조건식이 있다는 것과 계산을 생략한다는 것

`if`, `&&`, `||`는 왼쪽부터 결정적으로 단락 평가한다. 선택되지 않은 branch의
runtime fault는 발생하지 않지만 모든 branch는 정적으로 타입 검사된다. 예를 들어:

```ghost
// E13
control SafeDivision {
  input a, b: Number;
  let zero = b == 0;
  let denominator = if zero then 1 else b;
  output result: Number;

  result <- if zero then 0 else a / denominator;
}
```

`a=6, b=2`이면 `3`, `a=6, b=0`이면 `0`을 선택한다.
0인 경우의 `0`은 이 프로그램이 정한 대체 결과다. 이런 선택 자체가 필요 없는
도메인에서는 오류를 그대로 드러내는 것이 더 적절할 수 있다.


### E11 — canonical 표기만 사용하기

새 프로그램은 `fn`, `type Mode = Off | On;`, `running' = ...;`, `if c then a else b` 표기를 사용한다. `purefn`, `enum` 구문, `next running`, `input.start`, `state.running`, `ifthenelse(...)`는 허용 alias가 아니다. 과거 문서에서 이 표기가 보이면 [Reference §1.6](reference/01-source-and-syntax.md#16-대표-표기-참고-별칭과-역사적-대안)의 migration 설명을 따른다.

<a id="ch10"></a>
## 10. 멈추고, 바꾸고, 비교하기

GhostFlow를 이해하는 데 중요한 실험은 같은 입력으로 두 코드를 실행하는 것이다.
E03의 정지 우선 자기유지를 기준으로 생각해 보자.

```text
원본 A: running' = !stop && (start || running);
수정 B: running' = start || (!stop && running);
```

`start=true`, `stop=true`이면 A는 거짓, B는 참을 만든다.
괄호와 `start`의 위치를 조금 바꾼 것이 동시 입력에 대한 우선순위를 바꾼다.

| 이전 running | start | stop | A의 다음 값 | B의 다음 값 |
|---|---|---|---|---|
| false | true | false | true | true |
| true | false | false | true | true |
| true | true | true | false | true |
| true | false | true | false | false |

### 비교 실험 순서

1. 원본 소스와 tick별 입력·논리 시각을 보존한다.
2. 비교 시작점의 상태를 정한다. 처음부터 비교한다면 두 프로그램의 초기 상태에서 시작한다.
3. 원본을 유지한 채 수정본을 만든다.
4. 두 프로그램에 같은 입력 기록을 같은 시각으로 공급한다.
5. 상태, 출력 의도, 제약 판정, 최종 출력을 나란히 비교한다.

상태 구조를 바꿨다면 기존 checkpoint를 어떻게 옮길지 별도의 규칙이 필요하다.
책의 첫 실험은 초기 상태부터 재생하는 것으로 잡으면 비교 조건이 명확하다.

### 소스 옆에 어떤 값을 보여주면 좋을까

우리가 함께 만드는 편집 경험에서는 선택한 tick의 `start`, 이전 `running`, 다음
`running'`을 소스 옆에 붙이고, `pump`를 선택하면 값이 흘러온 조건을 추적한다.
제약이 출력을 바꿨다면 후보값과 최종값을 함께 보여준다.

관찰 화면은 다음 네 질문에 답하면 된다.

- 이 값은 어떤 입력과 이전 상태에서 계산되었는가?
- 다음 상태와 출력 의도는 무엇인가?
- 어느 제약이 허용하거나 차단했는가?
- 원본과 수정본이 처음 달라지는 tick은 어디인가?

관찰 가능한 값과 evidence 종류는 [Reference §5](reference/05-settings-and-observation.md)를 따른다. 화면 표현은 해당 descriptor의 의미를 보존해야 한다.


<a id="ch11"></a>
## 11. 파일과 literate 프로그램

### 하나의 파일과 하나의 control

실행 root는 하나의 `control`이다. 여러 파일의 재사용은 완전한 `.ghost.md`
definition revision과 digest를 고정하는 document-scope `import`로 선언하고,
import한 control은 `instance`와 `connect`로 조합한다. wildcard import와 두 번째
root control은 허용하지 않는다. 자세한 문법은 [Reference §6](reference/06-composition-and-replay.md#64-import와-연결의-문법)을 따른다.

root 하나라는 규칙은 실행 가능한 definition의 골격이다. 이를 통해 import한 여러 definition을 instance로 조합할 때 root가 모호해지지 않는다.

### E15 — 설명과 코드를 같은 문서에 쓰기

다음 전체 내용을 `follow-switch.ghost.md`로 저장하는 형태를 생각하자.

````markdown
# 입력을 따라가는 출력

스위치와 LED의 값을 선언한다.

```ghost
// E15
control LiterateSwitch {
  input switch_on: Bool;
  output lamp: Bool;
```

출력은 매 tick 스위치의 값을 따른다.

```ghost
  lamp <- switch_on;
}
```
````

컴파일러는 문서 최상위의 정확한 `ghost` 코드 블록들을 순서대로 연결한다.
위에서는 하나의 `control`이 두 블록에 나뉘어 있을 뿐, 두 프로그램이 생기지 않는다.
설명 문단은 실행되지 않고 오류 위치는 원본 문서로 연결된다.

일반 문단, 다른 info string, 목록·인용 안의 중첩 fence는 실행 코드가 아니다. 정확한
추출 규칙은 [Reference §1.1](reference/01-source-and-syntax.md#11-왜-문서-하나가-소스인가)에 있다.

### 파일과 program composition

파일 배치는 import 관계를 대신하지 않는다. `import`는 immutable source identity를 지정하고, `instance`와 `connect`는 typed logical port를 연결한다. 변경된 원본은 새 revision으로 검토한다. import·instance·binding과 provenance는 [Reference §6.2–6.7](reference/06-composition-and-replay.md)을 따른다.

현재 pinned import·instance·port는 compiler의 계약 검사와 runtime 실행을 구분해야 한다.
합성 runtime 활성화는 완료된 기능으로 취급하지 않는다. 단일 control 실습은 E15처럼
전체 문서를 저장한 뒤 language repository root에서 다음 명령으로 검사·컴파일한다.

```sh
node tools/ghostc.mjs --check follow-switch.ghost.md
node tools/ghostc.mjs follow-switch.ghost.md build/follow-switch.gfb
```

Node dependencies가 필요하다. 결과 GFB와 manifest·source map은 파생 산출물이고,
편집 원본은 `.ghost.md`다. 이 책 전체를 하나의 실행 문서로 컴파일하지 않는다.

<a id="ch12"></a>
## 12. 하나의 장치, 여러 control

각 definition은 한 control root를 갖는다. 프로그램 재사용은 import한 control의 instance를 만들고 논리 port를 연결하는 구성으로 표현한다. 같은 물리 resource를 공유할 때는 identity와 resource contract를 명시해야 한다. 최종 장치 효과는 control의 output intent와 물리적 confirmation을 구분한다.

```text
definition revision → import → instance + typed connect
                   → semantic composition → bound runtime
```

`adapt`, capability 검사, 공통 constraints, 공유 resource, replay와 hot replacement는 각자 정해진 위치·타입·계약으로만 쓴다. 문법과 semantic DAG 규칙은 [Reference §6](reference/06-composition-and-replay.md), 장치·Driver·binding의 책임은 [Reference §8](reference/08-language-runtime-and-device-boundaries.md)을 따른다. 일반 `control` 안에서 임의의 별도 policy 언어가 있다고 가정하지 않는다.

<a id="ch13"></a>
## 13. 내장함수와 내장 연산

내장 함수는 컴파일러가 이미 아는 연산이다. `fn`은 E07처럼 작성자가 선언하는 계산이다. 익숙한 이름이라고 내장 함수가 되지는 않는다. 일반 표현식용 `abs`, `min`, `max`, `clamp`, `sqrt`, `pow`, `round`는 없다. 언어가 허용하는 계산이라면 필요한 `fn`을 직접 선언한다.

이 장은 [#369](https://github.com/callin2/ghostflow-language/issues/369)를 위해 dev 리비전 `c1bbbe35cbe5acf16118707f8afc14619153d918`을 확인했다.
**주요 호출 이름 48개**와 **호스트 정책 전용 이름 3개**를 모두 다룬다. 표는 일반 호출, 선언 생성자, 제한된 변환을 구분한다. 아래 시그니처는 단편이다. 링크한 테스트에 완전한 예제가 있다. 이 단편들을 별도의 원본 프로그램으로 취급하지 않는다.

먼저 연산을 쓸 수 있는 위치를 확인한다. 다음으로 입력과 결과 타입을 읽는다. 마지막으로 샘플·상태를 기억하는지, 시계·provider가 필요한지, 오류를 반환하는지 확인한다. 컴파일 성공은 실행 제어가 아니라 검증된 descriptor를 뜻할 수도 있다. 실행 제어도 명시된 런타임 입력과 binding이 필요하다. 어떤 연산도 물리 출력 효과를 증명하지 않는다.

### 13.1 숫자 변환과 명시적 Result 생성

숫자 표현을 바꾸려는 의도가 있을 때 변환을 쓴다. `Int`는 정확한 부호 있는 32비트 정수이고 `Number`는 부동소수점이다. 다음 변환은 위치 인자 하나를 받는다. 예를 들어 `int_floor(-1.2)`는 -2, `int_trunc(-1.2)`는 -1이다. nearest-even은 중간값 2.5를 2로, 3.5를 4로 바꾼다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `number` | `number(x: Int) -> Number`: 표현을 명시적으로 바꾸기 | 일반 표현식, 상태 없음. [정수 예제](../tests/int-compiler.test.mjs). |
| `int_exact` | `int_exact(x: Number) -> Int`: 정수인 값만 허용 | 소수 또는 범위 밖 값을 거부한다. [변환](../tests/dynamic-int-conversions.test.mjs). |
| `int_floor` | `int_floor(x: Number) -> Int`: 음의 무한대 방향 | 변환값이 Int 범위 안이어야 한다. [변환](../tests/dynamic-int-conversions.test.mjs). |
| `int_ceil` | `int_ceil(x: Number) -> Int`: 양의 무한대 방향 | 변환값이 Int 범위 안이어야 한다. [변환](../tests/dynamic-int-conversions.test.mjs). |
| `int_trunc` | `int_trunc(x: Number) -> Int`: 0 방향으로 소수 제거 | 변환값이 Int 범위 안이어야 한다. [변환](../tests/dynamic-int-conversions.test.mjs). |
| `int_nearest_even` | `int_nearest_even(x: Number) -> Int`: 가장 가까운 정수, 동률이면 짝수 | 변환값이 Int 범위 안이어야 한다. [변환](../tests/dynamic-int-conversions.test.mjs). |
| `ok` | `ok(value: T) -> Result<T,E>`: 성공 만들기 | 기대 Result 타입이 T와 컴파일러 소유 E를 정한다. [Result 예제](../tests/result-control.test.mjs). |
| `fault` | `fault(reason: E) -> Result<T,E>`: 실패 만들기 | 기대 Result 타입 필요; 타입이 있는 이유와 원본 출처를 보존한다. [Result 예제](../tests/result-control.test.mjs). |
| `rate` | `rate(delta: Q-difference, time: Duration) -> Rate<Q>`: 비교용 변화율 만들기 | 기대 Rate 문맥, 양수 시간; Temperature는 TemperatureDelta 사용. 정규 차이를 초로 나눈다. [변화율](../tests/window-control.test.mjs). |

잘못된 상수 변환은 컴파일 오류다. 동적 숫자 오류는 성공적인 평가를 막는다. `recover`로 처리하는 센서 Result가 아니다. `Rate<Q>`는 표현식 전용이다. `window_rate` signal과 `rate` 임계값을 비교한다. 일반 config/state/input/output 저장 타입이 아니다.
근거: [표현식 호출](../tools/control.mjs), [정수 계약](EXACT-INTEGER-CONTRACT.md).

### 13.2 대응을 고를 때까지 품질 보존하기

센서의 실패한 읽기는 정상적인 0이 아니다. Result 파이프라인은 값 또는 오류를 전달한다. E10은 실패 대응을 명시한다. `result |> map(transform)`, `result |> and_then(transform)`, `result |> recover(default)`를 쓴다. `>>`는 정적 변환을 합성한다. 임의의 일급 함수가 아니라 컴파일러가 아는 변환이다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `map` | `map(T -> U)`: Result<T,E> -> Result<U,E> | 단항 이름 있는 fn 또는 `below(limit)`; U는 Result 불가. 실패 보존. [파이프라인](../tests/result-control.test.mjs). |
| `and_then` | `and_then(T -> Result<U,E>)`: Result<T,E> -> Result<U,E> | 단항 이름 있는 fn, 같은 E 필요. 기존 실패에서는 변환을 건너뛴다. [파이프라인](../tests/result-control.test.mjs). |
| `recover` | `recover(default: T)`: Result<T,E> -> T | 같은 타입의 명시적 대체값; trace에 오류와 출처 기록. `recover(false)`는 작성자의 결정이다. [출처](../tests/result-provenance.test.mjs). |
| `below` | `below(limit: T)`: 엄격한 `<`로 T -> Bool 변환 | map 변환으로만 사용. 순서 있는 숫자, Rate, DateTime, TimeOfDay; 같은 타입 임계값. Bool은 Result가 아니므로 and_then(below(...))는 거부된다. [파이프라인](../tests/result-control.test.mjs). |

근거: [정적 변환 lowering](../tools/control.mjs). 값을 복구해도 원래 측정이 신뢰할 수 있게 되는 것은 아니다.
E10의 Percent 센서에서 `moisture |> map(below(30%)) |> recover(false)` 단편은 오류 때 false를 요청한다. 이 임계값 계산에는 히스테리시스 기억이 없다.

### 13.3 샘플을 필터링하고 히스테리시스로 판단 유지하기

필터는 측정값을 평활화한다. 히스테리시스는 구간 안에서 Bool 판단을 기억한다. 서로 다른 문제를 해결하며 함께 쓸 수 있다. 숫자 센서를 선언하고 `filter = ...`에서 필터 하나를 고른다. 필터는 새 유효 물리 샘플을 소비한다. 반복 scan은 샘플 가중치를 추가하지 않는다.
예를 들어 E10의 `filter = median(3);`는 실제 샘플 세 개를 선택한다. `filter = ema(alpha: 0.25);`는 새 샘플에 갱신 가중치의 4분의 1을 준다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `median` | `median(n)`: 최근 n개 유효 샘플의 중앙값 | 센서 filter 전용; 상수 홀수 정수 1..31. 미완성 창은 NotReady. [필터](../tests/signals-wasm.test.mjs). |
| `moving_average` | `moving_average(n)`: 최근 n개 유효 샘플의 산술평균 | 센서 filter 전용; 상수 정수 1..31. 미완성 창은 NotReady. [필터](../tests/signals-wasm.test.mjs). |
| `ema` | `ema(alpha: Number)`: 새 샘플과 이전값의 가중 평균 | 센서 filter 전용; 유한 상수 0 < alpha <= 1. 첫 유효 샘플로 시작하며 복구 규칙 적용. [필터](../tests/signals-wasm.test.mjs). |
| `hysteresis` | `hysteresis(sensor, on_below: T, off_above: T, initial: Bool) -> Result<Bool,SensorFault>` | signal 선언; 직접 선언한 숫자 센서; 같은 T의 상수 임계값, on_below < off_above. [경계와 오류](../tests/signals-wasm.test.mjs). |

E10의 수분 제어를 보자. `signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);`.
30%보다 낮으면 dry를 true로 바꾼다. 35%보다 높으면 false로 바꾼다. 품질이 좋을 때 **닫힌 구간 [30%,35%]**의 모든 값은 이전 Bool을 유지한다. 두 임계값과 정확히 같을 때도 유지한다. 작은 변동 때문에 판단이 계속 바뀌는 것을 막는다.

다음 순서는 준비 조건을 충족한 뒤 품질 좋은 필터 결과를 뜻한다. 필터 전의 원시 샘플 순서가 아니다.

| 품질 좋은 필터 수분값 | 유지되는 dry | 이유 |
|---|---|---|
| 시작 뒤 30% | false | 같으므로 초기 false 유지. |
| 35% | false | 상한과 같아도 false 유지. |
| 29% | true | 하한보다 엄격히 낮음. |
| 30% | true | 하한과 같아 true 유지. |
| 33% | true | 구간 내부. |
| 35% | true | 상한과 같아 true 유지. |
| 36% | false | 상한보다 엄격히 높음. |

`initial`은 처음 기억할 값이지, 샘플 누락을 무시할 권한이 아니다. 준비 전이나 Disconnected/Stale/Invalid 뒤 공개 결과는 fault다. 처리 상태는 initial로 돌아간다. 좋은 샘플도 복구·필터 조건을 다시 충족해야 한다. 따라서 복구된 구간 내부 샘플은 오류 전 판단이 아니라 initial에서 시작한다. initial이 true여도 실패한 Result가 `ok(true)`가 되지는 않는다. E10은 `case`로 출력 대응을 선택한다.

[Rust conditioner](../crates/ghostflow-core/src/signals.rs)는 엄격한 비교를 사용하고 오류 때 히스테리시스 처리를 초기화한다. 링크한 WASM 테스트의 “retains either prior state exactly at both thresholds” 및 오류·복구 예제가 근거다. 이 장은 그 계약을 설명한다. 문서 수정이 새로운 하드웨어 시험을 만들지는 않는다.

### 13.4 시간, 샘플, 사건은 서로 다른 증거다

`signal name = constructor(...);`로 다음 연산을 선언한다. scan을 세는 단조 타이머는 scan 사이에도 물리 조건이 계속 참이었다는 증거가 아니다. 연속성이 중요하면 인증된 증거를 쓴다.
선언된 Temperature 센서에 `signal recent = hold_last(temperature, for_at_most: 2min, quality: measured);`를 쓰면 마지막 좋은 샘플의 재사용을 제한한다. 출력에 사용하려면 여전히 명시적 Result 대응이 필요하다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `debounce` | `debounce(source, stable_for: Duration, initial: T) -> T or Result<T,E>`: 안정된 후보 채택 | Bool/유한 enum, 양수 상수 시간과 같은 타입 상수 initial. 후보 변경 때 나이 재시작; 오류 때 초기화. 샘플 출처 보존; 일반값은 scan 사용. [Debounce](../tests/debounce-control.test.mjs). |
| `true_for` | `true_for(BoolSensor, duration: Duration, quality: measured) -> Result<Bool,SensorFault>`: 연속 참 증명 | 직접 선언한 Bool 센서, 양수 상수 시간. Driver 인증 구간; false/부적합 품질 때 초기화. 시간 경계에 도달하면 true. [인증 소스](../tests/fixtures/true-for-certified.ghost.md). |
| `after_event` | `after_event(Event, BoolSensor, window: Duration, quality: measured)`: 사건별 증거 유지 | 양수 상수 창; 사건 식별자와 predicate 샘플 필요. [eventTime,eventTime+window)에서 판단. signal 자체는 스칼라가 아니다. [사건 소스](../tests/fixtures/after-event-evidence.ghost.md). |
| `after_event_any` | `after_event_any(signal) -> Result<Bool,SensorFault>`: 하나라도 만족하는 사건 결과 | after_event signal 하나. 결정적 true로 any를 확정할 수 있다. 그 밖에는 미결 식별자·오류가 남는다. [투영 예제](../tests/after-event-control.test.mjs). |
| `after_event_all` | `after_event_all(signal) -> Result<Bool,SensorFault>`: 모든 사건의 결과 | after_event signal 하나. 결정적 false로 all=false 확정 가능. 결정 증거가 없는 빈 집합·미결 집합은 자동 허용이 아니라 NotReady. [투영 예제](../tests/after-event-control.test.mjs). |
| `window_average` | `window_average(source, over: Duration, quality: measured, max_age: Duration)` | 물리 샘플 출처가 있는 Result<숫자/물리량,SensorFault>. 같은 payload 반환, 단 Int -> Number. [창](../tests/window-control.test.mjs). |
| `window_min` | `window_min(source, over: Duration, quality: measured, max_age: Duration)` | average와 같은 허용 payload; 같은 payload 타입의 최솟값 Result. [창](../tests/window-control.test.mjs). |
| `window_max` | `window_max(source, over: Duration, quality: measured, max_age: Duration)` | average와 같은 허용 payload; 같은 payload 타입의 최댓값 Result. [창](../tests/window-control.test.mjs). |
| `window_rate` | `window_rate(source, over: Duration, quality: measured, max_age: Duration) -> Result<Rate<Q>,SensorFault>` | 지원 선형 물리량; 서로 다른 시각의 첫·끝 관측. 온도 차이는 delta K. Number/Int/Percent, RelativeHumidity, CO2, Acidity 입력 불가. [변화율](../tests/window-control.test.mjs). |
| `hold_last` | `hold_last(source, for_at_most: Duration, quality: measured) -> Result<T,SensorFault>`: 좋은 샘플 임시 재사용 | 물리 출처와 양수 상수 시간 필요. 실제 timestamp, 유지 나이, 가려진 오류 보존; 재평가로 갱신하지 않는다. [유지 예제](../tests/hold-last-control.test.mjs). |
| `elapsed` | `elapsed(state) -> Duration`: 상태 변경 뒤 나이 | timer 선언 전용; 선언된 state와 명시적 단조 시계; 변경 때 초기화. [E08](#ch06). |
| `continuous_true` | `continuous_true(BoolExpression) -> Duration`: 연속 참 scan 관측의 나이 | timer 선언 전용; 첫 true scan에서 0, false 때 초기화. 관측하지 않은 구간을 인증하지 않는다. [타이머](../tests/compiler.test.mjs). |

창의 `over`, `max_age`는 양수 상수 Duration이다. **(now-over,now]**의 실제 허용 관측을 사용하고 보간하지 않는다. 관측이 없거나 가장 새 관측의 나이가 **>= max_age**이면 NotReady다. 현재 소스 오류는 보존한다. 변화율에는 서로 다른 관측 시각 두 개가 필요하다. 창 합성은 집계·샘플 출처를 보존한다. 시계만 진행하는 scan은 새 관측을 만들지 않는다.

after_event만 있고 any/all 투영이 있는 프로그램은 사건 런타임 binding과 함께 실행 제어로 컴파일될 수 있다. 투영 없는 after_event나 자연 조건과의 결합은 `executable:false` temporal descriptor가 될 수 있다. `after_event_for`는 아래 미지원 목록에서 설명한다.
근거: [signal/timer lowering](../tools/control.mjs), [시간 증거 Reference](reference/04-sensors-constraints-control.md).

### 13.5 자연 사실과 예약 정책 생성자

provider는 관측·예측을 공급한다. 프로그램은 무엇을 허용할지 결정한다. 다음 일반 호출 두 개는 불확실성을 명시적으로 반환한다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `tide_is` | ``tide_is(provider, tide`spring` or tide`neap`) -> Result<Bool,TemporalContextFault>`` | 선언된 TidePredictions provider. 예측 누락·노후 또는 시계 문맥 실패는 fault. [자연 조건](../tests/natural-condition-contract.test.mjs). |
| `moon_is` | ``moon_is(provider, moon`phase`) -> Result<Bool,TemporalContextFault>`` | LunarEphemeris provider; 위상: new, waxing_crescent, first_quarter, waxing_gibbous, full, waning_gibbous, last_quarter, waning_crescent. [자연 조건](../tests/natural-condition-contract.test.mjs). |

시그니처 안의 tagged literal은 표기 단편이다. 두 호출 모두 런타임·provider 사실이 필요하다. pure fn에서 전역 provider를 캡처할 수 없다.

다음 생성자는 schedule 필드에서만 쓴다. 일반 표현식 저장값을 반환하지 않는다. 여기의 Duration은 양수 상수다.
예를 들어 `gap = skip_after(10min);`은 공백 정책이다. Tide의 `basis = run(5min, within(10min));`은 10분 안의 승인을 허용하고 승인부터 5분 운전한다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `instant` | `instant(DateTime)`: Periodic의 절대 anchor | 상수 DateTime; 현재 실행 경로는 preserve_anchor와 pulse 사용. [Periodic](../tests/periodic-cron-policy.test.mjs). |
| `civil` | `civil(Date, TimeOfDay)`: Periodic의 민간시 anchor | 상수 날짜·시각; 검증 descriptor 계약, 현재 Periodic bytecode 경로 밖. [Periodic](../tests/periodic-cron-policy.test.mjs). |
| `skip_after` | `skip_after(Duration)`: 허용 관측 공백 제한 | schedule gap 필드; 더 큰 공백에는 명시적 skip/baseline 정책 사용. [정책](../tests/periodic-cron-policy.test.mjs). |
| `range` | `range(Duration)`: 계획된 구간 | schedule basis; 비중첩 증명과 명시적 cancel_when 필요. 고정 UTC 구간은 제한된 실행 경로를 지원하며 일반 민간시 구간은 descriptor 범위다. [Range 계약](../tests/schedule-descriptor-artifact.test.mjs). |
| `run` | `run(Duration, within(Duration))`: 승인부터 Tide 운전 | Tide basis; 첫 Duration은 운전 길이. 유예 구간 안에서 첫 승인 필요. [Tide](../tests/natural-schedule-contract.test.mjs). |
| `within` | `within(Duration)`: Tide 승인 유예 | Tide run의 둘째 인자 전용; [planned,planned+grace), 정확한 끝 제외. 운전 길이를 늘리지 않는다. [Tide](../tests/natural-schedule-contract.test.mjs). |
| `hold_trusted` | `hold_trusted(Duration, terminal: skip)`: 제한된 신뢰 시각 보류 | Solar/Tide clock 필드; 양수 상수, 이전 신뢰 근거와 run/time 연속성 필요. 정확한 만료 경계는 skip. E36. [Execution](../tests/programming-natural-examples.test.mjs). |
| `fixed_time` | `fixed_time(TimeOfDay literal, terminal: skip)`: 고정 시각 fallback | Solar fallback 전용; 상수 TimeOfDay literal과 명시적 terminal skip. Tide로 옮기지 않는다. E36/E101. [Execution](../tests/programming-natural-examples.test.mjs). |

현재 실행 예약은 baseline 복구를 사용한다. Solar와 Tide는 `trusted_only` 또는 양수 상수 Duration과 `terminal: skip`을 지정한 `hold_trusted`를 지원한다. Solar는 `fixed_time(TimeOfDay, terminal: skip)` fallback도 지원하며 Tide fallback은 `skip`이다. Daily/slots/Cron은 pulse, Periodic은 instant+preserve_anchor, Tide는 run+within이다. `range`의 고정 UTC 구간은 별도 제한 실행 경로가 있으며 일반 민간시 descriptor 전체가 실행 가능하다는 뜻은 아니다. 아래 E36–E37과 [fallback 검사](../tests/natural-fallback-compiler.test.mjs)를 참고한다.
근거: [예약 lowering과 경로 선택](../tools/control.mjs), [시간 Reference](reference/03-time-and-schedules.md).

### 13.6 더 허용하기 전에 사용량 계상하기

account는 화면 애니메이션이나 요청 출력으로 사용량을 예측하지 않고 증거를 기록한다. applied receipt와 requested intent는 다르다. durable 계상에는 ledger와 검증된 resource binding이 필요하다.
binding된 resource pump에 선언 단편 `account pumping = on_time(pump, stage: applied, persistence: durable);`를 쓰면 applied 증거를 고른다. 링크한 계상 예제는 resource와 limit 정책도 선언한다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `on_time` | `on_time(resource, stage: applied, persistence: durable)`: Duration account | account 선언; 제한된 실행 경로는 durable/applied만 허용. requested/safe/confirmed 대안은 검사 가능하나 이 실행 binding은 아니다. [계상](../tests/accounting-syntax.test.mjs). |
| `count_events` | `count_events(Event, over: local_day("zone"), persistence: durable)`: 사건 account | account 선언; .count는 Result<Int,AccountingFault>. 실행은 durable/local_day 필요; 중복 사건 식별자를 다시 세지 않는다. [계상](../tests/accounting-syntax.test.mjs). |
| `used` | `used(account, rolling(Duration))`: 계상된 Duration 조회 | accounting constraint의 limit 위치 전용. 실행 limit은 <=, 양수 bound/reserve, on_unknown=block 필요. [한도](../tests/accounting-syntax.test.mjs). |
| `rolling` | `rolling(Duration)`: 뒤로 이동하는 계상 기준 | 양수 상수 시간; count_events rolling은 descriptor/검사 범위이며 사건 수 실행 경로 밖. [한도](../tests/accounting-syntax.test.mjs). |
| `local_day` | `local_day("timezone")`: 민간시 하루 기준 | 비어 있지 않은 literal timezone; 시계·달력·ledger 필요. 고정 24시간 rolling 창이 아니다. [계상](../tests/accounting-syntax.test.mjs). |
| `count_on` | `count_on({resources}) -> Int`: 참인 후보 자원 수 | 이름 있는 resource 제약, 일반 표현식 아님. 유한하고 서로 다른 Bool resource 집합; 빈 집합 -> 0. 호스트 정책 binding 필요. [이름 있는 제약](../tests/named-constraints.test.mjs). |
| `any_on` | `any_on({resources}) -> Bool`: 후보 자원 검사 | 같은 제한 문맥; 빈 집합 -> false. 제약이 평가 단계를 선언한다. [이름 있는 제약](../tests/named-constraints.test.mjs). |

독립된 이름 있는 resource 정책은 호스트 정책 artifact가 된다. 일반 VM 제어가 아니다. 근거: [계상·resource 제약](../tools/control.mjs).

### 13.7 PID 생성자는 objective에 속한다

controller는 요청 목표값을 계산한다. 뒤의 제약이 제한할 수 있다. 다음 생성자는 gain과 재시작 정책을 정하며 일반 단위 대수 함수가 아니다. 현재 native binding은 Temperature 센서, Temperature config 목표, `ContinuousActuator<Percent>`이며 출력 하한은 0%다. PID 이외 종류는 binding 필요 메타데이터를 가질 수 있다. `pi`, `on_off`가 파싱된다고 운전 controller가 증명되지는 않는다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `proportional_gain` | `proportional_gain(output: Percent, error: TemperatureDelta)`: P gain | PID kp 필드; 상수, output >=0, error >0; output/error. [Controller 예제](../tests/gfb7-pid-contract.test.mjs). |
| `integral_gain` | `integral_gain(output: Percent, error: TemperatureDelta, time: Duration)`: I gain | PID ki; 같은 범위와 time >0; output/error/seconds. [Controller 예제](../tests/gfb7-pid-contract.test.mjs). |
| `derivative_gain` | `derivative_gain(output: Percent, error: TemperatureDelta, time: Duration)`: D gain | PID kd; 같은 범위와 time >0; output*seconds/error. [Controller 예제](../tests/gfb7-pid-contract.test.mjs). |
| `reset` | `reset(output: Percent)`: 명시적 재시작 목표 | PID restart 필드; objective 출력 범위 안의 상수. 첫 허용 샘플에서 tracking 초기화; 임의 상태 reset 호출 아님. [Controller 예제](../tests/gfb7-pid-contract.test.mjs). |

gain의 output이 0이면 그 항을 비활성화한다. period는 양수이고 late_after >= period다. 명시적 direction, bias, anti-windup, disabled/transfer, fault, restart 정책이 생명주기를 정한다. 오래되거나 누락된 측정을 조용히 허용하지 않는다. [Controller lowering](../tools/control.mjs)과 [연속 제어 Reference](reference/04-sensors-constraints-control.md)를 참조한다.
예를 들어 `kp = proportional_gain(output: 2%, error: 1Δ°C);`는 온도 오차 1도당 2퍼센트포인트를 정한다. `restart = reset(output: 0%);`는 첫 tracking 목표를 명시적으로 고른다.

### 13.8 별도의 호스트 정책 문법

`ghostrules` adapter는 제한된 station 정책 문법을 검사한다. 호출처럼 보이는 형식도 문맥 전용이다. 일반 control 표현식에 함수가 추가되는 것이 아니다. 기존 [station 규칙](../examples/station-rules.ghost.md)과 [제약 테스트](../tests/constraints.test.mjs)에 완전한 정책이 있다.

| 내장 이름 | 시그니처와 목적 | 문맥, 경계와 예제 |
|---|---|---|
| `stopped` | `stopped(station)`: 정지 station 요구 | 지정된 mode와 함께 allow enter/apply 정책 조건에서만 사용. 호스트 station 상태이며 물리 모터 정지 증명 아님. [규칙](../examples/station-rules.ghost.md). |
| `pump_capacity` | `pump_capacity(pump)`: 용량 검사 요구 | require ... == Pass 또는 check 정책 절 전용. 호스트 정책 artifact이며 숫자 용량 표현식 아님. [규칙](../examples/station-rules.ghost.md). |
| `day` | `day("timezone")`: 일일 한도의 민간시 하루 | `limit on_time(pump) <= Duration per day("zone")` 전용; 유효 IANA timezone, 비어 있지 않은 128자 이하 문자열. [규칙](../examples/station-rules.ghost.md). |

이 문법의 `count_on(pump.valves)`, `any_on(pump.valves)`, `on_time(pump)`은 §13.6과 인자 모양이 다른 제한 형식이다. 각각 max-valves, pump-needs-valve, daily-limit 정책 절을 만든다. 임의의 `let` 표현식으로 옮기지 않는다. `exclusive`, `allow`, `require`, `limit`, `once`, `check`는 절을 시작한다. `warn`은 거부된다.
근거: [호스트 정책 parser](../tools/constraints.mjs).

### 13.9 인접 문법과 사용할 수 없는 대안

다음은 내장 연산과 함께 쓰지만 **호출 함수가 아니다**.

| 문법 | 의미와 현재 경계 |
|---|---|
| Daily, DailySlots<15min>, Periodic, Cron, Solar, Tide | schedule 선언 타입. DailySlots 실행은 고정 15분 격자; Cron은 검증된 필드 다섯 개. |
| pulse; time/date/datetime/cron5/day/sun/tide/moon tagged literals | 정책값과 typed 표기. ``sun`rise` ``/``sun`set` ``은 sunrise()/sunset() 호출이 아니다. |
| TimeSlots<grid,capacity> | config 타입: 24h를 나누는 양수 grid, 양수 capacity, 유한·고유·격자 정렬 TimeOfDay 목록. TimeSlots(...) 호출 없음. |
| `Result<T,E>`; `Rate<Q>` | typed 결과와 표현식 전용 변화율. E는 컴파일러 소유; 중첩 Result payload 거부. |
| schedule.due; schedule.active; schedule.missed | Bool 투영; .missed는 노출된 투영 필요. active occurrence와 applied output은 다르다. 메서드 호출 없음. |
| eventAccount.count | Result<Int,AccountingFault> 투영; count_events account만 사용. |
| resource.on/position/valves | 문맥 전용 resource/정책 endpoint, 일반 메서드 아님. |
| sample, valid, filter, stale_after, recover_after, samples | 센서 선언 필드·표기. 특히 stale_after는 표현식 호출이 아니다. |
| on_below, off_above, initial; min, max, step, access, label | 이름 있는 인자 또는 config 필드, 함수 아님. |
| if/case/in; >> and \|>; fn/type/state/config/timer/signal | 문법, 연산자, 선언. input.name/state.name/next.name은 제거된 alias. |

[Parser와 member/type 규칙](../tools/control.mjs)이 위치를 정한다. 전체 타입과 단위는 [Reference 2장](reference/02-types-expressions-state.md)에 있다.

| 선택된/Reference 표기 | 현재 상태; 실행을 주장하지 않는다 |
|---|---|
| after_event_for(signal, EventId) | Reference는 식별자별 투영을 설명하지만 현재 컴파일러 호출 dispatcher가 없어 unknown function이다. 의도가 맞을 때만 지원 any/all을 쓴다. |
| window(Duration) schedule basis | 설계 대안, 현재 허용 basis 아님. 지원 window_average/min/max/rate signal과 다르다. |
| run(Duration, on_time) | 설계 대안; 지원 Tide run은 within(Duration) 필요. |
| range(Duration); civil(Date,TimeOfDay) | 위에서 설명한 검증 descriptor 계약; 현재 bytecode 경로 아님. |
| PID checkpoint; degraded Name | 현재 native PID fault/restart 정책에서 미지원인 선택 설계 대안. |
| ifthenelse, purefn, enum, next | 제거된 alias. 정규 if ... then ... else, fn, type, prime state 사용. |

진단이나 설계 예제에 이름이 나온다고 지원을 추론하지 않는다. 컴파일러 경로와 artifact 종류를 확인한다. [장 coverage 검사](../tests/programming-builtins.test.mjs)는 두 언어의 항목을 컴파일러 호출 dispatch와 맞추고 시그니처·문맥·예제 링크가 있는지 검사한다.

<a id="ch14"></a>
## 14. 온도 단위와 공기 VPD 제어

### 같은 물리 온도를 세 단위로 쓰기

Temperature 센서는 물리 타입을 보존한다. 섭씨·화씨·켈빈은 소스·표시 단위이며 런타임은 정규 켈빈을 쓴다. 독립된 히터 예제 세 개는 같은 규칙이다. 18°C보다 낮으면 요구 ON, 22°C보다 높으면 OFF다. 두 임계값과 같은 값과 닫힌 구간 내부는 이전 정상 판단을 유지한다. 오류는 히터를 억제하고 히스테리시스를 initial false로 되돌린다. median(1) 예제는 새 정상 샘플 하나로 복구한다. 첫 샘플 전에는 NotReady다. 마지막 정상 샘플은 다음 샘플 전달 사이에도 사용 가능하며, 나이 >= 3s가 되면 Stale이다.

| 물리 경계 | 섭씨 | 화씨 | 켈빈 |
|---|---|---|---|
| 히터 하한 | 18°C | 64.4°F | 291.15K |
| 히터 상한 | 22°C | 71.6°F | 295.15K |
| 히터 유효 범위 | −40–50°C | −40–122°F | 233.15–323.15K |

literal은 정확하게 변환한 뒤 binary64로 반올림한다. 정규 런타임 샘플에 64.4를 그대로 넣지 않는다. 64.4°F는 291.15K다. Driver binding은 공급 단위와 물리량을 식별한다. [물리 타입](reference/02-types-expressions-state.md)과 [히스테리시스](#ch13)를 참조한다.

### E16 — 섭씨 히터

```ghost
// E16
control CelsiusHeater {
  sensor air: Temperature {
    sample = 1s;
    valid = -40°C .. 50°C;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal cold = hysteresis(air,
    on_below: 18°C, off_above: 22°C, initial: false);
  output heater: Bool;
  heater <- cold |> recover(false);
}
```

### E17 — 화씨 히터

```ghost
// E17
control FahrenheitHeater {
  sensor air: Temperature {
    sample = 1s;
    valid = -40°F .. 122°F;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal cold = hysteresis(air,
    on_below: 64.4°F, off_above: 71.6°F, initial: false);
  output heater: Bool;
  heater <- cold |> recover(false);
}
```

### E18 — 켈빈 히터

```ghost
// E18
control KelvinHeater {
  sensor air: Temperature {
    sample = 1s;
    valid = 233.15K .. 323.15K;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal cold = hysteresis(air,
    on_below: 291.15K, off_above: 295.15K, initial: false);
  output heater: Bool;
  heater <- cold |> recover(false);
}
```

### 온도와 상대습도로 공기 VPD 구하기

공기 VPD는 포화 수증기압에서 실제 공기 수증기압을 뺀 값이다. 같은 시점의 공기 온도 T(°C)와 공기 상대습도 RH로 `0.6108 * exp(17.27*T/(T+237.3)) * (1-RH/100)` kPa를 계산한다. 포화 관계와 상대습도 정의는 [FAO-56 3장 식 10–11](https://www.fao.org/4/x0490e/x0490e07.htm)에 근거한다. 순간 공기 계산이며 FAO의 일일 증발산 추정이 아니다. 잎 VPD에는 잎 온도도 필요하며 여기서는 계산하지 않는다.

GhostFlow에는 exp 내장 함수가 없다. 각 완전한 예제는 일반 pure fn `exp_0_3_1`을 작성한다. 고정 14차 Taylor 다항식을 Horner 형식으로 평가한다. air 센서의 선언 범위는 **0–50°C**다. 따라서 지수는 **0–3.006**으로 함수의 명시적 0–3.1 범위 안이다. 온도가 범위 밖이면 센서는 Invalid를 반환하고 수식을 평가하지 않는다. 근사를 외삽하지 않는다. [독립 수치 검사](../tests/programming-climate.test.mjs)는 0.1°C 격자와 습도 경계에서 실제 런타임 값을 호스트 Math.exp와 비교하여 절대 오차 **0.001 kPa 이하**를 요구한다. 예상값 구현에 다항식을 복사하지 않고 원본 세 개를 모두 확인한다.

`(t - 0°C) / 1Δ°C`는 섭씨 Number를 명시적으로 얻는다. `rh / 100%RH`는 [RH 비율 계약](reference/02-types-expressions-state.md)으로 typed 습도를 정규화한다. 마지막에 `0.6108kPaVPD`를 곱해 VaporPressureDeficit를 보존한다. RelativeHumidity는 공기 습도이며 E10의 토양 수분 Percent가 아니다.

빛은 **PPFD** 타입이며 `umol/m2/s`(µmol·m⁻²·s⁻¹)를 쓴다. 광합성 관련 광자 수를 나타낸다. lux는 사람 시각에 가중된 조도다. 보편적인 lux→PPFD 변환은 없다. 검증된 PPFD 센서·binding을 사용한다. 빛은 **출력 허용 조건**이며 같은 T/RH의 계산 VPD를 바꾸지 않는다.

### 독립된 학습 정책 세 가지

임계값은 예시 소스 의도이지 보편적 작물 권장값이 아니다. 가습 요구가 습도 상승을 증명하지 않는다. 환기는 외기 조건에 좌우된다. 관수 요구는 토양 물 추정이나 펌프 순서가 아니다. 온실 물리 모델은 없다. 설치가 actuator binding, 적합성, 물리 효과 검증을 맡는다.

| 예제 | ON | OFF | 빛 조건 |
|---|---|---|---|
| E19 가습 요구 | VPD > 1.2 kPa | VPD < 1.0 kPa | PPFD >= 200 µmol·m⁻²·s⁻¹ |
| E20 환기 요구 | VPD < 0.4 kPa | VPD > 0.6 kPa | PPFD >= 200 µmol·m⁻²·s⁻¹ |
| E21 관수 요구 | VPD > 1.0 kPa | VPD < 0.8 kPa | PPFD >= 300 µmol·m⁻²·s⁻¹ |

계산한 Result는 선언 센서가 아니므로 센서 전용 hysteresis 생성자로 처리할 수 없다. 아래 명시적 Bool state는 같은 엄격한 ON/OFF·유지 구간 의도를 나타낸다. 온도·RH 오류는 demand를 지운다. 밤 또는 빛 오류는 climate demand 기억을 유지할 수 있지만 출력을 억제한다. 복구는 현재 정상 증거로 판단한다. 타이머나 추가 자동 모드는 없다. climate 오류 때 `air_vpd_value = 0`은 명시적 표시 대체값이다. **vpd_valid와 함께 읽는다**. false는 측정된 VPD 0을 뜻하지 않는다. 빛 오류는 출력을 억제하지만 정상 T/RH 계산을 무효화하지 않는다.

### E19 — 높은 VPD 가습 요구

```ghost
// E19
fn exp_0_3_1(x: Number) -> Number {
  1 + x / 1 * (1 + x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6 * (1 + x / 7 * (1 + x / 8 * (1 + x / 9 * (1 + x / 10 * (1 + x / 11 * (1 + x / 12 * (1 + x / 13 * (1 + x / 14 * (1))))))))))))))
}
fn air_vpd(t: Temperature, rh: RelativeHumidity) -> VaporPressureDeficit {
  0.6108kPaVPD * exp_0_3_1(
    17.27 * ((t - 0°C) / 1Δ°C) / (((t - 0°C) / 1Δ°C) + 237.3)
  ) * (1 - rh / 100%RH)
}
control HumidificationDemand {
  sensor air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  let climate: Result<VaporPressureDeficit, SensorFault> = case air {
    ok(t) => case humidity {
      ok(rh) => ok(air_vpd(t, rh));
      fault(reason) => fault(reason);
    };
    fault(reason) => fault(reason);
  };
  let daylight = case light {
    ok(ppfd) => ppfd >= 200umol/m2/s;
    fault(_) => false;
  };
  state demand: Bool = false;
  demand' = case climate {
    ok(value) => if value > 1.2kPaVPD then true
      else if value < 1.0kPaVPD then false else demand;
    fault(_) => false;
  };
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, humidify_demand: Bool;
  air_vpd_value <- climate |> recover(0kPaVPD);
  vpd_valid <- case climate { ok(_) => true; fault(_) => false; };
  humidify_demand <- daylight && demand';
}
```

### E20 — 낮은 VPD 환기 요구

```ghost
// E20
fn exp_0_3_1(x: Number) -> Number {
  1 + x / 1 * (1 + x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6 * (1 + x / 7 * (1 + x / 8 * (1 + x / 9 * (1 + x / 10 * (1 + x / 11 * (1 + x / 12 * (1 + x / 13 * (1 + x / 14 * (1))))))))))))))
}
fn air_vpd(t: Temperature, rh: RelativeHumidity) -> VaporPressureDeficit {
  0.6108kPaVPD * exp_0_3_1(
    17.27 * ((t - 0°C) / 1Δ°C) / (((t - 0°C) / 1Δ°C) + 237.3)
  ) * (1 - rh / 100%RH)
}
control VentilationDemand {
  sensor air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  let climate: Result<VaporPressureDeficit, SensorFault> = case air {
    ok(t) => case humidity {
      ok(rh) => ok(air_vpd(t, rh));
      fault(reason) => fault(reason);
    };
    fault(reason) => fault(reason);
  };
  let daylight = case light {
    ok(ppfd) => ppfd >= 200umol/m2/s;
    fault(_) => false;
  };
  state demand: Bool = false;
  demand' = case climate {
    ok(value) => if value < 0.4kPaVPD then true
      else if value > 0.6kPaVPD then false else demand;
    fault(_) => false;
  };
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, ventilate_demand: Bool;
  air_vpd_value <- climate |> recover(0kPaVPD);
  vpd_valid <- case climate { ok(_) => true; fault(_) => false; };
  ventilate_demand <- daylight && demand';
}
```

### E21 — VPD와 빛에 따른 관수 요구

```ghost
// E21
fn exp_0_3_1(x: Number) -> Number {
  1 + x / 1 * (1 + x / 2 * (1 + x / 3 * (1 + x / 4 * (1 + x / 5 * (1 + x / 6 * (1 + x / 7 * (1 + x / 8 * (1 + x / 9 * (1 + x / 10 * (1 + x / 11 * (1 + x / 12 * (1 + x / 13 * (1 + x / 14 * (1))))))))))))))
}
fn air_vpd(t: Temperature, rh: RelativeHumidity) -> VaporPressureDeficit {
  0.6108kPaVPD * exp_0_3_1(
    17.27 * ((t - 0°C) / 1Δ°C) / (((t - 0°C) / 1Δ°C) + 237.3)
  ) * (1 - rh / 100%RH)
}
control IrrigationDemand {
  sensor air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  let climate: Result<VaporPressureDeficit, SensorFault> = case air {
    ok(t) => case humidity {
      ok(rh) => ok(air_vpd(t, rh));
      fault(reason) => fault(reason);
    };
    fault(reason) => fault(reason);
  };
  let daylight = case light {
    ok(ppfd) => ppfd >= 300umol/m2/s;
    fault(_) => false;
  };
  state demand: Bool = false;
  demand' = case climate {
    ok(value) => if value > 1.0kPaVPD then true
      else if value < 0.8kPaVPD then false else demand;
    fault(_) => false;
  };
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, irrigation_demand: Bool;
  air_vpd_value <- climate |> recover(0kPaVPD);
  vpd_valid <- case climate { ok(_) => true; fault(_) => false; };
  irrigation_demand <- daylight && demand';
}
```

### E22 — 기존 VPD 제어 두 개를 import로 함께 실행하기

E22는 E19와 E20의 원문을 복사하지 않는다. 두 원본 section에서 생성한 완전한
`.ghost.md` 문서를 정확한 revision과 SHA-256으로 고정해 import한다. `air`,
`humidity`, `light`의 한 raw sample packet은 두 instance에 함께 전달되지만, 각
instance의 sensor conditioner와 `demand` state는 독립적이다. root는 두 demand를
모두 공개하고, 같은 입력에서 계산한 공통 VPD 관측은 `high` instance의
`air_vpd_value`와 `vpd_valid`를 공개한다.

```ghost
// E22
import HighVpd from "./E19.ghost.md"
  revision "7e135b93ea4c4988d305f992db277a6d8581a271"
  sha256 "ef80061222c5c671b8b78d8fae733b543e51149c7e5d2c7d5e2bb2cc41fbdb30";
import LowVpd from "./E20.ghost.md"
  revision "7e135b93ea4c4988d305f992db277a6d8581a271"
  sha256 "bbf57007c5973684660747c515bb2534124d50341647b2282bd2ca32852a724b";
control CombinedVpdDemands {
  sensor air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  output air_vpd_value: VaporPressureDeficit;
  output vpd_valid, humidify_demand, ventilate_demand: Bool;
  instance high: HighVpd;
  instance low: LowVpd;
  connect high.air <- air;
  connect high.humidity <- humidity;
  connect high.light <- light;
  connect low.air <- air;
  connect low.humidity <- humidity;
  connect low.light <- light;
  connect air_vpd_value <- high.air_vpd_value;
  connect vpd_valid <- high.vpd_valid;
  connect humidify_demand <- high.humidify_demand;
  connect ventilate_demand <- low.ventilate_demand;
}
```

### 실행하고 입력 하나를 바꾸며 관찰하기

E15처럼 E16–E21 fence를 각각 완전한 .ghost.md 문서로 컴파일한다. E22는 생성된
`examples/programming-book-imports` source closure와 함께 컴파일한다. `node --test tests/programming-climate.test.mjs tests/programming-book-simulation.test.mjs tests/programming-book-import-package.test.mjs`로 compiler와 실제 ghostsim/WASM scan을 확인한다. native/WASM artifact의 build provenance가 맞아야 한다. [검증](VERIFICATION.md)에 build 전제가 있다. 테스트는 임시 scenario artifact를 쓰며 하드웨어를 구동하지 않는다.

온라인 reader의 기본값은 E10의 시간 의존 센서 소스를 이용한 **24시간 합성 일변화 profile**이다. 온도·RH·PPFD는 아래 지점 사이를 선형으로 변하며 연속 반복한다. 06–18에는 온도가 내려가지 않으며 18–06에는 빛이 정확히 0이다. 학습용 입력 궤적이며 온실 모델이나 actuator 피드백이 아니다. 선언된 샘플 간격마다 새 타입 센서 증거를 공급한다. 실제 WASM 프로그램이 VPD와 제어 요구를 계산한다.

| simulation 시각 | 기온 °C | RH % | PPFD µmol·m⁻²·s⁻¹ | 관찰 |
|---|---|---|---|---|
| 00 | 18 | 90 | 0 | 초기 히터 OFF; 빛 조건 요구 OFF |
| 03 | 17 | 92 | 0 | 히터 ON |
| 06 | 16 | 94 | 0 | 일출; 히터 ON |
| 09 | 22 | 85 | 500 | 낮은 VPD 환기 ON; 정확히 22°C에서 히터 ON 유지 |
| 12 | 28 | 60 | 1000 | 가습·관수 요구 ON; 히터·환기 OFF |
| 15 | 31 | 45 | 650 | 높은 VPD 요구 ON 유지 |
| 18 | 31 | 60 | 0 | 일몰; 빛 조건 요구 OFF |
| 21 | 23 | 80 | 0 | 야간 냉각; 히터는 아직 OFF |
| 24 | 18 | 90 | 0 | 연속 반복 경계; 히터는 18°C 미만에서만 ON |

각 예제를 simulation 00:00에서 실행한다. E16–E21의 기본값은 1000× 배속과 24시간 timing chart이다. 09·12·15·18시 부근을 비교한다. 실제 시간당 처리량은 컴퓨터에 따라 다르다. 배속은 실제 시간당 simulation 시간만 바꾼다. 임계값과 일변화 profile은 바뀌지 않는다. Pause는 simulation 시간을 멈춘다. 09시의 히터 ON은 온도가 22°C를 엄격히 넘으면 해제된다. 독립 프로그램이므로 히터와 환기의 interlock을 뜻하지 않는다. 단위 선택은 물리값을 바꾸지 않고 입력·표시 단위를 바꾼다. 17°C = 62.6°F = 290.15K이다. E16–E18의 하루 판단은 같아야 한다.

일정값과 수동 단일 패킷 모드는 개별 경계 실험에 쓸 수 있다. 선택적인 디버깅 소스이며 일변화에 따른 판단 관찰을 대신하지 않는다.

Stale은 단일 패킷 모드 또는 샘플 공급 중단으로 시험한 뒤 simulation 시간을 선언된 3s 경계까지 진행한다. 반복하는 일정값 소스 샘플은 새 증거이므로 오래된 것으로 처리하지 않는다. Disconnected는 해당 샘플 품질을 선택한다. 새로 전달된 실패도 실패다. 오래된 Good 패킷을 새 샘플처럼 반복 재사용해서 단절을 흉내 내지 않는다.

히터에서 18 → 17 → 18 → 22 → 23°C, 센서 오류, 복구를 관찰한다. VPD controller별로 온도를 25°C에 고정하고 RH를 바꿔 임계값을 넘긴다. 다음에는 PPFD만 바꾼다. requested/safe demand, air_vpd_value, vpd_valid를 비교한다. 누락, Invalid, Disconnected, 오래된 샘플을 시험한다. 관련 오류는 즉시 출력을 억제해야 한다. 수치 관계를 확인할 때 T/RH를 함께 바꾼다. 논리 요구, 성공한 scan, 가상 actuator를 물리 효과 확인으로 해석하지 않는다.

<a id="ch15"></a>
## 15. 이름 있는 물리량과 단위

6장의 `Duration`과 7장의 날짜·시각은 이 장의 대상이 아니다. 여기서는 온도, 압력,
광량처럼 값의 단위가 제어 의미를 바꾸는 17개 이름 있는 물리량을 다룬다. 단위가
없는 `Number`로 바꾸지 않고 타입을 유지하면, 같은 숫자라도 서로 다른 센서의 측정값을
잘못 비교하는 일을 컴파일 단계에서 막을 수 있다. `Rate<Q>`는 시간창에서 파생되는
식 전용 타입이며 별도 물리량 catalog 항목이 아니므로 13장에서 다룬다.

### 물리량마다 구분되는 타입

아래 리터럴은 각 타입의 유효한 표기 예다. `Reference §2.9`에는 전체 허용 단위와
정규 단위가 있다. 소스에서 같은 타입의 서로 다른 단위를 섞으면 GhostFlow가 정규 단위로
변환한다. 변환은 물리량 타입을 바꾸지 않는다.

| 이름 있는 타입 | 리터럴 예 | 무엇을 나타내나 |
|---|---|---|
| `Temperature` | `25°C`, `77°F`, `298.15K` | 절대 온도 |
| `TemperatureDelta` | `5Δ°C`, `9Δ°F` | 온도 차이 |
| `RelativeHumidity` | `70%RH` | 상대습도 |
| `Pressure` | `100kPa` | 압력 |
| `VaporPressureDeficit` | `1kPaVPD` | 포화 수증기압과 실제 수증기압의 차이 |
| `CO2Concentration` | `800ppm` | 이산화탄소 몰분율 |
| `FlowRate` | `5L/min` | 체적 유량 |
| `Volume` | `20L` | 체적 |
| `Length` | `35cm` | 길이 |
| `Irradiance` | `300W/m2` | 면적당 복사 에너지 출력 |
| `PPFD` | `600umol/m2/s` | 광합성 유효 파장대 광자의 면적·시간당 개수 |
| `Energy` | `1kWh` | 에너지 |
| `Power` | `150W` | 전력 |
| `ElectricalCurrent` | `800mA` | 전류 |
| `Voltage` | `24V` | 전압 |
| `Conductivity` | `1.5mS/cm` | 전기 전도도 |
| `Acidity` | `6.5pH` | 산도 지표 |

### 같은 물리량의 단위는 함께 쓸 수 있다

`25°C`와 `77°F`는 서로 다른 숫자와 단위 표기지만 같은 `Temperature`다. 따라서 센서
값을 어느 쪽으로 받았든 같은 타입의 경계와 비교할 수 있다. `5Δ°C`와 `9Δ°F`도 같은
온도 차이다. 단, 절대 온도와 온도 차이는 다른 타입이다. 두 온도의 차는
`TemperatureDelta`이고, 온도에 차이를 더하거나 빼는 연산은 허용된다. 두 절대 온도를
서로 더하는 것은 허용되지 않는다.

GhostFlow는 모든 단위 조합을 임의로 계산하지 않는다. 같은 선형 물리량끼리의 덧셈·뺄셈,
같은 타입의 비교와 수치 스칼라 곱셈·나눗셈을 허용한다. 물리량끼리의 곱은 정해진 관계만
가능하다. 예를 들어 `FlowRate * Duration -> Volume`, `Power * Duration -> Energy`,
`Voltage * ElectricalCurrent -> Power`다. `Pressure + Length`처럼 관계가 정의되지 않은
조합이나 단위 없는 `Number`로의 암묵 변환은 오류다.

| 가능한 식 | 결과 | 불가능한 혼합 예 |
|---|---|---|
| `room < 25°C && room < 77°F` | 온도 비교 | `room + room` — 절대 온도끼리 더하기 |
| `change >= 5Δ°C && change >= 9Δ°F` | 온도 차 비교 | `room > change` — 절대 온도와 차이 비교 |
| `flow * 1min` | `Volume` | `flow + 20L` — 유량과 체적 더하기 |
| `voltage * current` | `Power` | `pressure > vpd` — 압력과 VPD 비교 |
| `power * 1h` | `Energy` | `irradiance > ppfd` — 서로 다른 광량 타입 비교 |

### 센서의 광량 단위를 혼동하지 않기

온실 센서는 비슷한 이름의 빛 측정값을 서로 다른 단위로 낼 수 있다. `Irradiance`의
`W/m2`는 면적에 도달하는 복사 출력이다. `PPFD`의 `umol/m2/s`는 광합성에 유효한
파장대 광자의 흐름을 센다. 두 값은 물리량 타입부터 다르므로 직접 비교하거나 서로의
임계값을 대신 쓸 수 없다. 스펙트럼을 고려한 검증된 변환 없이는 일반적인 환산 계수도
없다.

현재 물리량 catalog에는 `Lux` 타입이 없다. Lux 센서 값을 PPFD로 이름만 바꾸어 연결하면
안 된다. Lux는 사람 눈의 감도에 따른 조도이므로 광원의 스펙트럼, 센서 보정, 광학 조건을
반영한 검증된 변환이 필요하다. 변환은 센서 binding이나 검증된 전처리 경계에서 명시하고,
나오는 타입을 실제 단위와 맞춰야 한다. 입력마다 타입을 확인하려면 센서 선언도 분리한다.

### E33 — 서로 다른 단위와 물리량을 한 제어에서 확인하기

이 예제는 지원 catalog의 모든 이름 있는 물리량을 사용한다. 온도·온도 차, 유량·체적,
전압·전류처럼 허용된 관계는 결과 타입까지 드러낸다. 복사 조도 센서와 PPFD 센서는 별도
타입으로 선언한다.

```ghost
// E33
control PhysicalQuantityUnits {
  input air: Temperature;
  input temperature_change: TemperatureDelta;
  input humidity: RelativeHumidity;
  input pressure: Pressure;
  input vpd: VaporPressureDeficit;
  input co2: CO2Concentration;
  input flow: FlowRate;
  input tank_volume: Volume;
  input pipe_length: Length;
  sensor irradiance: Irradiance {
    sample = 1s; valid = 0W/m2 .. 1500W/m2;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor ppfd: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  input stored_energy: Energy;
  input rated_power: Power;
  input current: ElectricalCurrent;
  input voltage: Voltage;
  input conductivity: Conductivity;
  input acidity: Acidity;

  output temperature_ok, change_ok, humidity_ok, pressure_ok, vpd_ok: Bool;
  output co2_ok, volume_ok, length_ok, irradiance_ok, ppfd_ok: Bool;
  output energy_ok, power_ok, current_ok, voltage_ok, conductivity_ok, acidity_ok: Bool;
  output pumped_volume: Volume;
  output motor_power: Power;
  output hourly_energy: Energy;

  let motor_load = voltage * current;
  temperature_ok <- air >= 25°C && air >= 77°F;
  change_ok <- temperature_change >= 5Δ°C && temperature_change >= 9Δ°F;
  humidity_ok <- humidity >= 70%RH;
  pressure_ok <- pressure >= 100kPa;
  vpd_ok <- vpd >= 1kPaVPD;
  co2_ok <- co2 >= 800ppm;
  volume_ok <- tank_volume >= 20L;
  length_ok <- pipe_length >= 35cm;
  irradiance_ok <- case irradiance { ok(value) => value >= 300W/m2; fault(_) => false; };
  ppfd_ok <- case ppfd { ok(value) => value >= 600umol/m2/s; fault(_) => false; };
  energy_ok <- stored_energy >= 1kWh;
  power_ok <- rated_power >= 150W;
  current_ok <- current >= 800mA;
  voltage_ok <- voltage >= 24V;
  conductivity_ok <- conductivity >= 1.5mS/cm;
  acidity_ok <- acidity <= 6.5pH;
  pumped_volume <- flow * 1min;
  motor_power <- motor_load;
  hourly_energy <- motor_load * 1h;
}
```

`pressure > vpd`, `irradiance > ppfd`, `humidity > 70%`, `air + air`, `flow + tank_volume`는
타입이 다르거나 정의되지 않은 연산이므로 거부된다. 센서의 단위가 바뀌면 같은 물리량의
허용 단위인지 확인하고, 광량처럼 다른 물리량으로 바뀌는 경우에는 변환 출처와 정확성을
별도로 검증한다. 이 장의 단위 예제는 계산 규칙을 설명하며, 실제 센서 보정이나 장비의
운전 한계를 대신하지 않는다.

<a id="appendix-a"></a>
## 부록 A. 명세 길잡이

이 표는 학습 장에서 기준 문법을 찾는 길잡이다. 전체 문법이나 구현 지원 목록을 대신하지 않는다.

| 주제 | Language Reference |
|---|---|
| `.ghost.md`, fence 추출, anchor, 이름, 선언 골격 | [1장](reference/01-source-and-syntax.md) |
| 타입, 정수, Result, 식, 함수, tick, 상태 | [2장](reference/02-types-expressions-state.md) |
| Duration, 시각, timer, schedule, solar·lunar·tide | [3장](reference/03-time-and-schedules.md) |
| 센서 품질, filter, capability, constraints, resources | [4장](reference/04-sensors-constraints-control.md) |
| typed config, live update, observation descriptor | [5장](reference/05-settings-and-observation.md) |
| import, instance, connect, macro, replay, replacement | [6장](reference/06-composition-and-replay.md) |
| 오류·불확실성·문법 색인 | [7장](reference/07-semantic-rules-and-index.md) |
| 언어·runtime·Driver·binding·UI 책임 | [8장](reference/08-language-runtime-and-device-boundaries.md) |
| 자주 묻는 코딩 사례 | [GhostFlow Coding FAQ](language_faq.md) |

<a id="appendix-b"></a>
## 부록 B. 오류로 배우기

아래는 Reference의 규칙을 연습하는 짧은 오류 예다. 각 코드는 독립적으로 읽는다.
`ghost-error`는 이 안내서에서 오류 예제를 표시하는 인쇄용 태그다. 실제 `.ghost.md`
실행 fence는 정확히 `ghost`를 사용하며, 아래 오류 코드를 실행 프로그램에 넣지 않는다.

### E90 — 세미콜론 누락

```ghost-error
control MissingSemicolon {
  input start: Bool
  output pump: Bool;
  pump <- start;
}
```

줄바꿈은 선언의 끝을 대신하지 않는다. 선언 뒤에 `;`가 필요하다.

### E91 — 타입이 다른 비교

```ghost-error
control MixedTypes {
  input level: Number;
  output pump: Bool;
  pump <- level < 30%;
}
```

`Number`와 `Percent`를 암묵 변환하지 않는다.

### E92 — 다음 상태 의존성

```ghost-error
control NextDependency {
  state a: Bool = false;
  state b: Bool = false;
  output lamp: Bool;
  a' = !a;
  b' = a';
  lamp <- b';
}
```

하나의 tick에서 next state 식은 이전 상태 snapshot을 읽는다. 다른 상태의 다음 값을 chain으로 읽지 않는다.

### E93 — 두 root control

```ghost-error
control First { output lamp: Bool; lamp <- false; }
control Second { output lamp: Bool; lamp <- true; }
```

프로그램 실행 root는 하나의 control이다. 여러 control을 재사용하려면 Reference 6장의 import·instance·connect를 사용한다.

### E94 — 가변 정수 범위 초과

```ghost-error
control OutOfRange {
  let count = 2147483648;
  output lamp: Bool;
  lamp <- false;
}
```

`Int` 리터럴은 signed 32-bit 범위 안이어야 한다. 정수 범위와 변환은 [Reference §2.3](reference/02-types-expressions-state.md#23-정확한-정수-설계)를 참조한다.

### E95 — 빠진 enum case

```ghost-error
control MissingCase {
  type Mode = Off | On;
  state mode: Mode = Off;
  output lamp: Bool;
  lamp <- case mode { Off => false; };
}
```

`case`는 가능한 모든 enum member를 다뤄야 한다.

### E96 — 중복 출력 연결

```ghost-error
control DuplicateOutput {
  output lamp: Bool;
  lamp <- false;
  lamp <- true;
}
```

출력에는 하나의 연결이 필요하다. 문장 순서로 앞의 연결을 덮어쓰지 않는다.

### E97 — sensor Result 미처리

```ghost-error
control BareSensor {
  sensor moisture: Percent;
  output pump: Bool;
  pump <- moisture < 30%;
}
```

sensor를 payload처럼 바로 비교하지 않는다. `case` 또는 Reference §2.5의 명시적 Result transform을 사용한다.

<a id="appendix-c"></a>
## 부록 C. 문서 유지 규칙

시간에 따라 변하는 환경을 요청한 학습 시나리오는 기본 소스로 관련 ON/OFF 판단을 시간에 따라 실행해야 한다. 기존 book simulation 테스트에 독립적인 전환 checkpoint를 유지한다. 일정한 정상 입력만으로는 그 의도를 검증할 수 없다. 일변화 검증은 기존 오류·엄격한 경계 scan을 보완한다.

Language Reference는 규범 기준이다. 이 사용 안내서에서 발견한 상충이나 빠진 예는 해당 Reference 절을 먼저 확인한 뒤 고친다. 문법·의미 변경은 Reference의 문법, 규칙, 이유와 예제를 갱신하고 여기서 학습 경로와 코드를 동기화한다. 학습에 필요한 구현 경계는 근거 문서에 연결하고, 변동하는 진행률·테스트 수·산출물 해시·지원 보드 목록은 그 문서에서 관리한다. 예제 compiler 검사는 `tests/docs-runnable-examples.test.mjs`를 재사용한다. 책 변경 뒤 `npm run generate:pc01`로 파생 출처를 갱신하며 과거 replay·benchmark 근거는 고치지 않는다.

<a id="appendix-d"></a>
## 부록 D. 관심그룹별 예제

같은 제어 언어를 서로 다른 일을 하는 사람들이 어떻게 읽을 수 있는지 보여 주는 열 편이다. 각 예제는 독립 프로그램이며 실행 가능한 `ghost` fence다. PIG에서는 코드를 실행하고 입력 순서를 바꿔 볼 수 있다. 결과는 논리 제어의 예시다. 실제 접점·밸브·모터의 작동은 보드, Driver, 배선과 현장 확인이 따로 책임진다.

### E23 — PLC 개발자: 고장 원인에서 출력까지 한 번에 따라가기

> “왜 멈췄는지, 다시 추리하지 않도록.”

컨베이어가 갑자기 멈추면 “시작 버튼을 다시 눌러 보자”보다 “어떤 조건이 운전을 끊었나”가 먼저다. 이 프로그램은 jam 입력이 사라진 scan에서 운전 상태를 내리고 고장을 기억한다. 원인이 해소된 뒤 reset을 눌러도 시작 버튼을 놓았다 다시 누르기 전까지 컨베이어는 다시 켜지지 않는다.

입력을 `start=true`, `jam_clear=false`, `reset=false`로 바꿔 실행하면 `fault_latched`와 `fault_lamp`가 켜지고 `running`과 `conveyor`는 꺼진다. jam을 복구한 뒤 reset을 누르면 고장 기억만 해제된다. 어느 입력과 상태가 출력 판단에 쓰였는지 소스에서 바로 따라갈 수 있다. jam 검출의 전기적 의미와 비상정지 회로는 별도로 설계해야 한다.

```ghost
// E23
control TraceableConveyor {
  input start, stop, jam_clear, reset: Bool;
  state running: Bool = false;
  state fault_latched: Bool = false;
  state start_armed: Bool = true;
  let fault_next = (fault_latched && !reset) || !jam_clear;

  fault_latched' = fault_next;
  start_armed' = !fault_next && !start;
  running' = !stop && jam_clear && !fault_latched && (running || (start_armed && start));

  output conveyor, fault_lamp: Bool;
  conveyor <- running';
  fault_lamp <- fault_next;
}
```

### E24 — 웹 개발자: 화면의 목표와 장치 피드백을 분리하기

> “이제, 화면 밖의 세상을 프로그래밍하세요.”

대시보드에서 “열기”를 눌렀다는 사실과 밸브가 실제 열린 위치에 도달했다는 사실은 다르다. 웹 개발자는 요청 상태와 서버 응답 상태를 나누어 다루지만, 장치 UI에서는 둘이 같은 초록색 아이콘으로 뭉개지기 쉽다. 여기서는 `target_open`을 명령 상태로 기억하고 limit 입력을 별도의 확인 신호로 보여 준다.

`open_request`를 한 번 넣으면 명령이 유지되고 `open_limit`를 참으로 바꾸기 전까지 “이동 중” 표시가 켜진다. close 요청은 열기 요청보다 우선한다. 화면은 목표, 출력 명령, 물리 피드백을 서로 다른 값으로 렌더링할 수 있다. limit가 실제 위치를 정확히 반영하는지는 설치와 장치 진단의 책임이다.

```ghost
// E24
control ValvePanelState {
  input open_request, close_request, stop, open_limit: Bool;
  state target_open: Bool = false;

  target_open' = !stop && !close_request && (open_request || target_open);

  output open_command, close_command, moving_open, open_confirmed: Bool;
  open_command <- !stop && target_open';
  close_command <- !stop && !target_open';
  moving_open <- !stop && target_open' && !open_limit;
  open_confirmed <- open_limit;
  require !(open_command && close_command);
}
```

### E25 — 펌웨어 개발자: 겹친 방향 명령을 보드에 올리기 전에 잡기

> “릴레이를 켜기 전에, 로직부터 돌려보세요.”

정회전과 역회전 입력이 같은 scan에 참이 되는 상황은 버튼, 통신 패킷, 접점 bounce에서 생길 수 있다. 이 예제는 어느 한쪽을 임의로 고르지 않고 양쪽 구동 명령을 모두 끈다. PIG에서 정상 요청, 정지 허가 상실, 충돌 입력을 번갈아 주면 각 출력의 결과를 보드에 올리기 전에 살필 수 있다.

이 식은 펌웨어 업로드 전 논리 우선순위를 읽는 첫 단계다. 소프트웨어 상호 배제만으로 접촉기의 동시 투입이나 모터의 관성 회전을 막을 수는 없다. 장치에는 적절한 전기·기계 인터록과 독립 보호가 필요하다. 정·역전환 대기시간을 요구하는 설비에는 명시적 상태와 피드백을 더해야 한다.

```ghost
// E25
control DirectionRequestGate {
  input stop_ok, forward_request, reverse_request: Bool;
  output forward_command, reverse_command, conflict: Bool;

  forward_command <- stop_ok && forward_request && !reverse_request;
  reverse_command <- stop_ok && reverse_request && !forward_request;
  conflict <- forward_request && reverse_request;
  require !(forward_command && reverse_command);
}
```

### E26 — AI 개발자: 생성된 규칙 옆에 검토할 의도를 남기기

> “AI가 작성해도, 동작의 이유는 남아야 하니까.”

AI가 만든 제어식이 컴파일된다는 사실만으로 생성 결과의 의도까지 확인되지는 않는다. 리뷰어에게는 어떤 현장 전제가 있었는지, 그 전제가 어느 식에 반영됐는지, 무엇을 시뮬레이션해야 하는지가 이어진 문서가 필요하다. `.ghost.md`는 설명과 실행 코드를 한 원본에 두고, 컴파일러는 최상위 `ghost` fence를 원래 위치 정보와 함께 읽는다.

아래 코드는 “급수 시간대가 열려 있고 토양이 건조하며 급수원이 준비됐을 때만 펌프를 요청한다”는 규칙이다. 실제 프로젝트에서는 설명에 AI가 가정한 센서 극성이나 미결 현장 결정을 표시하고 담당자가 확인한 뒤 revision으로 남긴다. 문서 형식이 AI의 정확성을 보증하지는 않지만 검토 대상을 코드 안에 숨기지 않는다.

```ghost
// E26
control ReviewedWateringRule {
  input watering_window, soil_needs_water, source_ready: Bool;
  output pump_request: Bool;

  pump_request <- watering_window && soil_needs_water && source_ready;
}
```

### E27 — ESP32·제어보드 제조사: I/O 목록에 실제 용도를 연결하기

> “좋은 보드에, 쓰임새를 더하세요.”

입력 8개와 출력 8개를 나열한 데이터시트만으로는 고객이 보드로 무엇을 만들지 상상하기 어렵다. 이 예제는 생장등, 순환팬, 배수펌프와 경고 출력을 운영 조건에 연결한다. 제조사는 고객이 자기 보드와 대조해 볼 논리 역할을 제품 예제로 제시할 수 있다.

출력 이름은 GPIO 번호가 아니라 장치 역할이다. `grow_light`를 어느 채널에 연결할지, `source_ready`를 어떤 센서로 공급할지는 보드 binding과 Driver가 결정한다. 따라서 소스 하나가 모든 보드에서 자동 호환된다고 약속하지 않고, 보드별로 확인한 연결표와 묶어 제공할 수 있다.

```ghost
// E27
control BoardShowcase {
  input enabled, light_schedule, ventilation_request: Bool;
  input drain_request, drain_path_ready: Bool;
  output grow_light, circulation_fan, drain_pump, warning: Bool;

  grow_light <- enabled && light_schedule;
  circulation_fan <- enabled && ventilation_request;
  drain_pump <- enabled && drain_request && drain_path_ready;
  warning <- drain_request && !drain_path_ready;
}
```

### E28 — 제어반·설비 통합업체: 밸브 확인 뒤에 펌프를 요청하기

> “설비와 함께, 동작의 이유도 납품하세요.”

시운전에서 자주 놓치는 차이는 “밸브를 열라고 명령했다”와 “열림 limit가 들어왔다” 사이에 있다. 둘을 같은 조건으로 다루면 배관 상태가 확인되기 전에 펌프가 먼저 요청될 수 있다. 이 예제는 충전 요구를 기억하되 열림 피드백이 확인될 때까지 펌프 출력을 막는다.

`fill_request`를 주고 `valve_open_limit=false`로 두면 밸브 명령만 켜진다. limit를 참으로 바꾸면 다음 scan에서 펌프 요청이 켜진다. 종료 또는 source-full 입력은 상태를 지우고 출력을 멈춘다. 설치자는 limit 극성, 밸브 timeout, 정지 후 복구를 현장 계약에 맞게 더해야 한다.

```ghost
// E28
control ConfirmedValveFill {
  input fill_request, stop_ok, valve_open_limit, source_full: Bool;
  state filling: Bool = false;

  filling' = stop_ok && !source_full && (fill_request || filling);

  output valve_open_command, pump_command: Bool;
  valve_open_command <- filling';
  pump_command <- filling' && valve_open_limit;
  require pump_command => valve_open_command;
}
```

### E29 — 유지보수 담당자: 기다림과 고장을 구별할 단서를 남기기

> “만든 사람이 없어도, 고칠 실마리는 남도록.”

장비를 넘겨받은 담당자가 “펌프가 왜 아직 안 도나”에 답하려면 요청과 피드백을 볼 수 있어야 한다. 아래 제어는 밸브 열림을 기다리는 동안 pump를 끄고 `waiting_for_valve`를 켠다. limit가 들어오면 기다림 표시는 꺼지고 펌프 명령이 나온다. 정지 허가가 내려가면 출력과 대기 표시를 해제한다.

이 표시는 밸브 이동 시간이 정상 범위인지 판단하지 않는다. 화면과 기록에서 “대기 중”을 timeout 고장과 구분하고, 인수인계 문서에는 limit 입력의 채널·극성·점검 방법을 함께 적어야 한다. 다음 담당자가 원래 작성자를 찾지 않고 어느 입력부터 확인할지 알게 하는 것이 이 예제의 목표다.

```ghost
// E29
control ValveWaitDiagnosis {
  input fill_request, stop_ok, valve_open_limit: Bool;
  output valve_open_command, pump_command, waiting_for_valve: Bool;

  valve_open_command <- fill_request && stop_ok;
  pump_command <- fill_request && stop_ok && valve_open_limit;
  waiting_for_valve <- fill_request && stop_ok && !valve_open_limit;
}
```

### E30 — 농부·현장 운영자: 물 줄 때는 농부가 정하고 반복은 기계에 맡기기

> “판단은 농부가. 반복은 기계가.”

관수 정책은 수분값 하나로 정해지지 않는다. 작물과 작업자의 판단은 `enabled`와 `watering_window`에 담고, 이 예제는 정한 시간대에 토양이 건조하며 급수원이 준비된 경우에만 펌프를 요청한다. 급수원이 준비되지 않으면 운영 화면에 그 이유를 보여 준다.

`watering_window`는 달력·기상·작업 계획을 대신하는 숨은 기본값이 아니다. 농부가 선택한 일정 정책을 실행 환경이 공급하는 입력이다. 사용자는 시간대나 건조 기준을 바꾸고, 같은 규칙의 반복은 제어에 맡길 수 있다. 센서 위치와 보정, 관수량, 작물별 기준은 현장에서 정해야 한다.

```ghost
// E30
control FarmerDirectedWatering {
  input enabled, watering_window, soil_needs_water, source_ready: Bool;
  output pump_request, source_attention: Bool;

  pump_request <- enabled && watering_window && soil_needs_water && source_ready;
  source_attention <- enabled && watering_window && soil_needs_water && !source_ready;
}
```

### E31 — 메이커·자동화 입문자: 관수와 환풍기 예제를 가져와 함께 쓰기

> “예제는 많은데, 합치기는 어려웠죠?”

관수 예제 E21과 환기 예제 E20을 원문 복사 없이 import한다. 루트 제어는 공통 온도·습도·빛 입력을 두 프로그램에 연결하고, 각 프로그램의 센서 처리와 내부 상태는 독립적으로 둔다. 출력도 `irrigation_demand`와 `ventilate_demand`로 나눠 공개한다.

두 요구가 동시에 참일 수 있다. 이를 같은 전원이나 출력에 연결하려면 허용 조건과 우선순위를 먼저 정해야 한다. import에는 원본 판본과 해시가 고정되고, 실제 보드에 싣기 전에는 조합한 프로그램의 메모리와 계산량도 확인한다.

```ghost
// E31
import Irrigation from "./E21.ghost.md"
  revision "7e135b93ea4c4988d305f992db277a6d8581a271"
  sha256 "d461a2a0f722271a172ce4c3d66665dad8f3a58a54079712e4bd3adb55f003a0";
import Ventilation from "./E20.ghost.md"
  revision "7e135b93ea4c4988d305f992db277a6d8581a271"
  sha256 "bbf57007c5973684660747c515bb2534124d50341647b2282bd2ca32852a724b";
control CombinedGreenhouseDemands {
  sensor air: Temperature {
    sample = 1s; valid = 0°C .. 50°C;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor humidity: RelativeHumidity {
    sample = 1s; valid = 0%RH .. 100%RH;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  sensor light: PPFD {
    sample = 1s; valid = 0umol/m2/s .. 3000umol/m2/s;
    filter = median(1); stale_after = 3s; recover_after = 1 samples;
  }
  output irrigation_demand, ventilate_demand: Bool;
  instance watering: Irrigation;
  instance fan: Ventilation;
  connect watering.air <- air;
  connect watering.humidity <- humidity;
  connect watering.light <- light;
  connect fan.air <- air;
  connect fan.humidity <- humidity;
  connect fan.light <- light;
  connect irrigation_demand <- watering.irrigation_demand;
  connect ventilate_demand <- fan.ventilate_demand;
}
```

### E32 — 오픈소스 사용자: 장비보다 먼저 자기 제어 규칙을 보유하기

> “회사가 사라져도, 제어는 남아야 하니까.”

장비 공급자나 온라인 서비스가 바뀌어도 사용자는 승인한 제어 규칙을 읽고 보관할 수 있어야 한다. 이 독립 예제는 토양 수분과 임계값을 입력으로 받고, 두 값의 비교 규칙을 소스에 드러낸다. 구독 화면이나 원격 계정이 제어 판단의 비공개 원본이 되지 않는다.

`.ghost.md` 파일과 Language Reference, compiler revision을 함께 보관하면 검토하고 다시 생성할 출처가 남는다. 다른 보드에서 실행하려면 해당 보드의 지원 runtime과 I/O binding을 확인해야 한다. 프로그램 소유권이 이식을 보장하지는 않지만 제어 의도를 특정 공급자만 읽을 수 있는 바이너리에 가두지 않는 출발점이다.

```ghost
// E32
control OwnedWateringRule {
  input soil_moisture, threshold: Percent;
  output pump_request: Bool;
  pump_request <- soil_moisture < threshold;
}
```

이 열 편을 관통하는 GhostFlow의 약속은 장치를 움직이는 데서 끝나지 않는다. 입력과 규칙에서 출력 의도까지의 이유를 소스에 남겨 다음 사람이 검토하고 이어갈 수 있게 한다.

## 정확한 수와 자연 시각: R14–R17 실행 예제

이 절은 [#30](https://github.com/callin2/ghostflow-language/issues/30)의 R14–R17을 현재 지원되는 독립 프로그램으로 설명한다. 규칙의 권위는 [Reference 02](reference/02-types-expressions-state.md)와 [Reference 03](reference/03-time-and-schedules.md)다. 과거 검토 계획의 잠정 표기는 현재 채택된 규칙을 대체하지 않는다. 다음은 이미 채택된 결정과 작업의 추적 근거이며 정책 재선택 요청이 아니다.

| 항목 | 채택된 결정과 작업 | 실행 증거 |
|---|---|---|
| R14 정확한 수 | #22/#24/#25: checked i32 Int, 명시적 변환, overflow 시 tick 거절 | E34/E98, [정수 검사](../tests/int-compiler.test.mjs), [나눗셈·경계](../tests/int-division-identity.test.mjs) |
| R15 절대 시각 | #27: offset 있는 DateTime, 정확한 UTC instant, Duration 이동 | E35/E99, [DateTime 실행](../tests/date-time-control.test.mjs) |
| R16 달력·자연 예약 | #28 및 #401/#403: Solar pulse, Tide run/within, provider·occurrence 식별 | E36/E37, [자연 예약](../tests/natural-schedule-contract.test.mjs), [Solar scan parity](../tests/solar-scanframe-native-wasm.test.mjs) |
| R17 불확실 시각 정책 | #29: 제한된 hold_trusted, Solar fixed_time, 명시적 terminal skip | E36/E100–E102, [fallback 컴파일](../tests/natural-fallback-compiler.test.mjs), [fallback 실행](../tests/natural-fallback-runtime.test.mjs) |

E34–E37은 현재 컴파일러가 실행 bytecode를 만드는 예제다. 아래 오류 예제는 의도적으로 거절되는 완전한 프로그램이다. 각 fence는 따로 실행한다. [문서 컴파일 검사](../tests/docs-runnable-examples.test.mjs)는 두 언어의 같은 소스와 의도한 오류를 검증하며 [책 실행 검사](../tests/programming-natural-examples.test.mjs)는 E34–E37의 host 동작을 검사한다. 컴파일과 host runtime 검사는 Device 배포나 물리 출력 확인이 아니다.

### E34 — 참인 scan의 수를 정확히 세기

`add=true`인 성공한 scan마다 1을 더한다. 상승 edge의 수가 아니므로 true를 유지하면 scan마다 증가한다. 출력은 병렬 갱신 후의 `count'`다. Int 최대값에서 더하면 `integer-overflow`로 tick을 거절하고 새 상태·출력 의도를 commit하지 않는다. wrap이나 포화로 숨기지 않는다.

```ghost
// E34
control ExactScanCount {
  input add: Bool;
  state count: Int = 0;
  output total: Int;
  count' = if add then count + 1 else count;
  total <- count';
}
```

### E35 — offset 있는 절대 시각 구간 비교하기

현지 표기 06:30+09:00과 전날 21:30Z는 같은 UTC instant다. `now`는 환경에서 전달하는 typed DateTime이며 숫자나 시계의 신뢰 여부를 추측하는 표현식이 아니다. 구간은 시작 포함·끝 제외다. `5min`은 고정 Duration이며 달력의 한 달이나 타임존 변경을 뜻하지 않는다. 도메인 밖 DateTime 입력이나 이동 결과는 거절되며 부분 상태 갱신을 만들지 않는다.

```ghost
// E35
control AbsoluteWindow {
  input now: DateTime;
  output in_window, same_instant: Bool;
  let start = datetime`2026-09-30T06:30:00+09:00`;
  let end = start + 5min;
  in_window <- now >= start && now < end;
  same_instant <- start == datetime`2026-09-29T21:30:00Z`;
}
```

### E36 — 일출 pulse와 제한된 시계·고정 시각 fallback

일출 30분 뒤의 occurrence에서 `enabled`일 때 시작 pulse를 요청한다. `start`는 하루 종일 켜지는 상태가 아니며 duration 운전을 추가하지 않는다. 환경은 신뢰 시계와 위치·Solar 계산 근거를 제공한다. `hold_trusted`는 같은 run/time 연속성에서 이미 받은 신뢰 snapshot을 단조 시계로 최대 2분만 연장한다. 이전 신뢰 근거가 없거나 정확한 2분 경계에 도달하면 skip한다. 보류 시각을 신뢰 wall clock으로 기록하지 않는다.

Solar 사건을 사용할 수 없을 때 명시한 고정 UTC 06:30 대안을 사용한다. 이 fallback도 유효한 신뢰/제한 보류 시계가 필요하다. 사용할 수 없는 시각을 0이나 지금으로 바꾸지 않으며 terminal은 skip이다. 최초 관측과 큰 공백의 baseline 복구는 지난 occurrence를 소급해서 시작하지 않는다. admission·unknown·fallback 이유는 schedule 증거에서 구별한다.

```ghost
// E36
control SolarFallbackStart {
  input enabled: Bool;
  schedule dawn: Solar {
    timezone = "UTC";
    latitude = 37;
    longitude = 127;
    at = sun`rise + 30min`;
    basis = pulse;
    when = enabled;
    clock = hold_trusted(2min, terminal: skip);
    gap = skip_after(60s);
    recovery = baseline;
    fallback = fixed_time(time`06:30`, terminal: skip);
  }
  output start: Bool;
  start <- dawn.due;
}
```

### E37 — 만조 전의 승인 유예와 단조 시계 운전

provider `harbor_tides`의 만조 30분 전이 계획 시각이다. 유효하고 신선한 예측·신뢰 시계가 있고 `allowed=true`이면 [계획, 계획+10분)에서 한 번 승인한다. 정확한 끝은 제외한다. 승인부터 5분 운전하며 지연 승인으로 운전 길이가 늘어나지 않는다. `stop=true`이면 `cancel_when`으로 취소한다. 새 admission이 허용되지 않아도 이미 승인한 운전은 단조 시간으로 진행하며 취소 조건과 run/time 연속성 규칙을 따른다.

없는·오래된 예측이나 Unknown 시계는 새 운전을 승인하지 않는다. `fallback=skip`은 물리 fail-safe를 증명하거나 예측을 만들어내지 않는다. `pump`는 safe/applied/confirmed 물리 사실과 구별되는 출력 의도다. provider의 station/revision/occurrence와 clock snapshot은 환경 입력이며 코드에 주소나 설치 credential을 넣지 않는다.

```ghost
// E37
control TideRun {
  input allowed, stop: Bool;
  provider harbor_tides: TidePredictions;
  schedule high: Tide {
    source = harbor_tides;
    timezone = "UTC";
    at = tide`high - 30min`;
    basis = run(5min, within(10min));
    when = allowed;
    cancel_when = stop;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- high.active;
}
```

### E98 — Int와 Number를 암묵적으로 섞지 않기

아래 count는 Int이며 measurement는 Number다. 이 코드는 거절된다. 의도가 근사 계산이면 `number(count)`를 명시하고, 정확한 수로 바꾸려면 `int_exact`나 명시한 반올림 변환의 오류 정책을 선택한다.

```ghost-error
control MixedCount {
  input count: Int;
  input measurement: Number;
  output total: Number;
  total <- count + measurement;
}
```

### E99 — offset 없는 DateTime을 거절하기

현지 시각만으로 UTC instant를 만들지 않는다. Z 또는 숫자 offset을 명시해야 하며 IANA zone을 임의로 추측하지 않는다.

```ghost-error
control MissingOffset {
  output ready: Bool;
  ready <- datetime`2026-09-30T06:30:00` < datetime`2026-09-30T07:00:00Z`;
}
```

### E100 — Solar의 fallback을 생략하지 않기

자료가 없을 때의 행동도 소스 계약이다. 필수 fallback이 빠진 예약은 bytecode를 만들지 않는다. 선택한 정책이 skip이면 `fallback = skip;`을 쓴다.

```ghost-error
control MissingSolarFallback {
  schedule dawn: Solar {
    timezone = "UTC"; latitude = 37; longitude = 127; at = sun`rise`;
    basis = pulse; when = true; clock = trusted_only;
    gap = skip_after(60s); recovery = baseline;
  }
  output start: Bool;
  start <- dawn.due;
}
```

### E101 — Solar 고정 시각 fallback을 Tide로 옮기지 않기

현재 fixed_time 실행 경로는 Solar 전용이다. Tide의 fallback은 skip이며 고정 시각을 만조 예측과 같은 occurrence로 취급하지 않는다.

```ghost-error
control UnsupportedTideFallback {
  provider predictions: TidePredictions;
  schedule high: Tide {
    source = predictions; timezone = "UTC"; at = tide`high`;
    basis = run(5min, within(10min)); when = true; cancel_when = false;
    clock = trusted_only; gap = skip_after(60s); recovery = baseline;
    fallback = fixed_time(time`06:30`, terminal: skip);
  }
  output pump: Bool;
  pump <- high.active;
}
```

### E102 — 보류 종료 정책을 반드시 쓰기

`hold_trusted(2min)`만으로 보류가 끝난 뒤의 행동을 숨기지 않는다. 현재 지원되는 명시적 끝 정책은 `terminal: skip`이다.

```ghost-error
control MissingHoldTerminal {
  schedule dawn: Solar {
    timezone = "UTC"; latitude = 37; longitude = 127; at = sun`rise`;
    basis = pulse; when = true; clock = hold_trusted(2min);
    gap = skip_after(60s); recovery = baseline; fallback = skip;
  }
  output start: Bool;
  start <- dawn.due;
}
```
