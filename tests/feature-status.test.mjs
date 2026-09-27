import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { catalogPath, namedSelector, renderStatus, validateCatalog } from '../contracts/feature-status/validate.mjs';

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const errors = value => validateCatalog(value).join('\n');

test('feature status catalog validates and generated view is current', () => {
  assert.deepEqual(validateCatalog(catalog), []);
  assert.equal(fs.readFileSync(new URL('../docs/REFERENCE-FEATURE-STATUS.md', import.meta.url), 'utf8'), renderStatus(catalog));
});

test('status validator rejects missing, unresolved, and contradictory evidence', () => {
  const missingStableEvidence = structuredClone(catalog);
  const literate = missingStableEvidence.entries.find(entry => entry.id === 'source-literate');
  literate.maturity = 'STABLE';
  literate.evidence = [];
  assert.match(errors(missingStableEvidence), /STABLE requires verified compile/);

  const staleSelector = structuredClone(catalog);
  staleSelector.entries[0].evidence[0].refs[0].testId = 'GF-TEST-does-not-exist';
  assert.match(errors(staleSelector), /unresolved or inactive named test/);

  const unregistered = structuredClone(catalog);
  unregistered.entries.find(entry => entry.id === 'macro-composition').evidence = [{stage:'compile',status:'verified',refs:[{path:'tests/not-in-language-gate.test.mjs',testId:'invented oracle',assertionClass:'compile-policy'}]}];
  assert.match(errors(unregistered), /test is not in explicit language gate/);

  const designRuntime = structuredClone(catalog);
  designRuntime.entries.find(entry => entry.id === 'cse-provenance').evidence = [{ stage: 'native_wasm', status: 'verified', refs: [{ path: 'tests/runtime-conformance.test.mjs', testId: 'GF-TEST-snapshot-commit: old reads, explicit next reads, and untouched states', assertionClass: 'target-parity', targets: ['native', 'wasm'] }] }];
  assert.match(errors(designRuntime), /DESIGN cannot claim compiled or runtime evidence/);

  const stableGap = structuredClone(catalog);
  const stable = stableGap.entries.find(entry => entry.id === 'state-next');
  stable.maturity = 'STABLE';
  stable.evidence.push({stage:'compile',status:'verified',refs:[{path:'tests/intent-anchor-map.test.mjs',testId:'GF-TEST-intent-anchor: explicit literate anchors bind to compiler nodes without changing execution artifacts',assertionClass:'identity'}]});
  assert.match(errors(stableGap), /STABLE cannot retain evidence gaps/);

  const missingTarget = structuredClone(catalog);
  delete missingTarget.entries.find(entry => entry.id === 'temporal-window').evidence[0].refs[0].targets;
  assert.match(errors(missingTarget), /runtime evidence needs native\/wasm targets/);

  const falseParity = structuredClone(catalog);
  falseParity.entries.find(entry => entry.id === 'source-trace').evidence[0].refs[0].targets = ['wasm'];
  assert.match(errors(falseParity), /target-parity requires native and wasm/);

  const badPolarity = structuredClone(catalog);
  badPolarity.entries[0].evidence[0].refs[0].polarities = ['positive', 'positive'];
  assert.match(errors(badPolarity), /invalid polarities/);

  const noCoreRequirement = structuredClone(catalog);
  noCoreRequirement.entries[0].requiredEvidence = [];
  assert.match(errors(noCoreRequirement), /coreScope or STABLE requires nonempty requiredEvidence/);

  const badClause = structuredClone(catalog);
  badClause.entries[0].clause.heading = 'not a Reference heading';
  assert.match(errors(badClause), /unknown clause heading/);

  const missingFamily = structuredClone(catalog);
  missingFamily.entries = missingFamily.entries.filter(entry => entry.id !== 'settings-observation');
  assert.match(errors(missingFamily), /required principal feature row is missing/);
});

test('only an exact active literal selector can support evidence', () => {
  assert.equal(namedSelector("test('exact', () => {});", 'exact'), true);
  assert.equal(namedSelector("test('exact suffix', () => {});", 'exact'), false);
  assert.equal(namedSelector("test.skip('exact', () => {});", 'exact'), false);
  assert.equal(namedSelector("test('exact');", 'exact'), false);
  assert.equal(namedSelector("// test('exact', () => {});", 'exact'), false);
  assert.equal(namedSelector("/* test('exact', () => {}); */", 'exact'), false);
  assert.equal(namedSelector("test('exact', { todo: 'later' }, () => {});", 'exact'), false);
  assert.equal(namedSelector("test('exact', { timeout: 100, skip: true }, () => {});", 'exact'), false);
  assert.equal(namedSelector("test('exact', { timeout: 100 }, () => {});", 'exact'), true);
});
