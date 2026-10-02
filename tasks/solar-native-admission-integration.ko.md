<!-- translation-source: tasks/solar-native-admission-integration.md -->

[영문 원본](solar-native-admission-integration.md)

# Native Solar admission 통합

기준: Reference §3.4–3.8과 기존 GFB5 Solar pulse 계약.
이 문서는 구현 기록이며 언어 계약을 변경하지 않는다.

영속 framed API는 Farm Device [#102](https://github.com/callin2/farm-device/issues/102)의
제한된 선행 작업 [#400](https://github.com/callin2/ghostflow-language/issues/400)이다.
현재 개발 base에 원래 `4815b54` owner 구현을 재사용한다. Device pin 이전과
하드웨어 acceptance는 별도 gate다.

## 구현된 내용

`Runtime::activate_with_solar`는 schedule-only GFB5 module,
명시적 boot epoch, terminal identity 용량을 받는다.
`tick_with_solar`는 ClockSnapshot과 선언 site로 연결된 descriptor 순서의
완전한 provider occurrence fact를 받는다. Provider는 설치된 Solar descriptor
(timezone, latitude, longitude, event, offset, revision)로부터 fact를 도출해야 한다.
Provider는 미리 계산된 `due` bit가 아니라 fact를 공급한다.

Native VM은 Rust SolarPulseEngine admission을 준비하고 적격 crossing에서만
bytecode `when` 술어를 평가한다. 앞선 schedule projection 읽기를 지원하며,
해당 projection에 대해 scalar transition/intent를 실행한다.
Clock, terminal ledger, scalar 상태, 출력, journal은 함께 commit된다.
어떤 실패도 준비된 schedule 변경을 폐기한다. 거부된 tick은 재시도할 수 있다.
`TickRecord.schedule_trace`와 JSON encoding은 판단과 occurrence별
provider/context revision 근거를 보존한다.

공개 Rust API는 `ScanDriver::scan_with_solar(frame, clock, &[SolarInput]) ->
ScanOutcome`도 제공한다. `Runtime::solar_checkpoint()`는 불투명한 `GFSO` v1
snapshot을 `Result<Vec<u8>>`로 반환한다. `Runtime::restore_solar_checkpoint(&[u8])`와
`ScanDriver::restore_solar_checkpoint(&[u8])`는 첫 scan 전에만 이를 복원한다.
Snapshot에는 정확한 기존 program fingerprint와 순서가 있는 Solar site,
우발적 손상 검사인 CRC32(인증 기능 아님), terminal source-day identity만
포함된다. 복원은 새로 활성화한 runtime의 fresh boot epoch와 clock baseline을
보존한다. Checkpoint에는 scalar 상태가 포함되지 않으며 run replay를 지원하지
않는다. 새 civil checkpoint 형식은 추가하지 않는다. Schedule별 terminal
identity 상한은 계속 1–4096개다.

Host는 완전한 provider fact를 공급한다. Admission과 원자적 상태 commit은 VM이
담당한다. Host는 성공한 checkpoint를 저장한 뒤에만 ON을 게시하거나 적용해야
한다. 저장 실패 시 실행을 중단하고 출력을 clear해야 한다. 이것만으로 실제
하드웨어가 동작했다는 뜻은 아니다.

명시적 pause에는 `Runtime::observe_solar_paused(clock, facts)`와 ScanDriver
wrapper가 pure-Solar clock과 terminal identity만 진행한다
([#402](https://github.com/callin2/ghostflow-language/issues/402)). 작성된 predicate/scalar
평가, scalar input 소비, intent, tick journal, scan identity 변경은 없다.
Suppression은 작성된 `ConditionsFalseAtPulse` trace가 아니다. 거부된 관측은 아무것도
commit하지 않는다. OFF 상태에서 변경된 terminal identity를 저장한다. 저장 실패는
durability 인정이나 resume 허용 없이 실행을 중단해야 한다.

Solar는 `scan_with_solar`가 요구하는 비감소 program-logical clock을 사용하며 pause
중 멈출 수 있다. 실제 wall time과 trust는 그대로 공급한다. Wall gap, rollback,
recovery는 shared-core 규칙을 유지하며 소비한 occurrence는 resume 때 뒤늦게 실행하지
않는다. 이것은 이동이나 application의 실측 기간이 아니다.

호출자는 schedule마다 terminal identity를 1–4096개 선택한다.
Batch는 그 용량으로 제한된다. Revision 텍스트는 근거 준비/보존 전에
필드마다 UTF-8 128바이트로 제한한다. 용량 소진은 식별자 이력을 제거하지 않고
tick을 거부한다. 이는 명시적 저장 상한이며 인증된 byte 예산이나 ESP32 deployment 결과가 아니다.

## 근거

`4815b54`의 원래 focused 근거는 `cargo check -p ghostflow-core --tests`: 통과,
`schedule_module`: 30건 통과, `scan::tests`: 6건 통과다. 이 수치는 과거 기록이며
현재 consumer나 firmware의 acceptance가 아니다.

Schedule 테스트는 다음 실행 동작을 다룬다.

- baseline, 정확한 crossing, 중복 억제, JSON trace;
- 지연 실행 대신 거짓 술어 종결 처리;
- 하류 산술 실패 rollback과 성공하는 재시도;
- 정확한 gap 경계, over-gap skip, 모든 occurrence가 missed인 multiple crossing;
- unknown clock, recovery baseline, wall-clock rollback;
- 앞선 schedule projection 의존성;
- 불일치 site/epoch, revision 상한, terminal 용량;
- 연결되지 않은 tick, rewind, 혼합 temporal prelude의 명시적 거부.

최초 native 실행 테스트는 새 API 구현 전에 실패했고 native binding 뒤 통과했다.
`cargo test -p ghostflow-core`와 `cargo check --workspace`가 통과한다.

## WASM provider-fact transport

`GhostFlowRuntime.activateSolar({ bootEpoch, terminalCapacity })`는
`gf_activate_solar`를 통해 같은 native schedule-only engine을 연결한다.
일치하는 `__gf_now_ms`/`__gf_time_epoch`를 포함한 모든 scalar 입력 설정 뒤
host는 `tickSolar({ clock, schedules })`를 호출한다.
성공한 tick은 다른 native tick처럼 그 scalar 입력을 소비한다.
`trace.scheduleTrace`는 native 판단을 보존한다.

Clock은 `monotonicMs`, `bootEpoch`, 선택적 `wallMs`/`uncertaintyMs`,
`trusted`, 신뢰되지 않을 때 `unknownReason`, 선택적 `sourceRevision`을 담는다.
순서가 있는 각 schedule 항목은 `site`, `coverageFromWallMs`,
`coverageToWallMs`, `rows`를 담는다. 각 행은 `sourceDay`, `available`,
선택적 `scheduledWallMs`(available일 때 정확히 존재), `providerRevision`,
`contextRevision`을 담는다. Host는 due bit를 제공할 수 없다.
이는 provider fact이며 이 저수준 transport가 천문 예측을 독립적으로 검증하지는 않는다.

`GFSF` binary packet은 version 1, little endian, 최대 65,536바이트다.
Header는 u16 version과 u16 schedule 수(1–128)를 담는다.
Clock 필드는 u64 단조 시각, u64 boot epoch, 선택적 wall time,
선택적 uncertainty, Bool trusted, 사유 문자열, revision 문자열이다.
선택 정수는 1바이트 존재 flag 뒤의 u64다(없으면 0).
문자열은 u16 UTF-8 바이트 길이 뒤에 최대 128바이트가 온다.
각 schedule은 u32 site, u64 coverage 시작/끝, u16 행 수(0–4096),
그 뒤 u32 source day, Bool 가용성, 선택적 예정 시각, provider 문자열,
context 문자열로 된 행을 담는다. Boolean은 0/1만 받는다.
모든 u64 값은 JS 정확한 정수 범위 안이어야 한다. 중복 site, 잘림,
잘못된 UTF-8, 후행 바이트, 모순된 option flag는 runtime dispatch 전에 거부한다.
Native admission은 occurrence coverage와 clock/site binding을 검증한다.
실행 실패 뒤 admission과 scalar 상태는 재시도 가능하게 남는다.

`tests/solar-provider-wasm.test.mjs`는 실제 WASM admission, rollback,
중복 억제, provider trace 근거, unknown-clock 복구, 모든 packet 잘림을 검증한다.
GFB5 encoding 테스트와 함께 테스트 12건이 통과한다.

## 과거 기록의 남은 통합 작업

다음은 public GFB5 compiler 통합 이전의 최초 native slice 기록이다.
#400은 영속 Rust owner 경계를 추가한다. 현재 Device 통합, deployment 예산,
하드웨어 acceptance를 입증하지 않는다.

이 native slice로 새로 GREEN이 된 Reference 수용 ID는 없다.
컴파일러가 GFB5 prelude를 생성하고 공개 ControlRuntime이 정책 manifest를
검증하며 descriptor에 연결된 provider fact를 새 WASM API로 전달하기 전까지
공개 Solar 컴파일은 정본 정책을 계속 거부한다. ControlRuntime은 현재
Solar descriptor에서 `dueInput`을 기대하며 이 GFB5 경로에 아직 연결되지 않았다.
기존 host `due` 입력은 native admission 계약의 근거가 아니다.

혼합 window/true_for prelude, 보정된 byte 예산,
descriptor로 검증된 자연 사건 provider 통합,
civil/Tide occurrence format은 미완료다. Native 일반 activation,
미지원 혼합 activation, rewind는 계속 fail-closed다.
어떤 누락 계약도 host가 계산한 pulse나 약화한 Reference fixture로 대체하지 않는다.
