import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const sourcePath = new URL('../examples/vfd-speed.ghost.md', import.meta.url);
const scenarioPath = new URL('../examples/vfd-speed.scenario.json', import.meta.url);
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);

test('canonical VFD program replays eight sequential frames in official WASM', async () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  assert.equal(scenario.format, 'GhostFlow/vfd-speed-scenario-v1');
  assert.equal(createHash('sha256').update(source).digest('hex'), scenario.sourceSha256);
  assert.deepEqual(scenario.inputs, { potentiometer_v: { unit: 'V', min: 0, max: 10 } });
  assert.deepEqual(scenario.outputs, { speed_v: { unit: 'V' }, speed_hz: { unit: 'Hz' } });
  const artifact = await compileSource(source, { filename: 'VfdSpeed.ghost.md' });
  assert.deepEqual(artifact.manifest.inputs.map(({ name, type }) => [name, type]), [
    ['start', 'Bool'], ['stop', 'Bool'], ['potentiometer_v', 'Number'],
  ]);
  assert.deepEqual(artifact.manifest.outputs.map(({ name, type }) => [name, type]), [
    ['run', 'Bool'], ['speed_v', 'Number'], ['speed_hz', 'Number'],
  ]);

  const runtime = await ControlRuntime.instantiateSimulation(fs.readFileSync(wasmPath), artifact);
  try {
    assert.equal(scenario.frames.length, 8);
    for (const { atMs, inputs, expectedSafe } of scenario.frames) {
      const result = runtime.step({ nowMs: atMs, inputs });
      assert.deepEqual(result.vm.safe, expectedSafe, `frame ${atMs}`);
    }
  } finally {
    runtime.dispose();
  }
});
