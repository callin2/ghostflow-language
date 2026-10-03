import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { validateInteraction, interactionSchemaSha256 } from '../contracts/interaction-v0/validate.mjs';
import { verifyInteractionSchema } from '../tools/interaction-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const source = `# Settings provenance\n\n<!-- ghostflow:anchor id=REF-05-012 kind=intent status=confirmed origin=user -->\nExpose static defaults separately from current settings provenance.\n\n\`\`\`ghost\ncontrol Provenance {\n  // ghostflow:link id=REF-05-012 relation=implements\n  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; label = "Duration"; }\n  // ghostflow:link id=REF-05-012 relation=implements\n  config enabled: Bool = false { access = operator; label = "Enabled"; }\n  output watering: Bool;\n  watering <- true;\n}\n\`\`\`\n`;
const identity = { documentId: 'source.ref-05-012-settings-provenance', revisionId: 'revision.ref-05-012-a' };
const clock = ms => ({ monotonicMs: ms, bootEpoch: 1, wallMs: ms, uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'settings-provenance-clock-v1' });
const facts = (ms, settings = null) => ({ clock: clock(ms), natural: [], schedules: [], settings });

async function fixture(sourceText = source) {
  const artifact = await compileSource(sourceText, { filename: 'tests/fixtures/ref-05-012-settings-provenance.ghost.md', interactionSourceIdentity: identity });
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  return { artifact, runtime, wasm, ids: Object.fromEntries(artifact.manifest.configs.map(config => [config.name, config.id])) };
}

function setting(state, name) { return state.settings.find(item => item.name === name); }

test('completed snapshots retain private config validation without projecting a public descriptor', async () => {
  const { artifact, runtime } = await fixture(source.replace('  output watering: Bool;', '  config internal: Bool = true;\n  output watering: Bool;'));
  try {
    const outcome = runtime.step({ nowMs: 0, contextFacts: facts(0) });
    const state = runtime.contextSnapshot().state;
    const emit = settingsState => emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.private-config',
      completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 }, trace: outcome.vm, settingsState });
    const snapshot = emit(state);
    assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
    assert.equal(artifact.interactionSchema.descriptors.some(descriptor => descriptor.name === 'internal'), false);
    assert.equal(snapshot.observations.some(value => value.descriptorId === 'setting.internal'), false);
    for (const field of ['id', 'name', 'type', 'defaultValue']) {
      const corrupted = structuredClone(state);
      const row = setting(corrupted, 'internal');
      row[field] = field === 'id' ? row.id + 1 : field === 'defaultValue' ? false : 'invalid';
      assert.throws(() => emit(corrupted), /settings state identity or Result mismatch/, field);
    }
    const missing = structuredClone(state);
    missing.settings = missing.settings.filter(row => row.name !== 'internal');
    assert.throws(() => emit(missing), /current Rust settings state is required/);
  } finally { runtime.dispose(); }
});
function ok(configId, type, value) { return { configId, result: { ok: true, type, value } }; }
function fault(configId) { return { configId, result: { ok: false, type: undefined, value: undefined, fault: 'SettingsUnavailable' } }; }
function event(fingerprint, eventId, baseRevision, position, changes, origin = 'operatorEdit') {
  return { programFingerprint: fingerprint, eventId, baseRevision, position, origin, changes };
}

function checkpointLayout(raw) {
  assert.equal(raw.subarray(0, 6).toString('hex'), '474643580400');
  let offset = 14;
  offset += 4 + raw.readUInt32LE(offset);
  assert.equal(raw.readUInt16LE(offset), 0, 'plain settings fixture has no calendar revisions'); offset += 2;
  const global = offset; offset += 8;
  const events = raw.readUInt16LE(offset); offset += 2;
  for (let index = 0; index < events; index++) offset += 2 + raw.readUInt16LE(offset);
  const count = raw.readUInt16LE(offset); offset += 2;
  const rows = new Map();
  const valueEnd = at => {
    const type = raw[at];
    if (type === 0) return at + 2;
    if (type === 1) return at + 5;
    if (type === 2) return at + 9;
    assert.equal(type, 3); return at + 3 + raw.readUInt16LE(at + 1) * 10;
  };
  for (let index = 0; index < count; index++) {
    const id = raw.readUInt32LE(offset);
    const row = { revision: offset + 12, position: offset + 20, history: offset + 28 };
    row.result = valueEnd(row.history);
    offset = raw[row.result] === 0 ? valueEnd(row.result + 1) : row.result + 2;
    rows.set(id, row);
  }
  return { global, rows };
}
function repairChecksum(raw) {
  let crc = ~0 >>> 0;
  for (const byte of raw.subarray(0, raw.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = ((crc >>> 1) ^ (0xedb88320 & (-(crc & 1)))) >>> 0;
  }
  raw.writeUInt32LE((~crc) >>> 0, raw.length - 4);
  return raw;
}

function nativeRun(artifact, attempts, checkpoint = null) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-settings-provenance-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1', checkpoint,
      activation: { bootEpoch: 1, terminalCapacity: 16, bindings: [] },
      steps: attempts.map(({ scanId, nowMs, settings, inputs = {} }) => ({ scanId, logicalTimeMs: nowMs,
        inputs: Object.entries(inputs).map(([name, value]) => ({ name, type: typeof value === 'boolean' ? 'Bool' : 'Number', value })), ...facts(nowMs, settings) })) }));
    const result = spawnSync(nativePath, [modulePath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').filter(Boolean).map(line => {
      const row = JSON.parse(line);
      return row.accepted ? row : { ...row, outcome: row.lastOutcome };
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function wasmRun(wasm, artifact, attempts, checkpoint = null) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  try {
    if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
    return attempts.map(({ scanId, nowMs, settings, inputs = {} }) => {
      try {
        const outcome = runtime.step({ nowMs, inputs, contextFacts: facts(nowMs, settings) });
        assert.equal(outcome.frame.scanId, scanId);
        return { accepted: true, outcome: structuredClone(runtime.lastFrameOutcome), settings: runtime.contextSnapshot().state,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      } catch (error) {
        return { accepted: false, error: error.message, outcome: structuredClone(runtime.lastFrameOutcome), settings: runtime.contextSnapshot().state,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      }
    });
  } finally { runtime.dispose(); }
}

test('REF-05-012 settings default provenance distinguishes defaults, equal updates, faults and unrelated edits', async () => {
  const { artifact, runtime, wasm, ids } = await fixture();
  try {
    let outcome = runtime.step({ nowMs: 0, contextFacts: facts(0) });
    let state = runtime.contextSnapshot().state;
    const fingerprint = state.programFingerprint;
    assert.deepEqual(setting(state, 'duration'), {
      id: ids.duration, name: 'duration', type: 'Duration', defaultValue: 300000,
      emissionRevision: 0, applicationPosition: null, override: false,
      result: { ok: true, value: 300000 },
    });
    let snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.ref-05-012-initial', completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 }, trace: outcome.vm, settingsState: state });
    assert.deepEqual(snapshot.observations[0], { descriptorId: 'setting.duration', defaultValue: 300000, emissionRevision: 0, applicationPosition: null, override: false, status: 'ready', value: 300000 });

    outcome = runtime.step({ nowMs: 1, contextFacts: facts(1, event(fingerprint, 'duration-6', 0, 2, [ok(ids.duration, 'Duration', 360000)])) });
    state = runtime.contextSnapshot().state;
    assert.deepEqual(setting(state, 'duration').result, { ok: true, value: 360000 });
    assert.equal(setting(state, 'duration').emissionRevision, 1);
    assert.equal(setting(state, 'duration').applicationPosition, 2);
    assert.equal(setting(state, 'duration').override, true);

    outcome = runtime.step({ nowMs: 2, contextFacts: facts(2, event(fingerprint, 'duration-5-equal-default', 1, 3, [ok(ids.duration, 'Duration', 300000)])) });
    state = runtime.contextSnapshot().state;
    assert.deepEqual(setting(state, 'duration').result, { ok: true, value: 300000 });
    assert.equal(setting(state, 'duration').emissionRevision, 2);
    assert.equal(setting(state, 'duration').applicationPosition, 3);
    assert.equal(setting(state, 'duration').override, true);
    snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.ref-05-012-equal', completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 2 }, trace: outcome.vm, settingsState: state });
    assert.deepEqual(snapshot.observations[0], { descriptorId: 'setting.duration', defaultValue: 300000, emissionRevision: 2, applicationPosition: 3, override: true, status: 'ready', value: 300000 });

    runtime.step({ nowMs: 3, contextFacts: facts(3, event(fingerprint, 'enabled-only', 2, 4, [ok(ids.enabled, 'Bool', true)])) });
    state = runtime.contextSnapshot().state;
    assert.equal(state.settingsRevision, 3);
    assert.equal(setting(state, 'duration').emissionRevision, 2, 'unrelated Bool edit does not imply Duration override');
    assert.equal(setting(state, 'enabled').emissionRevision, 3);

    outcome = runtime.step({ nowMs: 4, contextFacts: facts(4, event(fingerprint, 'duration-fault', 3, 5, [fault(ids.duration)])) });
    state = runtime.contextSnapshot().state;
    assert.deepEqual(setting(state, 'duration').result, { ok: false, fault: 'SettingsUnavailable' });
    snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.ref-05-012-fault', completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 4 }, trace: outcome.vm, settingsState: state });
    assert.deepEqual(snapshot.observations[0], { descriptorId: 'setting.duration', defaultValue: 300000, emissionRevision: 4, applicationPosition: 5, status: 'error', error: 'SettingsUnavailable' });

    runtime.step({ nowMs: 5, contextFacts: facts(5, event(fingerprint, 'duration-recover', 4, 6, [ok(ids.duration, 'Duration', 360000)])) });
    state = runtime.contextSnapshot().state;
    assert.deepEqual(setting(state, 'duration').result, { ok: true, value: 360000 });
    const saved = runtime.contextSnapshot().bytes;
    const restored = await ControlRuntime.instantiate(wasm, artifact, { context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
    try {
      restored.restoreContextCheckpoint(saved);
      assert.deepEqual(restored.contextSnapshot().state, state);
    } finally { restored.dispose(); }

    const before = runtime.contextSnapshot();
    assert.throws(() => runtime.step({ nowMs: 6, contextFacts: facts(6, event(fingerprint, 'bad-stale', 0, 7, [ok(ids.duration, 'Duration', 420000)])) }), /settings transaction|stale/i);
    assert.deepEqual(runtime.contextSnapshot().state, before.state);
  } finally { runtime.dispose(); }
});

test('REF-05-012 native context_tape and framed WASM settings/checkpoint parity with negative restore', async () => {
  const { artifact, wasm, ids, runtime } = await fixture();
  runtime.dispose();
  const probe = await ControlRuntime.instantiateFramed(wasm, artifact, { context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: event(fingerprint, 'duration-6', 0, 2, [ok(ids.duration, 'Duration', 360000)]) },
    { scanId: 2, nowMs: 2, settings: event(fingerprint, 'duration-5-equal-default', 1, 3, [ok(ids.duration, 'Duration', 300000)]) },
    { scanId: 3, nowMs: 3, settings: event(fingerprint, 'enabled-only', 2, 4, [ok(ids.enabled, 'Bool', true)]) },
    { scanId: 4, nowMs: 4, settings: event(fingerprint, 'duration-fault', 3, 5, [fault(ids.duration)], 'producerObservation') },
    { scanId: 5, nowMs: 5, settings: event(fingerprint, 'duration-recover', 4, 6, [ok(ids.duration, 'Duration', 360000)], 'producerObservation') },
    { scanId: 6, nowMs: 6, settings: event('0000000000000000', 'bad-identity', 5, 7, [ok(ids.duration, 'Duration', 420000)]) },
    { scanId: 6, nowMs: 6, settings: event(fingerprint, 'bad-stale', 0, 7, [ok(ids.duration, 'Duration', 420000)]) },
    { scanId: 6, nowMs: 6, settings: event(fingerprint, 'bad-envelope', 5, 8, [{ configId: 999, result: { ok: true, type: 'Duration', value: 420000 } }]) },
  ];
  const native = nativeRun(artifact, attempts);
  const framed = await wasmRun(wasm, artifact, attempts);
  assert.deepEqual(native.map(row => row.accepted), [true, true, true, true, true, true, false, false, false]);
  assert.deepEqual(framed.map(row => row.accepted), native.map(row => row.accepted));
  for (let i = 0; i < attempts.length; i++) {
    assert.deepEqual(framed[i].settings, native[i].settings, `settings parity ${i}`);
    assert.equal(framed[i].checkpoint, native[i].checkpoint, `checkpoint parity ${i}`);
    if (native[i].accepted) {
      assert.deepEqual(framed[i].outcome, native[i].outcome, `full framed outcome parity ${i}`);
    } else {
      assert.match(native[i].error, /settings|fingerprint|target/i);
      assert.deepEqual(native[i].settings, native[5].settings, 'rejections leave live settings unchanged');
    }
  }
  const fresh = nativeRun(artifact, [{ scanId: 0, nowMs: 7, settings: null }], native[5].checkpoint);
  assert.equal(fresh[0].accepted, true, fresh[0].error);
  assert.deepEqual(fresh[0].settings, native[5].settings, 'fresh native owner restore retains metadata');
  const freshWasm = await wasmRun(wasm, artifact, [{ scanId: 0, nowMs: 7, settings: null }], native[5].checkpoint);
  assert.deepEqual(freshWasm[0].outcome, fresh[0].outcome);
  assert.deepEqual(freshWasm[0].settings, fresh[0].settings);
  assert.equal(freshWasm[0].checkpoint, fresh[0].checkpoint);

  const raw = Buffer.from(native[5].checkpoint, 'hex');
  const marker = Buffer.from(Uint32Array.of(ids.duration).buffer);
  const start = raw.indexOf(marker);
  assert.ok(start > 0, 'checkpoint includes duration row');
  const corrupt = Buffer.from(raw);
  corrupt.writeBigUInt64LE(0n, start + 4 + 8); // repaired checksum below: force emissionRevision to zero while value remains changed.
  let crc = ~0 >>> 0;
  for (const byte of corrupt.subarray(0, corrupt.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = ((crc >>> 1) ^ (0xedb88320 & (-(crc & 1)))) >>> 0;
  }
  corrupt.writeUInt32LE((~crc) >>> 0, corrupt.length - 4);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-settings-provenance-corrupt-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1', checkpoint: corrupt.toString('hex'),
      activation: { bootEpoch: 1, terminalCapacity: 16, bindings: [] }, steps: [] }));
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(result.status, 0, 'checksum-repaired malformed provenance is rejected');
    assert.match(result.stderr || result.stdout, /provenance|checkpoint/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('REF-05-012 initial Duration remains source-bound through an unrelated Bool edit and repeated equal emissions on native and framed WASM', async () => {
  const { artifact, runtime, wasm, ids } = await fixture();
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  runtime.dispose();
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: event(fingerprint, 'bool-only', 0, 2, [ok(ids.enabled, 'Bool', true)]) },
    { scanId: 2, nowMs: 2, settings: event(fingerprint, 'duration-default', 1, 3, [ok(ids.duration, 'Duration', 300000)]) },
    { scanId: 3, nowMs: 3, settings: event(fingerprint, 'equal-current', 2, 4, [ok(ids.duration, 'Duration', 300000)]) },
  ];
  const native = nativeRun(artifact, attempts), framed = await wasmRun(wasm, artifact, attempts);
  for (const [index, row] of native.entries()) {
    assert.equal(row.accepted, true, row.error);
    assert.deepEqual(framed[index].outcome, row.outcome);
    assert.deepEqual(framed[index].settings, row.settings);
    assert.equal(framed[index].checkpoint, row.checkpoint);
    const snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.initial-provenance',
      completion: { kind: 'completed-scan', scanId: row.outcome.scanId, logicalTimeMs: row.outcome.logicalTimeMs },
      trace: row.outcome.trace, settingsState: row.settings });
    assert.equal(snapshot.settingsRevision, index);
    const duration = snapshot.observations.find(item => item.descriptorId === 'setting.duration');
    assert.equal(duration.defaultValue, 300000);
    assert.equal(duration.value, 300000);
    assert.equal(duration.emissionRevision, index < 2 ? 0 : index);
    assert.equal(duration.override, index >= 2);
    assert.equal(duration.applicationPosition, index < 2 ? null : index + 1);
  }
});

test('REF-05-012 versioned public settings reject forged defaults and revision correlations while legacy snapshots retain their contract', async () => {
  const { artifact, runtime, ids } = await fixture();
  try {
    const result = runtime.step({ nowMs: 0, contextFacts: facts(0) });
    const state = runtime.contextSnapshot().state;
    const emit = settingsState => emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.provenance-validation',
      completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 }, trace: result.vm, settingsState });
    const initial = emit(state);
    assert.equal(artifact.interactionSchema.version, '0.4');
    assert.equal(initial.version, '0.2');
    const forgedSchema = structuredClone(artifact.interactionSchema);
    forgedSchema.descriptors[0].defaultValue = 360000;
    assert.throws(() => verifyInteractionSchema(artifact, forgedSchema), /canonical source|compiler provenance/);
    for (const mutate of [
      raw => { raw.settings[0].defaultValue = 360000; raw.settings[0].result.value = 360000; },
      raw => { raw.settingsRevision = 1; },
      raw => { raw.settingsRevision = 1; for (const [index, row] of raw.settings.entries()) { row.emissionRevision = 1; row.applicationPosition = 5 + index; row.override = true; } },
      raw => { raw.settings[0].result = { ok: false, fault: 'SettingsUnavailable' }; delete raw.settings[0].override; },
      raw => { raw.settings[0].emissionRevision = 2; raw.settings[0].applicationPosition = 5; raw.settings[0].override = true; },
    ]) {
      const raw = structuredClone(state); mutate(raw);
      assert.throws(() => emit(raw), /settings|contract/);
    }
    for (const mutate of [
      snapshot => { snapshot.observations[0].defaultValue = 360000; snapshot.observations[0].value = 360000; },
      snapshot => { snapshot.settingsRevision = 1; },
      snapshot => { snapshot.settingsRevision = 1; snapshot.observations.forEach((row, index) => { row.emissionRevision = 1; row.applicationPosition = 5 + index; row.override = true; }); },
      snapshot => { const row = snapshot.observations[0]; row.status = 'error'; row.error = 'SettingsUnavailable'; delete row.value; delete row.override; },
      snapshot => { snapshot.settingsRevision = 1; const row = snapshot.observations[0]; row.emissionRevision = 1; row.applicationPosition = 2; row.status = 'error'; row.error = 'invented'; delete row.value; delete row.override; },
    ]) {
      const snapshot = structuredClone(initial); mutate(snapshot);
      assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, false);
    }
    const legacySchema = structuredClone(artifact.interactionSchema);
    legacySchema.version = '0.3';
    legacySchema.descriptors.forEach(row => { delete row.defaultValue; });
    assert.deepEqual(verifyInteractionSchema(artifact, legacySchema), legacySchema);
    const legacy = structuredClone(initial); legacy.version = '0.1'; delete legacy.settingsRevision;
    legacy.schema.version = '0.3'; legacy.schema.sha256 = interactionSchemaSha256(legacySchema);
    legacy.observations.forEach(row => { delete row.defaultValue; delete row.emissionRevision; delete row.applicationPosition; delete row.override; });
    assert.equal(validateInteraction(legacySchema, legacy).valid, true);
    const legacyError = structuredClone(legacy);
    legacyError.observations[0] = { descriptorId: 'setting.duration', status: 'error', error: 'legacy observation error' };
    assert.equal(validateInteraction(legacySchema, legacyError).valid, true, 'new typed fault restrictions do not rewrite the legacy error contract');
    assert.equal(validateInteraction(artifact.interactionSchema, legacy).valid, false);
    const wrong = structuredClone(legacy); wrong.settingsRevision = 0;
    assert.equal(validateInteraction(legacySchema, wrong).valid, false, 'legacy is not silently interpreted as the new profile');
    assert.deepEqual(runtime.contextSnapshot().state, state);
  } finally { runtime.dispose(); }
});

test('REF-05-012 checksum-repaired semantic provenance corruption rejects atomically in native and framed WASM owners', async () => {
  const { artifact, runtime, wasm, ids } = await fixture();
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  runtime.dispose();
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null },
    { scanId: 1, nowMs: 1, settings: event(fingerprint, 'both-settings', 0, 2, [ok(ids.duration, 'Duration', 360000), ok(ids.enabled, 'Bool', true)]) },
  ];
  const original = nativeRun(artifact, attempts)[1];
  const raw = Buffer.from(original.checkpoint, 'hex');
  const layout = checkpointLayout(raw), duration = layout.rows.get(ids.duration), enabled = layout.rows.get(ids.enabled);
  const variants = [
    ['initial config provenance', bytes => { bytes.writeBigUInt64LE(0n, duration.revision); bytes.writeBigUInt64LE(0xffffffffffffffffn, duration.position); }],
    ['provenance', bytes => { bytes.writeBigUInt64LE(2n, duration.revision); }],
    ['latest settings revision', bytes => {
      for (const row of layout.rows.values()) {
        bytes.writeBigUInt64LE(0n, row.revision); bytes.writeBigUInt64LE(0xffffffffffffffffn, row.position);
      }
      bytes.writeDoubleLE(300000, duration.history + 1); bytes.writeDoubleLE(300000, duration.result + 2);
      bytes[enabled.history + 1] = 0; bytes[enabled.result + 2] = 0;
    }],
    ['position', bytes => { bytes.writeBigUInt64LE(3n, enabled.position); }],
  ];
  const owner = await ControlRuntime.instantiateFramed(wasm, artifact, { context: { bootEpoch: 2, terminalCapacity: 16, bindings: [] } });
  try {
    const before = owner.contextSnapshot();
    for (const [reason, mutate] of variants) {
      const bad = Buffer.from(raw); mutate(bad); repairChecksum(bad);
      assert.throws(() => owner.restoreContextCheckpoint(bad), new RegExp(reason));
      assert.deepEqual(owner.contextSnapshot(), before);
      assert.equal(owner.lastFrameOutcome, null);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-provenance-semantic-'));
      try {
        const module = path.join(directory, 'module.gfb'), tape = path.join(directory, 'tape.json');
        fs.writeFileSync(module, artifact.bytes);
        fs.writeFileSync(tape, JSON.stringify({ profile: 'context-settings-v1', checkpoint: bad.toString('hex'),
          activation: { bootEpoch: 2, terminalCapacity: 16, bindings: [] }, steps: [] }));
        const rejected = spawnSync(nativePath, [module, tape], { encoding: 'utf8', timeout: 10000 });
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr || rejected.stdout, new RegExp(reason));
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    }
    owner.restoreContextCheckpoint(raw);
    assert.deepEqual(owner.contextSnapshot().state, original.settings);
  } finally { owner.dispose(); }
});

test('REF-05-012 permission and VM transaction failures preserve provenance, complete outcomes and event reuse on native and framed WASM', async () => {
  const vmSource = source.replace('  output watering: Bool;', '  input divisor: Number;\n  output watering: Bool;')
    .replace('  watering <- true;', '  watering <- 1 / divisor > 0;')
    .replace('config enabled: Bool = false { access = operator;', 'config enabled: Bool = false { access = designer;');
  const { artifact, runtime, wasm, ids } = await fixture(vmSource);
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  runtime.dispose();
  const retry = event(fingerprint, 'retry-after-vm', 0, 2, [ok(ids.duration, 'Duration', 360000)]);
  const attempts = [
    { scanId: 0, nowMs: 0, settings: null, inputs: { divisor: 1 } },
    { scanId: 1, nowMs: 1, settings: event(fingerprint, 'forbidden-designer', 0, 2, [ok(ids.enabled, 'Bool', true)]), inputs: { divisor: 1 } },
    { scanId: 1, nowMs: 1, settings: retry, inputs: { divisor: 0 } },
    { scanId: 1, nowMs: 1, settings: retry, inputs: { divisor: 1 } },
  ];
  const native = nativeRun(artifact, attempts), framed = await wasmRun(wasm, artifact, attempts);
  assert.deepEqual(native.map(row => row.accepted), [true, false, false, true]);
  assert.deepEqual(framed.map(row => row.accepted), native.map(row => row.accepted));
  for (const [index, row] of native.entries()) {
    assert.deepEqual(framed[index].outcome, row.outcome);
    assert.deepEqual(framed[index].settings, row.settings);
    assert.equal(framed[index].checkpoint, row.checkpoint);
    if (!row.accepted) {
      assert.deepEqual(row.outcome, native[0].outcome);
      assert.deepEqual(row.settings, native[0].settings);
      assert.equal(row.checkpoint, native[0].checkpoint);
    }
  }
  assert.equal(setting(native[3].settings, 'duration').emissionRevision, 1);
  assert.equal(setting(native[3].settings, 'duration').applicationPosition, 2);
  assert.equal(setting(native[3].settings, 'enabled').emissionRevision, 0);
});
