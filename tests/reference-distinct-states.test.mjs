import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { emitCompletedScanSnapshot, expectedRuntimeIdentity, joinRuntimeSnapshot } from '../tools/interaction-runtime-snapshot.mjs';

const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const wire = value => JSON.parse(JSON.stringify(value));
const source = body => `# Distinct boundary states\n\n<!-- ghostflow:anchor id=GF-INT-REF-07-004 kind=intent status=confirmed origin=user -->\nPreserve typed values and their provenance across the control and observation boundary.\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const compile = (id, body) => compileSource(source(body), { filename: `distinct-${id}.ghost.md`,
  interactionSourceIdentity: { documentId: `source.ref-07-004.${id}`, revisionId: `revision.ref-07-004.${id}.1` } });

test('REF-07-004: serialized completed observations retain ready false and numeric zero with source and run identity', async t => {
  const artifact = await compile('values', `control Values {
    input enabled: Bool; input measured: Number;
    // ghostflow:link id=GF-INT-REF-07-004 relation=implements
    state flag: Bool = false;
    // ghostflow:link id=GF-INT-REF-07-004 relation=implements
    state amount: Number = 0.0;
    flag' = enabled; amount' = measured;
    output flag_out: Bool; output amount_out: Number;
    flag_out <- flag'; amount_out <- amount';
  }`);
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const runtime = await instantiate.call(ControlRuntime, wasm, artifact);
    t.after(() => runtime.dispose());
    const outcome = wire(runtime.step({ nowMs: 10, inputs: { enabled: false, measured: 0 } }));
    assert.deepEqual(outcome.vm.safe, { amount_out: 0, flag_out: false });
    assert.equal(typeof outcome.vm.inputs.enabled, 'boolean');
    assert.equal(typeof outcome.vm.inputs.measured, 'number');
    const snapshot = wire(emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.ref-07-004.values',
      completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 10 }, trace: outcome.vm }));
    assert.deepEqual(snapshot.observations, [
      { descriptorId: 'state.flag', status: 'ready', value: false },
      { descriptorId: 'state.amount', status: 'ready', value: 0 },
    ]);
    const expected = expectedRuntimeIdentity(artifact.interactionSchema, 'run.ref-07-004.values');
    assert.equal(snapshot.source.revisionId, expected.sourceRevisionId);
    assert.equal(snapshot.source.sha256, expected.sourceSha256);
    assert.equal(snapshot.runId, expected.runId);
    assert.equal(snapshot.module.moduleFingerprint, outcome.vm.module);
    assert.deepEqual(snapshot.completion, { kind: 'completed-scan', scanId: 0, logicalTimeMs: 10 });
    assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot, expected), { status: 'ready', staleReasons: [] });
    assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot, { ...expected, sourceRevisionId: 'different' }),
      { status: 'stale', staleReasons: ['source.revisionId'] });
    for (const inputs of [{ measured: 0 }, { enabled: false }, { enabled: 0, measured: 0 }, { enabled: false, measured: false }]) {
      assert.throws(() => runtime.step({ nowMs: 11, inputs }), /input|Bool|Number|boolean|number|missing/i);
    }
    const changed = wire(runtime.step({ nowMs: 12, inputs: { enabled: true, measured: 2 } }));
    assert.deepEqual(changed.vm.safe, { amount_out: 2, flag_out: true }, 'valid false/zero inputs are consumed, not replaced by fixed defaults');
    const next = wire(emitCompletedScanSnapshot({ compilation: artifact, runId: expected.runId,
      completion: { kind: 'completed-scan', scanId: 1, logicalTimeMs: 12 }, trace: changed.vm }));
    assert.deepEqual(next.observations, [
      { descriptorId: 'state.flag', status: 'ready', value: true },
      { descriptorId: 'state.amount', status: 'ready', value: 2 },
    ]);
  }
});

test('REF-07-004: serialized optional absence and installed sensor fault retain strategy quality and Result origin', async t => {
  const artifact = await compile('presence', `control Presence {
    sensor reading?: Number;
    output installed: Bool; output value: Number;
    adapt sensor_policy {
      strategy Installed priority 10 match (reading: sensor<Number>) {
        installed <- true; value <- reading |> recover(0.0);
      }
      strategy Absent priority 0 match always { installed <- false; value <- 0.0; }
    }
  }`);
  const sensorOrigin = artifact.sourceMap.find(node => node.kind === 'sensor').id;
  const absent = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  const installed = await ControlRuntime.instantiateFramed(wasm, artifact,
    { capabilities: [{ kind: 'sensor', name: 'reading', type: 'Number' }] });
  t.after(() => { absent.dispose(); installed.dispose(); });
  const missing = wire(absent.step({ nowMs: 0 }));
  assert.equal(missing.vm.strategy, 'Absent');
  assert.deepEqual(missing.vm.safe, { installed: false, value: 0 });
  assert.deepEqual(missing.vm.resultTrace, []);
  const sample = (id, quality) => ({ epoch: 7, id, timestampMs: id, quality, value: 0 });
  const good = wire(installed.step({ nowMs: 0, samples: { reading: sample(0, 'Good') } }));
  const fault = wire(installed.step({ nowMs: 1, samples: { reading: sample(1, 'Disconnected') } }));
  for (const outcome of [missing, good, fault]) {
    assert.equal(outcome.vm.module, artifact.interactionSchema.module.moduleFingerprint);
  }
  for (const outcome of [good, fault]) {
    assert.equal(outcome.vm.strategy, 'Installed');
    assert.deepEqual(outcome.vm.safe, { installed: true, value: 0 });
  }
  assert.equal(good.sensors.reading.quality, 'Good');
  assert.equal(fault.sensors.reading.quality, 'Disconnected');
  assert.deepEqual(good.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })), [{ choice: 0, origin: 0 }]);
  assert.deepEqual(fault.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })), [{ choice: 1, origin: sensorOrigin }]);
  assert.throws(() => absent.step({ nowMs: 1, samples: { reading: sample(1, 'Good') } }), /absent sensor capability reading/);
});
