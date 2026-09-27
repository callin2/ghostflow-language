import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeCoverage, requireRealReports } from '../tools/coverage-language.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('coverage collector keeps real-source ranges and rejects transformed offsets', () => {
  const target = 'tools/gfb1.mjs';
  const url = pathToFileURL(path.join(root, target)).href;
  const real = { url, functions: [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
    { functionName: 'real', ranges: [{ startOffset: 10, endOffset: 20, count: 1 }] },
  ] };
  const transformed = { url, functions: [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: 150, count: 1 }] },
    { functionName: 'phantom', ranges: [{ startOffset: 110, endOffset: 140, count: 0 }] },
  ] };
  const lengths = new Map([[target, 100]]);
  const scripts = mergeCoverage([{ result: [transformed, real] }], lengths);
  requireRealReports(scripts, [target]);
  assert.deepEqual([...scripts.get(target).values()].map(item => item.name), ['real']);
  assert.throws(() => requireRealReports(mergeCoverage([{ result: [transformed] }], lengths), [target]),
    /coverage has no real-source report for tools\/gfb1\.mjs/);
});

test('coverage collector reconciles V8 child ranges across process partitions', () => {
  const target = 'tools/gfb1.mjs';
  const url = pathToFileURL(path.join(root, target)).href;
  const report = ranges => ({ result: [{ url, functions: [
    { functionName: '', ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
    { functionName: 'branch', ranges },
  ] }] });
  const missed = report([
    { startOffset: 10, endOffset: 90, count: 1 },
    { startOffset: 20, endOffset: 30, count: 0 },
  ]);
  const taken = report([{ startOffset: 10, endOffset: 90, count: 1 }]);
  const lengths = new Map([[target, 100]]);
  const range = scripts => scripts.get(target).get('branch:10:90').ranges.get('20:30').count;
  assert.equal(range(mergeCoverage([missed], lengths)), 0, 'an unexecuted branch stays uncovered');
  assert.equal(range(mergeCoverage([missed, missed], lengths)), 0,
    'explicitly unexecuted children in every process do not inherit a parent hit');
  assert.equal(range(mergeCoverage([missed, taken], lengths)), 1,
    'a containing executed range in another process covers the same source');
});

test('browser VM coverage identifies transformed compiler separately from real source', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-source-identity-'));
  try {
    const env = { ...process.env, NODE_V8_COVERAGE: directory };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', 'tests/gfb1-browser.test.mjs',
      'tests/gfb4-browser.test.mjs', 'tests/gfb5-browser.test.mjs'], {
      cwd: root, env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /GFB1 compiles in a browser-like VM realm/);
    const sourcePath = path.join(root, 'tools/gfb1.mjs');
    const sourceUrl = pathToFileURL(sourcePath).href;
    const sourceLength = fs.readFileSync(sourcePath, 'utf8').length;
    const reports = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
      .flatMap(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')).result ?? []);
    const length = script => script.functions?.[0]?.ranges?.[0]?.endOffset;
    const real = reports.filter(script => script.url === sourceUrl);
    const transformed = reports.filter(script => script.url === 'ghostflow-browser-vm/gfb1-bundle.mjs');
    assert.ok(real.length > 0, 'real compiler reports are present');
    assert.ok(real.every(script => length(script) === sourceLength), 'real reports match the on-disk source length');
    assert.ok(transformed.length > 0, 'transformed browser VM reports use a distinct identity');
    assert.ok(transformed.every(script => length(script) > sourceLength), 'transformed reports have different offsets');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
