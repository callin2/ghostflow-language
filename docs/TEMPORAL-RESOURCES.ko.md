<!-- translation-source: docs/TEMPORAL-RESOURCES.md -->
[영문 원문](TEMPORAL-RESOURCES.md)

# Temporal resource 계획

temporal resource 계획은 메모리를 확정하기 전에, 특정 대상에서 temporal 기능(window,
보존 sample, checkpoint, replay)에 몇 바이트가 필요한지 알려 줍니다. 정적 계획은
native 런타임과 두 WASM 어댑터에서 모두 사용할 수 있습니다.

`GhostFlowRuntime`과 `FramedGhostFlowRuntime`은 두 가지 동기 호출을 노출합니다.

- `planTemporal`은 live 실행을 계획합니다. 활성화 전에도 동작합니다.
- `planTemporalReplay`는 replay를 계획합니다([TEMPORAL-REPLAY.md](TEMPORAL-REPLAY.ko.md)
  참고). 적격 보존 record가 있는 활성 run이 필요합니다.

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

`profile`, `count`, `maxJsonBytes`는 호출자가 제공합니다. 이 페이지는 기본 cadence,
density, budget을 전제하지 않습니다. 계획은 정적이고 크기가 제한된 metadata를
반환합니다. temporal sample, proof, checkpoint arena를 할당하지 않으며 tick을
실행하지도 않습니다. replay 계획에는 적격 보존 record가 있는 활성 framed 또는 legacy
run이 필요합니다. 첫 번째 계획 호출이 성공하기 전까지 `resourcePlan`은 null입니다.

**live 계획 보고서.** format은 `GhostFlow/temporal-resources-v1`입니다. 보고서에는
다음이 포함됩니다.

- 설치된 module fingerprint와 strategy
- 대상 포인터 폭
- journal 용량, window 수, 보존 sample
- 계수된 temporal 바이트
- `fitsBudget`

budget과 잘못된 입력은 다음과 같이 처리됩니다.

- 양수이지만 부족한 budget은 `fitsBudget: false`를 반환하며, 필요한 용량은 그대로
  보고합니다.
- 유효하지 않은 사실과 호환되지 않는 replay 바인딩은 거부됩니다.
- 대상의 검사된 정수 범위를 넘치는 geometry도 거부됩니다. 이 값이 wrap되어 더 작은
  요구량이 되는 일은 절대 없습니다.

**`accountedTemporalBytes`가 계수하는 것.** 이 값은 대상별로 계수된 상한입니다.

| 포함 | 제외 |
| --- | --- |
| density ring, 보존된 관측, proof/high-water 용량, 후보 및 확정 bank, checkpoint, projection, trace/marker 상한, 생성용 scratch, 겹치는 계획 metadata | allocator metadata, scalar/module 저장소, JSON/보고서 출력, 호출자 소유 JavaScript 복사본 |

`targetPointerBytes`는 계산에 사용된 대상 레이아웃 폭을 나타냅니다.

**replay 계획 보고서.** format은 `GhostFlow/temporal-replay-resources-v1`입니다.
보고서에는 적격 수, 요청 수, live 및 ghost 바이트, 반환 및 frame 헤더, 필요한 peak
temporal 바이트, `ghostFitsBudget`이 포함됩니다. 바이트 합계는 동시에 존재하는 모든
것을 포함합니다. 즉, live 및 ghost geometry, 반환된 코어 record, framed outcome입니다.
ghost geometry는 요청 수와 같은 journal 용량을 사용합니다. replay JSON budget은
temporal arena budget과 독립적으로 제한됩니다.

**교체와 거부.** 성공한 계획만 `resourcePlan`을 교체합니다. 거부되면 이전 계획, 이전
replay, live 실행, frame sequence, outcome이 그대로 유지됩니다.

**WASM export.** WASM 대응 함수는 `gf_plan_temporal`,
`gf_plan_temporal_replay`, `gf_frame_plan_temporal`,
`gf_frame_plan_temporal_replay`이며, 각각 대응하는 resource-plan 포인터/길이
getter를 가집니다. `maxJsonBytes`는 이전 계획 버퍼와 그 교체 후보의 합을 제한합니다.
resource-plan 버퍼는 replay-result 버퍼와 별개입니다.

**범위.** 이 계약은 측정된 물리 window와 파생 window를 다룹니다. 추정 증거, 다른
temporal 연산자, 외부 checkpoint, 완전한 Reference §6.8 branch/source-closure
identity는 이 계약의 범위 밖입니다.
