import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { jsonSha256, SCHEMAS, validateIntegration } from '../tools/integration-contract.mjs';
import { InstalledControlHost } from '../runtimes/wasm/installed-control-host.mjs';

const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const document = `# Replacement reference

\`\`\`ghost
control SensorReplacement {
  input reading: Number {
    sample = 1s; valid = 0 .. 100; filter = median(3);
    stale_after = 3s; recover_after = 2 samples;
  }
  state latched: Bool = false;
  latched' = latched || case reading { ok(value) => value >= 50; fault(_) => false; };
  output active: Bool;
  active <- latched';
}
\`\`\`
`;
const artifact = compileSourceSync(document, { filename: 'sensor-replacement.ghost.md' });
const adaptDocument = document.replace('active <- latched\';', `adapt policy {
    strategy WithReading priority 100 match (reading: sensor<Number>) {
      active <- case reading { ok(_) => latched; fault(_) => false; };
    }
    strategy Baseline priority 0 match always { active <- true; }
  }`);
const adaptArtifact = compileSourceSync(adaptDocument, { filename: 'sensor-strategy-replacement.ghost.md' });
const digest = '1'.repeat(64);

function candidate(revision, endpointId, gapMs, sensorType = 'Number', sensorName = 'reading') {
  const boardProfile = {
    schema: SCHEMAS.profileV2, id: 'reference-board', revision, boardModel: 'REFERENCE-ONLY',
    endpoints: {
      [endpointId]: { direction: 'input', type: sensorType, driver: `driver-${revision}`,
        address: `virtual/${revision}`, sensor: { format: SCHEMAS.sensorObservation,
          canonicalUnit: null, ...(sensorType === 'Number' ? { minValue: 0, maxValue: 100 } : {}),
          maxInterSampleGapMs: gapMs } },
      relay: { direction: 'output', type: 'Bool', driver: 'virtual-relay', address: 'virtual/relay',
        activeLevel: 'high', safeLevel: 0 },
    },
  };
  const profileRef = { id: boardProfile.id, revision, sha256: jsonSha256(boardProfile) };
  const installation = { schema: SCHEMAS.installation, id: 'reference-site', revision,
    boardProfile: profileRef, bindings: { [sensorName]: endpointId, active: 'relay' } };
  const release = { schema: SCHEMAS.release, toolchain: { version: 'reference', sha256: digest },
    runtimeSemanticsVersion: 'reference-host', bytecodeFormat: 'GFB1', protocolVersion: 'reference',
    device: { firmwareSha256: digest, boardProfile: profileRef },
    installation: { id: installation.id, revision, sha256: jsonSha256(installation) } };
  return { release, boardProfile, installation };
}

function repin(c) {
  c.release.device.boardProfile.sha256 = jsonSha256(c.boardProfile);
  c.installation.boardProfile.sha256 = c.release.device.boardProfile.sha256;
  c.release.installation.sha256 = jsonSha256(c.installation);
}
const sample = (revision, endpointId, epoch, id, nowMs, value, quality = 'Good') => ({
  bindingRevision: revision, endpointId,
  sample: { epoch, id, timestampMs: nowMs, value, quality },
});
const frame = (revision, nowMs, packet) => ({ bindingRevision: revision, nowMs,
  samples: packet ? { reading: packet } : {} });

test('REF-04-039 rejects an incompatible profile while the selected strategy sensor is Stale', async t => {
  const host = await InstalledControlHost.instantiate(wasm, adaptArtifact,
    { runId: 'run-1', ...candidate('r1', 'sensor-a', 2000) });
  t.after(() => host.dispose());
  const notReady = host.step(frame('r1', 0));
  assert.equal(notReady.sensors.reading.quality, 'NotReady');
  assert.equal(notReady.vm.strategy, 'WithReading');
  assert.equal(notReady.vm.safe.active, false);
  for (const id of [1, 2, 3]) {
    host.step(frame('r1', id * 1000, sample('r1', 'sensor-a', 1, id, id * 1000, 90)));
  }
  assert.equal(host.step(frame('r1', 3500)).vm.safe.active, true);
  const stale = host.step(frame('r1', 6000));
  assert.equal(stale.sensors.reading.quality, 'Stale');
  assert.equal(stale.vm.strategy, 'WithReading');
  assert.equal(stale.vm.safe.active, false, 'Stale follows the selected Result fault branch, never Baseline true');
  const before = host.snapshot();
  const incompatible = candidate('r2', 'sensor-b', 2000, 'Bool');
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...incompatible }), /type_mismatch/);
  assert.deepEqual(host.snapshot(), before, 'candidate rejection preserves profile, run, binding and latest trace');
  const continued = host.step(frame('r1', 6100));
  assert.equal(continued.sensors.reading.quality, 'Stale');
  assert.equal(continued.vm.strategy, 'WithReading');
  assert.equal(continued.vm.safe.active, false);
  for (const id of [4, 5, 6]) {
    host.step(frame('r1', 6200 + id * 100,
      sample('r1', 'sensor-a', 1, id, 6200 + id * 100, 10)));
  }
  const recovered = host.snapshot().latest;
  assert.equal(recovered.sensors.reading.quality, 'Good');
  assert.equal(recovered.sensors.reading.value, 10);
  assert.equal(recovered.vm.strategy, 'WithReading');
  assert.equal(recovered.vm.safe.active, true, 'old latched Program state survives failed candidate admission');
  assert.deepEqual(recovered.identity, before.latest.identity);
});

test('REF-04-039 publishes a compatible profile as a fresh strategy run between completed steps', async t => {
  const host = await InstalledControlHost.instantiate(wasm, adaptArtifact,
    { runId: 'run-1', ...candidate('r1', 'sensor-a', 2000) });
  t.after(() => host.dispose());
  for (const id of [1, 2, 3]) {
    host.step(frame('r1', id * 1000, sample('r1', 'sensor-a', 1, id, id * 1000, 90)));
  }
  assert.equal(host.step(frame('r1', 3500)).vm.safe.active, true);
  const before = host.snapshot();
  const pending = host.replaceBinding({ runId: 'run-2', ...candidate('r2', 'sensor-b', 2000) });
  const preparing = host.step(frame('r1', 4000));
  assert.deepEqual(preparing.identity, before.latest.identity, 'old run remains live during candidate preparation');
  const accepted = await pending;
  assert.equal(accepted.runId, 'run-2');
  assert.equal(accepted.boardProfileRevision, 'r2');
  assert.equal(accepted.bindingRevision, 'r2');
  assert.equal(accepted.latest, null);
  assert.deepEqual(host.snapshot(), accepted);
  assert.throws(() => host.step(frame('r1', 4100)), /stale binding revision/);
  const fresh = host.step(frame('r2', 4100));
  assert.equal(fresh.sensors.reading.quality, 'NotReady');
  assert.equal(fresh.vm.strategy, 'WithReading');
  assert.equal(fresh.vm.safe.active, false);
  assert.equal(fresh.identity.runId, 'run-2');
  assert.equal(fresh.identity.boardProfileRevision, 'r2');
  assert.equal(fresh.identity.bindingRevision, 'r2');
  for (const id of [1, 2, 3]) {
    host.step(frame('r2', 4100 + id * 100,
      sample('r2', 'sensor-b', 2, id, 4100 + id * 100, 10)));
  }
  const ready = host.snapshot().latest;
  assert.equal(ready.sensors.reading.quality, 'Good');
  assert.equal(ready.vm.strategy, 'WithReading');
  assert.equal(ready.vm.safe.active, false, 'successful publication starts with fresh Program and conditioner state');
});

test('installed strategy metadata must match the canonical compiler output', async () => {
  const mutations = [
    manifest => { manifest.adaptPolicy.name = 'forged'; },
    manifest => { manifest.strategies[0].match[0].type = 'Bool'; },
    manifest => { manifest.strategies[0].priority = -1; },
    manifest => { delete manifest.adaptPolicy; },
    manifest => { delete manifest.strategies; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(adaptArtifact);
    mutate(forged.manifest);
    await assert.rejects(InstalledControlHost.instantiate(wasm, forged,
      { runId: 'forged', ...candidate('r1', 'sensor-a', 2000) }), /source, manifest or bytecode differs/);
  }
});

test('REF-06-009 rejects slow Number replacement and publishes a fresh run only after compatible admission', async t => {
  const initial = candidate('r1', 'sensor-a', 2000);
  const host = await InstalledControlHost.instantiate(wasm, artifact, { runId: 'run-1', ...initial });
  t.after(() => host.dispose());
  for (const [id, value] of [[1, 10], [2, 80], [3, 90]]) {
    host.step(frame('r1', (id - 1) * 1000, sample('r1', 'sensor-a', 1, id, (id - 1) * 1000, value)));
  }
  assert.equal(host.snapshot().latest.sensors.reading.quality, 'Good');
  assert.equal(host.snapshot().latest.vm.safe.active, true);
  assert.equal(host.snapshot().latest.identity.runId, 'run-1');
  const before = host.snapshot();
  const slow = candidate('r2', 'sensor-b', 4000);
  assert.ok(validateIntegration({ ...slow, artifacts: { source: document, module: artifact.bytes,
    manifest: artifact.manifest } }).errors.some(error => error.code === 'sample_gap'));
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...slow }), /sample_gap/);
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.step(frame('r1', 2500)).sensors.reading.quality, 'Good');
  const compatible = candidate('r2', 'sensor-b', 2000);
  const accepted = await host.replaceBinding({ runId: 'run-2', ...compatible });
  assert.equal(accepted.runId, 'run-2');
  assert.equal(accepted.bindingRevision, 'r2');
  assert.equal(accepted.sourceSha256, before.sourceSha256);
  assert.equal(accepted.bytecodeSha256, before.bytecodeSha256);
  assert.equal(accepted.latest, null);
  assert.throws(() => host.step(frame('r1', 2600, sample('r1', 'sensor-a', 1, 4, 2600, 90))), /stale binding revision/);
  assert.throws(() => host.step(frame('r2', 2600, sample('r1', 'sensor-a', 1, 4, 2600, 90))), /stale sample binding revision/);
  assert.throws(() => host.step(frame('r2', 2600, sample('r2', 'sensor-a', 2, 1, 2600, 90))), /sample endpoint mismatch/);
  const fresh = host.step(frame('r2', 2600));
  assert.equal(fresh.sensors.reading.quality, 'NotReady');
  assert.equal(fresh.vm.safe.active, false, 'old latched state is not carried into a new run');
  assert.equal(fresh.identity.bindingRevision, 'r2');
  fresh.sensors.reading.quality = 'Good';
  assert.equal(host.snapshot().latest.sensors.reading.quality, 'NotReady', 'outcome is detached from caller mutation');
  for (const id of [1, 2, 3]) {
    const result = host.step(frame('r2', 2600 + id * 100,
      sample('r2', 'sensor-b', 2, id, 2600 + id * 100, 90)));
    assert.equal(result.sensors.reading.quality, id === 3 ? 'Good' : 'NotReady');
  }
  assert.equal(host.snapshot().latest.vm.safe.active, true);
  assert.equal(host.step(frame('r2', 6000)).sensors.reading.quality, 'Stale');
});

test('v2 sensor declarations reject missing or false timing, unit, range and quality promises', () => {
  const errors = c => validateIntegration({ ...c, artifacts: { source: document, module: artifact.bytes,
    manifest: artifact.manifest } }).errors;
  const variants = [
    [c => { delete c.boardProfile.endpoints['sensor-a'].sensor; }, 'shape'],
    [c => { c.boardProfile.endpoints['sensor-a'].sensor.format = 'other'; }, 'sensor_contract_mismatch'],
    [c => { c.boardProfile.endpoints['sensor-a'].sensor.canonicalUnit = 'C'; }, 'unit_mismatch'],
    [c => { c.boardProfile.endpoints['sensor-a'].sensor.minValue = 10; }, 'sensor_range'],
    [c => { c.boardProfile.endpoints['sensor-a'].sensor.maxInterSampleGapMs = 3000; }, 'sample_gap'],
  ];
  for (const [change, expected] of variants) {
    const c = candidate('r1', 'sensor-a', 2000);
    change(c); repin(c);
    assert.ok(errors(c).some(error => error.code === expected), JSON.stringify(errors(c)));
  }
});

test('pure integration validation rejects missing, nonfinite, and reversed Program Number ranges', () => {
  const variants = [
    { name: 'missing minimum', change: sensor => { delete sensor.validMin; }, code: 'sensor_contract_missing' },
    { name: 'missing maximum', change: sensor => { delete sensor.validMax; }, code: 'sensor_contract_missing' },
    { name: 'NaN minimum', change: sensor => { sensor.validMin = NaN; }, code: 'shape' },
    { name: 'infinite maximum', change: sensor => { sensor.validMax = Infinity; }, code: 'shape' },
    { name: 'reversed endpoints', change: sensor => { sensor.validMin = 100; sensor.validMax = 0; }, code: 'sensor_range' },
  ];
  for (const { name, change, code } of variants) {
    const manifest = structuredClone(artifact.manifest);
    change(manifest.sensors[0]);
    const result = validateIntegration({ ...candidate('r1', 'sensor-a', 2000),
      artifacts: { source: document, module: artifact.bytes, manifest } });
    assert.equal(result.valid, false, name);
    assert.ok(result.errors.some(error => error.code === code), `${name}: ${JSON.stringify(result.errors)}`);
  }
});

test('replacement serializes proposals, rejects reused run IDs and disposal wins pending preparation', async () => {
  const host = await InstalledControlHost.instantiate(wasm, artifact, { runId: 'run-1', ...candidate('r1', 'sensor-a', 2000) });
  const next = candidate('r2', 'sensor-b', 2000);
  const pending = host.replaceBinding({ runId: 'run-2', ...next });
  await assert.rejects(host.replaceBinding({ runId: 'run-3', ...candidate('r3', 'sensor-c', 2000) }), /pending/);
  await pending;
  await assert.rejects(host.replaceBinding({ runId: 'run-1', ...candidate('r3', 'sensor-c', 2000) }), /fresh bounded run identity/);
  const later = host.replaceBinding({ runId: 'run-3', ...candidate('r3', 'sensor-c', 2000) });
  host.dispose();
  await assert.rejects(later, /disposed during preparation/);
});

test('source verification and v2 installation are mandatory before runtime admission', async () => {
  const forged = structuredClone(artifact);
  forged.manifest.sensors[0].staleMs = 5000;
  await assert.rejects(InstalledControlHost.instantiate(wasm, forged,
    { runId: 'forged', ...candidate('r1', 'sensor-a', 2000) }), /source, manifest or bytecode differs/);
  const oldProfile = candidate('r1', 'sensor-a', 2000);
  oldProfile.boardProfile.schema = SCHEMAS.profile;
  repin(oldProfile);
  await assert.rejects(InstalledControlHost.instantiate(wasm, artifact,
    { runId: 'v1', ...oldProfile }), /board-profile-v2 is required/);
});

test('a sensor replacement cannot silently change output wiring or unrelated release identity', async t => {
  const host = await InstalledControlHost.instantiate(wasm, artifact,
    { runId: 'run-1', ...candidate('r1', 'sensor-a', 2000) });
  t.after(() => host.dispose());
  const before = host.snapshot();
  const outputChanged = candidate('r2', 'sensor-b', 2000);
  outputChanged.boardProfile.endpoints.relay.address = 'virtual/other-relay';
  repin(outputChanged);
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...outputChanged }), /changes output binding/);
  const firmwareChanged = candidate('r2', 'sensor-b', 2000);
  firmwareChanged.release.device.firmwareSha256 = '2'.repeat(64);
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...firmwareChanged }), /unrelated release/);
  const reusedProfile = candidate('r2', 'sensor-b', 2000);
  reusedProfile.boardProfile.revision = 'r1';
  reusedProfile.installation.boardProfile.revision = 'r1';
  reusedProfile.release.device.boardProfile.revision = 'r1';
  repin(reusedProfile);
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...reusedProfile }), /profile revision cannot change/);
  assert.deepEqual(host.snapshot(), before);
});

test('a rejected board identity or model migration leaves the live run, conditioner and trace intact', async t => {
  const host = await InstalledControlHost.instantiate(wasm, artifact,
    { runId: 'run-1', ...candidate('r1', 'sensor-a', 2000) });
  t.after(() => host.dispose());
  for (const [id, value] of [[1, 10], [2, 80], [3, 90]]) {
    host.step(frame('r1', (id - 1) * 1000,
      sample('r1', 'sensor-a', 1, id, (id - 1) * 1000, value)));
  }
  const before = host.snapshot();
  const changedId = candidate('r2', 'sensor-b', 2000);
  changedId.boardProfile.id = 'another-board';
  changedId.installation.boardProfile.id = changedId.boardProfile.id;
  changedId.release.device.boardProfile.id = changedId.boardProfile.id;
  repin(changedId);
  const changedModel = candidate('r2', 'sensor-b', 2000);
  changedModel.boardProfile.boardModel = 'ANOTHER-BOARD';
  repin(changedModel);
  for (const next of [changedId, changedModel]) {
    await assert.rejects(host.replaceBinding({ runId: 'run-2', ...next }), /changes board identity or model/);
    assert.deepEqual(host.snapshot(), before);
  }
  const continued = host.step(frame('r1', 2500));
  assert.equal(continued.sensors.reading.quality, 'Good');
  assert.equal(continued.vm.safe.active, true);
  assert.equal(continued.identity.runId, 'run-1');
  assert.equal(continued.identity.bindingRevision, 'r1');
});

test('retired binding revisions cannot be revived for queued samples', async t => {
  const host = await InstalledControlHost.instantiate(wasm, artifact,
    { runId: 'run-1', ...candidate('r1', 'sensor-a', 2000) });
  t.after(() => host.dispose());
  await host.replaceBinding({ runId: 'run-2', ...candidate('r2', 'sensor-b', 2000) });
  await host.replaceBinding({ runId: 'run-3', ...candidate('r3', 'sensor-c', 2000) });
  await assert.rejects(host.replaceBinding({ runId: 'run-4', ...candidate('r2', 'sensor-b', 2000) }),
    /unused binding revision required/);
  assert.equal(host.snapshot().bindingRevision, 'r3');
  assert.throws(() => host.step(frame('r2', 100, sample('r2', 'sensor-b', 2, 1, 100, 80))),
    /stale binding revision/);
});

test('Bool and Number fault observations preserve Result quality and never promote placeholder values', async t => {
  const numberHost = await InstalledControlHost.instantiate(wasm, artifact,
    { runId: 'number-fault', ...candidate('r1', 'sensor-a', 2000) });
  t.after(() => numberHost.dispose());
  const fault = numberHost.step(frame('r1', 100,
    sample('r1', 'sensor-a', 1, 1, 100, 0, 'Disconnected')));
  assert.equal(fault.sensors.reading.ok, false);
  assert.equal(fault.sensors.reading.quality, 'Disconnected');
  assert.equal(fault.vm.safe.active, false);

  const boolArtifact = compileSourceSync(`# Bool\n\n\`\`\`ghost\ncontrol Switch {
    input flag: Bool { stale_after = 3s; }
    output active: Bool;
    active <- flag |> recover(false);
  }\n\`\`\`\n`, { filename: 'switch.ghost.md' });
  const boolHost = await InstalledControlHost.instantiate(wasm, boolArtifact,
    { runId: 'bool-fault', ...candidate('r1', 'sensor-a', 2000, 'Bool', 'flag') });
  t.after(() => boolHost.dispose());
  const boolFrame = (nowMs, id, value, quality) => ({ bindingRevision: 'r1', nowMs,
    samples: { flag: { bindingRevision: 'r1', endpointId: 'sensor-a',
      sample: { epoch: 1, id, timestampMs: nowMs, value, quality } } } });
  const healthyFalse = boolHost.step(boolFrame(0, 1, false, 'Good'));
  assert.equal(healthyFalse.sensors.flag.ok, true);
  assert.equal(healthyFalse.sensors.flag.value, false);
  const disconnected = boolHost.step(boolFrame(100, 2, false, 'Disconnected'));
  assert.equal(disconnected.sensors.flag.ok, false);
  assert.equal(disconnected.sensors.flag.quality, 'Disconnected');
});
