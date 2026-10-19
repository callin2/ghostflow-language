import { softwareQualityRails } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { compileSource, restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';
import { emitCompletedScanSnapshot, prepareCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = 'tests/fixtures/exact-counter.input-v1.ghost.md';
const identity = { documentId: 'source.fixture-exact-counter', revisionId: 'revision.fixture-exact-counter-input-v1' };
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function compileFixture() {
  return compileSource(read(sourcePath), { filename: sourcePath, interactionSourceIdentity: identity });
}

test('GF-TEST-interaction-counter-schema: authored metadata alone classifies an Int state as a counter', async t => {
  const artifact = await compileFixture();
  assert.deepEqual(artifact.interactionSchema.descriptors.map(descriptor => ({
    id: descriptor.id,
    kind: descriptor.kind,
    sourceType: descriptor.sourceType,
    sourceNodeKind: descriptor.provenance.sourceNode.kind,
  })), [
    { id: 'counter.accepted_count', kind: 'counter', sourceType: { kind: 'builtin', name: 'Int', unit: null }, sourceNodeKind: 'state' },
    { id: 'state.exact_sample', kind: 'state', sourceType: { kind: 'builtin', name: 'Int', unit: null }, sourceNodeKind: 'state' },
    { id: 'state.measurement', kind: 'state', sourceType: { kind: 'builtin', name: 'Number', unit: null }, sourceNodeKind: 'state' },
  ]);
  const stateLinks = artifact.traceMetadata.intentLinks.filter(link => link.nodeKind === 'state');
  assert.deepEqual(stateLinks.map(link => link.meaning ?? null), ['counter', null, null]);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-interaction-counter-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const artifactPath = path.join(temporary, 'counter.gfb');
  writeArtifact(artifact, artifactPath);
  const envelope = JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8'));
  assert.deepEqual(
    restoreArtifactSourceMap(envelope, fs.readFileSync(artifactPath)).interactionSchema,
    artifact.interactionSchema,
  );

  const invalidSource = read(sourcePath)
    .replace('relation=implements meaning=counter', 'relation=implements')
    .replace('relation=implements\n  state measurement: Number', 'relation=implements meaning=counter\n  state measurement: Number');
  await assert.rejects(() => compileSource(invalidSource, {
    filename: sourcePath,
    interactionSourceIdentity: identity,
  }), /counter meaning requires Int/);
});

test('GF-TEST-interaction-counter-runtime: completed WASM scans project every i32 boundary exactly', async t => {
  const artifact = await compileFixture();
  const runtime = await FramedGhostFlowRuntime.instantiate(
    fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')),
  );
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  runtime.addCapability('actuator', 'selected_out', 'int');
  runtime.activate();
  const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: 'run.exact-counter-v0' });

  for (const [scanId, value] of [-2147483648, 0, 2147483647].entries()) {
    const outcome = runtime.scan({
      scanId,
      logicalTimeMs: scanId,
      inputs: Object.entries(softwareQualityRails(artifact, { selected: value })).map(([name, value]) => ({ name, type: name === artifact.manifest.sensors[0].valueInput ? 'Int' : typeof value === 'boolean' ? 'Bool' : 'Number', value })),
    });
    const snapshot = emitCompletedScanSnapshot({
      compilation: artifact,
      runId: 'run.exact-counter-v0',
      completion: { kind: 'completed-scan', scanId, logicalTimeMs: scanId },
      trace: outcome.trace,
    });
    assert.deepEqual(producer.emit({ completion: { kind: 'completed-scan', scanId, logicalTimeMs: scanId }, trace: outcome.trace }), snapshot);
    assert.deepEqual(snapshot.observations, [
      { descriptorId: 'counter.accepted_count', status: 'ready', value },
      { descriptorId: 'state.exact_sample', status: 'ready', value },
      { descriptorId: 'state.measurement', status: 'ready', value: 0 },
    ]);
    assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
  }
});

test('GF-TEST-interaction-counter-validation: malformed and lossy counter values fail closed', async () => {
  const artifact = await compileFixture();
  const trace = {
    module: artifact.traceMetadata.moduleFingerprint,
    inputs: { selected: 0 },
    stateAfter: { accepted_count: 0, exact_sample: 0, measurement: 0 },
  };
  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.exact-counter-validation',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    trace,
  });
  for (const value of [1.5, -2147483649, 2147483648]) {
    const candidate = structuredClone(snapshot);
    candidate.observations[0].value = value;
    const result = validateInteraction(artifact.interactionSchema, candidate);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === 'value_type'));
  }
});
