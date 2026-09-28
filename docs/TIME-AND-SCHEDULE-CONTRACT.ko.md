<!-- translation-source: docs/TIME-AND-SCHEDULE-CONTRACT.md -->
[영어 원문](TIME-AND-SCHEDULE-CONTRACT.md)

# 시간과 Schedule 계약 제안

추적: language 이슈 #23 / integration `TASK-85.2` / 검토 R15–R17.

이는 DateTime, monotonic elapsed time, 반복 schedule, solar/tidal event, work calendar,
명시 fallback의 최소한으로 일관된 설계 인계다. 일반 temporal framework가 아니며 아래
모든 표면 형식의 구현을 주장하지 않는다. `Duration`, elapsed timer, `DailySlots`, bounded
Solar host는 이미 있다. 나머지 type/policy는 T2–T4 및 공동 검토를 위한 제안이다.

추가 continuous-true Bool timer metadata/호환성 계약은
`CONTINUOUS-BOOL-TIMER-CONTRACT.md`(NT-T1-A/#46)에 별도로 명세돼 있다.
여기서 설명하는 기존 `elapsed(state)` timer를 바꾸지 않는다.

## 확인된 제품 의미

- Control 값/output은 시간에 따라 변하는 signal이지만 source는 이름, 식, 명시 old/next
  state, output 연결로 읽기 쉽게 남는다. 사용자는 subscription/operator 연결 장치를 쓰지 않는다.
- `Schedule`은 계속 평가된다. 지연 function 호출이나 background thread가 아니다.
  놓친 판단을 나중을 위해 조용히 queue하지 않는다.
- Calendar time/monotonic elapsed time은 다른 clock 영역이다. wall-clock 보정은 이미
  admit된 elapsed timer를 되감거나 연장하지 않는다.
- Solar/lunar/tidal control에는 현재 시각과 설치 문맥이 필요하다. 부재/untrusted/stale
  문맥은 `Unknown`이며 `false`가 아니다.
- Natural-time 규칙에는 명시 fallback이 있다. NTP disconnect grace, catch-up, late start,
  pause, retry, restart 정책을 추론하지 않는다.
- 확인된 공통 premise는 명시 source/policy가 될 수 있지만 tacit knowledge 발견/확인은
  언어 실행 의미가 아니라 작성/검토 workflow에 속한다.

## 현재 구현 경계

- `Duration` 문법은 `ms`, `s`, `min`, `h`로 표현한 nonnegative 정수 millisecond다.
  현재 control literal 경로는 아직 safe-integer 최댓값을 강제하지 않는다. standalone
  constraints dialect는 양의 `i32` 상한을 쓴다. 구현 빈틈이며 두 종류의 기본 Duration이 아니다.
- `timer x = elapsed(flag)`는 생성 monotonic `__gf_now_ms` input을 사용하고 성공 control
  tick과 함께 timer state를 commit한다.
- `DailySlots<15min>`/`Solar`는 source에 one-scan `.due` Boolean input으로 노출되는 host
  소유 occurrence provider다. output을 운전하지 않는다.
- Solar는 timezone, literal 좌표, rise/set과 정확한 offset, `fallback = skip`을 요구한다.
  현재 native provider는 한정된 timezone/year profile을 지원한다. 미지원 문맥은 fail-closed다.
- 기존 provider는 boot/recovery 후 baseline을 세우고 wall-clock rollback 중 중복 event를
  억제하며 큰 forward wall gap에서 skip한다. Solar는 monotonic scan gap도 검사하지만
  `DailySlots` v1은 그렇지 않다. 현재 60초 상한은 호환 동작이며 새 Schedule 계약의 범용
  숨은 default가 아니다.
- Browser Solar는 platform IANA zone을 받지만 현재 portable Rust provider는 `Asia/Seoul`,
  `UTC`, `Etc/UTC`만 지원한다. 두 consumer가 같은 zone vector를 통과할 때까지 package는
  명시적으로 공유하는 profile만 주장할 수 있다. compiler 승인은 cross-host 지원이 아니다.

구현 동작은 [SOLAR-SCHEDULE.md](SOLAR-SCHEDULE.md) 참조. 이 제안은 해당 artifact를
보존하고 후속 의미에 명시 versioning을 요구한다.

## 승인된 Daily 실행 경계 — 2026-09-23

RTC/NTP/platform clock provider는 평가마다 wall/monotonic clock snapshot과 wall-clock trust
상태를 공급한다. GhostFlow runtime은 `Daily` occurrence crossing, admission, missed occurrence,
중복 억제를 계산하고 schedule ledger를 관리한다. host 저장소는 runtime 재시작 후에도
ledger를 유지한다. 기반 time source를 교체해도 `Daily` 의미는 불변이다. 이는
[Reference §3.5 schedule 계약](reference/03-time-and-schedules.md#35-schedule의-공통-의미)의
실행 책임을 배정하며 새 언어 정책을 추가하지 않는다.

## 값과 clock 영역

| 영역 | 최소 계약 | 비고 |
| --- | --- | --- |
| `Duration` | 정확한 nonnegative integer millisecond, `0..2^53-1` | 상대 길이. checked arithmetic. month/year unit 없음 |
| `Date` | Gregorian date, 연도 `1970..9999` | time/timezone 없음 |
| `TimeOfDay` | `00:00:00.000..23:59:59.999` | date/offset/recurrence 없음 |
| `DateTime` | millisecond 해상도의 정확한 UTC instant. Unix epoch부터 `9999-12-31T23:59:59.999Z`까지 | literal에 `Z` 또는 numeric UTC offset 필수. 값에 IANA zone 없음 |
| Monotonic instant | host-only exact nonnegative millisecond와 boot/run epoch | civil time으로 format하거나 wall-clock literal로 작성하지 않음 |

공통 exact transport 상한은 JavaScript safe integer 범위다. 선언 civil 범위의 `DateTime`
instant는 그 안에 들어간다. leap-second `:60`, `24:00`, offset 없는 DateTime literal,
존재하지 않는 날짜는 진단 대상이다. IANA timezone은 반복 Schedule/context에 속하며
DateTime instant에 속하지 않는다. 양의 delay가 필요한 construct는 기본 `Duration` 범위를
바꾸지 않고 0을 거부할 수 있다. T2는 control literal, constraint, manifest 값,
native/WASM 교환에 정확한 범위를 일관되게 적용해야 한다.

최소 산술은 의도적으로 작다.

- `DateTime ± Duration -> DateTime`. 범위를 검사한다.
- `Duration + Duration`, nonnegative checked subtraction.
- DateTime/TimeOfDay 비교는 일치 타입을 요구한다.
- `TimeOfDay + Duration`은 자정에서 wrap하지 않는다. Schedule에서 Date/timezone과 해소한다.
- `Duration`이 nonnegative라 `DateTime - DateTime`은 최소 profile에 없다. instant 비교나
  monotonic `elapsed`를 쓴다. 실제 control 사례가 필요로 할 때만 signed delta type을 추가한다.
- Calendar day/month/year는 고정 millisecond Duration이 아니다.

권고 source-literal 경계는 tagged-template 후보인 `date\`2026-09-15\``, `time\`06:30\``,
`datetime\`2026-09-15T06:30:00+09:00\``로 남는다. R15가 철자를 검토한다.
runtime string parsing이 아니다.

## Clock snapshot과 책임

accepted scan 하나는 immutable host snapshot 하나를 받는다.

```text
ClockSnapshot {
  monotonicMs
  bootEpoch
  wallMs?              // 정확한 DateTime instant
  wallQuality          // Trusted | Unknown(reason)
  uncertaintyMs?
  sourceRevision?
}
```

Driver가 NTP/RTC/platform time을 얻고 trust를 판단한다. compiler/VM은 network 연결을 열거나
machine clock을 읽지 않는다. trusted quality 없는 `wallMs`는 사용 가능한 calendar time이
아니다. monotonic regression은 scan을 거부한다. wall-clock forward/backward 보정은 새
관측으로 받지만 occurrence high-water/identity가 중복을 막는다.

마지막 trusted wall time 사용을 계속 허용한다면 명시 정책이어야 한다. 개념적으로
`hold_last for Duration then <fallback>`이며 monotonic time으로 잰다. 이 문서는 활성화하지
않는다. R17이 노출 여부를 결정한다. `skip`이 유일한 필수 최소 fallback으로 남는다.

## Schedule은 typed reactive value

간결한 개념 형태는 다음과 같다.

```text
Schedule = {
  trigger: TriggerRule,
  day: DayRule?,
  when: BoolPredicate?,
  basis: Pulse | Window(Duration) | Run(Duration, LateStartPolicy),
  timezone: IanaZone,
  context: installation bindings,
  fallback: Fallback,
  dst: DstPolicy,
  gap: ObservationGapPolicy
}
```

duration-basis variant 하나를 가진 product type이며 `Cron | Window | Run`을 동등한 세
종류로 취급하지 않는다. trigger rule은 하나의 DateTime, daily TimeOfDay, 이름 있는
five-field Cron, 각 solar/tidal event를 포함한다. 저장 값은 stream을 설명한다. 읽기가
설비를 시작하지 않는다. `when`은 선언 input/state에 대한 정적 컴파일 dependency expression이며
runtime closure/callback이 아니다. 전역 output constraint는 후속 별도 단계로 남으며
admit된 Run의 requested output을 차단할 수 있다.

scan마다 해소 결과는 `True`, `False`, `Unknown(reason)`와 rule/context revision이다.
fallback이 `Unknown`을 해소한다. 부정이 운전 허가로 바꾸지 않는다. public projection은
일반 control 값으로 남는다.

- `.due`는 하나의 occurrence가 admit될 때 accepted scan 하나 동안 true다.
- Window는 반열린 window와 모든 현재 predicate가 true일 때만 true인 level을 노출할 수 있다.
- Run 실행 state/`.active`는 명시 state/timer로 lowering된다. 숨은 비동기 task가 아니다.

최소 실행 경계는 생성 `.due` input과 함께 atomic sidecar observation 하나를 전달한다.

```text
ScheduleObservation {
  format: GhostFlow/schedule-observation-v1
  scheduleId             // 안정적인 선언/source-map identity
  definitionRevision     // 정확한 loaded code/package revision
  decision: False | Due | Unknown(reason)
  disposition?           // Before | PredicateFalse | AlreadyAdmitted | Missed(reason)
  occurrence? { id, sourceKey, plannedWallMs, sourceDate?, scheduledLocalDate }
  providerRevision?
  contextRevisions
}
```

초기 Unknown 이유는 `ClockUnknown`, `LocationUnknown`, `EventUnavailable`, `PredictionMissing`,
`PredictionStale`, `CalendarMissing`, `CalendarOutOfRange`, `ZoneUnsupported`다.
초기 missed 이유는 `ConditionsFalseAtPulse`, `ObservationGap`, `LateStartExpired`,
`CorrectionPastHighWater`, `EventWithdrawn`이다. 일반 false `when` predicate나 알려진 missed
occurrence에 Unknown 이유를 재사용하지 않는다.

`fallback = skip`은 VM을 위해 Unknown admission을 `.due = false`로 해소하지만 같은
accepted scan trace의 `decision = Unknown(reason)`을 지우지 않는다. 미해결 quality에 대한
source-level 분기는 최소 profile 밖이다. 나중에 추가하려면 검사되지 않는 Bool을 또 만드는
대신 typed Result/Decision이 필요하다. 따라서 Bool만으로 provenance를 가진 척하지 않고
현재 `.due` 호환성을 유지한다.

각 planned occurrence는 stable identity를 가진다. canonical key는 stable `scheduleId`와
source occurrence key다. fixed DateTime, 해당될 때 DST fold를 포함한 daily/Cron local slot,
solar event kind/source Date, tidal provider stable station/event key다. loaded definition
revision, provider revision, 보정 planned time은 metadata이며 identity가 아니다. 따라서
admission 전 hot-swap/provider 보정은 두 번째 occurrence를 만들지 않고 같은 occurrence를
옮기거나 재해석한다. 의도적으로 새 schedule에는 새 `scheduleId`를 부여한다. 이미 admit된
occurrence replay에는 우연한 source 편집이 아니라 별도 명시 operator 행동이 필요하다.
key는 public occurrence ID를 위해 SHA-256 hash하고 high-water/admission ledger에 저장한다.
최대 한 번 admit할 수 있다. 따라서 지속 true가 scan마다 run을 만들지 않는다. 나중에
true가 된 condition은 명시 Window/late-start 구간 안에서만 occurrence를 admit할 수 있다.
같은 occurrence 안 false→true 반복은 rearm하지 않는다. 반복 시도에는 명시 반복 trigger/
rearm 정책이 필요하다.

`Pulse`에는 late interval이 없다. crossing에서 모든 조건이 true가 아니면 missed다.
`Window(5min)`은 `[planned, planned + 5min)` 안 첫 admission을 허용한다.
`Run(5min, on_time)`은 관측 crossing에서만 admit한다. `Run(5min, within(10min))`은
`[planned, planned + 10min)` 안 첫 admission을 허용한다. 양의 grace는 run 길이가 아니다.
반열린 구간을 놓치면 queue된 호출이 아니라 `LateStartExpired`다. 최소 `LateStartPolicy`
variant는 이 둘뿐이다. 모든 Run manifest는 정확히 하나의 tagged 값인 `{ kind: on_time }`
또는 `{ kind: within, withinMs: <exact positive Duration> }`을 담는다.

admit된 Run은 실제 admission부터 monotonic time으로 duration을 잰다. Run elapsed time은
admission부터 연속이며 requested output false나 final output을 막는 global constraint로
pause하지 않는다. Requested-ON, safe-ON 누적 시간, continuous-safe-ON 시간은 별도 명시
timer expression이며 숨은 Run mode가 아니다. 어느 것도 물리 움직임을 증명하지 않는다.

## Recurrence, Cron, DST와 자정

최소 Cron 철자는 dialect 추측을 피하려고 `cron5`로 명명한다. minute, hour, day-of-month,
month, day-of-week이며 seconds는 없다. 전통 Cron의 뜻밖 OR 규칙을 피하려고 첫 profile은
day-of-month/day-of-week 둘 다 제한하는 규칙을 거부한다. timezone은 필수다.

civil-time recurrence는 현재 설치 zone에 transition이 없어도 명시 DST 처리를 요구한다.

- 존재하지 않는 local time: `skip`/`next_valid`.
- 반복 local time: `first`/`second`/`both`/`skip`.

어느 선택지도 조용히 선택하지 않는다. fixed-offset DateTime literal에는 DST ambiguity가
없다. window는 반열린 구간이다. solar/tidal offset이 자정을 넘으면 day filter는 해소된
scheduled start의 local Date를 사용한다. trace는 natural event source date도 유지한다.
별도 continuation/constraint 규칙이 없으면 day 변경은 admit된 Run을 멈추지 않는다.

새 Schedule manifest는 `dstMissing`(`skip | next_valid`), `dstRepeated`
(`first | second | both | skip`), `gapPolicy = skip`, 정확한 양의 `maxObservationGapMs`를
요구한다. source 철자는 R16 검토 대상이지만 값 부재는 T3 진단이다. 기존 `DailySlots` v1은
nonexistent=`skip`, repeated=`first`, gap=`skip after 60000ms`라는 관측된 호환 동작을
가진 legacy descriptor다. 새 profile로 조용히 이름을 바꾸지 않는다. migration은 명시
field와 새 manifest/runtime identity를 내보낸다.

새 profile은 연속 accepted `ClockSnapshot`의 두 field 모두에서 관측 연속성을 계산한다.
monotonic delta 또는 양의 wall-clock delta 중 하나가 `maxObservationGapMs`를 넘으면 gap이다.
wall rollback 자체는 high-water 규칙으로 처리하지만 과도한 monotonic delta를 숨기지
못한다. 이 검사는 host polling 속도/NTP 보정 source와 독립적이다.

최소 `gapPolicy = skip`은 Pulse/Window/Run late admission보다 우선한다. admission interval이
gap과 교차하는 모든 미admit occurrence는 `ObservationGap` missed로 표시한다. Window나
`within(...)`이 여전히 열렸다는 이유만으로 현재/후속 scan이 되살릴 수 없다. 초기 boot/
trust 복구는 같은 fail-closed 방식으로 baseline을 세운다. 향후 replay/catch-up 정책은
별도로 명명해야 한다.

같은 manifest는 정확한 `timezoneProfile` revision을 명시한다. signed package는 이를 필수
host capability로 결속한다. browser/native host는 runtime activation 전에 미지원 profile/
zone을 거부한다. compiler가 IANA string을 받는 것은 모든 consumer 구현의 증거가 아니다.

## Work-calendar day 규칙

weekday, 공휴일, 계획 근무 규칙은 다르다.

- `day\`mon..fri\``는 해소된 local Date만 사용한다.
- `day\`holiday\``는 named holiday calendar snapshot을 사용한다.
- `day\`workday\`` / `day\`offday\``는 named site/crew work calendar를 사용한다.
- workday는 계획 근무이며 관측 근무자 재실이 아니다.

work-calendar snapshot은 calendar ID, revision, timezone, coverage range를 결속한다.
우선순위는 명시 date exception, 선언 holiday 정책, weekly pattern 순서다. 같은 날짜의
충돌 exception은 invalid다. 부재/coverage 밖 data는 `Unknown`이다. workday/offday 모두
Unknown이다. Schedule day 규칙은 admission 자격을 제한하며 이미 active Run을 제한하지 않는다.

잠정 표면은 `on = day\`...\``/`calendar = workers`다. R16이 철자를 검토한다. 첫 profile은
calendar date에만 day tag를 정의하며 overnight shift의 business date를 추론하지 않는다.
자정을 건너는 work interval을 시도한 calendar 정의는 거부한다. 작성자는 자정에서 명시
time window를 나눌 수 있다. 후속 shift type은 day tag 변경 없이 business-date 귀속을
추가할 수 있다.

## Natural event 문맥과 fallback

Solar event 문맥은 timezone, location revision, event kind, provider calculation revision을
결속한다. tidal event 문맥은 station/model, prediction revision, coverage, expiry를 추가
결속한다. tidal provider profile은 prediction revision에 걸쳐 stable이며 한 station의
여러 same-kind event에 고유한 opaque event ID를 공급할 때만 허용한다. source occurrence
key는 provider namespace + station ID + 해당 event ID다. time/same-day ordinal을 correction
identity로 사용하지 않는다. 이 capability 없는 provider는 immutable snapshot을 공급할 수
있지만 correction 지원을 주장할 수 없다. high/low tide는 occurrence event다. spring/neap은
분류 condition이며 DateTime처럼 offset할 수 없다. 언어는 고정 daily tide 수나 prediction이
물리 수위를 증명한다고 가정하지 않는다.

provider 보정은 위 stable event identity를 유지한다. admission 전에 최신 valid prediction이
planned instant를 옮길 수 있다. 그 instant가 observation high-water와 같거나 뒤로 이동하면
occurrence는 `CorrectionPastHighWater` missed이며 catch-up하지 않는다. 명시 provider 철회는
`EventWithdrawn` missed다. 순서 변경은 stable ID를 바꾸지 못한다. admission 후 revision/
철회는 중복을 만들거나 admit된 Run을 취소하지 않는다. location 부재, untrusted clock,
미지원/polar event, prediction 부재/stale, calendar 불가 이유는 trace에서 구분된다.

natural/time/calendar 문맥에 의존하는 모든 new-profile rule은 `fallback`을 요구한다.
최소 지원 값은 `skip`이다. 새 occurrence를 발행하지 않고 이유를 보존한다. 이미 admit된
Run을 끄거나 monotonic timer를 지우지 않는다. fixed-TimeOfDay 대안은 civil clock/timezone이
trusted일 때만 의미가 있으므로 `skip` 같은 terminal fallback이 필요하다. 복구는 새
baseline을 세운다. 향후 명시 catch-up 정책 추가 없이는 놓친 occurrence를 replay하지 않는다.

`DailySlots` v1은 fallback field 없이 선언된 이전 runtime identity 아래에서 읽을 수 있다.
T3 migration은 명시 fallback을 만들어야 한다. legacy acceptance를 새 source의 fallback
생략 허가로 취급해서는 안 된다.

## T2–T4 acceptance vector

이 ID는 stable semantic vector다. R15–R17은 source fixture가 되기 전에 잠정 철자를
바꿀 수 있다.

| ID | 시나리오 | 예상 결과 | 소유자 |
| --- | --- | --- | --- |
| T1-TYPE-01 | valid/invalid Date, TimeOfDay, offset DateTime 경계 | 정확한 정규화 값 / compile 진단 | T2 |
| T1-TYPE-02 | monotonic time 진행 중 wall clock 뒤로 이동 | elapsed timer 진행, 중복 occurrence 없음 | T2/T4 |
| T1-TYPE-03 | DateTime + Duration이 UTC/local 자정 통과 | 정확한 instant, modulo-day wrap 없음 | T2 |
| T1-DURATION-01 | control/constraints/ABI의 `0ms`, safe 최댓값, 최댓값+1 | construct가 0 허용 시 첫 두 값 정확. overflow 일관 거부 | T2 |
| T1-PULSE-01 | 08:00 Pulse. crossing에서 start predicate false 후 08:10 true | missed, queue 안 됨 | T4 |
| T1-WINDOW-01 | 08:00–09:00 Window. predicate 08:10 첫 true 후 toggle | 08:10 admission 한 번. 같은 window rearm 없음 | T4 |
| T1-RUN-01 | 계획 08:00. `Run(5min, within(10min))` 08:02 admit | target 08:07 monotonic. wall 보정 불변 | T2/T4 |
| T1-RUN-02 | Run active 중 requested/safe output 1분 차단 | Run은 admission 기준 완료. 별도 requested/safe timer는 자체 값 기록 | T4 |
| T1-RUN-03 | `Run(5min, on_time)` predicate가 crossing 후 true 또는 `within(10min)` 08:10 도달 | 정확한 이유의 missed. queue 없음 | T3/T4 |
| T1-FALLBACK-01 | natural rule에 fallback 생략 | compile 진단 | T3 |
| T1-FALLBACK-02 | `skip`이며 clock/location/event/prediction 불가 | due 없음. 정확한 Unknown 이유 보존 | T4 |
| T1-RECOVERY-01 | missed event 후 trust 복구 | baseline만. catch-up/중복 없음 | T4 |
| T1-REVISION-01 | occurrence admission 전/후 prediction 이동 | 최신 pre-admission time / post-admission 중복 없음 | T4 |
| T1-REVISION-02 | 무관 source hot-swap이 schedule 선언 ID 유지 | 같은 occurrence ID. 중복 admission 없음 | T3/T4 |
| T1-DST-01 | nonexistent/repeated local TimeOfDay | 선택 명시 DST 정책. 정책 부재 거부 | T3/T4 |
| T1-DST-02 | `both`로 repeated local TimeOfDay | DST fold로 구분되는 occurrence key 두 개 | T3/T4 |
| T1-ZONE-01 | package가 한 host의 선언 profile 밖 IANA zone 요청 | activation 전 거부. 추측 offset fallback 없음 | T3/T4 |
| T1-CRON-01 | `cron5`가 day-of-month/day-of-week 둘 다 제한 | compile 진단. OR/AND 추측 아님 | T3 |
| T1-CALENDAR-01 | 일반 weekday / weekday holiday / weekend 특별 근무 / 임시 offday | workday, offday, workday, offday | T4 |
| T1-CALENDAR-02 | holiday 특별 근무 / snapshot 부재 또는 만료 | workday / workday와 offday 모두 Unknown | T4 |
| T1-MIDNIGHT-01 | day filter와 natural-event offset 자정 통과 | 해소 start Date로 filter. source event Date 보존 | T4 |
| T1-MIDNIGHT-02 | shift 귀속 없이 work calendar overnight interval 시도 | configuration/compile 진단. 이전 날짜 추측 없음 | T3 |
| T1-ACTIVE-01 | Run admission 후 workday 변경/context 실패 | admission filter만으로 정지하지 않음 | T4 |
| T1-TIDE-01 | high/low prediction 유효. spring/neap을 offset event로 사용 | occurrence 해소 / compile type 진단 | T3/T4 |
| T1-TIDE-02 | same-kind event 둘 순서 변경 또는 하나가 high-water 뒤로 이동/철회 | stable ID로 일치 유지. 이동/철회 event는 missed, replay 없음 | T4 |
| T1-GAP-01 | monotonic delta/양의 wall delta가 signed rule/profile 상한 초과 | `ObservationGap`, 추론 replay 없음. wall rollback이 monotonic gap을 숨기지 못함 | T4 |
| T1-GAP-02 | 과도 gap이 열린 Window/`within(...)`와 겹침 | gap 우선. `ObservationGap` missed. 이후 admission 불가 | T4 |

T2는 native/WASM 교환에서 DateTime/monotonic identity를 보존해야 한다. T3는 문법/필수
field 진단을 소유한다. T4는 provider 해소, quality/fallback, occurrence identity,
중복 억제, 복구를 소유한다. Driver 테스트는 target device NTP/RTC/location/tidal data를
별도로 확립한다.

## 공동 검토 경계

- R15: tagged Date/TimeOfDay/DateTime, `Schedule`/Pulse/Window/Run, `cron5` 철자.
  calendar/monotonic 분리는 다시 열지 않음.
- R16: day/calendar 철자, workday/offday 의미, DST/자정 예.
- R17: fallback 철자와 명시 bounded `hold_last` 허용 여부.

설치별 location, tide station, calendar 내용, equipment delay, 허용 uncertainty는 언어
default가 아니다. 검토는 이를 명시하는 방법을 선택한다. 구현/physical acceptance는
후속 작업으로 남는다.
