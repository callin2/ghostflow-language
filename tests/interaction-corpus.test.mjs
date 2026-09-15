import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { verifyInteractionCorpus } from '../contracts/interaction-v0/verify-corpus.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const corpusPath = 'contracts/interaction-v0/examples/corpus.json';
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const corpus = read(corpusPath);
const clone = value => structuredClone(value);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resealTape(tape) {
  const unsigned = clone(tape);
  delete unsigned.digest;
  tape.digest.sha256 = sha256(canonicalJson(unsigned, {
    rejectSparseArrays: true,
    rejectUnsafeIntegers: true,
  }));
}

async function rejectTapeMutation(caseId, mutate, expectedError) {
  const candidateCorpus = clone(corpus);
  const fixture = candidateCorpus.cases.find(entry => entry.caseId === caseId);
  const tape = read(fixture.tapePath);
  mutate(tape, fixture);
  resealTape(tape);
  const tapeText = JSON.stringify(tape);
  await assert.rejects(() => verifyInteractionCorpus({
    root,
    corpus: candidateCorpus,
    readFile: relative => relative === fixture.tapePath ? Buffer.from(tapeText) : fs.readFileSync(path.join(root, relative)),
  }), expectedError);
}

test('GF-TEST-interaction-corpus: pins literate revisions, compiler identities and complete reusable scan tapes', async () => {
  const result = await verifyInteractionCorpus();
  assert.equal(result.format, 'GhostFlow/verified-interaction-corpus-v1');
  assert.deepEqual(result.cases.map(entry => entry.caseId), ['five-minute-watering', 'multiple-values']);
  for (const entry of result.cases) {
    assert.equal(entry.canonicalSourceKind, 'literate');
    assert.match(entry.sourcePath, /\.ghost\.md$/);
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(entry.moduleFingerprint, /^[a-f0-9]{16}$/);
    assert.match(entry.bytecodeSha256, /^[a-f0-9]{64}$/);
    assert.match(entry.tapeSha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.runIds.length, 2);
    assert.equal(entry.scanCount, 5);
  }

  const firstTape = read(corpus.cases[0].tapePath);
  const resetScans = firstTape.runs.map(run => run.scans[0].completion.scanId);
  assert.deepEqual(resetScans, [0, 0]);
  assert.notEqual(firstTape.runs[0].runId, firstTape.runs[1].runId);
  assert.ok(firstTape.runs.flatMap(run => run.scans).some(scan => scan.inputs.some(input => input.value === false)));
  const secondTape = read(corpus.cases[1].tapePath);
  assert.ok(secondTape.runs.flatMap(run => run.scans).some(scan => scan.inputs.some(input => input.name === 'sample' && input.value === 0)));
  assert.deepEqual(firstTape.observationExpectations.map(({ status }) => status), ['unavailable']);
  assert.ok(read('contracts/interaction-v0/examples/five-minute-watering.snapshot.json').observations.every(entry => entry.status !== 'unavailable'));
});

test('GF-TEST-interaction-corpus-multiple-values: compiles two typed states/timers, Number and nominal Percent from one literate file', async () => {
  const fixture = corpus.cases.find(entry => entry.caseId === 'multiple-values');
  assert.ok(fixture);
  assert.equal(fixture.sourcePath.endsWith('.ghost.md'), true);
  assert.equal(fs.existsSync(path.join(root, 'contracts/interaction-v0/examples/multiple-values.ghost')), false);
  const source = fs.readFileSync(path.join(root, fixture.sourcePath), 'utf8');
  const compiled = await compileSource(source, { filename: fixture.sourcePath });
  assert.equal(compiled.sourceDocument.kind, 'literate');
  assert.equal(compiled.sourceMap.filter(node => node.kind === 'state').length, 4);
  assert.equal(compiled.sourceMap.filter(node => node.kind === 'timer').length, 2);
  for (const declaration of [
    'state first_active: Bool = false;',
    'state second_active: Bool = false;',
    'state quantity: Number = 0;',
    'state moisture: Percent = 0%;',
    'timer first_age = elapsed(first_active);',
    'timer second_age = elapsed(second_active);',
  ]) assert.ok(source.includes(declaration), `missing authored declaration: ${declaration}`);
  const sourceNodes = new Map(compiled.sourceMap.map(node => [node.id, node]));
  const linkedNodes = new Set(compiled.traceMetadata.intentLinks.map(link => `${link.nodeId}:${link.nodeKind}`));
  for (const node of compiled.sourceMap.filter(entry => entry.kind === 'state' || entry.kind === 'timer')) {
    assert.equal(linkedNodes.has(`${node.id}:${node.kind}`), true);
    assert.equal(sourceNodes.get(node.id)?.filename, fixture.sourcePath);
  }
});

test('GF-TEST-interaction-corpus-rejections: rejects tampered identities, unknown fields, incomplete inputs and invalid run order', async () => {
  await rejectTapeMutation('five-minute-watering', tape => { tape.source.revisionId = 'revision.other'; }, /source\.revisionId does not match/);
  await rejectTapeMutation('five-minute-watering', tape => { tape.source.sha256 = '0'.repeat(64); }, /source\.sha256 does not match/);
  await rejectTapeMutation('five-minute-watering', tape => { tape.extra = true; }, /unknown: extra/);
  await rejectTapeMutation('five-minute-watering', tape => { tape.observationExpectations[0].runtimeValue = false; }, /unknown: runtimeValue/);
  await rejectTapeMutation('five-minute-watering', tape => { tape.runs[0].scans[0].inputs.pop(); }, /every declared input exactly once/);
  await rejectTapeMutation('five-minute-watering', tape => { tape.runs[0].scans[2].completion.logicalTimeMs = 999; }, /logical time reversal/);
  await rejectTapeMutation('five-minute-watering', tape => { tape.runs[0].scans[2].completion.scanId = 1; }, /duplicate scanId 1/);
  await rejectTapeMutation('multiple-values', tape => { tape.runs[0].scans[0].inputs[0].value = 0; }, /must be Bool/);

  const badSourceHash = clone(corpus);
  badSourceHash.cases[0].source.sha256 = '0'.repeat(64);
  await assert.rejects(() => verifyInteractionCorpus({ root, corpus: badSourceHash }), /source SHA-256 does not match corpus identity/);

  const badModuleIdentity = clone(corpus);
  badModuleIdentity.cases[1].module.moduleFingerprint = '0'.repeat(16);
  await assert.rejects(() => verifyInteractionCorpus({ root, corpus: badModuleIdentity }), /compiled module\.moduleFingerprint/);

  const badCanonicalPath = clone(corpus);
  badCanonicalPath.cases[1].sourcePath = 'examples/scheduled-watering.ghost';
  await assert.rejects(() => verifyInteractionCorpus({ root, corpus: badCanonicalPath }), /canonical literate \.ghost\.md/);

  const unknownCorpusField = clone(corpus);
  unknownCorpusField.derivedGhost = 'not-a-canonical-source';
  await assert.rejects(() => verifyInteractionCorpus({ root, corpus: unknownCorpusField }), /unknown: derivedGhost/);
});

test('GF-TEST-interaction-corpus-digest: binds every stimulus field using the declared canonical digest strategy', async () => {
  const fixture = corpus.cases[1];
  const tape = read(fixture.tapePath);
  const originalDigest = tape.digest.sha256;
  tape.runs[0].scans[1].inputs[2].value += 1;
  const alteredTape = JSON.stringify(tape);
  await assert.rejects(() => verifyInteractionCorpus({
    root,
    corpus: clone(corpus),
    readFile: relative => relative === fixture.tapePath ? Buffer.from(alteredTape) : fs.readFileSync(path.join(root, relative)),
  }), /digest\.sha256 does not match/);
  assert.match(originalDigest, /^[a-f0-9]{64}$/);
});
