import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource, literateDocument } from './helpers/literate-compile.mjs';
import { TemporarySettingsHost } from '../runtimes/wasm/temporary-settings-host.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { softwareQualityAbi } from './helpers/software-quality-observations.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const source = literateDocument(`control LiveWatering {
  config duration: Duration = 10min { min = 1min; max = 20min; step = 1min; access = operator; }
  config gain: Number = 1 { min = 0; max = 10; step = 1; access = designer; }
  state count: Int = 0;
  state active: Bool = true;
  count' = count + 1;
  timer age = elapsed(active);
  output watering: Bool;
  output age_ms, limit_ms: Duration;
  output counter: Int;
  let allowed = case duration { ok(value) => value; fault(_) => 0ms; };
  watering <- age < allowed;
  age_ms <- age;
  limit_ms <- allowed;
  counter <- count';
}`);
const artifact = await compileSource(source, { filename: 'reference-live-watering.ghost.md' });
const setting = name => artifact.manifest.configs.find(config => config.name === name);
const change = (name, value) => ({ configId: setting(name).id,
  result: { ok: true, type: setting(name).type, value } });
const activation = bootEpoch => ({ bootEpoch, terminalCapacity: 32, bindings: [] });
const packet = (nowMs, bootEpoch = 1) => ({ nowMs, contextFacts: {
  clock: { monotonicMs: nowMs, bootEpoch, wallMs: nowMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'reference-settings-clock-v1' },
  natural: [], schedules: [], settings: null,
} });
const create = (options = {}) => TemporarySettingsHost.instantiate(wasm, artifact, {
  runId: 'watering-run-1', grants: { operator: [setting('duration').id] },
  context: activation(1), ...options,
});
function event(host, eventId, changes, overrides = {}) {
  const before = host.snapshot();
  return { kind: 'ordinary', eventId, changes, actor: 'operator', reason: 'operator duration request',
    programFingerprint: before.programFingerprint, sourceSha256: before.sourceSha256,
    runId: before.runId, baseRevision: before.core.state.settingsRevision, ...overrides };
}
function parity(t, tape, { bootEpoch = 1, checkpoint = null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'program.gfb'), tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1',
    activation: activation(bootEpoch), ...(checkpoint ? { checkpoint } : {}),
    steps: tape.map(({ frame, result }) => ({ scanId: result.outcome.frame.scanId,
      logicalTimeMs: frame.nowMs, inputs: [], ...frame.contextFacts, settings: result.coreEvent })) }));
  const runner = path.join(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const run = () => execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10000 })
    .trim().split('\n').map(JSON.parse);
  const rows = run();
  assert.deepEqual(run(), rows, 'fresh native replay preserves complete outcomes');
  rows.forEach((native, index) => {
    const result = tape[index].result;
    assert.equal(native.accepted, true);
    assert.deepEqual(native.settings, result.snapshot.core.state);
    assert.equal(native.checkpoint, result.snapshot.core.checkpoint);
    assert.deepEqual(native.outcome.trace, result.outcome.vm);
    assert.deepEqual({ scanId: native.outcome.scanId, logicalTimeMs: native.outcome.logicalTimeMs }, result.outcome.frame);
  });
}
function restartInProcess(checkpoint) {
  const worker = `
    import fs from 'node:fs';
    import { compileSource } from ${JSON.stringify(new URL('../tools/compile-source.mjs', import.meta.url).href)};
    import { TemporarySettingsHost } from ${JSON.stringify(new URL('../runtimes/wasm/temporary-settings-host.mjs', import.meta.url).href)};
    const request = JSON.parse(fs.readFileSync(0, 'utf8'));
    const artifact = await compileSource(request.source, { filename: request.filename });
    const host = await TemporarySettingsHost.instantiate(fs.readFileSync(request.wasmPath), artifact, request.options);
    try {
      const restored = host.snapshot();
      const result = host.step(request.frame);
      process.stdout.write(JSON.stringify({ restored, result }));
    } finally { host.dispose(); }
  `;
  const request = { source, filename: artifact.sourceDocument.filename,
    wasmPath: path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'),
    frame: packet(0, 2), options: { runId: 'watering-run-2',
      grants: { operator: [setting('duration').id] }, context: activation(2), checkpoint, restoreApproved: true } };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', worker], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 10000,
  }));
}

test('REF-04-054 rejects the entire unauthorized live group and uses elapsed time with a valid shorter limit', async t => {
  const host = await create();
  t.after(() => host.dispose());
  const tape = [];
  const step = (frame, edit = null) => {
    const result = host.step(frame, edit);
    assert.equal(result.accepted, true);
    tape.push({ frame, result });
    return result;
  };
  step(packet(0));
  const elapsed = step(packet(360000));
  assert.deepEqual(elapsed.outcome.vm.safe, { watering: true, age_ms: 360000, limit_ms: 600000, counter: 2 });
  const before = host.snapshot();
  const rejected = event(host, 'denied-limit-and-gain', [change('duration', 300000), change('gain', 2)]);
  assert.throws(() => host.step(packet(360001), rejected), /setting permission/);
  assert.deepEqual(host.snapshot(), before, 'rejection preserves VM outcome, timer, settings, run and event position');
  const accepted = step(packet(360001), event(host, 'shorter-limit', [change('duration', 300000)]));
  assert.deepEqual(accepted.outcome.vm.safe, { watering: false, age_ms: 360001, limit_ms: 300000, counter: 3 });
  assert.equal(accepted.snapshot.runId, before.runId);
  assert.equal(accepted.snapshot.core.state.settingsRevision, 1);
  assert.equal(accepted.snapshot.position, before.position + 1);
  assert.deepEqual(accepted.snapshot.history.map(row => [row.eventId, row.applicationPosition]), [['shorter-limit', 3]]);
  parity(t, tape);
});

test('REF-05-014 approved live edit retains source Program and run while recording exact effective position', async t => {
  const host = await create();
  t.after(() => host.dispose());
  const original = structuredClone(artifact);
  const initial = host.step(packet(0));
  const before = host.snapshot();
  const frame = packet(1234), request = event(host, 'duration-live', [change('duration', 420000)]);
  const result = host.step(frame, request), after = result.snapshot;
  assert.equal(result.accepted, true);
  assert.deepEqual([after.sourceSha256, after.programFingerprint, after.runId],
    [before.sourceSha256, before.programFingerprint, before.runId]);
  assert.equal(after.sourceSha256, artifact.sourceDocument.sha256);
  assert.equal(after.core.state.programFingerprint, before.core.state.programFingerprint);
  assert.equal(after.core.state.settingsRevision, before.core.state.settingsRevision + 1);
  assert.equal(after.position, before.position + 1);
  assert.deepEqual(after.history.at(-1).request, request);
  assert.equal(after.history.at(-1).applicationPosition, 2);
  assert.equal(result.coreEvent.position, 2);
  assert.deepEqual(result.outcome.vm.safe, { watering: true, age_ms: 1234, limit_ms: 420000, counter: 2 });
  assert.deepEqual(structuredClone(artifact), original, 'live editing does not rewrite the canonical source or compiled artifact');
  for (const overrides of [{ runId: 'stale-run' }, { sourceSha256: 'a'.repeat(64) },
    { programFingerprint: '0'.repeat(16) }, { baseRevision: 0 }]) {
    const snapshot = host.snapshot();
    assert.throws(() => host.step(packet(1235), event(host, 'wrong-identity', [change('duration', 480000)], overrides)), /identity|stale revision/);
    assert.deepEqual(host.snapshot(), snapshot);
  }
  parity(t, [{ frame: packet(0), result: initial }, { frame, result }]);
});

test('REF-05-017 reference host process restart restores ordinary settings into a fresh core and distinct explicit run', async t => {
  const host = await create();
  host.step(packet(0));
  const priorDecision = host.step(packet(360000), event(host, 'persist-seven-minutes', [change('duration', 420000)]));
  const previous = host.snapshot();
  assert.equal(priorDecision.outcome.vm.safe.counter, 2);
  assert.equal(priorDecision.outcome.vm.safe.age_ms, 360000);
  const saved = JSON.parse(JSON.stringify(host.checkpoint()));
  host.dispose();
  await assert.rejects(create({ runId: 'watering-run-2', context: activation(2), checkpoint: saved }), /approval/);
  await assert.rejects(create({ context: activation(2), checkpoint: saved, restoreApproved: true }), /identity/);
  const restarted = restartInProcess(saved);
  assert.deepEqual(restartInProcess(saved), restarted, 'fresh process replay preserves the restored decision');
  const { restored, result } = restarted;
  assert.notEqual(restored.runId, previous.runId);
  assert.equal(restored.sourceSha256, previous.sourceSha256);
  assert.equal(restored.programFingerprint, previous.programFingerprint);
  assert.equal(restored.position, 0);
  assert.equal(restored.lastOutcome, null);
  assert.deepEqual(restored.ordinary, previous.ordinary);
  assert.equal(restored.core.state.settingsRevision, previous.core.state.settingsRevision);
  const frame = packet(0, 2);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.outcome.vm.safe, { watering: true, age_ms: 0, limit_ms: 420000, counter: 1 });
  assert.equal(result.snapshot.runId, 'watering-run-2');
  assert.equal(result.snapshot.position, 1);
  assert.deepEqual(result.snapshot.history, previous.history, 'restoration preserves prior event provenance under its original run');
  parity(t, [{ frame, result }], { bootEpoch: 2, checkpoint: saved.body.core.checkpoint });
});

const replacementSource = ({ module = 'Replaceable', state = 'Bool', extra = '' } = {}) => literateDocument(`control ${module} {
  input enabled: Bool;
  state held: ${state} = ${state === 'Bool' ? 'false' : '0'};
  held' = ${state === 'Bool' ? '(enabled |> recover(false))' : 'if (enabled |> recover(false)) then 1 else 0'};
  output pump: Bool;
  pump <- ${state === 'Bool' ? "held'" : "held' == 1"};
  ${extra}
}`);
async function replacementRuntime(t) {
  const initial = await compileSource(replacementSource({ extra: 'state removed: Int = 9;' }), { filename: 'reference-replacement.ghost.md' });
  const runtime = softwareQualityAbi(await GhostFlowRuntime.instantiate(wasm), initial);
  t.after(() => runtime.dispose());
  runtime.load(initial.bytes);
  runtime.addCapability('actuator', 'pump', 'bool');
  runtime.addCapability('sensor', 'enabled', 'bool');
  runtime.activate();
  runtime.setBool('enabled', true);
  runtime.tick();
  assert.equal(runtime.stateBool('held'), true);
  assert.equal(runtime.intentBool('pump'), true);
  return { runtime, initial };
}

test('REF-06-020 missing required candidate port rejects replacement and preserves the active program and pending snapshot', async t => {
  const { runtime, initial } = await replacementRuntime(t);
  const missingPort = await compileSource(replacementSource({ extra: 'output unavailable_pump: Bool; unavailable_pump <- true;' }),
    { filename: 'reference-replacement-missing-port.ghost.md' });
  assert.notEqual(missingPort.manifest.bytecodeSha256, initial.manifest.bytecodeSha256);
  const before = structuredClone(runtime.trace), journalLength = runtime.journalLength;
  runtime.setBool('enabled', false);
  assert.throws(() => runtime.hotSwap(missingPort.bytes), /capability|strategy/);
  assert.equal(runtime.stateBool('held'), true);
  assert.equal(runtime.intentBool('pump'), true);
  assert.equal(runtime.journalLength, journalLength);
  assert.deepEqual(runtime.trace, before);
  runtime.tick();
  assert.equal(runtime.stateBool('held'), false, 'the prior program consumes its already supplied snapshot after rejection');
  assert.equal(runtime.intentBool('pump'), false);
  assert.equal(runtime.trace.module, before.module);
  assert.equal(Object.hasOwn(runtime.trace.requested, 'unavailable_pump'), false);
  assert.equal(Object.hasOwn(runtime.trace.safe, 'unavailable_pump'), false);
  assert.equal(runtime.journalLength, journalLength + 1);
});

test('REF-06-021 Bool to Int state change and changed module identity reject before any migration or commit', async t => {
  for (const [candidate, reason] of [
    [{ state: 'Int' }, /state type change requires explicit migration/],
    [{ module: 'OtherIdentity' }, /same module identity/],
  ]) {
    const { runtime } = await replacementRuntime(t);
    const artifact = await compileSource(replacementSource(candidate), { filename: 'reference-replacement-candidate.ghost.md' });
    const before = structuredClone(runtime.trace), journalLength = runtime.journalLength;
    runtime.setBool('enabled', false);
    assert.throws(() => runtime.hotSwap(artifact.bytes), reason);
    assert.equal(runtime.stateBool('held'), true);
    assert.equal(runtime.intentBool('pump'), true);
    assert.deepEqual(runtime.trace, before);
    assert.equal(runtime.journalLength, journalLength);
    runtime.tick();
    assert.equal(runtime.stateBool('held'), false);
    assert.equal(runtime.intentBool('pump'), false);
    assert.equal(runtime.journalLength, journalLength + 1);
  }
});

test('REF-06-021 compatible state keeps its value while new state defaults removed state disappears and inputs require a fresh snapshot', async t => {
  const { runtime, initial } = await replacementRuntime(t);
  const candidate = await compileSource(replacementSource({ extra: 'state fresh: Int = 7;' }),
    { filename: 'reference-replacement-compatible.ghost.md' });
  assert.notEqual(candidate.sourceDocument.sha256, initial.sourceDocument.sha256);
  assert.notEqual(candidate.manifest.bytecodeSha256, initial.manifest.bytecodeSha256);
  assert.equal(runtime.stateInt('removed'), 9);
  runtime.setBool('enabled', false);
  runtime.hotSwap(candidate.bytes);
  assert.equal(runtime.stateBool('held'), true);
  assert.equal(runtime.stateInt('fresh'), 7);
  assert.equal(runtime.stateInt('removed'), undefined);
  assert.equal(runtime.intentBool('pump'), undefined);
  const journalLength = runtime.journalLength;
  assert.throws(() => runtime.tick(), /input|snapshot/);
  assert.equal(runtime.journalLength, journalLength);
  assert.equal(runtime.stateBool('held'), true);
  assert.equal(runtime.intentBool('pump'), undefined);
  runtime.setBool('enabled', false);
  runtime.tick();
  assert.equal(runtime.stateBool('held'), false);
  assert.equal(runtime.intentBool('pump'), false);
});
