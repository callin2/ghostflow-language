import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const sourcePath = 'contracts/interaction-v0/examples/operator-settings.ghost.md';
const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
const identity = { documentId: 'source.fixture-operator-settings', revisionId: 'revision.fixture-operator-settings-v0' };

async function compileFixture() {
  return compileSource(source, { filename: sourcePath, interactionSourceIdentity: identity });
}

test('GF-TEST-interaction-setting-schema: existing authored config policy emits renderer-neutral settings', async () => {
  const artifact = await compileFixture();
  assert.deepEqual(artifact.interactionSchema.descriptors, [
    {
      id: 'setting.duration', name: 'duration', kind: 'setting',
      sourceType: { kind: 'builtin', name: 'Duration', unit: 'ms' },
      access: ['read'], authority: 'operator', applyPolicy: 'stopped', label: 'Watering duration',
      constraint: { kind: 'range', min: 60000, max: 1200000, step: 60000 },
      provenance: { sourceNode: { id: 2, kind: 'config' }, intentAnchorIds: ['GF-INT-FIXTURE-OPERATOR-SETTINGS-V0'] },
    },
    {
      id: 'setting.duty', name: 'duty', kind: 'setting',
      sourceType: { kind: 'nominal', name: 'Percent', unit: 'percent' },
      access: ['read'], authority: 'designer', applyPolicy: 'stopped', label: 'Duty',
      constraint: { kind: 'range', min: 0, max: 100, step: 10 },
      provenance: { sourceNode: { id: 4, kind: 'config' }, intentAnchorIds: ['GF-INT-FIXTURE-OPERATOR-SETTINGS-V0'] },
    },
    {
      id: 'setting.enabled', name: 'enabled', kind: 'setting',
      sourceType: { kind: 'builtin', name: 'Bool', unit: null },
      access: ['read'], authority: 'operator', applyPolicy: 'stopped', label: 'Enabled',
      constraint: { kind: 'choices', values: [false, true] },
      provenance: { sourceNode: { id: 6, kind: 'config' }, intentAnchorIds: ['GF-INT-FIXTURE-OPERATOR-SETTINGS-V0'] },
    },
  ]);
});

test('GF-TEST-interaction-setting-snapshot: completed projection uses compiled manifest values', async () => {
  const artifact = await compileFixture();
  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.operator-settings-v0',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    trace: { module: artifact.traceMetadata.moduleFingerprint, inputs: {}, stateAfter: {} },
  });
  assert.deepEqual(snapshot.observations, [
    { descriptorId: 'setting.duration', status: 'ready', value: 300000 },
    { descriptorId: 'setting.duty', status: 'ready', value: 50 },
    { descriptorId: 'setting.enabled', status: 'ready', value: false },
  ]);
  assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
});

test('GF-TEST-interaction-setting-rejection: policy shape and snapshot values fail closed', async () => {
  const artifact = await compileFixture();
  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.operator-settings-rejection',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    trace: { module: artifact.traceMetadata.moduleFingerprint, inputs: {}, stateAfter: {} },
  });
  for (const mutate of [
    schema => { schema.descriptors[0].access = ['read', 'write']; },
    schema => { schema.descriptors[0].authority = 'viewer'; },
    schema => { schema.descriptors[0].applyPolicy = 'running'; },
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
