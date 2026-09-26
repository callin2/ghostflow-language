import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { verificationSourceHashes } from '../tools/verification-sources.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = new URL('../examples/vfd-speed.ghost.md', import.meta.url);
const scenarioPath = new URL('../examples/vfd-speed.scenario.json', import.meta.url);
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('canonical VFD program replays eight sequential frames in official WASM', async () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  assert.equal(scenario.format, 'GhostFlow/vfd-speed-scenario-v1');
  assert.equal(sha256(source), scenario.sourceSha256);
  assert.deepEqual(scenario.inputs, { potentiometer_v: { unit: 'V', min: 0, max: 10 } });
  assert.deepEqual(scenario.outputs, { speed_v: { unit: 'V' }, speed_hz: { unit: 'Hz' } });
  const artifact = await compileSource(source, { filename: 'VfdSpeed.ghost.md' });
  assert.deepEqual(artifact.manifest.inputs.map(({ name, type }) => [name, type]), [
    ['start', 'Bool'], ['stop', 'Bool'], ['potentiometer_v', 'Number'],
  ]);
  assert.deepEqual(artifact.manifest.outputs.map(({ name, type }) => [name, type]), [
    ['run', 'Bool'], ['speed_v', 'Number'], ['speed_hz', 'Number'],
  ]);

  const wasm = fs.readFileSync(wasmPath);
  const runtime = await ControlRuntime.instantiateSimulation(wasm, artifact);
  const observed = [];
  try {
    assert.equal(scenario.frames.length, 8);
    for (const { atMs, inputs, expectedSafe } of scenario.frames) {
      const result = runtime.step({ nowMs: atMs, inputs });
      assert.deepEqual(result.vm.safe, expectedSafe, `frame ${atMs}`);
      observed.push({ atMs, inputs, vm: result.vm });
    }
  } finally {
    runtime.dispose();
  }

  // Keep expected scenario rows separate from the runtime's observed VM trace.
  const sourceHashes = verificationSourceHashes(root);
  const evidence = {
    format: 'GhostFlow/vfd-speed-observed-v1',
    generatedAt: new Date().toISOString(),
    virtualOnly: true,
    source: { path: 'examples/vfd-speed.ghost.md', sha256: sha256(source) },
    scenario: { path: 'examples/vfd-speed.scenario.json', sha256: sha256(fs.readFileSync(scenarioPath)), expected: scenario.frames },
    compiler: {
      gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceTreeSha256: sha256(JSON.stringify(sourceHashes)),
      sourceHashes: Object.keys(sourceHashes).length,
    },
    bytecode: { bytes: artifact.bytes.length, sha256: sha256(artifact.bytes), manifestFormat: artifact.manifest.format },
    wasm: { bytes: wasm.length, sha256: sha256(wasm) },
    observed,
  };
  const runDir = new URL('../build/vfd-speed-runs/', import.meta.url);
  fs.mkdirSync(runDir, { recursive: true });
  const runName = `${evidence.generatedAt.replaceAll(':', '-')}-${randomUUID()}.json`;
  fs.writeFileSync(new URL(runName, runDir), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
});

test('VFD typed inputs reject missing and invalid values before a scan', async () => {
  const artifact = await compileSource(fs.readFileSync(sourcePath, 'utf8'), { filename: 'VfdSpeed.ghost.md' });
  const runtime = await ControlRuntime.instantiateSimulation(fs.readFileSync(wasmPath), artifact);
  const valid = { start: false, stop: false, potentiometer_v: 0 };
  try {
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: false, stop: false } }), /missing input potentiometer_v/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { stop: false, potentiometer_v: 0 } }), /missing input start/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { ...valid, start: 0 } }), /inputs.start must be boolean/);
    for (const invalid of [false, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => runtime.step({ nowMs: 0, inputs: { ...valid, potentiometer_v: invalid } }), /inputs.potentiometer_v must be finite/);
    }
    assert.equal(runtime.runtime.journalLength, 0);
    const first = runtime.step({ nowMs: 0, inputs: valid });
    assert.deepEqual(first.vm.safe, { run: false, speed_v: 0, speed_hz: 0 });
    assert.equal(typeof first.vm.inputs.potentiometer_v, 'number');
    assert.equal(runtime.runtime.journalLength, 1);
  } finally {
    runtime.dispose();
  }
});
