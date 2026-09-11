# Framed ControlRuntime adoption (D6)

Main design, 2026-09-11. Selected work: callin2/farm_studio_frontend#69,
TASK-76.6, GF-INT-COMMON-SCAN-DRIVERS. Scope is one cross-module adoption task,
split into language-host and Web-consumer implementation units. Builds on
language PR19 / 1b04529 and web PR71 / a6999ad. No device or physical I/O.

## Language host entry

Add `ControlRuntime.instantiateFramed(wasmBytes, artifact, options = {})`.
It uses the same manifest validation, bytecode digest verification, capability
binding and existing Rust signal conditioners as the current entry. Default
manifest acceptance remains v1; `acceptSettings` retains its existing meaning.
Legacy `instantiate` and `instantiateSimulation` behavior remains unchanged.
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

All ordinary snapshot/type/time validation happens before conditioner mutation.
If conditioning or VM dispatch subsequently throws, the framed host latches a
fault: the committed VM outcome stays available, but further step attempts
require a new host instance. Do not claim conditioner rollback or re-use a
partially processed sample snapshot. This policy is new-entry-only; legacy
recovery behavior remains unchanged. Validate/retry before conditioning remains
possible. Global constraints yielding false outputs are successful scans, not
host faults. Dispose releases all owned conditioners and the framed handle.

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
fault latch/committed-outcome preservation, old-artifact and disposal handling.
Web: unit/type/build/source guard, strict no-reuse browser server, existing
lesson/replay/source-trace and speed tests, plus accepted frame/epoch continuity,
constraints, failed compile/reset, and invalid DI rejection before a host call.

The language prerequisite can merge after its own exact-head gates; parent D6
cannot be Done until Web pins and exercises that artifact. D9 native framed-tape
parity and D7/D8/D11 device integration remain separate tasks.
