# Framed ControlRuntime adoption (D6)

Main design, 2026-09-11. Selected work: callin2/farm_studio_frontend#69,
TASK-76.6, GF-INT-COMMON-SCAN-DRIVERS. Scope is one cross-module adoption task,
split into language-host and Web-consumer implementation units. Builds on
language PR19 / 1b04529 and web PR71 / a6999ad. No device or physical I/O.

## Language host entry

Add `ControlRuntime.instantiateFramed(wasmBytes, artifact, options = {})`.
It uses the same manifest validation, bytecode digest verification, capability
binding and existing Rust signal conditioners as the current entry. Manifest
v1 and v4 are accepted; `acceptSettings` opts into v2. v3 is accepted without
an opt-in. Current host validation also accepts v7, v8 and v10 under their
feature-specific bytecode contracts. There is no `acceptSolar` option.
Legacy `instantiate` and `instantiateSimulation` retain their public result
shape; every entry now uses the same atomic conditioner transaction boundary.
Use a shared constructor/helper, not copied conditioning or a second evaluator.

Only the new entry owns `FramedGhostFlowRuntime`. At each `step` the host
validates and captures complete declared inputs, samples and schedule flags;
then the existing conditioners produce sensor/signal value+quality inputs.
Capture primitive DI values once before conditioning. Missing DI never defaults
to false. An absent schedule flag continues to mean no supplied occurrence,
per the existing host contract; it does not advance civil-time scheduling.

Build one complete list of declared and generated inputs, excluding only
`__gf_now_ms`. Dispatch exactly once through `runtime.scan` with explicit
logical time, including programs with no timers. Do not call legacy setters,
tick, or fallback to an old artifact in the framed path. Missing ABI exports
produce a compilation diagnostic and permit the existing reload/retry path.

The host owns a private per-instance frame sequence, initially zero. Increment
only after a successful scan, enforce safe-integer exhaustion before any host
service mutation, and retain last accepted time and outcome on errors.
Return existing `{vm, sensors, signals}` plus `frame: {scanId, logicalTimeMs}`
only for the framed entry. `vm` remains the unmodified canonical TickRecord;
its legacy tick namespace is distinct from the frame ID.
`lastFrameOutcome` is a read-only getter returning the framed runtime's fresh
plain-data committed outcome (null before the first scan, null in legacy mode).
After disposal it rejects. Execution mode and frame counter stay private.

`signals` contains conditioner readings. VM-owned `debounce` and `hold_last`
states are in `vm.stateAfter`. For hold observations, pass the verified source
trace metadata and `vm` to `observeSourceTrace`; `heldEvents` projects the
Rust-computed Held payload, original sample identity, age and masked fault.
The adapter and observer do not execute the hold expression or extend its TTL.

### Temporal windows

Temporal replay through both adapters is specified in
[TEMPORAL-REPLAY.md](TEMPORAL-REPLAY.md).

Both `instantiate` and `instantiateFramed` require `options.temporal` for GFB4
window modules. Supply an explicit execution epoch, physical root density
contracts and target temporal memory budgets:

```js
const options = {
  temporal: {
    timeEpoch: 5,
    rootDensity: [{ sourceTag: 1, maxObservations: 3, intervalMs: 1000 }],
    budget: { maxRetainedSamples: 12, maxBytes: 33554432 },
  },
};
const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact, options);
```

These are illustrative values, not device defaults. Source tags must match the
compiled physical roots. Density is an acquisition upper bound; `sampleMs`
does not establish it. Root tags are ascending and unique. Budget integers fit
u32; epoch and intervals are exact safe integers. Non-window modules reject this
option. The host captures it before asynchronous initialization; later caller
mutation does not change the session. A different time epoch requires a new
runtime instance. The host supplies the captured `__gf_time_epoch` on every scan.

The Rust core computes windows. Their owned evidence is `vm.windowTrace`, with
derived quality, immediate physical or aggregate identities and optional upstream
fault. Nested aggregate contributors retain owned proof trees of their inputs;
the observer does not flatten them into a different average. Observation time
remains the newest contributing measurement time; evaluation time is separate.
It is not a conditioner entry in `signals`. A rejected scan rolls back window
history and conditioners together, so retry can reuse the same sample identity.
`observeSourceTrace(verifiedMetadata, vm)` projects this as `windowEvents` linked
to the authored declaration. Unavailable aggregates report their own NotReady
site; an upstream fault remains separate. The source map records window sources,
identity inputs, clocks and downstream window dependencies. Restoring a source
map checks these links against canonical lowering.

Low-level adapters expose `activateTemporal(profile)` with the same profile.
Both use the bounded GFTA activation packet and independent Rust validation.
The budget accounts for temporal storage and bounded retained traces. JSON
buffers, host conditioners and caller-retained copies are outside that budget.
Manifest validation checks structural domains and bytecode digest; canonical
source/nominal-descriptor equivalence requires toolchain/package verification.

All ordinary snapshot/type/time validation happens before conditioner mutation.
The later Reference 4.15 atomic tick contract supersedes this design's original
no-rollback limitation. Before conditioning, the host begins one Rust-owned
transaction on every sensor and signal conditioner. Conditioning, generated
input preparation, or a known native rejection rolls all of them back and keeps
the accepted logical time and frame ID unchanged, so the caller can retry.

A positive native scan commits every conditioner, logical time, and frame ID
before decoding the outcome. A failure after that boundary cannot undo accepted
state and terminates the host. A trap whose native commit status is unknown also
terminates the host without fabricating rollback. The committed VM outcome stays
available when its adapter remains readable. Global constraints yielding false
outputs are successful scans, not host faults. Dispose releases all owned
conditioners and the framed handle.

## Web consumer

Pin the reviewed language-host commit and build the actual matching WASM via
the existing strict source/artifact guard. Keep the pin update owned by main
until the language prerequisite has passed independent review.
`compilePlaygroundSource` uses `instantiateFramed` and assigns a fresh
`runEpoch` (UUID) per successful compilation. No edits to user preview checkouts.

`runPlaygroundScan` accepts exactly eight present Boolean DI entries; reject
wrong lengths, holes or non-Booleans before calling the host. Use a detached
snapshot. Remove inferred-false input fallback. Validate the host's accepted
frame identity/time before publishing the UI result. RO1..RO8 come only from
that result's final `vm.safe` bank, each an explicit Boolean; never use requested
outputs or treat an absent result as false.

Keep canonical VM output unchanged inside ControlRuntime. The Web observation
may attach `scanFrame: {runEpoch, scanId, logicalTimeMs}` to its trace, documented
as host metadata in the local declaration, not a changed Rust TickRecord.
Carry it through existing history, comparison and replay records. Comparisons
of semantics must ignore run-epoch identity; separate runs intentionally differ.
Expose current accepted identity with transport data attributes if useful for
browser checks; no extra explanatory copy or new layout is needed.
Compile/reset replaces the epoch; rejected recompile retains the last good
instance/identity. Pause and one-step do not replace an epoch or skip frame IDs.

## Verification and completion

Language: real built WASM, all existing gates, new-entry complete/generated
input parity (timer, sensor/signal, schedule, constraints), frames with and
without timers, safe identity progression and rejection, no legacy export calls,
known rejection rollback and same-ID retry, unknown/postcommit fault latching and
committed-outcome preservation, old-artifact and disposal handling.
Web: unit/type/build/source guard, strict no-reuse browser server, existing
lesson/replay/source-trace and speed tests, plus accepted frame/epoch continuity,
constraints, failed compile/reset, and invalid DI rejection before a host call.

The language prerequisite can merge after its own exact-head gates; parent D6
cannot be Done until Web pins and exercises that artifact. D9 native framed-tape
parity and D7/D8/D11 device integration remain separate tasks.

## Civil schedules (issue #366)

For framed civil `Daily` and `DailySlots`, the host activates the schedule
profile with `{bootEpoch, terminalCapacity}`. The provider supplies GFSF v2/v3
schedule-fact packets separately at scan time; activation does not produce
packets, and schedule facts are not ordinary generated input entries.
`clock.monotonicMs` must equal `frame.logicalTimeMs` exactly.

The runtime exports `gf_frame_activate_schedules` and
`gf_frame_scan_schedules`; the JavaScript host uses `activateSchedules` and
`dispatchSchedules`. The host must require matching WASM exports before using
this path.

Rust owns occurrence admission and the occurrence ledger. The host validates
the complete declared and generated input set and the schedule-fact packet
before execution; it must not
derive or supply runtime `due`, `ok` or `fault` results. A rejected frame must
follow the existing commit boundary: a known rejection rolls back and permits
retry with the same frame identity, while failure after native commit preserves
the original committed frame result and cannot be retried as an uncommitted
frame. For example, an invalid schedule-fact packet is rejected before frame
commit; a valid retry uses the same frame identity. Regression coverage is in
`tests/framed-control-host.test.mjs` and
`crates/ghostflow-core/tests/schedule_module.rs`.

Framed Solar schedules remain unsupported.

Prevention rule: verify the actual public runtime interface before making mock
assumptions. Mock coverage alone does not establish runtime capability.
