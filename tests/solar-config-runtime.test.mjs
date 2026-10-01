import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { encodeContextFacts, solarContextEvidence } from '../runtimes/wasm/context-abi.mjs';
import { runScenario } from '../tools/ghostsim.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const document = fs.readFileSync(new URL('./fixtures/issue-145-solar-config.ghost.md', import.meta.url), 'utf8');
const activation = { bootEpoch: 7, terminalCapacity: 32, bindings: [] };
let wasm;
function wasmBytes() {
  if (!wasm) wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  return wasm;
}
const artifact = () => compileSource(document, { filename: 'issue-145-solar-config.ghost.md' });
const clock = (monotonicMs, wallMs) => ({ monotonicMs, bootEpoch: 7, wallMs, uncertaintyMs: 0,
  trusted: true, unknownReason: null, sourceRevision: 'solar-config-clock-v1' });
function facts(compiled, mono, wall, settings = null) {
  return { clock: clock(mono, wall), natural: [], schedules: [], settings,
    solars: compiled.manifest.schedules.map(schedule => solarContextEvidence(schedule, {
      site: schedule.site, coverageFromWallMs: 0, coverageToWallMs: 259_200_000,
      rows: [0, 1, 2].map(sourceDay => ({ sourceDay, scheduledWallMs: sourceDay * 86_400_000 + 1000,
        available: true, providerRevision: 'solar-oracle-v1', contextRevision: 'seoul-binding-v1' })),
    })) };
}
function settings(compiled, fingerprint, id, revision, position, values) {
  return { programFingerprint: fingerprint, eventId: id, baseRevision: revision, position,
    origin: 'operatorEdit', changes: Object.entries(values).map(([name, result]) => ({
      configId: compiled.manifest.configs.find(config => config.name === name).id, result,
    })) };
}
const duration = value => ({ ok: true, type: 'Duration', value });
const boolean = value => ({ ok: true, type: 'Bool', value });
const fault = { ok: false, fault: 'SettingsUnavailable' };
const projection = trace => ({ due: trace.safe.due, mirrored: trace.safe.mirrored, active: trace.safe.active, quotient: trace.safe.quotient });
function native(t, compiled, steps) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-solar-config-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'solar.gfb'), tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, compiled.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-solar-v1', activation, steps: steps.map((step, index) => ({
    scanId: step.scanId ?? index, logicalTimeMs: step.nowMs, inputs: [{ name: 'divisor', value: step.divisor ?? 1 }],
    ...step.contextFacts,
  })) }));
  return execFileSync(path.join(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : '')),
    [modulePath, tapePath], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
}

test('Solar/settings GFSF6 retains GFSF5 for non-Solar facts and rejects host due, binding omissions and unordered rows', async () => {
  const compiled = await artifact();
  const packet = facts(compiled, 0, 900);
  assert.equal(new DataView(encodeContextFacts(packet).buffer).getUint16(4, true), 6);
  assert.equal(new DataView(encodeContextFacts({ ...packet, solars: [] }).buffer).getUint16(4, true), 5);
  assert.throws(() => encodeContextFacts({ ...packet, due: true }), /unexpected/);
  const missing = structuredClone(packet); delete missing.solars[0].timezone;
  assert.throws(() => encodeContextFacts(missing), /timezone/);
  const rows = structuredClone(packet); rows.solars[0].rows.reverse();
  assert.throws(() => encodeContextFacts(rows), /ordered/);
});

test('one Solar/config artifact shares setting events and crossing oracle across native, both WASM hosts and ghostsim', async t => {
  const compiled = await artifact();
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled, { context: activation });
  const framed = await ControlRuntime.instantiateFramed(wasmBytes(), compiled, { context: activation });
  t.after(() => { runtime.dispose(); framed.dispose(); });
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const steps = [
    { nowMs: 0, contextFacts: facts(compiled, 0, 900) },
    { nowMs: 100, contextFacts: facts(compiled, 100, 1000, settings(compiled, fingerprint, 'duration-edit', 0, 2,
      { duration: duration(60_000) })) },
    { nowMs: 101, contextFacts: facts(compiled, 101, 1001, settings(compiled, fingerprint, 'unrelated-fault', 1, 3, { unused: fault })) },
    { nowMs: 60_100, contextFacts: facts(compiled, 60_100, 61_000) },
    { nowMs: 60_200, contextFacts: facts(compiled, 60_200, 86_400_900) },
    { nowMs: 60_300, contextFacts: facts(compiled, 60_300, 86_401_000, settings(compiled, fingerprint, 'dependent-fault', 2, 6, { enabled: fault })) },
    { nowMs: 60_400, contextFacts: facts(compiled, 60_400, 86_401_100, settings(compiled, fingerprint, 'dependent-recovery', 3, 7, { enabled: boolean(true) })) },
    { nowMs: 60_500, contextFacts: facts(compiled, 60_500, 172_800_900) },
    { nowMs: 60_600, contextFacts: facts(compiled, 60_600, 172_801_000) },
    { nowMs: 60_700, contextFacts: facts(compiled, 60_700, 172_801_100) },
  ];
  const expected = [
    [false,false,false], [true,true,true], [false,false,true], [false,false,false], [false,false,false],
    [false,false,false], [false,false,false], [false,false,false], [true,true,true], [false,false,true],
  ].map(([due,mirrored,active]) => ({ due, mirrored, active, quotient: 1 }));
  const plainTrace = steps.map(step => runtime.step({ ...step, inputs: { divisor: 1 } }).vm);
  const plain = plainTrace.map(projection);
  const frames = steps.map(step => projection(framed.step({ ...step, inputs: { divisor: 1 } }).vm));
  assert.deepEqual(plain, expected); assert.deepEqual(frames, expected);
  assert.deepEqual(runtime.contextSnapshot().state.settings.find(config => config.name === 'duration').result, { ok: true, value: 60_000 });
  const records = native(t, compiled, steps);
  assert.ok(records.every(record => record.accepted));
  assert.deepEqual(records.map(record => projection(record.outcome.trace)), expected);
  assert.deepEqual(records.map(record => record.settings.settingsRevision), [0,1,2,2,2,3,4,4,4,4]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-solar-config-sim-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'solar.gfb'), scenarioPath = path.join(directory, 'scenario.toon');
  writeArtifact(compiled, modulePath);
  fs.writeFileSync(scenarioPath, encode({ format: 'GhostFlow/scenario-v1', id: 'solar-config-oracle',
    initialInputs: [{ name: 'divisor', type: 'Number', value: 1 }], keyBindings: [], context: activation,
    actions: steps.map(step => ({ kind: 'scan', atMs: step.nowMs, contextFacts: step.contextFacts })) }) + '\n');
  const result = runScenario(modulePath, scenarioPath, { format: 'json' });
  assert.equal(result.success, true, result.encoded);
  const scans = JSON.parse(result.encoded).scans;
  assert.deepEqual(scans.map(scan => projection({ safe: scan.safeVirtualIntent })), expected);
  assert.deepEqual(scans.map(scan => scan.settingsState.settingsRevision), [0,1,2,2,2,3,4,4,4,4]);
});

test('Solar/settings VM rejection rolls back settings and admission; checkpoint preserves dedupe and exact program binding', async t => {
  const compiled = await artifact();
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled, { context: activation });
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 0, inputs: { divisor: 1 }, contextFacts: facts(compiled, 0, 900) });
  const before = runtime.contextSnapshot();
  const change = settings(compiled, before.state.programFingerprint, 'retry-exact-event', 0, 2, { duration: duration(60_000) });
  const crossing = { nowMs: 100, contextFacts: facts(compiled, 100, 1000, change) };
  assert.throws(() => runtime.step({ ...crossing, inputs: { divisor: 0 } }), /division|zero/i);
  assert.deepEqual(runtime.contextSnapshot(), before);
  assert.equal(runtime.step({ ...crossing, inputs: { divisor: 1 } }).vm.safe.due, true);
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 1);
  const records = native(t, compiled, [
    { nowMs: 0, contextFacts: facts(compiled, 0, 900) },
    { ...crossing, scanId: 1, divisor: 0 }, { ...crossing, scanId: 1, divisor: 1 },
  ]);
  assert.deepEqual(records.map(record => record.accepted), [true,false,true]);
  assert.deepEqual(records[1].settings, records[0].settings);
  assert.equal(records[2].outcome.trace.safe.due, true);
  const saved = runtime.contextSnapshot();
  const restored = await ControlRuntime.instantiate(wasmBytes(), compiled, { context: activation });
  t.after(() => restored.dispose()); restored.restoreContextCheckpoint(saved.bytes);
  assert.equal(restored.step({ nowMs: 0, inputs: { divisor: 1 }, contextFacts: facts(compiled, 0, 1000) }).vm.safe.due, false);
  const mismatch = await compileSource(document.replace('latitude = 37.5665;', 'latitude = 37.0;'), { filename: 'wrong-binding.ghost.md' });
  const other = await ControlRuntime.instantiate(wasmBytes(), mismatch, { context: activation });
  t.after(() => other.dispose());
  assert.throws(() => other.restoreContextCheckpoint(saved.bytes), /checkpoint|program|fingerprint/i);
  const badBinding = facts(compiled, 1, 1001); badBinding.solars[0].latitude = 37.0;
  const unchanged = restored.contextSnapshot();
  assert.throws(() => restored.step({ nowMs: 1, inputs: { divisor: 1 }, contextFacts: badBinding }), /Solar|binding|context/i);
  assert.deepEqual(restored.contextSnapshot(), unchanged);
});

test('combined Solar/settings held clock and fixed fallback preserve provenance and terminal false-predicate consumption', async t => {
  const source = document.replaceAll('timezone = "Asia/Seoul"; latitude = 37.5665; longitude = 126.9780;', 'timezone = "UTC"; latitude = 0; longitude = 0;')
    .replaceAll('sun`rise + 30min`', 'sun`rise`')
    .replaceAll('clock = trusted_only;', 'clock = hold_trusted(2s, terminal: skip);')
    .replaceAll('fallback = skip;', 'fallback = fixed_time(time`06:00`, terminal: skip);');
  const compiled = await compileSource(source, { filename: 'solar-config-fallback.ghost.md' });
  for (const permitted of [true, false]) {
    const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled, { context: activation });
    t.after(() => runtime.dispose());
    const fingerprint = runtime.contextSnapshot().state.programFingerprint;
    const packet = (mono, wall, trusted, recovered = false, event = null) => ({
      clock: { ...clock(mono, wall), trusted, unknownReason: trusted ? null : 'TrustExpired', uncertaintyMs: 7 },
      natural: [], schedules: [], settings: event,
      solars: compiled.manifest.schedules.map(descriptor => solarContextEvidence(descriptor, {
        site: descriptor.site, coverageFromWallMs: 0, coverageToWallMs: 86_400_000,
        rows: [{ sourceDay: 0, available: recovered, scheduledWallMs: recovered ? 21_602_000 : null,
          fallbackWallMs: recovered ? null : 21_600_000, unavailableReason: recovered ? null : 2,
          providerRevision: recovered ? 'solar-v2' : 'solar-v1', contextRevision: 'site-v1' }],
      })),
    });
    const steps = [
      { nowMs: 0, contextFacts: packet(0, 21_599_000, true) },
      { nowMs: 1000, contextFacts: packet(1000, 1, false, false,
        permitted ? null : settings(compiled, fingerprint, 'false-at-fallback', 0, 2, { enabled: boolean(false) })) },
      { nowMs: 2000, contextFacts: packet(2000, 1, false) },
      { nowMs: 3000, contextFacts: packet(3000, 21_602_000, true, true,
        permitted ? null : settings(compiled, fingerprint, 'recover-predicate', 1, 4, { enabled: boolean(true) })) },
      { nowMs: 4000, contextFacts: packet(4000, 21_603_000, true, true) },
    ];
    const traces = steps.map(step => runtime.step({ ...step, inputs: { divisor: 1 } }).vm);
    assert.deepEqual(traces.map(trace => trace.safe.due), [false, permitted, false, false, false]);
    const observations = traces[1].contextTrace.filter(row => compiled.manifest.schedules.some(schedule => schedule.site === row.site));
    assert.ok(observations.some(row => row.clockProvenance === 'HeldClock' && row.clockSourceRevision === 'solar-config-clock-v1'));
    assert.ok(observations.some(row => row.fallback === true && row.unavailableReason === 2));
    const records = native(t, compiled, steps);
    assert.deepEqual(records.map(record => record.outcome.trace.safe), traces.map(trace => trace.safe));
    assert.deepEqual(records.map(record => record.outcome.trace.contextTrace), traces.map(trace => trace.contextTrace));
    const malformed = structuredClone(steps[1]);
    malformed.contextFacts.solars[0].rows[0].unavailableReason = null;
    assert.throws(() => encodeContextFacts(malformed.contextFacts), /unavailableReason/);
    const retry = native(t, compiled, [steps[0], { ...malformed, scanId: 1 }, { ...steps[1], scanId: 1 }]);
    assert.deepEqual(retry.map(record => record.accepted), [true, false, true]);
    assert.deepEqual(retry[1].settings, retry[0].settings);
    assert.equal(retry[2].outcome.trace.safe.due, permitted);
  }
});
