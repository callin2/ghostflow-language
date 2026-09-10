#!/usr/bin/env node
// V8 coverage gate for the public compiler and browser/runtime JavaScript surface.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TESTS = Object.freeze([
  'tests/boundary-conformance.test.mjs',
  'tests/runtime-conformance.test.mjs',
  'tests/compiler.test.mjs', 'tests/constraints.test.mjs', 'tests/coverage-edges.test.mjs', 'tests/control-host.test.mjs',
  'tests/control.test.mjs', 'tests/integration-contract.test.mjs', 'tests/ledger.test.mjs',
  'tests/literate.test.mjs', 'tests/policy.test.mjs',
  'tests/output-conformance.test.mjs', 'tests/schedule.test.mjs', 'tests/scheduled-admission.test.mjs',
  'tests/signals-wasm.test.mjs', 'tests/station-wasm.test.mjs', 'tests/toolchain.test.mjs',
]);
const TARGETS = Object.freeze([
  'tools/control.mjs', 'tools/gfb1.mjs', 'tools/literate.mjs', 'tools/toolchain.mjs',
  'runtimes/wasm/control-runtime.mjs', 'runtimes/wasm/ghostflow-runtime.mjs',
]);
const EXCLUDED = Object.freeze([{ test: 'tests/requirement-catalog.test.mjs', reason: 'catalog status is a separate requirement-governance gate, not language execution coverage' }]);
const MINIMUM = Object.freeze({ functions: 100, lines: 88, v8BlockRanges: 77 });

function percent(hit, total) { return total === 0 ? null : Number((hit * 100 / total).toFixed(2)); }
function metric(items) { const total = items.length, hit = items.filter(item => item.count > 0).length; return { hit, total, percent: percent(hit, total) }; }
function aggregate(files, key) {
  const values = Object.values(files).map(file => file[key]);
  const hit = values.reduce((sum, value) => sum + value.hit, 0);
  const total = values.reduce((sum, value) => sum + value.total, 0);
  return { hit, total, percent: percent(hit, total) };
}
function lineStarts(source) { const starts = [0]; for (let at = 0; at < source.length; at++) if (source[at] === '\n') starts.push(at + 1); return starts; }
function overlaps(range, start, end) { return range.startOffset < end && range.endOffset > start; }

async function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, env: options.env, stdio: 'inherit', timeout: options.timeout ?? 180_000 });
    child.on('error', error => resolve({ status: null, signal: null, error: error.message }));
    child.on('close', (status, signal) => resolve({ status, signal, error: null }));
  });
}

function mergeCoverage(entries) {
  const scripts = new Map();
  for (const entry of entries) for (const script of entry.result ?? []) {
    if (!script.url?.startsWith('file:')) continue;
    const filename = fileURLToPath(script.url);
    const relative = path.relative(root, filename);
    if (!TARGETS.includes(relative)) continue;
    const functions = scripts.get(relative) ?? new Map(); scripts.set(relative, functions);
    for (const fn of script.functions ?? []) {
      if (!fn.functionName) continue; // top-level module execution would falsely cover every line.
      const first = fn.ranges?.[0]; if (!first) continue;
      const key = `${fn.functionName}:${first.startOffset}:${first.endOffset}`;
      const saved = functions.get(key) ?? { name: fn.functionName, range: first, count: 0, ranges: new Map() };
      saved.count = Math.max(saved.count, first.count);
      for (const range of fn.ranges) {
        const rangeKey = `${range.startOffset}:${range.endOffset}`;
        const old = saved.ranges.get(rangeKey) ?? { ...range, count: 0 };
        old.count = Math.max(old.count, range.count); saved.ranges.set(rangeKey, old);
      }
      functions.set(key, saved);
    }
  }
  return scripts;
}

async function summarize(scripts) {
  const files = {};
  for (const target of TARGETS) {
    const source = await fs.readFile(path.join(root, target), 'utf8');
    const functions = [...(scripts.get(target)?.values() ?? [])];
    const ranges = functions.flatMap(fn => [...fn.ranges.values()]);
    const starts = lineStarts(source), lines = [];
    for (let index = 0; index < starts.length; index++) {
      const start = starts[index], end = index + 1 < starts.length ? starts[index + 1] : source.length;
      const text = source.slice(start, end).trim();
      if (!text || text.startsWith('//')) continue;
      const candidates = ranges.filter(range => overlaps(range, start, end));
      if (!candidates.length) continue; // V8 has no source-map-grade statement record for this line.
      const smallest = Math.min(...candidates.map(range => range.endOffset - range.startOffset));
      lines.push({ count: Math.max(...candidates.filter(range => range.endOffset - range.startOffset === smallest).map(range => range.count)) });
    }
    files[target] = {
      functions: metric(functions),
      // V8 exposes nested block ranges, not Istanbul's syntactic branch counter.
      v8BlockRanges: metric(functions.flatMap(fn => [...fn.ranges.values()].filter(range => range.startOffset !== fn.range.startOffset || range.endOffset !== fn.range.endOffset))),
      lines: metric(lines), lineMethod: 'smallest intersecting non-top-level V8 range',
    };
  }
  return files;
}

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('coverage gate requires Node.js 24 built-in V8 coverage');
const coverageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghostflow-v8-coverage-'));
try {
  const result = await run(process.execPath, ['--test', ...TESTS], { env: { ...process.env, NODE_V8_COVERAGE: coverageDir } });
  if (result.status !== 0 || result.error || result.signal) throw new Error(`coverage test allowlist failed: ${result.error ?? result.signal ?? result.status}`);
  const reports = await Promise.all((await fs.readdir(coverageDir)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await fs.readFile(path.join(coverageDir, name), 'utf8'))));
  const files = await summarize(mergeCoverage(reports));
  const totals = {
    functions: aggregate(files, 'functions'),
    lines: aggregate(files, 'lines'),
    v8BlockRanges: aggregate(files, 'v8BlockRanges'),
  };
  const failures = Object.entries(MINIMUM).filter(([key, minimum]) => totals[key].percent < minimum)
    .map(([key, minimum]) => `${key} ${totals[key].percent}% is below ${minimum}%`);
  const report = {
    format: 'GhostFlow/v8-coverage-gate-v1', node: process.version, tests: TESTS, excludedTests: EXCLUDED, targets: TARGETS,
    threshold: MINIMUM, totals,
    note: 'V8 block ranges are engine ranges, not a claim of Istanbul syntactic branch coverage.',
    files,
  };
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  await fs.writeFile(path.join(root, 'build', 'coverage-language.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) throw new Error(`coverage threshold failed: ${failures.join('; ')}`);
} finally {
  await fs.rm(coverageDir, { recursive: true, force: true });
}
