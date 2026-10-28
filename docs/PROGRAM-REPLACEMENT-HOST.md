# Reference Program replacement host

`ProgramReplacementHost` runs one compiled GhostFlow Program and commits a validated replacement between completed ticks. It uses the existing Rust core for evaluation and state transfer. This reference adapter performs no installation, driver calls, output rendering, or physical verification.

## Run the example

From this repository root, with the WASM artifact built at `target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm`:

```sh
node examples/program-replacement-host.mjs
```

The example compiles two complete `.ghost.md` documents, supplies a fictional Integration v1 board profile and installation, executes one input observation, replaces the Program, and executes a fresh observation. Its output shows different source, artifact, and run identities; the replacement's first trace shows the prior `held` state and the new state's default. The virtual profile and caller-supplied observations are not device evidence.

## API and transaction

Snapshots, accepted steps, and successful replacements expose an owned
`assessment` from [metadata-only installation admission](../contracts/integration-v1/README.md).
It separates `{valid, errors}` metadata validation from the physical gate and pins
the release plus exact source, module, and manifest digests. The physical status
is `unknown` because declared Bool output direction, type, polarity, and `safeLevel`
do not verify electrical behavior, fail-safe suitability, loads, or wiring.
Host execution continues with valid metadata. A successful replacement publishes
its recomputed assessment with the new Program identity. A rejected candidate
leaves the current assessment and last trace intact. Returned assessments are
detached from host state.

```js
const host = await ProgramReplacementHost.instantiate(wasmBytes, artifact, {
  runId, release, boardProfile, installation, historyCapacity: 128,
});
const result = host.step({ observations: {
  enabled: { ok: true, value: true, source: 'virtual-input', observationId: 'sample-1' },
} });
const boundary = host.replace({ artifact: candidate, runId: 'next-run' });
host.dispose();
```

`artifact` is the compiler result containing `sourceDocument`, `manifest`, and `bytes`. The host copies it, recompiles the exact canonical source and supplied closure, and checks source, manifest, and bytecode identity before loading. It validates pinned Integration v1 release/profile/installation records and each required logical sensor binding. The installed capability set stays fixed for this host lifetime. Integration validity is structural consistency, not authentication of board wiring or a physical result.

Every `step` supplies a complete observation map. Each logical Bool input has a Result with caller-declared `source` and `observationId`. A fault uses `{ok:false,fault:'Disconnected'|'Stale'|'Invalid'|'NotReady',source,observationId}`. The host retains these declarations beside the accepted core trace; it does not promote them to independently verified sensor observations. A malformed map is rejected before any input is staged. The returned trace and identity belong to the same accepted tick. Returned objects and snapshots are detached from host state.

`replace` validates and owns the candidate before calling the Rust `hotSwap`. If validation or the core compatibility check fails, the previous Program, state, run, and last accepted trace remain active. A successful replacement publishes the new source/artifact/run identity and clears the last trace. The core discards its input cache, so the next tick requires a complete new observation map. The core alone transfers same-name, same-type state; this host does not copy state in JavaScript. A run ID may not be reused. At the configured finite history capacity, further replacement is rejected instead of forgetting a used ID.

## Supported profile and limits

A fresh snapshot means the caller resupplies every observation for the new schema; the host never inherits the old input cache. It does not require a newly sampled device value or a new observation ID. The same sample may remain current across ticks. Sample age and authenticity require their separately owned observation contracts.

The reference host accepts `GhostFlow/control-v1` and `control-v4` with Bool logical inputs and outputs, including Int control state. It rejects composition, settings, timers, signals, schedules, sensor conditioning, optional sensors, resource/objective policies, output observation rails, and lifecycle/context profiles before changing the live Program. The full framed `ControlRuntime` has additional host-owned sensor and context state and no framed hot-swap ABI; those migrations require a separate transaction design. Device/driver installation, output application, feedback, and physical acceptance remain independently owned.

Related cases: [REF-06-020](https://github.com/callin2/ghostflow-language/issues/305), [REF-06-022](https://github.com/callin2/ghostflow-language/issues/307).
