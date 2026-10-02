import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { emitCompletedScanSnapshot, prepareCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'contracts/interaction-v0/examples/operator-settings.ghost.md';
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
const identity = { documentId: 'source.fixture-operator-settings', revisionId: 'revision.fixture-operator-settings-v0' };

async function compileFixture() {
  return compileSource(source, { filename: sourcePath, interactionSourceIdentity: identity });
}

async function completedScan(artifact) {
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const runtime = await ControlRuntime.instantiate(wasm, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    const outcome = runtime.step({ nowMs: 0, contextFacts: {
      clock: { monotonicMs: 0, bootEpoch: 1, wallMs: 0, uncertaintyMs: 0,
        trusted: true, unknownReason: null, sourceRevision: 'interaction-clock-v1' },
      natural: [], schedules: [], settings: null,
    } });
    return { trace: outcome.vm, settingsState: runtime.contextSnapshot().state };
  } finally { runtime.dispose(); }
}

test('GF-TEST-interaction-setting-schema: existing authored config policy emits renderer-neutral settings', async () => {
  const artifact = await compileFixture();
  assert.deepEqual(artifact.interactionSchema.descriptors, [
    {
      id: 'setting.duration', name: 'duration', kind: 'setting',
      sourceType: { kind: 'builtin', name: 'Duration', unit: 'ms' },
      access: ['read'], authority: 'operator', applyPolicy: 'live', label: 'Watering duration',
      defaultValue: 300000,
      constraint: { kind: 'range', min: 60000, max: 1200000, step: 60000 },
      provenance: { sourceNode: { id: 2, kind: 'config' }, intentAnchorIds: ['GF-INT-FIXTURE-OPERATOR-SETTINGS-V0'] },
    },
    {
      id: 'setting.duty', name: 'duty', kind: 'setting',
      sourceType: { kind: 'nominal', name: 'Percent', unit: 'percent' },
      access: ['read'], authority: 'designer', applyPolicy: 'live', label: 'Duty',
      defaultValue: 50,
      constraint: { kind: 'range', min: 0, max: 100, step: 10 },
      provenance: { sourceNode: { id: 4, kind: 'config' }, intentAnchorIds: ['GF-INT-FIXTURE-OPERATOR-SETTINGS-V0'] },
    },
    {
      id: 'setting.enabled', name: 'enabled', kind: 'setting',
      sourceType: { kind: 'builtin', name: 'Bool', unit: null },
      access: ['read'], authority: 'operator', applyPolicy: 'live', label: 'Enabled',
      defaultValue: false,
      constraint: { kind: 'choices', values: [false, true] },
      provenance: { sourceNode: { id: 6, kind: 'config' }, intentAnchorIds: ['GF-INT-FIXTURE-OPERATOR-SETTINGS-V0'] },
    },
  ]);
});

test('GF-TEST-interaction-setting-snapshot: completed projection uses current Rust Result values', async () => {
  const artifact = await compileFixture();
  const completed = await completedScan(artifact);
  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.operator-settings-v0',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    ...completed,
  });
  const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: 'run.operator-settings-v0' });
  const request = { completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 }, ...completed };
  assert.deepEqual(producer.emit(request), snapshot);
  for (let scan = 0; scan < 3; scan++) {
    assert.throws(() => producer.emit({ completion: request.completion, trace: completed.trace }), /current Rust settings state/);
    for (const mutate of [
      state => { state.programFingerprint = '0'.repeat(16); },
      state => { state.settingsRevision = -1; },
      state => { state.settings[0].id = -1; },
      state => { state.settings[0].result = { ok: false, fault: 'invented' }; },
      state => { state.settings[0].result = { ok: true }; },
    ]) {
      const settingsState = structuredClone(completed.settingsState);
      mutate(settingsState);
      assert.throws(() => producer.emit({ ...request, settingsState }));
    }
  }
  const wrongType = structuredClone(completed.settingsState);
  wrongType.settings[0].result.value = 0.5;
  assert.throws(() => producer.emit({ ...request, settingsState: wrongType }), /contract validation|type-mismatch|Result mismatch/);
  assert.deepEqual(snapshot.observations, [
    { descriptorId: 'setting.duration', defaultValue: 300000, emissionRevision: 0, applicationPosition: null, override: false, status: 'ready', value: 300000 },
    { descriptorId: 'setting.duty', defaultValue: 50, emissionRevision: 0, applicationPosition: null, override: false, status: 'ready', value: 50 },
    { descriptorId: 'setting.enabled', defaultValue: false, emissionRevision: 0, applicationPosition: null, override: false, status: 'ready', value: false },
  ]);
  assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
  assert.throws(() => emitCompletedScanSnapshot({
    compilation: artifact, runId: 'run.missing-settings',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 }, trace: completed.trace,
  }), /current Rust settings state is required/);
  artifact.manifest.configs[0].name = 'changed';
  assert.deepEqual(producer.emit(request), snapshot, 'prepared config descriptors are privately owned');
});

test('GF-TEST-interaction-setting-error: current fault rail is visible without manifest fallback', async () => {
  const artifact = await compileFixture();
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const runtime = await ControlRuntime.instantiate(wasm, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    const fingerprint = runtime.contextSnapshot().state.programFingerprint;
    const outcome = runtime.step({ nowMs: 1, contextFacts: {
      clock: { monotonicMs: 1, bootEpoch: 1, wallMs: 1, uncertaintyMs: 0,
        trusted: true, unknownReason: null, sourceRevision: 'interaction-clock-v1' },
      natural: [], schedules: [], settings: {
        programFingerprint: fingerprint, eventId: 'duration-unavailable', baseRevision: 0,
        position: 1, origin: 'producerObservation',
        changes: [{ configId: 2, result: { ok: false, fault: 'SettingsUnavailable' } }],
      },
    } });
    const snapshot = emitCompletedScanSnapshot({ compilation: artifact,
      runId: 'run.operator-settings-fault', completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 1 },
      trace: outcome.vm, settingsState: runtime.contextSnapshot().state });
    const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: 'run.operator-settings-fault' });
    assert.deepEqual(producer.emit({ completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 1 }, trace: outcome.vm, settingsState: runtime.contextSnapshot().state }), snapshot);
    assert.deepEqual(snapshot.observations[0], {
      descriptorId: 'setting.duration', defaultValue: 300000, emissionRevision: 1, applicationPosition: 1,
      status: 'error', error: 'SettingsUnavailable',
    });
    assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
  } finally { runtime.dispose(); }
});

test('GF-TEST-interaction-setting-rejection: policy shape and snapshot values fail closed', async () => {
  const artifact = await compileFixture();
  const completed = await completedScan(artifact);
  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.operator-settings-rejection',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    ...completed,
  });
  for (const mutate of [
    schema => { schema.descriptors[0].access = ['read', 'write']; },
    schema => { schema.descriptors[0].authority = 'viewer'; },
    schema => { schema.descriptors[0].applyPolicy = 'stopped'; },
    schema => { schema.descriptors[0].constraint.step = 0; },
  ]) {
    const schema = structuredClone(artifact.interactionSchema);
    const candidate = structuredClone(snapshot);
    mutate(schema);
    candidate.schema.sha256 = '0'.repeat(64);
    assert.equal(validateInteraction(schema, candidate).valid, false);
  }
  const lossy = structuredClone(snapshot);
  lossy.observations[0].value = 300000.5;
  assert.equal(validateInteraction(artifact.interactionSchema, lossy).valid, false);

  const plain = await compileSource(source.replace(
    'config enabled: Bool = false { access = operator; label = "Enabled"; }',
    'config enabled: Bool = false;',
  ), { filename: sourcePath, interactionSourceIdentity: identity });
  assert.equal(plain.interactionSchema.descriptors.some(descriptor => descriptor.name === 'enabled'), false);
});
