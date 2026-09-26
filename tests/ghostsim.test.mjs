import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encode, decode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const cli = path.join(root, 'tools/ghostsim.mjs');

test('ghostsim preserves NotReady for a sensor without supplied samples', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-sensor-'));
  const artifact = path.join(directory, 'sensor.gfb');
  try {
    const source = '```ghost\ncontrol Sensor { sensor moisture: Percent; output pump: Bool; pump <- case moisture { ok(value) => value < 30%; fault(_) => false; }; }\n```\n';
    const compiled = await compileSource(source, { filename: 'sensor.ghost.md' });
    writeArtifact(compiled, artifact);
    const result = run(artifact, { format: 'GhostFlow/scenario-v1', id: 'missing-sensor', initialInputs: [], keyBindings: [], actions: [{ kind: 'scan', atMs: 0 }] });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const scan = JSON.parse(result.stdout).scans[0];
    assert.equal(scan.requestedVirtualIntent.pump, false);
    assert.equal(scan.safeVirtualIntent.pump, false);
    assert.equal(scan.inputs.__gf_sensor_ok_moisture, false);
    assert.notEqual(scan.inputs.__gf_sensor_fault_moisture, 0);
    const runtime = await ControlRuntime.instantiateFramed(
      fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')), compiled,
    );
    try {
      const expected = runtime.step({ nowMs: 0 });
      assert.equal(expected.sensors.moisture.quality, 'NotReady');
      assert.deepEqual(scan.inputs, expected.vm.inputs);
      assert.deepEqual(scan.requestedVirtualIntent, expected.vm.requested);
      assert.deepEqual(scan.safeVirtualIntent, expected.vm.safe);
      assert.deepEqual(scan.faults, expected.vm.faults);
    } finally {
      runtime.dispose();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-'));
  const artifact = path.join(directory, 'timer.gfb');
  const source = `# Timer\n\n\`\`\`ghost\ncontrol Timer {\n  input enabled: Bool;\n  state active: Bool = false;\n  timer age = elapsed(active);\n  active' = enabled;\n  output expired: Bool;\n  expired <- age >= 100ms;\n}\n\`\`\`\n`;
  writeArtifact(await compileSource(source, { filename: 'timer.ghost.md' }), artifact);
  return { directory, artifact };
}

function run(artifact, scenario, format = 'json') {
  const scenarioFile = path.join(path.dirname(artifact), 'scenario.toon');
  fs.writeFileSync(scenarioFile, encode(scenario) + '\n');
  return spawnSync(process.execPath, [cli, artifact, scenarioFile, '--format', format], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
  });
}

test('ghostsim executes only explicit scans and advances elapsed on a clock-only scan', async () => {
  const { directory, artifact } = await fixture();
  try {
    const scenario = {
      format: 'GhostFlow/scenario-v1', id: 'timer-한글',
      initialInputs: [{ name: 'enabled', type: 'Bool', value: false }],
      keyBindings: [{ key: 1, input: 'enabled' }],
      actions: [
        { kind: 'scan', atMs: 0 },
        { kind: 'key', key: 1, event: 'down' },
        { kind: 'scan', atMs: 1 },
        { kind: 'scan', atMs: 101 },
        { kind: 'key', key: 1, event: 'up' },
        { kind: 'scan', atMs: 102 },
        { kind: 'scan', atMs: 103 },
      ],
    };
    const first = run(artifact, scenario);
    assert.equal(first.status, 0, first.stderr);
    const result = JSON.parse(first.stdout);
    assert.equal(result.format, 'GhostFlow/scenario-result-v1');
    assert.equal(result.scenario.id, scenario.id);
    assert.deepEqual(result.scans.map(scan => scan.logicalTimeMs), [0, 1, 101, 102, 103]);
    assert.deepEqual(result.scans.map(scan => scan.safeVirtualIntent.expired), [false, false, true, true, false]);
    assert.deepEqual(result.scans.map(scan => scan.inputs.enabled), [false, true, true, false, false]);
    assert.deepEqual(JSON.parse(run(artifact, scenario).stdout), result);
    const toon = run(artifact, scenario, 'toon');
    assert.equal(toon.status, 0, toon.stderr);
    assert.deepEqual(decode(toon.stdout, { strict: true }), result);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim rejects incomplete, mistyped, duplicate, and out-of-order actions with locations', async () => {
  const { directory, artifact } = await fixture();
  const base = {
    format: 'GhostFlow/scenario-v1', id: 'invalid-cases',
    initialInputs: [{ name: 'enabled', type: 'Bool', value: false }],
    keyBindings: [{ key: 1, input: 'enabled' }],
    actions: [{ kind: 'scan', atMs: 2 }],
  };
  try {
    const cases = [
      [{ ...base, initialInputs: [] }, 'initialInputs: missing input enabled'],
      [{ ...base, initialInputs: [{ name: 'enabled', type: 'Number', value: 1 }] }, 'initialInputs[0]: type mismatch enabled'],
      [{ ...base, keyBindings: [{ key: 1, input: 'enabled' }, { key: 2, input: 'enabled' }] }, 'keyBindings[1]: duplicate binding enabled'],
      [{ ...base, actions: [...base.actions, { kind: 'scan', atMs: 1 }] }, 'actions[1]: logical time moved backwards'],
      [{ ...base, actions: [{ kind: 'key', key: 2, event: 'down' }, ...base.actions] }, 'actions[0]: unbound key 2'],
      [{ ...base, actions: [{ kind: 'input', name: 'bad', type: 'Bool', value: true }, ...base.actions] }, 'actions[0]: unknown input bad'],
    ];
    for (const [scenario, diagnostic] of cases) {
      const result = run(artifact, scenario);
      assert.equal(result.status, 1);
      const rejected = JSON.parse(result.stdout);
      assert.equal(rejected.format, 'GhostFlow/scenario-result-v1');
      assert.equal(rejected.outcome, 'rejected');
      assert.match(rejected.error.message, new RegExp(diagnostic.replaceAll('[', '\\[').replaceAll(']', '\\]')));
      assert.deepEqual(rejected.scans, []);
    }
    const missingJson = JSON.parse(run(artifact, cases[0][0], 'json').stdout);
    const missingToon = decode(run(artifact, cases[0][0], 'toon').stdout, { strict: true });
    assert.deepEqual(missingToon, missingJson);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim passes Int and Number input changes as complete typed snapshots', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-typed-'));
  const artifact = path.join(directory, 'typed.gfb');
  const source = `\`\`\`ghost\ncontrol Typed {\n  input count: Int;\n  input level: Number;\n  output active: Bool;\n  active <- count >= 2 && level >= 1.5;\n}\n\`\`\`\n`;
  try {
    writeArtifact(await compileSource(source, { filename: 'typed.ghost.md' }), artifact);
    const scenario = {
      format: 'GhostFlow/scenario-v1', id: 'typed',
      initialInputs: [{ name: 'count', type: 'Int', value: 1 }, { name: 'level', type: 'Number', value: 1.5 }],
      keyBindings: [],
      actions: [{ kind: 'scan', atMs: 0 }, { kind: 'input', name: 'count', type: 'Int', value: 2 }, { kind: 'scan', atMs: 0 }],
    };
    const result = run(artifact, scenario);
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(result.stdout).scans;
    assert.deepEqual(rows.map(row => row.safeVirtualIntent.active), [false, true]);
    assert.deepEqual(rows.map(row => row.inputs.count), [1, 2]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim rejects malformed TOON and an exhausted scan budget without a success trace', async () => {
  const { directory, artifact } = await fixture();
  const scenarioFile = path.join(directory, 'scenario.toon');
  try {
    fs.writeFileSync(scenarioFile, 'format: GhostFlow/scenario-v1\nid: broken\ninitialInputs[2]{name,type,value}:\n  enabled,Bool,false\nkeyBindings[0]:\nactions[1]:\n  - kind: scan\n    atMs: 0\n');
    const malformed = spawnSync(process.execPath, [cli, artifact, scenarioFile], { encoding: 'utf8' });
    assert.equal(malformed.status, 1);
    const malformedResult = decode(malformed.stdout, { strict: true });
    assert.equal(malformedResult.outcome, 'rejected');
    assert.match(malformedResult.error.location, /^line:\d+$/);
    assert.deepEqual(malformedResult.scans, []);
    const overBudget = run(artifact, {
      format: 'GhostFlow/scenario-v1', id: 'budget',
      initialInputs: [{ name: 'enabled', type: 'Bool', value: false }],
      keyBindings: [],
      actions: Array.from({ length: 257 }, (_, atMs) => ({ kind: 'scan', atMs })),
    });
    assert.equal(overBudget.status, 1);
    const exhausted = JSON.parse(overBudget.stdout);
    assert.equal(exhausted.outcome, 'rejected');
    assert.equal(exhausted.error.location, 'actions[256]');
    assert.match(exhausted.error.message, /scan budget 256 exceeded/);
    assert.deepEqual(exhausted.scans, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim reports a runtime error as a versioned result without a false completed outcome', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-error-'));
  const artifact = path.join(directory, 'division.gfb');
  const source = `\`\`\`ghost\ncontrol Division {\n  input divisor: Number;\n  output ratio: Number;\n  ratio <- 1.0 / divisor;\n}\n\`\`\`\n`;
  try {
    writeArtifact(await compileSource(source, { filename: 'division.ghost.md' }), artifact);
    const scenario = {
      format: 'GhostFlow/scenario-v1', id: 'fault-🙂',
      initialInputs: [{ name: 'divisor', type: 'Number', value: 1 }],
      keyBindings: [],
      actions: [{ kind: 'scan', atMs: 0 }, { kind: 'input', name: 'divisor', type: 'Number', value: 0 }, { kind: 'scan', atMs: 1 }],
    };
    const json = run(artifact, scenario, 'json');
    assert.equal(json.status, 1, json.stderr);
    const result = JSON.parse(json.stdout);
    assert.equal(result.outcome, 'runtime-error');
    assert.equal(result.error.actionIndex, 2);
    assert.match(result.error.message, /division by zero/);
    assert.equal(result.scans.length, 1);
    const toon = run(artifact, scenario, 'toon');
    assert.equal(toon.status, 1, toon.stderr);
    assert.deepEqual(decode(toon.stdout, { strict: true }), result);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim reports unavailable observations after native buffer and result budget failures', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-host-error-'));
  const artifact = path.join(directory, 'wide.gfb');
  const inputNames = Array.from({ length: 100 }, (_, index) => `input_${index}_${'x'.repeat(30)}`);
  const source = `\`\`\`ghost\ncontrol Wide {\n${inputNames.map(name => `  input ${name}: Bool;`).join('\n')}\n  output active: Bool;\n  active <- ${inputNames[0]};\n}\n\`\`\`\n`;
  try {
    writeArtifact(await compileSource(source, { filename: 'wide.ghost.md' }), artifact);
    const scenario = {
      format: 'GhostFlow/scenario-v1', id: 'wide-trace',
      initialInputs: inputNames.map(name => ({ name, type: 'Bool', value: false })),
      keyBindings: [], actions: Array.from({ length: 256 }, (_, atMs) => ({ kind: 'scan', atMs })),
    };
    const json = run(artifact, scenario, 'json');
    assert.equal(json.status, 1, json.stderr);
    const result = JSON.parse(json.stdout);
    assert.equal(result.outcome, 'host-error', result.error.message);
    assert.equal(result.traceComplete, false);
    assert.deepEqual(result.scans, []);
    assert.equal(result.scenario.id, scenario.id);
    assert.equal(result.artifact.bytecodeSha256.length, 64);
    const toon = run(artifact, scenario, 'toon');
    assert.equal(toon.status, 1, toon.stderr);
    assert.deepEqual(decode(toon.stdout, { strict: true }), result);
    const encodedBudget = run(artifact, {
      ...scenario, actions: scenario.actions.slice(0, 205),
    }, 'toon');
    assert.equal(encodedBudget.status, 1, encodedBudget.stderr);
    const oversized = decode(encodedBudget.stdout, { strict: true });
    assert.equal(oversized.outcome, 'host-error');
    assert.match(oversized.error.message, /result budget/);
    assert.equal(oversized.traceComplete, false);
    assert.deepEqual(oversized.scans, []);
    const jsonBudget = run(artifact, {
      ...scenario, actions: scenario.actions.slice(0, 205),
    }, 'json');
    assert.equal(jsonBudget.status, 0, jsonBudget.stderr);
    const jsonResult = JSON.parse(jsonBudget.stdout);
    assert.equal(jsonResult.outcome, 'completed');
    assert.equal(jsonResult.scans.length, 205);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim exposes requested and constrained safe values as separate virtual intents', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-safe-'));
  const artifact = path.join(directory, 'safe.gfb');
  const source = `\`\`\`ghost\ncontrol Safe {\n  input enabled: Bool;\n  output pump, permit: Bool;\n  pump <- enabled;\n  permit <- false;\n  require pump => permit;\n}\n\`\`\`\n`;
  try {
    writeArtifact(await compileSource(source, { filename: 'safe.ghost.md' }), artifact);
    const scenario = {
      format: 'GhostFlow/scenario-v1', id: 'safe',
      initialInputs: [{ name: 'enabled', type: 'Bool', value: true }],
      keyBindings: [], actions: [{ kind: 'scan', atMs: 0 }],
    };
    const result = run(artifact, scenario);
    assert.equal(result.status, 0, result.stderr);
    const scan = JSON.parse(result.stdout).scans[0];
    assert.equal(scan.requestedVirtualIntent.pump, true);
    assert.equal(scan.safeVirtualIntent.pump, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ghostsim rejects a control requiring external activation bindings without a scan trace', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-binding-'));
  const artifact = path.join(directory, 'true-for.gfb');
  try {
    const source = fs.readFileSync(path.join(root, 'tests/fixtures/true-for-certified.ghost.md'), 'utf8');
    writeArtifact(await compileSource(source, { filename: 'true-for-certified.ghost.md' }), artifact);
    const result = run(artifact, {
      format: 'GhostFlow/scenario-v1', id: 'requires-intervals',
      initialInputs: [], keyBindings: [], actions: [{ kind: 'scan', atMs: 0 }],
    });
    assert.equal(result.status, 1);
    const rejected = JSON.parse(result.stdout);
    assert.equal(rejected.outcome, 'rejected');
    assert.equal(rejected.error.location, 'activation');
    assert.match(rejected.error.message, /window runtime requires an explicit temporal profile/);
    assert.deepEqual(rejected.scans, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
