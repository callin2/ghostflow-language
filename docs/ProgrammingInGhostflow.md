# Programming in GhostFlow

전기 제어를 코드로 읽고, 실행하고, 설명하기

**공동 검토용 초고 0.1 · 2026-09-12**

## 이 책을 함께 쓰는 이유

스위치를 켰더니 모터 출력이 켜졌다. 우리가 알고 싶은 것은 결과 하나만이 아니다.
어떤 입력을 읽었는지, 어떤 상태를 기억하고 있었는지, 어떤 계산과 제약을 거쳤는지,
그리고 코드를 바꾸면 언제부터 결과가 달라지는지를 알고 싶다.

GhostFlow는 이 흐름을 소스 코드와 실행 기록으로 함께 읽기 위한 제어 언어다.
이 책에서는 가상 입력 스위치와 출력 LED로 시작해 자기유지, 시간, 센서,
여러 제어가 공유하는 설비로 범위를 넓힌다.

이 초고의 출발점은 현재 대화의 요청이다.

> “이 언어는 시작은 내가 했지만 너가 제안한 버전으로 … 같이 해야겠어”
>
> “ProgrammingInGhostflow 의 초고를 만들어 줄래? 같이 보고 검토할수 있게”

구현된 문법을 설명하면서 그 선택이 적절한지도 함께 검토한다. **현재 동작**과
**함께 결정할 질문**을 구분한다. 질문이 있다는 이유로 이미 정한 제품 의도를
다시 미결정으로 돌리지는 않는다.

구성의 참고서는 Roberto Ierusalimschy의 *Programming in Lua*다.
[온라인판 목차](https://www.lua.org/pil/contents.html)의 기초에서 응용으로 넓혀 가는
흐름, [서문](https://www.lua.org/pil/p1.4.html)의 설명을 통한 언어 개선이라는 관점을
참고했다. 이 책의 제어 예제와 설명은 GhostFlow를 위해 새로 작성했다.

### 읽는 방법

- 각 장은 제어 상황, 코드, 결과, 설계 이유, 작은 실험 순서로 읽는다.
- `E01`처럼 번호가 붙은 정상 예제는 각각 독립된 프로그램이다. 한 파일에 모두 붙이지 않는다.
- **오류 예제**는 거부되는 이유를 읽기 위한 코드다. 미구현 제안은 12장에 모았다.
- 본문의 출력은 논리 출력이다. Playground에서는 LED로 관찰하고, 실제 포트 연결은 장치의 I/O 매핑이 맡는다.
- 본문은 읽는 책이고, 부록 A는 문법을 찾는 색인이다. 정확한 실행 계약은
  [LANGUAGE.md](LANGUAGE.md), [구현 범위](IMPLEMENTATION.md)와 함께 확인한다.

책 전체는 일반 Markdown 문서다. 아래 `ghost` 블록들은 책의 예제 검사기가 **각각**
컴파일한다. 11장의 `.ghost.md` 소스가 여러 블록을 **하나로 연결**하는 것과 구분한다.
`ghost-error` 표시는 책의 오류 예제 검사 용도이며 GhostFlow literate의 실행 태그가 아니다.

## 목차

### 먼저 실습할 경로 — PLC에서 GhostFlow로

2026-09-12 사용자 제공 과정에 따라 첫 실습 목표를 **자동 물공급 제어함 완성**으로 정한다.
버튼·램프 → START/STOP → 모터 → 정역 인터록 → 리미트 → Timer → 물탱크 → Manual/Auto →
밸브·펌프 순차제어 → Fault/Alarm/Reset의 순서다. 각 과에서 같은 제어 의도를 릴레이/PLC의
개념과 GhostFlow로 비교하고, 멈춰서 수정한 뒤 동일 입력으로 타이밍 변화를 확인한다.

[10단계 과정과 과별 확인 사례](design/PLC-REPLACEMENT-CURRICULUM.md)를 실습 안내로 사용한다.
아래 언어별 장과 기존 E번호는 보존한다. 이미 같은 의도를 다루는 예제는 재사용하고,
상태 동시 갱신·함수·센서 품질·공유 설비·오류 진단처럼 고유한 내용은 심화 예제로 이어 간다.
새 과정이 아직 모든 단계의 실행 예제를 갖춘 것은 아니며, 과별 작업에서 보강한다.

### 언어별 장

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

부록: [A. 문법·키워드 색인](#appendix-a) · [B. 오류로 배우기](#appendix-b) ·
[C. 공동 검토표](#appendix-c) · [D. 근거와 예제 검사](#appendix-d)

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
이 문서와 checker의 WASM 시나리오는 논리 계산만 확인한다. 실제 접점, 전기 배선,
PLC 입력 모듈 또는 장치 출력의 검증을 주장하지 않는다.

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
코드를 실행하기 전에 위 표의 출력 세 칸을 먼저 예측해 보자.

**함께 볼 질문 R01:** `<-`가 “출력으로 연결한다”는 의미를 충분히 잘 보여주는가?
일반 계산의 `=`와 구별되는 것이 전기 제어를 읽는 데 도움이 되는가?

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

### 네 가지 기본 값

| 타입 | 예 | 읽는 의미 |
|---|---|---|
| `Bool` | `true`, `false` | 참 또는 거짓 |
| `Number` | `3`, `0.5`, `-2` | 일반 수치, 내부 표현은 f64 |
| `Percent` | `30%` | 백분율 값. 리터럴·입력 범위는 0~100 |
| `Duration` | `250ms`, `2s`, `5min`, `1h` | 밀리초 해상도의 비음수 시간 길이 |

`30`과 `30%`는 서로 다른 타입이다. 타입이 붙어 있으면 설정값을 읽기 쉬워지고
잘못 연결한 계산을 컴파일할 때 발견할 수 있다. 예를 들어 `Percent`와 `Number`를
그대로 비교할 수 없다. `Duration`을 실제로 기다리게 하는 방법은 6장에서 다룬다.

현재 시간 리터럴의 단위 앞에는 정수를 쓴다. 반 초는 `0.5s` 대신 `500ms`다.
음수·소수 시간 리터럴을 어떤 표기로 받아들일지도 언어를 검토할 때 확인할 수 있다.

문자열 `"Asia/Seoul"`과 시각 `06:00`도 뒤에서 등장한다. 현재 이들은 시간표 설정용
구문이다. 일반적인 문자열 변수·문자열 연산이나 범용 시각 타입을 뜻하지 않는다.

### 합의한 원칙 — 개수와 측정값

열매 수나 반복 횟수처럼 세는 값은 정확한 정수여야 한다. 예를 들어 `120 + 1`은
정확히 `121`이어야 한다. 반면 온도 `24.3` 같은 측정 실수는 센서와 도메인이 정한
허용 오차 안의 근삿값으로 다룰 수 있다.

정수의 정확성은 지원 범위 안에서 값과 정수 연산 결과를 정확히 보존한다는 뜻이다.
범위를 넘는 오버플로는 반올림 오차와 다른 문제이며, 그 처리 규칙도 명시해야 한다.

현재 정수처럼 보이는 수치 리터럴도 `Number/f64`로 표현한다. 정수 전용 타입은
다음 설계 대상이다. 이름과 비트 폭, 부호 여부, 타입 변환, 오버플로 정책은 R14에서
검토한다. 이 원칙의 출처는 [의도 등록부](INTENT-REGISTER.md#gf-int-exact-counts-approximate-measurements--정확한-계수와-근사-측정값의-구분)에 남겼다.

### 다음 설계 — 날짜와 시각

사용자는 날짜시각을 기본 언어 값으로, 일출·일몰 전후를 제어 기준으로 지원할 것을
제안했다. `DateTime`은 이 방향의 타입 후보이며 아직 구현 전이다. 7장에서 의미를
구분하고 R15에서 구체적인 표현과 연산 계약을 함께 검토한다.

### E02 — 입력, 설정, 계산에 각각 이름 붙이기

수위가 설정값보다 낮을 때 급수 출력을 켜 보자.

```ghost
// E02
control ThresholdControl {
  input level: Percent;
  config threshold: Percent = 30%;
  let low = level < threshold;

  output pump: Bool;
  pump <- low;
}
```

`level`은 tick마다 공급되는 입력이다. `threshold`는 프로그램에 포함된 설정값이고,
`low`는 두 값을 비교한 계산이다. `config`를 바꾸는 일은 현재 소스 변경과 재컴파일이다.
`let`은 저장해 두는 메모리가 아니라 계산에 붙인 이름이다.

| `level` | `threshold` | `low` / `pump` |
|---|---|---|
| `29%` | `30%` | `true` |
| `30%` | `30%` | `false` |
| `31%` | `30%` | `false` |

`low`의 정의를 출력 연결보다 뒤에 두어도 같은 계산이다. 컴파일러는 선언 순서보다
의존 관계를 따른다. 서로가 서로의 결과를 필요로 하는 순환 `let`은 허용하지 않는다.

**작은 실험:** `<`를 `<=`로 바꾸면 표에서 어느 행만 바뀔까?

**함께 볼 질문 R02:** `;`를 필수로 두는 것이 적절한가? 중괄호와 들여쓰기의 역할은
지금 방식이 좋은가? 이 질문은 아직 문법 변경 결정이 아니다.

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
E03을 대체하지 않으며, 실제 접점·릴레이 동작이 아닌 compiler/WASM 가상 실행을 검증한다.

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

검증 checker는 다섯 개의 virtual/compiler/WASM learning scenario에서 매 tick의
상태 전후와 `requested`/`safe`를 확인한다. 이 결과는 릴레이·MC·모터의 physical
evidence가 아니다.

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
지났다는 사실은 모터가 실제로 정지했다는 증거가 아니며, zero-speed feedback은 이 과의
미래 물리 인수 범위다. `tools/check-pc-04.mjs`의 PASS는 compiler/WASM virtual trace만
증명한다.

### PC-05 — 리미트 피드백으로 밸브 끝 위치를 확인하기

PC-05는 [canonical literate 원본](../examples/curriculum/pc-05-limit-feedback.ghost.md)에서
실행한다. 기존 E06과 PC-04를 보존·참조하며 `Phase`, `elapsed(phase)`, 다음 상태와
출력 연결로 명령과 완료 관측을 구분한다.

momentary `open_request`/`close_request`, 끝 위치 관측 `open_limit`/`close_limit`,
허가 `stop_ok`/`overload_ok`를 받는다. 초기 위치를 지어내지 않고 `Stopped`에서
시작하며, 정지 상태에서도 관측하던 limit이 사라지면 과거 상태만 믿지 않는다.
양쪽 limit이 동시에 참이면 `SensorConflict`로 가고 양쪽 출력은 꺼진다. 반대 방향의
새 요청은 목표 limit보다 우선해 양쪽 코일 명령을 끈 뒤 2초 경계에서만 이동을 재개한다.

끝 위치가 오지 않는 `Opening`/`Closing`은 timeout 누락을 드러내기 위해 명령을
계속 낸다. 이는 배포 가능한 하드웨어 동작이 아니다. PC-10에서 timeout과 fault
latch/reset을 추가한다. checker는 33개 실제 compiler/WASM frame으로 초기·정지 위치
재조정, limit 정지, 무응답, 센서 모순·복구, 반전 경계, 동시 요청과 허가 취소를 확인한다.

### PC-06 — ON-delay, OFF-delay, 최대 운전을 따로 읽기

PC-06은 [canonical literate 원본](../examples/curriculum/pc-06-timer-patterns.ghost.md)에서
세 타이머 의미를 독립된 상태로 보여 준다. `on_delay_request`는 2초 유지 뒤 켜지고,
`off_delay_request`는 요구가 사라진 뒤 3초 동안 더 켜지며, `limited_request`는
10초가 되면 꺼진 뒤 요구를 놓기 전에는 다시 시작하지 않는다. 세 입력은 momentary
버튼 사건이 아니라 현재 유지되는 운전 요구다.

세 의미를 한 타이머로 섞지 않으므로 OFF-delay가 최대 운전시간을 몰래 늘리지 않는다.
`stop_ok=false`는 OFF-delay까지 건너뛰어 세 출력을 즉시 끈다. checker는 경계 직전·정확·
직후, 취소·재요청, 긴 tick을 확인한다. 같은 논리 `nowMs`/입력 tape를 x1과 x1000
wall pacing으로 즉시 실행한 trace도 같지만, 이는 VM 논리시각 불변성이지 Web 가속
구현의 성능 인수는 아니다.

### PC-07 — 두 수위 스위치 사이를 상태로 기억하기

PC-07은 [canonical literate 원본](../examples/curriculum/pc-07-tank-hysteresis.ghost.md)에서
디지털 두 점 수위제어를 다룬다. `low_level_reached`와 `high_level_reached`는 물이
각 물리 스위치에 도달했다는 정규화 관측이다. 아래 저수위에서 `Filling`을 시작하고,
하한과 상한 사이에서는 그 상태를 유지하며, 상한 도달 때 멈춘다. 처음부터 중간 수위면
과거의 저수위 사건이 없으므로 켜지 않는다.

상한만 참이고 하한이 거짓이면 물리 순서와 모순되므로 `SensorConflict`에서 출력이
꺼진다. 충돌 해소 scan은 한 번 `Idle`로 복구한 뒤 정상 평가를 재개한다. 공통 정지·
보호와 fault latch/reset은 이 수위 개념에 섞지 않고 PC-08/PC-10에서 결합한다.
기존 tutorial/03의 연속 센서 median·quality·hysteresis 예제는 별개로 보존한다.

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
즉시 정지한다. 기존 `station-rules.ghost`와 tutorial/04는 복수 control·공유 자원
중재라는 심화 범위로 그대로 보존한다.

checker는 7개 scenario, 43개 compiler/WASM tick에서 양 모드 충돌, Manual 자기유지,
Manual↔Auto 정지 경유 전환, held request 재기동 억제, Manual STOP, Auto 과부하,
Auto 수요 해제, Off 선택을 확인한다. 이는 논리 코일 명령의 virtual evidence이며
접촉기 폐쇄나 펌프 회전의 physical acceptance가 아니다.

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
중재는 서로 다른 학습 의도이므로 그대로 보존한다. checker는 8개 scenario, 45개
compiler/WASM frame에서 정상 순서, held START, 피드백 소실·모순, 허가 상실 및
열림·닫힘 무응답을 확인한다. 이는 논리 명령의 virtual evidence이며 밸브 이동·펌프
회전·유량의 physical acceptance가 아니다.

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
`phase` 전이와 출력 식에 명시하고 checker의 trace tests로 검증했다. 그러므로
`require`만으로 입력 안전 정책 전체를 표현한다고 해석하지 않는다.

`tools/check-pc-10.mjs`는 16개 scenario, 91개 frame에서 정상 순서, 정상 STOP,
fault latch, 원인 해제 전 RESET 거절, RESET release/repress, secondary live fault
차단, fresh START, 저수위 orderly close, timeout 경계와 원인 우선순위를
compiler/WASM virtual trace로 확인한다. 이 PASS는 코드 실행의 논리 증거이지 Web UI,
MCU upload, 접촉기 에너지 차단, 밸브 이동, 펌프 회전의 physical acceptance가 아니다.

| 항목 | checker 출력 |
|---|---|
| expectations SHA-256 (91 frames) | `e2364399f1f4d3d7786958e25bc4e1db59ac39cc058c4985006d23b2c66584de` |
| checker SHA-256 | `2b2966b9a5add77b652368e253b50020928ade84b074af7afee3b7741605f3fd` |
| source SHA-256 | `3de1cb4fab6125e27776b15e3bbdf48b5f7fd252b8b3a052f8222745330424d4` |

컴파일러·literate extractor·WASM adapter의 공통 해시는 과정 증거 문서의 PC-10
기록을 따른다. 예제 자체는 이 책에 복제하지 않고 canonical literate 원본으로
안내한다.

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

**함께 볼 질문 R03:** `running` / `running'` 구분은 충분히 잘 보이는가?
출력은 이전 값과 다음 값 중 무엇을 읽는지 명시하는 현재 방식이 이해하기 쉬운가?

<a id="ch04"></a>
## 4. 출력 의도와 최종 출력

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

**함께 볼 질문 R04:** `require`와 `mutex`를 모두 유지할까?
같은 제약의 두 표현을 제공할지, 기본 표현을 하나로 좁힐지 함께 검토한다.

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

**함께 볼 질문 R05:** 함수가 사용하는 값을 모두 인수로 전달하는 규칙이 적절한가?
짧은 계산의 가독성과 의존 관계의 명시성 사이에서 어느 쪽을 우선할까?

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

  phase' = case phase {
    Idle => if start then Waiting else Idle;
    Waiting =>
      if !start then Idle
      else if age >= delay then Running else Waiting;
    Running => if start then Running else Idle;
  };

  motor <- phase' == Running;
}
```

`type Phase = ...`는 이름 있는 유한 상태들의 타입이다.
`case phase`는 현재 단계에 해당하는 식을 골라 다음 단계를 계산한다.
모든 경우를 적어야 하며 `if`의 두 결과는 같은 타입이어야 한다.

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
가상 환경에서는 시뮬레이션 Driver가, ESP32에서는 실시간 Driver가 그 경계를 구현한다.
프레임과 Driver의 구체 API는 호스트 계약이며 이 소스에 플랫폼 분기를 넣지 않는다.

**작은 실험:** 2999ms 다음 tick을 3500ms로 옮겨 보자. 모터는 그 tick에서 켜진다.
타이머 조건은 2초지만 관찰과 전이는 tick 시점에서 이루어진다.

**함께 볼 질문 R06:** `elapsed(phase)`의 리셋 기준이 자연스러운가?
“조건이 유지된 시간”과 “상태가 유지된 시간”을 문법에서 어떻게 구별해 읽을까?

<a id="ch07"></a>
## 7. 시각에 맞추어 시작하기

### E09 — 하루의 두 시각에 5분 운전하기

```ghost
// E09
control ScheduledPulse {
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 18:45];
  }
  config run_time: Duration = 5min;
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

`DailySlots<15min>`은 하루를 15분 격자의 시각으로 선택한다.
현재 지원하는 격자는 15분이고 시각 중복이나 격자 밖의 시각은 거부한다.
`starts.due`는 호스트가 시간표에서 이번 시작 사건을 계산해 공급하는 Bool 값이다.
시작 사건은 `true`를 한 번 읽는 것으로 생각하면 된다.

| 사건 | 이전 단계 | 다음 단계 | pump |
|---|---|---|---|
| 선택된 시작 사건 | Idle | Watering | true |
| 5분 미만 경과 | Watering | Watering | true |
| 5분 이상 경과한 첫 tick | Watering | Idle | false |

`in {Watering}`은 집합에 포함되는지 검사한다. 상태가 여러 개면
`phase' in {Opening, Watering, Closing}`처럼 같은 타입의 값들을 나열할 수 있다.

이 소스에는 대기열이 없다. 이미 Watering일 때 다른 시작 사건이 와도 저장하지 않는다.
시계 보정, 재부팅 이후의 중복 억제, 일일 사용 한도는
[시간표·제약 계약](CONSTRAINTS.md)의 호스트 처리와 연결된다.
같은 예제를 재생할 때는 단조 경과 시각과 시작 사건의 기록을 모두 보존한다.

**작은 실험:** Watering 도중 `starts.due=true`를 다시 공급한다면 종료 시각이
뒤로 밀릴까? 답은 코드에서 Watering 분기가 무엇을 읽는지에 있다.

**함께 볼 질문 R07:** 시간표를 소스의 `schedule` 설정으로 읽는 방식은 적절한가?
15분 격자라는 현재 범위를 언어 전체의 영구 제한으로 둘지는 별도로 검토한다.

### 다음 설계 — 달력과 해를 기준으로 제어하기

시간에는 네 가지 서로 다른 의미가 있다.

| 의미 | 예 | 언어에서의 역할 |
|---|---|---|
| 특정 시점 | 2026-09-12 09:00, Asia/Seoul | `DateTime` 기본 값 방향 |
| 시간 길이 | 5분 동안 | 기존 `Duration` |
| 반복 일정 | 매일 06:00 | 날짜별 시작 사건을 만드는 일정 |
| 기준 시점의 전후 | 일출 1시간 후, 일몰 30분 전 | 기준 사건의 시각과 전후 간격의 조합 |

“매일 일출 1시간 뒤에 관수를 시작해서 5분간 운전한다”를 생각해 보자.
그날의 일출로 시작 시각을 정하고, 시작한 뒤에는 5분의 경과 시간을 잰다.
일출·일몰 전후는 기준 사건의 시각에 `Duration`을 더하거나 빼는 조합으로 설계한다.
타입·문법·연산의 구체 계약은 R15에서 검토한다.

설계 제안에서는 시각을 정한 해상도의 정확한 정수 단위로 다룬다. 달력 시계는
날짜·시간대와 일정 판단에, 단조 경과 시계는 타이머에 쓴다. 달력 시각을 보정해도
이미 흐른 운전 시간이 되돌아가지 않게 한다.

일출·일몰 기준시각은 호스트 Driver가 날짜·위치와 시간대에 맞춰 공급한다.
같은 값과 사건 기록으로 WASM과 ESP32가 같은 제어 판단을 재현하도록 한다.
날짜 경계를 넘는 전후 간격, 시계 보정에 따른 중복·누락, 기준시각을 구할 수 없는
경우의 처리도 이 계약에 포함한다.

현재 타이머 배속 계약은 경과 시간을 가속한다. 가상 날짜·위치를 지정해 하루의
달력 일정과 일출·일몰 제어를 빠르게 재생하는 기능은 다음 확장 설계다.

### 공동 검토 — 일정 자체를 합성 타입으로

사용자는 “해뜨고 한시간후부터 5분간”을 하나의 composite type으로 표현하고 Schedule을
타입 값으로 볼 수 있는지 제안했다. 시작 기준(일출 + 1h)과 기간(5min), 발생/날짜 규칙,
위치·시간대와 필수 fallback을 한 선언적 일정 값으로 묶는 후보를 검토한다.
값의 선언과 실제 운전은 구분한다. 제어의 상태·허가·전역 제약이 최종 출력을 정한다.

‘오늘 한 번’인지 ‘매일’인지는 문장에 없는 채로 확정하지 않는다. 5분도 예정 시간창인지,
운전 단계에 들어간 후의 경과시간인지 구분해야 한다. 예를 들어 07:00 예정에서 07:02로
시작이 늦어지면 전자는 07:05 종료, 후자는 지연을 허용한 경우 07:07 종료다.
[시간 타입 후보 §10](design/TIME-SYNTAX-CANDIDATES.md#10-검토-후보--schedule을-합성-타입의-값으로-보기)에서
의미와 표기를 함께 검토한다. 현재 구현된 Schedule 값 문법이나 확정된 운전 정책은 아니다.

### 다음 설계 — 조석을 기준으로 제어하기

양어장에서는 달을 기준으로 한 시간뿐 아니라 지역의 만조·간조와 조차의 상태를
제어 기준으로 사용할 수 있다. 만조와 간조는 개별 기준시각 사건으로 취급하고,
예측된 `DateTime`과 사건 전후의 `Duration`을 조합한다. 사리와 조금은 조차 주기의
기간 또는 상태 조건으로 취급하므로, 특정 시각값인 만조·간조와 구분한다.

달의 위상(삭·망 등)과 지역 조석은 같은 정보가 아니다. 달 위상만으로 현장의
만조 시각을 결정하지 않으며, 하루에 반드시 두 번 발생한다거나 매일 같은 시각에
발생한다고 가정하지 않는다. 지역별 조석 예측과 갱신 시점은 Driver가 공급하고,
예측의 작성·대상 시각과 실측의 관측 시각을 각각 출처와 함께 기록한다.

설계에서는 앞서 제안한 `DateTime`과 기존 `Duration`에 사건·조건을 조합한다.
최종 출력에는 기존 전역 constraints를 적용한다.

| 제품 설명용 예시 | 설계상 읽기 |
|---|---|
| 예측 만조 30분 전부터 10분 동안 취수 | 만조 사건 − `Duration`에서 시작, `Duration`으로 종료 |
| 조금 기간에는 별도 환수 일정 | 조차 상태/기간 조건과 일정 조건의 조합 |
| 취수 시작 조건과 현장 수위·수질 조건을 함께 판단 | 사건 조건과 센서 조건을 함께 평가 |

위 문장들은 제품 설명용 예시이며 현장 운전 규칙으로 확정하지 않는다. 구체적인
선택 문법(다음·첫 번째·모든 만조), 조금·사리의 분류 기준, 예측 갱신 때 사건이
중복 발생하는 처리 방식은 R16에서 검토한다. 현재는 조석 기준 제어를 구현하지
않았다.

### 확정 요구 — 자연 기준 표기와 필수 fallback

GhostFlow 언어는 `sunrise`, `sunset`, 만조·간조의 전후, 사리·조금 조건을
소스에서 직접 의미가 드러나는 기준으로 표현해야 한다. 언어가 그 기준의 의미와
실패 경로를 알 수 있어야 하며, Driver가 이미 계산한 Bool 하나만 소스에 보여 주는
방식은 이 요구를 충족하지 않는다. 계산과 데이터 공급은 Driver가 맡되, 언어와
컴파일러는 기준 사건, 품질, 실패 시 동작을 검증할 수 있어야 한다.

자연 기준을 쓰는 규칙에는 fallback을 반드시 명시한다. fallback이 빠지면 컴파일
오류로 거부하는 것이 구현할 규칙이다. 현재 parser는 이 문법과 검사를 구현하지
않았다. 실패 사유에는 위치가 없거나 유효하지 않음, 현재 시각의 NTP 동기화 실패
또는 시각 신뢰 기한 만료, 조석 예측이 없거나 예측 유효 기한 만료, 해당 날짜에
기준 사건이 발생하지 않음이 포함된다. 위치는 별도 설치 설정으로 공급할 수 있고
NTP가 위치를 제공하지는 않는다. 따라서 시각 신뢰뿐 아니라 위치 유효성과 예측
유효성도 함께 확인해야 한다.

NTP는 기본 동기화 수단이다. 네트워크 단절과 시각 신뢰 상실은 구분한다. 마지막
동기화 뒤 내부 시계로 계속 운전할 수 있는지는 허용 기간과 오차를 정해 판단한다.
이 허용 정책은 아직 미결정이며, 명시 없이 단절 후의 계속 운전을 허용하지 않는다.

| 상태 | fallback 설계 예 | 적용 조건 |
|---|---|---|
| 시계 정상, 조석 예측 없음 | 소스가 명시한 고정 시각으로 대체 가능 | 대체 일정의 시간대·시각 전제도 충족 |
| 시계를 모름 | 고정 시각 대체도 불가; 새 시작 보류 또는 시간 독립 동작 | 새 시작 보류는 진행 중 출력 OFF와 다름 |
| 신뢰·데이터 회복 | 실행 기록으로 중복을 막고 누락 사건의 처리 정책을 적용 | 몰아 실행을 암묵적으로 허용하지 않음 |

기존 단조 `timer`와 전역 `constraints`는 계속 적용한다. fallback은 검증과 제약을
우회하지 않으며, 명시적으로 센서나 수동 입력에 의존하는 규칙도 별도 검증해야
한다. `sunrise + 1h` 같은 표현과 fallback 선언의 구체적인 표기는 R17에서 검토한다. 시스템 시계와
NTP 주기 동기화의 참고는 [ESP-IDF 시스템 시간 문서](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/system_time.html)다.

이 요구는 위치·현재 시각(NTP 동기화)과 자연 기준 표기를 언어 차원에서 지원하는
것으로 확정한다. 구체적인 표기, fallback 범위, 시간 단절의 유예·오차, 회복 시
중복 방지·누락 사건 처리 정책은 R17에서 검토한다.

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
실행 기록에 남는다. `ok`와 `fault`는 현재 센서·신호 case의 패턴이고 범용 Result
생성자를 제공한다는 뜻은 아니다.

### E14 — 선택적인 센서

```ghost
// E14
control OptionalMoisture {
  sensor moisture?: Percent;
  output request: Bool;

  request <- case moisture {
    ok(value) => value < 30%;
    fault(_) => false;
  };
}
```

`?`는 센서가 선택적인 설치 능력임을 나타내는 선언 정보다.
정상값이 공급되면 비교하고, 읽을 수 없는 경우에는 이 프로그램이 선택한 거짓을
사용한다. **미설치와 설치된 센서의 단절을 서로 다른 전략으로 처리하는 `adapt`**는
12장의 검토 주제다. `?` 하나만으로 대체 전략이 생성되지는 않는다.

**작은 실험:** E10의 켜짐·꺼짐 경계를 똑같이 만들면 어떤 문제가 생길까?
판단할 때 원시 측정값과 필터 결과 중 어느 값을 차트에서 봐야 할까?

**함께 볼 질문 R08:** 센서 설정과 계산된 `signal`의 구분이 이해하기 쉬운가?
설정 정보가 없는 단순 센서부터 상세 필터까지 단계적으로 설명할 수 있는가?

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

현재 참조 VM은 `if`, `&&`, `||`를 단락 평가로 실행하지 않는다.
예를 들어 `if b == 0 then 0 else a / b`라고 써도 선택되지 않은 계산의 0 나눗셈을
막는 장벽이 되지 않는다. 현재 실행 방식에서 유효한 입력만 나눗셈에 들어가도록
만들려면 먼저 분모를 고를 수 있다.

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

**함께 볼 질문 R09:** 조건식의 현재 평가 방식이 제어 코드를 읽는 사람의 예상과
맞는가? 특히 fault 회피를 기대하는 표현에서 단락 평가를 도입할지 검토해야 한다.
이 장은 현재 동작을 설명하며 현재 방식을 영구 채택한다는 결정이 아니다.

### E11 — 현재 받아들이는 다른 표기들

구현에는 같은 의미를 나타내는 복수 표기가 있다. 언어를 함께 검토하려면 이들도
숨기지 않고 목록에 올려야 한다.

```ghost
// E11
purefn invert(value: Bool) -> Bool { !value }

control AliasForms {
  input start: Bool;
  enum Mode { Off, On }
  state mode: Mode = Off;
  state running: Bool = false;
  output pump, indicator: Bool;

  next running = input.start || state.running;
  mode' = if start then On else Off;
  pump <- next.running;
  indicator <- ifthenelse(mode' == On, invert(false), false);
}
```

| 본문의 주 표기 | 현재 함께 지원하는 표기 |
|---|---|
| `fn` | `purefn` |
| `type Mode = Off \| On;` | `enum Mode { Off, On }`, `enum Mode = Off \| On;` |
| `running' = ...;` | `next running = ...;` |
| `running'` | 출력식의 `next.running` |
| 입력 `start`, 이전 상태 `running` | `input.start`, `state.running` |
| `if c then a else b` | `ifthenelse(c, a, b)` |

E11에서 start를 참으로 했다가 거짓으로 바꾸면 `pump`는 자기유지되고
`indicator`는 꺼진다. 둘은 서로 다른 상태를 읽고 있기 때문이다.

**함께 볼 질문 R10:** 이 별칭들을 계속 제공할까? 책의 기본 표기를 하나로 정하고
나머지는 호환 표기로 둘지, 문법에서 정리할지 검토한다.

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

이 절은 관찰·비교의 사용 방법과 제품 방향을 설명한다. UI의 버튼 이름이나 완료
상태는 특정 Playground 빌드에 고정하지 않았다. 문법 토론과 화면 구현 상태는
각각 확인할 수 있도록 분리한다.

**함께 볼 질문 R11:** 기본 화면에서 이전 값·다음 값·최종 출력 중 무엇을 항상
보여줄까? 전체 흐름을 유지하면서 어느 정보를 선택했을 때 펼칠까?

<a id="ch11"></a>
## 11. 파일과 literate 프로그램

### 하나의 파일과 하나의 control

현재 control 파서는 최상위 순수 함수들을 읽은 다음 하나의 `control`을 읽는다.
그 뒤에 두 번째 `control`이 있으면 거부한다. 다른 `.ghost` 파일을 읽는
`import`나 `include` 문법도 현재 없다.

이것은 **현재 소스 입력 단위**의 설명이다. 장치 하나에서 여러 control을 관리하려는
제품 의도와는 차원이 다르다. 다음 장에서 장치·control·파일을 구분한다.

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

일반 `.md` 문서, `text` 코드 블록, 목록·인용 안의 중첩 실행 블록은 같은 방식으로
자동 실행하지 않는다. 상세한 추출 규칙은 [LITERATE.md](LITERATE.md)에 있다.

### 파일 트리와 프로그램 연결은 다른 기능이다

에디터가 여러 파일을 보여주는 것만으로 그 파일들이 서로 참조되지는 않는다.
어느 파일을 실행 대상으로 삼는지, 다른 파일을 어떤 이름과 범위로 가져오는지는
언어와 프로젝트의 별도 계약이다. 현재 동작을 기준으로 작성한 예제는 각각 독립된
소스로 컴파일한다.

**함께 볼 질문 R12:** 한 control을 여러 파일로 나누려면 파일 단위로 가져올까,
함수·타입 같은 이름 단위로 가져올까? 먼저 필요한 공유 사례를 적고 최소 구문을 고르자.

<a id="ch12"></a>
## 12. 하나의 장치, 여러 control

### 먼저 구분할 세 단위

| 단위 | 이 책에서의 의미 |
|---|---|
| device | I/O와 실행 자원을 가진 장치, 여러 control을 관리하는 작업공간 |
| control | 이름 있는 제어 프로그램. 다른 control을 유지하며 추가할 수 있어야 하는 단위 |
| source file | 코드를 저장하는 파일. 현재 파서는 한 소스에서 하나의 control을 읽음 |

여러 control이 필요한 이유는 이미 명확하다. 기존 밸브들을 제어하는 프로그램을
유지하면서 새 밸브의 제어를 추가하고 싶기 때문이다. 이 요구는
[GF-INT-001](INTENT-REGISTER.md#gf-int-001--device-workspace와-독립-control)에 기록돼 있다.

공유 펌프가 있으면 각 control이 제멋대로 펌프를 덮어쓰는 방식으로는 충분하지 않다.
각 제어의 요청을 모으고 설비 전체의 제약을 적용해 최종 출력을 결정해야 한다.

```text
control A의 관수 요청 ─┐
                     ├─ 공유 설비의 허가·한도 ─→ 장치 최종 출력
control B의 관수 요청 ─┘
```

기존 [CONSTRAINTS.md](CONSTRAINTS.md)는 이름 있는 제약, 공유 station, 운전 모드,
일일 한도 등을 다룬다. 일부는 별도 policy 컴파일과 호스트 실행 경계에 있다.
이를 일반 `control { ... }` 안에서 모두 쓸 수 있다고 합쳐 설명하지 않는다.

### 이번 초고에서 아직 문법을 확정하지 않는 부분

- 여러 파일의 함수·타입을 참조하는 구문과 이름 충돌 규칙.
- 한 파일에 여러 control을 넣을지, 각각 별도 파일로 둘지.
- 공유 자원의 요청과 장치 전체 제약을 소스에서 연결하는 일관된 표기.
- 선택적 장치 능력을 기준으로 계산 전략을 고르는 `adapt`와 `has` 표기.

`adapt`, `constraints`, `check`, `limit`를 control 본문에 넣는 현재 파서는 거부한다.
특히 `constraints`는 별도 표면 문법이 있으므로 “언어 전체에 제약 기능이 없다”와
혼동하지 않는다. 이 초고의 실행 예제 범위는 control 표면 문법이다.

**설계 원칙:** 기존 제어를 보존하며 독립 제어를 추가하고, 전역 제약은 추가된
제어에도 적용한다. 이 제품 의도는 유지하면서 실제로 필요한 최소 연결 문법을
함께 고른다.

**함께 볼 질문 R13:** 첫 다중 control 예제를 “기존 두 밸브에 새 밸브 하나 추가”로
잡으면 공유 관계와 전역 제약을 충분히 검토할 수 있을까?

<a id="appendix-a"></a>
## 부록 A. 문법·키워드 색인

이 표의 기준은 현재 저장소의 `tools/control.mjs`와 관련 구현 계약이다.
**본문 예제로 사용함**, **짧은 참조 예만 있음**, **후속 검토**를 구분한다.
문법 전체의 조합을 모두 시험했다는 뜻은 아니며, 별도 constraints 문법의 전수 색인은
후속 편집 범위다.

### 선언과 제어 표기

| 표기 | 뜻 | 본문 예제 / 상태 |
|---|---|---|
| `control` | 프로그램 범위 | E01부터 |
| `input` | 매 tick 입력 | E01, E02 |
| `output` | 출력 타입 선언 | E01, E12 |
| `state` | 기억하는 값과 초기값 | E03, E04 |
| `config` | 컴파일하는 설정값 | E02, E08 |
| `let` | 순수 계산에 이름 붙이기 | E02, E10, E13 |
| `fn` | 순수 함수 | E07 |
| `purefn` | 같은 함수 선언의 다른 표기 | E11 |
| `type` | 유한 enum 타입 정의 | E08, E09 |
| `enum` | enum 정의의 다른 표기 | E11; `enum M = A \| B;`는 짧은 참조 예 |
| `sensor` | 값과 품질을 가진 측정 입력 | E10, E14 |
| `signal` | 센서에서 계산하는 상태 있는 신호 | E10 |
| `schedule` | 시작 시각 설정 | E09 |
| `timer`, `elapsed` | 상태 변경 뒤의 경과 시간 | E08, E09 |
| `require` | 출력 간 제약 | E03, E05 |
| `mutex` | 동시 출력 요청 차단 | E06 |
| `next` | 다음 상태의 대입·참조 별칭 | E11 |
| `if`, `then`, `else` | Bool로 두 값 중 선택 | E08, E13 |
| `case` | enum 또는 센서/신호 결과 분기 | E08, E10 |
| `ok`, `fault` | 센서/신호 case 패턴 | E10, E14 |
| `in` | 같은 타입 값 집합의 포함 검사 | E09 |
| `true`, `false` | Bool 리터럴 | E03, E10 |
| `adapt` | 능력에 따른 전략 선택 | 12장, control 미구현 |
| `constraints`, `check`, `limit` | 공통 정책 관련 표기 | 12장과 별도 계약; control 본문 미지원 |
| `has` | 능력 존재 검사 스케치 | 12장, 확정된 실행 구문 없음 |

### 기호, 값, 내장 기능

| 표기 | 쓰임 | 예 / 위치 |
|---|---|---|
| `{ }` | control·함수·case·설정 블록, `in` 집합 | E01, E07~E11 |
| `;` | 선언·식 정의 끝 | E01부터 |
| `:` | 이름의 타입, 내장 기능의 이름 붙인 인수 | E01, E10 |
| `,` | 이름·인수·집합 원소 구분 | E03, E07, E09 |
| `=` | 정의·초기값 | E02~E04 |
| `'` | 다음 상태 정의·참조 | E03, E04 |
| `<-` | 출력 연결 | E01부터 |
| `->` | 함수 결과 타입 | E07 |
| `=>` | 제약 관계 또는 case 분기 | E05, E08 |
| `!`, `&&`, `||` | Bool 계산 | E03 |
| `+`, `-`, `*`, `/`, 단항 `-` | 수치 계산 | E12 |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | 비교 | E12 |
| `( )` | 식 묶음과 함수 호출 | E03, E07 |
| `\|` | enum 후보 나열 | E08 |
| `?` | 선택적 센서 표시 | E14 |
| `.` | 허용된 입력·상태 참조와 `.due` | E09, E11 |
| `..` | 센서 유효 범위 | E10 |
| `[ ]` | schedule의 선택 시각 목록 | E09; 범용 배열 문법은 아님 |
| `//` | 줄 끝까지의 주석 | 모든 예제 ID |
| `_` | fault 패턴에서 쓰지 않는 바인딩 | E10 |
| `Bool`, `Number`, `Percent`, `Duration` | 기본 타입 | 2장, E02, E08, E12 |
| `30%`, `2s`, `5min` | 타입이 있는 수치 리터럴 | E02, E08, E09 |
| `250ms`, `1h` | 다른 시간 단위 | 2장의 짧은 참조 예 |
| `DailySlots<15min>`, `timezone`, `selected`, `.due` | 시간표 설정과 시작 사건 | E09 |
| `sample`, `valid`, `filter`, `stale_after`, `recover_after`, `samples` | 센서 설정 | E10 |
| `median(n)` | 홀수 1~31개 측정의 중앙값 필터 | E10 |
| `hysteresis`, `on_below`, `off_above`, `initial` | 건조 판단의 두 경계와 초기값 | E10 |
| `ifthenelse` | 조건식의 함수형 별칭 | E11 |

내장 기능과 설정 이름을 모두 일반 예약어로 취급하지는 않는다. 실제 예약어 집합과
각 위치에서 허용되는 구문은 파서가 결정한다. 별칭·설정 키·기호까지 함께 실은 이유는
사용자가 키워드 목록만 보고 문법의 나머지를 놓치지 않게 하기 위해서다.

### 세미콜론의 자리

`input`, `output`, `state`, `config`, `let`, 다음 상태 대입, 출력 연결, `require`,
`mutex`, `signal`, `timer`, `type X = ...`의 끝에는 `;`가 필요하다.
센서의 블록 없는 선언과 설정 블록 내부 항목도 마찬가지다.
함수 본문의 마지막 식, 함수 닫는 중괄호 뒤, case 분기 끝에는 선택적으로 붙일 수 있다.
이 예제집에서는 선언을 일관되게 끝내고 함수의 마지막 값은 식으로 읽는 표기를 사용했다.

배열·리스트 타입, 문자열 연산, 반복문 `for`/`while`, 가변 지역 대입문, `return`,
일반 ADT, 고차 함수, 재귀, 매크로, `import`/`include`는 이 control 구현의 지원 목록에 없다.
주기적인 반복은 호스트가 tick을 공급하며 일어난다.

<a id="appendix-b"></a>
## 부록 B. 오류로 배우기

아래 예제는 각각 독립적으로 컴파일하면 거부되어야 한다.
오류를 내는 프로그램의 작은 차이를 읽으면 문법의 경계가 선명해진다.

### E90 — 세미콜론 누락

```ghost-error
// E90
control MissingSemicolon {
  input start: Bool
  output pump: Bool;
  pump <- start;
}
```

줄바꿈은 선언의 끝이 아니다. `Bool` 뒤에 `;`를 추가한다.

### E91 — 다른 타입을 비교하기

```ghost-error
// E91
control MixedTypes {
  input level: Number;
  output pump: Bool;
  pump <- level < 30%;
}
```

입력 타입과 비교값의 단위를 맞춘다. 수위를 백분율로 다룬다면 `level: Percent`가 된다.

### E92 — 다음 상태를 다른 상태 전이에 사용하기

```ghost-error
// E92
control NextDependency {
  state a: Bool = false;
  state b: Bool = false;
  output lamp: Bool;
  a' = !a;
  b' = a';
  lamp <- b';
}
```

다음 상태 참조는 출력식에서만 허용한다. 공통 계산에 이름을 붙이거나 이전 상태를 읽는다.

### E93 — 한 소스에 두 control

```ghost-error
// E93
control First { output lamp: Bool; lamp <- false; }
control Second { output lamp: Bool; lamp <- true; }
```

현재 파서는 하나의 control 뒤에서 소스가 끝나기를 기대한다. 다중 control의
파일·프로젝트 구성을 검토하는 문제는 이 구문 오류와 별도로 다룬다.

### E94 — 아직 없는 import

```ghost-error
// E94
import "helpers.ghost";
control Main { output lamp: Bool; lamp <- false; }
```

현재 함수는 같은 소스의 최상위나 control 내부에 둔다.

### E95 — 빠진 case

```ghost-error
// E95
control MissingCase {
  type Mode = Off | On;
  state mode: Mode = Off;
  output lamp: Bool;
  lamp <- case mode { Off => false; };
}
```

`On`인 경우도 표현해야 한다. 모든 경우를 다루면 새로운 enum 값을 추가했을 때
어디를 검토해야 하는지도 컴파일 단계에서 드러난다.

### E96 — 하나의 출력을 두 번 연결하기

```ghost-error
// E96
control DuplicateOutput {
  output lamp: Bool;
  lamp <- false;
  lamp <- true;
}
```

각 출력에는 정확히 하나의 연결식이 필요하다. 나중 문장이 앞의 문장을 덮어쓰지 않는다.

### E97 — 센서 품질을 처리하지 않기

```ghost-error
// E97
control BareSensor {
  sensor moisture: Percent;
  output pump: Bool;
  pump <- moisture < 30%;
}
```

`case`의 `ok`와 `fault`로 읽은 뒤 판단한다. E14가 대응하는 작은 정상 예제다.

<a id="appendix-c"></a>
## 부록 C. 공동 검토표

실행할 작업·선행 관계는 [수치·시간 작업 색인](intent/NUMERIC-TIME-TASKS.md),
사용자가 검토할 항목은 [언어 질문지](questions/ghostflow-language.md)에서 관리한다.
이 표는 책의 검토 위치 색인이며 작업의 현재 상태는 연결된 GitHub 이슈가 기준이다.
R01~R13을 모두 구현 미완료 또는 사용자 답변 필수로 해석하지 않는다.

이 표는 새 요구사항을 확정한 목록이 아니라, 책을 읽으며 의견을 남길 위치다.
한 번에 하나를 검토하고 결정·이유·영향받는 예제를 함께 남긴다.

| ID | 검토할 내용 | 위치 | 현재 상태 |
|---|---|---|---|
| R01 | `=`와 `<-`의 구분 | 1장 | 의견 대기 |
| R02 | 세미콜론·중괄호·들여쓰기 | 2장 | 의견 대기 |
| R03 | 이전·다음 상태 표기와 읽기 범위 | 3장 | 의견 대기 |
| R04 | `require`·`mutex`의 표기와 차단 설명 | 4장 | 의견 대기 |
| R05 | 함수 인수와 외부 값 참조 | 5장 | 의견 대기 |
| R06 | 타이머 시작·리셋 모델 | 6장 | 의견 대기 |
| R07 | 시간표 설정과 격자 | 7장 | 의견 대기 |
| R08 | 센서·signal·fault 표현 | 8장 | 의견 대기 |
| R09 | 조건식과 단락 평가 | 9장 | 의견 대기 |
| R10 | 중복 표기와 호환 별칭 | 9장 | 의견 대기 |
| R11 | 소스 옆 값과 비교 화면 | 10장 | 의견 대기 |
| R12 | 여러 파일의 참조 | 11장 | 의견 대기 |
| R13 | 여러 control과 전역 제약의 첫 예제 | 12장 | 의견 대기 |
| R14 | 정확한 개수의 표현·범위·변환·오버플로 정책 | 2장 | 원칙 합의, 표현 결정 대기 |
| R15 | 날짜시각 표현·연산·시간대·일출일몰 전후 문법·시계 보정 중복과 미발생 정책 | 2·7장 | 언어 지원·fallback 필수 확정, 상세 계약 검토 |
| R16 | 조석 사건·조차 상태·달 위상·예측 갱신·선택 문법·중복 발생 처리 | 7장 | 언어 지원·fallback 필수 확정, 상세 계약 검토 |
| R17 | 자연 기준의 구체 표기·fallback 범위·시간 단절 유예와 오차·회복 정책 | 7장 | 언어 지원·fallback 필수 확정, 상세 계약 검토 |

의견은 예를 들어 “R02: 세미콜론을 생략하고 싶다. 줄바꿈으로 식을 나누되 여러 줄
계산이 헷갈리지 않았으면 한다”처럼 남길 수 있다. 다음 편집에서는 관련 정상·오류
예제를 먼저 나란히 놓고 선택지를 비교한다.

<a id="appendix-d"></a>
## 부록 D. 근거와 예제 검사

### 의도와 명세의 연결

| 책에서 설명한 것 | 기존 근거 |
|---|---|
| 직관적인 제어, 코드·데이터 함께 관찰 | [DESIGN-NOTES](DESIGN-NOTES.md), 사용자 선호 |
| 중괄호·prime·출력 연결·literate | [DESIGN-NOTES](DESIGN-NOTES.md#후속-선택-control--literate), [LANGUAGE-SURFACE](LANGUAGE-SURFACE.md) |
| 이전 상태 → 다음 상태 → 출력 의도 → 제약 | [LANGUAGE](LANGUAGE.md), [구현](IMPLEMENTATION.md) |
| 기존 control 유지와 공유 설비 | [DESIGN-NOTES](DESIGN-NOTES.md#후속-요구-공유-설비-인터록-선택-정보), [INTENT-REGISTER](INTENT-REGISTER.md) GF-INT-001 |
| 개수는 정확한 정수, 측정값은 도메인 허용 오차의 근삿값 | [INTENT-REGISTER](INTENT-REGISTER.md) GF-INT-EXACT-COUNTS-APPROXIMATE-MEASUREMENTS |
| 날짜시각·solar 기준 사건과 지속시간의 조합 방향 | [INTENT-REGISTER](INTENT-REGISTER.md) GF-INT-CALENDAR-AND-SOLAR-TIME |
| 달을 기준으로 한 조석 제어와 양어장 적용 의도 | [INTENT-REGISTER](INTENT-REGISTER.md) GF-INT-TIDAL-AQUACULTURE-CONTROL; [NOAA 조차 설명](https://oceanservice.noaa.gov/facts/springtide.html), [NOAA 조석 FAQ](https://www.tidesandcurrents.noaa.gov/faq.html) |
| 자연 기준 표기·위치/현재시각·필수 fallback | [INTENT-REGISTER](INTENT-REGISTER.md) GF-INT-NATURAL-TIME-EXPLICIT-FALLBACK |
| 문서형 소스의 추출 | [LITERATE](LITERATE.md) |
| 센서·시간표·공통 정책 | [CONSTRAINTS](CONSTRAINTS.md) |
| 사용법 설명을 통한 설계 검토 | [PiL 서문](https://www.lua.org/pil/p1.4.html) |

저장소에는 일부 미커밋 변경이 있으므로 아래 검사는 릴리스 번호 전체에 대한
보증 대신 **이번 초고와 현재 체크아웃의 예제 검사**로 기록한다. 언어 구현은 이 책을
만들기 위해 변경하지 않는다.

```sh
node tools/check-programming-in-ghostflow.mjs
node tools/check-programming-in-ghostflow.mjs --runtime
```

첫 명령은 책의 독립 `ghost` 예제를 컴파일하고 `ghost-error` 예제의 거부를 확인한다.
두 번째는 기존 WASM 파일로 선택한 제어 시나리오를 실행해 기대 출력을 검사한다.
새 제어 엔진을 만들어 예제 결과를 흉내 내지 않고 저장소의 컴파일러·런타임을 사용한다.

E15는 검사기가 바깥 Markdown 예제에서 두 literate 블록을 추출한 뒤 별도로 컴파일한다.

### 초고 0.1 검사 결과 · 2026-09-12

| 검사 | 결과 |
|---|---|
| 독립 정상 프로그램 E01~E14 | 14개 컴파일 성공 |
| 문서형 프로그램 E15 | literate 추출 및 컴파일 성공 |
| 오류 프로그램 E90~E97 | 8개 모두 해당 오류 이유로 거부 |
| WASM 실행 시나리오 | 정상 프로그램 14개에 각각 대응하는 14개 시나리오 통과 |
| 파서 예약어 색인 | 예약어 집합의 31개 항목 모두 부록 A에 수록 |
| 문서 내부·로컬 링크 | 38개 파일·앵커 연결 확인 |

WASM 시나리오는 NO·NC raw 접점을 같은 `switch_on` Bool 의미로 정규화한 뒤의
초기 OFF→누름→해제 스위치 추종, 임계값 경계, 자기유지, 동시 상태 갱신, 제약 적용
전후 출력, 방향 인터록, 함수의 정지·재허가, 타이머 경계, 시작 사건, 센서 중앙값,
미수신 센서, 산술·비교, 0 분모 대체, 별칭 표기를 확인한다.
시간표에는 `due` 사건을, 센서에는 명시적인 측정 샘플을 공급했다.
달력의 시각 계산과 물리 센서 수집은 이 검사에서 실행하지 않는다.
E15는 컴파일 확인이며 별도 WASM 시나리오 수에는 포함하지 않았다.

검사에는 기존 `target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm`을 사용했다.
사용한 파일의 SHA-256은 다음과 같다. 소스를 바꾸거나 WASM을 다시 빌드하면
위 명령으로 결과를 다시 확인한다.

```text
tools/control.mjs
e436f86979a41ab9de9163bacd387febf29326aea590dcbe9d3d6384c398848d
tools/gfb1.mjs
993d54eb293f67a398abb34d478a4f064adb6e962c7bcddeb34b589d1dfcd3b2
runtimes/wasm/control-runtime.mjs
0a4516d2c9034dc65cf9eba729ee3504036850d266e366b2ca40aecb5967964f
target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm
3574f4d4d551e14f8a1b880219b25783f70747071e098f6b38c4e60e7df27d22
```

### 다음 편집의 범위

1. R01부터 R17까지의 검토 항목 중 미결정 항목을 사용자와 하나씩 검토한다.
2. 센서 준비·오류·복구와 schedule의 실행 기록을 더 자세한 표로 확장한다.
3. 여러 control·전역 제약의 실제 연결 문법을 별도 예제로 정리한다.
4. 짧은 참조 예만 있는 표기와 경계값 사례를 실행 가능한 예제로 보강한다.

이 초고를 **같이 읽고 수정할 수 있는 구체적인 출발점**으로 삼는다.
검토한 결정과 이유, 바뀐 예제는 다음 판에 함께 반영한다.
