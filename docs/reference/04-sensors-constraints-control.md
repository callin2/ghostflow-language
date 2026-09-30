# 4. 센서, 제약과 제어

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전: 3. 시간과 일정](03-time-and-schedules.md) ·
[다음: 5. 설정과 관찰](05-settings-and-observation.md)

GhostFlow의 센서 값은 숫자 하나가 아니다. 값의 출처·품질·시각과 fault를 함께 다루며,
출력은 장치 명령이 아니라 먼저 요청 intent로 계산한다. 지역 제어식, 공유 자원 중재,
안전 제약, Driver 적용, 물리 feedback을 구분해야 센서 고장이나 여러 control의 경쟁을
숨기지 않고 설명할 수 있다.

이 장의 코드 표기는 다음처럼 읽는다.

- **선택된 GhostFlow 표기**는 현재 language surface에서 정한 문법이다.
- **설계 표기**로 명시한 예만 설명용이다. 이 장에서 선택 표기로 확정한 constraints,
  device query, objective, PI/PID, temporal evidence와 adaptation은 공개 문법으로 읽는다.

근거는 [공통 제약·센서 계약](../CONSTRAINTS.md), [선택 문법](../LANGUAGE-SURFACE.md),
[언어 설계 §5–8](../LANGUAGE.md), [Programming in GhostFlow 8장과 부록 A](../ProgrammingInGhostflow.md),
[#3](https://github.com/callin2/ghostflow-language/issues/3),
[#94](https://github.com/callin2/ghostflow-language/issues/94),
[#95](https://github.com/callin2/ghostflow-language/issues/95),
[#96](https://github.com/callin2/ghostflow-language/issues/96),
[#105](https://github.com/callin2/ghostflow-language/issues/105),
[#110](https://github.com/callin2/ghostflow-language/issues/110)이다.

## 4.1 sensor와 Result 품질

선택된 선언에서 sensor 타입은 정상 payload 타입이다.

```ghost
sensor low_water: Bool;
sensor moisture: Percent;
```

sensor를 읽은 실제 타입은 개념적으로 `Result<T, SensorFault>`다. 정상 샘플은
`ok(value)`, 오류는 `fault(reason)` 패턴으로 분기한다.

```ghost
let water_ok = case low_water {
  ok(low)  => !low;
  fault(_) => false;
};
```

초기 fault 집합은 다음 의미를 구분한다.

| fault | 의미 |
|---|---|
| `Disconnected` | 설치된 sensor의 연결 또는 전달 경로가 끊겼다. |
| `Stale` | 마지막 실제 유효 샘플이 freshness 한계를 넘었다. |
| `Invalid` | 값·단위·범위·encoding이 선언 계약에 맞지 않는다. |
| `NotReady` | 초기화, filter window 또는 연속 복구 조건이 아직 준비되지 않았다. |

Result를 Bool이나 Number처럼 직접 비교할 수 없다. 모든 fault를 하나의 0 또는 false로
암묵 변환하지 않는다. 위 예시에서 false는 작성자가 선택한 제어값이며 원래 fault와
그 시각은 기록에 남는다. `recover(default)`도 같은 의미의 순수 변환이다. `ok(x)`는
`x`, `fault(e)`는 payload와 같은 타입의 `default`를 반환하지만 fault를 정상으로
재분류하거나 sensor 복구 상태를 진행시키지 않는다.

exhaustive `case`와 정적으로 해석되는 Result transform을 함께 지원한다.

```ghost
fn normalize(value: Temperature) -> Result<Temperature, SensorFault> {
  ok(value)
}

let dry = moisture |> map(below(30%)) |> recover(false);
let normalized = temperature |> and_then(normalize);
```

`below(limit)`은 호환 ordered payload의 정적 단항 함수다. `map(fnName)`과
`and_then(fnName)`은 compiler가 이름으로 해석한 순수 함수만 받으며 runtime closure나 일반 HOF가
아니다. 전자는 `ok` payload를 `U`로, 후자는 `Result<U,SensorFault>`로 변환한다. `fault`는 함수를
호출하지 않고 그대로 전달한다. `recover(expr)`만 fault에서 같은 payload 타입의 명시 default를
반환한다. `|>`와 `>>`도 compile-time static chain이며 함수값이 아니다. 일반 user ADT는 추가하지
않지만 `Result<T,SensorFault>`는 함수 인자·결과에 쓸 수 있고 `ok(value)`/`fault(reason)` constructor를
지원한다. 모든 변환은 원래 fault/provenance를 journal/explanation에 남기고 recovery state를 진행하지 않는다.

**왜:** sensor fault를 0%나 false로 숨기면 정상적인 저수위, 실제 0 측정, 연결 끊김을
구분할 수 없다. 대체값과 원인을 함께 보존해야 보수적 제어와 사후 설명이 가능하다.

## 4.2 샘플 계약과 sensor 처리 순서

선택된 sensor 설정 표기는 다음과 같다.

```ghost
sensor moisture: Percent {
  sample = 1s;
  valid = 0% .. 100%;
  filter = median(5);
  stale_after = 3s;
  recover_after = 3 samples;
}
```

각 항목의 의미와 제약은 다음과 같다.

| 항목 | 타입·제약 | 의미 |
|---|---|---|
| `sample` | 양의 `Duration` | 기대 측정 간격 정보다. sensor를 읽는 thread나 timer를 만들지 않는다. |
| `valid` | payload와 같은 타입의 닫힌 범위 | filter 전에 raw 정상 후보를 검사한다. 범위 밖 값은 `Invalid`다. |
| `filter` | 상태 있는 signal 연산 | 새롭고 유효한 샘플에만 적용한다. |
| `stale_after` | 양의 `Duration` | 마지막 실제 유효 샘플 시각부터의 freshness 한계다. |
| `recover_after` | 양의 정수 `N samples` | fault 뒤 N개의 새 유효 샘플이 연속해야 복구 조건을 만족한다. |

Driver는 source ID, source epoch, sample ID, sample timestamp와 품질을 제공한다. 같은
물리 sample이 여러 tick에 반복돼도 filter window와 recovery counter에는 한 번만
들어간다. filter output을 다시 계산한 시각은 freshness를 갱신하지 않는다.

처리 순서는 다음과 같다.

```text
새 샘플 식별
  → payload/단위/valid 범위 검사
  → filter 상태 갱신
  → filter 준비 검사
  → stateful predicate(hysteresis 등)
  → quality/fault 보존
  → 작성자가 case/recover로 제어값 선택
```

명시적인 `Disconnected`와 `Invalid`는 즉시 전달한다. sample이 없으면 마지막 유효
값을 `stale_after` 전까지 사용할 수 있지만, 한계에 도달하면 `Stale`이다. 무제한
last-value hold는 기본이 아니다. 제한된 hold가 필요하면 duration과 `Held` quality를
명시하는 별도 정책이 필요하다.

fault 뒤 filter window는 비운다. filter 준비 조건과 `recover_after` 조건을 모두
충족하기 전에는 `NotReady`다. median(5)와 recover_after=3이면 최소 5개의 새 유효
샘플이 필요하다. source epoch 또는 time epoch가 바뀐 샘플을 이전 연속 sequence의
다음 정상 샘플로 세지 않는다.

기본 재부팅 의미는 sensor state와 freshness를 초기화하고 `NotReady`부터 다시
준비하는 것이다. persistent resume은 checkpoint의 source/time continuity를 검증하는
명시 opt-in이다. 오래된 정상값 하나를 즉시 복원해 허가에 사용하지 않는다.

## 4.3 filter와 signal 연산

### median

선택된 `median(n)`은 최근 `n`개의 유효한 새 payload를 정렬했을 때 가운데 값을
반환한다. `n`은 홀수 정수 `1..31`이다. window가 n개로 채워지기 전에는 partial
median을 정상값으로 내지 않고 `NotReady`다. fault/재초기화 뒤 window는 빈 상태다.

```ghost
filter = median(5);
```

예를 들어 `28%, 29%, 90%, 28%, 29%`의 median은 29%다. 하나의 spike가 판단을
지배하지 않는다.

### hysteresis

선택된 `hysteresis`는 sensor/result를 받아 품질을 보존하는 상태 있는 Bool signal을
만든다.

```ghost
signal dry = hysteresis(moisture,
  on_below: 30%,
  off_above: 35%,
  initial: false);
```

- 첫 인수는 ordered numeric/quantity `Result<T, SensorFault>`다.
- `on_below`와 `off_above`는 T와 같은 타입이다. `on_below < off_above`여야 한다.
- payload가 `on_below`보다 작으면 true로 전이한다.
- payload가 `off_above`보다 크면 false로 전이한다.
- 두 경계 사이와 경계값과 정확히 같은 경우에는 직전 판정을 유지한다.
- `initial`은 초기/복구 뒤 Bool 상태다.
- 입력 fault에서는 마지막 Bool을 정상 `ok`로 가장하지 않고 fault를 전달한다.

두 경계는 threshold 부근의 반복 ON/OFF를 막는다. 이 기억은 명시 signal state이며
숨은 host 보정값이 아니다.

### bounded signal 연산의 설계 계약

다음은 선택된 표기다.

```ghost
sensor moisture: Percent { filter = moving_average(3); }
sensor temperature: Temperature { filter = ema(alpha: 0.25); }
signal stable_start = debounce(start, stable_for: 2s, initial: false);
```

| 연산 | 필수 인수 | 상태와 결과 의미 |
|---|---|---|
| `debounce` | Bool/finite signal, 양의 안정 `Duration`, 초기값 | 입력 후보가 duration 동안 계속 같을 때만 안정값을 바꾼다. 안정값·후보값·후보 시작 단조 시각을 보존한다. |
| `moving_average(n)` | numeric Result, profile 상한 안의 양의 고정 정수 n | 최근 n개 유효 새 샘플의 산술평균. 빈/부분 window는 NotReady이며 최근 n개를 위한 유한 상태만 가진다. |
| `ema(alpha)` | numeric Result, 유한 `0 < alpha <= 1` | 첫 유효 샘플을 seed로 하고 `alpha*x + (1-alpha)*previous`를 계산한다. recover 조건 전에는 정상 결과를 내지 않는다. |
| `stale_after(d)` | timestamped Result, 양의 Duration | 마지막 실제 유효 sample age가 d에 도달하면 Stale. 재평가나 filter output 시각으로 연장하지 않는다. |

`filter`는 한 연산만 받는다. 여러 단계를 합성하려면 각 단계를 이름 있는 `signal`로 선언한다.
Temperature filter는 payload를 canonical kelvin domain의 affine weighted mean으로 내부 계산한다.
이는 source 식에 Temperature+Temperature 또는 absolute temperature scalar 곱셈을 허용하지 않는다.
보호 신호와 완만한 환경 sensor에 같은 filter delay를 일괄 적용하지 않는다. 각 연산은
고정된 상태 크기와 계산 상한을 가져야 한다. 새 sample에서만 갱신하며, 여러 연산을
합성해도 `case`나 `recover` 전까지 quality를 보존한다.

**왜:** filter가 센서 품질을 지우거나 tick 횟수만큼 같은 sample을 재사용하면 평활화가
고장을 숨기고 replay 결과도 달라진다. 이름 있는 유한 상태는 지연과 자원 비용을 검토할
수 있게 한다.

## 4.4 temporal evidence

센서 판단의 시간 증거는 schedule의 `within`과 구분한 다음 선택 표기를 쓴다.

```ghost
signal hot_5m = true_for(hot, duration: 5min, quality: measured);
signal opened = after_event(started, valve_open, window: 10s, quality: measured);
input selected_start: EventId;
output selected_opened, any_opened, all_opened: Bool;
selected_opened <- after_event_for(opened, selected_start) |> recover(false);
any_opened <- after_event_any(opened) |> recover(false);
all_opened <- after_event_all(opened) |> recover(false);
signal avg_temp = window_average(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal low_temp = window_min(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal high_temp = window_max(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal warming = window_rate(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal usable_temp = hold_last(temperature, for_at_most: 2min, quality: measured);
```

- `true_for`는 admissible true가 양의 duration 동안 끊기지 않은 증거다. false 또는 허용되지
  않은 quality에서 reset하고 경계에 도달한 첫 판단에 true다. 연속성은 Driver가 실제
  관측되었다고 인증한 interval만 이어 붙인다. 서로 떨어진 sample 사이를 보간하거나
  expected cadence, scan cadence, duplicate, clock-only tick을 관측 증거로 간주하지 않는다.
- `after_event`는 식별된 event 시각 `e`부터 `[e,e+window)` 안에서 predicate가 성립했는지
  event identity별로 계산한다. 정확한 종료 경계는 제외한다. 겹치는 event도 identity별
  result를 독립적으로 유지하며 새 start event가 이전 pending 또는 completed result를
  덮어쓰지 않는다.
- `after_event` signal 자체는 scalar 값이 아니며 Bool 식에서 직접 읽을 수 없다.
  현재 compiler는 명시적인 `after_event_for`, `after_event_any`, `after_event_all`
  투영과 runtime binding이 있는 경우 실행 control로 내린다. 투영 없는 선언은
  실행 control로 받아들이지 않는다.
  `after_event_for(signal, identity)`는 하나의 `EventId`를 명시적으로 선택한다. runtime은
  identity의 source tag가 signal의 Event source와 같은지 검사하며, 다른 source의 identity는
  false로 바꾸지 않고 scan을 identity binding 오류로 거부한다. `EventId`는 Driver가 전달한
  불투명한 identity이며 source에서 임의의 숫자나 최신 event로 만들지 않는다.
- `after_event_any(signal)`과 `after_event_all(signal)`은 accepted scan의 immutable retained
  identity 집합 전체를 집계한다. `any`는 하나라도 satisfied이면 true이고, 모두 expired일 때만
  false다. `all`은 하나라도 expired이면 false이고, 모두 satisfied일 때만 true다. 빈 집합이나
  결과를 바꿀 수 있는 pending identity가 남아 있으면 `NotReady`다. 결정적인 true/false가 없는
  경우 원래 predicate/source fault를 `NotReady`보다 우선하여 보존한다. 각 함수의 결과 타입은
  `Result<Bool, SensorFault>`이며 `recover(false)` 같은 fallback은 작성자가 명시한다.
- retained identity 수는 runtime profile의 고정된 finite capacity로 제한한다. pending이나 terminal
  identity를 암묵적으로 evict하거나 새 start로 덮어쓰지 않는다. capacity 초과는 scan 전체를
  원자적으로 거부한다. terminal result는 host가 해당 identity를 명시적으로 acknowledge할 때까지
  addressable하고, pending identity는 acknowledge할 수 없다.
- `window_average/min/max`는 `(t-d,t]` 안의 admissible 실제 관측만 사용하고 보간하지 않는다.
  admissible 관측이 없거나 최신 관측 age가 `max_age` 이상이면 `NotReady`다.
- `window_rate`는 window의 가장 이른 admissible 관측과 가장 늦은 admissible 관측으로
  `(last-first)/(lastTime-firstTime)`을 계산한다. 서로 다른 두 시각이 없으면 `NotReady`다.
  지원되는 ordered numeric payload `Q`에 대해 결과는 식 전용 `Rate<Q>`다. Temperature의
  차이는 canonical ΔK이고, linear quantity는 같은 nominal quantity의 canonical difference를
  쓴다. `window_rate`를 선언하는 `signal` 이름으로 결과를 참조할 수 있다.
  `Rate<Q>`에는 직접 literal·일반 값 binding·config/state/input/output 저장·자유 산술이 없다.
  비교 임계값은 `rate(delta: <Q difference>, time: Duration)`로만 만든다. v1의
  RelativeHumidity·CO2·Acidity는 `window_rate` 입력이 아니다.
- `hold_last`는 마지막 admissible payload를 sample timestamp부터 `for_at_most` 미만까지만
  제공한다. runtime/trace는 `quality=Held`, source sample ID와 age를 기록한다. `Held`는 source
  constructor나 `Measured`가 아니다. 정확한 경계에서는 hold가 끝난다.

### 시간창의 타입과 출처

측정 기반 시간창은 `Result<T, SensorFault>`를 받아 관측이 충분할 때 성공한
Result를 반환한다. `window_min/max`의 T는 `Int`, `Number`, `Percent` 또는
물리량 타입이며 결과는 같은 T다. `window_average`는 같은 타입들을 받고,
`Int`의 평균은 소수 부분을 보존하는 `Number`다. 나머지는 원래 타입을 보존한다.
절대 온도의 평균은 canonical K 값으로 계산한다. Bool·enum·Duration·달력 타입은
이 수치 시간창의 payload가 아니다. `window_rate`의 입력 타입은 2장의
[`Rate<Q>` 규칙](02-types-expressions-state.md#29-물리량과-단위)을 따른다.

`over`와 `max_age`는 양의 상수 Duration이다. 실제 관측의 원본 source·epoch·sample
ID·timestamp를 보존하며 중복 수신이나 같은 관측의 재평가를 새 기여로 세지 않는다.
일반적인 상류 fault는 아직 창 안에 있는 관측을 지우지 않는다. 따라서 충분히
신선한 기록이 있으면 집계값을 계속 제공할 수 있으며, 가려진 fault와 출처도
관찰 기록에 남긴다. 원본 source epoch가 바뀌면 그 source의 기존 기여는 무효다.

집계값의 출처는 시간창 선언, 평가 시각과 실제 기여 관측 집합이다. 이를 센서가
직접 측정한 단일 sample로 표시하지 않는다. 변환이나 분기는 이 집계 출처를
유지하며 임의의 물리 sample ID를 만들어 붙이지 않는다. 후속 시간창도 원본
관측과 집계 결과의 식별자를 구분해야 한다.

**Why:** 정수 평균을 반올림하거나 다른 물리량으로 바꾸면 제어 임계값의 의미가
달라진다. 관측의 출처와 유효 창을 보존해야 통신 재전송이 평균에 가중치를 더하거나
일시적인 오류가 유효한 과거 관측을 지우는 일을 막을 수 있다.

### 시간창의 합성

시간창의 결과를 다른 시간창의 입력으로 사용할 수 있다.

```ghost
signal short_average = window_average(temperature, over: 2min,
  quality: measured, max_age: 1min);
signal long_average = window_average(short_average, over: 10min,
  quality: measured, max_age: 2min);
```

- 상류 시간창에 새 관측이 받아들여져 성공한 집계 결과를 만들 때만 후속 시간창에
  새 집계 관측을 제공한다. 재평가, 관측 만료, 분기 선택 변경이나 fault 변화만으로는
  새 관측을 만들지 않는다. 만료로 바뀐 현재 집계값은 일반 식에서 읽을 수 있다.
- 집계 관측의 식별자는 같은 프로그램·strategy·실행 안의 시간창 선언과 관측 수용
  revision이다. 물리 sample 식별자와 구분한다. 후속 시간창은 선택하지 않은 상류의
  revision도 기억하므로 분기를 바꿔 이미 생성된 집계값을 새 관측으로 다시 세지 않는다.
- 집계 관측 시각은 그 결과에 기여한 가장 최신 원본 관측 시각이다. 평가 시각은 별도로
  보존한다. 늦은 계산이나 재계산으로 `max_age`의 기준 시각을 갱신하지 않는다.
  서로 다른 집계 관측은 같은 관측 시각을 가질 수 있다.
- 후속 평균에서 각 집계 관측은 같은 가중치의 한 항이다. 중첩 평균을 원본 sample들의
  단일 평균으로 바꾸지 않는다. 각 항이 참조한 원본 관측은 출처 증거로 보존한다.
  예를 들어 상류 평균이 차례로 0, 5, 15를 제공했다면 후속 평균은 `20 / 3`이다.
- `quality: measured`는 원본 기여 관측이 모두 허용되는 측정인 집계 증거를 받는다.
  집계값 자체의 품질은 `Derived`다. `map`, `and_then`, Result 분기는 선택한 증거를
  보존한다. `Held`나 `ok(...)`로 만든 값에 측정 출처를 새로 부여하지 않는다.
- 원본 source epoch가 바뀌면 해당 과거 epoch에 의존하는 집계 관측 전체가 무효다.
  A와 B를 평균한 값에서 A의 출처만 지우고 기존 평균값을 유지할 수 없다.
  B에만 의존한 별도 관측은 유지한다.
- 한 판단이 실패하면 집계 관측, revision과 후속 시간창의 수용 기록도 함께 되돌린다.
  동일한 관측을 재시도할 때 누락되거나 두 번 세어지지 않아야 한다.

최대 보존량은 상류 시간창의 과거 관측과 각 집계 관측의 출처 증거까지 포함한다.
같은 최신 관측 시각을 가진 여러 집계값을 하나로 합치거나, 예산에 맞추려고 유효한
관측을 조용히 버릴 수 없다. 필요한 보존량을 증명할 수 없으면 활성화를 거부한다.

**Why:** 집계의 합성은 이미 계산된 결과들을 다시 계산하는 의미를 가진다.
원본 관측을 펼쳐 다시 평균하면 각 집계에 주어진 가중치가 달라진다. 관측 수용과
평가를 구분해야 scan 횟수나 분기 전환이 평균에 영향을 주지 않는다. 원본 시각과
출처를 유지해야 오래된 관측이 재계산만으로 신선해지지 않는다.

### `hold_last`의 값과 출처

`for_at_most`는 양의 상수 Duration이다. 측정 기반 `hold_last`는
`Result<T, SensorFault>`의 마지막 admissible 관측을 보관하고 같은 Result 타입을 반환한다.
보관할 관측이 없거나 유효 시간이 끝나면 `fault(NotReady)`다. 성공한 결과는 관측을
받은 즉시에도 `Held`다. `map`, Result 분기와 후속 변환은 이 출처를 `Measured`로
승격하지 않는다. `ok(...)`나 `recover(...)`로 만든 값도 새 측정 증거가 되지 않는다.

일반적인 센서 fault나 입력 식의 분기 변경은 보관된 값을 지우지 않는다. 예를 들어
A의 유효값 다음에 B의 fault를 선택하면 A의 원래 sample ID와 timestamp를 유지한다.
새 admissible 관측이 들어오면 그 관측의 payload와 출처로 교체한다. 재전송, 중복 sample,
캐시된 정상값의 재조회는 보관 기한을 연장하지 않는다. 보관된 값의 원본 source epoch가
바뀌거나 시간 연속성을 잃으면 그 보관값은 더 이상 사용할 수 없다.

trace에는 실제로 반환한 보관값의 `Held` 표시, 원본 source·epoch·sample ID·timestamp와
현재 age가 남는다. 보관값 때문에 가려진 상류 SensorFault도 그 오류와 출처를 남긴다.

**Why:** 제한된 시간 동안 마지막 측정값을 사용하는 선택과 새로 측정했다는 주장은
다르다. 원래 측정 시각과 출처를 보존해야 재조회로 유효 기한이 늘어나거나 보관값이
후속 제어의 측정 증거로 재사용되는 일을 막을 수 있다.

### 공통 품질과 관측 규칙

`quality`는 생략할 수 없다. estimated evidence를 허용하면 source/types가 정한 uncertainty
상한도 함께 쓴다. window 연산의 `max_age`는 양수이며 필수다.

모든 window는 과거와 현재만 사용한다. 미래 sample을 simulation에서 미리 보지 않는다.
sample이 09:00에 25°C, 12:00에 31°C 두 개뿐이라면 2시간 동안 30°C 초과였다고
단정할 수 없다. `require measured`, 허용된 estimate uncertainty, `max_age` 같은
quality policy와 결합해야 한다.

missed scan은 관측을 만들지 않는다. compiler는 duration, max_age, sample 계약과 runtime
profile에서 최대 보존 sample 수를 계산해야 하며 계산할 수 없으면 활성화를 거부한다.
checkpoint 복원은 source/time continuity를 검증한 경우만 허용하고 그렇지 않으면 NotReady다.

### 추정값 근거와 연속성

추정값은 명시된 model이 산출한 값이며 sensor 관측이나 적용·확인된 출력 사실이 아니다.
`Result<T, SensorFault>`는 선언된 sensor 값의 유효성 또는 고장을 표현한다. `ok(value)`는
source 값이 계약상 유효하다는 뜻이지 계산 결과가 측정되었거나 물리적으로 확인되었다는
뜻이 아니다. `Estimated`는 개념적인 근거 출처이며 새 `Result` 상태, `Quality` 변형 또는
실행 syntax를 추가하지 않는다.

추정값을 해석하려면 model과 calibration parameter revision, runtime reference의 정체성과
설정 방법·operator/source, source/program과 설치 binding revision, run과 monotonic time epoch,
근거가 된 source/application receipt history, 명시한 산출 basis를 함께 보존한다. actuator
진행 추정의 첫 basis는 Device가 실제로 수락한 output register/write history다. Device의 ACK는
driver가 그 register/write를 수락했다는 뜻일 뿐 motor가 움직였거나 position이 확인되었다는
뜻이 아니다. 요청 시각을 basis로 선택할 수는 있지만 requested history로 명시해야 하며
applied history와 바꾸어 쓰지 않는다. 이 구분은 §4.7의 요청·safe·applied·confirmed 경계를
따른다. 보존할 참조와 history는 선언된 deployment profile의 유한한 bound 안에 있어야 한다.
필요한 bound를 지원할 수 없으면 무제한 MCU history를 만들지 말고 해당 사용을 거부한다.

추정 interval은 admissible하다고 선언된 runtime reference와 qualifying receipt/history에서만
시작한다. cached receipt를 다시 읽거나 다른 scan에서 노출해도 새 write나 새 evidence가
만들어지지 않으며 origin/start, freshness 또는 uncertainty를 reset하지 않는다. 검증된 연속
history가 있을 때만 정상적인 monotonic time 평가에 따라 estimate가 진행될 수 있다. 연속
산출에는 필요한 history 전체가 있어야 한다. 관측되지 않은 gap, 실패 또는 불확실한 write를
가로질러 interpolate하지 않는다. 특히 새 write가 실패하면 이전 cached ACK는 원래 identity를
지닌 과거 receipt로 남고 현재 applied-target history는 불확실하다. 과거 ACK만으로 적용 상태가
계속 유지되었다고 추정하지 않는다.

reboot/run·time epoch, source epoch, installation binding, model/calibration revision 또는
runtime reference의 변경은 live estimate의 continuity를 끊는다. 소유자가 명시한 검증으로
연속성을 재수립한 경우에만 계속 사용할 수 있다. calibration parameter는 reboot 뒤에도
남을 수 있지만 runtime position reference와 estimate는 자동 복원되거나 0으로 초기화되지
않는다. 필요한 basis가 없거나 검증할 수 없으면 현재 estimate는 unavailable/NotReady다.
명시적으로 발생한 기존 source/time fault는 원래 fault로 보존한다. 둘 다 0이나 자동 fallback으로
바꾸지 않는다. timer-only 정책은 estimate가 unavailable이어도 유효하며 estimate를 요구하지
않는다.

불확실성이 알려지지 않았다면 unknown으로 남긴다. model/source는 known uncertainty bound 또는
불확실성이 unknown이라는 점을 명시해야 한다. 따라서 불확실성을 모르는 estimate도 보존하거나
표시할 수 있지만, bounded temporal operator에 자동으로 들어갈 수는 없다. 보편적인 formula,
confidence, uncertainty 숫자, duration 또는 expiry를 정하지 않는다. 기존 `quality: measured`,
`hold_last`, `true_for`의 measured admission은 바뀌지 않는다. 향후 estimated evidence를 받는
temporal consumer는 해당 source/type을 명시적으로 허용하고 선언된 uncertainty bound를 요구해야
한다. unknown uncertainty를 조용히 허용해서는 안 된다.

연속 예: 명시적으로 설정한 runtime reference, 같은 model/calibration/binding, 같은 run/time
epoch와 profile bound 내 gap 없는 qualifying write history가 있으면 선택된 model이 estimate를
산출할 수 있다. 그 결과는 계속 estimate이며 Driver ACK만으로 실제 움직임을 주장하지 않는다.
단절 예: applied-history basis에서는 ACK 없는 요청, 실패하거나 불확실한 새 write, reboot 또는
identity/revision 변경 뒤 새로 검증된 reference가 생기기 전까지 live estimate가 unavailable이다.
별도로 선언된 requested-history basis는 그 요청을 추정 가정으로 쓸 수 있지만 applied history로
표시하지 않는다. calibration parameter와 이전 estimate는 각각의 정체성을 유지한 이력으로
남는다.

이 계약의 추정 의미는 GhostFlow [#383](https://github.com/callin2/ghostflow-language/issues/383),
후속 compatibility 작업은 [#385](https://github.com/callin2/ghostflow-language/issues/385),
calibration/reference는 [System #132](https://github.com/callin2/farm_studio_system/issues/132)와
[해당 architecture contract](https://github.com/callin2/farm_studio_system/blob/241643c125439c1ec141c8596feec3f4ad143ade/docs/architecture/INPUT-DRIVER-ARCHITECTURE.md#calibration-parameters-and-position-reference--system-132)에
연결된다. Device output receipt의 구체 경계는 draft [PR #107](https://github.com/callin2/farm-device/pull/107)
head `b85ef02fb546cd5f957c12ab66f091b90f9484f0`의
[host observation source](https://github.com/callin2/farm-device/blob/b85ef02fb546cd5f957c12ab66f091b90f9484f0/rust/firmware/src/host_observation.rs)를
참조한다. 현재 `sensorSample` lowering은 measured provenance를 code `1`로 표시한다. runtime
`Measured`/`Held`/`Constructed` 분류는 바뀌지 않으며 `Estimated`를 표현하지 않는다.
Estimate를 소비하는 실행 지원은 #385에서 별도 compatibility를 정하기 전까지 이 계약의
범위가 아니다.

[유한한 estimate-basis admission API](../ESTIMATE-EVIDENCE.ko.md)는 유효성,
출처, 선언된 완전한 history를 구분한다. 승인된 basis는 측정이나 temporal 권한을
부여하지 않는다. source 선언과 모델 선택은 별도의 compatibility 결정이다.

## 4.5 선택 sensor와 capability

```ghost
sensor moisture?: Percent;
```

`?`는 해당 sensor capability가 설치 profile에서 선택적이라는 선언 정보다. 이는
설치되지 않음과 설치된 sensor의 fault를 합치지 않는다.

- `Option<T>` 또는 capability absence: 장치 구성에 그 능력이 없다.
- `Result<T, SensorFault>`: 설치된 sensor를 읽었지만 정상/오류 중 하나다.

`?`만으로 대체 전략이 생기지 않는다. absence에서는 기본 schedule을 사용하고,
presence에서는 moisture를 보정에 사용하는 식의 adaptation은 별도 strategy 계약이
필요하다. 일시적인 Disconnected를 absence branch로 보내서는 안 된다.

optional capability 보호는 4.6절의 `adapt`/`strategy` 표면만 쓴다. 이전 `has` 스케치는
v1 문법이 아니다. optional role은 해당 role을 match한 strategy 안에서만 읽을 수 있고,
그 안에서도 `ok/fault` 분기가 필요하다. `?`와 `adapt`는 fault 발생 시 다른 strategy로
자동 전환하거나 기본값을 생성하지 않는다.

압력, 유량, pump curve, 전력, pipe loss 같은 장치 부가정보도 optional이다. 없다는
사실을 0, 무한 용량, 정상값으로 바꾸지 않는다. 기본 관수와 명시된 valve count/time
인터록은 그런 정보 없이 쓸 수 있다. 선택 분석은 `Pass | Violation | Unknown(reason)`을
반환하며, 정보 부족은 Unknown이다.

## 4.6 device query와 strategy 선택

다음은 선택된 control 문법이다.
현재 compiler는 typed `match`와 `match always`를 받는다. `where`와 type을 생략한
presence-only match는 아직 지원하지 않는다. 아래 `where` 예시는 설계 표기다.

```ghost
adapt irrigation_policy {
  strategy WithMoisture priority 100
    match (moisture: sensor<Percent>)
    where moisture.type == Percent {
      let request = case moisture {
        ok(value) => scheduled && value < 30%;
        fault(_) => false;
      };
      pump <- request;
    }

  strategy Baseline priority 0 match always {
    pump <- scheduled;
  }
}
```

profile은 semantic capability의 유한 집합이다. 초기 key는 `(kind, name, type)`이며
같은 `(kind, name)`은 중복할 수 없다.

- 문법은 `strategy Name priority Int match (...) [where ...] { ... }`와 `match always`다.
- 각 match 항목은 capability 존재 조건이고 쉼표는 AND다.
- `pump`, `moisture`는 semantic role 이름이다. DB의 여러 행을 순회하는 변수가 아니다.
- `sensor<number>`는 정상 payload type이고 실제 sample은 Result다.
- `(moisture:sensor)`처럼 type을 생략하면 존재만 검사한다.
- `where`는 match된 capability의 kind/name/type, 상수 비교, Bool `&&`, `||`, `!`, `==`, `!=`만 읽는다.
- `where`는 input sample, state, next state, 현재 moisture 값을 읽지 않는다. capability
  선택과 매 tick 제어 판단을 섞지 않는다.

각 strategy는 i32 literal priority를 가진다. 모든 strategy는 control의 같은 외부 output
계약을 완전하게 정의한다. 일치한 strategy 중 가장 큰 priority 하나를
선택한다. 최고 priority가 동률이면 ambiguity error다. 일치 strategy가 없으면 activation
error다. 선언 순서나 마지막 일치가 이기지 않는다.

공통 input은 모든 strategy에 필요하다. strategy input은 그 strategy가 선택된 경우에만
필요하다. 선택된 strategy의 capability와 port type을 profile에서 검사한다. tick 중간에
profile을 바꾸지 않는다. 새 profile은 후보 전체와 strategy 선택을 검증한 뒤 경계에서
원자적으로 적용한다. 현재 strategy의 sensor fault는 즉시 Result로 처리하고, 이를
profile absence로 바꿔 더 낮은 보호 strategy로 자동 전환하지 않는다. `match always`도
일반 후보일 뿐 암묵 fallback이 아니다.

**왜:** 설치 능력 선택을 현재 sensor 값과 섞으면 같은 profile에서도 매 tick binding이
바뀔 수 있다. 유일한 strategy와 경계 적용은 장치 구성이 바뀌어도 판단의 출처를 남긴다.

## 4.7 requested, safe, applied, confirmed

제어 결과는 다음 단계를 구분한다.

```text
sensor/input + 이전 state
  → requested output intent
  → arbitration과 constraints
  → safe/effective intent
  → Driver가 적용한 command
  → feedback으로 confirmed state
```

선택된 출력 연결은 requested intent를 정의한다.

```ghost
output pump, valve: Bool;
valve <- running';
pump <- running';
require pump => valve;
```

`require pump => valve`는 pump=true가 허용되려면 valve=true여야 한다. prerequisite가
false이면 target pump를 false로 만든다. 출력 제약은 false를 true로 만들지 않는다.
`require !(forward && reverse)` 또는 mutex는 동시에 true인 충돌 그룹을 모두 false로
만든다. 여러 Bool constraint는 같은 candidate snapshot에서 차단 대상을 계산하고,
변경이 없을 때까지 false 방향으로만 반복한다. 선언 순서에 따라 결과가 달라지지 않는다.

이 결과는 safe intent다. GPIO/relay를 실제로 적용했다는 증거도, valve가 실제로
열렸다는 증거도 아니다. applied command와 encoder, limit switch, vision estimate 등의
confirmed feedback은 출처와 품질을 따로 가진다.

**왜:** 요청, 제약 결과, 장치 적용, 물리 결과를 한 Bool로 합치면 출력이 차단된 이유와
장치 불일치를 설명할 수 없고 사용량 accounting 대상도 모호해진다.

## 4.8 공통 constraints 표기와 연산

다음 `constraints` 블록은 선택된 설계 표기다. 규칙은 안정적인 설비 ID와
유한한 port/resource 집합에 bind한다. 현재 resource-policy named parser는
`constraints Name for resource { exclusive at admission { ... }; require at safe_output ...; }`
만 받는다. 이 문법은 resource binding과 runtime enforcement가 없으면 실행 control로
내려가지 않는다. `ghostrules`의 standalone parser는 별도
`constraints Name { ... }` 문법으로 `exclusive(...)`, `allow`, `limit`, `once`,
`check`를 검증한다. control 안의 accounting 제약은 또 다른
`constraints Name { limit used(account, basis) <= bound { ... } }` 형태다(§3.10).
세 형태의 결과를 같은 실행 계약으로 간주하지 않는다.

```ghost
constraints StationRules for station {
  exclusive at admission { automatic, manual, configuring };
  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  require at safe_output count_on({ valve1, valve2, valve3 }) <= 2;
  require at safe_output pump1.on => any_on({ valve1, valve2, valve3 });
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
  warn low_margin when remaining_budget < 5min;
}
```

### 제약문의 의미

| 표기 | 인수 | 적용 단계와 의미 |
|---|---|---|
| `exclusive at admission { a, b, ... }` (resource-policy); `exclusive(a, b, ...)` (`ghostrules`) | 같은 scope의 mode/activity 2개 이상 | 동시에 활성화하지 않는다. 충돌하는 새 진입을 거부하고 기존 상태를 유지한다. |
| `allow enter(M...) only when p` (`ghostrules`) | 유한 mode 집합과 Bool 전제 | mode 진입 요청 시 p를 검사한다. stop 요청 자체를 막지 않는다. 현재 parser의 `p`는 정확히 `mode == Stopped && stopped(station)` 형태다. |
| `require p` | 출력/허가 단계가 정해진 Bool 불변조건 | 시작 전 허가와 실행 중 감시에 모두 쓰며 Unknown을 통과로 보지 않는다. |
| `limit q <= bound per basis` | typed quantity, 같은 타입 bound, day/window basis | 남은 예산을 검사하고 한도 경계에서 추가 동작을 차단한다. |
| `once schedule per occurrence` | schedule ID와 occurrence identity | 같은 occurrence의 재접수를 막는다. 시간 budget과 별도 ledger다. |
| `check analysis(args)` | optional 정보에 의존하는 analysis | `Pass/Violation/Unknown`을 내는 비차단 분석이다. |
| `warn id when p` (설계) | 안정적인 경고 ID와 Bool | 결과를 바꾸지 않고 원인·대상과 함께 진단 event를 낸다. 현재 두 parser 모두 받지 않는다. |

현재 named parser의 target은 `exclusive`의 `admission`과 finite-set `require`의
`safe_output`이다. `monitor`는 선택된 설계 target이며 현재 parser가 받지 않는다.
기존 control 내부의 target 없는
Bool `require`는 `safe_output`을 뜻한다. 각 규칙은 적용 단계를 가진다. 출력 관계를 mode 진입 규칙처럼 처리하거나, 비차단
check를 safety require로 암묵 승격하지 않는다. 필수 제약은 모두 AND로 만족해야 한다.
arbitration은 허용 영역 안에서 어떤 요청을 채택할지 정하는 별도 정책이다. priority
점수로 필수 제약을 완화하지 않는다.

### 공통 함수

| 함수 | 입력 | 결과와 규칙 |
|---|---|---|
| `count_on(xs)` | 유한 Bool output/resource 집합 | final candidate에서 true인 서로 다른 항목 수 `Int`. 같은 물리 항목을 중복 세지 않으며 빈 집합은 0이다. |
| `any_on(xs)` | 명시된 유한 Bool 집합 | 하나 이상 true이면 Bool true. 빈 집합은 false다. |
| `on_time(resource)` | 안정적인 물리 resource ID와 명시 accounting stage | 해당 resource의 합쳐진 ON Duration. 여러 control의 겹친 요청을 이중 계수하지 않는다. |
| `stopped(station)` | station ID | 진행 session과 정리 절차가 끝나고 사용권이 반환됐으며 요구된 stop evidence를 충족했는지 나타낸다. 단순 pump=false가 아니다. |
| `pump_capacity(pump)` | pump ID, 해당 profile의 optional capacity context | `Pass/Violation/Unknown(reason)`. 요청 전체를 같은 조건의 pump/system model과 비교한다. |

`pump_capacity`의 flow와 pressure를 단순히 합하거나 서로 비교하지 않는다. 같은 검증
조건의 `flow_budget`과 zone `demand_flow`처럼 단위가 맞는 모델만 사용한다. 정보가
부족하면 Unknown이다. `check pump_capacity`는 운전을 차단하지 않는다. 작성자가
`require pump_capacity(pump1) == Pass`를 명시한 경우에만 Violation과 Unknown이 새
시작을 막는다.

**왜:** 불변조건, 진입 허가, 사용량 한도와 비차단 분석은 위반 때 해야 할 일이 다르다.
한 종류의 Bool 필터로 합치면 Unknown을 통과시키거나 분석 경고를 운전 정지로 바꾸게 된다.

집합 literal은 `{ item, ... }`이며 compile-time 유한 목록이다. physical binding 뒤 같은
endpoint의 alias는 한 번만 센다. binding 전후 distinct identity가 달라지면 activation
diagnostic에 두 목록을 모두 제시한다. 빈 집합 결과가 허가를 뜻해야 한다면 작성자가 별도
`require`로 그 정책을 명시한다.

## 4.9 공유 자원과 arbitration

여러 control이 같은 물리 pump를 쓰면 resource manager가 유일한 최종 작성자다.
개별 control의 pump output은 요청이다. 비활성 control의 false나 마지막 write가
현재 소유자의 pump를 끄지 않는다.

기본 공유 pump 정책은 전체 session의 배타 lease다. valve pre-open, pump ON,
단계 사이 pump OFF, valve 정리와 stop 확인이 끝날 때까지 소유권을 유지한다. 잠깐
pump가 꺼졌다는 이유로 다른 control에 넘기지 않는다.

같은 tick의 시작 요청은 하나의 snapshot에서 평가한다. resource lease와 time budget을
함께 예약할 수 있는 요청만 admit한다. 접수 순서와 안정적인 request ID 같은 명시
정책으로 결정하며, queue length와 expiry는 bounded다. shared concurrent operation과
preemption은 opt-in 정책이다.

일반 arbitration은 authority와 제약의 의미를 드러내야 한다. 다음은 설계 범주다.

1. safety constraint,
2. manual authority,
3. automatic control objective,
4. adaptive/optimizer proposal.

이 목록이 모든 설비에서 단순 고정 priority라는 뜻은 아니다. 최종 값을 선택한 policy와
revision, 각 요청, constraint clamp를 trace에 남겨야 한다.

```text
temperature objective requested vent 70%
humidity objective requested vent 40%
arbitration selected 70% under policy P
wind safety limited maximum to 20%
final safe target 20%
```

공유 자원은 다음 선택 표기로 선언한다. queue와 preemption에는 기본값이 없다.

```ghost
resource pump1: BoolActuator;
resource_policy shared_pump for pump1 {
  lease = session;
  concurrency = 1;
  admission = reserve_all;
  queue = fifo(max: 8, expires_after: 10min, tie: request_id);
  preempt = never;
}
```

첫 표면의 lease는 `session`이다. `concurrency`는 양의 정적 정수이고 capability 상한 이하다.
`reserve_all`은 lease와 필요한 budget을 같은 snapshot에서 모두 확보할 때만 admit한다.
queue는 `reject`, `fifo(max:N, expires_after:D, tie:request_id)`,
`authority_then_fifo(max:N, expires_after:D, tie:request_id)` 중 하나를 반드시 쓴다.
`N`과 `D`는 양수다. FIFO key는 영속 accept position, 동률은 stable request ID byte order다.
overflow와 expiry는 명시적 occurrence이며 숨은 retry가 없다.

preemption은 `never` 또는
`higher_authority(cleanup: required, resume: requeue|cancel)` 중 하나를 작성한다. 여기서
`requeue|cancel`은 문법 대안을 뜻하며 실제 소스에는 하나만 쓴다. 선점도 cleanup, stop evidence,
safety constraint를 우회하지 않는다. continuous request 선택 정책은 `exclusive`,
`highest_authority`, `min`, `max` 중 하나를 자원에 명시하며 policy revision과 모든 request를 trace한다.

## 4.10 mode와 live settings

Auto, Manual, Configure 같은 mode는 같은 설비 scope에서 배타적이다. Auto↔Manual,
운전→Configure 전환은 다음 명시 경로를 따른다.

```text
stop request → 새 시작 억제 → 장치 정리 → stop evidence → Stopped → 새 mode 진입
```

`stopped(station)`은 `CommandedStop`과 `VerifiedStop`을 구분할 수 있다. 전자는 안전
명령 적용과 정리 절차 완료, 후자는 물리 feedback까지 확인한 정지다. feedback이 없는
설비에 VerifiedStop을 전역 기본으로 요구하지 않는다. 장치 응답 실패를 명령 전송만으로
stop 완료라 하지 않는다.

같은 tick의 충돌하는 mode 진입은 모두 거부한다. Stop은 새 진입·새 작업보다 먼저
처리하며 대기 요청을 무효화한다. 운전 중 mode change 요청을 저장해 나중에 몰래
전환하지 않는다.

이 정지·Configure 경로는 program, dependency, 물리 binding, 설비 제약 묶음처럼
구조와 설치 의미를 바꾸는 후보 revision의 검증·배포에 적용할 수 있다. 이전 계약의
`allow apply(settings) only when ... Configure`를 모든 operator property에 적용하는
해석은 아래 live event 결정으로 대체된다. 구조 변경용 `apply` 대상의 최종 이름과
revision 경계는 별도 composition/installation 계약에서 정한다.

운영 설정에는 #105와 #110의 후속 결정이 적용된다. operator-editable property 변경은
**같은 program과 같은 run 안의 atomic live event**다.

- 한 event의 모든 값을 타입, range, step, authority와 current program identity에 대해
  검증한다.
- 하나라도 invalid이면 event 전체를 거부하고 settings를 전혀 바꾸지 않는다.
- 성공하면 settings revision과 effective event position을 기록한다.
- 그 위치 이후 control과 schedule은 새 값을 읽을 수 있다.
- source/bytecode, program identity와 run identity는 유지한다.
- timer와 state를 암묵 초기화하지 않는다.
- 실제 restart에서는 settings를 보존하되 새 run identity를 만든다.

예를 들어 watering limit를 10분에서 5분으로 줄이면 현재 `elapsed`와 새 5분을 다음
판단에서 비교한다. 새 run을 기다리는 숨은 정책을 붙이지 않는다. 이 live event 의미를
Auto↔Manual mode switch, program 배포, optional dependency replacement, RO3→RO8 같은
물리 binding 변경으로 일반화하지 않는다. 그런 변경은 각각 mode, composition,
installation/deployment 계약을 따른다.

## 4.11 accounting과 budget

`on_time(pump1)`의 accounting stage를 final applied command로 정했다면 자동·수동과
여러 control의 실제 적용 ON 구간을 하나의 물리 resource ledger에 합친다. 거부된
request, queue wait, constraint가 차단한 시간은 세지 않는다. confirmed flow를 세려면
그 feedback capability와 quality 계약을 별도로 요구한다.

선언 문법은 [§3.10 시간 기반 사용량 제약](03-time-and-schedules.md#310-시간-기반-사용량-제약)의
`resource`·`account`·`used`·`limit`을 사용한다.

local day budget은 rolling 24h budget이 아니다. 자정 양쪽에서 각각 날짜 예산을 쓸 수
있다. 자정을 넘는 ON interval은 신뢰된 날짜 경계로 나눈다. wall clock rollback이나
program/settings revision으로 이미 확정한 사용량을 줄이거나 초기화하지 않는다.

새 작업은 최악 ON duration과 stop delay를 포함한 예산을 시작 전에 예약한다. 수동
운전에는 남은 budget 안의 finite lease와 cutoff를 사용할 수 있다. 사용 뒤 applied
interval로 정산한다. 전원 단절로 불확실한 예약은 사용한 것으로 보거나 recovery를
보류하는 등 보수적인 명시 정책을 쓴다.

최근 60초 누적 30초 같은 rolling duty limit은 day ledger와 다른 sliding window다.
`(t-60s,t]`에서 선택한 semantic signal의 ON duration을 partial overlap까지 합산한다.
정확히 limit에서 추가 ON을 차단하고 오래된 interval이 빠지는 만큼만 예산을 복구한다.
power cycle로 암묵 reset하지 않는다.

`once starts per occurrence`는 budget과 별도로 같은 occurrence 중복을 막는다. 1시간
budget이 남았어도 같은 5분 occurrence를 두 번 실행할 수 있으므로 두 계약을 바꿔 쓰지
않는다.

**왜:** 물리 resource 단위로 계수하지 않으면 여러 control이 같은 pump를 쓸 때 사용량을
빼먹거나 중복 계수한다. day, rolling window와 occurrence 중복도 서로 다른 질문이다.

## 4.12 continuous control objective

연속 제어의 상위 개념은 “PID를 실행한다”가 아니라 controlled variable을 setpoint
주변에 유지하는 **control objective**다. 다음은 선택된 문법이다.

```ghost
objective greenhouse_temperature {
  measure = inside_temperature;
  target = target_temperature;
  manipulate = roof_vent.position;
  output = 0% .. 80%;

  controller = pid {
    period = 10s;
    late_after = 30s;
    direction = reverse;
    kp = proportional_gain(output: 2%, error: 1Δ°C);
    ki = integral_gain(output: 0.1%, error: 1Δ°C, time: 1s);
    kd = derivative_gain(output: 1%, time: 1s, error: 1Δ°C);
    bias = 0%;
    anti_windup = conditional_safe;
    disabled = track_safe;
    transfer = track_safe;
    fault = disable;
    restart = reset(output: 0%);
  }
}
```

objective는 다음을 연결한다.

- `measure`: quantity와 quality/provenance를 가진 process value.
- `target`: measure와 호환되는 typed setpoint.
- `manipulate`: continuous actuator의 semantic target.
- `controller`: Hysteresis/On-Off, PI 또는 PID policy.
- `output`: actuator capability 안의 허용 range.

config를 참조하는 `target`은 §5.2의 현재 `Result<T, SettingsFault>` observation을
소비한다. `T`는 measure와 호환되는 quantity다. `ok(value)`는 현재 setpoint이며
`fault(reason)`은 명시한 controller fault policy로 간다. 초기값이나 이전 성공 target을
암묵 대입하지 않는다. 실행 가능한 Temperature/Percent PID profile의 `fault = disable`은
target fault도 즉시 disable하며, 회복은 기존 deadline과 `track_safe` 정책을 따른다.
성공 target 변경 자체는 controller state를 reset하지 않는다.

continuous actuator capability는 value quantity/type, range, 선택 resolution, safe value,
rate/slew limit, feedback availability를 표현한다. 0–10V, PWM, VFD, Modbus, servo는
source objective가 아니라 Device binding이다.

### PI/PID 의미에 필요한 항목

`pi`는 `kd`를 받지 않고 `pid`는 세 gain을 모두 요구한다. 임의 단위 대수 대신
`proportional_gain`, `integral_gain`, `derivative_gain` constructor를 쓴다. constructor의
output numerator는 0 이상이고 error denominator는 양의 compatible delta이며 I/D의 time도
양수다. output 0은 해당 항을 비활성화한다. 이 값으로 output과
TemperatureDelta 등에 결속된 nominal gain type을 만든다.

| 항목 | 의미 |
|---|---|
| sample period | controller state를 갱신하는 양의 단조 Duration. missed/late tick 규칙을 포함한다. |
| setpoint / process value | 호환 quantity. nonfinite와 unresolved fault를 직접 계산에 넣지 않는다. |
| direction | direct 또는 reverse. error가 actuator를 어느 방향으로 바꾸는지 명시한다. |
| `Kp`, `Ki`, `Kd` | quantity 차원을 보존하는 gain. PI는 D 항이 없다. |
| output min/max | requested target clamp. actuator capability range와도 교차 검증한다. |
| anti-windup | saturation/constraint 동안 integral state의 update 또는 back-calculation 정책. |
| enable/disable | controller state를 freeze/reset/track할지 명시한다. |
| manual/auto transition | 현재 effective output을 따라가는 bumpless transfer와 authority 전환 규칙. |
| fault policy | stale/missing measure, feedback discrepancy에서 hold/safe fallback/disable 중 명시 정책. |
| initialization/restart | integral, derivative memory, previous sample의 시작·checkpoint 규칙. |

`period > 0`, `late_after >= period`이고 모든 값은 finite여야 한다. 고정 실행 규칙은 다음과 같다.

1. monotonic deadline마다 최대 한 번 갱신한다. 같은 sample 재평가는 state를 바꾸지 않는다.
2. 기본 error는 `target - measure`인 delta다. `direct`는 그대로, `reverse`는 부호를 뒤집는다.
3. `P = Kp * signedError`; I는 이전·현재 signed error의 사다리꼴 적분이다.
4. D는 setpoint kick을 피하도록 measure 변화에 적용하며 `-directionSign * Kd * Δmeasure/dt`다.
5. `dt`는 마지막 accepted update와 현재 update 사이의 단조 시간이다. 놓친 sample을 합성하지 않는다.
6. `dt > late_after`, nonfinite, inadmissible measure는 명시 `fault` branch로 간다.
7. unclamped requested는 `bias + P + I + D`다. 내부 signed accumulator는 Percent의 외부
   nonnegative range를 따르지 않으며 requested를 objective range에서 clamp한다.
8. tentative I로 requested와 safe를 계산한다. `(requested-safe) * signedError > 0`이면 I가
   saturation을 더 키우므로 이전 I로 한 번 다시 계산한다. 그 외에는 candidate I를 확정한다.

이 bounded two-pass가 `conditional_safe`의 전부이며 반복 solver를 만들지 않는다.

controller output은 requested target이다. arbitration과 safety constraint가 뒤에서
clamp할 수 있다.

```text
PID requested 92%
wind safety max 20%
safe target 20%
Driver applied 20%
position feedback 17% with provenance
```

integral anti-windup은 requested 92%만 보며 계속 쌓지 않고 위 safe tracking 규칙을 따른다.
relay-only actuator에
continuous PID output을 고빈도 time-proportioning으로 자동 변환하지 않는다. 별도
capability/safety 계약이 없으면 relay에는 hysteresis/on-off가 적합하다.

첫 accepted sample은 previous error와 previous measurement를 현재값으로 초기화하고 D=0이며
가상의 이전 interval을 적분하지 않는다. 현재 PID `fault`는 `disable`만 받는다.
`degraded Name`은 선택된 설계 대안이며 현재 compiler가 받지 않는다.
`bias`, `anti_windup`, `disabled`, `transfer`, `fault`, `restart`는 생략할 수 없다. restart는 typed
output을 쓰는 `reset(output: value)`다. continuity가 검증된 `checkpoint`는
선택된 설계 대안이며 현재 compiler가 받지 않는다.
`reset(output:v)`는 첫 accepted sample에서 integral tracking state를 정해 첫 unclamped
requested가 명시한 `v`가 되게 한다. disable과
manual→auto transfer는 현재 safe target을 추적한다. setpoint와 gain은 typed operator settings가
될 수 있다. live event는 같은 program/run에서 atomic하게 적용하고 controller/timer/filter state를
reset하지 않는다. 다음 정상 평가에서 `track_safe`가 bumpless하게 이어간다. farmer UI에
setpoint를 보여준다는 사실이 모든 expert gain을 같은 권한으로 노출한다는 뜻은 아니다.

**왜:** 농부의 목표는 온도·습도 같은 상태를 유지하는 것이다. 알고리즘 이름을 상위
의도로 만들면 relay, PI, PID의 교체와 safety clamp를 같은 objective 아래 설명할 수 없다.

## 4.13 explicit fallback과 degraded control

sensor, weather, model, camera, actuator feedback은 unavailable할 수 있다. fallback은
숨은 host behavior가 아니라 source/policy와 trace에 드러나야 한다.

```text
// 설계 의미
primary temperature 정상 → PI로 운전
primary degraded, backup admissible → stricter range의 backup controller
모든 temperature unavailable → conservative ventilation fallback
```

fallback branch는 입력 capability, 허용 quality, output bounds와 authority를 명시한다.
cloud/AI unavailable이 local safety control을 무조건 unavailable하게 만들지 않는다.
반대로 low-confidence estimate만으로 safety trip을 해제하지 않는다. fallback도 전역
constraints, resource ownership과 mode를 우회하지 않는다.

recovery는 새 정상 evidence가 준비되었다는 뜻이다. 자동 재시작·원래 objective 복귀,
누적 timer 복원은 별도 결정이다. sensor의 recover_after를 만족했다고 start request가
새로 생기지 않는다.

선택 표기는 다음과 같다.

```ghost
degraded TemperatureFallback for greenhouse_temperature {
  branch Backup priority 100
    when backup_temperature quality in { measured }
    use objective backup_temperature_control
    authority automatic_degraded
    output 0% .. 30%;
  otherwise disable;
  recover primary after 3 samples;
  resume = require_start;
}
```

성립한 branch 중 최대 i32 priority 하나를 선택하며 동률은 ambiguity error다. 선언 순서는
선택 기준이 아니다. `otherwise`는 필수이고 현재 compiler는 `disable`만 받는다.
완전한 branch는 선택된 설계 대안이며 아직 지원하지 않는다. resume은
`require_start`, `automatic`, `stay_degraded` 중 하나를 반드시 쓴다. `automatic`도 새 start
권한을 만들지 않고 기존 session이 유효할 때만 primary로 복귀한다. fallback authority는
primary보다 높아질 수 없고 safety authority를 가질 수 없다.

## 4.14 bounded adaptation

adaptive model이나 optimizer는 program 전체를 수정하거나 output register를 직접 쓰는
기본 권한을 갖지 않는다. 첫 의미는 typed setting 또는 objective setpoint에 대한
bounded proposal이다.

```ghost
adapt_setting target_vpd_policy for target_vpd {
  allowed = 0.7kPa .. 1.2kPa;
  max_step = 0.05kPa;
  max_change = 0.05kPa per 1h;
  authority = optimizer;
}
```

proposal에는 setting ID, proposed value, source/model, evidence reference, actor/authority,
current program과 base settings revision, occurrence time이 필요하다. local validation은 type,
range, 한 번의 step, 시간당 rate,
authority를 검사한다. 성공한 여러 property 변경은 하나의 atomic settings event로
적용하고 새 settings revision을 만든다. 실패하면 아무 값도 바꾸지 않는다.

“목표 온도 25→26°C”는 bounded setting일 수 있다. “저수위에서는 pump를 무조건
멈춘다”는 safety program 변경이다. adaptation이 safety constraint를 제거하거나
authority를 스스로 높일 수 없다. program을 생성하는 AI authoring workflow는 별도
source review와 deployment identity를 가진다.

rate는 `(t-window,t]`에서 받아들인 변화 절대값의 합과 새 변화가 `max_change` 이하인지
검사하여 상하 반복 우회를 막는다. 성공한 adaptation setting event는 controller, timer, filter
state를 reset하거나 checkpoint로 바꾸지 않는다. 다음 정상 control 평가가 현재 safe target을
추적한다. trace에는 old, proposed, accepted/effective value, proposal provenance, rejection reason,
program identity, settings revision과 effective position을 남긴다.

**왜:** adaptation을 program 수정이나 직접 출력 권한으로 취급하면 model 오류가 안전
제약을 지울 수 있다. typed bound와 atomic settings event는 변경 가능한 범위를 검증한다.

## 4.15 타입, 자원과 설명 규칙

센서·제어 연산은 다음 공통 규칙을 지킨다.

- quantity가 다른 pressure, flow, percent, temperature를 암묵 비교·합산하지 않는다.
- Result와 Option을 Bool truthiness로 바꾸지 않는다.
- filter/window/request 수와 state memory 상한을 정적으로 계산할 수 있어야 한다.
- tick 실패는 sensor/filter/controller/resource state를 부분 확정하지 않는다.
- analysis timeout 또는 Unknown은 proof success가 아니다.
- 항상 모든 출력을 끄는 결과가 안전 constraint를 만족하더라도 intended operation의
  reachability를 별도로 확인한다.

완료된 판단의 설명은 최소 다음을 구분한다.

- raw sample, filtered value, quality/fault와 sample identity,
- predicate와 temporal evidence,
- setpoint, process value, error, controller requested output,
- competing intents와 arbitration policy,
- constraint clamp와 final safe intent,
- applied command와 confirmed feedback,
- 사용량 target, used/limit, block reason과 이미 기록된 interval에서 계산한 next release,
- program, settings, profile/binding, policy와 scan/run identity.

관찰·화면 계층은 판정된 값과 근거를 소비한다. animation 시간이나 표시된 output에서
budget, PID, fallback, arbitration에 대한 독립적인 제어 의미를 만들지 않는다.

## 4.16 확정된 control 문법과 장별 경계

이 장은 Result transform, bounded signal/window, capability strategy, named constraints,
shared resource, objective·PI/PID, degraded control과 bounded adaptation의 표면을 확정했다.
다음 세부만 해당 소유 장의 계약을 참조한다.

- rolling budget의 history, scan boundary와 reboot policy: 3장 시간·accounting 계약.
- quantity, delta, Result와 quality predicate의 일반 타입 규칙: 2장 타입 계약.
- installation binding과 live settings event record: 5–6장 설정·조합 계약.

이 참조는 Result/Option 구분, requested→safe→applied→confirmed 순서, 필수 constraint의
우선성, bounded state, atomic live settings와 명시 fallback 의미를 바꾸지 않는다.

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전 장](03-time-and-schedules.md) ·
[다음 장](05-settings-and-observation.md)
