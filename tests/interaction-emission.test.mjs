import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { interactionSchemaSha256 } from '../contracts/interaction-v0/validate.mjs';
import { verifyInteractionCorpus } from '../contracts/interaction-v0/verify-corpus.mjs';
import { compileSource, restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const wateringPath = 'contracts/interaction-v0/examples/five-minute-watering.ghost.md';
const multiplePath = 'contracts/interaction-v0/examples/multiple-values.ghost.md';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));

const wateringIdentity = {
  documentId: 'source.fixture-five-minute-watering',
  revisionId: 'revision.fixture-five-minute-watering-v1',
};

const directSource = `# Direct input to output

The pump follows the enable input without authored state or a timer.

\`\`\`ghost
control DirectOutput {
  input enabled: Bool;
  output pump: Bool;
  pump <- enabled;
}
\`\`\`
`;

test('GF-TEST-interaction-emission: canonical literate compilation produces the exact checked-in v0 schema', async () => {
  const expected = readJson('contracts/interaction-v0/examples/five-minute-watering.schema.json');
  const compilation = await compileSource(read(wateringPath), {
    filename: wateringPath,
    interactionSourceIdentity: wateringIdentity,
  });
  assert.deepEqual(compilation.interactionSchema, expected);
  assert.equal(
    interactionSchemaSha256(compilation.interactionSchema),
    readJson('contracts/interaction-v0/examples/five-minute-watering.snapshot.json').schema.sha256,
  );

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-interaction-'));
  try {
    const artifact = path.join(temporary, 'watering.gfb');
    writeArtifact(compilation, artifact);
    const envelope = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
    assert.deepEqual(envelope.interactionSchema, expected);
    assert.deepEqual(envelope.interactionSourceIdentity, wateringIdentity);
    assert.deepEqual(restoreArtifactSourceMap(envelope, fs.readFileSync(artifact)).interactionSchema, expected);

    const tampered = structuredClone(envelope);
    tampered.interactionSchema.source.revisionId = 'revision.tampered';
    assert.throws(() => restoreArtifactSourceMap(tampered, fs.readFileSync(artifact)), /interaction schema source identity does not match/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('GF-TEST-interaction-emission-policy: product compilation is literate-only and identity is caller-supplied', async () => {
  const source = read(wateringPath);
  const noEmission = await compileSource(source, { filename: wateringPath });
  assert.equal(noEmission.interactionSchema, null);
  await assert.rejects(
    () => compileSource(source, { filename: wateringPath, interactionSourceIdentity: {} }),
    /source identity must contain exactly documentId and revisionId/,
  );
  await assert.rejects(
    () => compileSource(source, { filename: wateringPath, interactionSchema: wateringIdentity }),
    /interactionSchema is not a compile option/,
  );
  await assert.rejects(
    () => compileSource('control Plain { output pump: Bool; pump <- false; }', { filename: 'plain.ghost' }),
    /requires a canonical \.ghost\.md literate source/,
  );
  await assert.rejects(
    () => compileSource('control Plain { output pump: Bool; pump <- false; }', {
      filename: 'plain.ghost', interactionSourceIdentity: wateringIdentity,
    }),
    /requires a canonical \.ghost\.md literate source/,
  );
});

test('GF-TEST-interaction-emission-empty: stateless literate control emits an identified empty schema', async () => {
  const identity = {
    documentId: 'source.direct-output',
    revisionId: 'revision.direct-output.1',
  };
  const compilation = await compileSource(directSource, {
    filename: 'direct-output.ghost.md',
    interactionSourceIdentity: identity,
  });

  assert.deepEqual(compilation.interactionSchema.descriptors, []);
  assert.equal(compilation.interactionSchema.module.id, 'DirectOutput');
  assert.deepEqual(compilation.interactionSchema.source, {
    ...identity,
    format: 'GhostFlow/source-document-v1',
    kind: 'literate',
    sha256: compilation.sourceDocument.sha256,
  });
});

test('GF-TEST-interaction-emission-descriptors: all authored states and timers retain parsed semantic types and anchors', async () => {
  const corpus = readJson('contracts/interaction-v0/examples/corpus.json');
  const fixture = corpus.cases.find(entry => entry.sourcePath === multiplePath);
  const compilation = await compileSource(read(multiplePath), {
    filename: multiplePath,
    interactionSourceIdentity: { documentId: fixture.source.documentId, revisionId: fixture.source.revisionId },
  });
  assert.deepEqual(compilation.interactionSchema.descriptors.map(entry => [entry.id, entry.kind, entry.sourceType, entry.access]), [
    ['state.first_active', 'state', { kind: 'builtin', name: 'Bool', unit: null }, ['read']],
    ['state.second_active', 'state', { kind: 'builtin', name: 'Bool', unit: null }, ['read']],
    ['state.quantity', 'state', { kind: 'builtin', name: 'Number', unit: null }, ['read']],
    ['state.moisture', 'state', { kind: 'nominal', name: 'Percent', unit: 'percent' }, ['read']],
    ['timer.first_age', 'timer', { kind: 'builtin', name: 'Duration', unit: 'ms' }, ['read']],
    ['timer.second_age', 'timer', { kind: 'builtin', name: 'Duration', unit: 'ms' }, ['read']],
  ]);
  assert.deepEqual(compilation.interactionSchema.descriptors.slice(-2).map(entry => entry.operation.subjectId), [
    'state.first_active', 'state.second_active',
  ]);
  assert.ok(compilation.interactionSchema.descriptors.every(entry => entry.provenance.intentAnchorIds.length === 1));
  await verifyInteractionCorpus();
});
