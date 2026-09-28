<!-- translation-source: tasks/solar-native-admission-integration.md -->

[영문 원본](solar-native-admission-integration.md)

# Native Solar admission 통합

기준: Reference §3.4–3.8과 기존 GFB5 Solar pulse 계약.
이 문서는 구현 기록이며 언어 계약을 변경하지 않는다.

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

호출자는 schedule마다 terminal identity를 1–4096개 선택한다.
Batch는 그 용량으로 제한된다. Revision 텍스트는 근거 준비/보존 전에
필드마다 UTF-8 128바이트로 제한한다. 용량 소진은 식별자 이력을 제거하지 않고
tick을 거부한다. 이는 명시적 저장 상한이며 인증된 byte 예산이나 ESP32 deployment 결과가 아니다.

## 근거

`cargo test -p ghostflow-core --test schedule_module`: 테스트 21건 통과.
다음을 다루는 실행 테스트 9건을 포함한다.

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

## 여전히 필요한 내용

이 native slice로 새로 GREEN이 된 Reference 수용 ID는 없다.
컴파일러가 GFB5 prelude를 생성하고 공개 ControlRuntime이 정책 manifest를
검증하며 descriptor에 연결된 provider fact를 새 WASM API로 전달하기 전까지
공개 Solar 컴파일은 정본 정책을 계속 거부한다. ControlRuntime은 현재
Solar descriptor에서 `dueInput`을 기대하며 이 GFB5 경로에 아직 연결되지 않았다.
기존 host `due` 입력은 native admission 계약의 근거가 아니다.

혼합 window/true_for prelude, 영속 checkpoint/restore/replay,
보정된 byte 예산, descriptor로 검증된 자연 사건 provider 통합,
civil/Tide occurrence format은 미완료다. Native 일반 activation,
미지원 혼합 activation, rewind는 계속 fail-closed다.
어떤 누락 계약도 host가 계산한 pulse나 약화한 Reference fixture로 대체하지 않는다.
