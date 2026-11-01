<!-- translation-source: docs/TRACEABILITY.md -->
[영문 원문](TRACEABILITY.md)

# 언어 구현과 검사

이 페이지는 각 언어 계약을 그것을 구현하는 코드, 그리고 그것을 검사하는 테스트와
연결합니다.

이 페이지는 유지되는 테스트가 **어디에** 있는지만 알려 줍니다. 테스트가
통과했는지는 알려 주지 않습니다. 어떤 검사가 실행되고 통과했는지 보려면 현재
체크아웃의 [검증 보고서](VERIFICATION.ko.md)를 읽으십시오. 또한 이 표는 원본
작업공간의 완료 주장이나 하드웨어 주장을 이어받지 않습니다.

| 계약 | 구현 | 검증 |
|---|---|---|
| 최신 control 문법, 타입, 하향 변환(lowering) | `tools/control.mjs`, `tools/gfb1.mjs` | `tests/control.test.mjs`, `tests/compiler.test.mjs` |
| literate 추출과 원본 위치 | `tools/literate.mjs`, `tools/toolchain.mjs` | `tests/literate.test.mjs`, `tests/toolchain.test.mjs` |
| 검증된 VM/상태/의도 의미 | `crates/ghostflow-core/src/lib.rs` | Rust 단위 테스트, native/WASM 튜토리얼 parity(동등성) |
| 타입이 지정된 호스트 입력과 manifest/해시 검사 | `runtimes/wasm/control-runtime.mjs` | `tests/control-host.test.mjs` |
| 센서 조건화(conditioning)와 신호 | 코어 `signals.rs`, WASM signals ABI/어댑터 | Rust 테스트, `tests/signals-wasm.test.mjs`, 토양 수분 튜토리얼 |
| 독립 제약과 바인딩 | `tools/constraints.mjs`, `runtimes/wasm/policy.mjs` | `tests/constraints.test.mjs`, `tests/policy.test.mjs` |
| 예약 발생과 고정 ID | WASM 예약/admission 어댑터 | `tests/schedule.test.mjs`, `tests/scheduled-admission.test.mjs` |
| 스테이션 소유권, 할당량, 영속화 | 코어 `station.rs`, WASM station ABI, Node ledger | Rust 테스트, `tests/station-wasm.test.mjs`, `tests/ledger.test.mjs`, 스테이션 데모 |
| native/WASM에서 동일하게 생성된 입력 trace | `tools/tutorial.mjs`, 코어 native 러너 | 튜토리얼 단언과 생성된 trace |
| 릴리스 identity와 실행 증거의 구분 | `tools/integration-contract.mjs`, `contracts/integration-v1` | `tests/integration-contract.test.mjs` (가상 픽스처) |

다음 두 종류의 검사는 이 저장소 밖에 있습니다.

- 프로젝트 간 릴리스 provenance와 Device/API/프런트엔드 검사는 통합 프로젝트 및
  소비 프로젝트가 담당합니다.
- 원래의 작업 및 대화 기록은 비공개 마이그레이션 작업공간에 남아 있습니다.
