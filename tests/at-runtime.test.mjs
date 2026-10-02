import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { atSource } from './helpers/at-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const activation = { bootEpoch: 1, terminalCapacity: 8, bindings: [] };
const planned = Date.UTC(2026, 0, 1, 8);
function facts(mono, delta, { trusted = true, boot = 1 } = {}) {
  return { clock: { monotonicMs: mono, bootEpoch: boot, wallMs: trusted ? planned + delta : null,
    uncertaintyMs: 0, trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'at-clock-v1' },
    natural: [], schedules: [], settings: null };
}
async function parity(steps, due, missed, source = atSource()) {
  source = source.replace('output alarm: Bool;',
    'output alarm: Bool; output missed_alarm: Bool; missed_alarm <- appointment.missed;');
  const artifact = await compileSource(source, { filename: 'at-runtime.ghost.md' });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-at-'));
  try {
    const frames = steps.map(({ mono, delta, allow = true, trusted = true }, scanId) => ({ scanId,
      logicalTimeMs: mono, inputs: [{ name: 'allow', type: 'Bool', value: allow }], ...facts(mono, delta, { trusted }) }));
    const artifactPath = path.join(dir, 'at.gfb'); writeArtifact(artifact, artifactPath);
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-periodic-v1', activation, steps: frames }));
    const exe = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
    const native = spawnSync(exe, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10000 });
    assert.equal(native.status, 0, native.error?.message || native.stderr || native.stdout || 'native runner failed');
    const rows = native.stdout.trim().split('\n').map(JSON.parse);
    const traces = steps.map(({ mono, delta, allow = true, trusted = true }) => runtime.step({ nowMs: mono,
      inputs: { allow }, contextFacts: facts(mono, delta, { trusted }) }).vm);
    assert.deepEqual(traces.map(t => t.safe.alarm), due);
    assert.deepEqual(traces.map(t => t.safe.missed_alarm), missed);
    assert.deepEqual(traces.map(t => (t.contextTrace ?? []).some(o => ['ObservationGap','ConditionsFalseAtPulse','BaselinePastMissed'].includes(o.decision))), missed);
    rows.forEach((row, i) => { assert.equal(row.accepted, true); assert.deepEqual(row.outcome.trace, traces[i]); });
    const scenarioPath = path.join(dir, 'scenario.toon');
    fs.writeFileSync(scenarioPath, encode({ format: 'GhostFlow/scenario-v1', id: 'at-singleton',
      initialInputs: frames[0].inputs, keyBindings: [], context: activation,
      actions: steps.flatMap(({ mono, delta, allow = true, trusted = true }) => [
        { kind: 'input', name: 'allow', type: 'Bool', value: allow },
        { kind: 'scan', atMs: mono, contextFacts: facts(mono, delta, { trusted }) }]) }));
    const simulation = runScenario(artifactPath, scenarioPath, { format: 'json' });
    assert.equal(simulation.success, true, simulation.encoded);
    const scans = JSON.parse(simulation.encoded).scans;
    assert.deepEqual(scans.map(s => s.safeVirtualIntent.alarm), due);
    assert.deepEqual(scans.map(s => s.safeVirtualIntent.missed_alarm), missed);
    scans.forEach((scan, i) => assert.deepEqual(scan.contextTrace, traces[i].contextTrace));
    return traces;
  } finally { runtime.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('REF-03-023: false 08:00 pulse stays missed at 08:01 and reading Schedule leaves Idle output off in native and WASM', async () => {
  const idleSource = atSource({ declarations: 'input allow: Bool; state idle: Bool = true; state observed: Bool = false;',
    output: "idle' = idle; observed' = appointment.due; alarm <- !idle;" });
  const steps = [{ mono: 0, delta: -1, allow: false },
    { mono: 1, delta: 0, allow: false }, { mono: 60_001, delta: 60_000, allow: true }];
  const missed = await parity(steps, [false,false,false], [false,true,false], idleSource);
  const record = missed[1].contextTrace.find(record => record.decision === 'ConditionsFalseAtPulse');
  assert.ok(record, 'the 08:00 predicate failure is an explicit terminal observation');
  assert.equal(record.plannedWallMs, planned);
  assert.match(record.occurrenceId, /:at$/);
  assert.deepEqual(missed[2].contextTrace ?? [], [], '08:01 creates no new occurrence or delayed admission');
  for (const trace of missed) {
    assert.equal(trace.stateAfter.idle, true);
    assert.equal(trace.stateAfter.observed, false);
    assert.equal(trace.requested.alarm, false);
    assert.equal(trace.safe.alarm, false);
  }
  assert.deepEqual(await parity(steps, [false,false,false], [false,true,false], idleSource), missed,
    'fresh native/WASM/ghostsim execution preserves the complete observation trace');
  // A true crossing proves the Schedule was actually evaluated, but reading its
  // due value into state cannot authorize an unconnected Idle output.
  const admitted = await parity(steps.map(step => ({ ...step, allow: true })),
    [false,false,false], [false,false,false], idleSource);
  assert.equal(admitted[1].stateAfter.observed, true);
  assert.equal(admitted[1].stateAfter.idle, true);
  assert.equal(admitted[1].contextTrace.some(record => record.decision === 'Due'), true);
  assert.equal(admitted[1].requested.alarm, false);
  assert.equal(admitted[1].safe.alarm, false);
  assert.equal(admitted[2].stateAfter.observed, false);
});

test('GF-TEST-at-runtime: exact crossing and rollback emit the singleton once in native WASM and ghostsim', async () => {
  const traces = await parity([{ mono: 0, delta: -1 }, { mono: 1, delta: 0 }, { mono: 2, delta: 0 },
    { mono: 3, delta: -1 }, { mono: 4, delta: 1 }], [false,true,false,false,false], [false,false,false,false,false]);
  const occurrence = traces[1].contextTrace.find(o => o.decision === 'Due');
  assert.equal(occurrence.plannedWallMs, planned);
  assert.match(occurrence.occurrenceId, /:at$/);
});
test('GF-TEST-at-runtime: false predicate and observation gap consume without later replay', async () => {
  await parity([{ mono: 0, delta: -1 }, { mono: 1, delta: 0, allow: false }, { mono: 2, delta: 1 }],
    [false,false,false], [false,true,false]);
  await parity([{ mono: 0, delta: -1 }, { mono: 60001, delta: 0 }, { mono: 60002, delta: 1 }],
    [false,false,false], [false,true,false]);
  await parity([{ mono: 0, delta: -60000 }, { mono: 60000, delta: 0 }], [false,true], [false,false]);
  await parity([{ mono: 0, delta: -60001 }, { mono: 1, delta: 0 }], [false,false], [false,true]);
});
test('GF-TEST-at-runtime: boot and trust recovery baseline never catch up past At', async () => {
  await parity([{ mono: 0, delta: 0 }, { mono: 1, delta: -1 }, { mono: 2, delta: 0 }],
    [false,false,false], [true,false,false]);
  await parity([{ mono: 0, delta: -1 }, { mono: 1, delta: 0, trusted: false },
    { mono: 2, delta: 1 }, { mono: 3, delta: -1 }, { mono: 4, delta: 0 }],
    [false,false,false,false,false], [false,false,true,false,false]);
});

test('GF-TEST-at-runtime: checkpointed terminal identities survive reboot rollback; pre-event checkpoints remain eligible', async t => {
  const source = atSource().replace('output alarm: Bool;', 'output alarm: Bool; output missed_alarm: Bool;')
    .replace('alarm <- appointment.due;', 'alarm <- appointment.due; missed_alarm <- appointment.missed;');
  const artifact = await compileSource(source, { filename: 'at-checkpoint.ghost.md' });
  for (const admitted of [true, false, null]) {
    const original = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
    const restored = await ControlRuntime.instantiateFramed(wasm, artifact, { context: { ...activation, bootEpoch: 2 } });
    t.after(() => { original.dispose(); restored.dispose(); });
    original.step({ nowMs: 0, inputs: { allow: true }, contextFacts: facts(0, -1) });
    if (admitted !== null) original.step({ nowMs: 1, inputs: { allow: admitted }, contextFacts: facts(1, 0) });
    restored.restoreContextCheckpoint(original.contextSnapshot().bytes);
    const before = restored.contextSnapshot().bytes;
    const corrupt = before.slice(); corrupt[0] ^= 1;
    assert.throws(() => restored.restoreContextCheckpoint(corrupt), /checkpoint/);
    assert.deepEqual(restored.contextSnapshot().bytes, before);
    if (admitted !== null) {
      const foreignIdentity = Buffer.from(before);
      const position = foreignIdentity.indexOf(Buffer.from(':at'));
      assert.notEqual(position, -1);
      foreignIdentity[position + 2] = 'x'.charCodeAt(0);
      assert.throws(() => restored.restoreContextCheckpoint(foreignIdentity), /checkpoint|identity/);
      assert.deepEqual(restored.contextSnapshot().bytes, before, 'invalid occurrence origin preserves restored state');
    }
    restored.step({ nowMs: 0, inputs: { allow: true }, contextFacts: facts(0, -1, { boot: 2 }) });
    const trace = restored.step({ nowMs: 1, inputs: { allow: true }, contextFacts: facts(1, 0, { boot: 2 }) }).vm;
    assert.equal(trace.safe.alarm, admitted === null);
    assert.equal(trace.safe.missed_alarm, false, 'restored terminal miss must not emit another missed pulse');
    assert.equal((trace.contextTrace ?? []).some(o => o.decision === 'ConditionsFalseAtPulse'), false);
  }
});

test('GF-TEST-at-runtime: wrong program checkpoint and invalid capacity reject before any scan', async t => {
  const a = await compileSource(atSource(), { filename: 'at-binding.ghost.md' });
  const b = await compileSource(atSource({ at: '2026-01-01T08:00:01Z' }), { filename: 'at-binding.ghost.md' });
  const original = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  const other = await ControlRuntime.instantiateFramed(wasm, b, { context: { ...activation, bootEpoch: 2 } });
  t.after(() => { original.dispose(); other.dispose(); });
  original.step({ nowMs: 0, inputs: { allow: true }, contextFacts: facts(0, -1) });
  const before = other.contextSnapshot().bytes;
  assert.throws(() => other.restoreContextCheckpoint(original.contextSnapshot().bytes), /checkpoint|program|fingerprint/);
  assert.deepEqual(other.contextSnapshot().bytes, before);
  await assert.rejects(ControlRuntime.instantiateFramed(wasm, a,
    { context: { ...activation, terminalCapacity: 0 } }), /capacity|terminalCapacity/);
});

test('GF-TEST-at-runtime: failed scan crossing discards consumed state and retries once', async t => {
  const source = atSource({ declarations: 'input allow: Bool; input divisor: Int;',
    output: 'alarm <- appointment.due && ((1 div divisor) == 1);' });
  const artifact = await compileSource(source, { filename: 'at-atomic.ghost.md' });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 0, inputs: { allow: true, divisor: 1 }, contextFacts: facts(0, -1) });
  const before = runtime.contextSnapshot().bytes;
  assert.throws(() => runtime.step({ nowMs: 1, inputs: { allow: true, divisor: 0 }, contextFacts: facts(1, 0) }), /zero|division/i);
  assert.deepEqual(runtime.contextSnapshot().bytes, before);
  assert.equal(runtime.step({ nowMs: 1, inputs: { allow: true, divisor: 1 }, contextFacts: facts(1, 0) }).vm.safe.alarm, true);
  assert.equal(runtime.step({ nowMs: 2, inputs: { allow: true, divisor: 1 }, contextFacts: facts(2, 1) }).vm.safe.alarm, false);
});

test('GF-TEST-at-runtime: old headers and forged host occurrence evidence fail closed', async t => {
  const artifact = await compileSource(atSource(), { filename: 'at-reject.ghost.md' });
  const raw = await GhostFlowRuntime.instantiate(wasm); t.after(() => raw.dispose());
  for (const format of [11,12,13]) { const bytes = Buffer.from(artifact.bytes); bytes.writeUInt16LE(format, 4);
    assert.throws(() => raw.load(bytes), /tag|prelude|format|descriptor|version/); }
  const periodicSource = atSource().replace('appointment: At', 'appointment: Periodic')
    .replace('at = datetime`2026-01-01T08:00:00Z`;', 'every = 1s; anchor = instant(datetime`2026-01-01T08:00:00Z`); interval_change = preserve_anchor;');
  const periodic = await compileSource(periodicSource, { filename: 'at-forged-profile.ghost.md' });
  const forgedHeader = Buffer.from(periodic.bytes); forgedHeader.writeUInt16LE(14, 4);
  assert.throws(() => raw.load(forgedHeader), /At-only schedule definitions/);
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  t.after(() => runtime.dispose());
  const forged = facts(0, -1); forged.schedules.push({ site: artifact.manifest.schedules[0].site,
    coverageStartMs: 0, coverageEndMs: 253402300799999, provider: null, calendar: null, rows: [] });
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { allow: true }, contextFacts: forged }), /requirements|facts/);
  const manifest = structuredClone(artifact.manifest); manifest.schedules[0].timezone = 'UTC';
  await assert.rejects(ControlRuntime.instantiateFramed(wasm, { ...artifact, manifest }, { context: activation }), /At schedule|unexpected|unsupported/i);
  const shifted = structuredClone(artifact.manifest); shifted.schedules[0].atMs += 10000;
  const nativeOwned = await ControlRuntime.instantiateFramed(wasm, { ...artifact, manifest: shifted }, { context: activation });
  t.after(() => nativeOwned.dispose());
  nativeOwned.step({ nowMs: 0, inputs: { allow: true }, contextFacts: facts(0, -1) });
  const trace = nativeOwned.step({ nowMs: 1, inputs: { allow: true }, contextFacts: facts(1, 0) }).vm;
  assert.equal(trace.safe.alarm, true, 'manifest date cannot replace the bytecode-owned instant');
});
