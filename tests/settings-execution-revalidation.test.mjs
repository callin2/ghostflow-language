import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = 'contracts/interaction-v0/examples/operator-settings.ghost.md';
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const clock = ms => ({ monotonicMs: ms, bootEpoch: 1, wallMs: ms, uncertaintyMs: 0,
  trusted: true, unknownReason: null, sourceRevision: 'execution-revalidation-clock' });
const facts = (ms, settings) => ({ clock: clock(ms), natural: [], schedules: [], settings });

async function fixture(controlName = 'OperatorSettings') {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8')
    .replace('control OperatorSettings {', `control ${controlName} {`);
  const artifact = await compileSource(source, { filename: sourcePath,
    interactionSourceIdentity: { documentId: `source.${controlName}`, revisionId: 'revision.revalidation.1' } });
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { context: activation });
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  runtime.dispose();
  return { artifact, wasm, fingerprint,
    ids: Object.fromEntries(artifact.manifest.configs.map(config => [config.name, config.id])) };
}

// Fixture-only UI checks against compiled semantic metadata. They cannot
// authenticate a sender or certify the current execution owner's baseline.
function prevalidate(artifact, changes) {
  for (const change of changes) {
    const config = artifact.manifest.configs.find(item => item.id === change.configId);
    assert.ok(config, 'UI recognizes the source setting');
    assert.equal(config.settings.access, 'operator');
    assert.equal(change.result.type, config.type);
    assert.equal(change.result.ok, true);
    if (config.type === 'Bool') assert.equal(typeof change.result.value, 'boolean');
    else {
      const { min, max, step } = config.settings;
      assert.ok(Number.isSafeInteger(change.result.value));
      assert.ok(change.result.value >= min && change.result.value <= max);
      assert.equal((change.result.value - min) % step, 0);
    }
  }
  return true;
}
const ok = (configId, type, value) => ({ configId, result: { ok: true, type, value } });
const event = (programFingerprint, eventId, baseRevision, position, changes) => ({
  programFingerprint, eventId, baseRevision, position, origin: 'operatorEdit', changes,
});

async function replay(artifact, wasm, attempts) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-settings-revalidation-'));
  try {
    const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.json');
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
    assert.equal(nativeRows.length, attempts.length, 'every submitted request has a native receipt');
    const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
    try {
      let safe = null;
      return attempts.map(({ scanId, ms, settings }, index) => {
        let accepted = true, error = null;
        try {
          const outcome = runtime.step({ nowMs: ms, contextFacts: facts(ms, settings) });
          assert.equal(outcome.frame.scanId, scanId);
          safe = structuredClone(outcome.vm.safe);
        } catch (failure) { accepted = false; error = failure.message; }
        const current = runtime.contextSnapshot();
        const row = { accepted, outcome: structuredClone(runtime.lastFrameOutcome),
          settings: current.state, checkpoint: Buffer.from(current.bytes).toString('hex') };
        assert.equal(row.accepted, nativeRows[index].accepted);
        assert.deepEqual(row.outcome, nativeRows[index].outcome);
        assert.deepEqual(row.settings, nativeRows[index].settings);
        assert.equal(row.checkpoint, nativeRows[index].checkpoint);
        return { ...row, error, safe: structuredClone(safe) };
      });
    } finally { runtime.dispose(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function unchanged(rejected, before) {
  assert.equal(rejected.accepted, false);
  assert.match(rejected.error, /invalid or stale settings transaction/);
  assert.deepEqual(rejected.settings, before.settings);
  assert.equal(rejected.checkpoint, before.checkpoint);
  assert.deepEqual(rejected.outcome, before.outcome);
}

test('REF-08-009 UI-valid stale mixed settings reject atomically and fresh-baseline retry commits on native WASM', async () => {
  const { artifact, wasm, fingerprint, ids } = await fixture();
  const cachedChanges = [ok(ids.duration, 'Duration', 420_000), ok(ids.enabled, 'Bool', true)];
  assert.equal(prevalidate(artifact, cachedChanges), true);
  const cachedRequest = event(fingerprint, 'cached-ui-request', 0, 3, cachedChanges);
  const rows = await replay(artifact, wasm, [
    { scanId: 0, ms: 0, settings: null },
    { scanId: 1, ms: 1, settings: event(fingerprint, 'concurrent-authorized-change', 0, 2, [ok(ids.duration, 'Duration', 360_000)]) },
    { scanId: 2, ms: 2, settings: cachedRequest },
    { scanId: 2, ms: 2, settings: { ...cachedRequest, baseRevision: 1 } },
  ]);
  assert.equal(rows[1].settings.settingsRevision, 1);
  unchanged(rows[2], rows[1]);
  assert.deepEqual(rows[2].settings.settings.find(item => item.name === 'duration').result, { ok: true, value: 360_000 });
  assert.deepEqual(rows[2].settings.settings.find(item => item.name === 'enabled').result, { ok: true, value: false });
  assert.equal(rows[3].accepted, true, 'rejection consumes neither scan nor effective position nor event ID');
  assert.equal(rows[3].settings.settingsRevision, 2);
  for (const [name, value] of [['duration', 420_000], ['enabled', true]]) {
    const setting = rows[3].settings.settings.find(item => item.name === name);
    assert.deepEqual(setting.result, { ok: true, value });
    assert.equal(setting.emissionRevision, 2);
    assert.equal(setting.applicationPosition, 3);
  }
  assert.equal(rows[3].safe.ready, true);
});

test('REF-08-009 UI-valid foreign Program settings reject despite matching names types and baseline', async () => {
  const current = await fixture(), foreign = await fixture('ForeignOperatorSettings');
  assert.notEqual(current.fingerprint, foreign.fingerprint);
  assert.deepEqual(current.ids, foreign.ids);
  const changes = [ok(foreign.ids.duration, 'Duration', 420_000), ok(foreign.ids.enabled, 'Bool', true)];
  assert.equal(prevalidate(foreign.artifact, changes), true);
  assert.equal(prevalidate(current.artifact, changes), true);
  const request = event(foreign.fingerprint, 'foreign-ui-request', 0, 2, changes);
  const rows = await replay(current.artifact, current.wasm, [
    { scanId: 0, ms: 0, settings: null },
    { scanId: 1, ms: 1, settings: request },
    { scanId: 1, ms: 1, settings: { ...request, programFingerprint: current.fingerprint } },
  ]);
  unchanged(rows[1], rows[0]);
  assert.equal(rows[1].settings.settingsRevision, 0);
  assert.equal(rows[2].accepted, true);
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.equal(rows[2].settings.programFingerprint, current.fingerprint);
  assert.deepEqual(rows[2].settings.settings.find(item => item.name === 'duration').result, { ok: true, value: 420_000 });
});
