import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource, writeArtifact, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const load = async name => {
  const filename = `examples/${name}.ghost.md`;
  return compileSource(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
};
const baseline = await load('optional-feedback-timer');
const adopted = await load('explicit-feedback-adoption');
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const capability = { kind: 'sensor', name: 'observation', type: 'Bool' };
// Identical requests and observations. Inhibition must not extend the interval.
const frames = [[0, null, false], [100, 'Good', true], [200, 'Good', false],
  [300, 'Disconnected', false], [400, 'Good', true], [1999, 'Good', true], [2000, 'Good', true]];
const sample = (id, nowMs, quality, value) => ({ epoch: 1, id, timestampMs: nowMs, quality, value });
async function replay(artifact, capabilities = [capability]) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities });
  try {
    return frames.map(([nowMs, quality, value], id) => runtime.step({ nowMs, inputs: { run_request: true },
      samples: quality && capabilities.length ? { observation: sample(id + 1, nowMs, quality, value) } : {} }));
  } finally { runtime.dispose(); }
}

test('same observation replay changes outputs only in the explicitly authored feedback policy', async () => {
  const observed = await replay(baseline);
  const inhibited = await replay(adopted);
  assert.deepEqual(observed.map(o => o.vm.requested.drive), [true, true, true, true, true, true, false]);
  assert.deepEqual(inhibited.map(o => o.vm.requested.drive), [false, true, false, false, true, true, false]);
  assert.deepEqual(inhibited.map(o => o.vm.safe.drive), inhibited.map(o => o.vm.requested.drive));
  assert.deepEqual(observed.map(o => o.sensors.observation), inhibited.map(o => o.sensors.observation));
  assert.equal(inhibited[0].sensors.observation.quality, 'NotReady');
  assert.equal(inhibited[3].sensors.observation.quality, 'Disconnected');
  assert.deepEqual((await replay(baseline, [])).map(o => o.vm.safe.drive), observed.map(o => o.vm.safe.drive));
});

test('required sensor without samples stays NotReady and never selects an observation-only policy', async () => {
  const runtime = await ControlRuntime.instantiateFramed(wasm, adopted, { capabilities: [] });
  try {
    const result = runtime.step({ nowMs: 0, inputs: { run_request: true } });
    assert.equal(result.sensors.observation.quality, 'NotReady');
    assert.equal(result.vm.requested.drive, false);
    assert.equal(result.vm.safe.drive, false);
    assert.throws(() => runtime.step({ nowMs: 1, inputs: { run_request: true }, samples: { unknown: sample(1, 1, 'Good', true) } }), /unknown sensor unknown/);
  } finally { runtime.dispose(); }
  await assert.rejects(ControlRuntime.instantiateFramed(wasm, adopted,
    { capabilities: [{ ...capability, type: 'Number' }] }), /type mismatch/);
});

test('replay retains canonical adoption identity and rejects a mismatched source revision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-feedback-identity-'));
  try {
    const output = path.join(directory, 'adopted.gfb');
    writeArtifact(adopted, output);
    const map = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
    const original = verifyArtifactSourceMap(map, adopted.bytes, { manifest: adopted.manifest,
      expectedSourceSha256: adopted.sourceDocument.sha256 });
    assert.equal(original.sha256, adopted.sourceDocument.sha256);
    assert.notEqual(adopted.sourceDocument.sha256, baseline.sourceDocument.sha256);
    assert.throws(() => verifyArtifactSourceMap(map, adopted.bytes, { manifest: adopted.manifest,
      expectedSourceSha256: baseline.sourceDocument.sha256 }), /expected revision/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native accepted frames match adopted WASM decisions and incomplete evidence is rejected', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-feedback-adoption-'));
  try {
    const module = path.join(directory, 'module.gfb');
    const tape = path.join(directory, 'frames.csv');
    const sensor = adopted.manifest.sensors[0];
    fs.writeFileSync(module, adopted.bytes);
    fs.writeFileSync(tape, `scan_id,logical_time_ms,run_request,${sensor.valueInput},${sensor.okInput},${sensor.faultInput}\n` +
      frames.map(([time, quality, value], id) => [id, time, true, value, quality === 'Good', quality === 'Disconnected' ? 0 : 3].join(',')).join('\n') + '\n');
    const native = new URL('../target/release/examples/scan_adapter', import.meta.url);
    const result = spawnSync(native.pathname, [module, tape], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    const outcomes = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const host = await replay(adopted);
    assert.deepEqual(outcomes.map(o => o.trace.requested.drive), host.map(o => o.vm.requested.drive));
    assert.deepEqual(outcomes.map(o => o.trace.safe.drive), host.map(o => o.vm.safe.drive));
    fs.writeFileSync(tape, 'scan_id,logical_time_ms,run_request\n0,0,true\n');
    const missing = spawnSync(native.pathname, [module, tape], { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /complete inputs|missing input/);
    assert.equal(missing.stdout, '', 'no weaker-policy decision is produced');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
