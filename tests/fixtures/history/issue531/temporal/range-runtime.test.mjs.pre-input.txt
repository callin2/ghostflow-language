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
import { runScenario } from '../tools/ghostsim.mjs';
import { dailySlotsRange } from './helpers/range-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const hour = 3_600_000;

function facts(site, monotonicMs, wallMs, trusted = true) {
  return { clock: { monotonicMs, bootEpoch: 1, wallMs, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'range-test-v1' },
  natural: [], schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: null, rows: [] }], settings: null };
}

async function parity(source, steps, expected, { checkpoints = false } = {}) {
  const artifact = await compileSource(source, { filename: 'range-runtime.ghost.md' });
  assert.equal(artifact.bytes.readUInt16LE(4), 12);
  const site = artifact.manifest.schedules[0].site;
  const frames = steps.map(({ mono, wall, trusted = true, inputs = {} }, scanId) => ({
    scanId, logicalTimeMs: mono,
    inputs: Object.entries(inputs).map(([name, value]) => ({ name, type: 'Bool', value })),
    ...facts(site, mono, wall, trusted),
  }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  try {
    const artifactPath = path.join(directory, 'range.gfb');
    writeArtifact(artifact, artifactPath);
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(tapePath, JSON.stringify({ profile: checkpoints ? 'context-civil-v1' : 'context-periodic-v1', activation, steps: frames }));
    const native = spawnSync(path.join(root, 'target/release/examples/context_tape'), [artifactPath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const rows = native.stdout.trim().split('\n').map(row => JSON.parse(row));
    const snapshots = [];
    const traces = steps.map(({ mono, inputs = {} }, i) => {
      const trace = runtime.step({ nowMs: mono, inputs,
        contextFacts: facts(site, mono, steps[i].wall, steps[i].trusted ?? true) }).vm;
      if (checkpoints) snapshots.push(Buffer.from(runtime.contextSnapshot().bytes).toString('hex'));
      return trace;
    });
    assert.deepEqual(traces.map(trace => trace.safe.pump), expected);
    rows.forEach((row, i) => {
      assert.equal(row.accepted, true, JSON.stringify(row));
      assert.deepEqual(row.outcome.trace, traces[i], `native/WASM frame ${i}`);
      if (checkpoints) assert.equal(row.checkpoint, snapshots[i], `native/WASM ledger checkpoint ${i}`);
    });
    const actions = steps.flatMap(({ mono, inputs = {} }, i) => [
      ...Object.entries(inputs).map(([name, value]) => ({ kind: 'input', name, type: 'Bool', value })),
      { kind: 'scan', atMs: mono, contextFacts: facts(site, mono, steps[i].wall, steps[i].trusted ?? true) },
    ]);
    const scenarioPath = path.join(directory, 'scenario.toon');
    fs.writeFileSync(scenarioPath, encode({ format: 'GhostFlow/scenario-v1', id: 'utc-range',
      initialInputs: frames[0].inputs, keyBindings: [], context: activation, actions }));
    const simulation = runScenario(artifactPath, scenarioPath, { format: 'json' });
    assert.equal(simulation.success, true, simulation.encoded);
    const scans = JSON.parse(simulation.encoded).scans;
    assert.deepEqual(scans.map(scan => scan.safeVirtualIntent.pump), expected);
    scans.forEach((scan, i) => assert.deepEqual(scan.scheduleTrace, traces[i].scheduleTrace,
      `ghostsim/WASM schedule frame ${i}`));
    return { artifact, traces };
  } finally {
    runtime.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('REF-03-073 canonical native/WASM Range admits only remaining time after boot gap and trust recovery', async () => {
  const source = dailySlotsRange({ selected: '[07:45, 08:00]', duration: '10min' });
  const start = day + 8 * hour;
  const before = { mono: 0, wall: day + 7 * hour + 40 * 60_000 };
  const paths = [
    { name: 'boot', prefix: [], origin: 0 },
    { name: 'gap', prefix: [before], origin: 24 * 60_000 },
    { name: 'trust recovery', prefix: [before,
      { mono: 1, wall: null, trusted: false }], origin: 24 * 60_000 },
  ];
  const decisions = trace => trace.contextTrace.map(row => row.decision);
  for (const { name, prefix, origin } of paths) {
    const { traces } = await parity(source, [...prefix,
      { mono: origin, wall: start + 4 * 60_000 },
      { mono: origin + 1, wall: start + 4 * 60_000 },
      { mono: origin + 359_999, wall: start + 10 * 60_000 - 1 },
      { mono: origin + 360_000, wall: start + 10 * 60_000 },
      { mono: origin + 360_001, wall: start + 4 * 60_000 },
    ], [...prefix.map(() => false), true, true, true, false, false], { checkpoints: true });
    const rows = traces.slice(prefix.length);
    if (name === 'trust recovery') assert.deepEqual(decisions(traces[1]), ['Unknown(ClockUnknown)']);
    const admission = rows[0].contextTrace;
    assert.deepEqual(admission.filter(row => row.decision !== 'ObservationGap').map(row =>
      [row.plannedWallMs, row.decision]), [[start - 15 * 60_000, 'LateStartExpired'], [start, 'Due']], name);
    if (name === 'gap') assert.ok(decisions(rows[0]).includes('ObservationGap'));
    assert.equal(rows.flatMap(decisions).filter(decision => decision === 'Due').length, 1, name);
    assert.ok(decisions(rows[1]).includes('Active'), name);
    assert.ok(decisions(rows[2]).includes('Active'), name);
    assert.ok(decisions(rows[3]).includes('Completed'), name);
    assert.ok(decisions(rows[4]).includes('AlreadyTerminal'), `${name}: wall rollback cannot replay`);

    const expired = await parity(source, [...prefix,
      { mono: origin, wall: start + 10 * 60_000 },
      { mono: origin + 1, wall: start + 10 * 60_000 },
      { mono: origin + 2, wall: start + 4 * 60_000 },
    ], [...prefix.map(() => false), false, false, false], { checkpoints: true });
    const expiryRows = expired.traces.slice(prefix.length);
    if (name === 'trust recovery') assert.deepEqual(decisions(expired.traces[1]), ['Unknown(ClockUnknown)']);
    assert.deepEqual(expiryRows[0].contextTrace.filter(row => row.decision !== 'ObservationGap')
      .map(row => [row.plannedWallMs, row.decision]),
    [[start - 15 * 60_000, 'LateStartExpired'], [start, 'LateStartExpired']], name);
    assert.equal(expiryRows.flatMap(decisions).filter(decision => decision === 'Due').length, 0, name);
    for (const row of expiryRows.slice(1)) assert.ok(decisions(row).includes('AlreadyTerminal'), name);
  }
});

test('GF-TEST-range-runtime: unchanged accepted Range source executes late admission and touching slots in all hosts', async () => {
  await parity(dailySlotsRange(), [
    { mono: 0, wall: day + 8 * hour + 4 * 60_000 },
    { mono: 659_999, wall: day + 8 * hour + 14 * 60_000 + 59_999 },
    { mono: 660_000, wall: day + 8 * hour + 15 * 60_000 },
    { mono: 1_560_000, wall: day + 8 * hour + 30 * 60_000 },
  ], [true, true, true, false]);
});

test('GF-TEST-range-runtime: half-open expiry, late first observation and monotonic end survive wall correction and trust loss', async () => {
  const source = dailySlotsRange({ selected: '[08:00]', duration: '10min' });
  await parity(source, [{ mono: 0, wall: day + 8 * hour + 10 * 60_000 }], [false]);
  await parity(source, [
    { mono: 0, wall: day + 8 * hour + 4 * 60_000 },
    { mono: 60_000, wall: day + 7 * hour },
    { mono: 359_999, wall: null, trusted: false },
    { mono: 360_000, wall: null, trusted: false },
    { mono: 360_001, wall: day + 8 * hour + 5 * 60_000 },
  ], [true, true, true, false, false]);
});

test('GF-TEST-range-runtime: when waits inside interval; cancellation consumes occurrence without rearming', async () => {
  const source = dailySlotsRange({ selected: '[08:00]', duration: '10min',
    config: 'input allow: Bool; input stop: Bool;' })
    .replace('when = true;', 'when = allow;').replace('cancel_when = false;', 'cancel_when = stop;');
  await parity(source, [
    { mono: 0, wall: day + 8 * hour, inputs: { allow: false, stop: false } },
    { mono: 60_000, wall: day + 8 * hour + 60_000, inputs: { allow: true, stop: false } },
    { mono: 60_001, wall: day + 8 * hour + 60_001, inputs: { allow: false, stop: false } },
    { mono: 60_002, wall: day + 8 * hour + 60_002, inputs: { allow: true, stop: true } },
    { mono: 60_003, wall: day + 8 * hour + 60_003, inputs: { allow: true, stop: false } },
  ], [false, true, true, false, false]);
});

test('GF-TEST-range-runtime: midnight-crossing interval admits only its remaining duration', async () => {
  await parity(dailySlotsRange({ selected: '[23:45]', duration: '30min' }), [
    { mono: 0, wall: day + 5 * 60_000 },
    { mono: 599_999, wall: day + 14 * 60_000 + 59_999 },
    { mono: 600_000, wall: day + 15 * 60_000 },
  ], [true, true, false]);
});

test('GF-TEST-range-runtime: checkpoint recovery deduplicates and does not resume an admitted timer', async t => {
  const artifact = await compileSource(dailySlotsRange({ selected: '[08:00]', duration: '10min' }),
    { filename: 'range-recovery.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const original = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  const restored = await ControlRuntime.instantiateFramed(wasm, artifact,
    { context: { ...activation, bootEpoch: 2 } });
  t.after(() => { original.dispose(); restored.dispose(); });
  assert.equal(original.step({ nowMs: 0,
    contextFacts: facts(site, 0, day + 8 * hour + 4 * 60_000) }).vm.safe.pump, true);
  const checkpoint = original.contextSnapshot().bytes;
  restored.restoreContextCheckpoint(checkpoint);
  const corrupted = checkpoint.slice();
  corrupted[0] ^= 1;
  const before = restored.contextSnapshot().bytes;
  assert.throws(() => restored.restoreContextCheckpoint(corrupted), /checkpoint/);
  assert.deepEqual(restored.contextSnapshot().bytes, before, 'failed restore preserves state');
  const packet = facts(site, 0, day + 8 * hour + 5 * 60_000);
  packet.clock.bootEpoch = 2;
  assert.equal(restored.step({ nowMs: 0, contextFacts: packet }).vm.safe.pump, false);
});

test('GF-TEST-range-runtime: older profile headers reject UTC Range before activation', async () => {
  const artifact = await compileSource(dailySlotsRange(), { filename: 'range-version.ghost.md' });
  const bytes = Buffer.from(artifact.bytes);
  bytes.writeUInt16LE(11, 4);
  const { GhostFlowRuntime } = await import('../runtimes/wasm/ghostflow-runtime.mjs');
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try { assert.throws(() => runtime.load(bytes), /tag|prelude|format|descriptor|version/); }
  finally { runtime.dispose(); }
});

test('GF-TEST-range-runtime: immutable Daily uses the same bounded execution path', async () => {
  const source = dailySlotsRange({ selected: '[08:00]', duration: '10min' })
    .replace('DailySlots<15min>', 'Daily').replace('selected = [08:00];', 'at = time`08:00`;');
  await parity(source, [
    { mono: 0, wall: day + 8 * hour + 60_000 },
    { mono: 540_000, wall: day + 8 * hour + 10 * 60_000 },
  ], [true, false]);
});
