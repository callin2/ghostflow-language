import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { interactionSchemaSha256 } from '../contracts/interaction-v0/validate.mjs';
import { verifyInteractionCorpus } from '../contracts/interaction-v0/verify-corpus.mjs';
import { compileSource, restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wateringPath = 'contracts/interaction-v0/examples/five-minute-watering.ghost.md';
const multiplePath = 'contracts/interaction-v0/examples/multiple-values.ghost.md';
const enumPhaseAgePath = 'contracts/interaction-v0/examples/enum-phase-age.ghost.md';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));

const wateringIdentity = {
  documentId: 'source.fixture-five-minute-watering',
  revisionId: 'revision.fixture-five-minute-watering-v2',
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

test('GF-TEST-interaction-emission-enum-phase-age: enum state remains nominal and elapsed timer targets it', async () => {
  const identity = {
    documentId: 'source.fixture-enum-phase-age',
    revisionId: 'revision.fixture-enum-phase-age-v0',
  };
  const compilation = await compileSource(read(enumPhaseAgePath), {
    filename: enumPhaseAgePath,
    interactionSourceIdentity: identity,
  });
  const [phase, age] = compilation.interactionSchema.descriptors;
  assert.deepEqual([phase.id, phase.kind, phase.sourceType], [
    'state.phase', 'state', { kind: 'nominal', name: 'Phase', unit: null },
  ]);
  assert.deepEqual([age.id, age.kind, age.sourceType, age.operation], [
    'timer.age', 'timer', { kind: 'builtin', name: 'Duration', unit: 'ms' },
    { kind: 'elapsed_since_change', subjectId: 'state.phase' },
  ]);
  assert.deepEqual(phase.provenance.intentAnchorIds, ['GF-INT-FIXTURE-ENUM-PHASE-AGE-V0']);
  assert.deepEqual(age.provenance.intentAnchorIds, ['GF-INT-FIXTURE-ENUM-PHASE-AGE-V0']);
});

test('GF-TEST-interaction-emission-continuous-true: descriptor and private roles retain the authored Bool subject provenance', async () => {
  const source = `# Continuous true timer

<!-- ghostflow:anchor id=GF-INT-CONTINUOUS-TRUE-V1 kind=intent status=confirmed origin=user -->
The alarm uses one uninterrupted high interval.

\`\`\`ghost
control ContinuousTrueInteraction {
  input hot: Bool;
  output alarm: Bool;
  // ghostflow:link id=GF-INT-CONTINUOUS-TRUE-V1 relation=implements
  timer hot_for = continuous_true(hot);
  alarm <- hot_for >= 5min;
}
\`\`\`
`;
  const compilation = await compileSource(source, {
    filename: 'continuous-true-interaction.ghost.md',
    interactionSourceIdentity: {
      documentId: 'source.continuous-true-interaction',
      revisionId: 'revision.continuous-true-interaction-v1',
    },
  });
  assert.deepEqual(compilation.manifest.timers, [{
    name: 'hot_for', mode: 'continuous-true', clockInput: '__gf_now_ms',
  }]);
  const timer = compilation.interactionSchema.descriptors.find(entry => entry.id === 'timer.hot_for');
  assert.equal(timer.operation.kind, 'continuous_true');
  const subject = compilation.sourceMap.find(node => node.id === timer.operation.subjectNodeId);
  assert.equal(subject?.kind, 'reference');
  assert.deepEqual(compilation.traceMetadata.bindings
    .filter(entry => entry.kind === 'timer')
    .map(entry => [entry.name, entry.generated]), [
      ['__gf_timer_since_hot_for', { declaration: 'hot_for', role: 'since' }],
      ['__gf_timer_was_true_hot_for', { declaration: 'hot_for', role: 'wasTrue' }],
    ]);
  const valueDependency = compilation.traceMetadata.dependencies.find(entry => (
    entry.target.field === 'timerValue' && entry.target.name === 'hot_for'
  ));
  assert.ok(valueDependency.reads.some(read => read.field === 'inputs' && read.name === 'hot'));

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-continuous-timer-'));
  try {
    const artifact = path.join(temporary, 'continuous.gfb');
    writeArtifact(compilation, artifact);
    const bytes = fs.readFileSync(artifact);
    const envelope = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
    assert.equal(restoreArtifactSourceMap(envelope, bytes, {
      manifest: compilation.manifest,
    }).interactionSchema.descriptors[0].operation.kind, 'continuous_true');
    assert.throws(() => restoreArtifactSourceMap(envelope, bytes), /requires its manifest descriptor/);

    const missingDependency = structuredClone(envelope);
    missingDependency.traceMetadata.dependencies = missingDependency.traceMetadata.dependencies.filter(entry => (
      entry.target.field !== 'timerValue' || entry.target.name !== 'hot_for'
    ));
    assert.throws(() => restoreArtifactSourceMap(missingDependency, bytes, {
      manifest: compilation.manifest,
    }), /timer value dependency is missing/);

    const missingConditionRead = structuredClone(envelope);
    const timerValue = missingConditionRead.traceMetadata.dependencies.find(entry => (
      entry.target.field === 'timerValue' && entry.target.name === 'hot_for'
    ));
    timerValue.reads = timerValue.reads.filter(read => read.name !== 'hot');
    assert.throws(() => restoreArtifactSourceMap(missingConditionRead, bytes, {
      manifest: compilation.manifest,
    }), /dependencies do not match canonical source lowering/);

    const wrongSourceMode = structuredClone(envelope);
    wrongSourceMode.nodes.find(node => node.kind === 'timer').timerMode = 'elapsed';
    assert.throws(() => restoreArtifactSourceMap(wrongSourceMode, bytes, {
      manifest: compilation.manifest,
    }), /mode does not match manifest descriptor/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
