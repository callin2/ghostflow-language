import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { interactionSchemaSha256, validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const schema = read('contracts/interaction-v0/examples/five-minute-watering.schema.json');
const snapshot = read('contracts/interaction-v0/examples/five-minute-watering.snapshot.json');
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
  assert.deepEqual(snapshot.observations.map(entry => entry.value), [0, 0, false, 0]);
  assert.deepEqual(schema.descriptors.map(entry => entry.sourceType.name), ['Number', 'Percent', 'Bool', 'Duration']);
  const timer = schema.descriptors.find(entry => entry.id === 'timer.age');
  assert.deepEqual(timer.operation, { kind: 'elapsed_since_change', subjectId: 'state.watering' });
});

test('GF-TEST-interaction-v0-fixture: static source and module identities match the checked-in literate fixture', async () => {
  const relative = schema.source.path;
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), schema.source.sha256);
  const compiled = await compileSource(source, { filename: relative });
  assert.equal(createHash('sha256').update(compiled.bytes).digest('hex'), schema.module.sha256);
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
  const unavailable = clone(snapshot);
  unavailable.observations[0] = { descriptorId: 'input.pressure', status: 'unavailable', reason: 'adapter-not-configured' };
  unavailable.observations[1] = { descriptorId: 'input.moisture', status: 'error', error: 'sample-decode-failed' };
  assert.equal(validate(schema, unavailable).valid, true);

  const stale = validate(schema, snapshot, { expected: { sourceSha256: '0'.repeat(64), runId: 'earlier-run' } });
  assert.deepEqual(stale, {
    valid: true,
    errors: [],
    join: { status: 'stale', staleReasons: ['source.sha256', 'runId'] },
  });
  expectInvalid((_schema, candidate) => { candidate.observations[0].status = 'stale'; }, 'observation_status');
});

test('GF-TEST-interaction-v0-rejection: rejects unknown fields, mismatched identities, generated names, and silent coverage gaps', () => {
  expectInvalid((_schema, candidate) => { candidate.extra = true; }, 'unknown_field');
  expectInvalid((_schema, candidate) => { candidate.module.sha256 = '0'.repeat(64); }, 'identity_mismatch');
  expectInvalid((_schema, candidate) => { candidate.source.sha256 = '0'.repeat(64); }, 'identity_mismatch');
  expectInvalid((candidate) => { candidate.descriptors[0].id = '__gf_input_pressure'; }, 'public_identity');
  expectInvalid((_schema, candidate) => { candidate.observations.pop(); }, 'missing_observation');
  expectInvalid((_schema, candidate) => { candidate.schema.sha256 = '0'.repeat(64); }, 'identity_mismatch');
});
