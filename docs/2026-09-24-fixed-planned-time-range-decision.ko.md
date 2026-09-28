<!-- translation-source: docs/2026-09-24-fixed-planned-time-range-decision.md -->
[영어 원문](2026-09-24-fixed-planned-time-range-decision.md)

# 고정 계획 시간 구간 결정 — 2026-09-24

상태: 승인된 언어 의미. 구현은 별개다. 규범 문법과 동작은
[Language Reference §3.5](reference/03-time-and-schedules.md#35-schedule의-공통-의미)에 있다.

## Intent와 선택된 표면

운영자는 08:00–08:10 같은 고정 구간에 출력을 계획할 수 있다. 첫 trusted 관측이 08:04에
도착하면 출력에는 6분이 남는다. 구간이 08:04–08:14로 밀려서는 안 된다. 선택된 schedule
basis는 양의 Duration을 받는 `range(duration)`이다. trigger field가 occurrence의 계획
시작점을 정한다. 반열린 구간은 `[planned start, planned start + effective duration)`이다.

`run(duration, within(grace))`는 별개다. late admission을 허용하지만 admission부터 전체 run
duration을 잰다. `window(duration)`은 활성 계획 시간 구간이 아니라 admission window로
남는다. `pulse`는 관측된 crossing에서만 admit한다.

## Admission과 진행

- Range는 `when`이 true이고 trusted 현재 시각이 구간 안에 있을 때 현재 occurrence를
  admit한다. 첫 관측은 boot, trust 복구, observation gap 이후일 수 있다. 이전 만료
  occurrence는 replay하지 않는다. 끝과 같거나 그 이후면 `LateStartExpired`를 기록하고
  실행하지 않는다.
- Range 구간이 아직 열린 동안의 observation gap은 비종결 증거다. 나중에 되살릴 terminal
  missed record를 만들지 않는다. occurrence는 여전히 남은 시간만 admit할 수 있다.
  계획 종료점을 지나면 `LateStartExpired`는 terminal이다.
- untrusted clock은 Range를 새로 admit할 수 없다. 명시적 `hold_trusted(...)` clock 정책은
  uncertainty/provenance를 보존하며 상한이 있는 trusted extrapolation을 공급할 수 있다.
- late admission 예외는 이미 terminal missed나 withdrawn인 occurrence를 되살릴 수 없다.
  `CorrectionPastHighWater` 또는 `EventWithdrawn`으로 표시된 Tide event는 수정 구간에
  현재 시각이 포함돼도 terminal로 남는다.
- Admission은 안정적인 occurrence ID와 계획 시작점을 기록한다. 남은 시간을 monotonic
  deadline으로 변환한다. 그 occurrence 중 RTC/NTP wall 보정은 끝 계산을 위해 보류된다.
  활성 구간을 줄이거나 늘릴 수 없다. 이 Range가 종료된 뒤 후속 occurrence 판단에 보정된
  wall time을 적용한다. wall rollback이 같은 occurrence를 두 번 admit할 수 없다.
- admit된 활성 Range는 wall trust 또는 명시 clock hold가 만료돼도 monotonic deadline까지
  계속된다. terminal `skip`은 새 admission 판단에 적용되며 활성 deadline에는 적용되지
  않는다. 시작점이 미래가 되는 편집으로 pause된 Range는 clock quality가 Unknown일 때
  재진입할 수 없다. 복구 후 같은 구간이 아직 열려 있을 때만 재진입한다.
- 전역 safety constraint는 safe output을 즉시 차단한다. Range clock은 계속된다.
  계획 종료 전에 constraint가 풀리면 남은 시간만 출력을 재개할 수 있다. 차단 구간을
  끝에 더하지 않는다. `cancel_when`은 rearm 없이 occurrence를 종결한다.
- requested/safe/applied/confirmed 출력 증거는 구분된다. Range `.active`는 schedule 구간을
  기록하며 물리 동작을 기록하지 않는다.

계획 시작 08:00, `range(10min)`이면 08:04 admission에는 6분이 남는다. 08:10 admission에는
구간이 남지 않는다. 08:06–08:08에 safety가 차단하면 08:10까지만 출력을 재개할 수 있다.
08:07 wall 보정은 활성 deadline을 바꾸지 않는다.

## Live 시작점과 duration 변경

검증된 atomic live setting event는 event position부터 현재 occurrence의 scalar 계획 시작점
또는 Duration을 바꿀 수 있다. admission에서 확립된 안정적 clock 진행을 기준으로 평가하며
새 시작점 + effective Duration으로 구간을 재계산한다. late admission 시각은 계획 시작점을
대체하지 않는다. 시작 08:00, admission 08:04, 08:07에 10분을 12분으로 바꾸면 occurrence는
08:12에 끝난다. 5분으로 바꾸면 새 끝이 08:05이므로 같은 accepted 판단이 활성 Range를
종료한다. 시작점을 08:02로 편집하고 Duration 10분이면 끝은 08:12다. 어느 setting event도
새 occurrence를 만들거나 identity/admission ledger를 reset하지 않는다.

`DailySlots` `TimeSlots` 항목은 표시 `TimeOfDay`와 독립적인 불투명 runtime slot key를 가진다.
GhostFlow source 문법을 추가하지 않는다. 승인 retime setting event는 자체 event,
base settings revision, 기존 slot key, 대체 `TimeOfDay`를 식별한다. `(schedule ID, local
date, slot key, DST fold)`를 occurrence identity로 유지하면서 planned-time metadata를
바꾼다. 승인 settings state는 재시작을 거쳐 그 key를 유지한다. list 위치/표시 시각은
identity가 아니다.

따라서 `TimeSlots<1min,N>` 설정에서 admit된 08:00 `range(10min)` 항목을 08:07로 retime하면
event position에 pause하고 08:07에 **같은** occurrence를 재평가한다. `when`이 true면
08:17까지 output을 요청할 수 있다. 두 번째 `due`/admission을 만들지 않고 ledger를 유지한다.
event와 08:07 scan이 같은 effective position이면 event를 먼저 적용하고 그 완료 판단이
같은 occurrence를 재평가한다. 08:07을 포함하지 않는 더 거친 grid는 event를 거부한다.

Remove/add는 별도 연산으로 남는다. 제거는 이전 slot key의 미래 계획을 삭제한다.
같은 표시 시각이라도 추가하면 새 key를 만들고 일반 baseline 규칙을 시작한다.
Remove/add로 admit된 Range를 retime할 수 없다. 기존 key를 명시 retime으로 담지 않은 전체
값 교체는 순서/표시 시각에서 일치를 추측하지 않고 이 remove/add 규칙으로 해석한다.

setting event와 scan 순서는 [§5.2](reference/05-settings-and-observation.md#52-소스-변경과-운영-설정-변경)의
atomic live event 계약을 따른다. 완료 판단 position의 effective 값이 그 판단을 결정한다.

## 경계

이 결정은 기존 observation-gap/boot baseline 정책에 Range 특유의 예외를 부여한다.
Pulse/Window/Run은 기존 skip/admission 규칙을 유지한다. Range는 계획 종료 후 catch-up하지 않는다.

live start 편집이 admit된 occurrence의 새 시작점을 미래로 옮기면 event position의 accepted
판단이 즉시 `.active = false`로 설정한다. 새 시작점과 그 이후에 **같은** occurrence가
변경된 반열린 구간에 속하는지 재평가한다. `when`이 true면 현재 계획 종료까지만 requested
output을 재개할 수 있다. safe output은 safety constraint가 허용할 때만 재개한다.
두 번째 admission이 아니다. `.due`는 다시 pulse하지 않고 occurrence ID/ledger도 불변이다.
변경 끝이 안정적 현재 시각과 같거나 이전이면 즉시 occurrence를 종료한다. 나중에 재개하지 않는다.

## 비중첩 검증

같은 schedule의 두 occurrence는 반열린 Range 구간이 겹치면 안 된다. 인접 구간은 유효하다.
예를 들어 `DailySlots`의 `selected = [08:00, 08:15]`, `basis = range(30min)`은 compile
error다. 08:00–08:30과 08:15–08:45가 겹친다. 두 occurrence 간 runtime arbitration은 없다.

compiler는 정의/effective settings에서 occurrence 간격을 증명할 수 있는 trigger에만
`range`를 허용한다. 동적 recurrence/provider가 증명 가능한 간격을 공급하지 못하면
컴파일은 진단과 함께 `range` 선언을 거부한다. 정적 default는 compile 시 검사한다.
복원 effective settings는 activation 전에 검사하며 중첩이면 activation을 거부한다.
현재 admit된 구간과의 중첩을 포함해 중첩을 만드는 live setting event는 atomic하게 거부한다.
`DailySlots` 편집에도 적용한다. retime은 새 slot key를 할당하지 않고 제안 표시 시각을
검증한다. 거부 시 이전 표시 시각, slot key, settings revision, active occurrence, ledger를
보존한다. Remove/add는 별도 identity/baseline 규칙을 유지한다.
