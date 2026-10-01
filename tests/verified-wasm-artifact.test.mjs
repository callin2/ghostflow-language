import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateVerificationReport } from '../tools/package-verified-wasm.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verificationSourceHashes, assertVerificationSources } from '../tools/verification-sources.mjs';

const verifiedWasmWorkflow = fs.readFileSync(new URL('../.github/workflows/verified-wasm.yml', import.meta.url), 'utf8');

test('language verification registers every selected test once', () => {
  const source = fs.readFileSync(new URL('../tools/verify-language.mjs', import.meta.url), 'utf8');
  const list = source.match(/export const LANGUAGE_TESTS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(list, 'explicit language test list is required');
  const entries = [...list[1].matchAll(/'([^']+\.test\.mjs)'/g)].map(match => match[1]);
  assert.ok(entries.length > 0);
  assert.deepEqual(entries, [...new Set(entries)], 'duplicate test registration');
});

function namedStep(workflow, name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `workflow step missing: ${name}`);
  const next = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

function assertVerifiedWasmWorkflowContract(workflow) {
  const pushTrigger = workflow.match(/^  push:\n([\s\S]*?)(?=^  workflow_dispatch:)/m)?.[1] ?? '';
  assert.match(pushTrigger, /^    branches:\n      - main\n      - dev\n/m,
    'verified WASM push trigger must include main and dev');

  // Scope job contracts before locating step names shared by other CI lanes.
  const verifyJob = workflow.match(/^  verify:\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/m)?.[1];
  assert.ok(verifyJob, 'full verified WASM job is required');
  workflow = verifyJob;

  const currentMatrix = workflow.match(/          - label: current\n([\s\S]*?)(?=          - label: frontend-pin)/)?.[1] ?? '';
  assert.match(currentMatrix, /source_sha: .*github\.event_name == 'push' && github\.sha/,
    'current source for push events must be the exact pushed commit SHA');

  assert.match(namedStep(workflow, 'Checkout tested source'), /ref: \$\{\{ matrix\.source_sha \}\}/,
    'tested source checkout must use the selected source SHA');
  const verifyStep = namedStep(workflow, 'Verify tested source commit');
  assert.match(verifyStep, /git rev-parse HEAD/);
  assert.match(verifyStep, /actual_source_sha.*EXPECTED_SOURCE_SHA/,
    'tested checkout must be compared with the selected source SHA');

  const verifyIndex = workflow.indexOf('      - name: Verify tested source commit\n');
  const npmIndex = workflow.indexOf('      - name: Run source verification\n');
  const packageIndex = workflow.indexOf('      - name: Package verified WASM handoff\n');
  assert.ok(verifyIndex !== -1 && npmIndex > verifyIndex && packageIndex > npmIndex,
    'source checkout verification and full source verification must precede packaging');
  const sourceTestStep = namedStep(workflow, 'Run source verification');
  assert.match(sourceTestStep, /working-directory: source/);
  assert.match(sourceTestStep, /run: npm test/,
    'the tested source must pass the full npm test gate');
  const node24Index = workflow.indexOf('      - name: Set up Node.js 24 for current-source coverage\n');
  const coverageIndex = workflow.indexOf('      - name: Run current-source coverage gate\n');
  assert.ok(node24Index > npmIndex && coverageIndex > node24Index && packageIndex > coverageIndex,
    'current-source coverage must run after full verification and before packaging');
  const node24Step = namedStep(workflow, 'Set up Node.js 24 for current-source coverage');
  assert.match(node24Step, /if: \$\{\{ matrix\.label == 'current' \}\}/);
  assert.match(node24Step, /node-version: 24/);
  const coverageStep = namedStep(workflow, 'Run current-source coverage gate');
  assert.match(coverageStep, /if: \$\{\{ matrix\.label == 'current' \}\}/);
  assert.match(coverageStep, /working-directory: source/);
  assert.match(coverageStep, /run: npm run test:coverage/);
  const verifiedNodeStep = namedStep(workflow, 'Set up Node.js 22');
  assert.match(verifiedNodeStep, /\n        id: verified_node\n/);
  const restoreIndex = workflow.indexOf('      - name: Restore verified Node.js for packaging\n');
  assert.ok(restoreIndex > coverageIndex && packageIndex > restoreIndex,
    'the verified Node version must be restored after coverage and before packaging');
  const restoreStep = namedStep(workflow, 'Restore verified Node.js for packaging');
  assert.match(restoreStep, /if: \$\{\{ matrix\.label == 'current' \}\}/);
  assert.match(restoreStep, /node-version: \$\{\{ steps\.verified_node\.outputs\.node-version \}\}/);
}

// Report-validation fixtures only. These tests do not claim to build/run WASM.
const binary = { bytes: 100, sha256: 'a'.repeat(64) };
function fixture() {
  return {
    format: 'GhostFlow/language-verification-v1', scope: 'language-host', passed: true,
    node: 'fixture-node', rustc: 'fixture-rustc', cargo: 'fixture-cargo',
    wasm: { ...binary, builtByThisRun: true },
    sourceSha256: Object.fromEntries(['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json']
      .map(name => [name, 'b'.repeat(64)])),
    gates: [{ passed: true, status: 0, signal: null, command: ['cargo', 'build', '--locked', '--offline',
      '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'] }],
  };
}

test('accepts a matching full-host report shape', () => {
  assert.doesNotThrow(() => validateVerificationReport(fixture(), binary));
});

for (const scope of ['language-node-only', 'plc-curriculum-only']) {
  test(`rejects partial ${scope} evidence even when it passed`, () => {
    assert.throws(() => validateVerificationReport({ ...fixture(), scope }, binary), /full language-host/);
  });
}

test('rejects failed reports and failed, signalled or missing gates', () => {
  assert.throws(() => validateVerificationReport({ ...fixture(), passed: false }, binary), /successful/);
  for (const patch of [{ passed: false }, { status: 1 }, { signal: 'SIGTERM' }, { error: 'timeout' }]) {
    const report = fixture();
    Object.assign(report.gates[0], patch);
    assert.throws(() => validateVerificationReport(report, binary), /gates/);
  }
  assert.throws(() => validateVerificationReport({ ...fixture(), gates: [] }, binary), /gates/);
});

test('rejects a report that did not rebuild the release WASM', () => {
  const report = fixture();
  report.gates[0].command = ['cargo', 'test'];
  assert.throws(() => validateVerificationReport(report, binary), /release WASM build/);
});

test('rejects stale bytes, digest mismatches and reused builds', () => {
  for (const patch of [{ bytes: 101 }, { sha256: 'c'.repeat(64) }, { builtByThisRun: false }]) {
    const report = fixture();
    Object.assign(report.wasm, patch);
    assert.throws(() => validateVerificationReport(report, binary), /WASM bytes/);
  }
});

test('requires toolchain and lockfile provenance', () => {
  const report = fixture();
  delete report.rustc;
  assert.throws(() => validateVerificationReport(report, binary), /rustc/);
  const missingLock = fixture();
  delete missingLock.sourceSha256['Cargo.lock'];
  assert.throws(() => validateVerificationReport(missingLock, binary), /Cargo.lock/);
});

test('handoff rejects omitted, extra and changed source evidence', t => {
  // Filesystem coverage fixture only; no Git checkout, build report or runtime.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-source-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['tools', 'crates/ghostflow-core', 'crates/ghostflow-package',
    'runtimes/wasm', 'data/calendars', 'tests', 'examples', 'docs', 'contracts/integration-v1',
    'contracts/interaction-v0', 'contracts/requirements']) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'fixture.txt'), `fixture ${name}`);
  }
  for (const name of ['runtimes/node/ledger.mjs', 'runtimes/node/calendar.mjs', 'README.md', 'AGENTS.md', '.gitignore',
    'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'Makefile']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), `fixture ${name}`);
  }
  const hashes = verificationSourceHashes(root);
  assert.doesNotThrow(() => assertVerificationSources(root, hashes));
  const omitted = { ...hashes };
  delete omitted['crates/ghostflow-package/fixture.txt'];
  assert.throws(() => assertVerificationSources(root, omitted), /hash set/);
  for (const calendarSource of ['runtimes/node/calendar.mjs', 'data/calendars/fixture.txt']) {
    const missingCalendar = { ...hashes };
    delete missingCalendar[calendarSource];
    assert.throws(() => assertVerificationSources(root, missingCalendar), /hash set/);
  }
  assert.throws(() => assertVerificationSources(root, { ...hashes, 'unknown.txt': 'a'.repeat(64) }), /hash set/);
  fs.writeFileSync(path.join(root, 'runtimes/wasm/fixture.txt'), 'changed fixture');
  assert.throws(() => assertVerificationSources(root, hashes), /source changed/);
  fs.writeFileSync(path.join(root, 'runtimes/wasm/fixture.txt'), 'fixture runtimes/wasm');
  fs.writeFileSync(path.join(root, 'data/calendars/fixture.txt'), 'changed calendar facts');
  assert.throws(() => assertVerificationSources(root, hashes), /source changed/);
  fs.writeFileSync(path.join(root, 'data/calendars/fixture.txt'), 'fixture data/calendars');
  fs.rmSync(path.join(root, 'runtimes/node/calendar.mjs'));
  const historical = verificationSourceHashes(root);
  const historicalExpected = { ...hashes };
  delete historicalExpected['runtimes/node/calendar.mjs'];
  delete historicalExpected['data/calendars/fixture.txt'];
  assert.deepEqual(historical, historicalExpected, 'pre-calendar source graph keeps its original evidence keys');
  fs.rmSync(path.join(root, 'data/calendars'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtimes/node/calendar.mjs'), 'fixture runtimes/node/calendar.mjs');
  assert.throws(() => verificationSourceHashes(root), /ENOENT/, 'current adapter requires its reviewed dataset');
});

test('verified WASM workflow binds full verification to the exact pushed source', () => {
  assert.doesNotThrow(() => assertVerifiedWasmWorkflowContract(verifiedWasmWorkflow));

  const mutations = [
    ['dev push trigger', source => source.replace('      - dev\n', '')],
    ['push source SHA', source => source.replace("github.event_name == 'push' && github.sha", "github.event_name == 'push' && inputs.source_sha")],
    ['tested checkout verification', source => source.replace(/      - name: Verify tested source commit\n[\s\S]*?(?=      - name: Set up Node\.js)/, '')],
    ['full source test gate', source => source.replace('        run: npm test\n', '        run: npm run test:node\n')],
    ['coverage command', source => source.replace('        run: npm run test:coverage\n', '        run: npm test\n')],
    ['coverage matrix condition', source => source.replace(
      "      - name: Run current-source coverage gate\n        if: ${{ matrix.label == 'current' }}",
      "      - name: Run current-source coverage gate\n        if: ${{ success() }}")],
    ['coverage ordering', source => source.replace('Run source verification', 'MOVED')
      .replace('Run current-source coverage gate', 'Run source verification')
      .replace('MOVED', 'Run current-source coverage gate')],
    ['verified Node restoration', source => source.replace(/      - name: Restore verified Node\.js for packaging\n[\s\S]*?(?=      - name: Package verified WASM handoff)/, '')],
    ['verified Node identity', source => source.replace('        id: verified_node\n', '        id: another_node\n')],
    ['restoration condition', source => source.replace(
      "      - name: Restore verified Node.js for packaging\n        if: ${{ matrix.label == 'current' }}",
      "      - name: Restore verified Node.js for packaging\n        if: ${{ success() }}")],
    ['restoration version', source => source.replace('steps.verified_node.outputs.node-version', '24')],
    ['restoration order', source => source.replace('Restore verified Node.js for packaging', 'MOVED')
      .replace('Package verified WASM handoff', 'Restore verified Node.js for packaging')
      .replace('MOVED', 'Package verified WASM handoff')],
  ];

  for (const [name, mutate] of mutations) {
    assert.throws(() => assertVerifiedWasmWorkflowContract(mutate(verifiedWasmWorkflow)), undefined, name);
  }
});
