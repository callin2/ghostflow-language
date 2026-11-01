# Temporal resource planning

Temporal resource planning tells you, before you commit memory, how many bytes
temporal features (windows, retained samples, checkpoints, replay) will need on
a given target. Static planning is available in the native runtime and in both
WASM adapters.

`GhostFlowRuntime` and `FramedGhostFlowRuntime` expose two synchronous calls:

- `planTemporal` plans live execution. It works before activation.
- `planTemporalReplay` plans a replay (see
  [TEMPORAL-REPLAY.md](TEMPORAL-REPLAY.md)). It requires an active run with
  eligible retained records.

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

The caller provides `profile`, `count`, and `maxJsonBytes`. This page implies
no default cadence, density, or budget. Planning returns static, bounded
metadata. It does not allocate temporal sample, proof, or checkpoint arenas,
and it does not execute a tick. Replay planning requires an active framed or
legacy run with eligible retained records. `resourcePlan` is null until the
first successful planning call.

**Live plan report.** The format is `GhostFlow/temporal-resources-v1`. The
report includes:

- the installed module fingerprint and strategy;
- the target pointer width;
- journal capacity, window count, and retained samples;
- accounted temporal bytes;
- `fitsBudget`.

How budgets and bad input are handled:

- A positive but insufficient budget returns `fitsBudget: false` and still
  reports the required capacities.
- Invalid facts and incompatible replay bindings are rejected.
- Geometry that overflows the target's checked integer range is also rejected.
  It is never wrapped around into a smaller requirement.

**What `accountedTemporalBytes` counts.** It is a target-specific accounted
upper bound.

| Included | Excluded |
| --- | --- |
| density rings, retained observations, proof/high-water capacity, candidate and committed banks, checkpoints, projections, trace/marker bounds, construction scratch, overlapping plan metadata | allocator metadata, scalar/module storage, JSON/report output, caller-owned JavaScript copies |

`targetPointerBytes` gives the target layout width used by the calculation.

**Replay plan report.** The format is `GhostFlow/temporal-replay-resources-v1`.
The report includes the eligible count, requested count, live and ghost bytes,
return and frame headers, required peak temporal bytes, and `ghostFitsBudget`.
The byte sum covers everything that exists at the same time: live and ghost
geometry, returned core records, and framed outcomes. The ghost geometry uses a
journal capacity equal to the requested count. The replay JSON budget is
bounded independently of the temporal arena budget.

**Replacement and rejection.** Only a successful plan replaces
`resourcePlan`. A rejection preserves the prior plan, prior replay, live
execution, frame sequence, and outcome.

**WASM exports.** The WASM peers are `gf_plan_temporal`,
`gf_plan_temporal_replay`, `gf_frame_plan_temporal`, and
`gf_frame_plan_temporal_replay`, each with its corresponding resource-plan
pointer/length getters. `maxJsonBytes` bounds the previous plan buffer plus its
replacement candidate. The resource-plan buffer is separate from the
replay-result buffer.

**Scope.** This contract covers measured physical and derived windows.
Estimated evidence, other temporal operators, foreign checkpoints, and full
Reference §6.8 branch/source-closure identities are outside this contract.
