import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm',
  '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
const wasmBytes = readFileSync(wasmPath);
const cases = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8')).cases;

async function artifact(id) {
  const fixture = cases.find(entry => entry.id === id);
  return compileSource(fixture.source, { filename: fixture.filename });
}

async function runtimeFor(compiled) {
  const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
  runtime.load(compiled.bytes);
  for (const output of compiled.manifest.outputs) {
    runtime.addCapability('actuator', output.name,
      output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
  }
  return runtime;
}

const binding = (kind, provider, timezone, criteria) => ({
  kind, provider, namespace: `${provider}-namespace`, station: `${provider}-station`,
  bindingRevision: `${provider}-binding-v1`, location: `${provider}-location`,
  timezone, criteria, maxUncertaintyMs: 0,
});
const clock = (monotonicMs, wallMs) => ({
  monotonicMs, bootEpoch: 7, wallMs, uncertaintyMs: 0, trusted: true,
  unknownReason: null, sourceRevision: 'clock-boundary-v1',
});
const facts = (monotonicMs, wallMs, schedules = [], natural = []) => ({
  clock: clock(monotonicMs, wallMs), natural, schedules, settings: null,
});
function tickContext(runtime, packet) {
  runtime.setNumber('__gf_now_ms', packet.clock.monotonicMs);
  runtime.setNumber('__gf_time_epoch', packet.clock.bootEpoch);
  runtime.tickContext(packet);
}
const observation = (providerBinding, classifications) => ({
  binding: providerBinding, providerRevision: `${providerBinding.provider}-provider-v1`,
  coverageStartMs: 0, coverageEndMs: 2_000, expiresAtMs: 2_001,
  uncertaintyMs: 0, fault: null, classifications,
});

function rawContextTick(runtime, bytes) {
  const { wasm, handle } = runtime;
  const ptr = wasm.gf_alloc(bytes.length);
  try {
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return wasm.gf_tick_context(handle, ptr, bytes.length);
  } finally {
    wasm.gf_dealloc(ptr, bytes.length);
  }
}

function checkpoint(runtime) {
  assert.equal(runtime.wasm.gf_context_checkpoint(runtime.handle), 1);
  const ptr = runtime.wasm.gf_context_checkpoint_ptr(runtime.handle);
  const len = Number(runtime.wasm.gf_context_checkpoint_len(runtime.handle));
  assert.ok(len > 0);
  return new Uint8Array(runtime.wasm.memory.buffer, ptr, len).slice();
}

function restore(runtime, bytes) {
  const ptr = runtime.wasm.gf_alloc(bytes.length);
  try {
    new Uint8Array(runtime.wasm.memory.buffer, ptr, bytes.length).set(bytes);
    assert.equal(runtime.wasm.gf_restore_context_checkpoint(runtime.handle, ptr, bytes.length), 1);
  } finally {
    runtime.wasm.gf_dealloc(ptr, bytes.length);
  }
}

test('REF-03-031: 06:10 boot and clock recovery do not catch up the 06:00 slot after 05:55 rollback in native and WASM', async t => {
  const fixture = cases.find(entry => entry.id === 'REF-03-057');
  // The authored 20-minute gap makes the exact five-minute recross eligible for
  // ordinary observation; a gap skip cannot mask broken baseline/high-water.
  const compiled = await compileSource(fixture.source.replace('skip_after(60s)', 'skip_after(20min)'),
    { filename: 'boot-rollback.ghost.md' });
  const planned = Date.UTC(2026, 8, 24, 21); // 2026-09-25 06:00 Asia/Seoul.
  const site = compiled.manifest.schedules[0].site;
  const activation = { bootEpoch: 7, terminalCapacity: 8, bindings: [] };
  const packet = (nowMs, wallMs, { trusted = true, bootEpoch = 7 } = {}) => ({ nowMs, contextFacts: {
    clock: { monotonicMs: nowMs, bootEpoch, wallMs: trusted ? wallMs : null, trusted,
      uncertaintyMs: 0, unknownReason: trusted ? null : 'TrustExpired', sourceRevision: 'rtc-revision-r7' },
    natural: [], settings: null,
    schedules: [{ site, coverageStartMs: planned - 600_000, coverageEndMs: planned + 1_200_001,
      provider: null, calendar: null, rows: [{ sourceDay: Date.UTC(2026, 8, 25) / 86_400_000,
        slotKey: 1, minuteOfDay: 360, fold: 0, eventId: '', eventKind: 'civil', instantMs: planned,
        withdrawn: false, providerRevision: 'iana-2026-r4', contextRevision: 'seoul-context-r9' }] }],
  } });
  const steps = [packet(0, planned + 600_000), packet(1, planned - 300_000), packet(2, planned)];
  const execute = async (observations, { bootEpoch = 7, saved } = {}) => {
    const runtime = await ControlRuntime.instantiateFramed(wasmBytes, compiled,
      { context: { ...activation, bootEpoch } });
    try {
      if (saved) runtime.restoreContextCheckpoint(saved);
      return observations.map(step => {
        const trace = runtime.step(step).vm;
        return { trace, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      });
    } finally { runtime.dispose(); }
  };
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'context_tape'],
    { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'reference-boot-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'slots.gfb'), tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, compiled.bytes);
  const native = (observations, { bootEpoch = 7, saved, profile = 'context-civil-v1' } = {}) => {
    writeFileSync(tapePath, JSON.stringify({ profile, activation: { ...activation, bootEpoch },
      ...(saved ? { checkpoint: Buffer.from(saved).toString('hex') } : {}),
      steps: observations.map((step, scanId) => ({ scanId, logicalTimeMs: step.nowMs, inputs: [], ...step.contextFacts })) }));
    return execFileSync(resolve(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : '')),
      [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }).trim().split('\n').map(JSON.parse);
  };
  const compare = (records, rows) => {
    assert.ok(records.every(record => record.accepted));
    assert.deepEqual(records.map(record => ({ trace: record.outcome.trace, checkpoint: record.checkpoint })), rows);
  };
  const rows = await execute(steps), records = native(steps);
  compare(records, rows);
  for (const { trace } of rows) {
    assert.equal(trace.requested.due, false);
    assert.equal(trace.safe.due, false);
    assert.deepEqual((trace.contextTrace ?? []).filter(row => row.site === site), [],
      'baseline and rollback create no schedule occurrence');
  }
  assert.deepEqual(await execute(steps), rows);
  assert.deepEqual(native(steps), records);
  const normal = [packet(0, planned - 1), packet(1, planned), packet(2, planned - 300_000), packet(3, planned)];
  const normalRows = await execute(normal), normalRecords = native(normal);
  compare(normalRecords, normalRows);
  assert.deepEqual(normalRows.map(row => row.trace.safe.due), [false,true,false,false]);
  const admitted = normalRows[1].trace.contextTrace.find(row => row.decision === 'Due');
  assert.equal(admitted.plannedWallMs, planned);
  assert.equal(admitted.providerRevision, 'iana-2026-r4');
  assert.equal(admitted.contextRevision, 'seoul-context-r9');
  const recovery = [packet(0, planned - 1), packet(1, planned, { trusted: false }),
    packet(2, planned + 600_000), packet(3, planned - 300_000), packet(4, planned)];
  const recoveryRows = await execute(recovery);
  compare(native(recovery), recoveryRows);
  assert.deepEqual(recoveryRows.map(row => row.trace.safe.due), [false,false,false,false,false]);
  // Cross-restart guarantee here is the existing admitted terminal ledger.
  // Persistence of a skipped preboot baseline across a second restart is a
  // distinct clock-history contract, outside the original single-boot case.
  const saved = Buffer.from(normalRecords[1].checkpoint, 'hex');
  const afterReboot = [packet(0, planned - 300_000, { bootEpoch: 8 }), packet(1, planned, { bootEpoch: 8 })];
  const restoredRows = await execute(afterReboot, { bootEpoch: 8, saved });
  compare(native(afterReboot, { bootEpoch: 8, saved }), restoredRows);
  assert.deepEqual(restoredRows.map(row => row.trace.safe.due), [false,false]);
  const corrupt = Buffer.from(records[0].checkpoint, 'hex'); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(execute(steps, { saved: corrupt }), /checkpoint|restore|invalid|checksum/i);
  assert.throws(() => native(steps, { saved: corrupt }), /checkpoint|restore|invalid|checksum/i);
  const forged = structuredClone(steps); forged[0].contextFacts.schedules[0].rows[0].eventKind = 'high';
  assert.throws(() => native(forged), /civil tape cannot supply natural occurrence/);
  const spoofed = structuredClone(steps); spoofed[0].contextFacts.schedules[0].due = true;
  assert.throws(() => native(spoofed), /unexpected context evidence field/);
  assert.throws(() => native(steps, { profile: 'context-periodic-v1' }), /invalid or oversized context array|occurrence rows/);
});

test('REF-03-035: selected 06:00 and 18:45 slots pulse on the first crossing tick, not the next tick or other quarter-hours, in native and WASM', async t => {
  const compiled = await artifact('REF-03-057');
  const morning = Date.UTC(2026, 8, 24, 21); // 2026-09-25 06:00 Asia/Seoul
  const evening = morning + (12 * 60 + 45) * 60_000;
  const site = compiled.manifest.schedules[0].site;
  const activation = { bootEpoch: 7, terminalCapacity: 8, bindings: [] };
  const occurrences = [
    { slotKey: 1, minuteOfDay: 360, instantMs: morning },
    { slotKey: 2, minuteOfDay: 1125, instantMs: evening },
  ].map(row => ({ ...row, sourceDay: Date.UTC(2026, 8, 25) / 86_400_000,
    fold: 0, eventId: '', eventKind: 'civil', withdrawn: false,
    providerRevision: 'iana-2026-r4', contextRevision: 'seoul-context-r9' }));
  const packets = walls => walls.map((wallMs, index) => ({ nowMs: index * 1_000, contextFacts: {
    clock: clock(index * 1_000, wallMs), natural: [], settings: null,
    schedules: [{ site, coverageStartMs: morning - 120_000, coverageEndMs: evening + 60_000,
      provider: null, calendar: null, rows: occurrences }],
  } }));
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'context_tape'],
    { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'reference-selected-slots-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'slots.gfb'), tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, compiled.bytes);
  const execute = async steps => {
    const runtime = await ControlRuntime.instantiateFramed(wasmBytes, compiled, { context: activation });
    try {
      return steps.map(step => ({ trace: runtime.step(step).vm,
        checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') }));
    } finally { runtime.dispose(); }
  };
  const native = steps => {
    writeFileSync(tapePath, JSON.stringify({ profile: 'context-civil-v1', activation,
      steps: steps.map((step, scanId) => ({ scanId, logicalTimeMs: step.nowMs, inputs: [], ...step.contextFacts })) }));
    return execFileSync(resolve(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : '')),
      [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }).trim().split('\n').map(JSON.parse);
  };
  const compare = async steps => {
    const rows = await execute(steps), records = native(steps);
    assert.ok(records.every(record => record.accepted));
    assert.deepEqual(records.map(record => ({ trace: record.outcome.trace, checkpoint: record.checkpoint })), rows);
    assert.deepEqual(await execute(steps), rows);
    assert.deepEqual(native(steps), records);
    return rows;
  };
  // Observe every intervening minute so a gap skip cannot conceal a spurious
  // 06:15 or 06:30 grid pulse. The unchanged source's maximum gap is 60 seconds.
  const walls = [morning - 10_000, morning + 5_000, morning + 10_000];
  for (let minute = 1; minute <= 30; minute++) walls.push(morning + minute * 60_000);
  const rows = await compare(packets(walls));
  assert.deepEqual(rows.map(row => row.trace.requested.due), walls.map((_, index) => index === 1));
  assert.deepEqual(rows.map(row => row.trace.safe.due), walls.map((_, index) => index === 1));
  const due = rows[1].trace.contextTrace.find(row => row.site === site && row.decision === 'Due');
  assert.ok(due);
  assert.equal(due.plannedWallMs, morning);
  assert.equal(due.providerRevision, 'iana-2026-r4');
  assert.equal(due.contextRevision, 'seoul-context-r9');
  for (const [index, row] of rows.entries()) {
    if (index !== 1) assert.deepEqual((row.trace.contextTrace ?? []).filter(entry => entry.site === site), []);
  }
  const eveningRows = await compare(packets([evening - 10_000, evening + 5_000, evening + 10_000]));
  assert.deepEqual(eveningRows.map(row => row.trace.safe.due), [false, true, false]);
  assert.equal(eveningRows[1].trace.contextTrace.find(row => row.decision === 'Due').plannedWallMs, evening);
  const rollback = await compare(packets([morning - 10_000, morning + 5_000, morning - 10_000, morning + 5_000]));
  assert.deepEqual(rollback.map(row => row.trace.safe.due), [false, true, false, false]);
  const boot = await compare(packets([morning + 5_000, morning + 10_000]));
  assert.deepEqual(boot.map(row => row.trace.safe.due), [false, false]);
  const gap = await compare(packets([morning - 61_000, morning + 5_000, morning + 10_000]));
  assert.deepEqual(gap.map(row => row.trace.safe.due), [false, false, false]);
  const recoveryPackets = packets([morning - 10_000, morning, morning + 5_000, morning + 10_000]);
  Object.assign(recoveryPackets[1].contextFacts.clock,
    { trusted: false, wallMs: null, unknownReason: 'TrustExpired' });
  const recovery = await compare(recoveryPackets);
  assert.deepEqual(recovery.map(row => row.trace.safe.due), [false, false, false, false]);
  assert.deepEqual((recovery[1].trace.contextTrace ?? []).filter(row => row.site === site), [],
    'an untrusted clock admits no occurrence');
  const spoofed = packets(walls); spoofed[1].contextFacts.schedules[0].due = true;
  await assert.rejects(execute(spoofed), /unknown field|unexpected|due/i);
  assert.throws(() => native(spoofed), /unexpected context evidence field/);
});

test('ControlRuntime context checkpoint restores occurrence dedupe and rejects corrupt bytes', async t => {
  const compiled = await artifact('REF-03-036');
  const profile = { context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] } };
  const original = await ControlRuntime.instantiate(wasmBytes, compiled, profile);
  const restored = await ControlRuntime.instantiate(wasmBytes, compiled, profile);
  t.after(() => { original.dispose(); restored.dispose(); });
  const planned = 1_790_812_800_000;
  const site = compiled.manifest.schedules[0].site;
  const packet = (monotonicMs, wallMs) => ({
    nowMs: monotonicMs,
    contextFacts: facts(monotonicMs, wallMs, [{
      site, coverageStartMs: planned - 2, coverageEndMs: planned + 1,
      provider: null, calendar: null, rows: [],
    }]),
  });
  assert.equal(original.step(packet(0, planned - 1)).vm.safe.due, false);
  assert.equal(original.step(packet(1, planned)).vm.safe.due, true);
  const checkpoint = original.contextSnapshot().bytes;
  assert.ok(checkpoint.length > 0);
  assert.throws(() => restored.restoreContextCheckpoint(Uint8Array.of(1, 2, 3)), /checkpoint|restore|invalid/i);
  restored.restoreContextCheckpoint(checkpoint);
  assert.deepEqual(restored.contextSnapshot().state, original.contextSnapshot().state);
  assert.equal(restored.step(packet(0, planned - 1)).vm.safe.due, false);
  assert.equal(restored.step(packet(1, planned)).vm.safe.due, false);
});

test('GFB11 natural Result inputs reject caller spoofing', async () => {
  const compiled = await artifact('REF-03-062');
  const runtime = await runtimeFor(compiled);
  const protectedInput = compiled.manifest.naturalConditions[0].projectionInputs.ok;
  assert.throws(() => runtime.setBool(protectedInput, true), /Rust provider projections are not caller inputs/);
  runtime.dispose();
});

test('wrong GFCA binding and malformed GFSF5 are atomic', async () => {
  const compiled = await artifact('REF-03-062');
  const runtime = await runtimeFor(compiled);
  const tide = binding('tide', 'harbor_tides', 'Asia/Seoul', 'neap');
  const moon = binding('moon', 'moon', 'UTC', 'full');
  assert.throws(() => runtime.activateContext({
    bootEpoch: 7, terminalCapacity: 8,
    bindings: [{ ...tide, kind: 'moon' }, moon],
  }), /provider kind or timezone binding mismatch/);

  runtime.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [tide, moon] });
  assert.equal(runtime.journalLength, 0);
  assert.equal(rawContextTick(runtime, Uint8Array.of(0x47, 0x46, 0x53)), 0);
  assert.equal(runtime.journalLength, 0);

  tickContext(runtime, facts(1_000, 1_000, [], [
    observation(tide, ['neap']), observation(moon, ['full']),
  ]));
  assert.equal(runtime.trace.tick, 1);
  assert.equal(runtime.trace.requested.allowed, true);
  runtime.dispose();
});

test('Periodic and TimeSlots checkpoints preserve terminal occurrence dedupe', async () => {
  const fixtures = [
    {
      id: 'REF-03-036', site: 14, output: 'due', planned: 1_790_812_800_000,
      rows: [],
    },
    {
      id: 'REF-03-057', site: 16, output: 'due', planned: Date.UTC(2026, 8, 24, 21),
      rows: [{
        sourceDay: Date.UTC(2026, 8, 25) / 86_400_000, slotKey: 1, minuteOfDay: 360,
        fold: 0, eventId: '', eventKind: 'civil', instantMs: Date.UTC(2026, 8, 24, 21),
        withdrawn: false, providerRevision: 'civil-provider-v1', contextRevision: 'civil-context-v1',
      }],
    },
  ];
  for (const fixture of fixtures) {
    const compiled = await artifact(fixture.id);
    const evidence = [{
      site: fixture.site, coverageStartMs: fixture.planned - 2,
      coverageEndMs: fixture.planned + 1, provider: null, calendar: null, rows: fixture.rows,
    }];
    const original = await runtimeFor(compiled);
    original.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [] });
    tickContext(original, facts(0, fixture.planned - 1, evidence));
    tickContext(original, facts(1, fixture.planned, evidence));
    assert.equal(original.trace.requested[fixture.output], true, `${fixture.id} initial crossing`);
    const saved = checkpoint(original);

    const restored = await runtimeFor(compiled);
    restored.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [] });
    restore(restored, saved);
    tickContext(restored, facts(0, fixture.planned - 1, evidence));
    tickContext(restored, facts(1, fixture.planned, evidence));
    assert.equal(restored.trace.requested[fixture.output], false, `${fixture.id} restored dedupe`);
    original.dispose();
    restored.dispose();
  }
});
