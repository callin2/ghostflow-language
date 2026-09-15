# GhostFlow 선택 문법 · control

상태: 선택한 문법의 유한 부분집합을 구현했다. `adapt` 등 확장 스케치는 미구현이다.
[구현 범위](IMPLEMENTATION.md)와 [실행 튜토리얼](TUTORIAL.md)을 함께 읽는다.
초기 [A/B/C 비교](LANGUAGE-EXAMPLES.md) 이후, 중괄호·수식·출력 연결을 중심으로
한 control 문법을 기본 방향으로 선택하고 literate 형식을 추가했다.

## 중심 표기

| 표기 | 의미 |
|---|---|
| `control Name { ... }` | 제어 프로그램과 배포 단위의 범위 |
| `input start: Bool;` | 호스트가 공급하는 매 tick 입력 |
| `sensor moisture: Percent;` | 측정 payload 타입; 읽기는 정상/오류를 구분 |
| `sensor moisture?: Percent;` | 설치가 선택적인 sensor capability |
| `output pump: Bool;` | 출력 intent 포트의 타입 선언 |
| `state watering: Bool = false;` | tick 사이에 남는 상태와 초기값 |
| `let name = expression;` | 상태를 갖지 않는 계산 |
| `watering' = expression;` | 다음 상태의 정의 |
| `pump <- watering';` | 계산한 출력 의도를 포트에 연결 |
| `require pump => valve;` | 펌프가 참이면 밸브도 참이어야 하는 출력 제약 |

이름은 ASCII 식별자, 타입 이름은 `Bool`, `Percent`, `Duration` 등으로 표기한다.
세미콜론은 선언과 식 정의의 끝이며 중괄호는 범위를 나타낸다. 들여쓰기는 가독성을
위해 사용한다. 코드 주석은 `//`다. 문서 설명은 literate에서 자유롭게 작성한다.

계산에는 `!`, `&&`, `||`, 비교 연산자, 괄호, 일반 함수 호출을 사용한다.
`if condition then a else b`와 `case`는 값을 반환한다. `case`는 모든 경우를
처리해야 한다. `in {A, B}`는 유한한 값 집합의 포함 검사다.

```text
fn latch(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}
```

함수는 순수하며 마지막 식을 반환한다. 현재 정적 인라인 호출과 선언 순서에 독립적인
let 계산을 지원하며 재귀/순환을 거부한다. 고차 함수와 매크로는 후속 확장이다.

## 상태, 센서, 출력

`watering`은 이전 상태, `watering'`은 계산한 다음 상태다. 상태 정의들은 같은
입력·이전 상태에서 계산되고 함께 확정된다. 이전 초안의 `state.watering`과
`next.watering`에 대응한다. 이 단계에서는 다음 상태 참조를 출력식에서만 허용한다.
상태 전이끼리 다음 상태를 읽는 표현은 거부한다.

```text
let water_ok = case low_water {
  ok(low)  => !low;
  fault(_) => false;
};
```

sensor의 선언 타입은 정상 payload이며 실제 읽기는 해당 값 또는 fault다.
fault를 처리해 대체값을 사용해도 원래 입력 오류는 기록한다. input/output 이름은
control 안에서 유일하다. 출력은 타입만 선언하고 같은 이름의 `name <- expression;`
연결을 정확히 하나 둬야 한다. 출력 연결은 이번 tick에 계산할 intent를 정의하며,
선언에 초기값을 쓰거나 연결을 생략할 수 없다.

`require`는 순수 출력 제약이다. 초기 지원 형태는 bool 출력의 requires와 mutex로
제한한다. 예를 들어 `pump => (valve1 || valve2)`는 열린 밸브 의도가 하나도 없으면
펌프를 차단하고, `!(valve1 && valve2)`는 둘 다 요청되면 둘 다 차단한다.
여러 제약은 같은 후보 snapshot에서 차단 집합을 계산하고 반복 적용한다.
임의 논리식의 자동 해결 정책까지 정의한 것은 아니다.

후속 [공통 제약 계약](CONSTRAINTS.md)은 이름 있는 `constraints` 묶음, 모드 진입
인터록, 공유 설비 한도, 중복 예약 방지와 선택적 용량 분석을 정의한다. 위 bool
출력 차단 알고리즘을 모든 제약에 일반화하지 않는다. 같은 설비의 자동·수동·설정
모드는 배타적이며, 운전 조건 변경은 명시적 정지 후 설정 모드에서 적용한다.

센서의 median 필터, 히스테리시스, stale 감시와 복구 조건은 manifest와 Rust 센서
런타임으로 연결한다. 준비 전 `NotReady`를 포함한 품질은 호스트 trace에 남는다.

## 장치 적응과 시간

`adapt`는 확인된 장치 프로파일에서 사용할 계산 방식을 선택한다. 예를 들면
`has moisture`에서만 선택적 센서 moisture를 읽을 수 있다. 설치된 센서의 일시적
fault와 설치되어 있지 않은 경우를 구분한다. 프로파일 교체는 tick 경계에서 한다.
여러 capability 조건이 겹치는 경우의 순위 표기는 추가로 확정해야 한다.

압력·유량 등 장치 부가정보는 모두 선택 사항이다. 기본 제어와 인터록은 이 정보
없이 사용할 수 있다. 선택적 분석 `check`의 정보 부족은 Unknown이며 운전을
차단하지 않는다. 사용자가 해당 분석을 명시적으로 필수 `require`로 지정한 경우에만
검증 성공이 시작 조건이 된다. 세부 구분은 [선택 정보 계약](CONSTRAINTS.md)을 따른다.

`schedule starts: DailySlots<15min>`는 지역 시간대의 하루 96개 시각 중 여러 칸을
선택하는 설정이다. 중복 슬롯과 15분 격자를 벗어난 시각은 거부한다.
`starts.due`는 선택 시각을 지나는 tick에 한 번 발생하는 bool 샘플이다.
일반 시각 진행에서 같은 날짜·슬롯을 중복 발생시키지 않는다. 예제는 부팅 이전의
예약을 소급 실행하지 않으며 운전 중 도착한 예약도 저장하지 않는다.
시계 보정·재부팅 시의 안정적인 발생 ID, 영속 실행 기록, 설비별 누적 시간 제한은
[공통 제약 계약](CONSTRAINTS.md)을 따른다. 일일 한도만으로 중복 방지를 대신하지
않는다. DST와 예약 편집의 세부 슬롯 정규화 규칙은 시간 문법 구현 전에 확정한다.

`timer age = elapsed(phase)`는 phase의 마지막 확정 변경 이후 단조 경과 시간이다.
phase를 바꾼 tick의 확정 시점에 타이머를 0으로 재설정하고, 이후 tick에서 경과
시간을 읽는다. 초기 타이머는 0이며 타이머 내부 상태도 checkpoint/replay 대상이다.
이 선언은 대기 명령이나 별도 실행 스레드를 만들지 않는다.

`2s`, `5min`은 Duration 리터럴이다. 단계 전이는 tick마다 최대 한 번이며, 조건을
만족한 첫 tick에서 다음 단계로 넘어간다. 지연은 요청값 이상이고 정상 운전에서는
tick 해상도의 오차를 갖는다.

## 복사해 읽는 control 예제

다음 중 자기유지와 시간표 예제는 `ghostc`에서 컴파일하며 manifest 호스트에서
실행한다. 마지막 `adapt` 블록은 **미구현 설계 예제**로 컴파일러가 명시적으로 거부한다.
이름과 값은 독자가 한 control의 입력, 상태,
출력 연결을 한곳에서 읽을 수 있도록 최소로 잡았다.

### 정지 우선의 자기유지 control

```text
control LatchingPump {
  input start: Bool;
  input stop: Bool;
  input enabled: Bool;

  output pump, valve: Bool;
  state running: Bool = false;

  // stop과 start가 같은 tick에 오면 stop이 이긴다.
  running' = !stop && enabled && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```

`running`은 이전 tick의 자기유지 상태이고 `running'`이 이 tick에 확정할 값이다.
`start`는 한 tick 펄스여도 다음 tick부터 `running`이 유지한다. `stop`, `enabled ==
false` 또는 둘 다인 tick에서는 `running'`과 두 출력이 모두 false가 된다. 따라서
`start`와 `stop`을 동시에 준 경우에도 재시작하지 않는다.

여기의 `enabled`는 지역 허가 입력이고, 한 줄 `require`는 bool 출력끼리의 관계를
나타낸다. 이 control만으로 자동·수동·설정 모드 전환, 다른 control과의 공유 펌프
사용권, 전체 밸브 수 제한을 구현한 것으로 해석하지 않는다. 그런 설비 범위의 인터록과
중재는 [공통 제약 계약](CONSTRAINTS.md)의 모드 관리자·공유 설비 제약이 담당한다.
피드백 센서, 압력, 유량은 이 기본 예제의 필수 입력이 아니다.

출력 intent의 계산과 실제 출력의 시작·정지·장애 시 안전 상태는 서로 다른 경계다.
GhostFlow VM은 연결식과 safety 제약을 계산해 requested/safe intent를 반환할 뿐이며,
부팅·실패·연결 해제 시 모든 출력을 OFF로 만드는 fail-safe 정책과 적용 시점은
호스트/Driver가 소유한다. `output` 선언의 생략된 초기값을 그런 정책의 표현으로
해석하지 않는다.

### 시간표와 타이머를 읽는 단일 밸브 관수 예제

아래는 [literate 관수 예제](../examples/scheduled-watering.ghost.md)의 시간표/단계 전이에서
읽어야 할 부분을 단일 밸브 control로 줄인 **설계 예제**다. 두 밸브 전체 예제는 링크한
파일에 있으며, 아래에서는 입력 선언·상태 전이·출력 연결을 한곳에서 읽을 수 있다.

```text
control TimedWatering {
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 18:45];
  }

  output pump, valve: Bool;
  type Phase = Idle | Open1 | Water1 | Stop1;

  state phase: Phase = Idle;
  timer age = elapsed(phase);

  phase' = case phase {
    Idle =>
      if starts.due then Open1 else Idle;

    Open1 =>
      if age >= 2s then Water1 else Open1;

    Water1 =>
      if age >= 5min then Stop1 else Water1;

    Stop1 =>
      if age >= 2s then Idle else Stop1;
  };

  valve <- phase' in {Open1, Water1, Stop1};
  pump  <- phase' in {Water1};
  require pump => valve;
}
```

기대 동작은 다음과 같다. 선택한 06:00 또는 18:45 슬롯을 지나는 tick에서만 `Idle`이
`Open1`으로 바뀐다. `Open1`에 들어간 확정 시점에 `age`가 0이 되고, 최소 2초 뒤
`Water1`으로, 다시 최소 5분 뒤 `Stop1`으로 전이한다. `Stop1`도 최소 2초 유지한 뒤
`Idle`로 돌아간다. 각 단계 전이는 tick마다 한 번뿐이므로, 긴 tick 하나가 모든 단계를
한꺼번에 통과시키지 않는다.

이 코드는 시간표/타이머의 정상 운전 경로를 설명하며, 독립적으로 안전한 전체 설비
프로그램을 뜻하지 않는다. `pump`는 Water1 단계에서만 켜고, Stop1 단계에서는 펌프를
끈 채 밸브 정리 시간을 둔다. 외부 Stop, 공유 자원 허가, 중복 발생 억제와 일일 한도는 이
상태 기계에 암묵적으로 들어 있지 않으며 [공통 제약 계약](CONSTRAINTS.md)의 적용
범위를 따른다.

### 선택적 moisture 적응: 문법 미확정 스케치

`examples/scheduled-watering.ghost.md`에는 `adapt` 표기가 없다. 따라서 아래는 완전한
문법이나 실행 계약을 정하는 코드가 아니라, 앞에서 설명한 `has moisture` 보호 범위의
의도만 보이는 **확장 스케치**다.

```text
// 확장 스케치 — 실제 adapt 블록의 표기와 우선순위는 아직 미확정.
// has moisture 보호 범위 안에서만 optional moisture를 읽는다.
has moisture {
  // 정상 moisture 값을 이용해 관수 시간을 조정하는 계산을 둘 수 있다.
  // 일시적 sensor fault는 설치 없음과 구분해 별도로 처리한다.
}

// moisture가 없으면 기본 시간표/타이머 control은 그대로 동작한다.
```

즉 moisture는 설치한 프로파일에서만 활용하는 선택 능력이며, 기본 관수를 시작하기
위해 요구되지 않는다. 수분 값의 필터링·fault·복구 처리는 [센서 계약](CONSTRAINTS.md)을
따르고, `adapt`의 정확한 블록 표기는 후속 범위다. 압력·유량 같은 부가정보도 기본 control에 강제하지
않으며, 고급 분석을 필수 시작 조건으로 만들려면 사용자가 명시적으로 `require`를
추가해야 한다.

## Literate는 같은 언어의 문서형 입력

정식 GhostFlow 입력은 `.ghost.md` literate 문서뿐이다. 하나의 control을 설명 문단
사이의 여러 ghost 블록으로 나눌 수 있으며, 추출된 코드는 같은 타입·실행 모델로
내려간다. 일반 `.ghost` 원자료는 역사적 증거일 뿐 컴파일러 입력이나 fallback이
아니다. 자세한 추출·소스맵 계약은 [LITERATE.md](LITERATE.md)에 있다.

[literate 관수 예제](../examples/scheduled-watering.ghost.md)가 정식 실행 예제다.
현재 control 문법·시간 기능·literate의 참조 구현은 GFB1과 manifest로 실행한다.
미구현 확장은 [구현 경계](IMPLEMENTATION.md)에 구분했다. [0.2 공통 계약](LANGUAGE.md)의 결정론,
오류 기록, 고스트 실행, 모듈 교체 원칙은 이어받는다.
