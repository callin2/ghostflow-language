import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/browser-toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const sourcePath = new URL('../examples/vfd-speed.ghost.md', import.meta.url);
const scenarioPath = new URL('../examples/vfd-speed.scenario.json', import.meta.url);
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);

test('canonical VFD source and scenario execute eight independent framed WASM oracles', async t => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  assert.equal(scenario.format, 'GhostFlow/vfd-speed-scenario-v1');
  assert.equal(createHash('sha256').update(source).digest('hex'), scenario.sourceSha256);
  assert.deepEqual(scenario.inputs, { potentiometer_v: { unit: 'V', min: 0, max: 10 } });
  assert.deepEqual(scenario.outputs, { speed_v: { unit: 'V' }, speed_hz: { unit: 'Hz' } });
  const artifact = await compileSource(source, { filename: 'vfd-speed.ghost.md' });
  assert.deepEqual(artifact.manifest.inputs.map(({ name, type }) => [name, type]), [
    ['start', 'Bool'], ['stop', 'Bool'], ['potentiometer_v', 'Number'],
  ]);
  assert.deepEqual(artifact.manifest.outputs.map(({ name, type }) => [name, type]), [
    ['run', 'Bool'], ['speed_v', 'Number'], ['speed_hz', 'Number'],
  ]);
  assert.equal(artifact.sourceDocument.text, source);
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact);
  t.after(() => runtime.dispose());
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
  assert.equal(scenario.frames.length, independent.length);
  for (const [index, frame] of scenario.frames.entries()) {
    const [start, stop, potentiometer_v, run, speed_v, speed_hz] = independent[index];
    assert.equal(frame.atMs, index);
    assert.deepEqual(frame.inputs, { start, stop, potentiometer_v });
    assert.deepEqual(frame.expectedSafe, { run, speed_v, speed_hz });
    const actual = runtime.step({ nowMs: frame.atMs, inputs: frame.inputs });
    assert.deepEqual(actual.frame, { scanId: index, logicalTimeMs: frame.atMs });
    assert.deepEqual(actual.vm.safe, frame.expectedSafe, `frame ${index}`);
  }
});
