import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { encodeScheduleFacts } from '../runtimes/wasm/solar-abi.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)))
  .cases.find(entry => entry.id === 'REF-03-032');
const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const planned = Date.parse('2026-09-23T15:00:00Z'); // declared 00:00 in Asia/Seoul

function facts(site, monotonicMs, wallMs, row = {}) {
  return {
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    schedules: [{ kind: 'daily-slots', site, coverageFromWallMs: planned - 1, coverageToWallMs: planned + 1000,
      rows: [{ sourceDay: 20_720, slotKey: 1, minuteOfDay: 0, fold: 0, scheduledWallMs: planned,
        available: true, providerRevision: 'iana-v1', contextRevision: 'tzdb-v1', ...row }] }],
  };
}

test('exact REF-03-032 uses GFB9/GFSF3 and Rust owns each slot crossing', async t => {
  const artifact = await compileSource(fixture.source, { filename: fixture.filename });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v8');
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 9);
  const site = artifact.manifest.schedules[0].site;
  assert.equal(new DataView(encodeScheduleFacts(facts(site, 0, planned - 1)).buffer).getUint16(4, true), 3);

  const runtime = await GhostFlowRuntime.instantiate(wasm()); t.after(() => runtime.dispose());
  runtime.load(artifact.bytes); runtime.addCapability('actuator', 'due', 'bool');
  runtime.activateSchedules({ bootEpoch: 7, terminalCapacity: 8 });
  const tick = (mono, wall, row) => {
    runtime.setNumber('__gf_now_ms', mono); runtime.setNumber('__gf_time_epoch', 7);
    runtime.tickSchedules(facts(site, mono, wall, row));
    return runtime.trace;
  };
  assert.equal(tick(0, planned - 1).safe.due, false);
  const due = tick(1, planned);
  assert.equal(due.safe.due, true);
  assert.equal(due.scheduleTrace[0].observations[0].occurrenceId, `${site}:20720:1:0`);
  assert.equal(tick(2, planned, { scheduledWallMs: planned + 1 }).safe.due, false);
});

test('DailySlots facts reject spoofed results, wrong identity, ordering and GFSF2 downgrade', async t => {
  const artifact = await compileSource(fixture.source, { filename: fixture.filename });
  const site = artifact.manifest.schedules[0].site;
  const packet = facts(site, 0, planned - 1);
  assert.throws(() => encodeScheduleFacts({ ...packet, schedules: [{ ...packet.schedules[0], due: true }] }), /unexpected schedule.due/);
  assert.throws(() => encodeScheduleFacts(facts(site, 0, planned - 1, { slotKey: 2 })), /row identity/);
  assert.throws(() => encodeScheduleFacts({ ...packet, schedules: [{ ...packet.schedules[0], rows: [
    { ...packet.schedules[0].rows[0], sourceDay: 2 },
    { ...packet.schedules[0].rows[0], sourceDay: 1 },
  ] }] }), /ordered/);

  const runtime = await GhostFlowRuntime.instantiate(wasm()); t.after(() => runtime.dispose());
  runtime.load(artifact.bytes); runtime.addCapability('actuator', 'due', 'bool');
  runtime.activateSchedules({ bootEpoch: 7, terminalCapacity: 8 });
  runtime.setNumber('__gf_now_ms', 0); runtime.setNumber('__gf_time_epoch', 7);
  assert.throws(() => runtime.tickSchedules(facts(site, 0, planned - 1, { slotKey: 16, minuteOfDay: 15 })), /violates descriptor/);
  const downgraded = structuredClone(packet);
  downgraded.schedules[0].kind = 'daily';
  delete downgraded.schedules[0].rows[0].slotKey;
  delete downgraded.schedules[0].rows[0].minuteOfDay;
  assert.throws(() => runtime.tickSchedules(downgraded), /GFSF2.*GFB8/);

  const mixedManifest = structuredClone(artifact.manifest);
  mixedManifest.schedules.push({
    kind: 'solar', site: site + 1, name: 'dawn', timezone: 'Asia/Seoul', latitude: 37.5, longitude: 127,
    event: 'rise', offsetMs: 0, policy: { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 60_000, recovery: 'baseline', fallback: 'skip' },
  });
  await assert.rejects(() => ControlRuntime.instantiate(wasm(), { bytes: artifact.bytes, manifest: mixedManifest },
    { schedule: { bootEpoch: 7, terminalCapacity: 8 } }), /v8 manifest requires GFB format 9 DailySlots schedules/);
});
