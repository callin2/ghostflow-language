import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readCatalog, requirementId, validateCatalog } from '../contracts/requirements/validate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalog = readCatalog({ root });

test('input migration preserves historical virtual-host proof and original fixture bytes', () => {
  const oldProof = catalog.tests.find(row => row.id === 'GF-TEST-host-virtual-output');
  assert.equal(oldProof.evidenceStatus, 'historical');
  assert.equal(oldProof.locator.sha256, '4f9ac92548a683b00467e4e052101ce17bd2fe1384d7579c74961f25c9f6cf99');
  const current = catalog.tests.find(row => row.id === oldProof.supersededBy);
  assert.equal(current.file, 'tests/control.test.mjs');
  assert.equal(current.replaces, oldProof.id);
  const oldOutput = catalog.tests.find(row => row.id === 'GF-TEST-output-native-wasm-differential');
  assert.equal(oldOutput.evidenceStatus, 'historical');
  assert.equal(oldOutput.locator.sha256, '89aa0e2a70aae11f6369d7543fdceee5bb0cf673c65ca63ba0ad1f4ae266b0f4');
  const newOutput = catalog.tests.find(row => row.id === oldOutput.supersededBy);
  assert.equal(newOutput.file, 'tests/output-conformance.test.mjs');
  assert.equal(newOutput.replaces, oldOutput.id);
  for (const [id, digest] of [["GF-TEST-snapshot-commit", "e343ecf8e50a12b2fdf5c1148bd62fbbf199481615a80775247b06c5a906b17c"], ["GF-TEST-literate-runtime-equivalence", "633b84bc5d12c46ee0757f4cca05a23e9f7988b18031ee3e83fd66d8ce0f029d"], ["GF-TEST-contribution-field-boundary", "ee54081183c269388d393e5e301c6a1b94228690c2b6d02639709090a89f56db"]]) {
    const historical = catalog.tests.find(row => row.id === id);
    assert.equal(historical.evidenceStatus, 'historical');
    assert.equal(historical.locator.sha256, digest);
    const current = catalog.tests.find(row => row.id === historical.supersededBy);
    assert.equal(current.file, 'tests/runtime-conformance.test.mjs');
    assert.equal(current.replaces, id);
  }
  const bytes = fs.readFileSync(path.join(root, 'tests/fixtures/history/issue531/root-fixtures.pre-input.json'));
  const sha = value => createHash('sha256').update(value).digest('hex');
  assert.equal(sha(bytes), '4118e7a6ea3c74ae0bc5526449c725d2bfaa47b932de27aa2134c5b2a6be2af4');
  const history = JSON.parse(bytes);
  assert.equal(history.sourceRevision, 'c8a5d37ac09230a9011291a3ae3b053d1bc22773');
  assert.equal(history.files.length, 32);
  for (const record of history.files) {
    assert.equal(sha(gunzipSync(Buffer.from(record.gzipBase64, 'base64'))), record.sha256, record.path);
  }
});

test('requirement catalog has content-derived IDs and complete relation', () => {
  assert.deepEqual(validateCatalog(catalog, { root }), { requirements: 42, tests: 24, linkedTests: 24 });
  for (const requirement of catalog.requirements) assert.equal(requirement.id, requirementId(requirement.statement));
});

test('catalog validator rejects duplicate IDs, hash mismatch, orphan rows, and missing locators', () => {
  const clone = () => JSON.parse(JSON.stringify(catalog));
  const expectFailure = (mutate, message) => assert.throws(() => {
    const candidate = clone(); mutate(candidate); validateCatalog(candidate, { root });
  }, new RegExp(message));

  expectFailure(candidate => { candidate.requirements[1].id = candidate.requirements[0].id; }, 'duplicate requirement ID');
  expectFailure(candidate => { candidate.requirements[0].statement += ' changed'; }, 'hash mismatch');
  expectFailure(candidate => { candidate.tests.push({ ...candidate.tests[0], id: 'GF-TEST-orphan', locator: { ...candidate.tests[0].locator } }); }, 'orphan test');
  expectFailure(candidate => { delete candidate.requirements[0].testIds; delete candidate.requirements[0].pendingReason; }, 'neither testIds nor pendingReason');
  expectFailure(candidate => { delete candidate.requirements[0].source; }, 'source is missing');
  expectFailure(candidate => { candidate.tests[0].locator.lines = [999999, 1000000]; }, 'points beyond');
  expectFailure(candidate => { candidate.requirements[0].source.sha256 = '0'.repeat(64); }, 'sha256 mismatch');
  expectFailure(candidate => { candidate.requirements[0].source.heading = 'missing heading'; }, 'heading not found');
  expectFailure(candidate => { candidate.requirements[0].source.heading = '장치 적응과 시간'; }, 'heading must precede');
  expectFailure(candidate => { delete candidate.tests[0].locator.sha256; }, 'sha256 must be');
});

test('catalog validator detects a locator range shift without an updated digest', () => {
  const candidate = JSON.parse(JSON.stringify(catalog));
  candidate.requirements[0].source.lines = [55, 59];
  assert.throws(() => validateCatalog(candidate, { root }), /sha256 mismatch/);
});

test('catalog source and test locators resolve to checked-in files', () => {
  for (const row of [...catalog.requirements.map(item => item.source), ...catalog.tests.map(item => item.locator)]) {
    assert.equal(fs.existsSync(path.join(root, row.path)), true, row.path);
  }
});

test('catalog cannot mark incomplete evidence implemented or point a test at another file', () => {
  const candidate = structuredClone(catalog);
  const pending = candidate.requirements.find(row => row.status === 'pending');
  pending.status = 'implemented';
  assert.throws(() => validateCatalog(candidate, { root }), /implemented status requires tests and no pendingReason/);
  pending.testIds = [candidate.tests[0].id];
  assert.throws(() => validateCatalog(candidate, { root }), /implemented status requires tests and no pendingReason/);
  const mismatched = structuredClone(catalog);
  mismatched.tests[0].file = mismatched.tests[1].file === mismatched.tests[0].file
    ? 'tests/runtime-conformance.test.mjs' : mismatched.tests[1].file;
  assert.throws(() => validateCatalog(mismatched, { root }), /file and locator.path disagree/);
});

test('superseded MVP intent-read claim retains its identity and points to tested current semantics', () => {
  const historical = catalog.requirements.find(row => row.id === 'GF-REQ-d9f669f061279c41');
  assert.equal(historical.statement, 'All intent expressions read committed next state.');
  assert.equal(historical.source.sha256, '909155acbc4e71907554e719ddf7f7747412bb401a2aaaabe3c73f6f2ae0d990');
  assert.equal(historical.status, 'pending');

  const current = catalog.requirements.find(row => row.id === historical.supersededBy);
  assert.equal(current?.statement,
    'In intent expressions, unprimed state reads the old snapshot and explicit next-state references read candidate state; candidate state and requested/safe intents commit together when evaluation finishes without error, including when constraints block an output.');
  assert.equal(current.status, 'implemented');
  assert.deepEqual(current.testIds, [
    'GF-TEST-snapshot-commit', 'GF-TEST-error-atomicity', 'GF-TEST-safety-fixed-point',
    'GF-TEST-snapshot-commit-input-v1',
  ]);

  const mvp = fs.readFileSync(path.join(root, 'docs/LANGUAGE-MVP-0.1.md'), 'utf8');
  assert.match(mvp, /unprimed state reads the old snapshot/);
  assert.match(mvp, /explicit next-state references read candidate state/);
  assert.match(mvp, /even if constraints block an output/);
  assert.doesNotMatch(mvp, /All `intent` expressions read the committed next state/);
});
