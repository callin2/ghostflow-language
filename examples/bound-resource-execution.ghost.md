# Executing a bound shared Bool policy

This complete software-only control routes automatic, manual and fallback requests through one shared logical pump envelope. Inputs are requests, not physical feedback. The authored violation response is pump OFF and valve ON; this is an explicit example choice, not a device safety sequence.

Explicit new source revision: bound-input-quality-v1. The canonical inputs carry producer quality. This example retains the last observations for its request expressions; false initializes that source-local memory. The mandatory automatic/manual admission boundary requires a Good Bool observation in every scan. An unavailable mode rejects the scan atomically and permits a corrected retry; it does not mean OFF, a trip, or a restart command. Original source bytes are retained separately.

<!-- ghostflow:anchor id=GF-INT-BOUND-OBSERVATIONS kind=intent status=confirmed origin=engineer -->
Retain this software example's last request observations while preserving its authored resource guard.

```ghost
control BoundPump {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, automatic_request, manual_request, fallback_request, valve_request: Bool;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_automatic: Bool = false;
  let automatic_value = case automatic { ok(value) => value; fault(_) => remembered_automatic; };
  remembered_automatic' = automatic_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_manual: Bool = false;
  let manual_value = case manual { ok(value) => value; fault(_) => remembered_manual; };
  remembered_manual' = manual_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_automatic_request: Bool = false;
  let automatic_request_value = case automatic_request { ok(value) => value; fault(_) => remembered_automatic_request; };
  remembered_automatic_request' = automatic_request_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_manual_request: Bool = false;
  let manual_request_value = case manual_request { ok(value) => value; fault(_) => remembered_manual_request; };
  remembered_manual_request' = manual_request_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_fallback_request: Bool = false;
  let fallback_request_value = case fallback_request { ok(value) => value; fault(_) => remembered_fallback_request; };
  remembered_fallback_request' = fallback_request_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_valve_request: Bool = false;
  let valve_request_value = case valve_request { ok(value) => value; fault(_) => remembered_valve_request; };
  remembered_valve_request' = valve_request_value;
  output pump, valve: Bool;
  pump <- (automatic_value && (automatic_request_value || fallback_request_value)) || (manual_value && manual_request_value);
  valve <- valve_request_value;
  constraints SharedRules for station {
    exclusive at admission { automatic, manual };
    require at safe_output pump1.on => any_on({ valve1 });
    safe { pump1 = false; valve1 = true; }
  }
}
```

Run this complete JavaScript fence from the repository root after building the WASM target. All source, artifact, revision, resource, mode and output identities are supplied. The reference host validates the artifact and owns the sole logical writer; it performs no physical I/O. The same mandatory guard executes in the portable Rust core and native runner.

```js
import fs from 'node:fs';
import { compileSourceSync } from './tools/compile-source.mjs';
import { compileBoundResourceControl } from './tools/bound-resource-control.mjs';
import { BoundResourceControlRuntime } from './runtimes/node/bound-resource-control.mjs';

const filename = 'examples/bound-resource-execution.ghost.md';
const checked = compileSourceSync(fs.readFileSync(filename, 'utf8'), { filename });
const bound = compileBoundResourceControl(checked, {
  format: 'GhostFlow/resource-constraints-binding-v1',
  revision: 'virtual-installation-input-v1',
  sourceDocumentSha256: checked.sourceDocument.sha256,
  artifactSha256: checked.manifest.bytecodeSha256,
  resources: [
    { name: 'station', resourceId: 'virtual/bound-loop' },
    { name: 'pump1', resourceId: 'virtual/bound-pump', output: 'pump' },
    { name: 'valve1', resourceId: 'virtual/bound-valve', output: 'valve' },
  ],
  modes: [
    { group: 'SharedRules', name: 'automatic', input: 'automatic' },
    { group: 'SharedRules', name: 'manual', input: 'manual' },
  ],
});
const wasm = fs.readFileSync('target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const runtime = await BoundResourceControlRuntime.instantiate(wasm, bound);
const requests = [
  [true, false, true, false, false, true],
  [true, false, true, false, false, false],
  [true, false, true, false, false, true],
  [false, false, false, false, false, true],
  [false, true, false, true, false, true],
];
try {
  for (const [scanId, values] of requests.entries()) {
    // Each row explicitly supplies Good software observations, including false.
    const inputs = bound.manifest.sensors.flatMap((port, index) => [
      { name: port.valueInput, value: values[index] },
      { name: port.okInput, value: true },
      { name: port.faultInput, value: 0 },
    ]);
    const { trace } = runtime.scan({ scanId, logicalTimeMs: scanId, inputs });
    console.log(JSON.stringify(trace));
  }
} finally { runtime.dispose(); }
```

The second request violates the running requirement and uses the authored non-OFF safe vector. Restoring the valve request alone does not restart the pump. A neutral frame releases the trip; the later fresh manual claim must pass the same envelope. Binding is immutable for this activation and required on every evaluation. The native host must share one `ResourceBindingRegistry` among every writer in its installation; the reference Node host also rejects duplicate writers across WASM instances. Independent registries are separate installation authorities, not a way to arbitrate one shared resource.

This executable profile supports one Bool GFB1 v1/v3 request control with every output explicitly protected. Unsupported contextual/accounting/continuous profiles and shared-policy import composition fail closed. The specialized Station lease/cleanup contract remains separate. No hardware application, confirmed stop, physical sequence, PID integration or cooperative multi-control arbitration is demonstrated here.

## Browser and Worker public modules

Browsers and Workers import `compileSource`, `compileBoundResourceControl`,
`verifyBoundResourceCompilation`, and `observeBoundResourceTrace` from
`tools/browser-toolchain.mjs`. Import `BoundResourceControlRuntime` from
`runtimes/wasm/bound-resource-control.mjs`. Supply the exact canonical document,
installation binding, and fetched WASM bytes. `instantiate(wasmBytes, bound)`
creates the checked writer; `scan(frame)` returns the framed Rust outcome, and
`dispose()` releases its claim. Runtime construction failure also releases the
pending claim. The compiler and runtime module graphs use no Node builtins or
`Buffer`. The Node path above reexports this same runtime for the current example.

Pass `interactionSourceIdentity` to `compileSource` when presenting an
interaction schema. Binding preserves that document/revision identity and
regenerates the schema's module identity for the executable GFB17 bytes. Schema
verification reconstructs both identities; checked descriptors remain
nonexecutable. Logical inputs and outputs retain their exact names and types in the bound manifest.
Canonical inputs are in `manifest.sensors`; their generated value/OK/fault rails
form the complete VM frame. `manifest.inputs` contains only plain historical
input ports. The immutable mode activation uses the generated value rail and
the Rust guard validates its matching Bool OK rail. GFRB, GFRS and GFB17 wire
versions and layouts are unchanged.

The finite profile may include authored Bool state. Link each observed state to
its confirmed literate intent anchor as required by the interaction contract.
The checked descriptor carries source provenance without executable storage
bindings; binding obtains those from the actual lowered program. Completed
WASM scan snapshots expose the observed state value through the same public
interaction producer, including nonempty schemas.

The JavaScript writer registry covers one module instance in one realm, including
pending asynchronous creation. Separate Workers, windows, or independently
loaded module instances have separate registries. An installation host must
reserve stable resource IDs in one shared authority before starting any of those
writers, and release them on failure, disposal, or Worker termination. The
realm-local guard supplies no cross-Worker arbitration or physical guarantee.
