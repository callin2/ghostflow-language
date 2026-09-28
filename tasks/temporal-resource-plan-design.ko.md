<!-- translation-source: tasks/temporal-resource-plan-design.md -->

[영문 원본](temporal-resource-plan-design.md)

# 정적 temporal 자원 계획

상태: 집중 구현 수용 완료; 더 넓은 resource/checkpoint 수용은 미완료다.

Reference §4는 실행 전에 유한 상태/메모리 상한을 요구한다.
Batch14는 temporal activation/replay 예산을 검사했지만 native exact-byte
테스트가 wasm32 threshold를 독립적으로 증명하지는 않는다.
이미 활성화한 runtime의 집계 byte를 보고하는 것만으로는 사전 계획을 충족하지 못한다.

## 권위 있는 구성

물리 window, derived evidence, temporal runtime 전반에서 검증된 구조 계획
하나를 추출한다. Density ring, 보존 관측, proof/highwater 용량,
candidate/committed bank, checkpoint, projection, trace/marker 상한,
생성 scratch를 계산한다. 계획은 제한된 O(windows + roots) metadata를
할당할 수 있지만 temporal sample/proof/checkpoint arena는 할당하지 않는다.

Activation과 replay는 같은 계획을 소비한다. 두 번째 production estimator를
유지하지 않는다. 실제 할당 용량은 계획된 구성 안에 있어야 한다.
보고 상한을 조용히 넘지 말고 allocation 불일치를 거부한다.
계획 metadata와 생성 중첩은 집계 peak에 속한다.
집계 편의를 위해 graph를 중복 보존하기보다 가능하면 기존 저장소에
metadata를 재사용하거나 옮긴다.

보고는 대상별 **집계 상한**이며 현재 heap 사용량이 아니다.
Allocator metadata, scalar/module 저장소, report/JSON 출력,
호출자 복사는 명시적으로 temporal 상한 밖이다.

## 네이티브 인터페이스

- `Runtime::plan_temporal(&activation)`은 activation 없이 설치된 module,
  선택 strategy, journal 용량의 요구량을 반환한다.
- `Runtime::temporal_resource_report()`는 가능할 때 활성 보고를 반환한다.
- `Runtime`과 `ScanDriver::plan_current_temporal_replay(count, &activation)`은
  replay 실행 없이 live/ghost 결합 상한을 반환한다.
- 양수지만 부족한 profile 예산은 필요한 용량을 보존하면서
  `fitsBudget: false`를 낸다. 잘못된 fact나 호환되지 않는 replay binding은
  여전히 거부한다. Count는 엄격한 양의 보존 prefix 규칙을 유지한다.

최초 보고 필드: `format`, 설치된 `module` fingerprint, `strategy`,
`targetPointerBytes`, `journalCapacity`, `windowCount`, `retainedSamples`,
`accountedTemporalBytes`, `fitsBudget`.

Replay 보고는 `eligibleCount`, `count`, `liveBytes`, `ghostBytes`,
`returnHeaderBytes`, `frameHeaderBytes`, `requiredPeakTemporalBytes`,
`ghostFitsBudget`을 포함한다. 합계는 반환된 core 기록과 framed outcome의
중첩을 모두 집계한다. Ghost 구성의 journal 용량은 count와 같다.

Format: `GhostFlow/temporal-resources-v1`,
`GhostFlow/temporal-replay-resources-v1`.

## WASM과 JavaScript interface

두 adapter는 동기 메서드를 공개한다.

```js
runtime.planTemporal({ profile, maxJsonBytes });
runtime.planTemporalReplay({ count, profile, maxJsonBytes });
runtime.resourcePlan; // last successful plan, initially null
```

WASM export:

- `gf_plan_temporal(handle, profilePtr, profileLen, maxJsonBytes)`와 framed 대응 함수.
- `gf_plan_temporal_replay(handle, profilePtr, profileLen, count, maxJsonBytes)`와 framed 대응 함수.
- `gf_resource_plan_ptr/len`, `gf_frame_resource_plan_ptr/len`.

각 handle은 두 plan 타입이 공유하는 별도의 최신 plan buffer를 소유한다.
성공만 대체한다. 거부는 이전 plan, 이전 replay, live 실행, frame 순서,
outcome을 보존한다. 제한된 JSON writer는 이전+후보 buffer 용량을 집계한다.
Framed activation 전 계획은 configuring Runtime을 사용한다.
Replay 계획에는 활성 ScanDriver가 필요하다.

## 독립 수용 기준

1. 고정 nested-window fixture에는 별도로 검토한 wasm32 배치 폭 표와 용량
   공식이 있다. 대상 폭은 복사한 성공 예산이나 제품 test-only export가 아니라
   격리된 compiler 배치 근거에서 도출한다.
2. Oracle은 보존 용량 C와 byte 상한 N을 계산한다. 두 실제 WASM adapter에서
   C/N으로 활성화하고 C-1/N-1을 거부한다. 보고 비교는 추가 근거다.
3. 독립 live/ghost 구성, core 반환 header, framed header로 replay peak를 계산한다.
   Live 또는 이전 replay/plan buffer를 바꾸지 않고 N을 받고 N-1을 거부한다.
   이진 탐색을 oracle로 쓰지 않는다.
4. Activation 전에 부족한 양의 예산도 요구량을 보고한다.
   계획이 temporal data arena를 할당하거나 tick을 실행하지 않음을 보인다.
5. 기존 native, checkpoint, replay, trace, package 동작을 보존한다.

이 작업은 estimated evidence, 다른 temporal 연산자,
외부 checkpoint, 전체 Reference §6.8 branch/source-closure 식별자를 완료하지 않는다.

## 집중 근거

- `build/temporal-plan-rust-final.log`: core 142, ABI 10 테스트 통과.
- `build/temporal-resource-plan-wasm-green.log`: WASM resource suite 22/22 통과.
- `build/scan-frame-wasm-temporal-plan.log`: framed suite 17/17 통과.
- `build/temporal-plan-catalog.log`: catalog 5/5 통과.
- 독립 oracle: live C14 = 9,424,375바이트; ghost count 3 = 47,511;
  legacy replay peak = 9,471,958; framed replay peak = 9,472,414.
- Batch15 전체 gate 산출물: `build/compiler-runtime-batch15-full.log`,
  `build/compiler-runtime-batch15-verification.json`,
  `build/compiler-runtime-batch15-reference-results.json`.
  Node 1,923 pass, Reference 실패 27, 164 TODO. Source hash는 gate와 일치한다.
