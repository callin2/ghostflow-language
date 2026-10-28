import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const historicalReferenceFiles = Object.freeze([
  'tests/reference/cases-input-v1/00-principles.json',
  'tests/reference/cases-input-v1/01-source-types.json',
  'tests/reference/cases-input-v1/02-time-control.json',
  'tests/reference/cases-input-v1/03-settings-boundaries.json',
]);
const additiveFiles = ['tests/reference/cases-civil-range-v1/02-time-control.json'];
const revisionFiles = ['tests/reference/revisions/settings-result-v1.json'];
export const referenceCaseDigest = entry => createHash('sha256').update(JSON.stringify(entry)).digest('hex');

export function applyReferenceRevision(cases, revision) {
  if (!revision || typeof revision.sourceRevision !== 'string' || !revision.sourceRevision.trim()
      || typeof revision.decision !== 'string' || !revision.decision.startsWith('https://github.com/callin2/ghostflow-language/issues/')
      || !Array.isArray(revision.cases) || !revision.cases.length) throw new Error('invalid reference revision');
  const previous = new Map(cases.map(entry => [entry.id, entry]));
  if (previous.size !== cases.length) throw new Error('duplicate predecessor reference case');
  const replacements = new Map();
  for (const update of revision.cases) {
    const entry = update.case, before = previous.get(entry?.id);
    if (!before || replacements.has(entry.id)) throw new Error('unknown or duplicate revised reference case');
    if (update.supersedesSha256 !== referenceCaseDigest(before)) throw new Error(`${entry.id}: predecessor digest mismatch`);
    for (const key of ['id', 'issue', 'scope', 'status']) {
      if (entry[key] !== before[key]) throw new Error(`${entry.id}: revision changes ${key}`);
    }
    if (entry.sourceRevision !== revision.sourceRevision) throw new Error(`${entry.id}: revision identity mismatch`);
    replacements.set(entry.id, entry);
  }
  return cases.map(entry => structuredClone(replacements.get(entry.id) ?? entry));
}

export function loadReferenceCases(root) {
  const catalogs = [...historicalReferenceFiles, ...additiveFiles]
    .map(file => ({ file, ...JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) }));
  let cases = catalogs.flatMap(catalog => catalog.cases);
  const origins = new Map(catalogs.flatMap(catalog => catalog.cases.map(entry => [entry.id, { catalog: catalog.file }])));
  const revised = new Set();
  for (const file of revisionFiles) {
    const revision = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    cases = applyReferenceRevision(cases, revision);
    for (const update of revision.cases) {
      const id = update.case.id;
      if (revised.has(id)) throw new Error(`${id}: multiple active reference revisions`);
      revised.add(id);
      origins.set(id, { catalog: file, decision: revision.decision,
        predecessor: { path: origins.get(id).catalog, sha256: update.supersedesSha256 } });
    }
  }
  cases = cases.map(entry => ({ ...entry, ...origins.get(entry.id) }));
  return { catalogs, cases };
}
