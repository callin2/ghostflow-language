<!-- translation-source: docs/TRACEABILITY.md -->
[영문 원문](TRACEABILITY.md)

# 언어 구현과 검사

어떤 검사가 실행되고 통과했는지는 현재 체크아웃의 [검증 보고서](VERIFICATION.md)를 확인하세요. 이 표는 유지되는 테스트 위치를 안내하며, 원본 작업공간의 완료 또는 하드웨어 주장을 이어받지 않습니다.

| 계약 | 구현 | 검증 |
|---|---|---|
| 최신 제어 문법, 형식, 하향 변환 | `tools/control.mjs`, `tools/gfb1.mjs` | `tests/control.test.mjs`, `tests/compiler.test.mjs` |
| 리터레이트 추출과 원본 위치 | `tools/literate.mjs`, `tools/toolchain.mjs` | `tests/literate.test.mjs`, `tests/toolchain.test.mjs` |
| 검증된 VM/상태/의도 의미 | `crates/ghostflow-core/src/lib.rs` | Rust 단위 테스트, 네이티브/WASM 튜토리얼 동등성 |
| 형식화된 호스트 입력 및 매니페스트/해시 검사 | `runtimes/wasm/control-runtime.mjs` | `tests/control-host.test.mjs` |
| 센서 처리와 신호 | 코어 `signals.rs`, WASM signals ABI/어댑터 | Rust 테스트, `tests/signals-wasm.test.mjs`, 수분 튜토리얼 |
| 독립 제약과 바인딩 | `tools/constraints.mjs`, `runtimes/wasm/policy.mjs` | `tests/constraints.test.mjs`, `tests/policy.test.mjs` |
| 일정 발생과 고정 ID | WASM 일정/승인 어댑터 | `tests/schedule.test.mjs`, `tests/scheduled-admission.test.mjs` |
| 스테이션 소유권, 할당량, 지속성 | 코어 `station.rs`, WASM station ABI, Node ledger | Rust 테스트, `tests/station-wasm.test.mjs`, `tests/ledger.test.mjs`, 스테이션 데모 |
| 네이티브/WASM에서 동일한 생성 입력 추적 | `tools/tutorial.mjs`, 코어 네이티브 러너 | 튜토리얼 단언과 생성된 추적 |
| 실행 증거와 릴리스 식별 정보 구분 | `tools/integration-contract.mjs`, `contracts/integration-v1` | `tests/integration-contract.test.mjs` (가상 픽스처) |

프로젝트 간 릴리스 출처 정보와 Device/API/프런트엔드 검사는 통합 및 소비 프로젝트가 담당합니다. 비공개 마이그레이션 작업공간에는 원래 작업 및 대화 기록이 보관됩니다.
