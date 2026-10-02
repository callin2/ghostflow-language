import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { verifyInteractionSchema } from '../tools/interaction-schema.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = 'contracts/interaction-v0/examples/operator-settings.ghost.md';
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const clock = ms => ({ monotonicMs: ms, bootEpoch: 1, wallMs: ms, uncertaintyMs: 0,
  trusted: true, unknownReason: null, sourceRevision: 'renderer-validation-clock' });
const facts = (ms, settings = null) => ({ clock: clock(ms), natural: [], schedules: [], settings });

// Two presentation fixtures; neither validates, clamps, rounds or grants access.
// Mutation requests still enter the existing authorized-settings execution boundary.
function consumers(descriptor, configId) {
  const semantic = structuredClone(descriptor);
  return [
    { view: { presentation: 'time-entry', unit: 'minutes', semantic },
      submit: minutes => ({ configId, result: { ok: true, type: semantic.sourceType.name, value: Number(minutes) * 60_000 } }) },
    { view: { presentation: 'slider', unit: 'milliseconds', semantic: structuredClone(descriptor) },
      submit: milliseconds => ({ configId, result: { ok: true, type: descriptor.sourceType.name, value: milliseconds } }) },
  ];
}

async function fixture() {
  const artifact = await compileSource(fs.readFileSync(path.join(root, sourcePath), 'utf8'), {
    filename: sourcePath, interactionSourceIdentity: {
      documentId: 'source.renderer-validation', revisionId: 'revision.renderer-validation.1',
    },
  });
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { context: activation });
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  runtime.dispose();
  return { artifact, wasm, fingerprint };
}

async function replay(artifact, wasm, attempts) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-renderer-settings-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1', activation,
      steps: attempts.map(({ scanId, ms, settings }) => ({ scanId, logicalTimeMs: ms, inputs: [], ...facts(ms, settings) })) }));
    const native = spawnSync(path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`),
      [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const nativeRows = native.stdout.trim().split('\n').filter(Boolean).map(line => {
      const row = JSON.parse(line);
      return row.accepted ? row : { ...row, outcome: row.lastOutcome };
    });
    assert.equal(nativeRows.length, attempts.length, 'every submitted scan has a native receipt');
    const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
    try {
      let trace = null;
      return attempts.map(({ scanId, ms, settings }, index) => {
        let accepted = true, error = null;
        try {
          const outcome = runtime.step({ nowMs: ms, contextFacts: facts(ms, settings) });
          assert.equal(outcome.frame.scanId, scanId);
          trace = structuredClone(outcome.vm);
        } catch (failure) { accepted = false; error = failure.message; }
        const state = runtime.contextSnapshot();
        const row = { accepted, outcome: structuredClone(runtime.lastFrameOutcome),
          settings: state.state, checkpoint: Buffer.from(state.bytes).toString('hex') };
        assert.equal(row.accepted, nativeRows[index].accepted);
        assert.deepEqual(row.outcome, nativeRows[index].outcome);
        assert.deepEqual(row.settings, nativeRows[index].settings);
        assert.equal(row.checkpoint, nativeRows[index].checkpoint);
        return { ...row, error, trace: structuredClone(trace) };
      });
    } finally { runtime.dispose(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const event = (fingerprint, id, changes, position = 2, baseRevision = 0) => ({
  programFingerprint: fingerprint, eventId: id, baseRevision, position, origin: 'operatorEdit', changes,
});

test('REF-05-019 time-entry and slider preserve Duration off-grid fault and recovery in native WASM', async () => {
  const { artifact, wasm, fingerprint } = await fixture();
  const descriptor = artifact.interactionSchema.descriptors.find(item => item.id === 'setting.duration');
  const config = artifact.manifest.configs.find(item => item.name === 'duration');
  const enabled = artifact.manifest.configs.find(item => item.name === 'enabled');
  assert.deepEqual(descriptor.sourceType, { kind: 'builtin', name: 'Duration', unit: 'ms' });
  assert.deepEqual(descriptor.constraint, { kind: 'range', min: 60_000, max: 1_200_000, step: 60_000 });
  assert.deepEqual(descriptor.access, ['read']);
  assert.equal(descriptor.authority, 'operator');
  const [entry, slider] = consumers(descriptor, config.id);
  assert.notEqual(entry.view.presentation, slider.view.presentation);
  assert.deepEqual(entry.view.semantic, slider.view.semantic);
  assert.deepEqual(entry.view.semantic, descriptor);
  const offGrid = [entry.submit('1.5'), slider.submit(90_000)];
  const onGrid = [entry.submit('2'), slider.submit(120_000)];
  assert.deepEqual(offGrid[0], offGrid[1]);
  assert.deepEqual(onGrid[0], onGrid[1]);
  const runs = [];
  for (let index = 0; index < offGrid.length; index++) {
    const rows = await replay(artifact, wasm, [
      { scanId: 0, ms: 0, settings: event(fingerprint, 'enable-control', [{ configId: enabled.id, result: { ok: true, type: 'Bool', value: true } }], 1, 0) },
      { scanId: 1, ms: 1, settings: event(fingerprint, 'off-grid-request', [offGrid[index]], 2, 1) },
      { scanId: 2, ms: 2, settings: event(fingerprint, 'recovery-request', [onGrid[index]], 3, 2) },
    ]);
    assert.equal(rows[0].trace.safe.ready, true, 'positive control distinguishes fault from previous/default success');
    assert.equal(rows[1].accepted, true, 'authorized invalid payload is admitted on the fault rail');
    assert.equal(rows[1].settings.settingsRevision, 2);
    const invalid = rows[1].settings.settings.find(item => item.name === 'duration');
    assert.deepEqual(invalid.result, { ok: false, fault: 'SettingsInvalid' });
    assert.equal(invalid.emissionRevision, 2);
    assert.equal(invalid.applicationPosition, 2);
    assert.equal(invalid.defaultValue, 300_000, 'fault does not rewrite the authored default');
    assert.equal(rows[1].trace.safe.ready, false, 'consumer reads fault, not rounded or previous value');
    const faultSnapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.renderer-grid',
      completion: { kind: 'completed-scan', scanId: 1, logicalTimeMs: 1 },
      trace: rows[1].trace, settingsState: rows[1].settings });
    assert.equal(validateInteraction(artifact.interactionSchema, faultSnapshot).valid, true);
    assert.deepEqual(faultSnapshot.observations.find(item => item.descriptorId === descriptor.id), {
      descriptorId: descriptor.id, defaultValue: 300_000, emissionRevision: 2,
      applicationPosition: 2, status: 'error', error: 'SettingsInvalid',
    });
    assert.equal(rows[2].accepted, true);
    assert.equal(rows[2].settings.settingsRevision, 3);
    assert.equal(rows[2].trace.safe.ready, true, 'valid recovery restores the success branch');
    assert.equal(rows[2].settings.settings.find(item => item.name === 'duration').result.value, 120_000);
    const snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.renderer-grid',
      completion: { kind: 'completed-scan', scanId: 2, logicalTimeMs: 2 },
      trace: rows[2].trace, settingsState: rows[2].settings });
    assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
    runs.push(rows);
  }
  assert.deepEqual(runs[0], runs[1], 'both views receive exactly the same typed fault and recovery result');
});

test('REF-05-019 presentation cannot grant setting permission or change type and source provenance', async () => {
  const { artifact, wasm, fingerprint } = await fixture();
  const descriptor = artifact.interactionSchema.descriptors.find(item => item.id === 'setting.duration');
  const duration = artifact.manifest.configs.find(item => item.name === 'duration');
  const duty = artifact.manifest.configs.find(item => item.name === 'duty');
  for (const consumer of consumers(descriptor, duration.id)) {
    const forged = structuredClone(artifact.interactionSchema);
    forged.descriptors.find(item => item.id === descriptor.id).access.push('write');
    assert.throws(() => verifyInteractionSchema(forged, artifact), /schema|contract|access/i);
    for (const mutate of [
      item => { item.sourceType = { kind: 'builtin', name: 'Number', unit: null }; },
      item => { item.constraint.step = 30_000; },
      item => { item.authority = 'designer'; },
      item => { item.provenance.sourceNode.id += 1; },
    ]) {
      const candidate = structuredClone(artifact.interactionSchema);
      mutate(candidate.descriptors.find(item => item.id === descriptor.id));
      assert.throws(() => verifyInteractionSchema(candidate, artifact));
    }
    assert.deepEqual(consumer.view.semantic, descriptor);
  }
  // Observing a designer setting grants no operator-edit permission; no renderer
  // fixture or schema access field serves as the mutation authorization owner.
  const rows = await replay(artifact, wasm, [
    { scanId: 0, ms: 0, settings: null },
    { scanId: 1, ms: 1, settings: event(fingerprint, 'designer-forgery', [{ configId: duty.id, result: { ok: true, type: 'Percent', value: 60 } }]) },
    { scanId: 1, ms: 1, settings: event(fingerprint, 'type-forgery', [{ configId: duration.id, result: { ok: true, type: 'Bool', value: true } }]) },
    { scanId: 2, ms: 2, settings: event(fingerprint, 'authorized-duration', [{ configId: duration.id, result: { ok: true, type: 'Duration', value: 120_000 } }], 3, 1) },
  ]);
  assert.equal(rows[1].accepted, false);
  assert.match(rows[1].error, /settings target/);
  assert.deepEqual(rows[1].settings, rows[0].settings);
  assert.equal(rows[1].checkpoint, rows[0].checkpoint);
  assert.deepEqual(rows[1].outcome, rows[0].outcome);
  assert.equal(rows[2].accepted, true, 'identified authorized type mismatch is a stream fault');
  assert.deepEqual(rows[2].settings.settings.find(item => item.name === 'duration').result,
    { ok: false, fault: 'SettingsInvalid' });
  assert.equal(rows[3].accepted, true);
});
