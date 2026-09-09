import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readCatalog, requirementId, validateCatalog } from '../contracts/requirements/validate.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const catalog = readCatalog({ root });

test('requirement catalog has content-derived IDs and complete relation', () => {
  assert.deepEqual(validateCatalog(catalog, { root }), { requirements: 8, tests: 7, linkedTests: 7 });
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
