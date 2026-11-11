import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { encodeScheduleFacts, encodeSolarFacts } from '../runtimes/wasm/solar-abi.mjs';

const entry = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases.find(e => e.id === 'REF-03-024');
const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const planned = Date.parse('2026-09-23T21:30:00Z'); // 2026-09-24 06:30 Asia/Seoul
const sourceDay = Date.parse('2026-09-24T00:00:00Z') / 86400000;
const facts = (site, mono, wall, changes = {}) => ({
  clock: { monotonicMs: mono, bootEpoch: 7, wallMs: wall, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
  schedules: [{ kind: 'daily', site, coverageFromWallMs: planned - 1000, coverageToWallMs: planned + 1000,
    rows: [{ sourceDay, fold: 0, available: true, scheduledWallMs: planned, providerRevision: 'iana-2026', contextRevision: 'seoul-v1' }], ...changes }],
});

test('exact REF-03-024 compiles to Daily GFB8 and WASM owns crossing and rollback', async t => {
  const artifact = await compileSource(entry.source, { filename: entry.filename });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v7');
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 8);
  assert.equal(artifact.manifest.schedules[0].atMs, 23400000);
  assert.ok(!artifact.manifest.schedules[0].dueInput);
  const runtime = await GhostFlowRuntime.instantiate(wasm()); t.after(() => runtime.dispose());
  runtime.load(artifact.bytes); runtime.addCapability('actuator', 'due', 'bool');
  assert.throws(() => runtime.activateSolar({ bootEpoch: 7, terminalCapacity: 8 }), /schedule activation/);
  runtime.activateSchedules({ bootEpoch: 7, terminalCapacity: 8 });
  const site = artifact.manifest.schedules[0].site;
  const tick = (mono, wall, changes) => {
    runtime.setNumber('__gf_now_ms', mono); runtime.setNumber('__gf_time_epoch', 7);
    runtime.tickSchedules(facts(site, mono, wall, changes)); return runtime.trace;
  };
  assert.equal(tick(0, planned - 100).safe.due, false);
  assert.throws(() => tick(100, planned, { kind: 'solar' }), /kind mismatch/);
  assert.equal(tick(100, planned).safe.due, true);
  assert.equal(tick(101, planned - 100).safe.due, false);
  assert.equal(tick(201, planned).safe.due, false);
});

test('Daily facts require distinct kind/fold transport and forbid computed due', () => {
  const packet = facts(1, 0, planned - 100);
  assert.equal(new DataView(encodeScheduleFacts(packet).buffer).getUint16(4, true), 2);
  assert.throws(() => encodeSolarFacts(packet), /unexpected schedule.kind/);
  const missingKind = structuredClone(packet); delete missingKind.schedules[0].kind;
  assert.throws(() => encodeScheduleFacts(missingKind), /kind/);
  const badFold = structuredClone(packet); badFold.schedules[0].rows[0].fold = 3;
  assert.throws(() => encodeScheduleFacts(badFold), /fold/);
  const spoof = structuredClone(packet); spoof.schedules[0].due = true;
  assert.throws(() => encodeScheduleFacts(spoof), /unexpected schedule.due/);
});

test('ControlRuntime admits Daily occurrence only after valid runtime-owned schedule facts', async t => {
  const artifact = await compileSource(entry.source, { filename: entry.filename });
  await assert.rejects(() => ControlRuntime.instantiate(wasm(), artifact), /schedule activation profile is required/);
  const runtime = await ControlRuntime.instantiate(wasm(), artifact,
    { schedule: { bootEpoch: 7, terminalCapacity: 8 } });
  t.after(() => runtime.dispose());
  const site = artifact.manifest.schedules[0].site;
  assert.throws(() => runtime.step({ nowMs: 0, due: { morning: true },
    scheduleFacts: facts(site, 0, planned - 100) }), /runtime-owned due value/);
  assert.equal(runtime.step({ nowMs: 0, scheduleFacts: facts(site, 0, planned - 100) }).vm.safe.due, false);
  assert.throws(() => runtime.step({ nowMs: 100,
    scheduleFacts: facts(site, 100, planned, { kind: 'solar' }) }), /kind mismatch/);
  assert.equal(runtime.lastNowMs, 0);
  assert.equal(runtime.step({ nowMs: 100, scheduleFacts: facts(site, 100, planned) }).vm.safe.due, true);
});

test('weekday Daily uses the scheduled local date and preserves subsecond precision', async t => {
  const source = entry.source.replace(/at = time`[^\x60]+`;/,
    'at = time\x6006:30:15.250\x60;\n    on = day\x60mon..fri\x60;');
  const artifact = await compileSource(source, { filename: 'weekday-daily.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v27');
  assert.deepEqual(artifact.manifest.schedules[0].day, { kind: 'weekday', mask: 62 });
  assert.equal(artifact.manifest.schedules[0].atMs, 23_415_250);
  const directory = fs.mkdtempSync(join(tmpdir(), 'weekday-daily-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const moduleFile = join(directory, 'daily.gfb');
  const tapeFile = join(directory, 'daily.json');
  fs.writeFileSync(moduleFile, artifact.bytes);
  const native = fileURLToPath(new URL('../target/release/examples/solar_tape' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
  for (const [date, expected] of [['2026-11-09', true], ['2026-11-13', true], ['2026-11-14', false], ['2026-11-15', false]]) {
    const runtime = await ControlRuntime.instantiateFramed(wasm(), artifact, { schedule: { bootEpoch: 7, terminalCapacity: 8 } });
    const occurrence = Date.parse(`${date}T06:30:15.250+09:00`);
    const sourceDay = Date.parse(`${date}T00:00:00.000Z`) / 86400000;
    const scheduleFacts = nowMs => facts(artifact.manifest.schedules[0].site, nowMs, occurrence - 1 + nowMs, {
      coverageFromWallMs: occurrence - 1000, coverageToWallMs: occurrence + 1000,
      rows: [{ sourceDay, fold: 0, available: true, scheduledWallMs: occurrence, providerRevision: 'iana-test', contextRevision: 'seoul' }],
    });
    const outcomes = [false, expected, false];
    try {
      assert.deepEqual([0, 1, 2].map(nowMs => runtime.step({ nowMs, scheduleFacts: scheduleFacts(nowMs) }).vm.safe.due), outcomes, date);
    } finally { runtime.dispose(); }
    fs.writeFileSync(tapeFile, JSON.stringify({ bootEpoch: 7, terminalCapacity: 8,
      scans: [0, 1, 2].map(nowMs => ({ inputs: {}, solarFacts: scheduleFacts(nowMs) })) }));
    const rows = execFileSync(native, [moduleFile, tapeFile], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(rows.map(row => row.trace?.safe.due), outcomes, date);
  }
});
