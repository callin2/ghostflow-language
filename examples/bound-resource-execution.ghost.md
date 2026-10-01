# Executing a bound shared Bool policy

This complete software-only control routes automatic, manual and fallback requests through one shared logical pump envelope. Inputs are requests, not physical feedback. The authored violation response is pump OFF and valve ON; this is an explicit example choice, not a device safety sequence.

```ghost
control BoundPump {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, automatic_request, manual_request, fallback_request, valve_request: Bool;
  output pump, valve: Bool;
  pump <- (automatic && (automatic_request || fallback_request)) || (manual && manual_request);
  valve <- valve_request;
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
  revision: 'virtual-installation-r1',
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
    const inputs = checked.manifest.control.inputs.map((port, index) => ({ name: port.name, value: values[index] }));
    const { trace } = runtime.scan({ scanId, logicalTimeMs: scanId, inputs });
    console.log(JSON.stringify(trace));
  }
} finally { runtime.dispose(); }
```

The second request violates the running requirement and uses the authored non-OFF safe vector. Restoring the valve request alone does not restart the pump. A neutral frame releases the trip; the later fresh manual claim must pass the same envelope. Binding is immutable for this activation and required on every evaluation. The native host must share one `ResourceBindingRegistry` among every writer in its installation; the reference Node host also rejects duplicate writers across WASM instances. Independent registries are separate installation authorities, not a way to arbitrate one shared resource.

This executable profile supports one Bool GFB1 v1/v3 request control with every output explicitly protected. Unsupported contextual/accounting/continuous profiles and shared-policy import composition fail closed. The specialized Station lease/cleanup contract remains separate. No hardware application, confirmed stop, physical sequence, PID integration or cooperative multi-control arbitration is demonstrated here.
