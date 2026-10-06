// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime as BaseControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativeRunner = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const planned = 8 * 60 * 60 * 1000;
const wallOrigin = planned - 1000;
const filename = 'ref-03-027-tide-run-late-constraint.ghost.md';
const source = '# REF-03-027 finite Tide Run and safe constraint\n\n```ghost\n'
  + 'control TideRunLateConstraint {\n'
  + 'input allowed, low_water: Bool;\n'
  + 'provider harbor_tides: TidePredictions;\n'
  + 'schedule high_tide: Tide {\n'
  + 'source = harbor_tides; timezone = "UTC"; at = tide`high - 30min`;\n'
  + 'basis = run(5min, within(10min)); when = allowed |> recover(false); cancel_when = false;\n'
  + 'clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;\n'
  + '}\nstate runs: Int = 0; runs\' = if high_tide.due then runs + 1 else runs;\n'
  + 'output pump, active, due, water_ready: Bool; output admitted: Int;\n'
  + 'pump <- high_tide.active; active <- high_tide.active; due <- high_tide.due; admitted <- runs\';\n'
  + 'water_ready <- case low_water { ok(value) => !value; fault(_) => false; };\n'
  + 'require pump => water_ready;\n'
  + '}\n```\n';
const binding = { kind: 'tide', provider: 'harbor_tides', namespace: 'ref-03-027', station: 'virtual-harbor',
  bindingRevision: 'binding-v1', location: 'reference-site', timezone: 'UTC', criteria: 'high', maxUncertaintyMs: 0 };
const activation = { bootEpoch: 216, terminalCapacity: 16, bindings: [binding] };

function step(site, time, allowed, lowWater, scanId) {
  return { scanId, logicalTimeMs: time, inputs: [{ name: 'allowed', value: allowed }, { name: 'low_water', value: lowWater }],
    clock: { monotonicMs: time, bootEpoch: 216, wallMs: wallOrigin + time, uncertaintyMs: 0,
      trusted: true, unknownReason: null, sourceRevision: 'clock-v1' }, natural: [], settings: null,
    schedules: [{ site, coverageStartMs: 0, coverageEndMs: 86_400_000, calendar: null,
      provider: { binding, providerRevision: 'tides-v1', coverageStartMs: 0, coverageEndMs: 86_400_000,
        expiresAtMs: 86_400_001, uncertaintyMs: 0, fault: null, classifications: ['high'] },
      rows: [{ sourceDay: 0, slotKey: 0, minuteOfDay: 0, fold: 0, eventId: 'high-E', eventKind: 'high',
        instantMs: planned + 30 * 60 * 1000, withdrawn: false, providerRevision: 'tides-v1', contextRevision: 'harbor-v1' }] }] };
}

function timesThrough(last, extras = []) {
  const times = [0, 1000];
  for (let time = 31_000; time <= last; time += 30_000) times.push(time);
  return [...new Set([...times, ...extras, last])].sort((a, b) => a - b);
}

async function wasmRun(artifact, steps, checkpoint = null) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  try {
    if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
    return steps.map(frame => {
      try {
        const result = runtime.step({ nowMs: frame.logicalTimeMs,
          inputs: Object.fromEntries(frame.inputs.map(input => [input.name, input.value])),
          contextFacts: { clock: frame.clock, schedules: frame.schedules, natural: [], settings: null, solars: [] } });
        assert.equal(result.frame.scanId, frame.scanId);
        return { accepted: true, outcome: structuredClone(runtime.lastFrameOutcome),
          settings: runtime.contextSnapshot().state, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      } catch (error) {
        return { accepted: false, error: error.message, outcome: structuredClone(runtime.lastFrameOutcome),
          settings: runtime.contextSnapshot().state, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      }
    });
  } finally { runtime.dispose(); }
}

function nativeRun(t, artifact, steps, checkpoint = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-03-027-tide-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const module = path.join(dir, 'module.gfb'), tape = path.join(dir, 'tape.json');
  fs.writeFileSync(module, artifact.bytes);
  fs.writeFileSync(tape, JSON.stringify({ profile: 'context-tide-v1', activation, checkpoint, steps: steps.map(frame => ({ ...frame, inputs: Object.entries(softwareQualityRails(artifact, Object.fromEntries(frame.inputs.map(input => [input.name, input.value])), frame.scanId + 1, frame.logicalTimeMs)).map(([name, value]) => ({ name, value })) })) }));
  return execFileSync(nativeRunner, [module, tape], { encoding: 'utf8', timeout: 15_000 }).trim().split('\n').map(line => {
    const row = JSON.parse(line);
    return row.accepted ? row : { ...row, outcome: row.lastOutcome };
  });
}

function assertParity(native, actual) {
  assert.equal(actual.length, native.length);
  for (let index = 0; index < native.length; index++) {
    assert.equal(actual[index].accepted, native[index].accepted);
    assert.deepEqual(actual[index].outcome, native[index].outcome, `full frame outcome ${index}`);
    assert.deepEqual(actual[index].settings, native[index].settings, `source/settings state ${index}`);
    assert.equal(actual[index].checkpoint, native[index].checkpoint, `full context checkpoint ${index}`);
  }
}

test('REF-03-027 native and WASM late Tide Run ends at 08:07 despite blocked safe output from 08:04 to 08:06', async t => {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'tests/reference/cases/02-time-control.json'), 'utf8')).cases.find(row => row.id === 'REF-03-027');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/216');
  assert.match(original.given, /08:02.*08:04.*08:06/);
  assert.match(original.then, /08:07.*08:10/);
  const artifact = await compileSource(source, { filename });
  const site = artifact.manifest.schedules[0].site;
  const frames = timesThrough(451_000, [420_999, 421_000]).map((time, index) => step(site, time, time >= 121_000, time >= 241_000 && time < 361_000, index));
  const native = nativeRun(t, artifact, frames);
  const actual = await wasmRun(artifact, frames);
  assert.ok(native.every(row => row.accepted));
  assertParity(native, actual);
  for (let index = 0; index < frames.length; index++) {
    const time = frames[index].logicalTimeMs, trace = actual[index].outcome.trace;
    const active = time >= 121_000 && time < 421_000;
    assert.equal(trace.requested.pump, active, `requested at ${time}`);
    assert.equal(trace.safe.active, active, `Run active at ${time}`);
    assert.equal(trace.safe.pump, active && !(time >= 241_000 && time < 361_000), `safe clamp at ${time}`);
    assert.equal(trace.safe.due, time === 121_000);
    assert.equal(trace.safe.admitted, time < 121_000 ? 0 : 1);
  }
  const admission = actual[frames.findIndex(frame => frame.logicalTimeMs === 121_000)].outcome.trace.contextTrace;
  assert.ok(admission.some(row => row.decision === 'Due' && row.plannedWallMs === planned));
  const replay = await wasmRun(artifact, frames);
  assert.deepEqual(replay, actual, 'fresh owner replay preserves complete frames, revisions and checkpoints');
});

test('REF-03-027 native and WASM reject exact grace-end admission while one millisecond earlier admits a full Run', async t => {
  const artifact = await compileSource(source, { filename });
  const site = artifact.manifest.schedules[0].site;
  for (const admittedAt of [600_999, 601_000]) {
    const frames = timesThrough(admittedAt).map((time, index) => step(site, time, time === admittedAt, false, index));
    const native = nativeRun(t, artifact, frames), actual = await wasmRun(artifact, frames);
    assert.ok(native.every(row => row.accepted));
    assertParity(native, actual);
    const last = actual.at(-1).outcome.trace;
    assert.equal(last.safe.due, admittedAt === 600_999);
    assert.equal(last.safe.active, admittedAt === 600_999);
    assert.equal(last.safe.admitted, admittedAt === 600_999 ? 1 : 0);
    if (admittedAt === 601_000) assert.ok(last.contextTrace.some(row => row.decision === 'GraceExpired'
      && row.plannedWallMs === planned && row.occurrenceId === 'ref-03-027:virtual-harbor:high-E'));
    else {
      const continuation = timesThrough(901_000, [900_998, 900_999]).filter(time => time > admittedAt)
        .map((time, index) => step(site, time, true, false, frames.length + index));
      const all = [...frames, ...continuation];
      const nextNative = nativeRun(t, artifact, all), nextWasm = await wasmRun(artifact, all);
      assertParity(nextNative, nextWasm);
      assert.equal(nextWasm.at(-3).outcome.trace.safe.active, true);
      assert.equal(nextWasm.at(-2).outcome.trace.safe.active, false);
      assert.equal(nextWasm.at(-1).outcome.trace.safe.admitted, 1);
    }
  }
});

test('REF-03-027 rejected clock facts preserve the active Run deadline and valid retry matches native WASM replay', async t => {
  const artifact = await compileSource(source, { filename });
  const site = artifact.manifest.schedules[0].site;
  const frames = timesThrough(151_000).map((time, index) => step(site, time, time >= 121_000, false, index));
  const retry = step(site, 181_000, true, true, frames.length);
  const bad = structuredClone(retry); bad.clock.monotonicMs = 120_000;
  const tape = [...frames, bad, retry];
  const native = nativeRun(t, artifact, tape), actual = await wasmRun(artifact, tape);
  assertParity(native, actual);
  assert.equal(actual.at(-2).accepted, false);
  assert.deepEqual(actual.at(-2).outcome, actual.at(-3).outcome);
  assert.equal(actual.at(-2).checkpoint, actual.at(-3).checkpoint);
  assert.deepEqual(actual.at(-2).settings, actual.at(-3).settings);
  assert.equal(actual.at(-1).accepted, true);
  assert.equal(actual.at(-1).outcome.trace.safe.active, true);
  assert.equal(actual.at(-1).outcome.trace.safe.pump, false);
  const expected = await wasmRun(artifact, [...frames, retry]);
  assert.deepEqual(actual.at(-1), expected.at(-1));
});
