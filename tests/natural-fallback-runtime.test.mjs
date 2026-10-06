// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime as BaseControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { solarFallbackWallMs } from '../runtimes/wasm/solar-schedule.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const source = '# Natural fallback\n\n```ghost\n' + `control NaturalFallback {
  input unsafe: Bool;
  schedule dawn: Solar {
    timezone = "UTC"; latitude = 0; longitude = 0;
    at = sun\`rise\`; basis = pulse; when = true;
    clock = hold_trusted(2s, terminal: skip);
    gap = skip_after(60s); recovery = baseline;
    fallback = fixed_time(time\`06:00\`, terminal: skip);
  }
  type Phase = Idle | Water;
  state phase: Phase = Idle;
  state starts: Int = 0;
  timer age = elapsed(phase);
  phase' = case phase {
    Idle => if dawn.due then Water else Idle;
    Water => if age >= 5s then Idle else Water;
  };
  starts' = starts + if dawn.due then 1 else 0;
  output due, pump, permit: Bool;
  due <- dawn.due;
  pump <- phase' == Water;
  permit <- case unsafe { ok(value) => !value; fault(_) => false; };
  require pump => permit;
}` + '\n```\n';

function facts(site, monotonicMs, wallMs, { trusted = true, available = false, reason = 2 } = {}) {
  return {
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted, uncertaintyMs: 7, sourceRevision: 'clock-v1',
      ...(!trusted ? { unknownReason: 'TrustExpired' } : {}) },
    schedules: [{ site, coverageFromWallMs: 0, coverageToWallMs: 86_400_000,
      rows: [{ sourceDay: 0, scheduledWallMs: available ? 21_602_000 : null, available,
        providerRevision: available ? 'solar-v2' : 'solar-v1', contextRevision: 'site-v1',
        fallbackWallMs: available ? null : 21_600_000, unavailableReason: available ? null : reason }] }],
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('held clock, fallback recovery and safety retain native/WASM/ghostsim parity', async t => {
  const artifact = await compileSource(source, { filename: 'natural-fallback.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const rows = [
    [0, 21_599_000, {}],
    [1000, 1, { trusted: false }],
    [2000, 1, { trusted: false }],
    [3000, 21_602_000, { available: true }],
    [4000, 21_600_000, { available: true }],
    [5000, 21_604_000, { available: true }],
    [6000, 21_605_000, { available: true }],
  ].map(([nowMs, wallMs, options]) => ({ nowMs, inputs: { unsafe: nowMs === 5000 },
    solarFacts: facts(site, nowMs, wallMs, options) }));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { solar: { bootEpoch: 7, terminalCapacity: 16 } });
  t.after(() => runtime.dispose());
  const traces = rows.map(row => runtime.step(row).vm);
  assert.deepEqual(traces.map(trace => trace.safe.due), [false, true, false, false, false, false, false]);
  assert.deepEqual(traces.map(trace => trace.safe.pump), [false, true, true, true, true, false, false]);
  assert.equal(traces[1].scheduleTrace[0].observations[0].fallback, true);
  assert.equal(traces[1].scheduleTrace[0].observations[0].unavailableReason, 2);
  assert.match(JSON.stringify(traces[1].scheduleTrace), /HeldClock/);
  assert.equal(traces[1].scheduleTrace[0].clockUncertaintyMs, 1007);
  assert.equal(traces[1].scheduleTrace[0].clockSourceRevision, 'clock-v1');
  assert.match(JSON.stringify(traces[2].scheduleTrace), /TrustExpired|ClockUnknown/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-natural-fallback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'natural.gfb');
  writeArtifact(artifact, binary);
  const tape = path.join(directory, 'tape.json');
  fs.writeFileSync(tape, JSON.stringify({ bootEpoch: 7, terminalCapacity: 16, scans: rows.map((row, index) => ({ ...row, inputs: softwareQualityRails(artifact, row.inputs, index + 1, row.nowMs) })) }));
  const native = run(path.join(root, 'target/release/examples/solar_tape' + (process.platform === 'win32' ? '.exe' : '')), [binary, tape])
    .trim().split('\n').map(line => JSON.parse(line));
  assert.ok(native.every(row => row.accepted));
  assert.deepEqual(native.map(row => row.trace.safe), traces.map(trace => trace.safe));
  assert.deepEqual(native.map(row => row.trace.scheduleTrace), traces.map(trace => trace.scheduleTrace));

  const scenario = path.join(directory, 'scenario.toon');
  fs.writeFileSync(scenario, encode({ format: 'GhostFlow/scenario-v1', id: 'natural-fallback-parity',
    initialInputs: [{ name: 'unsafe', type: 'Bool', value: false }], keyBindings: [],
    solar: { bootEpoch: 7, terminalCapacity: 16 },
    actions: rows.flatMap((row, index) => [
      { kind: 'input', name: 'unsafe', type: 'Bool', value: row.inputs.unsafe },
      { kind: 'scan', atMs: row.nowMs, solarFacts: row.solarFacts },
    ]) }) + '\n');
  const simulated = JSON.parse(run(process.execPath, [path.join(root, 'tools/ghostsim.mjs'), binary, scenario, '--format', 'json']));
  assert.deepEqual(simulated.scans.map(scan => scan.safeVirtualIntent), traces.map(trace => trace.safe));
  assert.deepEqual(simulated.scans.map(scan => scan.scheduleTrace), traces.map(trace => trace.scheduleTrace));
});

for (const [reason, label] of [[1, 'LocationUnknown'], [2, 'EventUnavailable'], [3, 'PredictionMissing'], [4, 'PredictionStale']]) {
  test(`${label} selects the explicit fixed-time route and retains the cause`, async t => {
    const artifact = await compileSource(source, { filename: `fallback-${label}.ghost.md` });
    const site = artifact.manifest.schedules[0].site;
    const runtime = await ControlRuntime.instantiate(wasm, artifact, { solar: { bootEpoch: 7, terminalCapacity: 16 } });
    t.after(() => runtime.dispose());
    runtime.step({ nowMs: 0, inputs: { unsafe: false }, solarFacts: facts(site, 0, 21_599_000, { reason }) });
    const admitted = runtime.step({ nowMs: 1000, inputs: { unsafe: false }, solarFacts: facts(site, 1000, 21_600_000, { reason }) }).vm;
    assert.equal(admitted.safe.due, true);
    assert.equal(admitted.scheduleTrace[0].observations[0].unavailableReason, reason);
    assert.equal(admitted.scheduleTrace[0].observations[0].fallback, true);
  });
}

test('fixed-time fallback never starts without a trusted anchor', async t => {
  const artifact = await compileSource(source, { filename: 'no-clock-fallback.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { solar: { bootEpoch: 7, terminalCapacity: 16 } });
  t.after(() => runtime.dispose());
  for (const nowMs of [0, 1000, 2000]) {
    const packet = facts(site, nowMs, 21_600_000, { trusted: false });
    assert.equal(runtime.step({ nowMs, inputs: { unsafe: false }, solarFacts: packet }).vm.safe.pump, false);
  }
});

test('unknown anchor uncertainty prevents held-clock fallback admission', async t => {
  const artifact = await compileSource(source, { filename: 'uncertain-clock-fallback.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { solar: { bootEpoch: 7, terminalCapacity: 16 } });
  t.after(() => runtime.dispose());
  const baseline = facts(site, 0, 21_599_000);
  baseline.clock.uncertaintyMs = null;
  runtime.step({ nowMs: 0, inputs: { unsafe: false }, solarFacts: baseline });
  const held = runtime.step({ nowMs: 1000, inputs: { unsafe: false }, solarFacts: facts(site, 1000, 21_600_000, { trusted: false }) });
  assert.equal(held.vm.safe.pump, false);
  assert.match(JSON.stringify(held.vm.scheduleTrace), /TrustExpired|ClockUnknown/);
});

test('fallback facts cannot retime the authored fallback or impersonate another local date', async t => {
  const artifact = await compileSource(source, { filename: 'fallback-binding.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { solar: { bootEpoch: 7, terminalCapacity: 16 } });
  t.after(() => runtime.dispose());
  for (const [key, value] of [['fallbackWallMs', 21_600_001], ['sourceDay', 1]]) {
    const packet = facts(site, 0, 21_599_000);
    packet.schedules[0].rows[0][key] = value;
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { unsafe: false }, solarFacts: packet }), /fallback|local date|sourceDay/i);
  }
  const accepted = runtime.step({ nowMs: 0, inputs: { unsafe: false }, solarFacts: facts(site, 0, 21_599_000) });
  assert.equal(accepted.vm.safe.pump, false, 'rejected provider facts preserve the same-time retry');
});

test('civil fallback resolves an authored local date only when its instant is unique', () => {
  const descriptor = (timezone, atMs) => ({ timezone,
    policy: { fallback: { kind: 'fixed_time', atMs, terminal: 'skip' } } });
  const day = date => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  assert.equal(solarFallbackWallMs(descriptor('Asia/Seoul', 21_600_000), day('2026-09-30')),
    Date.parse('2026-09-30T06:00:00+09:00'));
  assert.equal(solarFallbackWallMs(descriptor('America/New_York', 9_000_000), day('2026-03-08')), null,
    'nonexistent 02:30 does not shift to another time');
  assert.equal(solarFallbackWallMs(descriptor('America/New_York', 5_400_000), day('2026-11-01')), null,
    'repeated 01:30 does not silently select a fold');
  assert.equal(solarFallbackWallMs({ timezone: 'UTC', policy: { fallback: 'skip' } }, day('2026-09-30')), null);
});
