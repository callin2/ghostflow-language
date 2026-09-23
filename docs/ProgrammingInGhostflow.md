# Programming in GhostFlow

전기 제어를 코드로 읽고, 실행하고, 설명하기

**사용 안내서 · Language Reference 2026-09-22 문법 기준**

## 이 문서의 역할

GhostFlow는 센서와 사용자 입력으로부터 상태 변화와 장치 출력 의도를 기술하는 반응형 제어 언어다. 이 문서는 처음 프로그램을 읽고 쓰는 학습 경로다. 언어의 규범 문법·타입·평가·시간 계약은 [Language Reference](LANGUAGE-REFERENCE.md)와 각 장의 상세 문서가 기준이다. 코딩 상황별 답은 [GhostFlow Coding FAQ](language_faq.md)를 참조한다.

Reference와 이 문서가 다르면 Reference를 따른다. 이 문서의 예제는 현재 명세에서 선택된 표기와 의미를 보여 준다. 구현 완료 여부, 런타임 가용성, 보드 배포 가능성을 주장하지 않는다. 변경된 문법은 Reference에 먼저 반영하고 이 사용 안내서의 예제를 맞춘다.

### 읽는 방법

- 각 `ghost` 예제는 독립 프로그램이다. 한 파일에 모두 이어 붙이지 않는다.
- 실제 프로그램은 완전한 `.ghost.md` 문서다. 최상위 `ghost` fence들을 문서 순서대로 합쳐 하나의 control root를 이룬다. 문단과 의도 설명은 소스 문서의 일부로 보존된다.
- 여기서 출력은 논리적 intent다. 물리 GPIO, 릴레이, 센서 수집은 binding과 Driver의 책임이다.
- 정확한 문법은 [Reference 문법 색인](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기)에서 찾는다. 설계 철학은 [Language Reference](LANGUAGE-REFERENCE.md#설계-철학), 계층별 책임은 [Reference 8장](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표)을 본다.

## 목차

### 먼저 실습할 경로 — PLC에서 GhostFlow로

10단계 학습 경로는 버튼·램프에서 시작해 START/STOP, 모터, 인터록, 리미트, 타이머,
수위, Manual/Auto, 순차제어와 고장 복구로 확장한다. 단계별 제어 의도를 언어 예제와
구분해 확인한다.

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

부록: [A. 명세 길잡이](#appendix-a) · [B. 오류로 배우기](#appendix-b)

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
코드를 실행하기 전에 위 표의 출력 세 칸을 먼저 예측해 보자.


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
| `Number` | `3`, `0.5`, `-2` | 일반 수치, 내부 표현은 f64 |
| `Percent` | `30%` | 백분율 값. 리터럴·입력 범위는 0~100 |
| `Duration` | `250ms`, `2s`, `5min`, `1h` | 밀리초 해상도의 비음수 시간 길이 |

`Int`, `Number`, `Percent`, `Duration`은 서로 다른 의미의 타입이다. 예를 들어
`Percent`와 `Number`를 그대로 비교할 수 없다. `Int`는 개수·횟수 같은 정확한 정수고,
`Number`는 측정 등에 쓰는 근사 수치다. 정확한 범위와 변환은
[Reference §2.1–2.3](reference/02-types-expressions-state.md#21-값-종류)을 따른다.

`Duration` literal은 음수가 아닌 정수와 `ms`, `s`, `min`, `h` 단위를 사용한다.
반 초는 `500ms`로 쓴다. 자세한 범위와 연산은 Reference §3.1을 따른다.

`"Asia/Seoul"`은 시간대 설정 문맥에서, `06:00`은 일정 설정 문맥에서 사용한다.
일반 문자열이나 시각 값의 문법과 혼동하지 않는다.

### 정확한 계수와 근사 측정

열매 수나 반복 횟수처럼 세는 값은 정확한 정수여야 한다. 예를 들어 `120 + 1`은
정확히 `121`이어야 한다. 반면 온도 `24.3` 같은 측정 실수는 센서와 도메인이 정한
허용 오차 안의 근삿값으로 다룰 수 있다.

`Int`는 signed 32-bit 범위에서 정확한 값을 보존한다. overflow는 wrap이나 saturation으로 숨기지 않는다.

GhostFlow는 signed 32-bit `Int`로 정확한 계수를 표현한다. 범위 초과와 잘못된
변환은 조용히 wrap하거나 반올림하지 않고 진단 또는 명시적 runtime fault로 처리한다.
측정 실수는 `Number`를 사용한다. 자세한 규칙은 [Reference §2.3](reference/02-types-expressions-state.md#23-정확한-정수-설계)에서 확인한다.

날짜와 시각은 `date`, `time`, `datetime` tagged literal로 쓴다. DateTime에는
시간대 offset이 필요하다. 날짜시각과 단조 경과시간은 서로 다른 의미다.
[Reference §3.1](reference/03-time-and-schedules.md#31-시간값과-시계-영역)을 따른다.

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

`level`은 tick마다 공급되는 입력이다. `threshold`는 `config`로 공개한 조절값이고,
`low`는 두 값을 비교한 계산이다. 기본값을 소스에서 바꾸면 새 문서 revision이 된다.
운영 중 변경은 `access = operator`로 공개한 설정에 한해 typed atomic live event로
적용할 수 있다. 메타데이터 계약은 [Reference §5](reference/05-settings-and-observation.md#51-config-선언)를 따른다.
`let`은 저장해 두는 메모리가 아니라 계산에 붙인 이름이다.

| `level` | `threshold` | `low` / `pump` |
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

**작은 실험:** Watering 도중 `starts.due=true`를 다시 공급한다면 종료 시각이
뒤로 밀릴까? 답은 코드에서 Watering 분기가 무엇을 읽는지에 있다.


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
사용한다. 미설치와 설치된 센서의 단절을 구분하려면 `adapt`와 `strategy`를
선택된 capability 문법으로 표현한다. `?` 하나만으로 대체 전략이 생성되지는 않는다.
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

<a id="ch12"></a>
## 12. 하나의 장치, 여러 control

각 definition은 한 control root를 갖는다. 프로그램 재사용은 import한 control의 instance를 만들고 논리 port를 연결하는 구성으로 표현한다. 같은 물리 resource를 공유할 때는 identity와 resource contract를 명시해야 한다. 최종 장치 효과는 control의 output intent와 물리적 confirmation을 구분한다.

```text
definition revision → import → instance + typed connect
                   → semantic composition → bound runtime
```

`adapt`, capability 검사, 공통 constraints, 공유 resource, replay와 hot replacement는 각자 정해진 위치·타입·계약으로만 쓴다. 문법과 semantic DAG 규칙은 [Reference §6](reference/06-composition-and-replay.md), 장치·Driver·binding의 책임은 [Reference §8](reference/08-language-runtime-and-device-boundaries.md)을 따른다. 일반 `control` 안에서 임의의 별도 policy 언어가 있다고 가정하지 않는다.

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

Language Reference는 규범 기준이다. 이 사용 안내서에서 발견한 상충이나 빠진 예는 해당 Reference 절을 먼저 확인한 뒤 고친다. 문법·의미 변경은 Reference의 문법, 규칙, 이유와 예제를 갱신하고 여기서 학습 경로와 코드를 동기화한다. 구현 상태·테스트 수·해시·지원 보드는 이 사용 안내서에 기록하지 않는다.
