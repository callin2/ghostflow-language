import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

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

test('Reference catalog: unique cases, valid citations, concrete oracles, every numbered section accounted for', () => {
  catalogValidation = 'failed';
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
  const result = spawnSync(process.execPath, [path.join(root, 'tools/ghostc.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

for (const entry of cases) {
  const title = `${entry.id} [${entry.scope}] ${entry.rule}`;
  if (entry.status !== 'executable') {
    // A written scenario is not proof. Node reports these separately as TODO.
    test(title, { todo: `${entry.status}: ${entry.reason}` });
    continue;
  }
  test(title, () => {
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
      const checked = invoke(['--check', input]);
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
      const built = invoke([input, output]);
      record.invocations.push({ mode: 'build', ...built });
      try {
        assert.equal(built.error, null, `${entry.id}: CLI infrastructure error: ${built.error}`);
        assert.equal(built.signal, null, `${entry.id}: CLI terminated by signal`);
        assert.equal(built.status, entry.expect === 'accept' ? 0 : 1,
          `${entry.id}: build disagrees with ${entry.expect}; stderr=${built.stderr}`);
        if (entry.expect === 'accept') {
          const bytes = fs.readFileSync(output);
          assert.ok(bytes.length > 0, `${entry.id}: empty compiled artifact`);
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
  });
}

after(() => {
  const summary = Object.fromEntries(['passed', 'failed'].map(outcome =>
    [outcome, results.filter(result => result.outcome === outcome).length]));
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/reference-tests.json'), JSON.stringify({
    scope: 'language-reference-compiler-cli',
    note: 'Only passed executable compiler cases were verified. Specified/decision scenarios were not executed. Compile acceptance is not runtime verification.',
    generatedAt: new Date().toISOString(),
    catalogValidation,
    catalogCounts: {
      total: cases.length,
      executable: cases.filter(entry => entry.status === 'executable').length,
      specified: cases.filter(entry => entry.status === 'specified').length,
      decision: cases.filter(entry => entry.status === 'decision').length,
    },
    summary,
    results,
    pendingCatalog: cases.filter(entry => entry.status !== 'executable'),
  }, null, 2) + '\n');
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
