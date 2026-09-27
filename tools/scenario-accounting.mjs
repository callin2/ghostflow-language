// Scenario transport for Rust-owned durable accounting projections.
import fs from 'node:fs';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { loadVerifiedArtifact, validateScenario } from './ghostsim.mjs';

const [artifactPath, scenarioPath] = process.argv.slice(2);
const { artifactBytes, manifest } = loadVerifiedArtifact(artifactPath);
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
validateScenario(scenario, manifest);
const wasmBytes = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes);
const control = new GhostFlowRuntime(instance.exports);
const accounting = new AccountingRuntime(instance.exports, {
  ...scenario.accounting.config,
  maxRollingWindowMs: BigInt(scenario.accounting.config.maxRollingWindowMs),
});
const bindingByStream = new Map(scenario.accounting.bindings.map(item => [item.evidenceStream, item]));
const resultBindings = manifest.accounting.bindings.filter(item => item.resultInputs);

try {
  if (resultBindings.length !== 1) throw new Error('accounting scenario requires exactly one projected Result');
  control.load(artifactBytes);
  for (const output of manifest.outputs) {
    control.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
  }
  await accounting.initializeEmpty(async () => true);
  accounting.activateControl(control, {
    bootEpoch: BigInt(scenario.accounting.bootEpoch),
    terminalCapacity: scenario.accounting.terminalCapacity,
  });
} catch (error) {
  console.error(`activation: ${error.message}`);
  process.exit(1);
}

let scanId = 0;
try {
  for (const [index, action] of scenario.actions.entries()) {
    try {
      if (action.kind === 'accountingEvent') {
        const binding = bindingByStream.get(action.stream);
        await accounting.recordEvent({
          eventId: Uint8Array.from(Buffer.from(action.eventId, 'hex')),
          eventType: binding.eventType,
          localDay: action.localDay,
        }, async () => true);
      } else if (action.kind === 'scan') {
        const descriptor = resultBindings[0];
        const binding = scenario.accounting.bindings.find(item => item.account === descriptor.name);
        const trace = accounting.tickControl(control, {
          site: descriptor.site,
          account: descriptor.name,
          event: descriptor.evidenceBinding.target,
          timezone: descriptor.basis.zone,
          eventType: binding.eventType,
          localDay: action.accountingFacts.localDay,
          monotonicMs: BigInt(action.atMs),
          bootEpoch: BigInt(scenario.accounting.bootEpoch),
          wallMs: BigInt(action.accountingFacts.wallMs),
          clockTrusted: action.accountingFacts.clockTrusted,
        });
        console.log(JSON.stringify({ scanId: scanId++, logicalTimeMs: action.atMs, trace }));
      }
    } catch (error) {
      console.error(`action[${index}]: ${error.message}`);
      process.exit(1);
    }
  }
} finally {
  accounting.dispose();
  control.dispose();
}
