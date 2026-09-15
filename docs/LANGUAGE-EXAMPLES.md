# GhostFlow 문법 대안: 같은 관수 프로그램 세 가지

2026-09-05 · 설계 비교용. 아래 코드는 새 문법 제안이며 현재 `ghostc`로 실행할 수 없다.
이 문서는 초기 A/B/C 비교 기록이다. 후속 대화에서 선택한 문법과 literate 형식은
[control 문법](LANGUAGE-SURFACE.md), [LITERATE.md](LITERATE.md)에 있다.
실행 중인 MVP 예제는 [irrigation.ghost.md](../examples/irrigation.ghost.md)다.
공통 의미는 [언어 사양](LANGUAGE.md), 취향의 근거는 [설계 노트](DESIGN-NOTES.md)를 따른다.

## 비교할 동작

세 프로그램은 같은 입력·상태·전략·출력으로 다음 동작을 표현한다.

1. 시작 입력으로 관수를 시작하고, 시작 입력이 내려가도 이전 상태로 자기유지한다.
2. 정지 또는 저수위가 참이면 정지가 우선한다. 저수위 센서 오류도 관수를 차단한다.
3. 수분 센서가 없는 구성은 `basic`을 선택한다.
4. 수분 센서가 있는 구성은 `moisture_aware`를 선택한다. 수분이 35 미만일 때만
   시작·유지한다. 35 이상이거나 센서 오류이면 정지한다.
5. 밸브와 펌프에 같은 관수 의도를 내고, `pump requires valve`를 적용한다.

`start`와 `stop`은 매 tick의 bool 샘플이다. 에지 이벤트가 아니다.
`low_water`는 공통 필수 센서이며, `moisture` 입력은 향상 전략 안에서만 선언한다.
수분 센서가 없는 구성에 가짜 수분값을 공급할 필요가 없다.

이 예제의 35는 드라이버가 정규화한 수분 지표의 임계값이다. 물리 단위 타입은
별도 확장이다. 기존 MVP 예제에서는 시작 신호가 수분 임계값을 우회하지만,
새 비교 예제에서는 시작할 때도 임계값을 적용하도록 의도적으로 바꿨다.

## A안 — YAML 중심 선언형

선언을 펼쳐 놓고 각 필드에 짧은 표현식을 넣는다. 장치 질의는 블록 문자열이다.

```yaml
module: irrigation
version: 1

input:
  start: bool
  stop: bool
  low_water: Result<bool, SensorFault>

state:
  watering: {type: bool, initial: false}

functions:
  latch: (start, stop, held) -> not stop and (start or held)
  is_dry: map(below(35)) >> recover(false)

strategies:
  basic:
    priority: 0
    device: |
      match (pump:actuator<bool>), (valve:actuator<bool>),
            (low_water:sensor<bool>)
    let:
      blocked: input.stop or (input.low_water |> recover(true))
    next:
      watering: latch(input.start, blocked, state.watering)
    intent:
      valve: next.watering
      pump: next.watering

  moisture_aware:
    priority: 10
    device: |
      match (pump:actuator<bool>), (valve:actuator<bool>),
            (low_water:sensor<bool>), (moisture:sensor<number>)
    input:
      moisture: Result<number, SensorFault>
    let:
      blocked: input.stop or (input.low_water |> recover(true))
      dry: input.moisture |> is_dry
    next:
      watering: dry and latch(input.start, blocked, state.watering)
    intent:
      valve: next.watering
      pump: next.watering

safety:
  requires:
    - [pump, valve]
```

YAML로 읽은 뒤 `functions`, `let`, `next`, `intent` 값은 GhostFlow 표현식으로
파싱한다. 임의 코드 실행은 없다. `state.initial`은 타입에 맞는 리터럴이다.

장치 목록과 설정을 편집하거나 폼 UI와 왕복시키기 좋다. 대신 로직이 길어지면
중첩된 설정 문서처럼 보이고, YAML 파싱과 표현식 파싱의 두 단계 오류 위치를
함께 보여줘야 한다. 데이터 모양이 같다는 것만으로 코드와 데이터의 의미가
같아지는 것은 아니며, 공통 타입 그래프가 그 연결을 맡는다.

## B안 — Literate CoffeeScript 중심 흐름형

설명 다음에 코드가 나오고, 편집기에서는 해당 코드 아래에 현재 값과 타임라인을
붙일 수 있다. 아래 바깥쪽 Markdown 전체가 하나의 문서형 소스라는 제안이다.

````markdown
# 관수

시작하면 자기유지한다. 정지·저수위·저수위 센서 오류는 시작보다 우선한다.

```ghost
module irrigation
version 1

input
  start: bool
  stop: bool
  low_water: Result<bool, SensorFault>

state
  watering: bool = false

latch = (start, stop, held) -> not stop and (start or held)
is_dry = map(below(35)) >> recover(false)
```

수분 센서가 없으면 시작·정지와 저수위 보호로 운전한다.

```ghost
strategy basic priority 0
  device
    match (pump:actuator<bool>), (valve:actuator<bool>),
          (low_water:sensor<bool>)

  let
    blocked = input.stop or (input.low_water |> recover(true))

  next
    watering = latch(input.start, blocked, state.watering)

  intent
    valve = next.watering
    pump = next.watering
```

수분 센서가 있으면 같은 의도를 수분 조건으로 강화한다.

```ghost
strategy moisture_aware priority 10
  device
    match (pump:actuator<bool>), (valve:actuator<bool>),
          (low_water:sensor<bool>), (moisture:sensor<number>)

  input
    moisture: Result<number, SensorFault>

  let
    blocked = input.stop or (input.low_water |> recover(true))
    dry = input.moisture |> is_dry

  next
    watering = dry and latch(input.start, blocked, state.watering)

  intent
    valve = next.watering
    pump = next.watering
```

출력 의도에는 다음 공통 제약을 적용한다.

```ghost
safety
  pump requires valve
```
````

일반 소스에서는 설명과 fence를 빼고 같은 코드를 쓴다. 함수 조합과 중간 신호가
직접 보이고, 코드·설명·실행 결과를 연결하기 좋다. YAML식 `name: type` 선언과
Cypher식 `match`가 이 문법 안에 들어간다.

CoffeeScript에서 문법 감각을 가져오지만 GhostFlow의 타입·tick 규칙을 따른다.
호출 괄호를 유지하고 들여쓰기 규칙을 고정하므로 식의 경계가 명확하다.
문서형 소스를 다루려면 Markdown 원본까지 연결되는 소스맵이 필요하다.

## C안 — Cypher 중심 질의형

각 전략을 `match → where → with → next → emit` 절로 읽는다.
장치 조건, 중간 계산, 상태 전이, 출력이 순서대로 눈에 들어온다.

```ghost
module irrigation version 1

input start: bool, stop: bool, low_water: Result<bool, SensorFault>
state watering: bool = false

let latch = (start, stop, held) -> not stop and (start or held)
let is_dry = map(below(35)) >> recover(false)

strategy basic priority 0
match (pump:actuator<bool>), (valve:actuator<bool>),
      (low_water:sensor<bool>)
with input.stop or (input.low_water |> recover(true)) as blocked
next watering = latch(input.start, blocked, state.watering)
emit valve = next.watering, pump = next.watering
end

strategy moisture_aware priority 10
match (pump:actuator<bool>), (valve:actuator<bool>),
      (low_water:sensor<bool>), (moisture:sensor)
where moisture.type is number
input moisture: Result<number, SensorFault>
with input.stop or (input.low_water |> recover(true)) as blocked,
     input.moisture |> is_dry as dry
next watering = dry and latch(input.start, blocked, state.watering)
emit valve = next.watering, pump = next.watering
end

safety
  requires pump, valve
end
```

`where moisture.type is number`는 `(moisture:sensor<number>)`의 타입 조건을
풀어 쓴 것이다. 여기의 `where`는 장치 프로파일을 검사하며 센서의 현재 값을
검사하지 않는다. `with`는 한 tick의 순수 계산, `next`는 다음 상태의 정의,
`emit`은 다른 안의 `intent`와 같다. `end`가 전략과 안전 블록을 닫는다.

Cypher나 Lua에서 그대로 실행되는 코드는 아니다. 여러 행을 갱신하는 DB 쿼리도
아니다. 이 초안의 `match`는 이름이 지정된 capability의 존재를 검사한다.

장치 질의와 그래프를 중심으로 읽기 좋다. 반면 전이식을 길게 조합할 때는 절이
늘어나고, 장치 선택과 매 tick 계산이 서로 다른 시점에 실행됨을 이해해야 한다.

## Meta Lua의 구문 확장은 어디에 들어가나

세 안 모두 AST를 공통 타입 그래프로 낮추는 구조이므로, 구문 확장을 특정 안에
독점시킬 필요는 없다. 다음은 B안 표기로 제시하는 별도 확장 스케치다.
위의 완전한 예제들은 일반 함수 `latch`를 사용하며 이 확장을 요구하지 않는다.

```ghost
syntax hold(start: Expr<bool>, stop: Expr<bool>, held: Expr<bool>)
  quote
    not $(stop) and ($(start) or $(held))

# strategy 안의 next 블록에서 사용
next
  watering = @hold(input.start, blocked, state.watering)
```

`quote`는 구문을 만들고 `$(...)`는 전달받은 구문을 끼운다. `@hold(...)`는
컴파일 시점에 확장한다. 이 표기는 GhostFlow 제안이며 Metalua 원문법을 복제하지
않는다. 단순 재사용에는 앞의 함수가 충분하고, 매크로는 새 도메인 표기나 구조를
생성할 때 사용한다.

확장은 호스트 컴파일러에서 끝나며 타입·순환·자원 검증을 다시 통과해야 한다.
생성한 이름은 호출자 이름을 포획하지 않고, 컴파일러는 원래 코드와 확장 코드를
함께 보여준다. 런타임에 파서를 올리거나 동적 `eval`을 실행하지 않는다.

## 동작 비교 기준

다음 기대값은 A/B/C 모두에 적용하는 사양 시나리오다. 아직 각 문법 파서로
실행해 검증한 결과가 아니다. 아래에서 `L`은 저수위 입력, `M`은 수분 입력이다.
각 행은 독립이며 `이전 상태`를 명시적으로 주입한다. `—`는 기본 전략의 입력
스키마에 해당 항목이 없다는 뜻이다.

| 전략 | 이전 상태 | start | stop | L | M | next.watering | valve / pump 의도 |
|---|---|---|---|---|---|---|---|
| basic | false | true | false | Ok(false) | — | true | true / true |
| basic | true | false | false | Ok(false) | — | true | true / true |
| basic | true | true | true | Ok(false) | — | false | false / false |
| basic | true | false | false | Ok(true) | — | false | false / false |
| basic | true | false | false | Err(Disconnected) | — | false | false / false |
| moisture_aware | false | true | false | Ok(false) | Ok(20) | true | true / true |
| moisture_aware | true | false | false | Ok(false) | Ok(20) | true | true / true |
| moisture_aware | true | true | false | Ok(false) | Ok(35) | false | false / false |
| moisture_aware | true | false | false | Ok(false) | Err(Stale) | false | false / false |
| moisture_aware | false | false | false | Ok(false) | Ok(20) | false | false / false |

`Err`인 입력은 복구값을 사용한 뒤에도 journal에 fault로 남는다. 센서 오류로
관수가 해제된 뒤 start가 false이면, 센서가 복구되어도 자동으로 자기유지 상태가
돌아오지 않는다. start가 계속 true이면 조건 회복 시 다시 시작할 수 있다.
버튼을 새로 눌러야만 재기동하도록 하려면 별도 에지/재무장 정책이 필요하다.

기본 장치 프로파일은 pump·valve·low_water를 제공한다. 여기에 moisture가
추가되면 두 전략이 모두 일치하되 우선순위 10의 전략을 고른다. 필수 low_water가
없으면 활성화 오류다. 향상 전략 실행 중 moisture가 고장 나면 Err 입력으로
정지하며, 기본 전략으로의 교체는 별도 프로파일 변경 절차를 따른다.

관수 예제에서는 두 출력이 항상 같아 `requires`가 개입하지 않는다. 제약 자체의
독립 검증 조건은 `pump=true, valve=false` 요청에서 pump가 false가 되는 것이다.
인터록 비교에는 별도 `mutex forward, reverse` 제약을 사용하며 두 요청이 동시에
true이면 두 최종 출력 모두 false여야 한다. 밸브 개방 명령이 실제 개방을
입증하지는 않는다. 실제 피드백을 요구하는 장치에는 별도 입력과 제약이 필요하다.

## 선택에 대한 제안

| 비교 항목 | A: YAML 선언형 | B: Literate 흐름형 | C: Cypher 질의형 |
|---|---|---|---|
| 먼저 보이는 것 | 구성과 필드 | 설명과 계산 흐름 | 장치 조건과 실행 절 |
| 함수 조합 | 표현식 문자열 안 | 코드의 중심 | with 표현식 안 |
| 시각 편집과 연결 | 폼/설정 편집에 유리 | 노트북/타임라인에 유리 | 장치 그래프에 유리 |
| 읽기 부담 | 깊은 중첩 | 들여쓰기와 문서 경계 | 절의 역할과 실행 시점 |
| 권장 용도 | 선언과 교환 형식 | 기본 작성 문법 | 장치 선택 표현 |

초기 추천은 B를 기본으로 두고, A의 선언 방식과 C의 장치 질의를 포함하는 것이었다.
Meta Lua의 코드 확장은 공통 컴파일 계층에 둔다. 세 파서를 모두 제품으로
구현하기로 결정한 것은 아니다. 이후 수식과 출력 연결 중심의 control 문법을
기본 방향으로 선택했으며, 이 비교는 설계 이력으로 남긴다.
