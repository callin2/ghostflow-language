import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { catalogPath, namedSelector, renderStatus, validateCatalog } from '../contracts/feature-status/validate.mjs';
import { externalOracleCaseIds, frozenCompilerCaseIds, frozenSpecifiedCaseIds } from '../tools/reference-evidence.mjs';

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
  const wrongCompilerTitle = structuredClone(catalog);
  wrongCompilerTitle.entries.find(entry => entry.id === 'bool').evidence
    .find(evidence => evidence.stage === 'compile').refs[0].testId = 'REF-01-046 [compiler] wrong oracle';
  assert.match(errors(wrongCompilerTitle), /unresolved or inactive named test/);

  const designRuntime = structuredClone(catalog);
  designRuntime.entries.find(entry => entry.id === 'cse-provenance').evidence = [{ stage: 'native_wasm', status: 'verified', refs: [{ path: 'tests/runtime-conformance.test.mjs', testId: 'GF-TEST-snapshot-commit: old reads, explicit next reads, and untouched states', assertionClass: 'target-parity', targets: ['native', 'wasm'] }] }];
  assert.match(errors(designRuntime), /DESIGN cannot claim compiled or runtime evidence/);

  const stableGap = structuredClone(catalog);
  const stable = stableGap.entries.find(entry => entry.id === 'state-next');
  stable.maturity = 'STABLE';
  stable.gaps.push('unfinished oracle');
  assert.match(errors(stableGap), /STABLE cannot retain evidence gaps/);

  const missingTarget = structuredClone(catalog);
  delete missingTarget.entries.find(entry => entry.id === 'temporal-window').evidence[0].refs[0].targets;
  assert.match(errors(missingTarget), /runtime evidence needs native\/wasm targets/);

  const falseParity = structuredClone(catalog);
  falseParity.entries.find(entry => entry.id === 'source-trace').evidence[0].refs[0].targets = ['wasm'];
  assert.match(errors(falseParity), /target-parity requires native and wasm/);

  const splitParity = structuredClone(catalog);
  const percentRuntime = splitParity.entries.find(entry => entry.id === 'percent').evidence
    .find(evidence => evidence.stage === 'native_wasm');
  const nativeOnly = percentRuntime.refs[0];
  nativeOnly.assertionClass = 'runtime-value';
  nativeOnly.targets = ['native'];
  percentRuntime.refs.push({ ...nativeOnly, targets: ['wasm'] });
  assert.match(errors(splitParity), /STABLE frozen core needs one exact native\/WASM target-parity oracle/);

  const missingReplay = structuredClone(catalog);
  missingReplay.entries.find(entry => entry.id === 'retained-replay').evidence[0].refs
    .find(ref => ref.caseId === 'REF-06-017').assertionClass = 'runtime-value';
  assert.match(errors(missingReplay), /STABLE retained replay needs a separate replay oracle/);

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

test('finite frozen Reference scope has exact active compiler and external oracle links', () => {
  const cases = ['00-principles', '01-source-types', '02-time-control', '03-settings-boundaries']
    .flatMap(file => JSON.parse(fs.readFileSync(new URL(`./reference/cases/${file}.json`, import.meta.url), 'utf8')).cases);
  assert.equal(frozenCompilerCaseIds.length, 102);
  assert.equal(frozenSpecifiedCaseIds.length, 26);
  const external = externalOracleCaseIds(catalog, cases);
  assert.deepEqual(frozenSpecifiedCaseIds.filter(id => !external.has(id)), []);
  const removed = structuredClone(catalog);
  const row = removed.entries.find(entry => entry.id === 'logical-time');
  row.evidence[0].refs = row.evidence[0].refs.filter(ref => ref.caseId !== 'REF-03-009');
  assert.match(errors(removed), /REF-03-009: frozen specified case lacks a verified exact core oracle/);
  assert.equal(externalOracleCaseIds(removed, cases).has('REF-03-009'), false);
  const unregistered = structuredClone(catalog);
  unregistered.entries.find(entry => entry.id === 'logical-time').evidence[0].refs
    .find(ref => ref.caseId === 'REF-03-009').path = 'tests/unregistered.test.mjs';
  assert.match(errors(unregistered), /test is not in explicit language gate/);
  const fakeSpecified = structuredClone(catalog);
  fakeSpecified.entries.find(entry => entry.id === 'settings-observation').referenceCaseIds.push('REF-07-007');
  assert.equal(externalOracleCaseIds(fakeSpecified, cases).has('REF-07-007'), false);
  assert.equal(externalOracleCaseIds(fakeSpecified, cases).has('REF-05-012'), false);
});

test('frozen constructs cannot silently lose stable core maturity', () => {
  assert.deepEqual(catalog.entries.filter(entry => entry.coreScope && entry.maturity !== 'STABLE'), []);
  assert.equal(catalog.entries.filter(entry => entry.coreScope).length, 15);
  const downgraded = structuredClone(catalog);
  downgraded.entries.find(entry => entry.id === 'typed-input-config').maturity = 'EXPERIMENTAL';
  assert.match(errors(downgraded), /frozen core must remain CORE, coreScope true, and STABLE/);
  const excluded = structuredClone(catalog);
  excluded.entries.find(entry => entry.id === 'typed-input-config').coreScope = false;
  assert.match(errors(excluded), /frozen core must remain CORE, coreScope true, and STABLE/);
});
