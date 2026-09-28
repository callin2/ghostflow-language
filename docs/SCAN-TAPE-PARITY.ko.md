<!-- translation-source: docs/SCAN-TAPE-PARITY.md -->
[영어 원문](SCAN-TAPE-PARITY.md)

# Native/WASM scan tape parity (D9)

상태: 구현 계약. acceptance는 host verifier가 기록한다.
Task: [language #16](https://github.com/callin2/ghostflow-language/issues/16),
integration TASK-76.9. 상위 항목: [system #11](https://github.com/callin2/farm_studio_system/issues/11)
/ 공통 Clock/DI/RO driver. 조정: [Project 6 Backlog](https://github.com/users/callin2/projects/6/views/3).

## 결정

GhostFlow는 host clock/I/O 구현과 독립적으로 하나의 logical time에 하나의 완전한 input
snapshot을 평가한다. native/browser WASM은 같은 compiled module, capability, initial state,
순서 있는 frame 시도를 소비하고 동일한 accepted scan 결과를 만들어야 한다. 공유
`ScanDriver`는 input 검증, state transition, timer, constraint의 유일한 소유자로 남는다.

이 gate는 framed native driver/public framed WASM adapter를 비교한다. 역사적 CSV/legacy
tick 예는 native oracle이 아니다. 이 task는 runtime ABI, 제품 source 문법, timer 의미,
Device pin을 바꾸지 않는다.

## 구현 소유권

| 파일 | 책임 |
| --- | --- |
| `crates/ghostflow-core/examples/scan_tape.rs` | `ScanDriver::scan`으로 전달하는 테스트 전용 native transport. JSONL 관측 |
| `tests/scan-tape-parity.test.mjs` | 각 scenario 한 번 compile, 두 target 실행, 기대값/정확한 결과 동등성 assert |
| `tools/verify-language.mjs` | Release native harness build, parity suite 필수 실행, artifact hash 기록 |
| 이 문서 | 범위, format, failure 계약, 증거 해석 |

복사된 interpreter, 모의 timer 구현, 새 production dependency는 없다. 각 harness는 WASM
adapter와 같은 1024-entry journal 용량으로 새 runtime을 시작한다. fixture의 output
capability는 module 선언 output field에서 도출한다. 각 replay는 새 runtime을 사용한다.

## Test tape transport

Node test의 canonical tape는 `scanId`, `logicalTimeMs`, 순서 있는 `inputs` array를 가진
frame 시도의 ordered array다. 정확한 array를 WASM에 전달하거나 native CLI용으로 serialize할
때 중복/순서를 보존한다.

native CLI는 GFB1 파일과 UTF-8 TSV tape 파일을 받는다. 비어 있지 않은 행은 다음과 같다.

```text
scanId<TAB>logicalTimeMs[<TAB>name<TAB>b|n<TAB>value]...
```

ID/time은 unsigned decimal integer를 사용한다. `b` 값은 `true`/`false`이고 `n` 값은 finite
decimal 수치 표기를 쓴다. 빈 input list는 유효 transport이며 driver가 module에 맞춰
검증한다. 테스트 전용 format의 name에는 tab/줄바꿈이 들어갈 수 없다. 잘못된 transport는
nonzero CLI exit로 거부한다. 거부 GhostFlow frame으로 세지 않는다. allocation/실행 전에
module/tape/row 크기와 input 수를 제한한다. TSV는 conformance fixture format이며 새 public
runtime ABI가 아니다.

형식이 올바른 frame 시도마다 JSON 행 하나를 반환한다.

```json
{"accepted":true,"outcome":{"format":"GhostFlow/scan-outcome-v1","scanId":0,"logicalTimeMs":0,"trace":{}}}
```

`outcome`은 위 축약 object가 아니라 완전한 canonical trace를 포함한다. 거부 시 `accepted`는
false, `outcome`은 마지막 승인 결과(첫 commit 전에는 null), `error`는 진단 text다.
native는 core의 기존 trace JSON serialization을 사용한다. output/state를 재계산하면 안 된다.

## 비교와 failure 계약

각 시도마다 accepted/rejected 분류와 완전한 결과의 정확한 deep equality를 assert한다.
time, scan ID, module identity, input/state, requested output, constraint/safety trace 포함이다.
같은 오류 두 개가 올바른 동작으로 통과하지 않도록 target 간 동등성과 별도로 scenario별
기대 동작을 assert한다.

error 문자열은 진단이며 cross-host ABI가 아니다. JavaScript envelope/Rust core는 다른
계층에서 거부할 수 있다. 둘 다 의미적으로 invalid인 시도를 거부하고 마지막 승인 결과를
보존하며 미소비 scan ID로 정정 재시도를 승인해야 한다. 유용한 곳에서 예상 진단 pattern을
검사한다. raw framed adapter는 재시도를 허용한다. 상위 control host fault latch는 다른
계약이며 이 harness에 강요하지 않는다.

필수 vector:

- 명시 예상 output을 가진 timer 만료 직전/경계/직후.
- Self-hold start/release/stop/restart, old/next state transition.
- Constraint/interlock 억제. 인과 trace를 가진 requested ON/safe OFF.
- 같은 timestamp, 32-bit millisecond 경계를 넘는 진행, replay.
- missing/extra/duplicate/reserved/wrong-type input, 잘못된 scan 순서, time regression,
  JavaScript-safe integer frame 상한을 넘는 값.
- 첫 commit 전 및 성공 commit 후 거부. 같은 ID의 정정 재시도로 거부가 state/timer/counter를
  전진시키지 않았음을 보여줌.
- 0 나누기 같은 runtime 평가 실패 후 복구. envelope 검증을 넘는 rollback 검사.

nonfinite/negative/malformed JavaScript envelope는 기존 WASM adapter suite가 계속 다룬다.
잘못된 TSV는 transport로 다루며 cross-host parity로 다루지 않는다.

## Gate와 증거

`npm test`는 명시적 parity 테스트 목록 실행 전에 이 source revision에서 native release
`scan_tape` 예/WASM을 build한다. `--node-only`는 두 artifact가 이미 존재하도록 요구하고
해당 실행이 build하지 않았다고 보고한다. 검증 보고서는 WASM/legacy native/framed native
artifact의 hash를 분리하고 source hash 집합에 새 source 파일을 포함한다.

독립 검토는 정확한 결과, rollback, control 논리와의 harness 독립성을 검사한다. 이슈
종료 전에 검토 HEAD에서 전체 host 검증이 통과해야 한다. firmware 소비/고정(D7/D8),
가속 browser scenario(D10), module 간 release qualification(D11)은 별도 task다.

## 이전 구현 참조

- `docs/SCAN-FRAME-WASM.md`, `crates/ghostflow-core/src/scan.rs`: 승인 framed 계약,
  input 완전성, transactional runtime 의미.
- `runtimes/wasm/framed-runtime.mjs`: public framed wrapper/last-outcome 규칙.
- 읽기 전용 predecessor `esp32s3-new-project/rust/firmware/src/inputs.rs`,
  `rust/control-core/src/debounce.rs`, `rust/firmware/src/main.rs`의 DI scan 절:
  physical raw-level 정규화/debounce는 logical input frame 전 device driver에 속한다.
  predecessor ST 경로나 이전 device 증거를 GhostFlow acceptance로 가져오지 않는다.
