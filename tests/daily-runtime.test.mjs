import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
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
