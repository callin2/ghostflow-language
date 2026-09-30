import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const filename = 'examples/optional-feedback-timer.ghost.md';
const artifact = await compileSource(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const observation = { kind: 'sensor', name: 'observation', type: 'Bool' };
// First start, exact deadline, maintained true, stop/restart and early stop.
const scans = [[0, false], [100, true], [101, true], [2099, true], [2100, true],
  [2500, true], [2600, false], [2700, true], [4699, true], [4700, true],
  [4800, false], [4900, true], [5000, false], [5100, true]];
const expected = [false, true, true, true, false, false, false, true, true, false, false, true, false, true];

async function replay(quality, value) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: quality ? [observation] : [] });
  try {
    return scans.map(([nowMs, run_request], index) => runtime.step({ nowMs, inputs: { run_request },
      samples: quality ? { observation: { epoch: 1, id: index + 1, timestampMs: nowMs, quality, value } } : {} }));
  } finally { runtime.dispose(); }
}

for (const [quality, value] of [[null, false], ['Good', true], ['Good', false],
  ['Disconnected', false], ['Invalid', false], ['NotReady', false]]) {
  test(`timer actuator replay is unchanged by ${quality ?? 'absent'} observation ${value}`, async () => {
    const outcomes = await replay(quality, value);
    assert.deepEqual(outcomes.map(o => o.vm.requested.drive), expected);
    assert.deepEqual(outcomes.map(o => o.vm.safe.drive), expected);
    for (const outcome of outcomes) {
      assert.equal(outcome.vm.strategy, quality ? 'Observed' : 'Baseline');
      if (!quality) {
        // The host conditions all declared sensors; capability absence is
        // represented by activation, not this unpopulated reading placeholder.
        assert.equal(outcome.sensors.observation.quality, 'NotReady');
        assert.equal(outcome.sensors.observation.ok, false);
      }
      else {
        assert.equal(outcome.sensors.observation.quality, quality);
        assert.equal(outcome.sensors.observation.ok, quality === 'Good');
        if (quality === 'Good') assert.equal(outcome.sensors.observation.value, value);
      }
    }
  });
}

test('installed observation expiry and recovery do not restart the timer', async () => {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [observation] });
  try {
    const initial = runtime.step({ nowMs: 0, inputs: { run_request: true } });
    assert.equal(initial.sensors.observation.quality, 'NotReady');
    assert.equal(initial.vm.safe.drive, true, 'a new runtime starts a fresh true interval');
    const sample = (id, timestampMs, value) => ({ epoch: 1, id, timestampMs, quality: 'Good', value });
    const healthy = runtime.step({ nowMs: 1, inputs: { run_request: true }, samples: { observation: sample(1, 1, true) } });
    assert.equal(healthy.sensors.observation.quality, 'Good');
    const stale = runtime.step({ nowMs: 3001, inputs: { run_request: true } });
    assert.equal(stale.sensors.observation.quality, 'Stale');
    assert.equal(stale.vm.safe.drive, false);
    const recovered = runtime.step({ nowMs: 3002, inputs: { run_request: true }, samples: { observation: sample(2, 3002, false) } });
    assert.equal(recovered.sensors.observation.quality, 'Good');
    assert.equal(recovered.vm.safe.drive, false);
  } finally { runtime.dispose(); }
});

test('a sample cannot grant an absent observation capability', async () => {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  try {
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { run_request: true },
      samples: { observation: { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', value: true } } }),
    /absent sensor capability observation/);
    assert.equal(runtime.step({ nowMs: 0, inputs: { run_request: true } }).vm.safe.drive, true);
  } finally { runtime.dispose(); }
});

test('native ScanDriver replays the canonical timer baseline with WASM parity', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-optional-feedback-'));
  try {
    const module = path.join(directory, 'module.gfb');
    const tape = path.join(directory, 'frames.csv');
    fs.writeFileSync(module, artifact.bytes);
    const sensor = artifact.manifest.sensors[0];
    fs.writeFileSync(tape, `scan_id,logical_time_ms,run_request,${sensor.valueInput},${sensor.okInput},${sensor.faultInput}\n` +
      scans.map(([time, run], id) => [id, time, run, false, false, 3].join(',')).join('\n') + '\n');
    const native = new URL('../target/release/examples/scan_adapter', import.meta.url);
    const result = spawnSync(native.pathname, [module, tape], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    const outcomes = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const wasmOutcomes = await replay(null, false);
    assert.deepEqual(outcomes.map(o => o.trace.requested.drive), expected);
    assert.deepEqual(outcomes.map(o => o.trace.safe.drive), expected);
    assert.deepEqual(outcomes.map(o => o.trace.stateAfter), wasmOutcomes.map(o => o.vm.stateAfter));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
