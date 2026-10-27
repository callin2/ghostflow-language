import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyReferenceRevision, loadReferenceCases, referenceCaseDigest } from '../tools/reference-cases.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const historicalUrl = new URL('./reference/cases-input-v1/03-settings-boundaries.json', import.meta.url);
const historicalBytes = fs.readFileSync(historicalUrl);
const historical = JSON.parse(historicalBytes).cases;
const before = historical.find(entry => entry.id === 'REF-05-013');
const revision = JSON.parse(fs.readFileSync(new URL('./reference/revisions/settings-result-v1.json', import.meta.url)));
const currentCaseSha256 = '6b765fecad4c6e4b2c414084885d2c587d96e144658a6a2ca5b965b08d9abb4b';

test('current settings Result case preserves its exact predecessor and records the normative decision', () => {
  const source = structuredClone(historical), unchanged = structuredClone(source);
  const revised = applyReferenceRevision(source, revision);
  assert.equal(referenceCaseDigest(revision.cases[0].case), currentCaseSha256,
    'the complete current contract is pinned independently of its editable revision record');
  assert.equal(referenceCaseDigest(before), revision.cases[0].supersedesSha256);
  assert.match(before.then, /revision을 모두 유지/);
  assert.match(revised.find(entry => entry.id === before.id).then, /fault\(SettingsInvalid\)/);
  assert.deepEqual(source, unchanged);
  assert.deepEqual(revised.filter(entry => entry.id !== before.id), historical.filter(entry => entry.id !== before.id));
  revised[0].rule = 'caller mutation';
  assert.deepEqual(source, unchanged);
  const current = loadReferenceCases(root).cases.find(entry => entry.id === before.id);
  assert.equal(current.sourceRevision, revision.sourceRevision);
  assert.equal(current.catalog, 'tests/reference/revisions/settings-result-v1.json');
  assert.deepEqual(current.predecessor, { path: 'tests/reference/cases-input-v1/03-settings-boundaries.json',
    sha256: referenceCaseDigest(before) });
  assert.equal(current.decision, 'https://github.com/callin2/ghostflow-language/issues/274#issuecomment-6445458117');
  assert.deepEqual(fs.readFileSync(historicalUrl), historicalBytes);
  for (const field of ['given', 'when', 'then', 'rule']) {
    const changed = structuredClone(revision.cases[0].case);
    changed[field] += ' fault(SettingsInvalid) but revision unchanged and partial success';
    assert.notEqual(referenceCaseDigest(changed), currentCaseSha256);
  }
});

test('reference revision rejects unknown duplicate tampered or reclassified predecessor before changing history', () => {
  for (const mutate of [
    value => { value.cases[0].supersedesSha256 = '0'.repeat(64); },
    value => { value.cases[0].case.id = 'REF-05-NOT-REGISTERED'; },
    value => { value.cases.push(structuredClone(value.cases[0])); },
    value => { value.cases[0].case.scope = 'compiler'; },
    value => { value.cases[0].case.status = 'executable'; },
    value => { value.cases[0].case.issue += '0'; },
    value => { value.cases[0].case.sourceRevision = 'unrelated'; },
    value => { value.sourceRevision = ''; },
    value => { value.decision = ''; },
  ]) {
    const invalid = structuredClone(revision), history = structuredClone(historical);
    mutate(invalid);
    assert.throws(() => applyReferenceRevision(history, invalid), /reference|revision|digest/);
    assert.deepEqual(history, historical);
  }
  assert.throws(() => applyReferenceRevision([...historical, before], revision), /duplicate predecessor/);
  const tampered = structuredClone(historical);
  tampered.find(entry => entry.id === before.id).then += ' modified';
  assert.throws(() => applyReferenceRevision(tampered, revision), /digest mismatch/);
});
