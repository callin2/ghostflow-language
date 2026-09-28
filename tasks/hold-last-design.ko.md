<!-- translation-source: tasks/hold-last-design.md -->

[영문 원본](hold-last-design.md)

# 범위가 제한된 hold 구현

Reference: §4.4, REF-04-031. 원래의 컴파일 수용 사례는 변경하지 않았다.
최초 RED: `build/hold-last-reference-red.log`. CLI 검사와 build가 모두
지원하지 않는 signal을 거부한다. 이 작업은 미결인 `true_for` 연속 관측
정책 질문과 독립적이다.

## 실행 계약

기존 Rust VM 상태 식과 원자적 tick/journal 의미를 사용한다.
새 opcode, JS 식 평가기, 자원 한계 확대는 없다.
현재 slice는 measured 물리 `Result<T, SensorFault>` 근거를 받는다.
Estimated 근거와 불확실성 계약은 전체 범위의 명시적인 미완료 항목으로 남는다.

Descriptor kind는 `hold-last`, 소스 AST mode는 `hold_last`다. 필드:
`name`, `payloadType`, `errorType: SensorFault`, `quality: measured`,
`forAtMostMs`, `clockInput: __gf_now_ms`, `sourceMode: sample`, `sources`,
`states`와 해당하는 경우 유한 enum `members`.

공통 상태 역할(11개): `available`, `value`, `heldSourceTag`, `heldEpoch`,
`heldId`, `heldTimestamp`, `held`, `age`, `maskedFaultPresent`,
`maskedFaultCode`, `maskedFaultOrigin`.
`available`은 허용 가능한 cache 기록이 있다는 뜻이다. `held`는 현재의
엄격한 age 상한에 따른 적격성 판단이다. 전자는 만료 뒤에도 유지될 수 있으나
후자는 그래서는 안 된다. 현재 선택되지 않은 root를 포함하여 물리 root마다
`lastEpoch`, `lastId` 상한 기록을 보존한다. 비용은 상태 11 + 2 × root 수다.
모든 상태와 다음 값은 Rust가 원자적으로 계산한다.

이름: `__gf_hold_last_<snake_role>_<signal>`. 소스 이력은
`__gf_hold_last_source_epoch_<signal>_<tag>`와 각각의 `source_id`를 사용한다.
Boolean 기본값은 false, scalar payload는 자체 타입의 기본값, 숫자는 0이다.
예외는 `heldId`/소스 `lastId` = -1과 `maskedFaultCode` = 3 (NotReady)이다.

새로운 허용 가능 sample은 원래 타임스탬프와 함께 cache를 대체한다.
중복 sample은 age를 갱신하지 않는다. Fault와 선택 변경은 cache를 보존한다.
Cache 자체 소스의 epoch 교체는 해당 root가 선택되지 않아도 cache를 무효화한다.
Age가 0이어도 결과는 Held다. 근거가 없거나 만료되면 NotReady를 반환한다.
Result sample 품질은 0 unsourced, 1 measured, 2 Held다. 변환은 Held를 measured로
승격할 수 없다. Cold restart는 사용할 수 없는 상태에서 시작한다. 영속적인
checkpoint 복원에는 별도로 증명된 소스/시간 연속성이 필요하다.

## Trace와 산출물 경계

Rust `TickRecord.stateAfter`는 계산된 age와 가려진 fault를 포함한 모든 사실을
기록한다. 검증된 생성 소스 binding이 이를
`observeSourceTrace(...).heldEvents`로 투영한다. Decoder는 기록된 필드만 매핑하고,
age나 적격성을 계산하지 않는다. 정본 JS replay와 native package의
descriptor/type/default 검사는 생성 상태와 sample 입력 binding을 다룬다.
기존 native package의 정본 소스 replay 한계는 별도로 남는다.

## 소유권과 수용 기준

- Sol: 컴파일러, 진단, 실제 native/WASM 실행 테스트.
- Astra: native 서명 package descriptor와 bytecode binding 검사.
- Luna: source envelope/provenance 테스트.
- Root: JS host, source trace, JS package replay, 통합과 검토.

필수 검사: 새/지연 sample, 정확한 만료, 누락 scan, 중복 및 거부된 sample 식별자,
일반 fault, A→B fault, 선택되지 않은 cached root의 epoch 교체, 중첩 Held의 승격 금지,
제한된 자원, 실패 scan rollback, replay, 소스 식별자 보존, 서명 descriptor 변조.
## 검증된 measured slice (2026-09-23)

- `build/hold-last-focused-final.log`: 컴파일러 2, 진단/경계 10,
  실행 10; 22/22 통과. 실행은 실제 native와 두 WASM ABI, 그리고
  conditioner rollback, 거부된 sample 식별자, 지연 전달, cold restart,
  결정적 replay에 대해 두 공개 host를 모두 다룬다.
- `build/hold-last-provenance-focused.log`: 14/14 통과(상위 그룹 하나 포함).
  Source envelope, 생성 binding 변조, 실제 Held observer,
  잘못된 host descriptor를 다룬다.
- `build/hold-last-signed-js.log`: 서명 JS 수용과 다시 서명한
  descriptor/provenance 변조 6건. 모든 변조는 대상 bytecode 로딩 전에 거부되었다.
- `build/hold-last-package-final.log`: Rust package suite 23/23.
  서명 hold 변조 시나리오 42건과 실제 GFB 상태 type/default 검증을 포함한다.
  누락된 기본값 검사는 `build/hold-last-package-binding-red.log`에서
  처음 RED로 관측했다.
- `build/hold-last-factoring-green.log`: hold→debounce→hold 체인은 이전에
  5,415바이트 intent를 생성했다. 성공 영역의 품질 전파와 순수 식 분리로
  이를 420바이트로 줄였다. 체인의 가장 큰 식은 3,151바이트이며,
  변경하지 않은 4,096 한계 안에 있다. Selector fault 평가와
  rollback에는 명시적인 회귀 테스트가 있다.

전체 gate: `build/compiler-runtime-batch9-full.log`, 종료 코드 1.
모든 Rust/native/WASM 선행 단계는 통과했다. Node: 테스트 1,662건,
1,468 pass, 30 fail, 164 TODO, skip 0. 실패는 모두 기존의 다른 Reference 사례다.
REF-04-031은 변경 없이 CLI 검사와 build 모두 통과한다. Executable Reference:
173/203 통과. Node 실패 뒤 tutorial 검증은 실행하지 않는다. 보고서는
`build/compiler-runtime-batch9-reference-results.json`과
`build/compiler-runtime-batch9-verification.json`에 보존되어 있다.

Measured hold slice는 검증되었다. Estimated 근거/불확실성, 명시적 연속성 proof를
갖춘 영속 복원, native package의 정본 소스 replay 한계,
전체 Reference 완료 목표는 미결이다.
