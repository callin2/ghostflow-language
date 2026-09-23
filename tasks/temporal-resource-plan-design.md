# Static temporal resource planning

Status: focused implementation accepted; broader resource/checkpoint acceptance remains pending.

Reference §4 requires finite state/memory bounds before execution. Batch14 has
checked temporal activation and replay budgets, but its native exact-byte tests
do not independently prove wasm32 thresholds. Reporting an already activated
runtime's accounted bytes alone would not fulfill preactivation planning.

## Authoritative geometry

Extract one checked structural plan across physical windows, derived evidence
and the temporal runtime. It calculates density rings, retained observations,
proof/highwater capacities, candidate/committed banks, checkpoints, projections,
trace/marker bounds and construction scratch. Planning may allocate bounded
O(windows + roots) metadata, but never temporal sample/proof/checkpoint arenas.

Activation and replay consume that same plan. Do not maintain a second production
estimator. Actual allocated capacities must stay within the planned geometry;
reject an allocation mismatch instead of silently exceeding the reported bound.
Plan metadata and construction overlap belong in the accounted peak. Reuse/move
metadata into existing storage where practical, rather than retaining duplicate
graphs solely for accounting convenience.

The report is a target-specific **accounted upper bound**, not current heap usage.
Allocator metadata, scalar/module storage, report/JSON output and caller copies
remain explicitly outside the temporal bound.

## Native interface

- `Runtime::plan_temporal(&activation)` returns requirements for its installed
  module, selected strategy and journal capacity without activation.
- `Runtime::temporal_resource_report()` returns the active report when available.
- `Runtime` and `ScanDriver::plan_current_temporal_replay(count, &activation)`
  return the combined live/ghost bound without executing replay.
- Positive but insufficient profile budgets yield `fitsBudget: false` while
  preserving the required capacities. Invalid facts or incompatible replay
  bindings still reject. Counts retain the strict positive retained-prefix rule.

Initial report fields: `format`, installed `module` fingerprint, `strategy`,
`targetPointerBytes`, `journalCapacity`, `windowCount`, `retainedSamples`,
`accountedTemporalBytes`, `fitsBudget`.

Replay report includes `eligibleCount`, `count`, `liveBytes`, `ghostBytes`,
`returnHeaderBytes`, `frameHeaderBytes`, `requiredPeakTemporalBytes` and
`ghostFitsBudget`. Its sum accounts for both returned core records and framed
outcomes while they overlap. Ghost geometry uses journal capacity equal to count.

Formats: `GhostFlow/temporal-resources-v1` and
`GhostFlow/temporal-replay-resources-v1`.

## WASM and JavaScript interface

Both adapters expose synchronous methods:

```js
runtime.planTemporal({ profile, maxJsonBytes });
runtime.planTemporalReplay({ count, profile, maxJsonBytes });
runtime.resourcePlan; // last successful plan, initially null
```

WASM exports:

- `gf_plan_temporal(handle, profilePtr, profileLen, maxJsonBytes)` and framed peer.
- `gf_plan_temporal_replay(handle, profilePtr, profileLen, count, maxJsonBytes)`
  and framed peer.
- `gf_resource_plan_ptr/len` and `gf_frame_resource_plan_ptr/len`.

Each handle owns a separate latest-plan buffer shared by the two plan types.
Only success replaces it. Rejection preserves previous plan, previous replay,
live execution, frame sequence and outcome. The bounded JSON writer charges old
plus candidate buffer capacities. Planning before framed activation uses the
configuring Runtime; replay planning requires the active ScanDriver.

## Independent acceptance

1. A fixed nested-window fixture has a separately reviewed wasm32 layout-width
   table and capacity formula. Derive target widths from isolated compiler layout
   evidence, never from a copied successful budget or product test-only export.
2. The oracle computes retained capacity C and byte bound N. Activate at C/N and
   reject C-1/N-1 in both actual WASM adapters. Compare reports as extra evidence.
3. Compute replay peak from the independent live/ghost geometry, core return
   headers and framed headers. Accept N and reject N-1 without altering live or
   previous replay/plan buffers. Do not use binary search as the oracle.
4. Before activation, insufficient positive budgets still report requirements.
   Show that planning does not allocate the temporal data arenas or execute a tick.
5. Preserve existing native, checkpoint, replay, trace and package behavior.

This work does not complete estimated evidence, other temporal operators,
foreign checkpoints or full Reference §6.8 branch/source-closure identities.

## Focused evidence

- `build/temporal-plan-rust-final.log`: core 142 and ABI 10 tests pass.
- `build/temporal-resource-plan-wasm-green.log`: WASM resource suite 22/22 pass.
- `build/scan-frame-wasm-temporal-plan.log`: framed suite 17/17 pass.
- `build/temporal-plan-catalog.log`: catalog 5/5 pass.
- Independent oracle: live C14 = 9,424,375 bytes; ghost count 3 = 47,511;
  legacy replay peak = 9,471,958; framed replay peak = 9,472,414.
- Batch15 full-gate artifacts: `build/compiler-runtime-batch15-full.log`,
  `build/compiler-runtime-batch15-verification.json`, and
  `build/compiler-runtime-batch15-reference-results.json`; Node 1,923 pass,
  27 Reference failures, 164 TODO, with source hashes matching the gate.
