import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableReferenceSelector } from '../../tools/reference-evidence.mjs';
import { frozenCompilerCaseIds, frozenSpecifiedCaseIds } from '../../tools/reference-evidence.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const catalogPath = path.join(root, 'contracts/feature-status/catalog.json');
const referenceCatalogs = [
  'tests/reference/cases/00-principles.json', 'tests/reference/cases/01-source-types.json',
  'tests/reference/cases/02-time-control.json', 'tests/reference/cases/03-settings-boundaries.json',
];
const stages = new Set(['compile', 'native_wasm', 'host_simulation', 'driver_application', 'physical_confirmation']);
const owners = new Set(['CORE', 'LIBRARY', 'HOST', 'DRIVER', 'PRODUCT_BOUNDARY']);
const maturities = new Set(['STABLE', 'EXPERIMENTAL', 'DESIGN']);
const assertions = new Set(['identity', 'type-boundary', 'runtime-value', 'target-parity', 'rollback', 'compile-policy', 'observation', 'simulation', 'replay']);
const frozenConstructIds = new Set([
  'source-literate', 'intent-provenance', 'bool', 'int', 'number', 'percent', 'duration',
  'typed-input-config', 'pure-expressions', 'state-next', 'logical-time', 'requested-safe',
  'atomic-tick', 'source-trace', 'retained-replay',
]);
const requiredIds = new Set([
  ...frozenConstructIds, 'enum-result', 'temporal-duration',
  'temporal-window', 'daily-schedule', 'periodic-cron', 'solar-schedule', 'sensor-quality',
  'filter-hysteresis', 'resource-arbitration', 'control-objectives', 'control-adaptation',
  'settings-live', 'settings-observation', 'interaction-observation', 'composition-import',
  'macro-composition', 'explanation-dag', 'ghost-branch', 'semantic-rejection',
  'cse-provenance', 'host-boundary', 'driver-boundary', 'product-boundary',
]);

export function namedSelector(source, title) {
  // Bounded static check for literal declarations. Runtime skips and computed
  // registration still belong to the full gate, not this catalog validator.
  const code = new Uint8Array(source.length).fill(1);
  for (let i = 0; i < source.length;) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      code.fill(0, i, stop);
      i = stop;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      code.fill(0, i, stop);
      i = stop;
    } else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i];
      const start = i++;
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i++] === quote) break;
      }
      code.fill(0, start, i);
    } else i++;
  }
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`(?<![\\w.])(?:test|it|t\\.test)(\\.skip|\\.todo)?\\(\\s*(['\"])${escaped}\\2\\s*([,)])`, 'gm');
  const matches = [...source.matchAll(declaration)].filter(match => code[match.index]);
  if (matches.length !== 1 || matches[0][1] || matches[0][3] === ')') return false;
  let tail = source.slice(matches[0].index + matches[0][0].length);
  const options = tail.match(/^\s*\{([\s\S]{0,400}?)\}\s*,/);
  if (options) {
    if (/(?:^|,)\s*(?:skip|todo)\s*:/.test(options[1])) return false;
    tail = tail.slice(options[0].length);
  }
  return /^\s*(?:async\s+)?(?:function\b|(?:[\w$]+|\([^)]*\))\s*=>)/.test(tail);
}

export function validateCatalog(catalog) {
  const errors = [];
  const fail = (id, message) => errors.push(`${id}: ${message}`);
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.entries)) return ['invalid feature-status catalog schema'];
  const ids = new Set();
  const frozen = new Set([...frozenCompilerCaseIds, ...frozenSpecifiedCaseIds]);
  const linkedFrozen = new Set();
  const referenceCases = new Map();
  for (const file of referenceCatalogs) for (const entry of JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).cases) referenceCases.set(entry.id, entry);
  const verifier = fs.readFileSync(path.join(root, 'tools/verify-language.mjs'), 'utf8');
  const testList = verifier.match(/export const LANGUAGE_TESTS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!testList) return ['cannot locate explicit LANGUAGE_TESTS list'];
  const testSet = new Set([...testList[1].matchAll(/'([^']+\.test\.mjs)'/g)].map(match => match[1]));
  for (const entry of catalog.entries) {
    const id = entry?.id ?? '<missing id>';
    if (ids.has(id)) fail(id, 'duplicate id');
    ids.add(id);
    if (!owners.has(entry.owner)) fail(id, 'invalid owner');
    if (!maturities.has(entry.maturity)) fail(id, 'invalid maturity');
    if (typeof entry.coreScope !== 'boolean') fail(id, 'coreScope must be boolean');
    if (entry.coreScope && entry.owner !== 'CORE') fail(id, 'coreScope rows must be owned by CORE');
    if (entry.coreScope && entry.maturity === 'DESIGN') fail(id, 'frozen core cannot be classified DESIGN');
    if (typeof entry.family !== 'string' || !entry.family.trim()) fail(id, 'missing family');
    if (!entry.clause?.path || !entry.clause?.heading) fail(id, 'missing clause path or heading');
    else {
      const doc = path.join(root, entry.clause.path);
      if (!fs.existsSync(doc) || !fs.readFileSync(doc, 'utf8').split(/\r?\n/).some(line => line.startsWith('## ') && line.slice(3).trim() === entry.clause.heading)) fail(id, `unknown clause heading ${entry.clause.path}#${entry.clause.heading}`);
    }
    if (!Array.isArray(entry.requiredEvidence) || !Array.isArray(entry.evidence) || !Array.isArray(entry.gaps) || !Array.isArray(entry.issues) || !Array.isArray(entry.referenceCaseIds)) {
      fail(id, 'evidence, gaps, issues, referenceCaseIds, and requiredEvidence must be arrays');
      continue;
    }
    if (!entry.evidence.length && !entry.gaps.length) fail(id, 'feature requires evidence or a precise gap');
    for (const issue of entry.issues ?? []) if (!Number.isSafeInteger(issue) || issue <= 0) fail(id, `invalid issue id ${issue}`);
    if ((entry.coreScope || entry.maturity === 'STABLE') && !entry.requiredEvidence.length) fail(id, 'coreScope or STABLE requires nonempty requiredEvidence');
    const verified = new Map();
    const seenStages = new Set();
    let successfulRuntime = false;
    for (const evidence of entry.evidence ?? []) {
      if (!stages.has(evidence.stage)) { fail(id, `invalid evidence stage ${evidence.stage}`); continue; }
      if (seenStages.has(evidence.stage)) fail(id, `duplicate evidence stage ${evidence.stage}`);
      seenStages.add(evidence.stage);
      if (!['verified', 'gap', 'not-claimed'].includes(evidence.status)) fail(id, `invalid evidence status ${evidence.status}`);
      if (evidence.status === 'verified') verified.set(evidence.stage, true);
      if (['native_wasm', 'host_simulation', 'driver_application', 'physical_confirmation'].includes(evidence.stage) && evidence.status === 'verified') successfulRuntime = true;
      if (evidence.status === 'verified' && (!Array.isArray(evidence.refs) || !evidence.refs.length)) fail(id, `verified ${evidence.stage} evidence needs executable references`);
      if (!Array.isArray(evidence.refs)) fail(id, `evidence ${evidence.stage} needs refs array`);
      if (evidence.status !== 'verified' && evidence.refs?.length) fail(id, `${evidence.status} evidence cannot cite a passing oracle`);
      for (const ref of evidence.refs ?? []) {
        if (!testSet.has(ref.path)) fail(id, `test is not in explicit language gate: ${ref.path}`);
        else if (!fs.existsSync(path.join(root, ref.path))) fail(id, `missing test file ${ref.path}`);
        if (!assertions.has(ref.assertionClass)) fail(id, `invalid assertion class ${ref.assertionClass}`);
        if (ref.polarities !== undefined && (!Array.isArray(ref.polarities) || !ref.polarities.length || new Set(ref.polarities).size !== ref.polarities.length || ref.polarities.some(value => !['positive', 'negative', 'boundary'].includes(value)))) fail(id, 'invalid polarities');
        const allowedTargets = evidence.stage === 'host_simulation' ? ['native', 'wasm', 'host'] : ['native', 'wasm'];
        if (evidence.stage !== 'compile' && (!Array.isArray(ref.targets) || !ref.targets.length || new Set(ref.targets).size !== ref.targets.length || ref.targets.some(value => !allowedTargets.includes(value)))) fail(id, 'runtime evidence needs native/wasm targets (host is allowed only for host_simulation)');
        if (evidence.stage === 'compile' && ref.targets !== undefined) fail(id, 'compile evidence cannot claim runtime targets');
        if (ref.assertionClass === 'target-parity' && (!Array.isArray(ref.targets) || ref.targets.length !== 2 || !ref.targets.includes('native') || !ref.targets.includes('wasm'))) fail(id, 'target-parity requires native and wasm');
        if (ref.testId) {
          const testSource = fs.existsSync(path.join(root, ref.path)) ? fs.readFileSync(path.join(root, ref.path), 'utf8') : '';
          if (!namedSelector(testSource, ref.testId) && !executableReferenceSelector(ref, referenceCases.get(ref.caseId))) fail(id, `unresolved or inactive named test ${ref.testId}`);
        }
        if (ref.caseId && !referenceCases.has(ref.caseId)) fail(id, `unresolved Reference case ${ref.caseId}`);
        if (ref.caseId && !entry.referenceCaseIds.includes(ref.caseId)) fail(id, `evidence case ${ref.caseId} is not listed on row`);
        if (entry.coreScope && evidence.status === 'verified' && frozen.has(ref.caseId)) linkedFrozen.add(ref.caseId);
        if (!ref.testId) fail(id, 'evidence reference needs exact named testId');
      }
    }
    for (const stage of entry.requiredEvidence ?? []) if (!stages.has(stage)) fail(id, `invalid required evidence stage ${stage}`);
    if (entry.maturity === 'STABLE') {
      for (const stage of entry.requiredEvidence ?? []) if (!verified.has(stage)) fail(id, `STABLE requires verified ${stage} evidence`);
      if (entry.gaps.length || entry.evidence.some(e => e.status === 'gap')) fail(id, 'STABLE cannot retain evidence gaps');
    }
    if (entry.maturity === 'DESIGN' && (successfulRuntime || verified.has('compile'))) fail(id, 'DESIGN cannot claim compiled or runtime evidence');
    if (entry.coreScope && ['driver_application', 'physical_confirmation'].some(stage => verified.has(stage))) fail(id, 'frozen core evidence cannot claim Driver or physical confirmation');
    if (entry.coreScope) {
      const coreRefs = entry.evidence.filter(evidence => evidence.status === 'verified').flatMap(evidence => evidence.refs);
      const polarities = new Set(coreRefs.flatMap(ref => ref.polarities ?? []));
      for (const polarity of ['positive', 'negative', 'boundary']) if (!polarities.has(polarity)) fail(id, `frozen core lacks ${polarity} oracle polarity`);
      if (entry.maturity === 'STABLE' && entry.requiredEvidence.includes('native_wasm')) {
        const runtimeRefs = entry.evidence.filter(evidence => evidence.stage === 'native_wasm' && evidence.status === 'verified')
          .flatMap(evidence => evidence.refs);
        if (!runtimeRefs.some(ref => ref.assertionClass === 'target-parity'
          && ref.targets?.includes('native') && ref.targets?.includes('wasm'))) {
          fail(id, 'STABLE frozen core needs one exact native/WASM target-parity oracle');
        }
        if (id === 'retained-replay' && !runtimeRefs.some(ref => ref.assertionClass === 'replay'
          && ref.targets?.includes('native') && ref.targets?.includes('wasm'))) {
          fail(id, 'STABLE retained replay needs a separate replay oracle');
        }
      }
    }
    for (const caseId of entry.referenceCaseIds ?? []) {
      const refCase = referenceCases.get(caseId);
      if (!refCase) fail(id, `unknown Reference case ${caseId}`);
      else if (entry.maturity === 'STABLE' && refCase.status === 'specified' && !(entry.evidence ?? []).some(e => e.status === 'verified' && e.refs?.some(r => r.caseId === caseId && r.testId))) fail(id, `STABLE specified ${caseId} has no exact executed named-test oracle`);
      if (entry.coreScope && !frozen.has(caseId)) fail(id, `case ${caseId} is outside the finite frozen core set`);
    }
  }
  for (const caseId of frozenCompilerCaseIds) {
    if (referenceCases.get(caseId)?.status !== 'executable') fail(caseId, 'frozen compiler case is not executable');
    if (!linkedFrozen.has(caseId)) fail(caseId, 'frozen compiler case lacks a verified exact core oracle');
  }
  for (const caseId of frozenSpecifiedCaseIds) {
    if (referenceCases.get(caseId)?.status !== 'specified') fail(caseId, 'frozen external case is not specified');
    if (!linkedFrozen.has(caseId)) fail(caseId, 'frozen specified case lacks a verified exact core oracle');
  }
  for (const id of requiredIds) if (!ids.has(id)) fail(id, 'required principal feature row is missing');
  for (const id of frozenConstructIds) {
    const entry = catalog.entries.find(candidate => candidate.id === id);
    if (entry && (entry.owner !== 'CORE' || !entry.coreScope || entry.maturity !== 'STABLE')) {
      fail(id, 'frozen core must remain CORE, coreScope true, and STABLE');
    }
  }
  return errors;
}

export function renderStatus(catalog) {
  const rows = ['# Reference feature maturity and evidence', '', 'Each row describes the named Reference clause, not its whole chapter. `CORE` owns compiler/runtime primitives beyond the frozen Core 0.1; `coreScope` marks frozen membership. `LIBRARY` means outside that frozen contract and does not assert that a user-authored pure library exists. External-owner maturity reflects evidence in this toolchain, not a release judgment on another module.', '', 'A verified link identifies an exact active test selector and its assertion class in the catalog. It establishes an executable oracle link; the current full verification gate determines whether it passes. Compile, native/WASM, host simulation, Driver application, and physical confirmation are separate stages.', '', 'Source-checked Percent and Duration carry their units and bounds through compilation, then lower to Number values in the VM. Frozen source/constraint trace provenance is narrower than the full evaluated-path explanation DAG (#88). Core replay covers retained same-program scans; persisted Host restoration and physical effects are separate contracts.', '', '| Feature | Owner | Maturity | Clause | Evidence / gap | Issues |', '|---|---|---|---|---|---|'];
  for (const e of catalog.entries) {
    const evidence = e.evidence.flatMap(x => x.refs.map(r => `${x.stage}${r.targets ? ` [${r.targets.join('+')}]` : ''}: [${r.testId}](../${r.path})${r.caseId ? ` (${r.caseId})` : ''}`));
    rows.push(`| ${e.family} | ${e.owner} | ${e.maturity} | [${e.clause.heading}](../${e.clause.path}) | ${[...evidence, ...e.gaps].join('; ') || 'No evidence claimed'} | ${e.issues.map(i => `#${i}`).join(', ') || '—'} |`);
  }
  return `${rows.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const errors = validateCatalog(catalog);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else {
    const target = path.join(root, 'docs/REFERENCE-FEATURE-STATUS.md');
    const rendered = renderStatus(catalog);
    if (process.argv.includes('--write')) fs.writeFileSync(target, rendered);
    else if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== rendered) { console.error(`${target} is stale; run node contracts/feature-status/validate.mjs --write`); process.exitCode = 1; }
  }
}
