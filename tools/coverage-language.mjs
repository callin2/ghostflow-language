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
  'tests/signals-wasm.test.mjs', 'tests/station-wasm.test.mjs', 'tests/accounting-wasm.test.mjs', 'tests/toolchain.test.mjs',
  // Compiler diagnostics and temporal lowering suites exercise the public
  // Reference grammar added after the original coverage allowlist.
  'tests/compiler-syntax-diagnostics.test.mjs', 'tests/compiler-syntax-structure.test.mjs',
  'tests/compiler-syntax-boundaries.test.mjs', 'tests/compiler-semantic-diagnostics.test.mjs',
  'tests/compiler-parser-callsites.test.mjs', 'tests/compiler-control-diagnostics-extra.test.mjs',
  'tests/compiler-window-diagnostics.test.mjs', 'tests/compiler-window-byte-limit.test.mjs',
  'tests/compiler-newline-diagnostics.test.mjs', 'tests/compiler-token-limit-diagnostics.test.mjs',
  'tests/date-time-control.test.mjs', 'tests/quantities.test.mjs',
  'tests/result-control.test.mjs', 'tests/result-provenance.test.mjs',
  'tests/source-trace.test.mjs', 'tests/interaction-settings.test.mjs',
  'tests/periodic-cron-policy.test.mjs', 'tests/daily-slots-policy.test.mjs',
  'tests/daily-runtime.test.mjs', 'tests/daily-slots-runtime.test.mjs',
  'tests/solar-control.test.mjs', 'tests/solar-control-runtime.test.mjs',
  'tests/true-for-integration.test.mjs', 'tests/true-for-driver-contract.test.mjs',
  'tests/true-for-profile.test.mjs',
  'tests/control-runtime-atomicity.test.mjs', 'tests/native-dispatch-status.test.mjs',
  'tests/framed-control-host.test.mjs', 'tests/scan-frame-wasm.test.mjs',
  'tests/gfb1-browser.test.mjs', 'tests/core-ir.test.mjs', 'tests/gfb4-browser.test.mjs', 'tests/gfb5-browser.test.mjs',
  'tests/browser-toolchain.test.mjs', 'tests/hold-last-runtime.test.mjs',
  'tests/debounce-runtime.test.mjs', 'tests/duration-runtime.test.mjs',
  'tests/datetime-runtime.test.mjs', 'tests/int-settings-artifacts.test.mjs',
  'tests/int-settings-package.test.mjs', 'tests/operating-settings.test.mjs',
  'tests/composition-execution.test.mjs', 'tests/result-trace-runtime.test.mjs',
  'tests/long-tick-state.test.mjs', 'tests/resource-policy-artifact.test.mjs',
  'tests/compiler-cli-diagnostics.test.mjs', 'tests/compiler-interaction-diagnostics.test.mjs',
  'tests/accounting-syntax.test.mjs', 'tests/gfb5-native.test.mjs', 'tests/gfb6-native.test.mjs',
  'tests/gfb7-pid-contract.test.mjs',
  'tests/output-conformance.test.mjs',
  'tests/after-event-contract.test.mjs', 'tests/natural-condition-contract.test.mjs',
  'tests/after-event-control.test.mjs', 'tests/context-wasm-boundaries.test.mjs',
  'tests/config-native-wasm-parity.test.mjs',
  'tests/macro-composition-contract.test.mjs', 'tests/objective-adapt-structural.test.mjs',
  'tests/import-header.test.mjs', 'tests/import-cli-digest.test.mjs',
  'tests/named-constraints.test.mjs', 'tests/resource-policy.test.mjs',
  'tests/schedule-descriptor-artifact.test.mjs', 'tests/gfb2-int.test.mjs',
  'tests/int-compiler.test.mjs', 'tests/lesson.test.mjs', 'tests/interaction-corpus.test.mjs',
  'tests/temporal-resource-plan-wasm.test.mjs', 'tests/temporal-replay-wasm.test.mjs',
  'tests/core-replay-wasm.test.mjs', 'tests/core-irrigation-proof.test.mjs',
  'tests/range-contract.test.mjs', 'tests/issue-90-settings-stream.test.mjs',
  'tests/state-snapshot-reference.test.mjs', 'tests/solar-provider-wasm.test.mjs',
  'tests/gfb4-window.test.mjs', 'tests/gfb5-schedule.test.mjs',
  'tests/portable-package.test.mjs', 'tests/import-composition.test.mjs',
  'tests/window-control.test.mjs', 'tests/hold-last-control.test.mjs',
  'tests/debounce-control.test.mjs',
  'tests/reference-coverage-gaps.test.mjs',
  'tests/control-source-validation.test.mjs', 'tests/debounce-diagnostics.test.mjs',
  'tests/hold-last-diagnostics.test.mjs',
  'tests/expression-order.test.mjs', 'tests/dynamic-int-conversions.test.mjs',
  'tests/int-division-identity.test.mjs', 'tests/result-control.test.mjs',
  'tests/interaction-runtime-snapshot.test.mjs', 'tests/intent-anchor-map.test.mjs',
  'tests/curriculum-replay.test.mjs', 'tests/scan-tape-parity.test.mjs',
  'tests/source-dependencies.test.mjs', 'tests/temporal-descriptor-artifact.test.mjs',
  'tests/window-derived-control.test.mjs', 'tests/window-derived-host.test.mjs',
  'tests/window-derived-package.test.mjs', 'tests/window-derived-provenance.test.mjs',
  'tests/window-framed-native.test.mjs', 'tests/window-host.test.mjs',
  'tests/window-native.test.mjs', 'tests/window-package.test.mjs',
  'tests/window-provenance.test.mjs', 'tests/time-slots-config.test.mjs',
  'tests/compiler-schedule-duplicates.test.mjs', 'tests/interaction-contract.test.mjs',
  'tests/interaction-counter.test.mjs', 'tests/interaction-emission.test.mjs',
  'tests/hold-last-provenance.test.mjs', 'tests/debounce-provenance.test.mjs',
  'tests/solar-scanframe-native-wasm.test.mjs', 'tests/gfb1-golden.test.mjs',
  'tests/int-operating-settings.test.mjs',
  'tests/accounting-wasm.test.mjs', 'tests/after-event-wasm.test.mjs',
  'tests/lesson-boundaries.test.mjs', 'tests/operating-settings.test.mjs',
  'tests/schedule.test.mjs',
  'tests/coverage-malformed-runtime.test.mjs',
  'tests/deferred-runtime-gates.test.mjs',
  'tests/coverage-defensive-runtime.test.mjs',
  'tests/natural-schedule-contract.test.mjs', 'tests/solar-schedule.test.mjs',
  'tests/time-literals.test.mjs',
  'tests/true-for-lowering.test.mjs', 'tests/true-for-wasm.test.mjs',
  'tests/verified-wasm-artifact.test.mjs', 'tests/window-wasm.test.mjs',
]);
const TARGETS = Object.freeze([
  'tools/int-settings.mjs',
  'tools/control.mjs', 'tools/gfb1.mjs', 'tools/core-ir.mjs', 'tools/literate.mjs', 'tools/toolchain.mjs',
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

function mergeCoverage(entries, sourceLengths) {
  const scripts = new Map();
  for (const entry of entries) for (const script of entry.result ?? []) {
    if (!script.url?.startsWith('file:')) continue;
    const filename = fileURLToPath(script.url);
    const relative = path.relative(root, filename);
    if (!TARGETS.includes(relative)) continue;
    // Only on-disk source offsets may contribute to a real target. Browser VM
    // transforms also have distinct synthetic URLs in their harnesses.
    if (script.functions?.[0]?.ranges?.[0]?.endOffset !== sourceLengths.get(relative)) continue;
    const functions = scripts.get(relative) ?? new Map(); scripts.set(relative, functions);
    for (const fn of script.functions ?? []) {
      if (!fn.functionName) continue; // top-level module execution would falsely cover every line.
      const first = fn.ranges?.[0]; if (!first) continue;
      const key = `${fn.functionName}:${first.startOffset}:${first.endOffset}`;
      const saved = functions.get(key) ?? { name: fn.functionName, range: first, count: 0, ranges: new Map(), partitions: [] };
      saved.count = Math.max(saved.count, first.count);
      saved.partitions.push(fn.ranges);
      for (const range of fn.ranges) {
        const rangeKey = `${range.startOffset}:${range.endOffset}`;
        const old = saved.ranges.get(rangeKey) ?? { ...range, count: 0 };
        old.count = Math.max(old.count, range.count); saved.ranges.set(rangeKey, old);
      }
      functions.set(key, saved);
    }
  }
  // V8 may emit a zero-count child range in one process and only a positive
  // enclosing range in another. The missing child inherits that process's
  // closest enclosing count; maxing identical range keys alone undercounts it.
  for (const functions of scripts.values()) for (const fn of functions.values()) {
    for (const range of fn.ranges.values()) {
      range.count = Math.max(...fn.partitions.map(partition => {
        const enclosing = partition.filter(candidate => candidate.startOffset <= range.startOffset
          && candidate.endOffset >= range.endOffset);
        const narrowest = Math.min(...enclosing.map(candidate => candidate.endOffset - candidate.startOffset));
        return Math.max(...enclosing.filter(candidate => candidate.endOffset - candidate.startOffset === narrowest)
          .map(candidate => candidate.count));
      }));
    }
    delete fn.partitions;
  }
  return scripts;
}

function requireRealReports(scripts, targets = TARGETS) {
  for (const target of targets) {
    if (!scripts.has(target)) throw new Error(`coverage has no real-source report for ${target}`);
  }
}

export { mergeCoverage, requireRealReports };

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

async function main() {
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('coverage gate requires Node.js 24 built-in V8 coverage');
const coverageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghostflow-v8-coverage-'));
try {
  // Artifact-writer tests create temporary files beneath this ignored directory.
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const result = await run(process.execPath, ['--test', ...TESTS], { env: { ...process.env, NODE_V8_COVERAGE: coverageDir } });
  if (result.status !== 0 || result.error || result.signal) throw new Error(`coverage test allowlist failed: ${result.error ?? result.signal ?? result.status}`);
  const reports = await Promise.all((await fs.readdir(coverageDir)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await fs.readFile(path.join(coverageDir, name), 'utf8'))));
  const sourceLengths = new Map(await Promise.all(TARGETS.map(async target =>
    [target, (await fs.readFile(path.join(root, target), 'utf8')).length])));
  const scripts = mergeCoverage(reports, sourceLengths);
  requireRealReports(scripts);
  const files = await summarize(scripts);
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
