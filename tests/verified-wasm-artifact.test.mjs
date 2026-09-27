import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateVerificationReport } from '../tools/package-verified-wasm.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verificationSourceHashes, assertVerificationSources } from '../tools/verification-sources.mjs';

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
    'runtimes/wasm', 'tests', 'examples', 'docs', 'contracts/integration-v1',
    'contracts/interaction-v0', 'contracts/requirements']) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'fixture.txt'), `fixture ${name}`);
  }
  for (const name of ['runtimes/node/ledger.mjs', 'README.md', 'AGENTS.md', '.gitignore',
    'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'Makefile']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), `fixture ${name}`);
  }
  const hashes = verificationSourceHashes(root);
  assert.doesNotThrow(() => assertVerificationSources(root, hashes));
  const omitted = { ...hashes };
  delete omitted['crates/ghostflow-package/fixture.txt'];
  assert.throws(() => assertVerificationSources(root, omitted), /hash set/);
  assert.throws(() => assertVerificationSources(root, { ...hashes, 'unknown.txt': 'a'.repeat(64) }), /hash set/);
  fs.writeFileSync(path.join(root, 'runtimes/wasm/fixture.txt'), 'changed fixture');
  assert.throws(() => assertVerificationSources(root, hashes), /source changed/);
});

test('current-source WASM CI runs the coverage gate after verification and before packaging', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/verified-wasm.yml', import.meta.url), 'utf8');
  const check = source => {
    const steps = source.split(/^      - name: /m).slice(1);
    const names = steps.map(step => step.split('\n', 1)[0]);
    const verified = names.indexOf('Run source verification');
    const node24 = names.indexOf('Set up Node.js 24 for current-source coverage');
    const covered = names.indexOf('Run current-source coverage gate');
    const packaged = names.indexOf('Package verified WASM handoff');
    assert.ok(verified >= 0 && node24 > verified && covered > node24 && packaged > covered,
      'coverage must follow source verification and precede packaging');
    assert.match(steps[node24], /\n        if: \$\{\{ matrix\.label == 'current' \}\}\n/);
    assert.match(steps[node24], /\n          node-version: 24\n/);
    const coverage = steps[covered];
    assert.match(coverage, /\n        if: \$\{\{ matrix\.label == 'current' \}\}\n/);
    assert.match(coverage, /\n        working-directory: source\n/);
    assert.match(coverage, /\n        run: npm run test:coverage\n/);
  };
  check(workflow);
  assert.throws(() => check(workflow.replace('run: npm run test:coverage', 'run: npm test')));
  assert.throws(() => check(workflow.replace(
    "      - name: Run current-source coverage gate\n        if: ${{ matrix.label == 'current' }}",
    "      - name: Run current-source coverage gate\n        if: ${{ success() }}")));
  assert.throws(() => check(workflow.replace('Run source verification', 'MOVED')
    .replace('Run current-source coverage gate', 'Run source verification')
    .replace('MOVED', 'Run current-source coverage gate')));
});
