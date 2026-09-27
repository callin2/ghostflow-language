import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource, literateDocument } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const nativePath = path.join(root, 'target/release/examples/context_tape');
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const source = literateDocument(`control TypedDefaults {
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
  config duty: Percent = 100% { min = 0%; max = 100%; step = 10%; access = operator; }
  output duration_ms: Duration;
  output duty_pct: Percent;
  duration_ms <- case duration { ok(v) => v; fault(_) => 0ms; };
  duty_pct <- case duty { ok(v) => v; fault(_) => 0%; };
}`);

function facts(atMs, settings = null) {
  return { clock: { monotonicMs: atMs, bootEpoch: 1, wallMs: atMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'config-parity-v1' },
  natural: [], schedules: [], settings };
}

function nativeRun(artifact, attempts) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-config-parity-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1',
      activation: { bootEpoch: 1, terminalCapacity: 8, bindings: [] },
      steps: attempts.map(({ scanId, nowMs, settings }) => ({ scanId,
        logicalTimeMs: nowMs, inputs: [], ...facts(nowMs, settings) })) }));
    const result = spawnSync(nativePath, [modulePath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').map(line => JSON.parse(line));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function wasmRun(artifact, attempts, framed) {
  const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate)(wasmBytes, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    return attempts.map(({ nowMs, settings }) => {
      try {
        const outcome = runtime.step({ nowMs, contextFacts: facts(nowMs, settings) });
        return { accepted: true, outcome, settings: runtime.contextSnapshot().state };
      } catch (error) {
        return { accepted: false, error: error.message, settings: runtime.contextSnapshot().state };
      }
    });
  } finally {
    runtime.dispose();
  }
}

test('GF-TEST-config-native-wasm-parity: bounded Duration and Percent defaults, updates, faults, and rollback match native and WASM', async () => {
  const artifact = await compileSource(source, { filename: 'config-native-wasm-parity.ghost.md' });
  assert.equal(artifact.bytes.readUInt16LE(4), 11, 'the parity artifact uses current GFB11');
  for (const declaration of [
    source.replace('= 5min', '= 30min'),
    source.replace('= 100%', '= 110%'),
  ]) await assert.rejects(() => compileSource(declaration,
    { filename: 'invalid-config-native-wasm-parity.ghost.md' }),
  /outside settings range|Percent literal must be between/);
  const [duration, duty] = artifact.manifest.configs;
  assert.deepEqual([duration.type, duration.value, duration.settings.min, duration.settings.max,
    duty.type, duty.value, duty.settings.min, duty.settings.max],
  ['Duration', 300_000, 60_000, 1_200_000, 'Percent', 100, 0, 100]);
  const probe = await ControlRuntime.instantiateFramed(wasmBytes, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const change = (eventId, baseRevision, position, changes) => ({
    programFingerprint: fingerprint, eventId, baseRevision, position, origin: 'operatorEdit', changes,
  });
  const ok = (config, value) => ({ configId: config.id,
    result: { ok: true, type: config.type, value } });
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: change('lower-bounds', 0, 2,
      [ok(duration, 60_000), ok(duty, 0)]) },
    { scanId: 2, nowMs: 2, settings: change('wrong-type', 1, 3,
      [{ configId: duration.id, result: { ok: true, type: 'Number', value: 600_000 } }]) },
    { scanId: 3, nowMs: 3, settings: change('stale-revision', 1, 4,
      [ok(duration, 600_000)]) },
    { scanId: 3, nowMs: 3, settings: change('upper-bounds', 2, 4,
      [ok(duration, 1_200_000), ok(duty, 100)]) },
    { scanId: 4, nowMs: 4, settings: change('out-of-range', 3, 5,
      [ok(duty, 110)]) },
    { scanId: 5, nowMs: 5, settings: change('unavailable', 4, 6,
      [{ configId: duration.id, result: { ok: false, fault: 'SettingsUnavailable' } }]) },
  ];
  const native = nativeRun(artifact, attempts);
  const wasm = await wasmRun(artifact, attempts, true);
  const unframed = await wasmRun(artifact, attempts, false);
  assert.equal(native.length, attempts.length);
  assert.equal(wasm.length, attempts.length);
  assert.equal(unframed.length, attempts.length);
  for (let i = 0; i < attempts.length; i++) {
    assert.equal(native[i].accepted, wasm[i].accepted,
      `attempt ${i} acceptance: native=${JSON.stringify(native[i])} wasm=${JSON.stringify(wasm[i])}`);
    assert.equal(native[i].accepted, unframed[i].accepted, `attempt ${i} unframed acceptance`);
    assert.deepEqual(native[i].settings, wasm[i].settings, `attempt ${i} settings state`);
    assert.deepEqual(native[i].settings, unframed[i].settings, `attempt ${i} unframed settings state`);
    if (native[i].accepted) {
      assert.deepEqual(wasm[i].outcome.frame,
        { scanId: native[i].outcome.scanId, logicalTimeMs: native[i].outcome.logicalTimeMs },
        `attempt ${i} framed identity`);
      assert.deepEqual(native[i].outcome.trace.safe, wasm[i].outcome.vm.safe,
        `attempt ${i} safe outputs`);
      assert.deepEqual(native[i].outcome.trace.safe, unframed[i].outcome.vm.safe,
        `attempt ${i} unframed safe outputs`);
    }
  }
  assert.deepEqual(native.map(({ accepted }) => accepted),
    [true, true, true, false, true, true, true]);
  assert.match(native[3].error, /invalid or stale settings transaction/);
  assert.match(wasm[3].error, /invalid or stale settings transaction/);
  assert.match(unframed[3].error, /invalid or stale settings transaction/);
  assert.deepEqual(native[3].settings, native[2].settings, 'rejected native frame rolls back');
  assert.deepEqual(wasm[3].settings, wasm[2].settings, 'rejected WASM frame rolls back');
  assert.deepEqual(native.filter(row => row.accepted).map(row => row.outcome.scanId),
    [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(native.map(row => row.settings.settingsRevision), [0, 1, 2, 2, 3, 4, 5]);
  assert.deepEqual(native[2].settings.settings[0].result, { ok: false, fault: 'SettingsInvalid' });
  assert.deepEqual(native[5].settings.settings[1].result, { ok: false, fault: 'SettingsInvalid' });
  assert.deepEqual(native[6].settings.settings[0].result, { ok: false, fault: 'SettingsUnavailable' });
  assert.deepEqual(native.filter(row => row.accepted).map(row => row.outcome.trace.safe), [
    { duration_ms: 300_000, duty_pct: 100 },
    { duration_ms: 60_000, duty_pct: 0 },
    { duration_ms: 0, duty_pct: 0 },
    { duration_ms: 1_200_000, duty_pct: 100 },
    { duration_ms: 1_200_000, duty_pct: 0 },
    { duration_ms: 0, duty_pct: 0 },
  ]);
});
