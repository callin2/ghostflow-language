# 2. 타입, 표현식과 상태

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전: 소스와 문법](01-source-and-syntax.md) · [다음: 시간과 예약](03-time-and-schedules.md)

GhostFlow의 타입은 저장 형식보다 제어 의미를 먼저 보존한다. 참·거짓, 근사 측정,
백분율, 시간 길이, 정확한 개수와 단계 상태를 서로 바꾸어 쓰지 않는다. 이렇게 해야
잘못된 비교와 단위 혼동을 실행 전에 찾고, 화면·기록·장치 경계도 같은 의미를 쓸 수 있다.

이 장의 `ghost` 조각은 규칙을 설명하는 예시다.

근거: [선택 문법](../LANGUAGE-SURFACE.md), [공통 언어 계약](../LANGUAGE.md),
[정확한 정수 계약](../EXACT-INTEGER-CONTRACT.md),
[Programming in GhostFlow](../ProgrammingInGhostflow.md),
[물리량 설계 이슈 #93](https://github.com/callin2/ghostflow-language/issues/93).
[전체 언어 reference](../LANGUAGE-REFERENCE.md)는 이 장과 나머지 상세 장의 색인이다.

## 2.1 값 종류

| 타입 | 의미 | 대표 리터럴·값 |
|---|---|---|
| `Bool` | 참 또는 거짓 | `true`, `false` |
| `Int` | 정확한 signed 32-bit 정수 | 개수, 반복 횟수, 정수 차이 |
| `Number` | 유한한 binary64 근사 수치 | `3.0`, `0.5`, `-2.5` |
| `Percent` | 0부터 100까지의 백분율 | `30%` |
| `Duration` | 밀리초 해상도의 비음수 시간 길이 | `250ms`, `2s`, `5min`, `1h` |
| 이름 있는 enum | 선언한 유한 case 중 하나 | `Idle`, `Watering` |
| `Result<T, E>` | 정상 payload 또는 compiler-owned fault enum `E` | `ok(value)`, `fault(reason)` |
| 이름 있는 물리량 | 단위와 농업 의미를 보존한 유한 수치 | `25°C`, `1.2kPa`, `70%RH` |

`Bool`에는 숫자나 문자열의 truthiness가 없다. NaN과 Infinity는 `Number` 값이 아니다.
`30`, `30%`, `30ms`는 같은 숫자 표기가 아니며 암묵적으로 비교하거나 변환하지 않는다.
`"Asia/Seoul"`과 schedule 설정의 `06:00`은 그 위치에서만 의미를 갖는 제한된
문법이다. 이 표기를 일반 문자열 연산으로 확장해 읽지 않는다. schedule의
`[06:00, 18:45]`도 범용 배열 값이 아니다. 범용 날짜와 시각 값은 3장의 명시적인
`date`, `time`, `datetime` tagged literal을 사용한다.

`Percent`의 경계가 의미를 드러내고 잘못된 수치 연결을 막는다. `Duration`은 달력
시각과 다르다. 타이머의 단조 경과 시간을 벽시계 보정으로 되감지 않는다.

### 리터럴 spelling

- Bool은 정확히 `true`, `false`다.
- 일반 수치는 십진 정수형, 소수점 또는 지수 표기를 사용한다. 앞의 `-`는 음수를
  나타내며 string을 수로 바꾸는 truthiness나 암묵 변환은 없다.
- Percent는 수치 뒤의 `%`로 구분한다. 예: `30%`.
- Duration은 비음수 정수와 `ms | s | min | h`를 붙인다. 예: `500ms`, `2s`.
  반 초는 `0.5s`가 아니라 `500ms`로 쓴다.
- enum case는 해당 enum 선언에 나온 식별자다.

Duration에는 위의 비음수 정수 단위 표기를 사용한다. `%`를 정수 remainder로 쓰는
설계 표기는 operand 사이의 이항 연산이며, Percent suffix와 문맥을 구분해야 한다.

## 2.2 리터럴과 기대 타입

정수 모양의 일반 수와 근사 측정값을 구분하기 위해 다음 타입 결정 원칙을 사용한다.

- 소수점이나 지수가 있는 수는 `Number`다.
- 정수 모양의 십진수는 기대 numeric type이 없으면 `Int`다.
- typed declaration, 함수 매개변수, 같은 연산의 이미 정해진 다른 operand,
  두 `if` branch의 공통 기대 타입은 정수 모양 리터럴에 기대 타입을 줄 수 있다.
- `input temperature: Number;`와 비교하는 `30`은 처음부터 `Number` 리터럴로
  해석할 수 있다. 이는 실행 중 `Int`를 `Number`로 바꾸는 암묵 변환이 아니다.
- untyped `let count = 30;`의 타입은 initializer에서 고정된다. 나중 사용처가
  initializer의 타입을 거꾸로 바꾸지 않는다.
- 충돌하는 기대 타입은 진단하며 overload를 추측하지 않는다.
- 정수 리터럴 범위는 원래 십진 digit에서 검사한다. `-2147483648`은 하나의 경계
  사례로 허용하며, 먼저 양수 `2147483648`을 거부한 뒤 단항 `-`를 적용하는 식으로
  처리하지 않는다. 더 큰 양·음 magnitude는 진단한다.
- digit separator는 정수 리터럴 계약에 포함되지 않는다. 아래 범위 표기의 `_`는
  읽기 위한 구분이다.

```ghost
control LiteralContexts {
  input temperature: Number;
  let count = 30;              // Int
  let warm = temperature >= 30; // 이 30은 Number 문맥
  output alarm: Bool;
  alarm <- warm;
}
```

개수와 반복 횟수는 지원 범위 안에서 정확하다. 손실·wrap·saturation은 조용히
일어나지 않는다.

## 2.3 정확한 정수 설계

최소 의미 모델은 signed 32-bit 정수다.

```text
Int = -2_147_483_648 .. 2_147_483_647
```

부호 있는 한 타입은 개수뿐 아니라 차이와 offset도 표현한다. 비음수 제약은 별도
primitive를 늘리기보다 config/state의 domain bound로 표현한다. 날짜시각, 단조 시계,
identifier 폭은 이 `Int`와 별도 계약이다.

### 연산 의미

| 식 | 결과와 제약 |
|---|---|
| `a + b`, `a - b`, `a * b` | exact `Int`; 범위 초과는 fault |
| `-a` | exact `Int`; 최솟값의 부호 반전은 fault |
| `a div b` | 0 방향으로 자른 몫 |
| `a % b` | 피제수와 같은 부호의 나머지 |
| `a / b` (두 `Int`) | 오류; `div` 또는 명시적 Number 변환 필요 |
| `== != < <= > >=` | 두 `Int` 사이에서 허용 |
| `Int`와 `Number` 혼합 | 명시적 변환 전에는 오류 |

유효한 나눗셈에는 `a == (a div b) * b + (a % b)`가 성립한다. 0으로 나누기와
`MIN div -1`은 각각 division fault와 overflow다.

### 명시적 변환

| spelling | 의미 |
|---|---|
| `number(i)` | 모든 i32를 정확한 `Number`로 변환 |
| `int_exact(n)` | 범위 안의 정수값인 Number만 허용 |
| `int_floor(n)` | 수학적 내림 뒤 범위 검사 |
| `int_ceil(n)` | 수학적 올림 뒤 범위 검사 |
| `int_trunc(n)` | 0 방향 절삭 뒤 범위 검사 |
| `int_nearest_even(n)` | 최근접, 정확한 중간값은 짝수 쪽, 이후 범위 검사 |

숨은 반올림 기본값을 가진 일반 변환은 없다. 상수 overflow와 상수의 잘못된 변환은
compile 진단이다. 입력에 따라 발생한 overflow, 0 나눗셈, fractional exact 변환,
범위 초과 변환은 현재 tick을 거부한다. 새 상태와 intent는 일부만 확정되지 않는다.
안정적인 fault 이유는 `integer-overflow`, `integer-division-by-zero`,
`integer-conversion-fractional`, `integer-conversion-out-of-range`로 구분한다.

`int_exact`는 유한 입력의 소수부를 범위보다 먼저 검사한다. 따라서
`2147483648.5`처럼 소수이며 범위도 벗어난 값은 `integer-conversion-fractional`이다.
정수값이 범위를 벗어나면 `integer-conversion-out-of-range`다. 이 순서는 상수 진단과
runtime fault에서 동일하며, 입력을 정확한 정수로 바꿀 수 있는지를 먼저 설명한다.

`Int`, `div`, `%`와 위 변환 함수 이름이 canonical spelling이다. 일반 `int(n)`처럼
반올림 정책을 숨기는 변환은 없다. `div`와 이항 `%`는 `*`, `/`와 같은 우선순위이며
왼쪽 결합이다. 공백 없이 수치 바로 뒤에 붙은 `30%`는 Percent literal이고, 두 식
사이의 `%`는 Int remainder다.

### Number 연산

`Number`에는 같은 타입 operand의 `+`, `-`, `*`, `/`, 단항 `-`와 비교를 사용한다.
결과는 유한해야 한다. 0 나눗셈이나 비유한 결과가 생기면 해당 tick은 상태와
intent를 확정하지 않는다. `Int`와 `Number`를 섞어 이 규칙으로 우회할 수 없다.

## 2.4 enum과 빠짐없는 분기

enum은 순차 단계를 숫자로 숨기지 않고 이름으로 나타낸다.

```ghost
type Phase = Idle | Opening | Watering | Closing;
state phase: Phase = Idle;

phase' = case phase {
  Idle     => if start then Opening else Idle;
  Opening  => Opening;
  Watering => Watering;
  Closing  => Idle;
};
```

모든 case를 다뤄야 한다. 빠진 case는 오류이며, 새 enum case를 추가하면 영향받는
분기를 다시 검토하게 만든다. 각 branch는 문맥이 요구하는 같은 타입의 값을 내야 한다.
`phase in {Opening, Watering}`은 같은 enum 타입의 유한 집합 포함 검사다. `{...}`는
이 위치의 집합 표기이며 범용 collection 값을 만들지 않는다.

참고 자료의 `enum Phase { ... }`와 `enum Phase = ...;`는 역사 표기이며 실행 입력으로
거부한다.

## 2.5 sensor 결과와 명시적 오류 흐름

`sensor moisture: Percent;`의 선언 타입은 정상 payload 타입이다. sensor를 읽은
결과는 정상값 또는 fault이므로 payload처럼 바로 비교할 수 없다.

```ghost
let dry = case moisture {
  ok(value) => value < 30%;
  fault(_)  => false;
};
```

`_`는 fault의 세부 값을 이 식에서 쓰지 않는다는 pattern이다. false로 대체해도
원래 fault는 정상값으로 바뀌지 않으며 기록에 남는다. `SensorFault`는
`Disconnected | Stale | Invalid | NotReady`를 가진 내장 enum이다. fault binding은
다시 `case`로 빠짐없이 나눌 수 있다.

```ghost
let available = case moisture {
  ok(_) => true;
  fault(reason) => case reason {
    Disconnected => false;
    Stale => false;
    Invalid => false;
    NotReady => false;
  };
};
```

`Result<T, E>`는 함수 parameter와 결과 타입에도 쓸 수 있다. `E`는 compiler가 정의한
유한 fault enum이어야 한다. v1에는 `SensorFault`, `ClockFault`, `CalendarFault`,
`TemporalContextFault`가 있다. `ok(expr)`와 `fault(reason)`은 이 내장 Result의
constructor다. 사용자가 새 ADT, 새 Result error 타입 또는 constructor를 선언하는
일반 문법은 없다. Result를 state, config, input, output의 scalar 값처럼 저장하거나
installation binding에 노출하지 않는다.

내장 fault enum의 member는 다음으로 고정한다. 시간·달력·자연 사건의 이름은
[3장의 Unknown 원인](03-time-and-schedules.md#자연-기준의-fallback과-회복)과 같다.

| 오류 타입 | member |
|---|---|
| `SensorFault` | `Disconnected`, `Stale`, `Invalid`, `NotReady` |
| `ClockFault` | `ClockUnknown`, `ZoneUnsupported` |
| `CalendarFault` | `ClockUnknown`, `CalendarMissing`, `CalendarOutOfRange`, `ZoneUnsupported` |
| `TemporalContextFault` | `ClockUnknown`, `LocationUnknown`, `EventUnavailable`, `PredictionMissing`, `PredictionStale`, `ZoneUnsupported` |

일부 이름은 여러 내장 fault enum에 속한다. `fault(reason)`에서는 기대하는 Result의
오류 타입으로, `case reason`에서는 검사 대상의 오류 타입으로 member를 결정한다.
문맥에서 한 타입으로 정할 수 없는 member 참조는 오류다. 사용자 선언으로 이 member를
가리거나 새 member를 추가할 수 없다. 잘못된 provider 종류나 binding은 activation
오류이며, 위 enum에 임의의 새 member를 만들어 대신하지 않는다.

**왜:** clock 부재와 예측 부재처럼 대응이 다른 원인을 같은 실패값으로 지우지 않으면서,
각 Result에 가능한 경우를 유한하게 한정해 빠짐없는 분기를 검사하기 위해서다.

`sensor moisture?: Percent;`의 `?`는 설치 capability가 선택적임을 말한다. 미설치와
설치된 sensor의 fault는 다르다. `?`만으로 대체 전략이나 임의의 기본값이 생기지 않는다.

상태 있는 sensor 처리도 의미를 선언한다.

```ghost
sensor moisture: Percent {
  sample = 1s;
  valid = 0% .. 100%;
  filter = median(3);
  stale_after = 3s;
  recover_after = 1 samples;
}
signal dry = hysteresis(moisture,
  on_below: 30%, off_above: 35%, initial: false);
```

`median(n)`의 n은 홀수 1..31이고, hysteresis의 두 경계 사이에서는 이전 판단을
유지한다. `sample`은 측정 간격 정보이지 별도 thread를 시작하는 명령이 아니다.
filter와 hysteresis의 기억도 checkpoint와 재현 대상인 명시적 제어 상태다.

### 정적인 Result 변환과 합성

Result 흐름에는 다음 compiler-known 정적 변환을 사용할 수 있다.

| 표기 | 값 의미 |
|---|---|
| `ok(value)` / `fault(reason)` | 정상 payload 또는 sensor fault constructor |
| `below(limit)` | 호환되는 ordered payload를 받아 `value < limit`을 반환하는 정적 변환 |
| `map(f)` | `Ok(x)`는 `Ok(f(x))`, `Err(e)`는 그대로 전달하는 단항 함수 |
| `and_then(f)` | `Ok(x)`는 Result를 반환하는 `f(x)`로 연결하고 `Err(e)`는 전달 |
| `recover(default)` | `Ok(x)`는 x, `Err(e)`는 같은 타입의 default로 바꿈 |
| `x \|> f` | 값을 함수에 전달하는 `f(x)` |
| `f >> g` | 왼쪽부터 합성한 `(x) -> g(f(x))` |

```text
is_dry = map(below(35%)) >> recover(false)
dry = moisture |> map(below(35%)) |> recover(false)
```

`map`과 `and_then`의 인수는 정적으로 해석되는 이름 있는 `fn` 또는 `below(limit)`처럼
compiler가 아는 bounded transform이어야 한다. 함수값, lambda, closure, runtime 함수
선택을 만들지 않는다. `>>`도 이런 정적 transform chain만 합성한다. `|>`와 `>>`는
왼쪽 결합이고 `if/then/else`보다 강하게 묶인다.

이 연산들은 상태나 stream scheduler를 만들지 않는 순수 값 변환이다. `recover`도
원래 sensor fault와 fallback 선택 기록을 지우지 않는다. 대문자 `Ok`/`Err`와
`not`, `and`, `or`, `is`, `isnt`는 canonical alias가 아니다.

## 2.6 표현식과 연산자

선택된 control 문법의 결합 우선순위는 강한 순서대로 다음과 같다.

| 순위 | 연산 |
|---:|---|
| 1 | 괄호, 함수 호출, member와 다음 상태 참조 |
| 2 | 단항 `!`, 단항 `-` |
| 3 | `*`, `/`, `div`, 이항 `%` |
| 4 | `+`, `-` |
| 5 | `in { ... }` |
| 6 | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| 7 | `&&` |
| 8 | `\|\|` |
| 9 | 정적 transform 합성 `>>` |
| 10 | 정적 값 전달 `\|>` |

같은 순위의 이항 연산은 왼쪽 결합이다. `6 - 2 - 1`은 `(6 - 2) - 1`이다.
비교 연쇄는 허용하지 않는다. `a < b < c` 대신 `a < b && b < c`라고 쓴다.
동등·순서 비교는 호환되는 같은 타입 사이에서만 한다. 괄호와 이름 있는 `let`을
사용해 복잡한 판단의 의도를 드러낸다.

`|>`와 `>>`는 Result의 정적으로 해석되는 transform chain에만 쓴다. 초기 A/B/C
자료의 `not`, `and`, `or`, `is`, `isnt`는 위 control 연산자의 alias가 아니다.

### 조건식

`if condition then a else b`는 값이다. condition은 `Bool`이고 두 branch는 같은
타입이어야 한다. `case`와 마찬가지로 선택되지 않은 branch도 정적으로 타입 검사한다.

```ghost
let denominator = if b == 0 then 1.0 else b;
let result = if b == 0 then 0.0 else a / denominator;
```

`if`, `&&`, `||`는 왼쪽부터 결정적으로 단락 평가한다. `if`는 condition 뒤 선택한
branch만, `&&`는 왼쪽이 true일 때만 오른쪽을, `||`는 왼쪽이 false일 때만 오른쪽을
평가한다. 모든 branch와 operand는 여전히 정적으로 이름·타입 검사를 받는다. compile-time
오류는 도달하지 않는 branch에도 남지만 선택되지 않은 branch의 runtime fault는 발생하지
않는다. constant folding과 함수 inline도 이 fault 도달성과 순서를 보존한다.

## 2.7 순수 함수와 계산 조합

```ghost
fn hold(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}
```

함수는 매개변수와 결과 타입을 선언하고 마지막 식의 값을 반환한다. `return` 문은
없다. 함수는 같은 인자에 같은 값을 내는 순수 계산이며, control의 입력·상태·설정을
암묵적으로 포획하지 않는다. 필요한 값은 호출 인자로 전달한다.

함수에는 가변 지역 상태, 대기, I/O 효과가 없다. 호출은 정적으로 해석되어야 하며
재귀와 순환 호출은 허용하지 않는다. 함수와 `let`을 나누거나 재배치해도 의존 그래프가
같으면 결과가 바뀌지 않는다. 함수 이름은 일반 값이 아니며 저장·반환·동적 선택하거나
일반 함수 parameter로 넘길 수 없다. Result의 `map(fnName)`, `and_then(fnName)`과 `>>`는
compiler가 이름을 정적으로 특수화하는 제한된 자리다. 일반 고차 함수와 closure는 없다.
typed expression macro는 runtime 함수와 다른 compile-time 기능이며
[6장](06-composition-and-replay.md#610-syntax-quote-splice의-문법)을 따른다.

`let name = expression;`은 식에 이름을 붙일 뿐 tick 사이의 기억을 만들지 않는다.
선언 순서와 무관한 비순환 그래프로 계산한다. 상태가 필요하면 `state`를 쓴다.

## 2.8 tick과 상태 snapshot

tick은 한 입력 snapshot으로 한 번의 판단을 확정하는 논리 단위다.

```text
입력 snapshot + 이전 상태
  → 모든 다음 상태 계산
  → 완전한 candidate state 구성
  → requested output intent 계산
  → 제약을 적용한 safe intent 계산
  → 성공한 결과를 함께 확정
```

```ghost
control SnapshotPair {
  input swap: Bool;
  state left: Bool = true;
  state right: Bool = false;
  output lamp: Bool;

  left'  = if swap then right else left;
  right' = if swap then left else right;
  lamp <- left';
}
```

`left`와 `right`는 이전 tick의 값이다. 모든 다음 상태 식은 같은 이전 상태와 입력을
읽으므로 소스 순서를 바꾸어도 결과가 같다. `right' = left';`처럼 한 상태 전이에서
다른 다음 상태를 읽는 것은 오류다. 다음 상태 참조는 출력식에서만 허용한다.
`let`에도 다음 상태를 참조할 수 없다.

출력 연결은 이번 tick의 candidate state를 읽을 수 있지만, unprimed state 이름은
여전히 이전 상태를 뜻한다. `<-`로 만든 값은 requested intent다. 출력 제약이 이를
safe intent로 제한한 뒤 상태와 논리 결과를 함께 확정한다. 출력 선언의 생략된
초기값이나 `<-`는 실제 장치의 시작·장애 시 물리 안전값을 뜻하지 않는다.

정의하지 않은 상태의 다음 값은 이전 값을 유지한다. 하나의 state에 둘 이상의 다음
상태 정의를 둘 수 없다. tick 중 수치 fault 등으로 계산이 실패하면 candidate state와
intent를 부분 확정하지 않는다. 이 논리적 원자성이 여러 물리 출력의 동시 변화를
보장하지는 않는다.

`state name: Type = value;`의 초기값은 선언 타입과 같은 상수여야 한다. 입력이나
다른 상태를 읽어 초기값을 계산하지 않는다. 이 명시적 시작값이 재현 가능한 첫
tick의 이전 상태를 만든다.

### 타이머도 상태다

`timer age = elapsed(phase);`는 `phase`가 마지막으로 확정 변경된 뒤의 단조 경과
시간이다. 변경을 확정한 시점에 0으로 재설정하고, 이후 tick에서 읽는다. 초기값도
0이다. Bool을 대상으로 하면 true와 false 양방향 변화가 새 구간을 시작한다.
타이머는 `sleep`이나 별도 실행 thread가 아니며 다른 입력 처리를 막지 않는다.

단계 전이는 조건을 처음 만족한 tick에서 한 번 일어난다. 긴 tick 하나가 여러 상태
단계를 연속으로 통과시키지 않는다. 요청한 지연 이상이며 정상 운전에서 tick 해상도만큼
늦을 수 있다.

## 2.9 물리량과 단위

일반 `Number`만으로는 `25°C`, `800ppm`, `1.2kPa`, `5L/min`, `70%RH`의 물리
의미를 구분할 수 없다. 다음 이름과 suffix가 승인된 고정 catalog다. suffix는
대소문자를 구별하며 수치 token 바로 뒤에 붙인다. lexer는 가장 긴 suffix를 먼저
인식한다.

| 타입 | 허용 suffix | canonical unit |
|---|---|---|
| `Temperature` | `°C`, `K`, `°F` | `K` |
| `TemperatureDelta` | `Δ°C`, `ΔK`, `Δ°F` | `ΔK` |
| `RelativeHumidity` | `%RH` | ratio `0..1` |
| `Pressure` | `Pa`, `kPa`, `bar` | `Pa` |
| `VaporPressureDeficit` | `PaVPD`, `kPaVPD` | `PaVPD` |
| `CO2Concentration` | `ppm` | molar ratio |
| `FlowRate` | `m3/s`, `L/min`, `mL/min` | `m3/s` |
| `Volume` | `m3`, `L`, `mL` | `m3` |
| `Length` | `m`, `cm`, `mm` | `m` |
| `Irradiance` | `W/m2` | `W/m2` |
| `PPFD` | `mol/m2/s`, `umol/m2/s` | `mol/m2/s` |
| `Energy` | `J`, `kJ`, `Wh`, `kWh` | `J` |
| `Power` | `W`, `kW` | `W` |
| `ElectricalCurrent` | `A`, `mA` | `A` |
| `Voltage` | `V`, `mV` | `V` |
| `Conductivity` | `S/m`, `mS/cm`, `uS/cm` | `S/m` |
| `Acidity` | `pH` | `pH` |

`Rate<Q>`는 4장의 `window_rate`가 만드는 expression-only 타입이다. canonical 의미는
Q의 변화량/초이며 `Rate<Temperature>`의 분자는 `TemperatureDelta`와 같은 `ΔK`다.
다른 허용 선형 Q의 분자는 같은 nominal quantity의 canonical 차이다. `window_rate`의
`signal` 선언 이름으로 결과를 참조할 수 있다. 직접 literal, 일반 값 binding,
함수 parameter/result, state, config, input 또는 output 타입으로 만들 수 없다. 임계값은
`rate(delta: difference, time: Duration)`로 만들며 같은 Q의 rate끼리만 비교한다. 생성자의
Q는 비교의 다른 피연산자나 명시된 기대 `Rate<Q>`에서 정한다. 특히
`TemperatureDelta`만으로 Q가 하나로 정해지지 않으면 추측하지 않고 거부한다.
v1 `window_rate`의 Q는 `Temperature`, `TemperatureDelta`, `Pressure`,
`VaporPressureDeficit`, `FlowRate`, `Volume`, `Length`, `Irradiance`, `PPFD`,
`Energy`, `Power`, `ElectricalCurrent`, `Voltage`, `Conductivity` 중 하나다.
`Int`, `Number`, `Percent`, `RelativeHumidity`, `CO2Concentration`, `Acidity`에는
적용하지 않는다.

```ghost
signal warming = window_rate(temperature, over: 10min,
  quality: measured, max_age: 2min);
output warming_slowly: Bool;
warming_slowly <- warming |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);
```

이 단편에서 `temperature`는 Temperature 센서다. 비교의 기대 타입은
`Rate<Temperature>`이며 임계값은 1 ΔK/s다. `time`은 양의 Duration이어야 한다.
상수 0은 정적으로 거부하고, 실행 중 0이 되면 산술 오류로 해당 tick을 실패시킨다.

**Why:** 온도와 온도차의 변화율은 같은 ΔK/s 단위를 가져도 제어 대상이 다르다.
기대 타입으로 대상을 정하고 일반 값 저장을 제한하면 단위만 같다는 이유로
서로 다른 변화율을 혼용하는 일을 막을 수 있다. 0인 시간 구간에 임의의 변화율을
대입하면 실제 측정으로 뒷받침되지 않는 제어 판단을 만들게 된다.

`Percent`는 position을 포함한 0..100 값이며 `RelativeHumidity`와 다르다.
`Temperature`는 절대 온도이고 `TemperatureDelta`는 차이다. 따라서 temperature
설정의 `step`에는 `0.5Δ°C`처럼 delta를 쓴다.

```ghost
control ClimateTarget {
  input inside_temperature: Temperature;
  config target_temperature: Temperature = 25°C {
    min = 18°C;
    max = 32°C;
    step = 0.5Δ°C;
  }
  output heat: Bool;
  heat <- inside_temperature < target_temperature;
}
```

십진 literal은 정확한 십진 유리수로 unit을 변환한 뒤 canonical 값에서 binary64
ties-to-even 반올림을 한 번만 한다. 같은 물리량의 다른 unit은 변환 후 같은 의미값으로
비교한다. artifact metadata는 nominal quantity identity와 canonical unit을 보존한다.
표시 unit과 locale formatting은 UI metadata이며 제어 의미를 바꾸지 않는다.

허용 연산은 다음으로 닫혀 있다.

- 같은 nominal quantity끼리 비교한다.
- 선형 물리량은 같은 타입끼리 `+`, `-`, 단항 `-`를 사용하고 `Number`로 곱하거나
  나눌 수 있다. 같은 타입의 나눗셈 결과는 `Number`다.
- `Temperature - Temperature`는 `TemperatureDelta`, `Temperature + TemperatureDelta`와
  `Temperature - TemperatureDelta`는 `Temperature`다. 두 절대 온도를 더할 수 없다.
- `RelativeHumidity`, `CO2Concentration`, `Acidity`는 같은 타입끼리 비교만 한다.
- `FlowRate * Duration`은 `Volume`, `Volume / Duration`은 `FlowRate`,
  `Power * Duration`은 `Energy`, `Energy / Duration`은 `Power`,
  `Voltage * ElectricalCurrent`는 `Power`다. 곱셈은 두 operand 순서 모두 허용한다.
- `VaporPressureDeficit`는 canonical 규모가 pressure와 같아도 `Pressure`와 다른 nominal
  타입이다. 명시되지 않은 cross-quantity 연산과 numeric type 전환은 오류다.

PID gain은 자유로운 차원 대수 대신 4장의 bounded constructor를 사용한다.
`proportional_gain(output: 2%, error: 1Δ°C)`,
`integral_gain(output: 0.1%, error: 1Δ°C, time: 1s)`,
`derivative_gain(output: 1%, time: 1s, error: 1Δ°C)`가 그 spelling이다.
binding은 quantity와 unit을 명시해야 한다. unit 없는 OCR 숫자는 authoritative quantity가
아니며 사용자가 확인한 binding 없이 승격하지 않는다.

`moving_average`와 `ema`가 절대 `Temperature`를 처리할 때는 canonical K에서 affine
weighted mean을 계산한다. 이는 filter의 닫힌 의미이며 source의
`Temperature + Temperature`를 허용하지 않는다.

## 2.10 확정된 타입 경계

- `Int`는 signed 32-bit이고 `div`, `%`와 이름 있는 변환을 사용한다.
- `if`, `&&`, `||`는 왼쪽부터 단락 평가한다.
- 제거된 함수·enum·next·qualified-value 별칭은 migration 진단으로 거부한다.
- compiler-owned fault enum을 쓰는 내장 `Result<T, E>`와 정적 transform만 제공한다.
  일반 ADT, 사용자 Result error 타입, 함수값과 일반 고차 함수는 없다.
- 물리량은 2.9의 고정 catalog와 닫힌 연산만 사용한다.
- 범용 날짜와 시각은 3장의 `date`YYYY-MM-DD``,
  `time`HH:MM[:SS[.f|.ff|.fff]]``,
  `datetime`YYYY-MM-DDTHH:MM:SS[.f|.ff|.fff](Z|±HH:MM)`` tagged literal을 사용한다.
  `DateTime`은 offset을 반드시 가지며 시간 offset에는 `Duration`만 쓴다.

이 경계 밖의 spelling, 암묵 변환, unit 추측, 사용자 constructor와 runtime 함수 선택은
별도 언어 기능으로 추측하지 않고 진단한다.
