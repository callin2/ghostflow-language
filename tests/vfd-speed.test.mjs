import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { compileSource as compileBrowserSource } from '../tools/browser-toolchain.mjs';
import { verificationSourceHashes } from '../tools/verification-sources.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = new URL('../examples/vfd-speed.input-v1.ghost.md', import.meta.url);
const scenarioPath = new URL('../examples/vfd-speed.input-v1.scenario.json', import.meta.url);
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('canonical VFD source and scenario execute eight independent framed WASM oracles', async () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  assert.equal(scenario.format, 'GhostFlow/vfd-speed-scenario-v1');
  assert.equal(sha256(source), scenario.sourceSha256);
  assert.deepEqual(scenario.inputs, { potentiometer_v: { unit: 'V', min: 0, max: 10 } });
  assert.deepEqual(scenario.outputs, { speed_v: { unit: 'V' }, speed_hz: { unit: 'Hz' } });
  const artifact = await compileSource(source, { filename: 'vfd-speed.input-v1.ghost.md' });
  const browserArtifact = await compileBrowserSource(source, { filename: 'vfd-speed.input-v1.ghost.md' });
  assert.deepEqual([...browserArtifact.bytes], [...artifact.bytes]);
  assert.deepEqual(browserArtifact.manifest, artifact.manifest);
  assert.equal(browserArtifact.sourceDocument.text, source);
  assert.deepEqual(artifact.manifest.sensors.map(({ name, type }) => [name, type]), [
    ['start', 'Bool'], ['stop', 'Bool'], ['potentiometer_v', 'Number'],
  ]);
  assert.deepEqual(artifact.manifest.outputs.map(({ name, type }) => [name, type]), [
    ['run', 'Bool'], ['speed_v', 'Number'], ['speed_hz', 'Number'],
  ]);
  assert.equal(artifact.sourceDocument.text, source);
  const independent = [
    [false, false, 0, false, 0, 0],
    [true, false, 5, true, 5, 25],
    [false, false, 10, true, 10, 50],
    [false, true, 5, false, 5, 25],
    [false, false, 0, false, 0, 0],
    [true, true, 10, false, 10, 50],
    [true, false, 0, true, 0, 0],
    [false, false, 5, true, 5, 25],
  ];

  const wasm = fs.readFileSync(wasmPath);
  const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasm, artifact));
  const observed = [];
  try {
    assert.equal(scenario.frames.length, independent.length);
    for (const [index, { atMs, inputs, expectedSafe }] of scenario.frames.entries()) {
      const [start, stop, potentiometer_v, run, speed_v, speed_hz] = independent[index];
      assert.equal(atMs, index);
      assert.deepEqual(inputs, { start, stop, potentiometer_v });
      assert.deepEqual(expectedSafe, { run, speed_v, speed_hz });
      const result = runtime.step({ nowMs: atMs, inputs });
      assert.deepEqual(result.frame, { scanId: index, logicalTimeMs: atMs });
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
    source: { path: 'examples/vfd-speed.input-v1.ghost.md', sha256: sha256(source) },
    scenario: { path: 'examples/vfd-speed.input-v1.scenario.json', sha256: sha256(fs.readFileSync(scenarioPath)), expected: scenario.frames },
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

test('VFD typed observations distinguish unavailable acquisition, malformed records and Invalid numeric quality', async () => {
  const artifact = await compileSource(fs.readFileSync(sourcePath, 'utf8'), { filename: 'VfdSpeed.input-v1.ghost.md' });
  const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact));
  const valid = { start: false, stop: false, potentiometer_v: 0 };
  try {
    const startup = runtime.step({ nowMs: 0 });
    assert.equal(startup.sensors.potentiometer_v.quality, 'NotReady');
    assert.deepEqual(startup.vm.safe, { run: false, speed_v: 0, speed_hz: 0 });
    const before = structuredClone(runtime.lastFrameOutcome);
    assert.throws(() => runtime.step({ nowMs: 1, inputs: { ...valid, start: 0 } }), /boolean|Bool/);
    assert.throws(() => runtime.step({ nowMs: 1, inputs: { ...valid, potentiometer_v: false } }), /samples\.potentiometer_v\.value must be numeric/);
    assert.deepEqual(runtime.lastFrameOutcome, before);
    const first = runtime.step({ nowMs: 1, inputs: valid });
    assert.equal(first.sensors.potentiometer_v.ok, true);
    assert.equal(first.sensors.potentiometer_v.value, 0);
    assert.deepEqual(first.vm.safe, { run: false, speed_v: 0, speed_hz: 0 });
    for (const [index, invalid] of [Number.NaN, Number.POSITIVE_INFINITY].entries()) {
      const bad = runtime.step({ nowMs: index + 2, inputs: { ...valid, potentiometer_v: invalid } });
      assert.equal(bad.sensors.potentiometer_v.quality, 'Invalid');
      assert.deepEqual(bad.vm.safe, { run: false, speed_v: 0, speed_hz: 0 });
    }
  } finally { runtime.dispose(); }
});

// Preserve independent predecessor source/scenario identities; healthy frame and
// output expectations remain identical in the explicit new revision.
test('VFD migration retains predecessor bytes and the complete healthy replay oracle', () => {
  const current = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  const oldSource = fs.readFileSync(new URL('../examples/vfd-speed.ghost.md', import.meta.url));
  const oldScenario = fs.readFileSync(new URL('../examples/vfd-speed.scenario.json', import.meta.url));
  assert.equal(sha256(oldSource), current.predecessor.sourceSha256);
  assert.equal(sha256(oldScenario), current.predecessor.scenarioSha256);
  assert.equal(current.predecessor.sourceSha256, '3319ddd9e8bd5c486586f4e3e94c3e78f62402c4541a712f97e9509cb5d996c3');
  assert.equal(current.predecessor.scenarioSha256, 'a117f9a20968942aa5afac10218aea5e4666d0f2a445aa05cd4b99550bdeede0');
  assert.deepEqual(current.frames, JSON.parse(oldScenario).frames);
});
