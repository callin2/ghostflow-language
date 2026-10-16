import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { externalOracleCaseIds, frozenCompilerCaseIds, frozenSpecifiedCaseIds, referenceCaseTitle } from '../tools/reference-evidence.mjs';
import { catalogPath, validateCatalog } from '../contracts/feature-status/validate.mjs';
import { cliConcurrency, runNodeCli } from './helpers/cli-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceDir = path.join(root, 'docs/reference');
// Explicit files: adding a chapter requires an intentional coverage update.
const caseFiles = [
  'tests/reference/cases/00-principles.json',
  'tests/reference/cases/01-source-types.json',
  'tests/reference/cases/02-time-control.json',
  'tests/reference/cases/03-settings-boundaries.json',
];
const chapterFiles = [
  '../LANGUAGE-REFERENCE.md',
  '01-source-and-syntax.md',
  '02-types-expressions-state.md',
  '03-time-and-schedules.md',
  '04-sensors-constraints-control.md',
  '05-settings-and-observation.md',
  '06-composition-and-replay.md',
  '07-semantic-rules-and-index.md',
  '08-language-runtime-and-device-boundaries.md',
];
const catalogs = caseFiles.map(file => ({ file, ...JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) }));
const cases = catalogs.flatMap(catalog => catalog.cases.map(entry => ({ ...entry, catalog: catalog.file })));
const featureCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const featureValidationErrors = validateCatalog(featureCatalog);
const externalOracleIds = featureValidationErrors.length ? new Set() : externalOracleCaseIds(featureCatalog, cases);
const frozenLinked = new Set((featureValidationErrors.length ? [] : featureCatalog.entries).filter(entry => entry.coreScope).flatMap(entry =>
  entry.evidence.filter(evidence => evidence.status === 'verified').flatMap(evidence =>
    evidence.refs.map(ref => ref.caseId).filter(Boolean))));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-reference-'));
const results = [];
let catalogValidation = 'not-run';

function slug(text) {
  return text.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

function indexChapter(file) {
  const anchors = new Map();
  const sections = new Set();
  let fence = null;
  let section = null;
  for (const line of fs.readFileSync(path.join(referenceDir, file), 'utf8').split(/\r?\n/)) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) continue;
    const anchor = slug(heading[2]);
    if ((heading[1] === '##' && /^\d+\.\d+\s/.test(heading[2])) ||
        (file === '../LANGUAGE-REFERENCE.md' && heading[1] === '###' && /^\d+\.\s/.test(heading[2]))) {
      section = `${file}#${anchor}`;
      sections.add(section);
    }
    anchors.set(anchor, section);
  }
  return { anchors, sections };
}

const chapters = new Map(chapterFiles.map(file => [file, indexChapter(file)]));

function issueLinkErrors(entries, externallyCovered) {
  const errors = [];
  const linkedIssues = new Map();
  for (const entry of entries) {
    if (entry.issue === undefined) {
      if (entry.status !== 'executable' && !externallyCovered.has(entry.id)) {
        errors.push(`${entry.id}: pending case needs an issue backlink`);
      }
      continue;
    }
    const match = typeof entry.issue === 'string'
      ? /^https:\/\/github\.com\/callin2\/ghostflow-language\/issues\/([1-9]\d*)$/.exec(entry.issue)
      : null;
    if (!match) {
      errors.push(`${entry.id}: invalid ghostflow-language issue URL`);
      continue;
    }
    const previous = linkedIssues.get(match[1]);
    if (previous) errors.push(`${entry.id}: issue #${match[1]} already linked by ${previous}`);
    else linkedIssues.set(match[1], entry.id);
  }
  return errors;
}

test('Reference issue backlinks: pending cases linked and all supplied URLs unique', () => {
  const errors = issueLinkErrors(cases, externalOracleIds);
  assert.equal(errors.length, 0, `${errors.length} backlink errors: ${errors.slice(0, 8).join('; ')}`);
});

test('Reference issue backlinks reject missing, malformed, wrong-repository and duplicate links', () => {
  const link = number => `https://github.com/callin2/ghostflow-language/issues/${number}`;
  const covered = new Set(['COVERED']);
  assert.deepEqual(issueLinkErrors([
    { id: 'EXEC', status: 'executable' },
    { id: 'COVERED', status: 'specified' },
    { id: 'GRADUATED', status: 'executable', issue: link(12) },
    { id: 'PENDING', status: 'specified', issue: link(13) },
  ], covered), []);
  assert.deepEqual(issueLinkErrors([
    { id: 'MISSING', status: 'decision' },
    { id: 'MALFORMED', status: 'specified', issue: 'https://github.com/callin2/ghostflow-language/issues/0' },
    { id: 'WRONG-REPO', status: 'specified', issue: 'https://github.com/callin2/farm_studio_system/issues/14' },
    { id: 'FIRST', status: 'executable', issue: link(15) },
    { id: 'DUPLICATE', status: 'specified', issue: link(15) },
  ], covered), [
    'MISSING: pending case needs an issue backlink',
    'MALFORMED: invalid ghostflow-language issue URL',
    'WRONG-REPO: invalid ghostflow-language issue URL',
    'DUPLICATE: issue #15 already linked by FIRST',
  ]);
});

test('Reference catalog: unique cases, valid citations, concrete oracles, every numbered section accounted for', () => {
  catalogValidation = 'failed';
  assert.deepEqual(featureValidationErrors, [], 'external oracle links must resolve to active named tests');
  const ids = new Set();
  const covered = new Set();
  const scopes = new Set(['compiler', 'runtime', 'host', 'driver', 'renderer', 'tooling', 'design']);
  const statuses = new Set(['executable', 'specified', 'decision']);
  assert.deepEqual(catalogs.flatMap(c => c.chapterFiles).sort(), [...chapterFiles].sort());
  for (const entry of cases) {
    assert.match(entry.id, /^REF-\d{2}-[A-Z0-9-]+$/, `invalid case ID in ${entry.catalog}`);
    assert.ok(!ids.has(entry.id), `duplicate case ${entry.id}`);
    ids.add(entry.id);
    assert.ok(typeof entry.rule === 'string' && entry.rule.trim(), `${entry.id}: missing rule`);
    assert.ok(scopes.has(entry.scope), `${entry.id}: invalid scope`);
    assert.ok(statuses.has(entry.status), `${entry.id}: invalid status`);
    assert.ok(Array.isArray(entry.references) && entry.references.length, `${entry.id}: missing citations`);
    for (const reference of entry.references) {
      const [file, anchor, extra] = reference.split('#');
      assert.equal(extra, undefined, `${entry.id}: invalid citation ${reference}`);
      assert.ok(chapters.get(file)?.anchors.has(anchor), `${entry.id}: missing heading ${reference}`);
      const section = chapters.get(file).anchors.get(anchor);
      if (section) covered.add(section);
    }
    if (entry.status === 'executable') {
      assert.equal(entry.scope, 'compiler', `${entry.id}: CLI cannot prove non-compiler behavior`);
      assert.ok(['accept', 'reject'].includes(entry.expect), `${entry.id}: missing compile oracle`);
      assert.ok(typeof entry.source === 'string' && entry.source.length, `${entry.id}: missing source`);
      const filename = entry.filename ?? 'case.ghost.md';
      assert.equal(path.basename(filename), filename, `${entry.id}: filename must be local to fixture`);
      assert.ok(!filename.startsWith('-'), `${entry.id}: filename cannot be a CLI option`);
      for (const [name, source] of Object.entries(entry.files ?? {})) {
        assert.equal(path.basename(name), name, `${entry.id}: dependency fixture must be local`);
        assert.ok(name.endsWith('.ghost.md') && name !== filename, `${entry.id}: invalid dependency filename`);
        assert.ok(typeof source === 'string' && source.length, `${entry.id}: missing dependency source`);
      }
      if (entry.diagnosticPattern) new RegExp(entry.diagnosticPattern, 'i');
    } else {
      for (const field of ['source', 'filename', 'files', 'expect', 'diagnosticPattern']) {
        assert.ok(!Object.hasOwn(entry, field), `${entry.id}: a concrete CLI case cannot be hidden as TODO (${field})`);
      }
      for (const field of ['given', 'when', 'then', 'reason']) {
        assert.ok(typeof entry[field] === 'string' && entry[field].trim(), `${entry.id}: missing ${field}`);
      }
    }
  }
  const missing = [...chapters.values()].flatMap(chapter => [...chapter.sections]).filter(section => !covered.has(section));
  assert.deepEqual(missing, [], 'Reference sections without any individually specified case');
  catalogValidation = 'passed';
});

function invoke(args) {
  return runNodeCli([path.join(root, 'tools/ghostc.mjs'), ...args], {
    cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  });
}

for (const entry of cases) {
  // The CLI does not execute external oracles. The explicit language gate does.
  if (entry.status !== 'executable' && !externalOracleIds.has(entry.id)) {
    test(referenceCaseTitle(entry), { todo: `${entry.status}: ${entry.reason}` });
  }
}

test('Reference CLI executable cases', { concurrency: cliConcurrency }, async t => {
  await Promise.all(cases.filter(entry => entry.status === 'executable').map(entry => t.test(referenceCaseTitle(entry), async () => {
    const record = { ...entry, outcome: 'failed', invocations: [] };
    results.push(record);
    const dir = fs.mkdtempSync(path.join(temporaryRoot, 'case-'));
    const input = path.join(dir, entry.filename ?? 'case.ghost.md');
    const output = path.join(dir, 'program.gfb');
    fs.writeFileSync(input, entry.source);
    for (const [name, source] of Object.entries(entry.files ?? {})) fs.writeFileSync(path.join(dir, name), source);
    const sourceFiles = fs.readdirSync(dir).sort();
    try {
      const failures = [];
      const checked = await invoke(['--check', input]);
      record.invocations.push({ mode: 'check', ...checked });
      try {
        assert.equal(checked.error, null, `${entry.id}: CLI infrastructure error: ${checked.error}`);
        assert.equal(checked.signal, null, `${entry.id}: CLI terminated by signal`);
        assert.equal(checked.status, entry.expect === 'accept' ? 0 : 1,
          `${entry.id}: expected ${entry.expect}; stdout=${checked.stdout}; stderr=${checked.stderr}`);
        if (entry.expect === 'reject') assert.match(checked.stderr, /^ghostc: /m, `${entry.id}: not a compiler diagnostic`);
        if (entry.diagnosticPattern) {
          assert.match(checked.stderr, new RegExp(entry.diagnosticPattern, 'i'), `${entry.id}: wrong diagnostic`);
        }
        assert.deepEqual(fs.readdirSync(dir).sort(), sourceFiles, '--check must not write artifacts');
      } catch (error) {
        failures.push(`check: ${error.message}`);
      }
      // Check-mode failure must not hide a distinct artifact-publication defect.
      const built = await invoke([input, output]);
      record.invocations.push({ mode: 'build', ...built });
      try {
        assert.equal(built.error, null, `${entry.id}: CLI infrastructure error: ${built.error}`);
        assert.equal(built.signal, null, `${entry.id}: CLI terminated by signal`);
        assert.equal(built.status, entry.expect === 'accept' ? 0 : 1,
          `${entry.id}: build disagrees with ${entry.expect}; stderr=${built.stderr}`);
        if (entry.expect === 'accept') {
          const bytes = fs.readFileSync(output);
          assert.ok(bytes.length > 0, `${entry.id}: empty compiled artifact`);
          if (entry.id === 'REF-04-026') {
            assert.match(bytes.subarray(0, 4).toString('ascii'), /^GFB[1-6]$/);
          }
          const map = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
          assert.equal(map.sourceDocument?.text, entry.source, `${entry.id}: original literate source not preserved`);
          assert.equal(map.sourceDocument?.sha256, createHash('sha256').update(entry.source).digest('hex'),
            `${entry.id}: source identity digest mismatch`);
          assert.equal(map.bytecodeSha256, createHash('sha256').update(bytes).digest('hex'),
            `${entry.id}: source map is not bound to the written artifact`);
        } else {
          assert.match(built.stderr, /^ghostc: /m, `${entry.id}: not a compiler diagnostic`);
          if (entry.diagnosticPattern) {
            assert.match(built.stderr, new RegExp(entry.diagnosticPattern, 'i'), `${entry.id}: wrong build diagnostic`);
          }
          assert.deepEqual(fs.readdirSync(dir).sort(), sourceFiles, `${entry.id}: rejected source published artifacts`);
        }
      } catch (error) {
        failures.push(`build: ${error.message}`);
      }
      assert.equal(failures.length, 0, `${entry.id}:\n${failures.join('\n')}`);
      record.outcome = 'passed';
    } catch (error) {
      record.failure = error.message;
      throw error;
    }
  })));
});

after(() => {
  const summary = Object.fromEntries(['passed', 'failed'].map(outcome =>
    [outcome, results.filter(result => result.outcome === outcome).length]));
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/reference-tests.json'), JSON.stringify({
    scope: 'language-reference-compiler-cli',
    note: 'Results are compiler-only. Externally-covered means an exact oracle is linked to an active explicit language-gate test; this CLI did not execute it. A full gate pass establishes its result. Unlinked specified/decision cases remain pending.',
    generatedAt: new Date().toISOString(),
    catalogValidation,
    catalogCounts: {
      total: cases.length,
      executable: cases.filter(entry => entry.status === 'executable').length,
      specified: cases.filter(entry => entry.status === 'specified').length,
      decision: cases.filter(entry => entry.status === 'decision').length,
      externallyCovered: externalOracleIds.size,
      remainingSpecified: cases.filter(entry => entry.status === 'specified' && !externalOracleIds.has(entry.id)).length,
      frozenCompilerLinked: frozenCompilerCaseIds.filter(id => frozenLinked.has(id)).length,
      frozenSpecifiedExternallyCovered: frozenSpecifiedCaseIds.filter(id => externalOracleIds.has(id)).length,
      frozenRemaining: [...frozenCompilerCaseIds, ...frozenSpecifiedCaseIds].filter(id => !frozenLinked.has(id)),
    },
    summary,
    results,
    externallyCoveredCatalog: cases.filter(entry => externalOracleIds.has(entry.id)).map(entry => ({
      ...entry, coverage: 'externally-covered',
      oracleRefs: featureCatalog.entries.flatMap(feature => feature.evidence.flatMap(evidence =>
        evidence.status === 'verified' ? evidence.refs.filter(ref => ref.caseId === entry.id).map(ref => ({
          featureId: feature.id, path: ref.path, testId: ref.testId,
        })) : [])),
    })),
    pendingCatalog: cases.filter(entry => entry.status !== 'executable' && !externalOracleIds.has(entry.id)),
  }, null, 2) + '\n');
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
