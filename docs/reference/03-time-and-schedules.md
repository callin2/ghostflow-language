# 3. 시간과 일정

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전: 2. 타입, 식과 상태](02-types-expressions-state.md) ·
[다음: 4. 센서, 제약과 제어](04-sensors-constraints-control.md)

GhostFlow는 시간을 하나의 숫자로 취급하지 않는다. “5분 동안 켠다”의 5분은
단조 경과 시간이고, “오전 6시에 시작한다”의 오전 6시는 시간대가 있는 달력 시각이다.
벽시계 보정이 이미 진행 중인 운전 시간을 되감거나 늘려서는 안 되며, 재부팅이 예약의
기준점을 임의로 바꾸어서도 안 된다. 이 장은 이 구분을 바탕으로 시간값, 타이머,
반복 일정, 근무 달력, 자연 사건의 의미를 정의한다.

이 장의 `ghost` 코드와 문법 블록은 선택된 공개 언어 계약이다. 현재 compiler에서
검증되거나 실행되는 범위가 더 좁은 곳은 해당 절에 명시한다. ClockSnapshot, manifest와
provider record처럼 `text`로 표시한 구조는 실행 환경 계약이며 GhostFlow 소스가 아니다.
일정의 실제 시계·달력·예측 자료는 로컬 장치나 선택적 gateway가 공급할 수 있다.
네트워크나 특정 gateway는 언어 요구가 아니다.

근거는 [시간·일정 계약](../TIME-AND-SCHEDULE-CONTRACT.md),
[연속 Bool 타이머 계약](../CONTINUOUS-BOOL-TIMER-CONTRACT.md),
[Solar 일정 계약](../SOLAR-SCHEDULE.md), [선택 문법](../LANGUAGE-SURFACE.md),
[Programming in GhostFlow 6–7장](../ProgrammingInGhostflow.md)과
[2026-09-24 고정 계획 시간 구간 결정](../2026-09-24-fixed-planned-time-range-decision.md),
[#23](https://github.com/callin2/ghostflow-language/issues/23),
[#46](https://github.com/callin2/ghostflow-language/issues/46),
[#90](https://github.com/callin2/ghostflow-language/issues/90),
[#96](https://github.com/callin2/ghostflow-language/issues/96)이다.

## 3.1 시간값과 시계 영역

### Duration

`Duration`은 달력의 날짜가 아닌 시간 길이다. 선택된 리터럴은 0 이상의 정수와
`ms`, `s`, `min`, `h` 단위를 결합한다.

```ghost
config open_delay: Duration = 2s;
config watering_time: Duration = 5min;
```

기본 의미는 정확한 정수 밀리초 `0..2^53-1`이다. 산술은 이 범위 안에서 검사한다.
음수 Duration, 분수 밀리초, NaN, Infinity와 범위를 넘는 결과는 허용하지 않는다.
동적 산술의 각 중간 결과도 이 조건을 지켜야 한다. 위반하면 `duration-out-of-range`로
현재 tick을 거부하며 새 상태와 intent를 일부만 확정하지 않는다.
특정 연산이 “양의 지연”을 요구하면 그 인수에는 `0ms`를 거부할 수 있지만,
그 제약이 `Duration` 타입 자체에서 0을 없애지는 않는다.

`Duration + Duration`은 검사된 합을 반환한다. 뺄셈은 결과가 0 이상일 때만
`Duration`을 반환한다. 월·연·달력 날짜는 길이가 고정된 밀리초가 아니므로 Duration
단위가 아니다. “한 달 뒤”는 달력 연산의 별도 의미가 필요하다.

### Date, TimeOfDay, DateTime

시간 타입의 공개 리터럴은 tagged form이다.

| 타입 | 값 영역 | 규칙 |
|---|---|---|
| `Date` | Gregorian `1970-01-01..9999-12-31` | 시간과 시간대를 포함하지 않는다. |
| `TimeOfDay` | `00:00:00.000..23:59:59.999` | 날짜·UTC offset·반복 규칙이 없다. |
| `DateTime` | Unix epoch부터 `9999-12-31T23:59:59.999Z`까지의 정확한 UTC instant | 리터럴에 `Z` 또는 숫자 UTC offset이 필요하다. IANA zone을 값 안에 보존하지 않는다. |

```ghost
date`2026-09-22`
time`06:30`
datetime`2026-09-22T06:30:00+09:00`
```

정확한 철자는 다음과 같다.

```text
Date       := date`YYYY-MM-DD`
TimeOfDay  := time`HH:MM[:SS[.f|.ff|.fff]]`
DateTime   := datetime`YYYY-MM-DDTHH:MM:SS[.f|.ff|.fff](Z|+HH:MM|-HH:MM)`
```

모든 필드는 0으로 채운 ASCII 십진수다. 초의 소수는 1~3자리이며 오른쪽을 0으로
채워 정확한 밀리초로 정규화한다. 네 자리 이상을 반올림하지 않고 진단한다. 숫자
offset은 `00:00..14:00`이며 14시는 `14:00`만 허용한다. `+00:00`은 `Z`와 같은
instant로 정규화하고 UTC offset의 불명 의미를 가진 `-00:00`은 거부한다.

존재하지 않는 날짜, `24:00`, leap-second `:60`, offset 없는 DateTime은 진단한다.
IANA 시간대는 반복 일정을 civil time에 해석하기 위한 문맥이며, 이미 확정된
DateTime instant의 일부가 아니다. 원본 literal 철자와 offset은 source metadata에
남지만 DateTime 값은 정확한 UTC 밀리초 instant다. 문자열과 시간 타입 사이, Date와
TimeOfDay와 DateTime 사이에는 암묵 변환이 없다.

최소 시간 산술은 다음 의미를 가진다.

- `DateTime ± Duration -> DateTime`: 범위를 검사한 instant 이동.
- 같은 타입의 DateTime 또는 TimeOfDay끼리 비교한다.
- `TimeOfDay + Duration`은 자정에서 자동 순환하지 않는다. Date와 시간대가 있는
  Schedule 문맥에서 해석해야 한다.
- `DateTime - DateTime`은 음수가 필요한 경우가 있어 기본 `Duration` 연산이 아니다.
  instant를 비교하거나 단조 `elapsed`를 사용한다.

### 달력 시계와 단조 시계

한 tick은 하나의 immutable clock snapshot을 사용한다. 달력 시계는 예약, 날짜,
시간대, 자연 사건을 해석한다. 단조 시계는 운전 시간과 연속 조건을 잰다.

```text
// 계약 설명용 구조
ClockSnapshot {
  monotonicMs
  bootEpoch
  wallMs?
  wallQuality: Trusted | Unknown(reason)
  uncertaintyMs?
  sourceRevision?
}
```

`monotonicMs`는 같은 run 안에서 감소할 수 없다. 감소하거나 정수·범위를 만족하지
않는 snapshot은 상태를 바꾸기 전에 거부한다. `wallMs`가 있어도 `wallQuality`가
신뢰되지 않으면 일정 판단에 사용할 수 없다. 벽시계가 앞으로 또는 뒤로 보정되어도
진행 중 타이머는 단조 시계로 계속 간다.

호스트는 NTP, RTC, 플랫폼 시각의 출처와 신뢰도를 판단한다. 제어식은 네트워크나
기계 시계를 직접 읽지 않는다. 마지막 신뢰 시각을 잠시 유지하는 정책은 허용 시간과
최종 fallback을 명시해야 한다. 숨은 grace period는 없다.

**왜:** 같은 “시간”이라는 말로 wall time과 elapsed time을 섞으면 시계 보정,
시간대 변경, DST, 재부팅이 운전 길이까지 바꾸게 된다.

## 3.2 상태 변경 뒤의 경과 시간

선택된 표기 `elapsed(state)`는 참조 상태가 마지막으로 **확정 변경된 시점**부터의
단조 경과 시간을 반환한다.

```ghost
type Phase = Idle | Watering;
state phase: Phase = Idle;
timer age = elapsed(phase);

phase' = case phase {
  Idle => if start then Watering else Idle;
  Watering => if stop || age >= watering_time then Idle else Watering;
};
```

정확한 규칙은 다음과 같다.

- 초기값은 `0ms`다.
- 상태 변경을 확정한 tick에서 새 구간이 시작되고 값은 0이다.
- 이후 accepted tick에서 단조 시각 차이를 읽는다.
- Bool 상태는 false→true와 true→false 모두 상태 변경이다. 따라서
  `elapsed(running)`은 “현재 값이 유지된 시간”이지 누적 ON 시간은 아니다.
- 한 tick에서 여러 단계가 연달아 넘어가지 않는다. 조건을 만족한 첫 tick에서 한 번
  전이하므로 실제 지연은 요청 Duration 이상이고 정상적으로 tick 해상도의 오차를 가진다.
- rejected tick은 timer state를 바꾸지 않는다.

타이머는 `sleep`이나 background task가 아니다. 기다리는 동안에도 매 tick stop,
sensor fault와 전역 제약을 평가한다.

## 3.3 Bool이 연속으로 참인 시간

“온도가 기준을 5분 동안 계속 넘었다”는 상태값의 마지막 변경 시각과 다른 의미다.
연속 참 타이머는 조건이 true인 uninterrupted interval만 재며 false인 tick에서는 즉시
`0ms`를 반환한다.

```ghost
timer hot_for = continuous_true(temperature_high);
```

조건 `c`, 직전 accepted tick의 `wasTrue`, 구간 시작 `since`, 현재 단조 시각 `now`에
대한 의미는 다음과 같다.

```text
value    = if c && wasTrue then now - since else 0ms
wasTrue' = c
since'   = if !c then now
           else if !wasTrue then now
           else since
```

따라서 첫 true tick은 0, 같은 timestamp의 반복 tick도 0, 다음 timestamp부터 차이를
반환한다. false가 들어오면 즉시 0이고 다음 true는 새 구간이다. 여러 timer는 내부
상태를 공유하지 않는다.

`continuous_true`는 인수 하나인 Bool 식만 받는다. `Result<Bool, SensorFault>`를 암묵적으로 Bool로
바꾸지 않는다. fault에서 보수적으로 false를 선택하려면 작성자가 `case`로 드러낸다.

```ghost
let safe_high = case high_temperature {
  ok(value) => value;
  fault(_)  => false;
};
```

연속 참은 pause/resume 합산도, 여러 ON 조각의 누적도 아니다. 그 둘은 별도의 시간
연산이다.

## 3.4 누적 시간과 rolling budget

다음 의미는 서로 구분한다.

| 질문 | 필요한 시간 의미 |
|---|---|
| 현재 단계가 얼마나 오래 유지되었나? | `elapsed(state)` |
| 조건이 끊기지 않고 얼마나 오래 true인가? | continuous-true |
| 이번 작업에서 ON이 총 몇 분이었나? | 작업 범위 누적 ON 시간 |
| 최근 60초에서 ON이 총 몇 초였나? | sliding-window ON 적분 |
| 오늘 물리 펌프가 총 몇 분 켜졌나? | 달력 날짜별 설비 accounting |

rolling accounting은 먼저 stable physical resource와 stage를 가진 ledger를 선언하고
그 ledger를 시간 basis로 조회한다.

```ghost
resource pump1: BoolActuator;
account pump_applied = on_time(pump1,
  stage: applied,
  persistence: durable);
constraints PumpBudget {
  limit used(pump_applied, rolling(60s)) <= 30s {
    reserve = 1s;
    on_unknown = block;
  }
}
```

이 코드는 control 내부 accounting 선언의 단편이다. 현재 compiler는 유효한
`limit used(...)`를 검증해 accounting descriptor를 만든다. 실행에는 별도의
resource binding과 ledger enforcement가 필요하다.

```text
used(t) = ON duration of x over (t - 60s, t]
```

`used + reserve`가 30초에 도달하면 추가 ON을 허용하지 않는다. 오래된 ON interval의 일부가
창 밖으로 나가면 그만큼 즉시 예산이 돌아온다. 고정 분 bucket이나 현재 연속 구간만
재는 방식으로 바꾸지 않는다. 여러 interval의 partial overlap을 합산하며, irregular
scan에서도 같은 논리 시간 trace는 같은 결과를 내야 한다.

accounting target은 반드시 명시한다.

- requested: 제어가 요청한 ON 시간.
- admitted/safe: 제약을 통과한 논리 ON 시간.
- applied: Driver가 적용했다고 보고한 명령 시간.
- confirmed: feedback으로 확인한 물리 동작 시간.

`manual_request`가 true여도 저수위 제약으로 safe output이 false면 admitted/safe
예산은 소비하지 않는다. 반대로 feedback이 없는 경우 safe ON 시간을 실제 유량으로
표현해서는 안 된다. window와 최대 ON은 유한해야 하고 상태 메모리 상한을 계산할 수
있어야 한다. 재부팅으로 보호 예산을 암묵 초기화하지 않는다. checkpoint 복원,
window 길이 동안 보수적 차단, 명시적 non-durable 정책 중 하나를 계약으로 선택한다.

**왜:** “한 번에 30초”와 “최근 1분 합계 30초”는 서로 다른 안전 규칙이다. 같은
타이머로 보이게 만들면 짧게 여러 번 켜서 한도를 우회할 수 있다.

## 3.5 Schedule의 공통 의미

Schedule은 delayed call이나 background thread가 아니라 계속 평가하는 typed reactive
value다. 현재 시점에서 trigger, day rule, predicate와 context를 평가해 occurrence를
admit할지 판단한다. 충족하지 않은 pulse는 자동 대기열에 들어가지 않는다.

선택된 trigger 타입은 `At`, `Daily`, `DailySlots<G>`, `Periodic`, `Cron`, `Solar`,
`Tide`다. 현재 compiler는 `At`을 받지 않고 `DailySlots<15min>`만 받는다.
각 타입은 고유 trigger field와 다음 공통 policy field를 가진다.

```ghost
schedule name: TriggerType {
  // trigger별 field
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

```text
basis       := pulse
             | window(positive Duration)
             | run(positive Duration, on_time)
             | run(positive Duration, within(positive Duration))
             | range(positive Duration)
when        := Bool
clock       := trusted_only
             | hold_trusted(positive Duration, terminal: skip)
gap         := skip_after(positive Duration)
recovery    := baseline
fallback    := skip
             | fixed_time(TimeOfDay, terminal: skip)  // Solar만
cancel_when := Bool                                   // 현재 civil range에 필수, Tide run에는 선택
```

공통 field는 모두 필수다. 조건 없는 admission은 `when = true`, 언어 수준 취소가
없는 Run 또는 Range는 `cancel_when = false`라고 명시할 수 있다. 현재 compiler에서
`cancel_when`은 `Tide`의 Run과 civil `range`에 허용되고 `range`에는 필수다.
`pulse`에는 허용되지 않는다. `hold_trusted(d, terminal: skip)`은
마지막 trusted wall instant에 단조 경과를 더해 최대 d 동안만 사용한다. uncertainty는
마지막 uncertainty에 같은 단조 경과를 더하며 `HeldClock` provenance를 남긴다.
경계에서는 `ClockUnknown` 뒤 새 admission 판단에 terminal skip을 적용한다.
이미 admit한 Range의 단조 종료 시점은 유지한다. high-water는 바꾸지 않는다.

현재 compiler는 `clock = trusted_only`, `fallback = skip`만 받는다.
`window`, `run(_, on_time)`, `At`, `hold_trusted`, `fixed_time`은 선택된 설계 표기이며
아직 compiler 지원 범위 밖이다. civil `range`는 현재 UTC timezone의 정적 non-overlap을
증명할 수 있는 recurrence에서 type-check되지만 실행 bytecode로 내려가지 않는다.
Tide의 `run(_, within(_))`은 지원한다.

`fixed_time`은 Solar에서만 쓸 수 있다. 해당 source local date의 fallback occurrence가
admit되면 같은 occurrence ledger가 그 날짜의 Solar 사건을 소비하므로 provider가
회복되어도 중복하지 않는다. Tide는 예측 부재 시 사건 수와 identity를 알 수 없으므로
`fallback = skip`만 허용한다.

설계된 one-shot `At`은 ``at = datetime`...`;``을 쓰며 DST field가 없다.
현재 compiler에는 `At` 구현이 없다. 매일 한 시각인 `Daily`는
`timezone`, ``at = time`...`;``, `dst_missing`, `dst_repeated`를 요구한다. 예를 들면 다음과 같다.

```ghost
schedule morning: Daily {
  timezone = "Asia/Seoul";
  at = time`06:30`;
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

Trigger와 duration basis는 다른 축이다. Cron, Window, Run, Range를 같은 종류의 대안으로
나열하지 않는다. Cron은 언제 occurrence를 계획하는지, Window/Run/Range는 planned instant
주변의 admission과 duration을 뜻한다. Schedule을 읽는 행위는 장치를 켜지 않는다.

Schedule 판단은 `True`, `False`, `Unknown(reason)`과 사용한 revision을 낸다.
`fallback = skip`은 Unknown을 새 `.due = false`로 해소하지만 Unknown 이유를 지우지
않는다. Unknown을 부정해 허가로 만들지 않는다.

공개 투영의 의미는 다음과 같다.

- `.due`: 하나의 occurrence가 admit된 accepted tick에서만 true인 pulse.
- Window `.open`: `[planned, planned + length)` 안에서 현재 predicate까지 true인 level.
- Run `.active`: admission 뒤 명시적 상태와 단조 timer로 표현되는 운전 구간.
- Range `.active`: 계획 시작점에 묶인 현재 occurrence의 남은 구간. admit한 뒤에는
  단조 시계로 끝을 판단하며 안전 제약으로 출력이 막혀도 구간은 계속 흐른다.

Run duration은 실제 admission부터 단조 시간으로 잰다. Run과 Range에서 `cancel_when`이 true인 accepted
tick에서는 `.active`를 끝내되 occurrence를 다시 arm하지 않는다. requested output이 false이거나
전역 constraint가 safe output을 막아도 숨겨서 일시정지하지 않는다. requested ON,
safe ON, continuous safe ON의 시간은 필요한 경우 별도 명시 연산으로 잰다.

각 판단은 Bool 투영과 별도로 schedule observation을 남긴다. 이 evidence에는 안정적인
schedule ID, definition revision, `False | Due | Unknown(reason)` 결정, disposition,
occurrence ID와 planned wall instant, source/scheduled local date, provider와 context
revision이 포함된다. 대표 disposition은 `Before`, `PredicateFalse`, `AlreadyAdmitted`와
다음 missed reason이다.

- `ConditionsFalseAtPulse`: pulse crossing에서 조건이 거짓이었다.
- `ObservationGap`: 신뢰할 수 없는 관측 gap이 admission interval과 겹쳤다.
  Range에서는 열려 있는 구간의 비종결 관찰 근거이며 아래 회복 규칙을 따른다.
- `LateStartExpired`: late interval이 끝났다.
- `CorrectionPastHighWater`: 수정된 사건 시각이 이미 지난 high-water 뒤로 이동했다.
- `EventWithdrawn`: provider가 아직 admit하지 않은 사건을 철회했다.

`.due = false`만으로 ordinary false, Unknown fallback, 이미 접수한 사건, 놓친 사건을
구분할 수 없으므로 이 evidence를 같은 accepted scan과 결속한다.

### 놓친 occurrence에 대한 소스 반응

`schedule_name.missed`는 `Bool` 투영이다. 현재 compiler는 Solar와 실행 가능한
`pulse` civil schedule에 이 투영을 제공한다. `range` descriptor에서는 아직
실행 투영으로 쓸 수 없다. 해당 schedule에서 하나 이상의 occurrence가
이번 accepted scan에 **terminal missed**로 확정될 때만 true다. 한 scan에서 둘 이상을
놓쳐도 값은 한 번 true이고, 다음 accepted scan에 새 terminal miss가 없으면 false다.
control action은 이 값을 해당 accepted scan의 immutable snapshot에서 정확히 한 번 평가한다.
이미 terminal missed로 기록된 occurrence를 재관찰하거나 checkpoint를 복원하는 것만으로
다시 true가 되지 않는다. rejected scan은 이 pulse나 상태 전이를 확정하지 않는다.

```ghost
state missed_scans: Int = 0;
missed_scans' = if morning.missed then missed_scans + 1 else missed_scans;
output missed_alarm: Bool;
missed_alarm <- morning.missed;
```

`.missed`는 일반 `Bool` 식이므로 작성자가 `if`, `case`, 상태 전이와 output 식에서
반응을 선언한다. schedule 선언에 callback, per-occurrence handler 또는 자동 replay를
추가하지 않는다. 여러 schedule의 miss에 scan당 한 번 반응하려면
`morning.missed || evening.missed`를 한 식으로 평가한다.

Bool pulse는 발생 횟수나 이유를 담지 않는다. 같은 accepted scan의 **순서 있는
schedule observation**은 terminal missed occurrence마다 별도 record를 남긴다.
각 record에는 안정적인 schedule ID, occurrence ID, planned instant,
terminal miss reason(`ConditionsFalseAtPulse`, `ObservationGap`,
`LateStartExpired`, `CorrectionPastHighWater`, `EventWithdrawn` 중 해당 값),
definition/context/provider revision을 보존한다. 둘 이상이 한 scan에 확정되어도
record를 합치거나 이유 하나로 요약하지 않는다. 재부팅 뒤 복원된 terminal ledger는
중복 record와 pulse를 만들지 않는다. `Unknown`이나 Range의 아직 열린 구간에 대한
비종결 `ObservationGap`은 `.missed`를 true로 만들지 않는다. 놓친 occurrence는 이후
조건이 true가 되어도 자동 admit하거나 실행하지 않는다.

### Pulse, Window, Run, Range

| basis | admission 의미 |
|---|---|
| `pulse` | crossing tick에 조건이 모두 true일 때만 admit. 뒤늦게 true가 되어도 missed다. |
| `window(5min)` (설계) | `[planned, planned+5min)`에서 조건이 처음 true인 시점에 한 번 admit. 같은 occurrence에서 false→true가 반복돼도 재arm하지 않는다. |
| `run(5min, on_time)` (설계) | observed crossing에서만 admit하고 admission부터 5분 운전한다. |
| `run(5min, within(10min))` (Tide) | `[planned, planned+10min)`에서 첫 admission을 허용한다. 10분은 grace이고 run length는 5분이다. |
| `range(10min)` (civil contract) | 신뢰할 수 있는 현재 시각이 `[planned, planned+10min)` 안에 있고 `when`이 true이면 첫 관측·부팅·회복이 늦어도 한 번 admit한다. 끝은 계획 시작점 + 10분이다. 현재 bytecode 실행은 미지원이다. |

```ghost
schedule morning_watering: Daily {
  timezone = "UTC";
  at = time`08:00`;
  dst_missing = skip;
  dst_repeated = first;
  basis = range(10min);
  when = true;
  cancel_when = false;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

이 `range` 예시는 현재 compiler에서 검증되는 계약이며 실행 가능한 control bytecode는
아니다. 현재 civil `range`는 `UTC`와 recurrence non-overlap 조건이 필요하다.

late interval은 half-open이다. 종료 경계에서 새로 admit하지 않는다. 예정 시간 08:00,
`run(5min, within(10min))`이 08:02에 admit되면 08:07까지의 단조 run이다.

`range(duration)`은 고정된 계획 시간 구간이다. 예를 들어 08:00에 계획된
`range(10min)`을 신뢰할 수 있는 시각 08:04에 처음 관측하면 08:10까지 남은
6분만 요청한다. 08:10 또는 그 뒤에 처음 관측하면 시작하지 않고
`LateStartExpired`로 기록한다. `when`이 늦게 true가 되어도 종료 전이면 남은
시간만 요청한다. 시작·재부팅·시계 신뢰 회복과 관측 gap에서도 동일하다.
이는 Range에만 적용하는 명시적 부분 구간 admission이다. 다른 basis의
`gap = skip_after(...)`와 `recovery = baseline` 규칙을 바꾸지 않는다.
신뢰할 수 있는 현재 시각이 없으면 `Unknown(ClockUnknown)`이며 추정 시각으로
새 Range를 admit하지 않는다. `clock = hold_trusted(...)`가 명시된 경우에는
그 계약으로 유지된 시각과 불확실성을 사용한다. 진행 중인 Range는 이후
wall trust나 hold가 만료되어도 기존 단조 종료 시점까지 진행한다. 단, 미래로
옮긴 시작점을 기다리는 같은 occurrence의 재진입은 새 admission과 마찬가지로
신뢰 가능한 시각 없이 허용하지 않는다. trust가 회복된 뒤에도 현재 구간이
끝났다면 재진입하지 않는다.

같은 schedule의 서로 다른 Range occurrence는 겹치면 안 된다. 두 반열린 구간의
교집합이 비어 있지 않으면 오류다. 경계가 정확히 맞닿는 경우는 허용한다.
예를 들어 `DailySlots`의 `selected = [08:00, 08:15]`와 `basis = range(30min)`은
08:00–08:30과 08:15–08:45가 겹치므로 컴파일 오류다. 컴파일러는 trigger 정의와
유효 설정으로 occurrence 간격의 비중첩을 증명할 수 있는 Range만 받는다.
provider나 동적 recurrence의 간격을 증명할 수 없으면 추측하거나 하나를 선택하지
않고 그 `range` 선언을 컴파일 진단으로 거부한다. 정적 기본값은 컴파일 때,
복원한 설정을 포함한 유효값은 활성화 전에 검사한다. 유효값이 겹치면 활성화를
거부한다. live 설정 변경으로 겹치면 event 전체를 원자적으로 거부한다. 두 검사는
현재 admit한 구간과 새로 계획될 구간에도 적용한다.

Range admission에서 occurrence의 계획 시작점과 그때의 유효 Duration으로 계획 종료점을
확정한다. 이미 경과한 부분을 단조 시계 기준 잔여 시간으로 환산한다.
admission 뒤 RTC/NTP 벽시계 보정은 진행 중인 종료 시점을 앞당기거나 늦추지
않는다. 보정된 벽시계는 현재 occurrence가 종료된 뒤 후속 occurrence 판단에
반영한다. 같은 occurrence의 신뢰 시각, 계획 시작점과 단조 경과 기준을
함께 보존하여 보정 중에도 종료 시각을 재계산하지 않는다.

단일 계획 시작 시각을 가진 trigger의 scalar 시작 시각 설정 또는 Duration이
운영 설정이면 받아들인 atomic live event의
적용 위치부터 현재 occurrence에도 적용한다. 변경된 시작 시각과 Duration으로
현재 구간과 종료점을 다시 계산한다. occurrence ID와 이미 admit한 ledger는
settings revision 변경에도 유지한다. admission 이후에는 보정 전의 안정된 시간
기준을 단조 경과로 전진시켜 현재 위치와 남은 시간을 정한다. 예를 들어 08:00
계획 `range(10min)`이 08:04에 admit된 뒤 08:07에 Duration을 12분으로 바꾸면
08:12에 끝난다. 5분으로 줄이면 새 종료점 08:05가 이미 지났으므로 그 event가
적용되는 판단에서 끝난다. 시작 시각을 08:02로 바꾸고 Duration을 10분으로
유지하면 종료점은 08:12다. late admission 시각을 새 계획 시작점으로 사용하지
않는다. 같은 위치에서 설정 event와 scan이 겹치면 §5.2의 event 적용 순서를
먼저 확정하고 그 위치의 유효 설정으로 판단한다.

전역 안전 제약이 출력을 막으면 safe output은 즉시 false지만 Range occurrence와
단조 종료 시점은 유지된다. 제약이 종료 전에 풀리면 그때 남은 구간만 요청할
수 있다. 막힌 시간은 끝에 덧붙이지 않는다. `cancel_when = true`는 해당 occurrence를
종결하며, 다시 허용되어도 같은 occurrence를 재시작하지 않는다. `.active`와
requested/safe/applied/confirmed output은 서로 다른 관찰값이다.

시작 시각 변경으로 현재 위치가 새 계획 시작점보다 앞서면 해당 판단에서
`.active = false`로 멈춘다. 새 시작점에 도달한 accepted tick에서 같은 occurrence의
변경된 구간 안에 있는지 다시 판단한다. `when`이 true이면 현재 계획 종료점까지만
요청을 재개하고, 안전 제약이 허용할 때만 safe output을 낸다. 이는 새 admission이
아니므로 `.due`를 다시 내지 않고 occurrence ID와 ledger를 유지한다.
변경된 종료점이 현재 위치 이하이면 그 occurrence는 즉시 종결하며 재개하거나
새로 admit하지 않는다. `DailySlots`의 `TimeSlots` 변경은 §3.6의 stable slot key로
retime과 제거·추가를 구분한다. key를 보존한 retime에는 이 Range 재계산 규칙을
적용하고, 제거·추가에는 새 항목 baseline 규칙을 적용한다.

### occurrence identity와 중복 억제

각 planned occurrence는 schedule의 안정적인 선언 ID와 source occurrence key로 식별한다.
local daily/Cron slot은 DST fold를, solar는 event kind와 source date를, tide는 provider가
보장한 station/event ID를 포함한다. definition revision이나 수정된 planned time은
metadata이며 같은 사건을 새 사건으로 만들지 않는다.

하나의 occurrence는 최대 한 번 admit된다. 지속된 true가 매 tick 새 run을 만들지
않으며, 이미 admit한 occurrence의 provider revision이 바뀌어도 중복 run을 만들지
않는다. 다른 일정을 의도하면 새 schedule ID가 필요하다.

### 관측 gap과 회복

일정은 연속한 accepted snapshots의 monotonic delta와 양의 wall delta를 검사한다.
명시한 `gap = skip_after(d)`의 d를 넘으면 `ObservationGap`이다. 이 정책은 그
gap과 admission interval이 겹친 Pulse, Window, Run occurrence를 missed로 종결한다.
Window나 `within(...)`이 아직 열려 있어도 나중에 되살리지 않는다. Range에서
구간 중의 `ObservationGap`은 gap의 관찰 근거이며 그 occurrence를 terminal missed로
기록하지 않는다. 신뢰 가능한 현재 시각이 여전히 계획 구간 안이면 처음 admit해
남은 시간만 요청할 수 있다. 종료 경계에 도달하면 `LateStartExpired`로 terminal
missed를 기록하고 실행하지 않는다. 이미 terminal missed로 종결되거나 철회된
occurrence는 구간 안이라는 이유로 되살리지 않는다. 특히 Tide의
`CorrectionPastHighWater`와 `EventWithdrawn`은 Range에서도 terminal이다.

`recovery = baseline`은 최초 부팅과 clock trust 회복에서 baseline만 세우고 과거
occurrence를 몰아서 실행하지 않는다. Range는 아직 열려 있는 현재 구간에 한해
남은 시간만 admit할 수 있다. wall rollback은 high-water와 admission ledger로
중복을 막는다. catch-up, retry, replay 문법은 없다.

연속한 accepted scan 사이에서 같은 schedule의 occurrence를 둘 이상 교차하면
Pulse, Window, Run의 새 occurrence를 모두 missed로 기록하고 어느 것도 admit하거나
실행하지 않는다. Range는 이미 종료되거나 terminal missed/withdrawn으로 기록된
occurrence를 실행하지 않고, 신뢰 가능한 현재 시각 안에 열린 구간의 현재
occurrence를 남은 시간 동안 admit한다. 같은 schedule에 동시에 열린 두 Range
구간은 허용되지 않으며 compile/live 설정 검증에서 거부한다.
정확히 하나만 교차한 경우에는 각 basis의 ordinary admission 규칙을 적용한다.

## 3.6 선택된 DailySlots

`DailySlots<15min>`은 지역 날짜의 15분 격자 시각을 선택하는 일정이다.

```ghost
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
```

- `timezone`은 일정 해석에 쓰는 IANA zone이다.
- `selected`는 하루의 `00:00..23:45` 중 15분 격자 시각이다.
- 중복 slot과 격자 밖 시각은 허용하지 않는다.
- `starts.due`는 slot crossing을 관측한 첫 tick에서 한 번 true다.
- 부팅 전 slot, 관측 gap에서 놓친 slot, recovery 전 occurrence는 암묵적으로 catch-up하지
  않는다.
- wall rollback 뒤 동일 local date/slot을 다시 실행하지 않는다.

운영자가 slot 집합을 같은 Program/run에서 바꿀 수 있게 하려면 유한 설정 타입을 쓴다.

```ghost
config watering_slots: TimeSlots<15min, 8> = [
  time`06:00`, time`18:45`
] {
  access = operator;
  label = "관수 시작 시각";
}
```

`TimeSlots<G,N>`은 TimeOfDay의 nominal finite set이다. G는 24시간을 정확히 나누는
양의 Duration grid이고 N은 compile-time 최대 항목 수다. 빈 집합은 occurrence가 없다는
유효값이다. 값은 고유해야 하고 local midnight 기준 grid에 있어야 하며 검증 뒤 정렬한다.
Duration 목록으로 암묵 변환하지 않는다. `selected = watering_slots`로 연결할 때 schedule과
설정의 G가 정확히 같아야 한다. literal `selected`는 기존의 간결한 `HH:MM`을 쓰고
설정값은 일반 `time` literal을 쓴다.

`selected = watering_slots`는 §5.2의 `Result<TimeSlots<G,N>, SettingsFault>` stream을
소비한다. 현재 observation이 fault이면 같은 원인의 `Unknown`을 남기고 새 occurrence를
admit하지 않는다. 이전 성공 목록이나 빈 목록으로 대신하지 않는다. 다음 `ok` emission은
아래 identity·retime·baseline 규칙으로 적용한다. fault 자체는 이미 admit한 Run의 취소가
아니며 별도의 명시된 cancellation 규칙을 대신하지 않는다.

accepted live edit는 다음 의미를 가진다.

- event 전체를 type, grid, 중복, N, 권한, Program identity와 함께 atomic하게 검증한다.
- 런타임의 승인된 설정 상태는 각 항목에 표시 시각과 독립적인 opaque `slot key`를
  보존한다. 이 key는 GhostFlow source 문법이 아니며 작성자가 정하지 않는다. 설정
  event는 고유 event identity와 기준 settings revision을 가지며, retime은 기존
  `slot key`와 새 `TimeOfDay`를 함께 식별한다. UI와 저장소가 순서나 표시 시각을
  항목 identity로 대신해서는 안 된다.
- retime은 같은 항목의 표시 시각만 바꾼다. `(schedule ID, local date, slot key,
  DST fold)` occurrence identity와 admission/terminal ledger는 유지한다. 변경된
  `TimeOfDay`는 planned time metadata다. 이미 admit된 Range를 미래로 옮기면 즉시
  `.active = false`로 멈추고, 신뢰할 수 있는 시각이 새 시작점에 도달하면 같은
  occurrence를 변경된 반열린 구간에서 다시 평가한다. `.due`를 다시 내거나 두 번째
  admission을 만들지 않는다.
- 예를 들어 `TimeSlots<1min,N>`에서 08:00의 `range(10min)` occurrence를 08:04에
  admit한 뒤 그 항목을
  08:07로 retime하면 event 적용 위치에서 멈춘다. 08:07의 accepted 판단에서 같은
  occurrence를 다시 평가하며 `when`이 true이면 08:17까지 요청한다. occurrence ID,
  slot key와 ledger는 그대로다. event가 08:07 판단 위치에 적용되면 §5.2의 순서에
  따라 새 값을 먼저 적용하고 바로 같은 occurrence를 평가한다.
- 새로 추가한 항목은 새 `slot key`를 만들고 effective event position에서 baseline을
  세운다. 그 위치와 같거나 이미 지난 당일 slot은 내보내지 않고 미래 slot만 계획한다.
- 제거는 해당 `slot key`의 미래 계획만 없앤다. 제거 후 같은 표시 시각을 추가하는
  remove/add는 새 key와 새 occurrence이며 retime이 아니다. 제거는 admit된 Run을
  취소하지 않는다. admit된 Range를 retime하려면 remove/add가 아니라 기존 key를
  지정한 retime event여야 한다.
- 설정 event와 schedule scan은 effective position의 전체 순서를 따른다. 처음 추가된
  바로 그 position에서는 due가 되지 않는다.
- 재시작은 승인된 설정값을 복원할 수 있지만 pending queue를 만들지 않는다. occurrence
  ledger의 수명은 일반 config와 별개다. 복원 상태에는 표시 시각뿐 아니라 slot key도
  포함되어야 한다.

retime 결과도 전체 `TimeSlots<G,N>` 값으로서 grid, 중복, N과 같은 schedule의 Range
비중첩을 검증한다. 새 시각이 다른 항목의 Range와 겹치면 event 전체를 거부하고 기존
값, slot key, settings revision, active occurrence와 ledger를 모두 유지한다.

이 타입은 “15분마다”가 아니다. `[06:00, 18:45]`라는 특정 local clock slots를
나타낸다. 주기를 설정값으로 바꾸는 Periodic과 의미가 다르다.

## 3.7 Periodic과 Cron

### Periodic

Periodic은 repeat interval과 결정적인 anchor/phase를 가진 occurrence stream이다.

```ghost
schedule watering: Periodic {
  every = irrigation_interval;
  anchor = instant(datetime`2026-10-01T00:00:00Z`);
  interval_change = preserve_anchor;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

`every`의 성공 payload는 양의 `Duration`이어야 한다. config 참조라면 선언한 payload type도 Duration이어야
하며 Bool, Percent, 단위 없는 Number는 타입 오류다. runtime boot time을 숨은 anchor로
쓰지 않는다. anchor는 다음 중 하나다.

- `instant(DateTime)`: exact UTC instant에서 n*every를 더한다.
- `civil(Date, TimeOfDay)`: local civil timeline에서 n*every를 더한 뒤 필수 timezone과
  DST policy로 각 local timestamp를 해석한다. 일반 TimeOfDay 산술을 추가하지 않는다.
- `persisted_epoch`: activation record가 exact epoch instant와 stable epoch ID를
  제공해야 활성화할 수 있다. 재부팅 뒤 보존하며 boot time으로 대체하지 않는다.

운영자가 interval을 바꾸는 경우 #105/#110의 최신 결정을 따른다. 한 번의 설정 동작은
같은 program과 같은 run 안의 atomic stream emission이다. 설정 stream의 성공·오류
rail과 묶음 검증은 §5.2를 따른다. `every = irrigation_interval`은 해당 config의
`Result<Duration, SettingsFault>`를 소비하는 전용 문법이다. `ok(interval)`이면 아래
phase 정책으로 새 interval을 사용한다. `fault(reason)`이면 `Unknown(reason)`을
보존하고 새 occurrence를 admit하지 않는다. 이전 성공 interval로 계속 실행하거나
초기값으로 돌아가지 않는다. 이후 `ok`로 회복하면 그 effective position부터 phase
정책을 적용하며 오류 동안의 과거 occurrence를 catch-up하지 않는다. 이미 admit한
occurrence의 identity와 실행은 소급해서 바꾸지 않는다. settings revision과
effective event position은 성공·오류 observation 모두를 식별한다.
source/bytecode를 다시 쓰거나 새 run을 만들지 않는다. `every`가 설정이면
`interval_change`를 항상 명시한다.

- `preserve_anchor`: 같은 anchor에서 새 phase revision을 만들고 effective position보다
  뒤인 instant만 계획한다.
- `preserve_next`: 이전 phase가 이미 계획한 다음 occurrence 하나를 유지하고 그것이
  admit 또는 missed된 뒤 새 interval을 시작한다.
- `restart_after_change`: effective position을 새 anchor로 삼고 new every 뒤에 첫
  occurrence를 만든다. 설정 event 자체는 due가 아니다.

각 accepted 성공 변경은 durable phase revision을 만든다. 이전 future occurrence는 철회하고
이미 admit한 것은 유지한다. source occurrence key는 `(periodic epoch ID, phase revision,
ordinal)`이며 과거 occurrence를 catch-up하지 않는다.

실제 장치 재시작 뒤 설정값은 보존하지만 run identity는 새로 생긴다. 이 live-settings
규칙을 program 교체, 물리 binding 변경, Auto↔Manual 모드 전환에 일반화하지 않는다.

### cron5

Cron은 다음 공개 문법을 쓴다.

```ghost
schedule weekday_morning: Cron {
  timezone = "Asia/Seoul";
  at = cron5`0 6 * * 1-5`;
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

`cron5` field 순서는 minute, hour, day-of-month, month, day-of-week이며 seconds는 없다.
각 field는 `*`, 정수, comma list/range, `*/step`, `range/step`을 받는다. 범위는 각각
`0..59`, `0..23`, `1..31`, `1..12`, `0..6`이고 day-of-week 0은 Sunday다. 이름과
Sunday 별칭 7은 거부한다. day-of-month와 day-of-week를 동시에 `*` 이외로 제한한
규칙은 전통 Cron의 숨은 OR/AND를 선택하지 않고 진단한다. 존재하지 않는 civil date는
이동하지 않고 occurrence가 없다.

Cron은 occurrence 시각만 정의한다. run length, retry, late admission, output을 정하지
않는다. 이 의미들은 Window/Run, fallback과 control state로 결합한다.

## 3.8 DST, 자정과 work calendar

civil recurrence는 현재 설치 지역에 DST가 없더라도 정책을 명시한다.

- `dst_missing = skip | next_valid`.
- `dst_repeated = first | second | both | skip`.
- `both`는 두 fold를 다른 occurrence key로 식별한다.

이 두 field는 `Daily`, `DailySlots`, `Cron`, civil `Periodic`에 필수다. `At`의
fixed DateTime과 provider가 공급한 instant에는 DST ambiguity가 없다.

자연 사건 offset이 자정을 넘으면 day filter는 계산된 **scheduled start local Date**에
적용한다. trace에는 원래 자연 사건의 source date도 남긴다. day가 바뀌었다는 이유로
이미 admit한 Run을 정지하지 않는다.

요일, 공휴일, 현장 근무일은 서로 다른 규칙이다. 달력은 설치 profile이 실제 자료에
bind하는 logical provider로 선언한다.

```ghost
calendar holidays: HolidayCalendar;
calendar workers: WorkCalendar;

// schedule 내부의 예
on = day`mon..fri`;
on = day`mon,wed,fri`;
on = day`holiday`;
calendar = holidays;
on = day`workday`;
calendar = workers;
on = day`offday`;
calendar = workers;
```

weekday tag에는 calendar가 필요 없다. `holiday`는 HolidayCalendar, `workday`와
`offday`는 WorkCalendar를 요구한다. 종류가 맞지 않거나 binding이 없으면 activation
error다. calendar snapshot의 timezone은 schedule timezone과 같아야 한다.

work calendar snapshot은 calendar ID, revision, timezone, coverage range를 가진다.
판정 우선순위는 같은 날짜의 명시 예외, 선언된 holiday policy, weekly pattern이다.
같은 날짜의 충돌하는 예외는 invalid다. workday는 계획된 근무일이지 사람의 실제
재실 확인이 아니다. snapshot이 없거나 coverage 밖이면 workday와 offday 모두
Unknown이다. `!workday`로 Unknown을 offday 허가로 바꾸지 않는다.

overnight shift의 business date 귀속은 이 day tag가 결정하지 않는다. 별도 shift
계약 전에는 자정을 가로지르는 work interval을 거부하고 명시 구간으로 나눈다.

같은 typed 판정을 일반 control 식에서 쓰려면 Result를 명시적으로 처리한다.

```ghost
let weekday = local_day_is(day`mon..fri`, timezone: "Asia/Seoul");
let working = calendar_is(workers, day`workday`);
let can_start = case working { ok(value) => value; fault(_) => false; };
```

`local_day_is`는 `Result<Bool, ClockFault>`, `calendar_is`는
`Result<Bool, CalendarFault>`를 반환한다. Schedule의 `on`은 같은 fault를 Unknown으로
보존해 명시 fallback으로 보내지만 일반 식은 `case` 없이 Bool로 바꾸지 않는다.
달력과 timezone profile은 장치 로컬, removable storage, 선택적 gateway 중 어디서든
공급할 수 있다. 언어는 자료의 ID, revision, coverage, expiry를 요구할 뿐 인터넷을
요구하지 않는다.

## 3.9 Solar, 달과 조석

### 선택된 Solar 표기

Solar 일정은 rise/set occurrence를 위치와 시간대에서 해석한다.

```ghost
schedule morning: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise + 30min`;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

각 선언에는 trigger field와 §3.5 공통 policy field가 정확히 하나씩 필요하다.
latitude는 `-90..90`, longitude는 `-180..180`의 유한 literal이다.
Solar의 `at`은 다음 형태만 가진다.

- ``sun`rise` `` 또는 ``sun`set` ``.
- 위 사건과 `+` 또는 `-`를 결합한 정확한 whole-number Duration offset.
- offset magnitude는 최대 24시간이고 0도 허용한다.

이 tagged form은 Solar `at` 전용이다. interpolation이나 임의 표현식이 아니다.
위치가 없거나 invalid, clock이 untrusted, 날짜/지역에서 사건이 없음, provider가
지원하지 않음이면 새 occurrence를 내지 않고 이유를 보존한다. `fallback = skip`은
이미 admit한 run이나 단조 타이머를 끄지 않는다.

Solar의 rise/set은 sea-level astronomical event다. 지형, 고도, 관측 날씨가 자동
입력이 되지 않는다. 그런 보정이 필요한 설치는 별도 provider context와 provenance를
명시해야 한다.

### 달과 조석

만조·간조는 예측된 `DateTime` occurrence다. 그 전후 Duration offset으로 시작점을
만들 수 있다. 사리·조금은 특정 instant가 아니라 조차의 분류 상태/기간이므로
event offset의 피연산자가 될 수 없다. 달의 위상도 현장의 조석 예측과 동일하지 않다.
달 위상만으로 만조 시각이나 하루 발생 횟수를 추측하지 않는다.

조석 provider는 logical capability로 선언하고 설치 profile이 station/model에 bind한다.

```ghost
provider harbor_tides: TidePredictions;

schedule pre_high_tide: Tide {
  source = harbor_tides;
  timezone = "Asia/Seoul";
  at = tide`high - 30min`;
  basis = run(10min, within(5min));
  when = true;
  cancel_when = stop || unsafe_level;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

Tide `at`은 ``tide`high` `` 또는 ``tide`low` ``와 최대 24시간인 exact whole-number
Duration offset만 받는다. `spring`과 `neap`, 달 위상은 event operand가 아니다.

조석 context는 provider namespace, stable station ID, station/model, prediction revision,
coverage, expiry를 포함한다. provider는 correction revision이 달라져도 station 안에서
고유하고 안정적인 opaque event ID를 제공해야 한다. source occurrence key는 provider
namespace, station ID, opaque event ID다.
시간이나 “오늘의 두 번째 만조” 같은 ordinal을 identity로 쓰지 않는다. correction 전
아직 admit하지 않은 사건은 새 시각으로 이동할 수 있다. 새 시각이 observation
high-water 이전이면 `CorrectionPastHighWater`로 missed 처리한다. provider가 사건을
철회하면 `EventWithdrawn`이다. admit 뒤 revision이나 철회가 발생해도 중복 run이나
숨은 취소를 만들지 않는다.

stable ID를 보장하지 못하는 provider는 immutable snapshot으로만 bind할 수 있고 기존
event correction을 발행할 수 없다. provider revision, model/binding revision과 수정된
planned instant는 identity가 아니라 metadata다.

사리·조금과 달 위상은 quality-aware condition이다.

```ghost
provider moon: LunarEphemeris;
let neap = tide_is(harbor_tides, tide`neap`);
let full = moon_is(moon, moon`full`);
let use_short_run = case neap { ok(value) => value; fault(_) => false; };
```

`tide_is`는 `spring | neap`, `moon_is`는 `new | waxing_crescent |
first_quarter | waxing_gibbous | full | waning_gibbous | last_quarter |
waning_crescent`를 받으며 `Result<Bool, TemporalContextFault>`를 반환한다. 일반 식은
명시 `case`가 필요하다. Schedule `when`은 이 quality-aware predicate를 받아 fault를
Unknown으로 보존하고 fallback으로 보낸다. provider는 분류 기준, 지역/시간대, revision,
coverage, expiry, uncertainty를 제공한다. 달 위상은 현장 조석을 예측하지 않고 조석
분류는 실제 수위를 증명하지 않는다.

### 자연 기준의 fallback과 회복

새 자연·달력 일정에는 fallback이 필수다. 최소 fallback은 `skip`이다. Unknown 이유는
예를 들어 `ClockUnknown`, `LocationUnknown`, `EventUnavailable`, `PredictionMissing`,
`PredictionStale`, `CalendarMissing`, `CalendarOutOfRange`, `ZoneUnsupported`로 구분한다.

Solar는 신뢰된 civil clock이 있을 때 ``fixed_time(time`06:00`, terminal: skip)``을
명시할 수 있다. fallback occurrence가 admit된 source local date에는 회복한 Solar
event를 다시 admit하지 않는다. Tide는 예측 부재 시 사건 수와 identity를 알 수 없으므로
`skip`만 허용한다. network disconnect와 clock trust 상실은 동일하지 않다. 제한된
clock hold는 `clock = hold_trusted(d, terminal: skip)`을 명시한다.

회복 시 baseline을 세우고 놓친 사건을 재생하지 않는다. high-water와 occurrence ledger로
중복을 막는다. fallback은 sensor 검증, 모드, 자원 중재, 출력 안전 제약을 우회하지 않는다.

## 3.10 시간 기반 사용량 제약

고정 local day 예산과 rolling window 예산은 다르다.

```ghost
resource pump1: BoolActuator;
account pump_applied = on_time(pump1,
  stage: applied,
  persistence: durable);

constraints PumpBudgets {
  limit used(pump_applied, local_day("Asia/Seoul")) <= 1h {
    reserve = worst_case_on + stop_delay;
    on_unknown = block;
  }
}
```

`stage`는 `requested | safe | applied | confirmed` 중 하나다. confirmed는 compatible
feedback binding과 quality contract를 요구한다. 같은 physical resource의 alias와
겹친 control 요청은 stage를 정한 뒤 한 interval로 합친다.

ledger persistence는 다음 중 하나를 반드시 고른다.

- `durable`.
- rolling basis의 `block_after_restart(d)`. d는 보호 window 이상이어야 한다.
- local day basis의 `block_until_day_boundary`.
- `volatile`. 관찰 전용이며 `limit`에서는 거부한다.

durable state가 없거나 손상되면 `used`는 Unknown이다. 관찰은 Unknown을 표시할 수 있지만
보호 limit는 `on_unknown = block`을 명시한다.

day 예산은 같은 물리 설비의 final applied ON 구간을 자동·수동·여러 control에 걸쳐
한 번만 계수한다. 자정을 넘긴 구간은 신뢰된 local date 경계에서 나눈다. wall clock
보정으로 이미 확정한 사용량을 다른 날짜로 옮기거나 0으로 만들지 않는다. rolling 24h
한도는 최근 interval history가 필요한 별도 규칙이다.

시간 경계는 다음처럼 고정한다.

- accepted scan t_i에서 고른 requested/safe 값은 `[t_i,t_(i+1))`에 적용한다.
- applied/confirmed는 Driver가 검증한 monotonic event timestamp의 `[start,end)`다.
- `rolling(d)`는 t에서 `(t-d,t]`와 interval의 overlap을 적분한다. t에서 고른 새 값은
  t에서 아직 사용 시간을 소비하지 않았다.
- used가 limit와 정확히 같으면 추가 ON을 차단한다. 오래된 partial interval은 logical
  time에 따라 정확히 빠지며 fixed bucket을 쓰지 않는다.
- `local_day(zone)`은 resolved local midnight 사이의 `[start,next)`이고 DST에 따라
  23시간 또는 25시간일 수 있다. 경계를 넘는 interval은 나눈다.
- trusted profile로 날짜에 확정한 interval은 wall correction으로 이동·삭제하지 않는다.
  경계를 신뢰할 수 없으면 Unknown이다.

작업 시작 전에 전체 ON 상한과 정지 지연을 포함한 예산을 예약한다. 종료 시각 없는
수동 운전에는 남은 예산 안의 유한 lease와 cutoff를 둘 수 있다. 중단·완료 뒤 실제
적용 구간으로 정산한다. 사용량이 불확실하면 보수적으로 처리한다. 재부팅, program
revision, 새 schedule ID, clock rollback은 설비 ledger를 초기화하지 않는다.

`reserve`는 start admission limit에 필수인 bounded Duration 식이다. 수동 운전은 작성자가
finite lease/cutoff를 명시하고 그 최대값을 reserve에 포함한다. 사용 뒤 선언한 stage의
관측 interval로 정산한다. 전원 단절로 결과가 불명인 예약은 선택 persistence 정책 없이
반환하지 않는다.

일일 한도는 occurrence 중복 억제 수단이 아니다. 같은 5분 작업이 두 번 실행돼도
1시간보다 작을 수 있다. `once ... per occurrence`와 안정적인 occurrence ledger가
별도로 필요하다.

일일 횟수는 time ledger로 대신하지 않는다. stable identity를 가진 typed Event를 별도로
집계한다.

```ghost
event normal_run_started: Event;
account normal_starts = count_events(normal_run_started,
  over: local_day("Asia/Seoul"),
  persistence: durable);
let under_daily_start_limit = case normal_starts.count {
  ok(count) => count < 4;
  fault(_) => false;
};
```

requested/admitted/applied/confirmed 시작 또는 완료 중 어떤 event를 생산할지, 세척 event를
포함할지, 하루 한 번인지 매 N회인지, 세척 순서와 재시작은 사용자 program/policy다.
`.count`의 타입은 `Result<Int, AccountingFault>`다. 같은 event ID의 재전달은 한 번만 센다.
신뢰할 수 없는 local-day 경계는 `ClockUnknown`, 없거나 손상된 ledger는 각각
`LedgerMissing`, `LedgerCorrupt`, 불완전해 정확한 횟수를 모르는 ledger는
`LedgerIncomplete` fault다. 내부 u64 횟수가 `Int`의 최댓값을 넘으면 `CountOverflow`다.
이 경우 0으로 대체하거나 정수 범위로 감아서는 안 된다. 위의 `case`는 성공 횟수와
fault를 명시적으로 나누어 제어용 `Bool`을 만든다. **왜:** 불명 횟수를 0으로 취급하면 일일
작업 한도를 초과할 수 있다. 보호 `limit`에서 사용량이 Unknown이면 `on_unknown = block`이
실행을 차단한다.

## 3.11 확정된 시간 문법과 경계

이 장에서 확정한 공개 표기는 다음과 같다.

- `date`, `time`, `datetime` tagged literal과 `continuous_true`.
- 공통 schedule policy, `pulse/window/run/range`, `At`, `Daily`, `DailySlots`, `Periodic`,
  `Cron`, `Solar`, `Tide`.
- `TimeSlots<G,N>` live setting, Periodic phase 변경, `cron5`, day/calendar/DST.
- bounded `hold_trusted`, terminal fallback, stable natural-event provider identity.
- `on_time`, `used`, `rolling`, `local_day`, limit reservation과 persistence.

이 목록은 선택된 언어 계약이다. 현재 compiler 지원 범위와 실행 가능한 bytecode 범위는
§3.5와 §3.6의 구분을 따른다.

작성자는 schedule의 start predicate, basis와 duration, Run cancellation, DST 선택,
Periodic anchor/change policy, natural fallback, accounting stage/resource/reservation,
수동 lease와 세척 정책을 명시한다. 언어는 숨은 catch-up, retry, cancel, restart,
gateway requirement를 추가하지 않는다. compiler acceptance는 clock/provider 자료나
Driver/물리 동작의 증거가 아니다.

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전 장](02-types-expressions-state.md) ·
[다음 장](04-sensors-constraints-control.md)
