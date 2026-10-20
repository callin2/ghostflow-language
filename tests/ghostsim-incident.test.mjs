import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { captureIncident, replayIncident } from '../tools/ghostsim-incident.mjs';
import { runScenario } from '../tools/ghostsim.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-replay-'));
  try {
    const artifact = path.join(dir, 'original.gfb');
    const compiled = await compileSource('```ghost\ncontrol Constant { output active: Bool; active <- true; }\n```\n', { filename: 'original.ghost.md' });
    writeArtifact(compiled, artifact);
    const scenario = path.join(dir, 'scenario.toon');
    fs.writeFileSync(scenario, encode({ format: 'GhostFlow/scenario-v1', id: 'synthetic-incident', initialInputs: [], keyBindings: [],
      actions: [{ kind: 'scan', atMs: 0 }, { kind: 'scan', atMs: 10 }] }) + '\n');
    const bundle = path.join(dir, 'bundle');
    const captured = captureIncident({ artifactPath: artifact, scenarioPath: scenario, directory: bundle });
    assert.equal(captured.outcome, 'captured');
    await fn({ dir, artifact, scenario, bundle, compiled, captured });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function amendManifest(bundle, fn) {
  const file = path.join(bundle, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file)); fn(manifest);
  const bytes = json(manifest); fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(bundle, 'manifest.sha256'), sha(bytes) + '\n');
}

function amendRecord(bundle, fn) {
  const file = path.join(bundle, 'record.json');
  const value = JSON.parse(fs.readFileSync(file)); fn(value);
  const bytes = json(value); fs.writeFileSync(file, bytes);
  amendManifest(bundle, m => { const item = m.artifacts.find(x => x.name === 'record.json'); item.sha256 = sha(bytes); item.bytes = bytes.length; });
}

test('same self-contained incident replays identically without using original input paths', async () => fixture(({ artifact, scenario, bundle, captured }) => {
  fs.unlinkSync(artifact); fs.unlinkSync(scenario);
  const first = replayIncident({ directory: bundle });
  assert.equal(first.outcome, 'completed');
  assert.equal(first.matched, true);
  assert.deepEqual(first, replayIncident({ directory: bundle }));
  assert.deepEqual(first.scans.map(s => [s.scanId, s.logicalTimeMs, s.safeVirtualIntent.active]), [[0, 0, true], [1, 10, true]]);
  assert.equal(first.identity.runId, captured.identity.runId);
  assert.equal(first.identity.bootId, captured.identity.bootId);
  assert.match(first.evidenceMeaning, /no physical/i);
}));

test('changed candidate reports output differences at the original logical scans and source identities', async () => fixture(async ({ dir, bundle }) => {
  const candidate = path.join(dir, 'candidate.gfb');
  writeArtifact(await compileSource('```ghost\ncontrol Constant { output active: Bool; active <- false; }\n```\n', { filename: 'candidate.ghost.md' }), candidate);
  const compared = replayIncident({ directory: bundle, candidatePath: candidate });
  assert.equal(compared.outcome, 'compared');
  assert.equal(compared.matched, true, 'original reproduction is independent of candidate equality');
  assert.equal(compared.candidate.equivalent, false);
  assert.deepEqual(compared.candidate.differences.map(d => [d.scanId, d.logicalTimeMs, d.channel, d.original, d.candidate]), [[0, 0, 'active', true, false], [1, 10, 'active', true, false]]);
  assert.notEqual(compared.source.sourceDocumentSha256, compared.candidate.source.sourceDocumentSha256);
}));

test('missing artifact is partial while corruption is rejected before execution', async () => fixture(({ bundle }) => {
  const file = path.join(bundle, 'program.gfb'); const original = fs.readFileSync(file);
  fs.unlinkSync(file);
  let ran = false;
  const missing = replayIncident({ directory: bundle }, { runner: () => { ran = true; } });
  assert.equal(missing.outcome, 'partial'); assert.equal(ran, false);
  assert.ok(missing.gaps.includes('artifact-missing'));
  fs.writeFileSync(file, Buffer.concat([original, Buffer.from([0])]));
  const corrupt = replayIncident({ directory: bundle }, { runner: () => { ran = true; } });
  assert.equal(corrupt.outcome, 'rejected'); assert.equal(corrupt.error.code, 'artifact-integrity-mismatch'); assert.equal(ran, false);
}));

test('runtime revision mismatch is explicit and does not silently choose a different runner', async () => fixture(({ bundle }) => {
  amendManifest(bundle, m => { m.runtime.hostSha256 = '0'.repeat(64); });
  let ran = false;
  const result = replayIncident({ directory: bundle }, { runner: () => { ran = true; } });
  assert.equal(result.outcome, 'rejected'); assert.equal(result.error.code, 'runtime-revision-mismatch'); assert.equal(ran, false);
}));

test('execution uses the verified snapshot even if original bundle files change at runner entry', async () => fixture(({ bundle }) => {
  const result = replayIncident({ directory: bundle }, { runner: (artifact, scenario, options) => {
    fs.writeFileSync(path.join(bundle, 'program.gfb'), 'replaced after verification');
    fs.writeFileSync(path.join(bundle, 'scenario.toon'), 'replaced after verification');
    return runScenario(artifact, scenario, options);
  } });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.matched, true);
}));

test('helper-only host revision changes reject before executing the recorded incident', async () => fixture(({ dir, bundle }) => {
  const copy = path.join(dir, 'host'); fs.mkdirSync(copy);
  for (const name of ['tools', 'runtimes', 'contracts']) fs.cpSync(path.join(root, name), path.join(copy, name), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'target/release/examples/scenario_scan']) {
    fs.mkdirSync(path.dirname(path.join(copy, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(copy, name));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  const cli = path.join(copy, 'tools/ghostsim-incident.mjs');
  const before = spawnSync(process.execPath, [cli, 'replay', bundle], { encoding: 'utf8', timeout: 10000 });
  assert.equal(before.status, 0, before.stdout + before.stderr);
  assert.equal(JSON.parse(before.stdout).matched, true);
  fs.appendFileSync(path.join(copy, 'tools/software-input-producer.mjs'), '\n// changed helper revision\n');
  const after = spawnSync(process.execPath, [cli, 'replay', bundle], { encoding: 'utf8', timeout: 10000 });
  assert.equal(after.status, 1, after.stderr);
  assert.equal(JSON.parse(after.stdout).error.code, 'runtime-revision-mismatch');
}));

test('unknown initial state is partial, never supplied from current defaults', async () => fixture(({ bundle }) => {
  amendManifest(bundle, m => { delete m.capture.initialState; });
  let ran = false;
  const result = replayIncident({ directory: bundle }, { runner: () => { ran = true; } });
  assert.equal(result.outcome, 'partial'); assert.ok(result.gaps.includes('initial-state-unknown')); assert.equal(ran, false);
}));

test('scan gaps, backward clock and a boot boundary cannot be repaired by interpolation', async () => {
  for (const [mutate, code] of [
    [r => { r.scans[1].scanId += 1; }, 'scan-sequence-gap'],
    [r => { r.scans[1].logicalTimeMs = -1; }, 'clock-boundary'],
    [r => { r.scans[1].bootId = 'different-boot'; }, 'boot-boundary'],
  ]) await fixture(({ bundle }) => {
    amendRecord(bundle, mutate);
    const result = replayIncident({ directory: bundle });
    assert.equal(result.outcome, 'rejected'); assert.equal(result.error.code, code);
  });
});

test('missing state observation and changed recorded decisions remain distinct from successful reproduction', async () => {
  await fixture(({ bundle }) => {
    amendRecord(bundle, r => { delete r.scans[0].stateBefore; });
    const result = replayIncident({ directory: bundle });
    assert.equal(result.outcome, 'partial'); assert.ok(result.gaps.includes('initial-state-unknown'));
  });
  await fixture(({ bundle }) => {
    amendRecord(bundle, r => { r.scans[1].safeVirtualIntent.active = false; });
    const result = replayIncident({ directory: bundle });
    assert.equal(result.outcome, 'rejected'); assert.equal(result.error.code, 'recorded-execution-mismatch');
  });
});

test('symlinked artifacts cannot read outside the supplied incident directory', async () => fixture(({ bundle, artifact }) => {
  fs.unlinkSync(path.join(bundle, 'program.gfb')); fs.symlinkSync(artifact, path.join(bundle, 'program.gfb'));
  const result = replayIncident({ directory: bundle });
  assert.equal(result.outcome, 'rejected'); assert.equal(result.error.code, 'invalid-artifact-file');
}));

test('FIFO artifacts reject promptly instead of blocking on open', async () => fixture(({ bundle }) => {
  const file = path.join(bundle, 'program.gfb'); fs.unlinkSync(file);
  assert.equal(spawnSync('mkfifo', [file]).status, 0);
  const result = spawnSync(process.execPath, [path.join(root, 'tools/ghostsim-incident.mjs'), 'replay', bundle], { encoding: 'utf8', timeout: 2000 });
  assert.equal(result.status, 1, result.error?.message ?? result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'invalid-artifact-file');
}));

test('historical System v1 envelope is integrity-checked and stays partial even if replay.available claims true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'historical-incident-'));
  try {
    const payload = Buffer.from('{}\n'); fs.writeFileSync(path.join(dir, 'evidence.json'), payload);
    const manifest = { schema: 'FarmStudio/incident-bundle-v1', version: 1, artifacts: [{ name: 'evidence.json', status: 'present', bytes: payload.length, sha256: sha(payload) },
      { name: 'bytecode.gfb', status: 'absent', sha256: 'a'.repeat(64) }], gaps: ['initial-state-unknown', 'observation-times-absent'], replay: { available: true } };
    fs.writeFileSync(path.join(dir, 'manifest.json'), json(manifest));
    fs.writeFileSync(path.join(dir, 'manifest.sha256'), sha(json(manifest)) + '\n');
    const result = replayIncident({ directory: dir });
    assert.equal(result.outcome, 'partial'); assert.deepEqual(result.scans, []);
    assert.ok(result.gaps.includes('initial-state-unknown')); assert.ok(result.gaps.includes('artifact-missing'));
    fs.writeFileSync(path.join(dir, 'evidence.json'), 'changed');
    assert.equal(replayIncident({ directory: dir }).error.code, 'artifact-integrity-mismatch');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('native completed-scan decisions agree with the existing WASM core for the synthetic constant fixture', async () => fixture(async ({ bundle, compiled }) => {
  const result = replayIncident({ directory: bundle });
  assert.equal(result.runtime.engine, 'native');
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')), compiled);
  try {
    for (const scan of result.scans) {
      const expected = runtime.step({ nowMs: scan.logicalTimeMs });
      assert.deepEqual(scan.safeVirtualIntent, expected.vm.safe);
      assert.deepEqual(scan.requestedVirtualIntent, expected.vm.requested);
      assert.deepEqual(scan.stateBefore, expected.vm.stateBefore);
      assert.deepEqual(scan.stateAfter, expected.vm.stateAfter);
    }
  } finally { runtime.dispose(); }
}));

test('CLI serializes only deterministic result JSON and returns nonzero for incomplete evidence', async () => fixture(({ bundle }) => {
  const cli = path.join(root, 'tools/ghostsim-incident.mjs');
  const result = spawnSync(process.execPath, [cli, 'replay', bundle], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).matched, true);
  amendManifest(bundle, m => { delete m.capture.initialState; });
  const partial = spawnSync(process.execPath, [cli, 'replay', bundle], { encoding: 'utf8', timeout: 10000 });
  assert.equal(partial.status, 2); assert.equal(JSON.parse(partial.stdout).outcome, 'partial');
}));
