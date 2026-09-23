import fs from 'node:fs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { loadVerifiedArtifact, validateScenario } from './ghostsim.mjs';

// One activated Rust runtime owns the entire live session. The host supplies
// complete input frames and logical time; it does not replay prior scans.
export async function createLiveSession(artifactPath) {
  const { artifactBytes, manifest } = loadVerifiedArtifact(artifactPath);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifactBytes);
    for (const output of manifest.outputs) {
      const type = output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number';
      runtime.addCapability('actuator', output.name, type);
    }
    runtime.activate();
  } catch (error) {
    runtime.dispose();
    throw error;
  }
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
      const outcome = runtime.scan({ scanId, logicalTimeMs: atMs, inputs });
      scanId++;
      previousTime = atMs;
      return {
        scanId: outcome.scanId, logicalTimeMs: outcome.logicalTimeMs,
        inputs: outcome.trace.inputs,
        requestedVirtualIntent: outcome.trace.requested,
        safeVirtualIntent: outcome.trace.safe,
        faults: outcome.trace.faults,
        stateBefore: outcome.trace.stateBefore,
        stateAfter: outcome.trace.stateAfter,
      };
    },
    dispose() {
      runtime.dispose();
      disposed = true;
    },
  };
}
