<!-- translation-source: tasks/issue-137-plan.md -->

[영문 원본](issue-137-plan.md)

# Issue 137: 실행 가능한 `after_event` slice

날짜: 2026-09-24

범위: Reference 사례 `REF-04-026`이 기존 Rust `AfterEvent<32>` engine을 통해
실행되게 한다. 자연 provider 관측 ABI와 분류 유효성 정책이 아직 명세되지
않았으므로 `REF-03-062`는 보류한다.

## 계약

- 모든 start event 식별자를 독립적으로 유지한다.
- 명시적 `after_event_any`, `after_event_all` 집계를 보존한다.
- 명시적인 measured 술어 관측만 받는다. Sample 사이를 보간하거나
  scan 주기를 관측 근거로 취급하지 않는다.
- 생성 Result channel은 runtime host의 private 영역으로 유지한다.
- VM scan 전에 tracker를 준비한다. VM scan commit 뒤에만 tracker 상태를
  commit하며 scan이 거부되면 rollback한다.
- Rust engine의 기존 유한 용량, 반개구간 경계, 확인 처리, fault 동작을 유지한다.

## TDD 증분

1. 정확한 Reference 소스가 실행 가능한 control로 lowering되고 생성 projection
   channel을 일반 입력으로 공급할 수 없음을 증명하는 RED compiler/runtime 테스트를 추가한다.
2. 중첩 A/B 식별자, 정확한 끝 경계, 누락된 술어 관측(`NotReady`),
   거부된 VM scan 이후 rollback에 대한 RED runtime 테스트를 추가한다.
3. 사용된 `any`/`all` projection을 생성 Result 입력으로 lowering하고
   `ControlRuntime`에서 descriptor를 검증한다.
4. 각 descriptor를 기존 WASM `AfterEventRuntime`에 연결한다. 명시적 event fact와
   술어 관측을 준비하고 Rust 소유 결과를 투영한 뒤 VM 트랜잭션과 함께 commit/rollback한다.
5. 소스, 기대값, 상태를 변경하지 않고 scenario transport와 `REF-04-026` oracle을 확장한다.
6. 보류 경계 문서와 gate 테스트를 갱신한다. 집중 테스트, native/WASM 검사,
   Reference simulator, repository verifier 순으로 실행한다.

## 예상 파일

- `tools/control.mjs`
- `runtimes/wasm/control-runtime.mjs`
- `tools/ghostsim.mjs`
- `tools/scenario-sensors.mjs`
- `tests/after-event-contract.test.mjs`
- `tests/after-event-control.test.mjs`
- `tests/reference-simulator.test.mjs`
- `tests/deferred-runtime-gates.test.mjs`
- `tools/verify-language.mjs`
- `docs/AFTER-EVENT-WASM-ABI.md`
- `docs/TEMPORAL-DESCRIPTOR-ARTIFACT.md`

## 보류된 소유자 결정

`REF-03-062`에는 provider/site binding, 분류 기준, clock 신뢰, coverage,
만료, uncertainty, revision, `TemporalContextFault` 매핑을 다루는
타입이 지정된 provider 관측 계약이 필요하다.
이 slice에서 긍정적인 `tide_is`/`moon_is` 실행을 지어내지 않는다.
