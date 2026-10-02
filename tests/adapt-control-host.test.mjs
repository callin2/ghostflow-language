import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)));
const reference = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-035');
assert.ok(reference, 'canonical capability-strategies source must remain available');
const artifact = await compileSource(reference.source, { filename: reference.filename });

test('REF-04-035 explicit absent sensor selects Baseline', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  try {
    assert.equal(host.step({ nowMs: 0, inputs: { scheduled: true } }).vm.requested.pump, true);
    assert.equal(host.step({ nowMs: 1, inputs: { scheduled: false } }).vm.requested.pump, false);
  } finally { host.dispose(); }
});

const moisture = { kind: 'sensor', name: 'moisture', type: 'Percent' };
const sample = (id, quality, value) => ({ epoch: 1, id, timestampMs: id, quality, value });

test('REF-04-035 present sensor uses moisture strategy and faults never select Baseline', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [moisture] });
  try {
    const step = (nowMs, samples = {}) => host.step({ nowMs, inputs: { scheduled: true }, samples }).vm.requested.pump;
    assert.equal(step(0), false, 'present sensor without sample is NotReady, not Baseline');
    assert.equal(step(1, { moisture: sample(1, 'Good', 20) }), true);
    assert.equal(step(2, { moisture: sample(2, 'Good', 40) }), false);
    assert.equal(step(3, { moisture: sample(3, 'Disconnected', 20) }), false);
  } finally { host.dispose(); }
});

test('absent optional capability rejects samples instead of inventing presence', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  try {
    assert.throws(() => host.step({ nowMs: 1, inputs: { scheduled: true }, samples: { moisture: sample(1, 'Good', 20) } }), /absent sensor capability moisture/);
  } finally { host.dispose(); }
});

test('REF-04-034: activated absence and installed Disconnected retain profile identity and selected strategy in actual host snapshots', async t => {
  const original = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-034');
  assert.ok(original, 'original host Reference case must remain available');
  assert.equal(original.status, 'specified');
  assert.equal(original.scope, 'host');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/240');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const wire = value => JSON.parse(JSON.stringify(value));
  const identity = {
    sourceSha256: hash(reference.source),
    bytecodeSha256: hash(artifact.bytes),
    manifestSha256: hash(JSON.stringify(artifact.manifest)),
    module: artifact.traceMetadata.moduleFingerprint,
  };
  assert.equal(identity.bytecodeSha256, artifact.manifest.bytecodeSha256);
  const sensorOrigin = artifact.sourceMap.find(node => node.kind === 'sensor')?.id;
  assert.ok(Number.isInteger(sensorOrigin), 'fault Result must retain canonical sensor origin');
  const profiles = { A: [], B: [moisture] };
  const captures = [];
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const callerA = wire(profiles.A);
    const callerB = wire(profiles.B);
    const absent = await instantiate(wasm, artifact, { capabilities: callerA });
    const installed = await instantiate(wasm, artifact, { capabilities: callerB });
    t.after(() => { absent.dispose(); installed.dispose(); });
    // Installation facts are captured at activation, not reread from a mutable
    // caller array or inferred from each scan's sensor quality.
    callerA.push(wire(moisture));
    callerB.length = 0;
    const capture = (host, profile, snapshot) => wire({
      identity,
      activation: { capabilities: profiles[profile], sha256: hash(JSON.stringify(profiles[profile])) },
      snapshot,
      outcome: host.step(snapshot),
    });
    const missing = capture(absent, 'A', { nowMs: 1, inputs: { scheduled: true } });
    const disconnected = capture(installed, 'B', {
      nowMs: 1, inputs: { scheduled: true }, samples: { moisture: sample(1, 'Disconnected', 20) },
    });
    const recovered = capture(installed, 'B', {
      nowMs: 2, inputs: { scheduled: true }, samples: { moisture: sample(2, 'Good', 20) },
    });
    const faultAgain = capture(installed, 'B', {
      nowMs: 3, inputs: { scheduled: true }, samples: { moisture: sample(3, 'Disconnected', 20) },
    });
    for (const record of [missing, disconnected, recovered, faultAgain]) {
      assert.deepEqual(record.identity, identity);
      assert.equal(record.outcome.vm.module, identity.module);
      assert.equal(record.outcome.vm.inputs.scheduled, record.snapshot.inputs.scheduled);
      assert.equal(record.activation.sha256, hash(JSON.stringify(record.activation.capabilities)));
    }
    assert.notEqual(missing.activation.sha256, disconnected.activation.sha256);
    assert.deepEqual(missing.activation.capabilities, []);
    assert.equal(missing.outcome.vm.strategy, 'Baseline');
    assert.deepEqual(missing.outcome.vm.requested, { pump: true });
    assert.deepEqual(missing.outcome.vm.resultTrace, []);
    for (const record of [disconnected, faultAgain]) {
      assert.deepEqual(record.activation.capabilities, [moisture]);
      assert.equal(record.snapshot.samples.moisture.quality, 'Disconnected');
      assert.equal(record.outcome.vm.strategy, 'WithMoisture');
      assert.deepEqual(record.outcome.sensors.moisture, { ok: false, value: 0, quality: 'Disconnected' });
      assert.deepEqual(record.outcome.vm.requested, { pump: false });
      assert.deepEqual(record.outcome.vm.safe, { pump: false });
      assert.deepEqual(record.outcome.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })),
        [{ choice: 1, origin: sensorOrigin }]);
    }
    assert.equal(recovered.outcome.vm.strategy, 'WithMoisture');
    assert.deepEqual(recovered.outcome.sensors.moisture, { ok: true, value: 20, quality: 'Good' });
    assert.deepEqual(recovered.outcome.vm.requested, { pump: true });
    assert.deepEqual(recovered.outcome.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })),
      [{ choice: 0, origin: 0 }]);
    assert.throws(() => absent.step({ nowMs: 2, inputs: { scheduled: true },
      samples: { moisture: sample(2, 'Good', 20) } }), /absent sensor capability moisture/);
    const stillAbsent = capture(absent, 'A', { nowMs: 2, inputs: { scheduled: false } });
    assert.equal(stillAbsent.outcome.vm.strategy, 'Baseline');
    assert.deepEqual(stillAbsent.outcome.vm.requested, { pump: false });
    captures.push([missing, disconnected, recovered, faultAgain, stillAbsent].map(record => ({
      ...record, outcome: { vm: record.outcome.vm, sensors: record.outcome.sensors, signals: record.outcome.signals },
    })));
  }
  assert.deepEqual(captures[0], captures[1], 'plain and framed hosts execute identical captured inputs and traces');
});
