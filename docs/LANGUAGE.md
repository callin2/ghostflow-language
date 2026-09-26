# GhostFlow language contract · design draft

2026-09-05. 새 언어의 공통 실행 계약을 정의한다.
현재 선택한 작성 문법은 [control 문법](LANGUAGE-SURFACE.md)이며,
[literate 형식](LITERATE.md)으로 같은 코드를 Markdown 안에 작성할 수 있다.
[공통 제약·센서 계약](CONSTRAINTS.md)은 모드 인터록, 선택적 장치 정보,
센서 처리와 시간 한도에 대한 후속 설계 결정을 정의한다.
현재 실행 구현은 control/literate의 유한한 부분집합과 호환 S-expression/GFB1이다.
구현 범위와 재실행 증거는 [구현 계약](IMPLEMENTATION.md), [추적성](TRACEABILITY.md)을 따른다.

아래에는 0.2 설계에서 정한 공통 의미와 A/B/C 표기가 남아 있다. 구체적인 어휘와
소스 형식이 다르면 후속 control/literate 문서를 우선하고, 제약·운전 설정 적용은
후속 공통 제약 계약을 우선한다.
[세 가지 문법 예제](LANGUAGE-EXAMPLES.md)는 초기 비교 기록으로 보존한다.

기존 사양은 [LANGUAGE-MVP-0.1.md](LANGUAGE-MVP-0.1.md)에 그대로 보존했다.
현재 바이트코드는 [GFB1](BYTECODE.md)을 따른다. 센서의 ok/fault 처리, 정적 순수 함수,
문서형 소스는 구현했지만 일반 Result/ADT, 고차 함수 합성, 전략별 입력과 매크로는 미구현이다.

## 1. 언어의 방향

GhostFlow는 센서 입력을 스트림으로 받고, 순수 계산과 명시적인 상태 전이를
조합해 장치에 대한 의도를 만드는 제어 언어다. 현재 장치의 능력에 따라 같은
프로그램 안의 전략을 선택하고, 동일 입력을 다시 실행해 변경 전후를 비교한다.

원본 대화에서 확인한 선호와 이번 설계 판단은
[DESIGN-NOTES.md](DESIGN-NOTES.md)에 구분해 기록했다.

| 선호 | 언어·도구에 반영하는 방식 |
|---|---|
| YAML | 선언의 계층과 `name: type`, 읽기 쉬운 설정 |
| Literate CoffeeScript | 들여쓰기, 간결한 함수, 설명과 실행 코드의 결합 |
| Cypher query | capability 패턴과 명시적인 장치 선택 절 |
| Meta Lua | 구문을 데이터로 다루는 컴파일 시점 확장 |
| 함수형·function-level composition | 순수 함수, 값 전달과 함수 합성 |
| Railway-oriented programming | 정상값과 오류값을 같은 흐름에서 처리 |
| Cycle.js | 입력 Source와 출력 Intent를 Driver 경계로 분리 |
| Observable·marimo·D3.js | 중간 값·상태·변화를 코드 옆에서 관찰 |
| Elm·Rust의 안정성 | 타입·분기·자원 검증, 예측 가능한 실행 기반 |

A안은 YAML 중심 선언형, B안은 Literate CoffeeScript 중심 흐름형, C안은 Cypher
중심 질의형으로 비교했다. 후속 대화에서 중괄호·수식·다음 상태·출력 연결을 중심으로
한 control 문법을 기본 방향으로 선택했다. Literate는 그 문법 위의 소스 형식이다.
아래의 공통 실행 계약은 이 선택에도 적용한다.

## 2. 프로그램 모델

```text
candidate_state = transition(old_state, input_snapshot, selected_strategy)
requested       = intents(old_state, candidate_state, input_snapshot)
safe            = safety(requested, constraints)
```

계산이 성공하면 candidate_state와 safe 결과를 하나의 논리 tick으로 확정한다.
물리 출력의 적용은 이후 호스트 Driver가 맡는다. 논리적 원자성은 여러 GPIO가
물리적으로 동시에 바뀐다는 뜻이 아니다.

| 요소 | 의미 |
|---|---|
| module / version | 안정적인 모듈 ID와 상태 스키마 버전 |
| input | 매 tick에 공급되는 타입 있는 샘플, 의미상 `Signal<T>` |
| state | tick 사이에 유지되는 값과 최초 기본값 |
| 함수 | 순수하고 정적으로 해석할 수 있는 값 변환 |
| strategy | 장치 질의, 전략별 입력, 계산, 전이, 의도 |
| let / with | 상태를 갖지 않는 이름 있는 중간 계산 |
| next | 다음 상태의 정의 |
| output / intent / emit | 타입을 선언하고 정확히 하나의 연결식으로 현재 tick의 capability 출력 intent를 요청 |
| safety | 최종 출력에 적용할 requires / mutex 제약 |

표현식 그래프의 조합 논리 순환은 컴파일 오류다. 피드백은 state처럼 이전 tick
값을 읽는 명시적 경계를 통과한다. next에 정의하지 않은 상태는 유지된다.
같은 전략에서 하나의 상태 또는 출력에 두 정의를 쓰는 것은 오류다.

### 예제: 선택한 문법으로 보는 입력 → 상태 → 출력

아래는 선택한 control 문법의 완결된 소스 예제다. `ghostc`에서 컴파일하며 센서 manifest를
연결한 호스트에서 실행한다. 이 예제의 설치에는 저수위 센서가 있다고 가정하지만 압력·유량 등 부가정보는
입력하지 않는다. 저수위 센서 설치가 모든 프로그램의 공통 필수 조건이라는 뜻은 아니다.

```ghost
fn hold(start: Bool, blocked: Bool, previous: Bool) -> Bool {
  !blocked && (start || previous)
}

control WateringDemand {
  input start, stop: Bool;
  sensor low_water: Bool;

  output pump, valve: Bool;
  state watering: Bool = false;

  let water_ok = case low_water {
    ok(low)  => !low;
    fault(_) => false;
  };

  let blocked = stop || !water_ok;
  watering' = hold(start, blocked, watering);

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

`watering`은 기억, `watering'`은 이번 tick에 확정할 후보, `<-`는 출력 의도다.
함수 `hold` 자체에는 숨은 기억이 없다. 시작·정지는 bool 샘플이며 에지 이벤트가 아니다.

`output name: Type;`은 intent 포트의 타입만 선언한다. 각 출력 이름에는 정확히 하나의
`name <- expression;` 연결이 있어야 하며 선언의 초기값은 허용하지 않는다. 이 연결식은
VM이 이번 tick에 요청하는 논리 intent다. 부팅·계산 실패·호스트 연결 해제 때 출력을 OFF로
유지하거나 적용을 중단하는 startup/fail-safe 정책은 VM intent와 별개로 호스트/Driver가
소유한다. 출력 선언의 기본값으로 안전 정책을 암묵적으로 정하지 않는다.
다음은 초기 watering=false에서 순서대로 입력한 기대 결과다.

| tick | start | stop | low_water | watering' | valve / pump 의도 |
|---|---|---|---|---|---|
| 1 | true | false | ok(false) | true | ON / ON |
| 2 | false | false | ok(false) | true | ON / ON |
| 3 | false | false | fault(Stale) | false | OFF / OFF |
| 4 | false | false | ok(false) | false | OFF / OFF |
| 5 | true | true | ok(false) | false | OFF / OFF |

센서가 복구됐다는 이유만으로 자기유지가 되살아나지 않으며, 시작과 정지가 함께
참이면 정지가 우선한다. 이것은 순수 제어 계산 예제다. 설비 모드 진입·공유 펌프
사용권과 실제 펌프/밸브의 시간차 적용은 [공통 제약 계약](CONSTRAINTS.md)의
설비 관리자·Driver가 담당하며 위 코드만으로 모두 구현한 것은 아니다.

## 3. 어휘와 타입

새 문법의 식별자는 `[A-Za-z_][A-Za-z0-9_]*`이며 대소문자를 구분한다.
점은 `input.start`, `state.watering`, `next.watering` 같은 경로 구분자다.
기존 `low-water`를 새 예제에서 `low_water`로 표기했지만 실제 모듈 이전 시에는
이름 변경 매핑을 명시해야 한다.

예약어는 이름으로 쓸 수 없다. 입력·상태·전략·함수 각각의 이름은 해당 범위에서
유일해야 한다. 전략 입력은 공통 입력을 가릴 수 없다. 지역 계산은 함수나 예약
namespace를 가릴 수 없다. 함수 인자는 자기 함수 안에만 존재한다.

B안은 공백 두 칸 들여쓰기를 사용하며 탭은 거부한다. 블록 도입부 뒤에 들여쓴다.
A안은 제한된 YAML을 파싱한다. C안은 절과 end로 블록을 구분한다.
주석은 세 안 모두 `#`다. 호출 괄호는 유지한다. 줄 연속은 열린 괄호 안 또는
쉼표 뒤에서 허용한다.

현재 구현된 기본 값 타입은 bool과 유한한 IEEE 754 binary64 number다.
true/false만 bool 리터럴이며 문자열·숫자의 truthiness나 암묵적 변환은 없다.
숫자는 십진수 정수 또는 소수 표기로 시작하며 NaN/Infinity는 거부한다.
module version은 u32, strategy priority는 i32 범위의 정수 리터럴이다.
문서의 0.2, module version, 바이트코드 포맷 버전은 서로 별개다.
R14 검토용 [정확한 정수 계약](EXACT-INTEGER-CONTRACT.md)은 세 번째 스칼라
`Int/i32`를 제안한다. N2~N4가 끝나기 전에는 구현된 타입으로 표시하지 않는다.

센서 샘플은 `Result<T, SensorFault>`로 표현한다. 생성자는 `Ok(value)`,
`Err(fault)`이며 초기 SensorFault 집합은 `Disconnected | Stale | Invalid`다.
Result를 bool/number처럼 직접 사용하는 것은 타입 오류다. state에는 선언 타입과
일치하는 상수 초기값을 요구한다.

후속 센서 처리 계약은 필터 준비 전 `NotReady`를 추가한다. 선택적 장치 부가정보의
누락(Option)과 설치된 센서의 fault(Result)는 구분한다. 압력·유량 등 부가정보를
입력하지 않아도 기본 제어와 인터록을 사용할 수 있다. 세부 규칙은
[CONSTRAINTS.md](CONSTRAINTS.md)를 따른다.

일반 ADT, fault별 패턴 매칭, 시간·물리 단위 타입은 후속 확장이다. 분기 문법을
추가할 때는 빠짐없는 분기 검사를 요구한다. 장치 고장 자체가 사라진다고
보장하지 않으며, 타입·참조·자원 오류와 처리되지 않은 언어 예외를 차단하는 것이
언어의 목표다.

DateTime·단조 경과·반복 일정·자연 사건·근무 달력과 필수 fallback의 최소 설계는
[TIME-AND-SCHEDULE-CONTRACT.md](TIME-AND-SCHEDULE-CONTRACT.md)에 둔다. 현재
`Duration`/DailySlots/Solar 구현 경계와 T2~T4 제안을 명시적으로 구분한다.

## 4. 표현식과 함수 조합

공통 식은 리터럴, 참조, 호출, 함수 정의, 괄호, 다음 연산자다.

| 강한 결합 → 약한 결합 | 규칙 |
|---|---|
| 참조·호출·괄호 | `f(x)`, `input.x`, `(expr)` |
| 비교 | `< <= > >= is isnt`; 비교 연쇄는 거부 |
| not | bool 부정; `not x is y`는 `not (x is y)` |
| and | bool 두 값, 왼쪽 결합 |
| or | bool 두 값, 왼쪽 결합 |
| >> | 단항 함수 합성, 왼쪽 결합 |
| \|> | 값 전달, 왼쪽 결합 |
| if / then / else | 양쪽 결과 타입이 같은 조건식 |

`(args) -> expr`의 본문은 그 뒤의 전체 식이다. 함수식의 경계가 모호하면
괄호로 감싼다. 비교와 파이프를 섞는 식에는 괄호를 사용한다.
is/isnt는 같은 타입 값의 동등성/비동등성이다. 현재 순서 비교는 number에만 허용한다.
정수 계약이 채택되면 같은 `Int` 두 값의 순서 비교도 허용하고 혼합 비교는 거부한다.
장치 질의의 `type is number`는 별도의 타입 태그 비교다.

이 단계의 함수와 연산은 순수하고 종료가 보장되어야 한다. 단축 평가에 의존하는
부작용이나 오류 회피 패턴은 허용하지 않는다. 모든 분기를 타입 검사하고,
안전한 식은 미리 계산할 수 있다. 산술·나눗셈 오류 규칙은 후속 수치 프로파일에서
정의한다. 정확한 정수의 최소 범위·연산·변환 제안과 구현 수용 벡터는
[EXACT-INTEGER-CONTRACT.md](EXACT-INTEGER-CONTRACT.md)에 분리한다. 이 링크는
설계 제안이며 현재 parser/GFB/VM이 `Int`를 지원한다는 뜻이 아니다. 현재 GFB1은
`Number/f64` 산술 opcode만 가지며 정수 opcode와 나머지 연산은 없다.

```ghost
latch = (start, stop, held) -> not stop and (start or held)
is_dry = map(below(35)) >> recover(false)
```

`x |> f`는 `f(x)`이며 `f >> g`는 `(x) -> g(f(x))`다. 둘 다 새 상태를
만들지 않는다. latch의 기억은 호출자가 넘기는 state.watering에만 존재한다.

함수 타입은 본문과 사용처에서 추론하며 유일하게 결정되지 않으면 오류다.
재귀와 동적 함수 선택은 범위에 없다. 함수 합성과 라이브러리 함수는 정적으로
특수화해 그래프로 만들므로 MCU에 동적 closure를 요구하지 않는다.

## 5. 스트림과 Railway 오류 흐름

input 필드의 타입 표기는 한 tick의 샘플 타입이다. `start: bool`은 `Signal<bool>`
포트의 현재 샘플을 뜻한다. input.start는 현재 샘플이며 함수와 연산은 매 tick에
적용된다. 숨은 비동기 큐나 별도 구독 스케줄러는 없다. 이벤트와 타이머의 의미는
다음 개정에서 별도로 정의한다.

| 함수 | 의미 |
|---|---|
| below(limit) | number를 받아 `value < limit`을 반환하는 함수 |
| map(f) | Ok(x)를 Ok(f(x))로 변환; Err(e)는 그대로 전달 |
| and_then(f) | f가 Result를 반환할 때 Ok(x)를 f(x)로 연결; Err 유지 |
| recover(default) | Ok(x)는 x, Err(e)는 타입이 같은 default로 변환 |

map/and_then/recover 호출은 결과 단항 함수를 만든다. 예제의 is_dry는
`Result<number, SensorFault> -> bool`이다. map은 여기서 Result 변환이며
별도의 스트림 스케줄링 연산이 아니다.

```ghost
dry = input.moisture |> map(below(35)) |> recover(false)
blocked = input.stop or (input.low_water |> recover(true))
```

raw 입력의 fault는 계산 여부나 recover 사용과 관계없이 journal에 남긴다.
따라서 recover는 순수한 값 변환이고 오류를 기록에서 지우지 않는다.
저수위 오류에는 recover(true), 수분 조건 오류에는 recover(false)를 써서
예제의 관수 조건을 차단한다.

### 예제: 오류를 숨기지 않고 제어값으로 변환

앞의 파이프 예시는 보존한 B안 표기다. 선택 문법에서는 같은 판단을 다음처럼
명시적인 분기로 읽을 수 있다. 아래는 `sensor moisture: Percent;`를 선언한
control 내부에 넣는 단편이다.

```ghost
let dry = case moisture {
  ok(value) => value < 35%;
  fault(_)  => false;
};
```

moisture가 `ok(25%)`이면 dry=true, `ok(40%)`이면 false,
`fault(Disconnected)`나 `fault(NotReady)`여도 false다. 마지막 두 경우는
판정값만 false로 대체하며 원래 센서 fault는 입력 기록에 남는다. 이를 "센서 정상"으로
표시하지 않는다. 노이즈 처리와 복구 연산을 붙인 예제는 [센서 계약](CONSTRAINTS.md)에 있다.

## 6. Device query

장치 프로파일은 호스트가 제공하는 semantic capability 집합이다.
초기 질의 모델은 `(kind, name, type)`이며 같은 (kind, name)은 중복할 수 없다.

```ghost
match (pump:actuator<bool>), (valve:actuator<bool>),
      (low_water:sensor<bool>), (moisture:sensor<number>)
```

pump 등은 프로파일이 정한 semantic role의 이름이다. 여러 장치를 순회하는 DB 행
변수가 아니다. 각 항목은 capability의 존재 조건이고 쉼표는 AND다.
`sensor<number>`는 payload 타입이며 Driver가 `Result<number, SensorFault>`로
샘플을 감싸 제공한다.

`(moisture:sensor)`처럼 타입을 생략하면 존재를 검사한다.
`where moisture.type is number`로 타입 조건을 붙일 수 있다. where에서는
match에 나온 이름의 kind/name/type과 상수 비교, and/or/not만 사용할 수 있다.
input/state/next나 현재 수분값은 장치 선택 where에서 읽을 수 없다.

가변 길이 경로, 관계 탐색, 동적 바인딩, 쿼리 결과 행별 실행은 이 초안에 없다.
프로파일을 그래프로 확장할 때는 유일한 바인딩과 탐색 비용 상한을 검증해야 한다.

전략은 priority가 가장 큰 일치 전략 하나를 선택한다. 최고 순위가 같으면 모호성
오류, 일치 전략이 없으면 활성화 오류다. 선언 순서에 따른 덮어쓰기는 없다.

공통 input은 모든 전략에 필요하고 전략 input은 그 전략이 선택됐을 때만 필요하다.
intent 대상과 센서 입력의 capability는 프로파일에서 타입까지 검사한다.
버튼 등 호스트 입력은 별도 포트 바인딩을 검사한다. 샘플 자체 누락은 tick 제출
오류이고 정상적으로 제출한 Err 샘플과 다르다.

프로파일은 tick 도중 바뀌지 않는다. 고장·복구·구성 변경은 후보 프로파일 검증과
전략 선택을 거쳐 경계에서 적용한다. 고장 입력은 현재 전략에서 즉시 처리하되,
보호 수준이 낮아지는 fallback은 명시된 호스트 운전 정책을 따른다.
예제에는 자동 fallback을 선언하지 않았다.

## 7. Tick과 상태 읽기

1. 전략, 프로파일 revision, 공통·전략 입력과 old state를 고정한다.
2. let/with와 모든 next 정의를 old state 및 같은 입력에서 계산한다.
3. 전이가 없는 필드의 old 값을 포함해 완전한 candidate state를 만든다.
4. intent/emit을 계산한다. state는 여전히 old, next는 candidate를 읽는다.
5. 모든 safety 제약을 만족하는 safe intent를 계산한다.
6. state와 출력 결과, 실행 기록을 논리적으로 함께 확정한다.
7. 실제 실행의 호스트만 safe intent를 Driver에 적용한다.

state.x는 어느 식에서도 이전 상태, next.x는 intent/emit에서만 다음 상태다.
계산 도중 이름의 의미가 바뀌지 않는다. next 정의에서 next.y를 읽으면 오류다.
let/with에는 next 참조를 허용하지 않는다.

A/B의 let은 의존 관계가 비순환인 순수 정의다. C의 단일 with 절에 있는 alias는
같은 old snapshot에서 독립 계산하며 서로를 참조하지 않는다. with는 행 필터나
집계를 수행하지 않는다. 출력과 상태 정의는 정적이고 매 tick 완전하다.

tick 실패 시 상태와 일반 출력 결과를 부분 확정하지 않는다. 오류는 호스트로
반환하며 호스트가 정해진 안전 출력 정책을 적용한다. 사용자 코드에 sleep,
직접 GPIO 쓰기, 무제한 반복·재귀, 동적 메모리 크기, 네트워크 호출, 실행 시점
코드 생성은 허용하지 않는다.

### 예제: 모든 다음 상태는 같은 이전 상태를 읽는다

다음은 장치 출력 없이 상태 교환만 확인하는 선택 문법의 설계 예제다.

```ghost
control SnapshotPair {
  input swap: Bool;
  state left: Bool = true;
  state right: Bool = false;

  left'  = if swap then right else left;
  right' = if swap then left else right;
}
```

swap=true인 첫 tick에서 `(left, right)`는 `(true, false)`에서 `(false, true)`로
바뀐다. 두 전이식의 소스 순서를 바꿔도 같다. 다음처럼 바꾸면 설계 계약 위반이다.

```ghost
// 잘못된 전이식: 다음 상태 참조는 출력식에서만 허용한다.
right' = left';
```

오른쪽 `left'`를 계산 순서에 따라 읽는 대신 컴파일 오류로 진단해야 한다.

## 8. 출력 제약

requires는 prerequisite가 false일 때 target을 false로 만든다.
mutex는 한 그룹에서 여러 출력이 true이면 해당 그룹을 모두 false로 만든다.
A는 목록, B는 `pump requires valve`와 `mutex forward, reverse`,
C는 `requires pump, valve`와 `mutex forward, reverse`로 표기한다.

대상은 모든 전략에 존재하는 bool intent여야 한다. requires는 서로 다른 이름
두 개, mutex는 서로 다른 이름 2~32개다. 제약은 true를 만들어내지 않는다.

이 두 bool 출력 제약의 선언 순서에 의존하지 않도록 다음 방식으로 정의한다.

1. 현재 후보 출력의 같은 snapshot으로 모든 제약 위반을 검사한다.
2. 끄기로 결정한 출력의 합집합을 동시에 false로 만든다.
3. 변경이 없을 때까지 반복한다.

한 번 false가 된 출력은 다시 true가 되지 않는다. N개의 bool 출력에서 변경이
있는 라운드는 최대 N번이다. 최종 결과는 모든 제약을 만족해야 한다.
fault에는 위반한 제약과 차단한 출력 ID를 남긴다.

자기유지 상태는 물리 피드백이 아니다. safety가 출력을 차단해도 상태를 암묵적으로
덮어쓰지 않는다. 실제 밸브 개방·펌프 가동은 별도 센서 입력으로 모델링한다.
제거·장치 상실·호스트 장애의 물리 기본 출력은 Driver/호스트 계약이 소유한다.

모드·공유 설비·시간 제약으로의 확장은 [CONSTRAINTS.md](CONSTRAINTS.md)를 따른다.
출력 차단, 새 작업 허가, 모드 전이와 경고 분석은 실행 의미가 서로 다르다.
임의 조건을 모두 위 false 방향 반복 알고리즘으로 처리하지 않는다. 여러 control이
같은 장치를 사용하면 그 장치의 공유 제약을 함께 지켜야 한다.

### 예제: 출력 의도와 차단 결과는 다르다

```ghost
control OutputGuard {
  input pump_request, valve_request: Bool;
  output pump, valve: Bool;

  valve <- valve_request;
  pump  <- pump_request;
  require pump => valve;
}
```

두 요청이 `(pump=true, valve=false)`이면 requested는 그 값을 유지해 기록하고,
safe 결과는 `(pump=false, valve=false)`다. 밸브를 자동으로 켜서 조건을 맞추지 않는다.
이 역시 논리 출력 예제이며 실제 밸브 개방 확인이나 모드 인터록을 대체하지 않는다.

## 9. Literate, code-as-data, 관찰 가능성

문서형 `.ghost.md` 소스는 Markdown 안의 최상위 ghost 코드 fence들을 문서 순서대로
추출해 같은 파서에 전달한다. 하나의 control을 여러 블록으로 나눌 수 있고, 합친
소스 전체가 일반 문법으로 유효해야 한다. 블록별 실행 의미는 추가하지 않는다.
설명, 일반 코드 fence, 시각화 결과는 실행하지 않는다. 추출·진단·원문 위치 매핑의
상세 계약은 [LITERATE.md](LITERATE.md)를 따른다.

일반 소스와 문서형 소스는 같은 AST와 타입 그래프로 이어진다.
파이프라인은 `소스 → AST → 구문 확장 → 타입 그래프 → 검증 → 바이트코드`다.
그래프는 실행 의미의 정본이며 문서·주석·서식은 별도 소스 정보로 보존한다.
모든 문법 표면을 무손실로 서로 바꿀 수 있다고 가정하지 않는다.

입력, 이름 있는 계산, 상태, 의도, 제약에는 안정적인 노드 ID와 소스 범위를 붙인다.
편집기는 코드 위치에서 현재 값, fault, 바뀐 시점, 영향을 준 입력을 볼 수 있어야
한다. blocked/dry 같은 지역 이름은 strategy 이름과 함께 식별한다.
MCU의 중간 값 추적은 크기가 제한된 선택 항목이다. PC에서는 기록 입력으로
다시 계산할 수 있어야 한다.

문서·폼·그래프 편집은 같은 검사를 거친다. 그래프 편집만으로 설명 문단을
재생성하지 않는다. 매크로 호출은 원본 단위로 편집하고 확장 결과는 별도로
관찰한다. 데이터와 코드를 함께 다루면서 사람이 쓴 설명도 유지한다.

## 10. 컴파일 시점 구문 확장

Meta Lua는 Metalua의 compile-time metaprogramming에 대한 선호로 해석했다.
syntax/quote/splice 표기는 [예제의 확장 스케치](LANGUAGE-EXAMPLES.md)에 제안했다.
최초 범위는 타입 있는 표현식 템플릿이며 자유로운 문법 재정의는 후속 검토다.

매크로는 런타임 값이 아닌 AST를 받아 AST를 만든다. 호출자 이름을 포획하지 않는
위생적 확장을 요구하며 확장 후 타입·상태 경계·순환·자원 검증을 다시 수행한다.
새 이름과 확장 크기에 한도를 두고 재귀 확장과 외부 파일·네트워크·시계 읽기는
금지한다. 한도 초과는 컴파일 오류다.

실제 값 변환은 일반 함수로 충분하다. 매크로를 쓰더라도 MCU에는 매크로 처리기나
Lua 런타임이 필요하지 않게 설계한다.

## 11. 타임트래블과 고스트 비교

journal/checkpoint 계약에는 다음 정보가 필요하다.

- timeline/branch ID, 논리 tick, 기준 체크포인트.
- 모듈 hash·schema version, 프로파일 revision, 선택 전략과 선택 이유.
- 입력과 fault, old/candidate state, requested/safe intent, 제약 개입.
- 코드 위치와 연결할 노드 ID; 중간 값 trace는 선택적이고 bounded.

원본 실행을 유지한 채 기록 시점에서 분기한다. Ghost는 동일 Rust core의 별도
인스턴스에서 실행하며 물리 effect sink를 갖지 않는다. 되감기는 장치를 과거
위치로 움직이는 명령이 아니다.

비교는 같은 논리 tick에 맞춰 상태, 요청 출력, 안전 출력, fault의 차이를 보여준다.
wall clock은 입력 데이터이며 순서 기준은 논리 tick이다. 추가 센서가 있는
프로파일로 분기할 때 기록에 해당 입력이 없다면 명시적인 가상 입력 trace를
제공해야 한다. 누락 센서값을 자동으로 만들어내지 않는다.

센서 처리 상태, 모드와 공유 자원 허가, 누적 한도와 예약 발생 기록도 해당 기능을
사용한 trace/checkpoint에 포함한다. 고스트의 가상 실행 기록은 실제 설비의 영속
사용량·예약 기록을 수정하거나 되감지 않는다.

기록 입력을 고정한 고스트는 제어 판단의 차이를 보여준다. 바뀐 펌프 동작이 실제
수분에 미칠 영향까지 예측하려면 별도의 환경 모델이 필요하다.

## 12. 모듈 교체, 배포, 실행 대상

호스트에서 컴파일·검증한 모듈을 ESP-IDF Rust와 WASM의 같은 실행 계약으로
처리한다. 사용자는 logic module을 올리고 활성화·제거하며 호스트가 포트,
출력 소유권, 프로파일, 자원 상한을 검증한다. 다중 모듈 연결과 출력 중재의
상세 문법은 후속 범위다.

교체는 후보 모듈 검증, 전략 선택, 상태 호환성 검사, 필요 시 고스트 비교를 거쳐
tick 경계에서 확정한다. 실패하면 기존 모듈을 유지한다.
모듈/program 교체와 firmware 갱신은 같은 ESP가 제어하는 모든 장치 작업을 정지시킨다.
프로파일, binding, dependency, schedule structure 또는 규칙 변경도 명시적 정지와
Configure 절차가 필요하다. 제한된 runtime-adjustable 속성은 구조적 변경 경로와 다르며,
운전 중 적용 문법과 의미는 [Reference §5.1–5.2](reference/05-settings-and-observation.md)를 따른다.
실행 경계는 [구현 범위](IMPLEMENTATION.md)를 참조한다.
tick 경계 적용만으로 구조적 변경의 정지 요건을 대신하지 않는다.
같은 module ID와 같은 이름·타입의 상태를 이전한다. 새 필드는 기본값,
제거 필드는 제거한다. 같은 이름의 타입 변경은 명시적 migration 지원 전까지
거부한다. 식별자 표기 변경도 자동 상태 이전으로 간주하지 않는다.

교체 시 이전 입력 캐시는 비우고 새 스키마의 완전한 입력을 다시 받는다.
제거된 출력은 호스트가 해제 정책에 따라 처리한다. 부팅 시 선언한 기본값을
사용하며 영속 상태 복원은 revision을 검증한 별도 호스트 정책이어야 한다.
일일 예산과 예약 중복 방지 기록은 물리 설비의 호스트 소유 영속 상태이며 일반
control 초기값과 구분한다. 모듈 교체·재부팅·고스트 되감기로 0으로 만들지 않는다.

System/Logic/Profile/Web-assets 업데이트는 같은 OTA 경험으로 제공한다.
파티션·슬롯·전송 경로는 호스트 영역이며 제어 문법에 노출하지 않는다.
manifest와 배포 프로토콜 구현은 이번 문법 비교 작업에 포함하지 않는다.

### 12.1 호환 장치 교체는 제어 프로그램 교체가 아니다

제어 프로그램은 실제 센서·액추에이터의 모델이나 주소 대신 논리 장치 계약을 사용한다.
Driver와 설치 binding이 같은 계약을 만족하는 다른 장치를 연결하면, 제어 소스와
컴파일된 Program을 유지해야 하며 장치 교체만을 이유로 재컴파일을 요구하지 않는다.
장치별 통신·원시값 해석은 Driver가 담당한다.

같은 계약에는 타입뿐 아니라 의미·단위, 품질·시간·오류 규칙과 필요한 capability가 포함된다.
소스의 센서 규칙을 바꾸는 일은 소스 변경이며, 물리 연결 변경과 구분한다.
이 분리는 Driver의 동적 설치나 무정지 교체를 뜻하지 않는다.
Driver·펌웨어와 설치 binding의 배포 주기는 제어 소스의 판본과 별도로 관리한다.

**왜:** 같은 제어 의도를 다른 장치에서도 재사용하고, 하드웨어 교체가 제어 규칙의
불필요한 재작성·재컴파일로 이어지지 않도록 하기 위해서다.
상세 규칙은 [Language Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)을 따른다.

## 13. 구현 상태와 수용 기준

다음은 현재 코드를 읽어 확인한 상태다. 새 사양의 요구를 구현 완료로 해석하지 않는다.

| 항목 | 현재 참조 구현 | 남은 설계·제품화 범위 |
|---|---|---|
| 입력 문법 | control + literate + 호환 S-expression | adapt·매크로·다중 모듈 |
| 타입·함수 | Bool/Number/Percent/Duration, enum, 정적 fn, 센서 case | 일반 ADT·고차 함수 합성 |
| 입력 스키마 | 모든 입력을 매 tick 요구 | 공통 + 선택 전략 입력 |
| 상태 읽기 | state=old, next=candidate | 이 의미 유지·명문화 |
| 안전 제약 | false-only snapshot 고정점, requires-any | 일반 논리식/최적화 solver |
| 공유 설비·모드 | Rust station + WASM API + 정적 policy 바인딩 | 실장치 Driver·배포 승인 경계 |
| 장치 부가정보 분석 | optional 정수 유량의 Pass/Violation/Unknown | 물리 수압/곡선 모델·알림 전송 |
| 센서 신호 처리 | 유한 필터·히스테리시스·품질·복구 | 실제 보드 WCET/메모리 측정 |
| 시간 제약 | 단조 timer, 날짜별 예산/발생 ledger, desktop 저장 | MCU NVS·RTC 신뢰·전원 차단 검증 |
| hot-swap 타입 변경 | 모듈 이름 변경/같은 상태 이름의 VM Bool↔Number 변경 거부 | 명목 enum 스키마·명시적 migration·호스트 bundle 교체 |
| 프로파일 변경 | 활성 전략 즉시 해제 | 후보 검증 후 경계에서 확정 |
| rewind/replay | bounded journal, 이후 기록 삭제형 rewind | 원본 보존 분기, 버전·프로파일 기록 |
| IR·소스맵 | AST 노드 원본 위치와 literate 줄 매핑 | bytecode PC→노드 추적·공개 typed graph |
| 자원 | 식 스택 제한, tick의 Vec/Map 할당 | 상태·trace·전체 tick 자원 상한 검증 |
| 배포 | ESP32/WASM 기반 코드 | 교체·복구·출력 해제 계약 종단 검증 |

현재 verifier의 입력/상태/intent 상한은 각각 128, 전략 상한 32, 제약 상한 128,
표현식·질의 blob 상한 4096바이트, 식/질의 스택 상한 128이다. 초기 참고 한도이며
새 기능의 최대 비용을 검증했다는 뜻이 아니다. 새 compiler/loader가 같은 한도를
적용하도록 명세와 검사를 함께 정해야 한다.

단순 식의 표면 문법은 기존 opcode로 낮출 수 있다. Result·전략 입력·추적 정보는
명시적인 lowering 또는 포맷 확장이 필요하다. 현재 GFB1에서 그대로 지원한다고
주장하지 않는다. 지원하지 않는 모듈은 조용히 의미를 바꾸지 않고 거부해야 한다.

선택한 문법을 구현할 때 다음을 수용 기준으로 삼는다.

1. 세 예제의 공통 시나리오를 선택한 문법으로 실행해 기대값과 비교한다.
2. next/intent 정의를 재배치해도 결과가 같고 잘못된 next 참조는 거부한다.
3. requires 체인과 mutex의 선언 순서에 관계없이 최종 제약을 만족한다.
4. 전략 충돌, 필수 장치 상실, 입력 누락, Result 타입 오용을 진단한다.
5. 실패한 모듈·프로파일 교체가 기존 실행을 부분 변경하지 않는다.
6. 고스트 분기가 원본 이력과 실제 출력을 건드리지 않고 같은 tick의 차이를 보인다.
7. 함수·매크로 확장 후 자원 한도를 검증하고 오류 위치를 원문까지 연결한다.

## 14. 문법 참고

A안의 계층·스칼라·블록 문자열은
[YAML 1.2.2](https://yaml.org/spec/1.2.2/)에서 가져온다.
GhostFlow에서는 단일 문서와 제한된 scalar/map/list만 받고 중복 키, anchor/alias,
merge key, 사용자 tag를 거부한다. true/false와 십진수만 정해진 리터럴로 해석하고,
나머지 타입 표기·표현식 scalar는 문자열로 보존해 GhostFlow가 파싱한다.

설명과 코드를 함께 쓰는 발상은
[Literate CoffeeScript](https://coffeescript.org/#literate)에서 가져온다.
원래 Literate CoffeeScript는 들여쓴 코드 블록을 사용한다. B안은 실행 블록을
구별하기 위해 명시적인 ghost fence를 선택한 별도 설계다.

장치 패턴을 읽는 감각은
[Cypher MATCH](https://neo4j.com/docs/cypher-manual/current/clauses/match/)를 참고한다.
GhostFlow의 strategy/next/emit과 타입 파라미터 표기는 자체 제안이다.

AST를 만드는 컴파일 시점 확장은
[Metalua](https://github.com/fab13n/metalua)와
[compiler 문서](https://github.com/fab13n/metalua/blob/master/README-compiler.md)를
참고한다. 원문법과 GhostFlow가 제안하는 표기는 구분한다.
