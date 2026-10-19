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
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
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

function nativeRun(artifact, attempts, { profile = 'context-settings-v1', checkpoint = null, expectSuccess = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-config-parity-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile,
      activation: { bootEpoch: 1, terminalCapacity: 8, bindings: [] },
      ...(checkpoint ? { checkpoint } : {}),
      steps: attempts.map(({ scanId, nowMs, settings }) => ({ scanId,
        logicalTimeMs: nowMs, inputs: [], ...facts(nowMs, settings) })) }));
    const result = spawnSync(nativePath, [modulePath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    if (!expectSuccess) return result;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function wasmRun(artifact, attempts, framed, { checkpoint = null } = {}) {
  const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate)(wasmBytes, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
    return attempts.map(({ nowMs, settings }) => {
      try {
        const outcome = runtime.step({ nowMs, contextFacts: facts(nowMs, settings) });
        return { accepted: true, outcome, settings: runtime.contextSnapshot().state,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      } catch (error) {
        return { accepted: false, error: error.message, settings: runtime.contextSnapshot().state,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      }
    });
  } finally {
    runtime.dispose();
  }
}

test('REF-05-015 live Duration compares the existing six-minute timer with the new five-minute value in native and plain/framed WASM', async () => {
  const artifact = await compileSource(literateDocument(`control LiveDuration {
    config duration: Duration = 10min { min = 1min; max = 20min; step = 1min; access = operator; }
    state running: Bool = true;
    state remembered: Bool = false;
    remembered' = true;
    timer age = elapsed(running);
    let within_duration = case duration { ok(value) => age < value; fault(_) => false; };
    running' = running && within_duration;
    output drive: Bool;
    output elapsed_ms, duration_ms: Duration;
    drive <- running';
    elapsed_ms <- age;
    duration_ms <- case duration { ok(value) => value; fault(_) => 0ms; };
  }`), { filename: 'reference-live-duration.ghost.md' });
  const [duration] = artifact.manifest.configs;
  assert.equal(duration.value, 600_000);
  const probe = await ControlRuntime.instantiateFramed(wasmBytes, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 360_000, settings: null },
    { scanId: 2, nowMs: 360_000, settings: {
      programFingerprint: fingerprint, eventId: 'shorten-live-duration',
      baseRevision: 0, position: 3, origin: 'operatorEdit',
      changes: [{ configId: duration.id, result: { ok: true, type: 'Duration', value: 300_000 } }],
    } },
    { scanId: 3, nowMs: 360_001, settings: null },
  ];
  const executions = [nativeRun(artifact, attempts),
    await wasmRun(artifact, attempts, false), await wasmRun(artifact, attempts, true)];
  const expected = [
    { drive: true, elapsed_ms: 0, duration_ms: 600_000 },
    { drive: true, elapsed_ms: 360_000, duration_ms: 600_000 },
    { drive: false, elapsed_ms: 360_000, duration_ms: 300_000 },
    // This new timer baseline follows the authored running true-to-false transition,
    // rather than initialization by the setting event at the preceding decision.
    { drive: false, elapsed_ms: 1, duration_ms: 300_000 },
  ];
  for (const rows of executions) {
    assert.ok(rows.every(row => row.accepted), JSON.stringify(rows));
    assert.deepEqual(rows.map(row => row.settings.settingsRevision), [0, 0, 1, 1]);
    assert.deepEqual(rows[2].settings.settings[0].result, { ok: true, value: 300_000 });
    const traces = rows.map(row => row.outcome.trace ?? row.outcome.vm);
    assert.deepEqual(traces.map(trace => trace.requested), expected);
    assert.deepEqual(traces.map(trace => trace.safe), expected);
    assert.equal(traces[0].stateBefore.remembered, false);
    assert.equal(traces[1].stateAfter.running, true);
    assert.deepEqual(traces[2].stateBefore, traces[1].stateAfter,
      'the live event preserves the existing state before authored transition evaluation');
    assert.equal(traces[2].stateBefore.running, true);
    assert.equal(traces[2].stateAfter.running, false);
    assert.equal(traces[2].stateAfter.remembered, true);
    assert.equal(traces[3].stateBefore.running, false);
  }
  const [native, plain, framed] = executions;
  for (let i = 0; i < attempts.length; i++) {
    assert.deepEqual(plain[i].settings, native[i].settings);
    assert.deepEqual(framed[i].settings, native[i].settings);
    assert.deepEqual(plain[i].outcome.vm, native[i].outcome.trace);
    assert.deepEqual(framed[i].outcome.vm, native[i].outcome.trace);
    assert.deepEqual(framed[i].outcome.frame,
      { scanId: native[i].outcome.scanId, logicalTimeMs: native[i].outcome.logicalTimeMs });
  }
});

test('REF-05-016 designer Percent rejects operator edits without changing value or settings revision in native and plain/framed WASM', async () => {
  const artifact = await compileSource(literateDocument(`control DesignerDuty {
    config duty: Percent = 50% { min = 0%; max = 100%; step = 10%; access = designer; }
    output duty_pct: Percent;
    duty_pct <- case duty { ok(v) => v; fault(_) => 0%; };
  }`), { filename: 'reference-designer-duty.ghost.md' });
  const [duty] = artifact.manifest.configs;
  assert.equal(duty.settings.access, 'designer');
  assert.equal(duty.value, 50);
  const probe = await ControlRuntime.instantiateFramed(wasmBytes, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const event = (eventId, baseRevision, position, origin, result) => ({
    programFingerprint: fingerprint, eventId, baseRevision, position, origin,
    changes: [{ configId: duty.id, result }],
  });
  const ok = value => ({ ok: true, type: 'Percent', value });
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: event('duty-request', 0, 2, 'operatorEdit', ok(60)) },
    // Rejected authority consumes neither the frame nor event identity. The trusted-host
    // producer classification permits a fault, then recovery only to the author's payload;
    // this owner harness does not authenticate the sender of the classification.
    { scanId: 1, nowMs: 1, settings: event('duty-request', 0, 2, 'producerObservation',
      { ok: false, fault: 'SettingsUnavailable' }) },
    { scanId: 2, nowMs: 2, settings: event('duty-recovery', 1, 3, 'producerObservation', ok(50)) },
    { scanId: 3, nowMs: 3, settings: event('duty-second-request', 2, 4, 'operatorEdit', ok(60)) },
    { scanId: 3, nowMs: 3, settings: event('duty-second-request', 2, 4, 'producerObservation', ok(60)) },
    { scanId: 3, nowMs: 3, settings: null },
  ];
  const executions = [nativeRun(artifact, attempts),
    await wasmRun(artifact, attempts, false), await wasmRun(artifact, attempts, true)];
  for (const rows of executions) {
    assert.deepEqual(rows.map(row => row.accepted), [true, false, true, true, false, false, true]);
    for (const [rejected, prior] of [[1, 0], [4, 3], [5, 3]]) {
      assert.match(rows[rejected].error, rejected === 5
        ? /producer cannot change readonly config payload/ : /unauthorized|settings target/);
      assert.deepEqual(rows[rejected].settings, rows[prior].settings,
        'denied edits preserve the entire owner settings state, including revision and event history');
      assert.equal(rows[rejected].settings.settings[0].result.value, 50);
    }
    assert.deepEqual(rows.map(row => row.settings.settingsRevision), [0, 0, 1, 2, 2, 2, 2]);
    assert.deepEqual(rows[2].settings.settings[0].result, { ok: false, fault: 'SettingsUnavailable' });
    assert.deepEqual(rows[3].settings.settings[0].result, { ok: true, value: 50 });
  }
  const [native, plain, framed] = executions;
  for (let i = 0; i < attempts.length; i++) {
    assert.deepEqual(plain[i].settings, native[i].settings);
    assert.deepEqual(framed[i].settings, native[i].settings);
    if (native[i].accepted) {
      assert.deepEqual(plain[i].outcome.vm.safe, native[i].outcome.trace.safe);
      assert.deepEqual(framed[i].outcome.vm.safe, native[i].outcome.trace.safe);
      assert.deepEqual(framed[i].outcome.frame,
        { scanId: native[i].outcome.scanId, logicalTimeMs: native[i].outcome.logicalTimeMs });
    }
  }
  assert.deepEqual(native.filter(row => row.accepted).map(row => row.outcome.scanId), [0, 1, 2, 3]);
  assert.deepEqual(native.filter(row => row.accepted).map(row => row.outcome.trace.safe),
    [{ duty_pct: 50 }, { duty_pct: 0 }, { duty_pct: 50 }, { duty_pct: 50 }]);
});

test('REF-05-018 ordinary settings are Program-bound and a fresh Program validates its own typed stream in native and framed WASM', async () => {
  const programP = await compileSource(literateDocument(`control OrdinarySettingsP {
    config duration: Duration = 10min { min = 1min; max = 20min; step = 1min; access = operator; }
    output duration_ms: Duration;
    duration_ms <- case duration { ok(v) => v; fault(_) => 0ms; };
  }`), { filename: 'reference-temporary-settings-p.ghost.md' });
  const programQ = await compileSource(literateDocument(`control OrdinarySettingsQ {
    config duration: Int = 3 { min = 1; max = 5; step = 1; access = operator; }
    output selected: Int;
    selected <- case duration { ok(v) => v; fault(_) => -1; };
  }`), { filename: 'reference-temporary-settings-q.ghost.md' });
  const [durationP] = programP.manifest.configs;
  const [durationQ] = programQ.manifest.configs;
  assert.equal(durationP.name, durationQ.name, 'same source config name does not define Program identity');
  assert.equal(durationP.type, 'Duration');
  assert.equal(durationQ.type, 'Int');
  const probeP = await ControlRuntime.instantiateFramed(wasmBytes, programP,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  const fingerprintP = probeP.contextSnapshot().state.programFingerprint;
  probeP.dispose();
  const probeQ = await ControlRuntime.instantiateFramed(wasmBytes, programQ,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  const fingerprintQ = probeQ.contextSnapshot().state.programFingerprint;
  probeQ.dispose();
  assert.notEqual(fingerprintP, fingerprintQ);
  const event = (programFingerprint, eventId, baseRevision, position, result) => ({
    programFingerprint, eventId, baseRevision, position, origin: 'operatorEdit',
    changes: [{ configId: durationQ.id, result }],
  });
  const pAttempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: { programFingerprint: fingerprintP,
      eventId: 'p-ordinary-override', baseRevision: 0, position: 2, origin: 'operatorEdit',
      changes: [{ configId: durationP.id, result: { ok: true, type: 'Duration', value: 300_000 } }] } },
  ];
  const nativeP = nativeRun(programP, pAttempts, { profile: 'context-settings-civil-v1' });
  const wasmP = await wasmRun(programP, pAttempts, true);
  assert.deepEqual(nativeP.map(row => row.accepted), [true, true]);
  assert.deepEqual(wasmP.map(row => row.accepted), [true, true]);
  assert.equal(nativeP[1].settings.settingsRevision, 1);
  assert.deepEqual(nativeP[1].settings.settings[0].result, { ok: true, value: 300_000 });
  assert.deepEqual(wasmP[1].settings, nativeP[1].settings);
  assert.equal(wasmP[1].checkpoint, nativeP[1].checkpoint);
  for (let i = 0; i < pAttempts.length; i++) {
    assert.deepEqual(wasmP[i].outcome.vm, nativeP[i].outcome.trace);
    assert.deepEqual(wasmP[i].outcome.frame, { scanId: nativeP[i].outcome.scanId, logicalTimeMs: nativeP[i].outcome.logicalTimeMs });
  }
  assert.deepEqual(nativeRun(programP, pAttempts, { profile: 'context-settings-civil-v1' }), nativeP);
  assert.deepEqual(await wasmRun(programP, pAttempts, true), wasmP);

  const qAttempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: event(fingerprintP, 'wrong-program', 0, 2,
      { ok: true, type: 'Int', value: 4 }) },
    { scanId: 1, nowMs: 1, settings: { programFingerprint: fingerprintQ,
      eventId: 'malformed', baseRevision: 0, position: 2, origin: 'operatorEdit', changes: [] } },
    { scanId: 1, nowMs: 1, settings: { programFingerprint: fingerprintQ,
      eventId: 'denied-origin', baseRevision: 0, position: 2, origin: 'operatorEdit',
      changes: [{ configId: durationQ.id + 1000, result: { ok: true, type: 'Int', value: 4 } }] } },
    { scanId: 1, nowMs: 1, settings: event(fingerprintQ, 'wrong-type', 0, 2,
      { ok: true, type: 'Duration', value: 300_000 }) },
    { scanId: 2, nowMs: 2, settings: event(fingerprintQ, 'valid-int', 1, 3,
      { ok: true, type: 'Int', value: 4 }) },
    { scanId: 3, nowMs: 3, settings: event(fingerprintQ, 'out-of-range', 2, 4,
      { ok: true, type: 'Int', value: 6 }) },
    { scanId: 4, nowMs: 4, settings: event(fingerprintQ, 'producer-unavailable', 3, 5,
      { ok: false, fault: 'SettingsUnavailable' }) },
    { scanId: 5, nowMs: 5, settings: event(fingerprintQ, 'valid-recovery', 4, 6,
      { ok: true, type: 'Int', value: 5 }) },
  ];
  const nativeQ = nativeRun(programQ, qAttempts, { profile: 'context-settings-civil-v1' });
  const wasmQ = await wasmRun(programQ, qAttempts, true);
  assert.deepEqual(nativeQ.map(row => row.accepted), [true, false, false, false, true, true, true, true, true]);
  assert.match(nativeQ[1].error, /fingerprint|transaction/i);
  assert.match(nativeQ[2].error, /empty|settings|transaction/i);
  assert.match(nativeQ[3].error, /unknown settings stream target/i);
  for (const index of [1, 2, 3]) {
    assert.equal(nativeQ[index].settings.settingsRevision, 0, `pre-admission rejection preserves Q revision: ${index}`);
    assert.deepEqual(nativeQ[index].settings.settings[0].result, { ok: true, value: 3 });
    assert.equal(nativeQ[index].checkpoint, nativeQ[0].checkpoint);
  }
  assert.deepEqual(nativeQ.map(row => row.settings.settingsRevision), [0, 0, 0, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(nativeQ[4].settings.settings[0].result, { ok: false, fault: 'SettingsInvalid' });
  assert.deepEqual(nativeQ[5].settings.settings[0].result, { ok: true, value: 4 });
  assert.deepEqual(nativeQ[6].settings.settings[0].result, { ok: false, fault: 'SettingsInvalid' });
  assert.deepEqual(nativeQ[7].settings.settings[0].result, { ok: false, fault: 'SettingsUnavailable' });
  assert.deepEqual(nativeQ[8].settings.settings[0].result, { ok: true, value: 5 });
  assert.deepEqual(nativeQ.filter(row => row.accepted).map(row => row.outcome.trace.safe), [
    { selected: 3 }, { selected: -1 }, { selected: 4 }, { selected: -1 }, { selected: -1 }, { selected: 5 },
  ]);
  for (let i = 0; i < qAttempts.length; i++) {
    assert.equal(wasmQ[i].accepted, nativeQ[i].accepted, `Q acceptance ${i}`);
    assert.deepEqual(wasmQ[i].settings, nativeQ[i].settings, `Q settings ${i}`);
    assert.equal(wasmQ[i].checkpoint, nativeQ[i].checkpoint, `Q checkpoint ${i}`);
    if (nativeQ[i].accepted) {
      assert.deepEqual(wasmQ[i].outcome.vm, nativeQ[i].outcome.trace, `Q complete trace ${i}`);
      assert.deepEqual(wasmQ[i].outcome.frame, { scanId: nativeQ[i].outcome.scanId, logicalTimeMs: nativeQ[i].outcome.logicalTimeMs });
    }
  }
  assert.deepEqual(nativeRun(programQ, qAttempts, { profile: 'context-settings-civil-v1' }), nativeQ, 'fresh native replay includes rejected attempts and complete checkpoints');
  assert.deepEqual(await wasmRun(programQ, qAttempts, true), wasmQ, 'fresh framed replay includes rejected attempts and complete checkpoints');

  await assert.rejects(async () => {
    const restoredQ = await ControlRuntime.instantiateFramed(wasmBytes, programQ,
      { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
    try { restoredQ.restoreContextCheckpoint(Buffer.from(nativeP[1].checkpoint, 'hex')); }
    finally { restoredQ.dispose(); }
  }, /checkpoint|Program identity|fingerprint/i);
  const nativeRestore = nativeRun(programQ, [{ scanId: 0, nowMs: 0, settings: null }],
    { profile: 'context-settings-civil-v1', checkpoint: nativeP[1].checkpoint, expectSuccess: false });
  assert.notEqual(nativeRestore.status, 0);
  assert.match(nativeRestore.stderr + nativeRestore.stdout, /checkpoint|Program identity|fingerprint/i);
});

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
