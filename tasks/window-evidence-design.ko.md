<!-- translation-source: tasks/window-evidence-design.md -->

[영문 원본](window-evidence-design.md)

# 타임스탬프 window 집계: 통합 인계

현재 상태: measured physical/nested window compiler/GFB/core/host/proof 통합이
batch13에 포함됐다. 실제 근거와 남은 adapter replay/영속성 경계는
`window-derived-design.md`를 참조한다. 아래 최초 engine 인계는 과거 맥락이며
현재 완료 상태가 아니다.

## 근거와 유한 저장소

Source sensor의 `sample` option은 기대 주기를 설명한다.
Burst를 제한하거나 같은 타임스탬프의 서로 다른 관측을 금지하지 않는다.
Activation은 각 물리 root의 명시적 `{maxObservations, intervalMs}` density 보장과
대상 sample/메모리 예산을 받아야 한다. Installation 값을 지어내지 않는다.

Window `overMs`의 보존 용량은 물리 root별 다음 값의 검증된 합이다.

`maxObservations * ceil(overMs / intervalMs)`.

`min(overMs, maxAgeMs)`가 아니라 전체 `overMs`를 쓴다.
새 fresh point는 오래된 보존 기여를 다시 사용할 수 있게 한다.
Density 이력에도 집계에 부적격한 관측을 포함한 제한된 저장소가 필요하다.
Committed/candidate bank 모두 메모리에 집계한다.
용량/density 위반은 stage를 원자적으로 거부하며 아직 허용 가능한 sample을
제거하지 않는다. 할당은 scan별이 아니라 activation 때 한다.

## 현재 engine

`crates/ghostflow-core/src/temporal.rs`는 `Window::new`, `stage`, `commit`,
`rollback`, committed/staged contributor와 outcome을 공개한다.
`RootDensity`, `TargetBudget`, `TimeContext { epoch, now_ms }`는 명시적 입력이다.

- 포함 구간은 `(now-over, now]`다. Freshness에는 최신 age `< max_age`가 필요하다.
- 식별자는 source tag, source epoch, ID, 원래 타임스탬프를 포함한다.
- 중복 관측은 기여를 만들지 않는다. 타임스탬프 동률은
  `(timestamp, source_tag, epoch, id)`로 정렬한다. Rate에는 서로 다른 타임스탬프가 필요하다.
- Average/min/max와 초당 rate는 실제 유한 측정을 사용한다.
  수치 overflow는 무한 성공 값 대신 stage를 거부한다.
- 일반 상류 fault는 허용 가능한 이력을 보존하고 outcome에 기록된다.
  Root epoch 변경은 해당 root 기여만 무효화한다.
- 같은 time epoch의 시간 역행은 거부한다. Time epoch 교체는 window/density
  이력을 비우고 source ID highwater는 유지하며 옛 영역의 타임스탬프 순서를 비운다.
  Cached 관측은 새 time epoch를 시작할 수 없다.
- Outcome revision은 새 관측이 admit될 때만 전진한다.
  Derived aggregate는 꾸며낸 물리 sample ID가 아니라 contributor/revision 근거를 갖는다.

Fault 보존과 derived-evidence 규칙에는 제품 통합 전에 명시적 §4.4 reference
명확화가 필요하다. Raw sensor filter의 별도 fault-clears-history 규칙을
우연히 상속해서는 안 된다.

기초 근거: `build/temporal-foundation-unit.log`(unit 테스트7건),
`build/temporal-conformance.log`(독립 공개 engine oracle 테스트6건).
Unit suite에는 stage 연산200회의 allocation-count 검사가 포함된다.
집중 결과는 다음 완전한 host gate로 보완한다.

### 이후 수용된 기초

- 불투명한 `WindowCheckpoint`는 commit된 이력, density queue, 식별자,
  fault provenance, revision, 시간을 capture한다.
  Copy/restore는 할당 buffer를 재사용하며 동일한 예산 상한이 아니라
  일치하는 구성/설정을 요구한다. 집중 근거: `build/` 아래
  `temporal-checkpoint-final.log`(unit10건),
  `temporal-checkpoint-conformance.log`(oracle6건).
- GFB4 requirements/decoder/verifier: 공개 loader 사례12건 통과.
  잘못된 blob, 정확한 clock binding, projection typing, 의존 순서,
  잘림, 기존 한계를 포함한다. 전체 core 실행108건 통과:
  `build/temporal-module-core-green.log`. 이는 로딩/검증을 증명하며 실행은 아니다.
  Runtime 통합은 [명시적 wire/activation 계약](window-gfb4-design.md)을 따른다.
- `tests/window-control.test.mjs`는 host gate에 등록돼 있다.
  Source 수용 사례는 실제 lowering 구현 전까지 RED다.
  Batch10 전체 gate 보고는 이 변경 이전이며 이 revision을 인증하지 않는다.

## 필수 통합

1. GFB/Rust 실행에 실제로 제한된 stateful-operation 기능을 도입한다.
   Scalar state unrolling과 JavaScript 집계 engine은 요구를 충족하지 않는다.
   구체적인 profile 변경이 정당화될 때까지 기존 예산을 보존한다.
2. 지원하는 임의 Result 식을 의존 순서의 tick당 한 번 prelude로 lowering한다.
   타입이 지정된 transient Result projection을 생성한다.
   Source-only 컴파일은 device fact를 가정하지 않고 activation 요구를 기록한다.
3. Window arena를 core 상태/물리 conditioner와 같은 scan commit/rollback 및
   replay/checkpoint 경계에 포함한다. 영속 restore에는 source/time 연속성 근거가 필요하다.
4. Source descriptor, 두 WASM/native adapter, 대상 activation 계약,
   contributor provenance, package 검증을 함께 추가한다.
5. CLI 수용 기대 REF-04-027/028/029를 변경하지 않고 모든 실행 backend에
   절대 runtime oracle 검사를 추가한다. Rate는 모든 수치 타입이 아니라
   Temperature와 Reference의 선형 물리량을 허용한다.

Estimated-quality 근거와 사용자 의존 `true_for` 연속성 선택은
별도 미결 계약으로 남는다. 이 설계는 기본값을 공급하지 않는다.

## GFB4와 native 실행 checkpoint (2026-09-23)

위의 이전 source RED 상태는 대체됐다. GFB4 encoding, compiler lowering,
Rust decoding, 명시적 temporal activation은 이제 물리 root window를 실행한다.
Core의 최종 집중 suite는124건 통과했다(`build/temporal-runtime-core-final.log`).
Source/encoder suite는32건, 서명 JS package 회귀는56건 통과했다.
Browser encoding도 통과했다.

Batch11은 native/WASM 산출물을 rebuild했다. REF-04-027/028/029는 이제
실제 CLI check/build를 통과한다. 테스트 오류 메시지 기대값을 기존
`division by zero` 계약에 맞춰 수정한 뒤 native source-to-Rust suite의3건이
모두 통과했다(`build/window-native-green.log`). Activation 요구,
용량 거부, 정확한 average/minimum/maximum/rate, contributor trace,
뒤늦은 식 fault 뒤 원자적 재시도를 다룬다.
그 fixture 수정 때문에 runtime 동작을 바꾸지는 않았다.

이것으로 feature가 끝나지는 않았다. Batch11에서 WASM/host temporal activation과
source-trace 의존성은 미결이었다. 다음 checkpoint가 그 상태를 대체한다.
Native 서명 package 통합, derived window source, 영속 연속성/hot-swap 이관은
미완료다. 가상 CLI adapter에는 명시적 epoch/density/budget이 필요하며
device 기본값을 공급하지 않는다.

## WASM, host, source-trace checkpoint (2026-09-23)

- 공유 GFTA activation은 JavaScript/Rust가 독립적으로 검증한다.
  두 WASM adapter는 명시적 density/budget/epoch로 기존 core를 실행한다.
  `build/window-wasm-green.log`:30/30; Rust ABI 테스트:5/5.
- `build/window-host-green.log`:16/16. 실제 legacy/framed host 실행,
  정확한4개 연산 결과, 만료, 동적 fault/동일 sample 재시도,
  불변 epoch, 잘못된 profile/descriptor 거부를 다룬다.
- `build/window-provenance-available-green.log`:6/6.
  정본 replay는 소비자를 포함한 windowSites/의존성을 고정한다.
  다시 서명한 대체는 로딩 전에 실패한다. 실제 native 기록은 Derived 품질과
  별도 상류 fault를 투영한다. 잘못된 식별자, Int 영역, 미래/만료 sample,
  비어 있거나 stale인 성공 근거, 불충분하게 결정된 성공 rate를 거부한다.
- `build/window-provenance-green.log`: 최종 observer 영역 추가 전에 관련
  이전 회귀63건 통과. 전체 gate 근거는 `plan.md`에 별도로 기록한다.
  이 집중 수는 전체 Reference 준수를 뜻하지 않는다.

Root는 공개 관측 필드, sensor source tag, rate-fault 선택에 관한 최초 host
테스트 가정을 수정했다. 그 fixture 수정은 production 결함이 아니다.
Astra는 host profile/epoch 처리와 최종 observer 식별자/영역 수정을 검토했다.
Native framed CLI/package 통합, nested derived evidence, estimated evidence,
영속 이관은 미결이다.

Batch12 전체 gate에는 이 변경이 포함됐다. Node2,014 =1,822 pass,28 fail,
164 TODO,0 skip. Reference 실패27건은 남는다. 유일한 다른 실패는
새 필수 activation export가 빠진 기존 allocation-guard 테스트 mock이었다.
거부/allocation assertion을 변경하지 않고 no-op mock을 수정했으며 집중 테스트1/1 통과.
Rust/native/WASM 선행 단계는 통과했고 tutorial은 실행하지 않았다.
전체 보고는 실패로 보존한다. Source-hash 검토는 gate 뒤 production code가 아니라
해당 fixture만 바뀌었음을 확인했다.
`build/compiler-runtime-batch12-verification.json`과
`build/scan-frame-wrapper-focused.log`를 참조한다.
