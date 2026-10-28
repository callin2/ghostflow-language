# Installed sensor binding reference host

`InstalledControlHost` admits a fixed compiled Program against a pinned installation declaration, then runs it through `ControlRuntime.instantiateFramed`. This covers [REF-06-009 sensor replacement](https://github.com/callin2/ghostflow-language/issues/297) and [REF-04-039 strategy profile replacement](https://github.com/callin2/ghostflow-language/issues/243). It performs no device discovery, Driver installation, polling, or physical verification.

## Pinned profile contract

Snapshots, accepted steps, and successful binding replacements include the same
owned `assessment` from [metadata-only installation admission](../contracts/integration-v1/README.md).
Its identity pins the admitted source, bytecode, manifest, release, profile, and mapping.
`assessment.physical.status` remains `unknown` even when a Bool output matches
the declared direction, type, polarity, and `safeLevel`. These declarations supply
no independent electrical, fail-safe, load, or wiring observation. Unknown physical
suitability leaves valid host execution available. Replacement recomputes the
assessment before publication; rejected or tampered candidates retain the live
assessment and trace. Returned assessments are detached from host state.

The existing `GhostFlow/board-profile-v1` shape remains unchanged. The new `GhostFlow/board-profile-v2` uses the same board identity and endpoint map. A v2 Bool output retains `direction`, `type`, `driver`, `address`, `activeLevel`, and `safeLevel`. A v2 Number or Bool input has `direction`, `type`, `driver`, `address`, and `sensor` instead of output polarity fields.

`sensor` contains `format: "GhostFlow/sensor-observation-v1"`, `canonicalUnit`, and a positive safe integer `maxInterSampleGapMs`. A Number input also declares finite ordered `minValue` and `maxValue`. The observation contract means that the acquisition owner supplies actual samples with source epoch, sample ID, capture timestamp, payload, and one of `Good`, `NotReady`, `Disconnected`, `Stale`, or `Invalid`. A fault is a fault, including when its carried placeholder value is zero. The profile and installation are pinned by the existing release SHA-256 references. These are declared capabilities, not authenticated measurements of a physical sensor or Driver binary.

For a bound sensor, `validateIntegration` checks direction, type, canonical unit, Number measurement range covering the Program's explicit `valid` range, the observation contract, and `maxInterSampleGapMs < staleMs`. Equality fails because a reading becomes stale at the limit. The source `sample` interval remains descriptive metadata; this check does not turn it into a polling command or a second hard deadline. A v2 sensor binding without explicit `stale_after`, or a Number sensor without an explicit `valid` range, is outside this bounded host profile and is rejected. Existing v1 validation keeps its previous shape and behavior.

## Running and replacement

```js
import { InstalledControlHost } from './runtimes/wasm/installed-control-host.mjs';

const host = await InstalledControlHost.instantiate(wasmBytes, compiled, {
  runId: 'run-1', release, boardProfile, installation,
});
const result = host.step({ bindingRevision: installation.revision, nowMs: 1000,
  samples: { reading: { bindingRevision: installation.revision,
    endpointId: installation.bindings.reading,
    sample: { epoch: 1, id: 1, timestampMs: 1000, quality: 'Good', value: 42 },
  } },
});
```

The caller attaches binding revision and endpoint ID at sample capture. The host rejects packets from an older revision or another endpoint before passing their sample to `ControlRuntime`. Those caller labels are not hardware authentication. A scan without a new sample passes an empty `samples` object, allowing the existing conditioner to decide freshness. Runtime output remains requested/safe control intent, not physical output proof.

`replaceBinding({ runId, release, boardProfile, installation })` validates a complete candidate against the **same source and bytecode**, prepares a fresh `ControlRuntime`, and publishes it between completed steps. An invalid candidate leaves the previous run, binding, conditioner state, and latest trace usable. A successful candidate needs an unused binding revision and run ID; it starts a fresh run with `NotReady` sensor state. The new acquisition source must issue its own source epoch and sample IDs. A new run boundary prevents old filter/freshness state from being reused; it does not promise uninterrupted state or output continuity. The host retains at most 128 run and binding revisions and rejects further replacements instead of forgetting IDs and allowing reuse. A previously used profile revision cannot acquire different content.

This operation changes sensor bindings only. It rejects changes to board ID or model, output wiring, installation ID, compiler/runtime/protocol metadata, or firmware digest. Migrating to another physical board requires a separate installation workflow. `step` returns the accepted outcome with its run, source, bytecode, profile, and binding identity attached; snapshots and results are detached from caller-owned objects.

## Strategy activation

The bounded Program profile also accepts compiler-generated `adaptPolicy` and `strategies` metadata. The host recompiles the canonical source and compares the complete manifest and bytecode before admission, including strategy matches, priorities and policy identity. Caller-edited metadata fails that comparison.

After integration validation confirms every required sensor binding and endpoint type, the host supplies an explicit capability for each bound sensor to `ControlRuntime`. The existing Rust runtime selects the strategy during activation. Capability presence comes from the validated installation, independently of sample quality. `NotReady`, `Stale` and other sensor faults remain Result observations under the selected strategy. They never remove a capability or select `match always` automatically.

A replacement validates the complete candidate and activates its strategy before publication. For example, if `WithReading` matches a required Number sensor and the current reading is Stale, a candidate binding that sensor to a Bool endpoint fails with `type_mismatch`. The old profile, run, binding, state and latest trace remain available. Subsequent steps still execute `WithReading` and its explicit fault branch. A compatible candidate publishes a fresh run whose sensor starts `NotReady` and whose Program state starts from its source initializer.

The standalone Program profile has source-verified `control-v1` or `control-v4` bytes, at least one nonoptional Number/Bool sensor, Bool outputs, and no schedules, timers, signals, configs, imports, or scalar inputs. Optional sensor bindings and arbitrary caller-supplied capabilities remain outside this host profile. Validated Bool outputs remain available as actuator capabilities for strategy matching. Other profiles fail before publication. Device binding application, actual Driver guarantees, and physical load behavior remain separate evidence.

## Installed composed execution

The composed profile accepts `control-v10` with a canonical pinned source closure,
an Interaction Schema, private instance states, configs and timers, required
Number/Bool sensors and Bool outputs. Pass `context`, actor `grants` and optionally
`historyCapacity` at activation. The host privately owns one framed
`TemporarySettingsHost`, which owns the only controller. Settings, observations
and explanations come from that same actual scan.

The root contains only port declarations, instances and direct root input to
instance input or instance output to root output connections. Nested instances,
instance-to-instance routes, root computations, schedules and signals are
rejected. Routes come from the compiler-replayed canonical AST, `sourceClosure`
and `sourceMap`, and agree with the typed `sensorInstances` input mapping.
Every root and instance sensor is checked against its actual admitted endpoint,
including unit, measurement range and sample-gap/stale limit. Generated runtime
names do not define routes.

Call `step(frame, settingsEvent)` with acquired packets and an extra `contextFacts`
field. The existing temporary-settings event contract uses current identity from
`snapshot().execution`. Endpoint, binding revision and acquisition shape checks
precede entry to the settings owner. Valid `Invalid` or `Disconnected` observations
reach the conditioner as faults; epoch, sample ID and timestamp keep the shared
runtime's sample identity rules.

An accepted result includes the actual settings-owner `execution` and
`provenance` binding its run, scan, logical time, committed settings revision,
admission digests and instance routes. `explainOutput('output.east_on', result)`
accepts only the owner's current completed result. It joins the actual proof and
observation and returns the descriptor, instance's effective settings, input
routes and output endpoint. Old results, swapped routes, settings or revisions
reject. A `ready` join validates the association; `proof.status` separately says
whether the expression explanation is available. State-based Bool proofs are
available; config/timer generated-rail expressions remain unavailable. These
receipts do not authenticate a physical Driver or prove state transitions,
safety outputs, applied outputs or physical effects.

`snapshot().latest` retains the last accepted completion as history. Separately,
`currentFrameCompletion` identifies the actual runtime's current completed scan.
Dispatch clears that identity before execution and publishes a new identity only
after completion. A failed dispatch, including a settings-return failure reported
as `accepted: false`, therefore makes current output explanations unavailable.
Acquisition, settings and context preflight rejections that never dispatch retain
the current identity. Historical proofs are unchanged and cannot be presented as
current through `explainOutput` after a dispatch failure.

Replacement prepares the complete new owner before publication. Rejected
candidates preserve settings, overlays, history, state, timers, conditioners,
latest completion and assessment. Success starts fresh state, settings and
conditioners in a new run and clears previous completions. This bounded path
completes the specified REF-06-002 east-state/settings isolation case together with
the native/WASM config/timer checks. Nested routes and independent hot binding
migration are outside this profile. REF-06-016 checks each instance's output explanation
against its exact source node, span, revision, settings and installed endpoint route.
The broader section 6.7 requested-to-safe constraint chain remains incomplete.
`tests/installed-composition.test.mjs` exercises actual WASM execution,
same-time east/west isolation, joined provenance, tampering, faults and replacement.
