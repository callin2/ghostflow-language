import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { interactionSchemaSha256, validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtureSourcePath = 'contracts/interaction-v0/examples/five-minute-watering.ghost.md';
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const schema = read('contracts/interaction-v0/examples/five-minute-watering.schema.json');
const snapshot = read('contracts/interaction-v0/examples/five-minute-watering.snapshot.json');
const scanTape = read('contracts/interaction-v0/examples/five-minute-watering.scan-tape.json');
const clone = value => structuredClone(value);

function validate(candidateSchema = schema, candidateSnapshot = snapshot, options) {
  return validateInteraction(candidateSchema, candidateSnapshot, options);
}

function expectInvalid(mutate, code) {
  const candidateSchema = clone(schema);
  const candidateSnapshot = clone(snapshot);
  mutate(candidateSchema, candidateSnapshot);
  const result = validate(candidateSchema, candidateSnapshot);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(entry => entry.code === code), `${code}: ${JSON.stringify(result.errors)}`);
}

test('GF-TEST-interaction-v0: fixture binds exact static semantics to one completed run', () => {
  assert.equal(snapshot.schema.sha256, interactionSchemaSha256(schema));
  const result = validate();
  assert.deepEqual(result, { valid: true, errors: [], join: { status: 'ready', staleReasons: [] } });
  assert.deepEqual(validate(schema, snapshot, { expected: {
    schemaFormat: schema.format,
    schemaVersion: schema.version,
    schemaSha256: snapshot.schema.sha256,
    moduleId: schema.module.id,
    moduleFingerprint: schema.module.moduleFingerprint,
    moduleBytecodeSha256: schema.module.bytecodeSha256,
    sourceDocumentId: schema.source.documentId,
    sourceRevisionId: schema.source.revisionId,
    sourceSha256: schema.source.sha256,
    runId: snapshot.runId,
  } }).join, { status: 'ready', staleReasons: [] });
  const unsafe = clone(schema);
  unsafe.descriptors[0].provenance.sourceNode.id = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => interactionSchemaSha256(unsafe), /safe range/);
  assert.equal(canonicalJson({ z: -0, a: ['한글', true] }, {
    rejectSparseArrays: true,
    rejectUnsafeIntegers: true,
  }), '{"a":["한글",true],"z":0}');
  assert.deepEqual(snapshot.observations.map(entry => entry.value), [false, false, 0]);
  assert.deepEqual(schema.descriptors.map(entry => entry.id), [
    'state.request_was_high', 'state.watering', 'timer.age',
  ]);
  assert.deepEqual(schema.descriptors.map(entry => entry.sourceType.name), ['Bool', 'Bool', 'Duration']);
  assert.deepEqual(schema.descriptors.map(entry => entry.kind), ['state', 'state', 'timer']);
  const timer = schema.descriptors.find(entry => entry.id === 'timer.age');
  assert.deepEqual(timer.operation, { kind: 'elapsed_since_change', subjectId: 'state.watering' });
  assert.deepEqual(snapshot.completion, { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 });
});

test('GF-TEST-interaction-v0-empty: an identified stateless module has an exact empty snapshot', () => {
  const emptySchema = clone(schema);
  emptySchema.module.id = 'DirectOutput';
  emptySchema.source.documentId = 'source.direct-output';
  emptySchema.source.revisionId = 'revision.direct-output.1';
  emptySchema.descriptors = [];
  const emptySnapshot = clone(snapshot);
  emptySnapshot.schema.sha256 = interactionSchemaSha256(emptySchema);
  emptySnapshot.module = clone(emptySchema.module);
  emptySnapshot.source = clone(emptySchema.source);
  emptySnapshot.runId = 'run.direct-output.1';
  emptySnapshot.observations = [];

  assert.deepEqual(validate(emptySchema, emptySnapshot), {
    valid: true,
    errors: [],
    join: { status: 'ready', staleReasons: [] },
  });

  const unexpected = clone(emptySnapshot);
  unexpected.observations.push({ descriptorId: 'state.invented', status: 'ready', value: false });
  const result = validate(emptySchema, unexpected);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(entry => entry.code === 'unknown_descriptor'));
});

test('GF-TEST-interaction-enum-members: accepts declared ordinals and rejects malformed maps and values', () => {
  const enumSchema = clone(schema);
  enumSchema.descriptors[0].sourceType = { kind: 'nominal', name: 'Phase', unit: null,
    enumMembers: [{ name: 'Idle', value: 0 }, { name: 'Running', value: 1 }] };
  const enumSnapshot = clone(snapshot);
  enumSnapshot.schema.sha256 = interactionSchemaSha256(enumSchema);
  enumSnapshot.observations[0].value = 1;
  assert.equal(validate(enumSchema, enumSnapshot).valid, true);
  const underscored = clone(enumSchema);
  underscored.descriptors[0].sourceType.enumMembers[0].name = '_Idle';
  const underscoredSnapshot = clone(enumSnapshot);
  underscoredSnapshot.schema.sha256 = interactionSchemaSha256(underscored);
  assert.equal(validate(underscored, underscoredSnapshot).valid, true);
  for (const members of [[], [{ name: 'Idle', value: 1 }],
    [{ name: 'Idle', value: 0 }, { name: 'Idle', value: 1 }],
    [{ name: 'Idle', value: 0, extra: true }]]) {
    const candidate = clone(enumSchema);
    candidate.descriptors[0].sourceType.enumMembers = members;
    const candidateSnapshot = clone(enumSnapshot);
    candidateSnapshot.schema.sha256 = interactionSchemaSha256(candidate);
    assert.equal(validate(candidate, candidateSnapshot).valid, false);
  }
  for (const value of [-1, 2, 1.5, 'Running', false]) {
    const candidate = clone(enumSnapshot);
    candidate.observations[0].value = value;
    assert.ok(validate(enumSchema, candidate).errors.some(entry => entry.code === 'value_type'));
  }
});

test('GF-TEST-interaction-v0-fixture: static source and module identities match the checked-in literate fixture', async () => {
  const source = fs.readFileSync(path.join(root, fixtureSourcePath), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), schema.source.sha256);
  assert.equal(Object.hasOwn(schema.source, 'path'), false);
  assert.equal(Object.hasOwn(schema.source, 'id'), false);
  const compiled = await compileSource(source, { filename: fixtureSourcePath });
  assert.equal(compiled.traceMetadata.moduleFingerprint, schema.module.moduleFingerprint);
  assert.equal(compiled.manifest.bytecodeSha256, schema.module.bytecodeSha256);
  assert.equal(compiled.traceMetadata.bytecodeSha256, schema.module.bytecodeSha256);
  const nodes = new Map(compiled.sourceMap.map(node => [node.id, node]));
  const links = new Set(compiled.traceMetadata.intentLinks.map(link => `${link.anchorId}:${link.nodeId}:${link.nodeKind}`));
  for (const descriptor of schema.descriptors) {
    assert.equal(nodes.get(descriptor.provenance.sourceNode.id)?.kind, descriptor.kind);
    for (const anchorId of descriptor.provenance.intentAnchorIds) {
      assert.equal(links.has(`${anchorId}:${descriptor.provenance.sourceNode.id}:${descriptor.kind}`), true);
    }
  }
});

test('GF-TEST-interaction-v0-status: unavailable and error are explicit, while stale is an expected-identity join result', () => {
  const unavailableExpectation = scanTape.observationExpectations.find(entry => entry.status === 'unavailable');
  assert.ok(unavailableExpectation, 'the test-only absence case is explicit corpus metadata');
  // This is an in-memory validator input only; it is never persisted as runtime evidence.
  const validatorInput = clone(snapshot);
  validatorInput.observations = validatorInput.observations.map(entry => entry.descriptorId === unavailableExpectation.descriptorId
    ? { descriptorId: entry.descriptorId, status: unavailableExpectation.status, reason: unavailableExpectation.reason }
    : entry);
  validatorInput.observations[1] = { descriptorId: 'state.watering', status: 'error', error: 'runtime-value-invalid' };
  assert.equal(validate(schema, validatorInput).valid, true);

  const stale = validate(schema, snapshot, { expected: { sourceSha256: '0'.repeat(64), runId: 'earlier-run' } });
  assert.deepEqual(stale, {
    valid: true,
    errors: [],
    join: { status: 'stale', staleReasons: ['source.sha256', 'runId'] },
  });
  const reset = clone(snapshot);
  reset.runId = 'fixture-run-after-reset';
  reset.completion.scanId = 0;
  assert.deepEqual(validate(schema, reset, { expected: { runId: snapshot.runId } }).join, {
    status: 'stale', staleReasons: ['runId'],
  });
  expectInvalid((_schema, candidate) => { candidate.observations[0].status = 'stale'; }, 'observation_status');
});

test('GF-TEST-interaction-v0-identity-join: every expected identity field is checked and scanId is run-local only', () => {
  const expected = {
    schemaFormat: schema.format,
    schemaVersion: schema.version,
    schemaSha256: snapshot.schema.sha256,
    moduleId: schema.module.id,
    moduleFingerprint: schema.module.moduleFingerprint,
    moduleBytecodeSha256: schema.module.bytecodeSha256,
    sourceDocumentId: schema.source.documentId,
    sourceRevisionId: schema.source.revisionId,
    sourceSha256: schema.source.sha256,
    runId: snapshot.runId,
  };
  const mismatchCases = [
    ['schemaFormat', 'GhostFlow/interaction-schema-v9', 'schema.format'],
    ['schemaVersion', '9.9', 'schema.version'],
    ['schemaSha256', '0'.repeat(64), 'schema.sha256'],
    ['moduleId', 'DifferentModule', 'module.id'],
    ['moduleFingerprint', '0'.repeat(16), 'module.moduleFingerprint'],
    ['moduleBytecodeSha256', '0'.repeat(64), 'module.bytecodeSha256'],
    ['sourceDocumentId', 'source.other-document', 'source.documentId'],
    ['sourceRevisionId', 'revision.other', 'source.revisionId'],
    ['sourceSha256', '0'.repeat(64), 'source.sha256'],
    ['runId', 'different-run', 'runId'],
  ];
  for (const [field, value, reason] of mismatchCases) {
    const result = validate(schema, snapshot, { expected: { ...expected, [field]: value } });
    assert.equal(result.valid, true);
    assert.deepEqual(result.join, { status: 'stale', staleReasons: [reason] });
  }
  const laterScan = clone(snapshot);
  laterScan.completion.scanId = 42;
  assert.deepEqual(validate(schema, laterScan, { expected }).join, { status: 'ready', staleReasons: [] });
});

test('GF-TEST-interaction-v0-rejection: rejects unknown fields, mismatched identities, generated names, and silent coverage gaps', () => {
  expectInvalid((_schema, candidate) => { candidate.extra = true; }, 'unknown_field');
  for (const mutate of [
    (_schema, candidate) => { candidate.schema.format = 'GhostFlow/interaction-schema-v9'; },
    (_schema, candidate) => { candidate.schema.version = '9.9'; },
    (_schema, candidate) => { candidate.schema.sha256 = '0'.repeat(64); },
    (_schema, candidate) => { candidate.module.id = 'DifferentModule'; },
    (_schema, candidate) => { candidate.module.moduleFingerprint = '0'.repeat(16); },
    (_schema, candidate) => { candidate.module.bytecodeSha256 = '0'.repeat(64); },
    (_schema, candidate) => { candidate.source.documentId = 'source.other-document'; },
    (_schema, candidate) => { candidate.source.revisionId = 'revision.other'; },
    (_schema, candidate) => { candidate.source.sha256 = '0'.repeat(64); },
  ]) expectInvalid(mutate, 'identity_mismatch');
  expectInvalid((candidate) => { candidate.descriptors[0].id = '__gf_state_pressure'; }, 'public_identity');
  expectInvalid((_schema, candidate) => { candidate.observations.pop(); }, 'missing_observation');
  for (const kind of ['input', 'command']) {
    expectInvalid((candidate) => { candidate.descriptors[0].kind = kind; }, 'descriptor_kind');
  }
  expectInvalid((candidate) => { candidate.source.kind = 'plain'; }, 'source_kind');
  for (const access of [['write'], ['execute'], ['read', 'write'], ['read', 'read']]) {
    expectInvalid((candidate) => { candidate.descriptors[0].access = access; }, 'access');
  }
  expectInvalid((candidate) => { candidate.descriptors[2].operation.subjectId = 'state.unknown'; }, 'timer_subject');
  expectInvalid((candidate) => { candidate.descriptors[2].operation.subjectId = 'timer.age'; }, 'timer_subject');
  expectInvalid((_schema, candidate) => { candidate.completion.kind = 'completed-tick'; }, 'completion');
});
