import fs from 'node:fs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { loadVerifiedArtifact, validateScenario } from './ghostsim.mjs';
import { SoftwareInputProducer } from './software-input-producer.mjs';

// One activated Rust runtime owns the entire live session. The host supplies
// complete input frames and logical time; it does not replay prior scans.
export async function createLiveSession(artifactPath) {
  const { artifactBytes, manifest } = loadVerifiedArtifact(artifactPath);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateFramed(wasm, { bytes: artifactBytes, manifest });
  const producer = new SoftwareInputProducer(manifest);
  let scanId = 0;
  let previousTime = 0;
  let disposed = false;
  return {
    manifest,
    scan(atMs, inputs) {
      if (disposed) throw new Error('live session is disposed');
      if (atMs < previousTime) throw new Error('logical time moved backwards');
      validateScenario({
        format: 'GhostFlow/scenario-v1', id: 'live', initialInputs: inputs,
        keyBindings: [], actions: [{ kind: 'scan', atMs }],
      }, manifest);
      const produced = producer.stage(Object.fromEntries(inputs.map(input => [input.name, input.value])), atMs);
      const outcome = runtime.step({ nowMs: atMs, inputs: produced.inputs, samples: produced.samples }).vm;
      // Commit acquisition identity only after a successful scan.
      produced.commit();
      scanId++;
      previousTime = atMs;
      return {
        scanId: scanId - 1, logicalTimeMs: atMs,
        inputs: outcome.inputs,
        requestedVirtualIntent: outcome.requested,
        safeVirtualIntent: outcome.safe,
        faults: outcome.faults,
        stateBefore: outcome.stateBefore,
        stateAfter: outcome.stateAfter,
      };
    },
    dispose() {
      runtime.dispose();
      disposed = true;
    },
  };
}
