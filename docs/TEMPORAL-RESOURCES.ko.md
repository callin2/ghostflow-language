<!-- translation-source: docs/TEMPORAL-RESOURCES.md -->
[영어 원문](TEMPORAL-RESOURCES.md)

# Temporal resource 계획

정적 계획은 native runtime과 두 WASM adapter에서 이용 가능하다.

`GhostFlowRuntime`/`FramedGhostFlowRuntime`은 동기 계획을 노출한다. `planTemporal`은
activation 전에 작동한다. `planTemporalReplay`는 적격 retained record가 있는 활성 run을 요구한다.

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

`profile`, `count`, `maxJsonBytes`는 caller 제공 값이다. default cadence/density/budget를
암시하지 않는다. 계획은 정적 bounded metadata를 반환하며 temporal sample/proof/checkpoint
arena를 할당하거나 tick을 실행하지 않는다. replay 계획은 적격 retained record가 있는 활성
framed/legacy run을 요구한다. 첫 성공 계획 호출 전에 `resourcePlan`은 null이다.

초기 report format은 `GhostFlow/temporal-resources-v1`이다. 설치 module fingerprint,
strategy, target pointer width, journal capacity, window count, retained sample,
accounted temporal byte, `fitsBudget`을 포함한다. 양수지만 불충분한 budget은 필요 capacity를
유지하면서 `fitsBudget: false`를 반환한다. invalid 사실/비호환 replay binding은 거부한다.
target의 checked integer 범위를 넘는 geometry도 거부한다. 더 작은 요구량으로 wrap하지 않는다.

`accountedTemporalBytes`는 target별 계수된 상한이다. density ring, retained 관측,
proof/high-water capacity, candidate/committed bank, checkpoint, projection, trace/marker
상한, construction scratch, 겹치는 plan metadata를 포함한다. allocator metadata,
scalar/module 저장소, JSON/report output, caller 소유 JavaScript 복사본은 제외한다.
`targetPointerBytes`는 계산에 사용된 target layout 폭을 설명한다.

replay 계획은 `GhostFlow/temporal-replay-resources-v1` format을 사용한다. report는 적격 수,
요청 수, live/ghost byte, return/frame header, 필요한 peak temporal byte,
`ghostFitsBudget`을 포함한다. byte 합계는 동시에 존재하는 live/ghost geometry, 반환 core
record, framed outcome을 다룬다. ghost geometry는 요청 count와 같은 journal capacity를
사용한다. replay JSON budget은 temporal arena budget과 독립적으로 제한된다.

성공 plan만 `resourcePlan`을 교체한다. 거부는 이전 plan/replay/live 실행/frame sequence/
outcome을 보존한다. WASM 대응 함수는 `gf_plan_temporal`, `gf_plan_temporal_replay`,
`gf_frame_plan_temporal`, `gf_frame_plan_temporal_replay`와 대응 resource-plan
pointer/length getter다. `maxJsonBytes`는 이전 plan buffer와 교체 후보의 합을 제한한다.
resource-plan buffer는 replay-result buffer와 별개다.

이 계약은 measured physical/derived window를 다룬다. estimated evidence, 다른 temporal
operator, foreign checkpoint, 전체 Reference §6.8 branch/source-closure identity는 범위 밖이다.
