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

The supported Program profile has source-verified, standalone `control-v1` or `control-v4` bytes, at least one nonoptional Number/Bool sensor, Bool outputs, and no schedules, timers, signals, configs, imports, or scalar inputs. Optional sensor bindings and arbitrary caller-supplied capabilities remain outside this host profile. Validated Bool outputs remain available as actuator capabilities for strategy matching. Other profiles fail before publication. Device binding application, actual Driver guarantees, and physical load behavior remain separate evidence.
