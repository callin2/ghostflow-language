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
const pendingAdmissions = new Map();
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
      } else if (action.kind === 'outputRequest') {
        const limit = manifest.accounting.constraints.flatMap(group => group.limits)
          .find(item => item.account === action.account && item.basis?.kind === 'rolling');
        if (!limit) throw new Error(`no rolling constraint for ${action.account}`);
        const binding = scenario.accounting.bindings.find(item => item.account === action.account);
        if (binding.resourceId !== action.resourceId) throw new Error('output request does not match its account resource');
        const previous = pendingAdmissions.get(action.reservationId);
        if (previous && previous.account !== action.account) throw new Error('output reservation already belongs to another account');
        const reservationId = Uint8Array.from(Buffer.from(action.reservationId, 'hex'));
        const status = await accounting.reserveRolling({ reservationId, resourceId: action.resourceId,
          admittedAtMs: BigInt(action.atMs), windowMs: BigInt(limit.basis.durationMs),
          limitMs: BigInt(limit.boundMs), reserveMs: BigInt(limit.reserveMs) }, async () => true);
        if (status !== 'Duplicate') {
          pendingAdmissions.set(action.reservationId, { status, account: action.account, resourceId: action.resourceId,
            requestedMs: action.durationMs, atMs: action.atMs });
        }
      } else if (action.kind === 'outputApplied') {
        const pending = pendingAdmissions.get(action.reservationId);
        if (!pending) throw new Error(`unknown output reservation ${action.reservationId}`);
        if (pending.account !== action.account || pending.resourceId !== action.resourceId) {
          throw new Error('applied output does not match its reservation account and resource');
        }
        if (pending.status !== 'Inserted') throw new Error(`output reservation was not admitted: ${pending.status}`);
        const reservationId = Uint8Array.from(Buffer.from(action.reservationId, 'hex'));
        const receiptId = Uint8Array.from(Buffer.from(action.receiptId, 'hex'));
        await accounting.recordReservedAppliedSegment({ reservationId, receiptId, resourceId: action.resourceId,
          startMs: BigInt(action.startMs), endMs: BigInt(action.endMs), localDay: action.localDay }, async () => true);
        await accounting.settleRolling({ reservationId, appliedReceiptId: receiptId }, async () => true);
        pendingAdmissions.delete(action.reservationId);
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
        console.log(JSON.stringify({ scanId: scanId++, logicalTimeMs: action.atMs, trace,
          admissions: [...pendingAdmissions.values()].map(({ status, account, resourceId, requestedMs, atMs }) =>
            ({ status, account, resourceId, requestedMs, admittedAtMs: atMs })) }));
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
