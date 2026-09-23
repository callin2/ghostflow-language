import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';

const cli = new URL('../tools/ghostsim.mjs', import.meta.url).pathname;

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-continuous-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'continuous.gfb');
  const source = '```ghost\ncontrol Continuous { sensor measured: Number; input target: Number; output command: Number; command <- target; }\n```\n';
  writeArtifact(await compileSource(source, { filename: 'continuous.ghost.md' }), artifact);
  return { directory, artifact };
}

function run(directory, artifact, scenario) {
  const scenarioPath = path.join(directory, 'scenario.toon');
  fs.writeFileSync(scenarioPath, encode(scenario) + '\n');
  return spawnSync(process.execPath, [cli, artifact, scenarioPath, '--format', 'json'], {
    encoding: 'utf8', timeout: 10_000,
  });
}

const scenario = actions => ({
  format: 'GhostFlow/scenario-v1', id: 'continuous-io',
  initialInputs: [{ name: 'target', type: 'Number', value: 42 }], keyBindings: [],
  actuatorBindings: [{ actuator: 'heater', output: 'command', type: 'Number', min: 0, max: 100, feedbackSensor: 'measured' }],
  actions,
});

test('ghostsim applies an accepted safe numeric target and traces explicit sampled feedback provenance', async t => {
  const { directory, artifact } = await fixture(t);
  const result = run(directory, artifact, scenario([
    { kind: 'sample', name: 'measured', epoch: 7, id: 11, timestampMs: 0, value: 18.5, quality: 'Good' },
    { kind: 'scan', atMs: 0 },
  ]));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).scans[0].virtualActuators, {
    heater: {
      output: 'command', type: 'Number', requested: 42, safe: 42, applied: 42,
      feedback: {
        sensor: 'measured', type: 'Number', ok: true, value: 18.5, quality: 'Good',
        provenance: { epoch: 7, id: 11, timestampMs: 0 },
      },
    },
  });
});

test('ghostsim rejects incompatible continuous bindings before execution', async t => {
  const { directory, artifact } = await fixture(t);
  for (const [binding, diagnostic] of [
    [{ actuator: 'heater', output: 'missing', type: 'Number', min: 0, max: 100 }, 'unknown output missing'],
    [{ actuator: 'heater', output: 'command', type: 'Int', min: 0, max: 100 }, 'type mismatch command'],
    [{ actuator: 'heater', output: 'command', type: 'Number', min: 100, max: 0 }, 'min must be less than or equal to max'],
    [{ actuator: 'heater', output: 'command', type: 'Number', min: 0, max: 100, feedbackSensor: 'missing' }, 'unknown feedback sensor missing'],
  ]) {
    const result = run(directory, artifact, { ...scenario([{ kind: 'scan', atMs: 0 }]), actuatorBindings: [binding] });
    assert.equal(result.status, 1);
    const rejected = JSON.parse(result.stdout);
    assert.equal(rejected.outcome, 'rejected');
    assert.match(rejected.error.message, new RegExp(diagnostic));
    assert.deepEqual(rejected.scans, []);
  }
});

test('ghostsim does not report an applied value for a scan rejected by the virtual actuator range', async t => {
  const { directory, artifact } = await fixture(t);
  const result = run(directory, artifact, scenario([
    { kind: 'input', name: 'target', type: 'Number', value: 101 },
    { kind: 'scan', atMs: 0 },
  ]));
  assert.equal(result.status, 1);
  const rejected = JSON.parse(result.stdout);
  assert.equal(rejected.outcome, 'runtime-error');
  assert.match(rejected.error.message, /safe value 101 is outside 0\.\.100/);
  assert.deepEqual(rejected.scans, []);
});
