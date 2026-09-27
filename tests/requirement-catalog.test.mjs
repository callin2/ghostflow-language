import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readCatalog, requirementId, validateCatalog } from '../contracts/requirements/validate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalog = readCatalog({ root });

test('requirement catalog has content-derived IDs and complete relation', () => {
  assert.deepEqual(validateCatalog(catalog, { root }), { requirements: 42, tests: 18, linkedTests: 18 });
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
  ]);

  const mvp = fs.readFileSync(path.join(root, 'docs/LANGUAGE-MVP-0.1.md'), 'utf8');
  assert.match(mvp, /unprimed state reads the old snapshot/);
  assert.match(mvp, /explicit next-state references read candidate state/);
  assert.match(mvp, /even if constraints block an output/);
  assert.doesNotMatch(mvp, /All `intent` expressions read the committed next state/);
});
