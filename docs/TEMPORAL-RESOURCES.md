# Temporal resource planning

Static planning is available in the native runtime and both WASM adapters.

`GhostFlowRuntime` and `FramedGhostFlowRuntime` expose synchronous planning.
`planTemporal` works before activation; `planTemporalReplay` requires an active
run with eligible retained records.

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

`profile`, `count`, and `maxJsonBytes` are caller-provided values. No default
cadence, density, or budget is implied here. Planning returns static bounded
metadata and does not allocate temporal sample, proof, or checkpoint arenas or
execute a tick. Replay planning requires an active framed or legacy run with
eligible retained records.
`resourcePlan` is null before the first successful planning call.

The initial report format is `GhostFlow/temporal-resources-v1` and includes the
installed module fingerprint, strategy, target pointer width, journal capacity,
window count, retained samples, accounted temporal bytes, and `fitsBudget`.
Positive but insufficient budgets return `fitsBudget: false` while retaining the
required capacities. Invalid facts and incompatible replay bindings reject.
Geometry that overflows the target's checked integer range also rejects; it is
never wrapped into a smaller requirement.

`accountedTemporalBytes` is a target-specific accounted upper bound. It covers
density rings, retained observations, proof/high-water capacity, candidate and
committed banks, checkpoints, projections, trace/marker bounds, construction
scratch, and overlapping plan metadata. It excludes allocator metadata,
scalar/module storage, JSON/report output, and caller-owned JavaScript copies.
`targetPointerBytes` describes the target layout width used by the calculation.

Replay planning uses format `GhostFlow/temporal-replay-resources-v1`. Its report
includes eligible count, requested count, live and ghost bytes, return and frame
headers, required peak temporal bytes, and `ghostFitsBudget`. The byte sum covers
live and ghost geometry, returned core records, and framed outcomes while they
overlap. The ghost geometry uses journal capacity equal to the requested count.
The replay JSON budget is independently bounded from the temporal arena budget.

Only a successful plan replaces `resourcePlan`; rejection preserves the prior
plan, prior replay, live execution, frame sequence, and outcome. The WASM peers
are `gf_plan_temporal`, `gf_plan_temporal_replay`,
`gf_frame_plan_temporal`, and `gf_frame_plan_temporal_replay`, with their
corresponding resource-plan pointer/length getters.
`maxJsonBytes` bounds the previous plan buffer plus its replacement candidate;
the resource-plan buffer is separate from the replay-result buffer.

This contract covers measured physical and derived windows. Estimated evidence,
other temporal operators, foreign checkpoints, and full Reference §6.8
branch/source-closure identities are outside this contract.
