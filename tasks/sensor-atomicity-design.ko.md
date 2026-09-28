<!-- translation-source: tasks/sensor-atomicity-design.md -->

[영문 원본](sensor-atomicity-design.md)

# Sensor scan 트랜잭션

Reference §2.8/§4.15는 거부된 tick에서 sensor, filter, VM 상태가 commit되지
않아야 한다고 요구한다. Batch7은 VM debounce rollback을 증명했지만 VM 수용 전에
conditioner가 변경되는 문제를 드러냈다. 이 작업은 그 host 통합 공백을 메운다.
물리 수집, 재부팅 간 영속성, 향후 controller/resource 구현을 인증하지는 않는다.

## 계약

- 각 Rust signal handle은 완전한 checkpoint를 최대 하나 소유한다. 여기에는
  filter 이력, 시계, 수용된 sample 식별자, fault, 복구 횟수,
  hysteresis, 진단, 설정, ABI 오류 buffer가 포함된다.
- `gf_signal_begin`, `gf_signal_commit`, `gf_signal_rollback`은 성공 시 1,
  잘못된 handle/lifecycle이면 0을 반환한다. 중첩 begin은 원래 checkpoint를
  대체할 수 없다. 비활성 commit/rollback은 거부한다. Dispose는 현재 상태와
  checkpoint 모두를 제거한다. 트랜잭션 내부 reset은 되돌릴 수 있다.
- JS `SignalConditioner` 메서드는 해당 export만 호출한다. 복사된 JS sensor 상태,
  평가기, freshness cache를 도입하지 않는다.
- 먼저 전체 scan을 capture하고 검증한다. 무엇이든 변경하기 전에 모든 sensor와
  hysteresis conditioner에서 begin한다. Begin 실패 시 이미 시작한 handle만 rollback한다.
- Conditioning, 입력 준비, 알려진 native VM 거부는 시작한 모든 conditioner를
  rollback한다. VM의 commit된 상태/결과, 마지막 수용 시각과 frame ID는
  바뀌지 않는다. 완전한 유효 재시도는 허용한다.
- 타입이 지정된 native-dispatch 오류에는 `committed: false | true | null`이 있다.
  상태는 준비 전 false에서 시작하고, native 호출 직전 null이 되며, 반환 직후
  native 반환값인 Boolean이 된다. 오류 buffer decoding과 allocation 정리는
  이 사실을 덮어쓸 수 없다. 오류 메시지 텍스트로 commit 상태를 추정하지 않는다.
- 양의 native 상태는 trace/outcome JSON decoding 전에 conditioner와
  수용된 host 시각/frame ID를 commit한다. 이후 표시 오류는 수용된 실행을
  되돌릴 수 없다. 양의 native 상태 뒤 정리 예외가 발생해도 conditioner와
  수용된 host 관리 정보를 반드시 commit한다. 이런 오류는 해당 host instance를
  종료시킨다. Commit 뒤의 예외 클래스는 scan을 거부된 것으로 재분류할 수 없다.
- Native dispatch 중 예상하지 못한 trap/adapter 예외는 commit 상태가 불명이다.
  Rollback을 주장하거나 추측에 기반한 재시도를 허용하지 않고 이후 step을 종료한다.
  현재 상태를 유지한다. Host dispose 때 대기 checkpoint를 해제하여 마지막
  commit된 VM 결과를 계속 검사할 수 있게 한다.
- 이전 framed 포괄 fault latch는 conditioner rollback이 없어서 존재했다.
  알려진 거부 scan에서는 이를 제거한다. 위의 구체적인 불명/postcommit 경우에만
  종결 처리를 유지한다.

## 수용 기준과 소유권

- Astra: 제한된 Rust snapshot, lifecycle/native 테스트, 대응 WASM build.
- Luna: 얇은 JS 메서드와 실제 WASM lifecycle/error 테스트. 누락된 ABI의
  TypeError가 lifecycle 거부 assertion을 충족해서는 안 된다.
- Sol: 두 ControlRuntime 경로, 명시적 native commit 경계, 실제
  median/EMA/hysteresis/recovery rollback과 재시도 테스트, 대체된 계약.
- Root: source/API 검토, 명시적 테스트 등록, 모든 소유자가 변경을 확정한 뒤
  전체 통합 gate, 근거 색인, 남은 범위 집계.

구분 가능한 vector는 이력을 초기화하지 않고 보존한다.
median(3): commit 10,20 + 거부 999 + commit 30 => 20.
EMA(0.5): commit 10 + 거부 20 + commit 30 => 20.
Hysteresis: commit 20 (on) + 거부 40 (off) + commit 33 (경계 사이) => 계속 on.
복구 counter, 식별자, 진단, 시계도 마찬가지로 rollback해야 한다.

메모리는 할당된 conditioner마다 제한된 Rust snapshot 하나가 추가된다.
정본 컴파일러의 생성 입력 예산 128개는 3입력 conditioner를 최대 42개 허용한다
(다른 입력이 있으면 이 수는 줄어든다). 이는 독립 ABI 호출자의 전역 allocation
한계가 아니다. 구현 후 handle별 측정 메모리와 실제 수용 결과를 기록한다.

## Rust 근거

- Native: `Sensor` 664바이트; checkpoint slot 688바이트; 전체 handle 1,376바이트.
- WASM: `Sensor` 648바이트; checkpoint slot 664바이트; 전체 handle 1,328바이트.
- Checkpoint는 복사된 오류 텍스트를 추가로 최대 40바이트 소유할 수 있다.
  Allocator 부가 비용은 제외한다. Core Sensor에는 heap 소유 필드가 없다.
- Core signals 15/15, native ABI 2/2, allocation 테스트 1/1 통과.
  Allocation 테스트는 core update/read/clone/restore를 다루며 ABI 오류 문자열 할당은 다루지 않는다.
- 근거: `build/sensor-transaction-core-final.log`,
  `build/sensor-transaction-abi-final.log`,
  `build/sensor-transaction-allocations.log`,
  `build/sensor-transaction-wasm-memory.log`.
- 이 결과만으로 REF-04-065나 전체 compiler/runtime 완료를 증명하지 않는다.

## 집중 host 검증 근거

- 실제 WASM lifecycle 테스트: 6/6. Native-dispatch 상태 테스트: 11/11
  (`build/native-dispatch-status-final.log`).
- Host 원자성 테스트: 9/9 (`build/control-runtime-atomicity-final.log`).
  여러 filter, hysteresis, 복구, 이후 conditioner 오류, 수용된 식별자/시각,
  재시도, postcommit 실패를 다룬다.
- 전역 REF-04-065는 여전히 부분 완료다. Controller/resource 트랜잭션과
  그 밖의 조항에는 별도 근거가 필요하다. 전체 host 상태의 영속 restart/replay는
  이 일시적인 scan checkpoint와 별개다.
- Batch8 전체 통합 gate: Node 총 1,621건, 1,426 pass, 31 fail, 164 TODO, 0 skip; Reference 172 pass / 31 fail; non-Reference 0; tutorial 미실행. 보고서: `build/compiler-runtime-batch8-full.log`, `build/compiler-runtime-batch8-reference-results.json`, `build/compiler-runtime-batch8-verification.json`.
