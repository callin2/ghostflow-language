<!-- translation-source: tasks/true-for-driver-contract.md -->

[영문 원본](true-for-driver-contract.md)

# `true_for` Driver interval 선행 조건

현재 measured `Result` sample descriptor는 point 식별자
`sourceTag`, `present`, `epoch`, `id`, `timestamp`, `quality`를 담는다.
Driver가 연속 관측을 인증하는 interval은 담지 않는다.

Reference §4.4는 point sample 두 개, expected cadence, scan cadence,
중복, clock-only tick으로 연속성을 도출하는 것을 금지한다.
따라서 제한된 Driver interval fact, trust binding, checkpoint/replay 표현,
runtime admission 규칙이 정의될 때까지 컴파일러는 위치 정보가 있는
구체적인 진단으로 `true_for`를 거부한다. 현재 sample 필드로 문법을
수용하면 `quality: measured`가 요구하는 근거를 꾸며내게 된다.

기존 `continuous_true(Bool)` timer는 별도의 scan-time timer로 남는다.
`true_for`의 구현 fallback이 아니다.

## Rust 선행 slice

`crates/ghostflow-core::true_for::TrueFor`는 이제 제한된 단일 소스
`CertifiedBoolInterval` 계약을 받는다. Scan-time allocation 없이
source/time epoch, 미래 및 역전 경계, measured/true 품질,
중복 식별자, overlap 합집합, fault/false 근거 이후 reset 하한,
준비된 commit/rollback을 검증한다.
집중 proof: `build/true-for-interval-green5.log` (5/5).

이는 compiler나 GFB/WASM runtime이 `true_for`를 받게 하지는 않는다.
Driver interval transport, trust binding, checkpoint/replay 표현,
compiler lowering은 미결이다.

## Native interval admission 선행 조건

`crates/ghostflow-core/src/true_for.rs`는 이제 고정 저장소의 native
`TrueFor` engine을 제공한다. Admission 선행 조건이며 compiler/VM 지원은 아니다.
Driver assertion은 연결된 source tag, source epoch, 단조 clock epoch,
certificate ID, 시작/끝 밀리초, Bool, 근거 품질을 담는다.
설치는 Driver에게 이 연속 coverage 주장 권한을 부여해야 한다.
필드 존재만으로 측정 신뢰를 확립하지는 않는다.

Coverage는 `[start,end)`를 사용한다. 맞닿거나 겹치는 measured-true interval은
합집합을 누적한다. 폭이 0인 point는 시간 0을 기여한다.
Source/clock epoch 안에서 시작/끝 순서는 단조적이어야 한다.
충돌 overlap, 변경된 중복 식별자, 이전 식별자, 역전/미래 interval,
epoch 불일치는 commit된 상태 변경 전에 거부한다.
False와 measured가 아닌 근거는 연속성을 초기화한다.
상류 품질 fault는 이후 backfill이 넘을 수 없는 reset 경계를 설정한다.
Source/clock epoch 변경은 새 chain을 시작한다.
Duration, epoch, ID, 타임스탬프는 기존 정확한 정수 temporal 영역
(`0..2^53-1`)을 사용하며 duration은 양수다.

`NoObservation`은 NotReady를 반환하고 coverage를 늘리지 않는다.
저장된 run은 이후 실제 certificate가 gap을 메울 때만 그 certificate와 합칠 수 있다.
Outcome은 근거가 끝점보다 늦게 도착해도 인증된 끝점과 covered duration을
보고한다. 그 끝점부터 평가 clock까지 관측되지 않은 구간은 인증하지 않는다.
중복은 coverage를 전진시키거나 reset된 결과를 복원할 수 없다.

Engine은 고정 크기의 commit된 상태 하나와 후보 하나를 소유한다.
`stage`, `commit`, `rollback`은 heap allocation이나 atomic operation을 하지 않는다.
잘못된 staging과 명시적 rollback은 이전 commit 상태를 보존한다.

근거: `cargo test -p ghostflow-core --test true_for` —
`build/true-for-interval-green4.log`의 통과 테스트 5건.
RED 근거: `build/true-for-interval-red.log`, `-red2.log`, `-red3.log`, `-red4.log`.

여전히 필요: compiler typing/lowering, 제한된 wire와 Driver trust binding,
derived Bool 술어의 식 provenance, VM prelude 실행, WASM/host 입력,
trace/replay/checkpoint encoding, 대상 자원 집계.
공개 literate compiler/runtime 경로가 그 계약을 구현할 때까지
`REF-04-025`는 미충족이다. 미지원 compiler 진단은 계속 활성이다.

종단 간 RED 계약은 `tests/true-for-integration.test.mjs`와
`tests/fixtures/true-for-certified.ghost.md`에 기록했다.
의도한 certified interval manifest, temporal profile, 정확한 duration 경계,
point-sample 거부를 고정한다. 현재 compiler는 세 사례를 모두 명시적
미지원 진단에서 거부한다. `build/true-for-integration-red.log`가 기준선을 기록한다.
완전한 경로가 생기기 전까지 수용을 주장하지 않는다.

## 통합 audit와 다음 실행 가능한 slice

첫 수직 통합은 기존 REF-04-025 프로그램이다. 직접 연결된 Bool sensor,
양의 상수 duration, `quality: measured`, `recover(false)`가 소비하는 일반
`Result<Bool, SensorFault>`를 다룬다. 이는 milestone이다.
Derived 술어 지원은 전체 Reference 목표의 일부로 남는다.
이 직접 소스 수직 통합을 막는 새 제품 정책 질문은 없다.

다음은 통합할 구현 계약이며 구현된 ABI 주장이 아니다.
완전한 수직 통합에 native/WASM 실행 근거가 생기기 전까지
미지원 진단이나 그 회귀 테스트를 제거하지 않는다.

### 1. Driver transport와 activation

- Certified Bool interval을 공급하도록 허가된 물리 root의 명시적 집합으로
  installation profile을 확장한다. Compiled module이 요구하는 정확한 root를
  검증한다. 일반 sensor sample이나 density 상한은 이 capability를 주지 않는다.
  Host는 binding을 설치하며 `true_for` 결과를 계산하지 않는다.
  이 local capability 계약에는 서명이나 원격 service가 필요하지 않다.
- Tick마다 연결된 root별 별도 interval fact를 capture한다. 존재 여부,
  source epoch, certificate ID, 시작/끝 밀리초, Bool 값, 근거 품질이다.
  Root 표는 source tag를, tick은 time epoch를 공급한다.
  Point sample 식별자와 독립적으로 유지한다. 사용할 수 없는 품질 fault를
  명시적으로 담는다. 부재는 `NoObservation`이다.
- 고정 폭 wire 필드와 기존 정확한 정수 시간 영역을 사용한다.
  변경 전에 잘못된 fact를 거부한다. Sample timestamp, sample 간격,
  이전 scan에서 끝점을 도출하지 않는다. Source/time epoch와 unavailable 입력을
  포함하여 admit된 모든 fact를 replay frame에 보존한다.

현재 변경 위치: `runtimes/wasm/temporal-profile.mjs`,
`runtimes/wasm/control-runtime.mjs` capture/validation/replay frame 코드,
`runtimes/wasm/src/lib.rs`. 현재 GFTA v1 profile에는 time epoch,
root density, budget만 있다. 엄격한 schema에 버전이 지정된 확장이 필요하다.

### 2. 검증된 산출물과 compiler lowering

- 별도의 `true_for` prelude descriptor를 추가한다. Site, name, source root,
  양의 duration, certified-input binding을 담는다. 출력 projection은 Bool payload,
  ok/fault/origin, 인증된 끝점, covered duration이다.
  Numeric window operation이나 `continuous_true` 상태로 encoding하지 않는다.
- 명시적인 format version 결정과 함께 GFB writer와 Rust loader를 확장한다.
  기존 GFB4 root는 point-metadata 입력 4개를 연결한다. 기존 GFB5에는
  window/schedule prelude tag가 있다. 어느 쪽도 현재 certified interval을
  설명하지 않는다. 옛 reader는 새 tag를 잘못 읽지 않고 새 format을 거부해야 한다.
  Wire 크기 검사는 할당 전에 기존 input/state/module 상한을 강제해야 한다.
- 직접 Bool sensor를 새 prelude와 일반 Result projection으로 lowering한다.
  소스 하나, 고유 `duration`/`quality` 인자, measured 품질,
  양의 상수 Duration을 타입 검사한다. 각 거부의 소스 위치를 보존한다.
  Manifest와 bytecode에 같은 site/root 식별자를 생성한다.
  Activation에서 불일치 산출물을 거부한다.

현재 변경 위치: `tools/control.mjs`의 `addSignal`, manifest 생성과 prelude 생성;
`tools/gfb1.mjs`; `crates/ghostflow-core/src/lib.rs` loader/projection verifier;
`temporal_vm.rs`; `runtimes/wasm/control-runtime.mjs`의 manifest 검증.

### 3. 하나의 Rust 트랜잭션, checkpoint, 자원 계획

- TrueFor 상태를 설치된 temporal runtime의 일부로 만든다.
  의존 식 전에 준비하고 tick이 성공적으로 끝날 때만 commit한다.
  이후 식 실패는 기존 window 상태와 함께 rollback한다.
- Commit된 상태, source binding, duration, 중복/reset metadata를 checkpoint한다.
  Restore는 호환되지 않는 module/config/binding 식별자를 거부해야 한다.
  후보 상태는 checkpoint에 들어가지 않는다.
  Replay는 capture된 interval fact를 같은 Rust engine으로 평가한다.
- 대상 pointer 폭에서 activation/replay 예산에 engine, 후보,
  checkpoint 보존, trace 저장소를 집계한다. 독립 engine은 고정 크기다.
  집계되지 않은 engine/checkpoint Vec를 더하면 여전히 설치 temporal 자원 계약을 위반한다.
- 실제 사용한 interval 식별자, 끝점, 품질, coverage, result/fault를 선언 site와
  함께 trace한다. Point sample을 만들거나 recovered/default 값을 measured 근거로 표시하지 않는다.

현재 변경 위치: `true_for.rs` checkpoint/state interface,
`temporal_runtime.rs` resource planning/stage/commit/rollback/restore,
`lib.rs` tick 기록/replay, native/WASM trace 직렬화.

### 4. 수용 순서 (TDD)

1. 미지원 진단에서 처음 실패하는 공개 `.ghost.md` compiler-to-runtime 테스트를
   추가한다. Driver capability를 명시적으로 연결하고 `[0,299999)` 뒤
   `[299999,300000)` measured-true fact를 공급한다. 출력은 300000 ms 전까지
   거짓이며 정확한 duration 경계에서 참이다.
   같은 산출물과 입력 순서를 native/WASM runtime에서 실행한다.
2. 부정 대조군을 추가한다. 일반 point reading만 사용, clock-only tick,
   중복 certificate, 1밀리초 uncovered gap, false 근거, Held/recovered 품질,
   source epoch 변경, unbound/foreign source, 역전/미래 경계, 변경된 중복 식별자다.
   어느 것도 연속성을 꾸며낼 수 없다. 잘못된 입력은 commit 상태를 바꾸지 않는다.
3. Interval staging 뒤 하류 식 실패를 강제한다. 같은 유효 tick을 재시도하고
   중단 없는 실행과 비교한다. 보존 checkpoint restore 및 native/WASM replay
   뒤에도 반복한다. 성공 실행 여부만 보지 않고 출력과 interval provenance를 비교한다.
4. 정확한 activation/replay 예산 경계와 손상된 artifact binding을 테스트한다.
   `tools/verify-language.mjs`에 명시적으로 등록한다.
   그 뒤에만 미지원 진단 회귀를 대체하고 REF-04-025를 수용한다.

Derived 술어는 이후의 필수 slice다. Point 계보 selector는 interval 위의 식을
인증하지 않는다. 단항/pure 술어에는 인증된 payload coverage가 필요하다.
다중 소스 술어에는 coverage 교집합이, state/config 의존 술어에는
그 변경 경계도 필요하다. Proof 생성이 생기기 전까지 미지원 derivation은 명시적으로 거부한다.

### `after_event`가 이 작업 뒤에 오는 이유

추가 통합 차단 요인은 `after-event-design.md`에 있다.
독립 event 결과에는 정의된 scalar projection/보존 interface가 필요하다.
현재 Rust 선행 구현은 stage마다 입력 하나를 받는다.
같은 tick의 event와 true 술어는 함께 준비해야 VM tick 일부를 commit하지 않고
포함된 시작 경계를 처리할 수 있다. 현재 술어 관측에는 source 식별자가 없어
measured 계보, 중복 방지, replay provenance를 아직 지원할 수 없다.
Temporal transport 재사용 전에 이를 해결해야 한다. REF-04-026은 미충족이다.

## 첫 통합 RED fixture

`tests/fixtures/true-for-certified.ghost.md`는 완전한 정본 문서다.
`tests/true-for-integration.test.mjs`는 다음 구현 제안 계약을 고정한다.
GFB format 6; source/site/slot, duration, 명시적 `intervalInputs`를 갖춘
`true-for` manifest descriptor; activation `certifiedBoolRoots`;
별도 `step.intervals` certificate; `vm.trueForTrace` 식별자/coverage다.
이는 실행 가능한 구현 목표이며 기존 지원 ABI는 아니다.
성공 certificate 두 개는 source epoch 11, time epoch 7,
독립 ID 1/2, 밀리초 interval `[0,299999)`, `[299999,300000)`을 갖는다.
기대 alarm은 거짓 뒤 참이다. Point-only/clock-only 대조군은 거짓으로 남아야 한다.
테스트는 공개 literate compiler와 WASM ControlRuntime을 import하고 사용한다.
대체 host evaluator는 없다.

실행: `node --test tests/true-for-integration.test.mjs`.
기록된 `build/true-for-integration-red.log`: 종료 코드 1, 테스트 3,
0 pass, 3 fail, 0 skip/TODO. 세 테스트 모두 기대한 현재 compiler 진단에서 멈춘다.
`true-for-certified.ghost.md:10:22: true_for requires Driver-certified observed
interval evidence, which is not yet supported`.
Descriptor/runtime assertion에는 도달하지 않는다. 누락된 수직 통합을 증명하며
제안 ABI를 증명하지 않는다. 테스트는 `tools/verify-language.mjs`에 명시적으로 등록했다.
기존 미지원 진단과 Reference 기대값은 변경하지 않는다.

## 구현된 compiler/artifact와 native 실행 slice

Type checker는 이제 직접 Bool 소스, 양의 상수 duration, measured 품질을
검증하고 위 descriptor를 생성한다. Derived 소스는 계속 거부한다.
실행 가능한 공개 compiler는 source trace, host/WASM, replay 통합이
완료될 때까지 위치 정보가 있는 미지원 진단을 의도적으로 유지한다.
내부 타입 검사는 REF-04-025 수용이 아니다.

JS GFB writer와 Rust loader는 이제 format 6을 공유한다.
Temporal clock/point-root header와 tag prelude 순서를 유지한다.
새 prelude tag 2는 순서대로 site `u32`, signal 이름, source tag `u32`,
source 이름, duration `u64`, 그 뒤 `u16` 입력 index 8개
(present, epoch, ID, start, end, Bool value, quality, fault)를 encoding한다.
문자열은 기존 `u16` UTF-8 byte 길이 prefix를 유지한다.
Opcode 59는 `u16` true_for slot 다음 `u8` field를 읽는다.
0 ok, 1 Bool value, 2 fault, 3 origin, 4 certified run start,
5 run end, 6 covered duration이다. 모든 수치 필드는 기존 정확한 정수 한계를 쓴다.
공유 root는 strategy 전반에 정확히 같은 식별자/binding을 유지해야 한다.
Alias된 clock, point metadata, 다른 root, 알 수 없는 입력, 잘못된 타입은 거부한다.

Native `Runtime::activate_with_certified_intervals(TrueForActivation)`은
true_for-only module, 정확히 정렬된 `certified_bool_roots` 집합,
`time_epoch`, 명시적 `max_bytes`만 받는다. 일반 activation은 계속 닫혀 있다.
혼합 window/schedule도 닫혀 있다. Rust tick은 모든 certificate를 준비하고
결과를 투영하며 scalar transition/intent를 평가한 뒤 성공할 때만 commit한다.
하류 실패는 interval 상태를 rollback한다.
`TickRecord.true_for_trace`와 JSON `trueForTrace`는 입력 식별자, 품질,
interval 경계, 인증 aggregate 경계, coverage, result/fault를 보존한다.

Native 입력 품질 code는 0 Constructed, 1 Measured, 2 Held,
3 Constructed(derived/nonphysical 근거), 4 Unavailable이다.
Unavailable은 기존 SensorFault code 0 Disconnected, 1 Stale,
2 Invalid, 3 NotReady를 소비한다. Presence false는 NoObservation이다.
Point sample은 이 입력을 생성하지 않는다. 관측이 coverage를 기여하지 않아도
source epoch, 식별자, 끝점은 명시적이다. Measured true certificate만 누적한다.

Native 자원 상한은 engine/후보 상태, projection 저장소,
현재 tick을 포함한 최대 보존 true_for/result trace buffer를 집계한다.
Trace vector는 tick마다 제한된 용량을 할당한다. 이 slice는 allocation-free
VM tick을 주장하지 않는다. Compiled-module/scalar 저장소, allocator metadata,
직렬화, 호출자 소유 clone은 temporal byte 상한 밖이다.
정확한 예산 admission과 1바이트 부족 거부에는 native 테스트가 있다.
Certified checkpoint가 생길 때까지 rewind는 명시적으로 거부한다.
Replay와 hot swap은 계속 닫혀 있다.

근거:

- `build/true-for-lowering-red.log`: 실패 compiler/writer 목표 테스트 15건.
- `build/true-for-lowering-green3.log`: 집중 및 영향받은 JS 테스트 58/58.
- `build/true-for-module-red.log`: native loader 목표 API가 처음에는 없음.
- `build/true-for-module-green.log`: native 구조 테스트 3/3.
- `build/gfb6-native-green.log`: JS-to-native 및 영향받은 테스트 25/25.
- `build/true-for-native-tick-red.log`: native tick API/trace가 처음에는 없음.
- `build/true-for-native-rewind-red.log`: certified 실행의 scalar-only rewind를
  발견했다. Native rewind는 이제 변경 전에 거부한다.
- `build/true-for-native-core-green2.log`: ghostflow-core 테스트 모두 통과.
  구조/native true_for module 테스트 9건을 포함한다.

공개 수용 전에 여전히 필요: compiler source-trace/artifact decoder의 format 6 지원;
완전한 근거가 있을 때만 executable compiler gate 제거;
host manifest 검증과 interval capture/replay frame;
native certified API로 WASM activation dispatch;
certified checkpoint와 replay resource/provenance;
혼합 prelude 실행, derived 술어 coverage.
공개 통합 테스트는 RED로 남는다. Device 검증은 주장하지 않는다.

## WASM 인증 활성화 작업 범위

저수준 `GhostFlowRuntime.activateTemporal` GFTA v2 경로는 이제
명시적 certified root를 같은 native `TrueForActivation`/tick engine으로 dispatch한다.
혼합 prelude 구현 전까지 point-density profile과 certified root의 혼합은 거부한다.
Rust는 activation 전에 root 권한과 temporal 저장 예산을 계속 검증한다.
GFTA v1 window activation은 변경하지 않는다.

`tests/true-for-wasm.test.mjs`는 정확한 duration과 trace 식별자,
clock-only 부재, 폭 0인 point, uncovered gap, Held 품질, source epoch reset,
잘못된 root capability, 부족한 예산, 잘못된/중복 certificate,
하류 식 rollback을 다룬다. Certified checkpoint가 생길 때까지
rewind/replay는 명시적으로 거부하고 live 상태를 보존한다.
이 테스트는 `tools/verify-language.mjs`에 등록돼 있다.

이는 저수준 WASM 실행 근거뿐이다. 공개 `.ghost.md` 컴파일과 ControlRuntime은
여전히 true_for를 거부한다. Source-trace/artifact decoding, manifest 검증,
별도 interval snapshot transport, framed 실행, checkpoint/replay,
혼합 prelude, derived 술어 coverage는 미결이다.
