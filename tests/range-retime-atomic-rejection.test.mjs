import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const minute = 60_000;
const hour = 3_600_000;
const at0800 = 8 * hour;

const source = `# REF-03-083 retained-key retime overlap rejection

<!-- ghostflow:anchor id=GF-INT-REF-03-083 kind=intent status=confirmed origin=user -->
Issue [#272](https://github.com/callin2/ghostflow-language/issues/272) requires a retained TimeSlots key retime that would overlap another Range interval to reject atomically while preserving settings, keys, active occurrence state, and the durable ledger.

\`\`\`ghost
control RetimeAtomicRejectionRange {
  config enabled: Bool = false { access = operator; }
  // ghostflow:link id=GF-INT-REF-03-083 relation=implements
  config watering_slots: TimeSlots<1min, 8> = [time\`08:00\`, time\`08:20\`] { access = operator; }
  schedule watering: DailySlots<1min> {
    timezone = "UTC";
    selected = watering_slots;
    dst_missing = skip;
    dst_repeated = first;
    basis = range(10min);
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- watering.active;
}
\`\`\`
`;

function facts(site, mono, wall, settings = null, trusted = true) {
  return {
    clock: {
      monotonicMs: mono,
      bootEpoch: 1,
      wallMs: wall,
      uncertaintyMs: 0,
      trusted,
      unknownReason: trusted ? null : 'ClockUnknown',
      sourceRevision: 'range-retime-atomic-rejection-v1',
    },
    natural: [],
    schedules: [{
      site,
      coverageStartMs: 0,
      coverageEndMs: 253402300799999,
      provider: null,
      calendar: null,
      rows: [],
    }],
    settings,
  };
}

function event(fingerprint, changes, eventId, baseRevision, position) {
  return { programFingerprint: fingerprint, eventId, baseRevision, position, origin: 'operatorEdit', changes };
}

const entry = (key, minuteOfDay) => ({ key, minuteOfDay });
const slotsChange = (configId, entries) => ({
  configId,
  result: { ok: true, type: 'TimeSlots<60000ms,8>', value: { kind: 'slots', entries } },
});
const boolChange = (configId, value) => ({
  configId,
  result: { ok: true, type: 'Bool', value },
});

async function artifact() {
  const out = await compileSource(source, { filename: 'range-retime-atomic-rejection.ghost.md' });
  out.bytes = Buffer.from(out.bytes);
  assert.equal(out.bytes.readUInt16LE(4), 20);
  assert.equal(out.manifest.format, 'GhostFlow/control-v20');
  assert.equal(out.manifest.bytecodeSha256, sha256Hex(out.bytes));
  assert.equal(out.manifest.schedules[0].selectedConfig, 'watering_slots');
  return out;
}

async function run(steps, { checkpoint = null, compilation = null } = {}) {
  const a = compilation ?? await artifact();
  const site = a.manifest.schedules[0].site;
  const boolId = a.manifest.configs.find(c => c.name === 'enabled')?.id;
  const slotsId = a.manifest.configs.find(c => c.name === 'watering_slots')?.id;
  const probe = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const frames = steps.map((step, scanId) => ({
    scanId: step.scanId ?? scanId,
    logicalTimeMs: step.mono,
    inputs: [],
    ...facts(site, step.mono, step.wall, step.settings?.({ fingerprint, boolId, slotsId }), step.trusted ?? true),
  }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-retime-atomic-rejection-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, a.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, steps: frames, checkpoint }));
    const native = spawnSync(nativePath, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout || `native exited ${native.status}`);
    const rows = native.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const wasmRows = frames.map(frame => {
      try {
        runtime.step({
          nowMs: frame.logicalTimeMs,
          inputs: {},
          contextFacts: facts(site, frame.logicalTimeMs, frame.clock.wallMs, frame.settings, frame.clock.trusted),
        });
        return {
          accepted: true,
          outcome: structuredClone(runtime.runtime.outcome),
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'),
          settings: runtime.contextSnapshot().state,
        };
      } catch (error) {
        return {
          accepted: false,
          error: error.message,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'),
          settings: runtime.contextSnapshot().state,
        };
      }
    });
    assert.equal(rows.length, frames.length, 'every requested frame must have a native receipt');
    rows.forEach((row, i) => {
      assert.equal(row.accepted, wasmRows[i].accepted, `native/WASM acceptance ${i}: native=${row.error ?? 'accepted'} wasm=${wasmRows[i].error ?? 'accepted'}`);
      assert.deepEqual(row.settings, wasmRows[i].settings, `native/WASM full settings ${i}`);
      assert.equal(row.checkpoint, wasmRows[i].checkpoint, `native/WASM checkpoint ${i}`);
      if (row.accepted) assert.deepEqual(row.outcome, wasmRows[i].outcome, `native/WASM complete framed outcome ${i}`);
    });
    return { artifact: a, rows, ids: { boolId, slotsId, fingerprint } };
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const contextEntries = row => row.outcome?.trace.contextTrace ?? [];
const scheduleEntries = row => contextEntries(row).filter(e => e.occurrenceId && e.decision !== 'ObservationGap' && !e.decision.startsWith('Settings'));
const decisions = row => scheduleEntries(row).map(e => e.decision);
const occurrenceIds = row => scheduleEntries(row).map(e => e.occurrenceId);
const dueCount = rows => rows.flatMap(decisions).filter(decision => decision === 'Due').length;
const slotsSetting = row => row.settings.settings.find(setting => setting.name === 'watering_slots');
const boolSetting = row => row.settings.settings.find(setting => setting.name === 'enabled');
const slotEntries = row => slotsSetting(row).result.value.entries;

function assertRejectedUnchanged(rejected, before, message) {
  assert.equal(rejected.accepted, false, message);
  assert.match(rejected.error, /overlap|overlapping UTC Range/i, message);
  assert.equal(rejected.checkpoint, before.checkpoint, `${message}: full checkpoint preserved`);
  assert.deepEqual(rejected.settings, before.settings, `${message}: full settings, revision, allocator, and durable history preserved`);
  assert.equal(rejected.outcome, undefined, `${message}: rejected frame has no committed outcome`);
}

test('REF-03-083 retained K2 retime to 08:07 is atomically rejected and same-base retry can accept 08:10 touching', async () => {
  const start = day + at0800;
  const { rows } = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [
      slotsChange(slotsId, [entry(1, 480), entry(2, 487)]),
    ], 'retime-k2-overlap-0807', 0, 2) },
    { scanId: 1, mono: 2 * minute, wall: start + 6 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [
      slotsChange(slotsId, [entry(1, 480), entry(2, 490)]),
    ], 'retime-k2-touch-0810', 0, 2) },
    { scanId: 2, mono: 6 * minute - 1, wall: start + 9 * minute + 59_999 },
    { scanId: 3, mono: 6 * minute, wall: start + 10 * minute },
    { scanId: 4, mono: 16 * minute, wall: start + 20 * minute },
  ]);

  assert.deepEqual(rows.map(row => row.accepted), [true, false, true, true, true, true]);
  assert.deepEqual(rows[0].outcome.trace.safe.pump, true);
  assert.deepEqual(slotEntries(rows[0]), [entry(1, 480), entry(2, 500)]);
  assert.equal(rows[0].settings.settingsRevision, 0);
  assertRejectedUnchanged(rows[1], rows[0], 'retained-key 08:07 conflict rejects the whole event');
  assert.deepEqual(slotEntries(rows[1]), [entry(1, 480), entry(2, 500)], 'rejection preserves both displayed times and opaque keys');
  assert.deepEqual(decisions(rows[0]), ['Due']);
  assert.equal(dueCount([rows[0], rows[1]]), 1, 'rejection does not emit or remove an occurrence');

  assert.equal(rows[2].settings.settingsRevision, 1, 'same-position/same-base retry commits after the rejected event did not advance revision');
  assert.deepEqual(slotEntries(rows[2]), [entry(1, 480), entry(2, 490)], '08:10 touching intervals are valid');
  assert.deepEqual(rows.slice(2, 6).map(row => row.outcome.trace.safe.pump), [true, true, true, false], 'the touching 08:10 control has no overlap gap and expires at its half-open 08:20 deadline');
  assert.deepEqual(rows.slice(2, 6).map(decisions), [['Active'], ['Active'], ['Due'], ['Completed']]);
  const preTouchIds = rows.slice(0, 4).flatMap(occurrenceIds);
  assert.equal(new Set(preTouchIds).size, 1, 'K1 occurrence identity and ledger survive rejection and later valid retime before the touching K2 start');
  assert.ok(preTouchIds.every(id => id.endsWith(':1')), 'pre-touch observations remain the original K1 occurrence');
  assert.ok(occurrenceIds(rows[4]).some(id => id.endsWith(':2')), 'retained K2 occurrence uses its original key, not a newly allocated add-entry key');
});

test('REF-03-083 mixed Bool plus retained-key overlap rolls back every change and permits later nonoverlap control', async () => {
  const start = day + at0800;
  const { rows } = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, boolId, slotsId }) => event(fingerprint, [
      boolChange(boolId, true),
      slotsChange(slotsId, [entry(1, 480), entry(2, 487)]),
    ], 'mixed-bool-retime-overlap', 0, 2) },
    { scanId: 1, mono: 2 * minute, wall: start + 6 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [
      slotsChange(slotsId, [entry(1, 480), entry(2, 491)]),
    ], 'retime-k2-nonoverlap-0811', 0, 2) },
  ]);

  assert.deepEqual(rows.map(row => row.accepted), [true, false, true]);
  assertRejectedUnchanged(rows[1], rows[0], 'mixed Bool plus 08:07 retime overlap rejects atomically');
  assert.equal(boolSetting(rows[1]).result.value, false, 'unrelated Bool change is rolled back with the retained-key conflict');
  assert.deepEqual(slotEntries(rows[1]), [entry(1, 480), entry(2, 500)], 'no key allocation or display-time mutation leaks from the rejected event');
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.deepEqual(slotEntries(rows[2]), [entry(1, 480), entry(2, 491)], '08:11 nonoverlap control is accepted with the retained K2 key');
  assert.equal(boolSetting(rows[2]).result.value, false, 'valid nonoverlap control does not inherit the rolled-back Bool mutation');
  assert.ok(rows[2].outcome, 'valid nonoverlap retry produces a committed framed outcome');
});

test('REF-03-083 rejection preserves durable GFRG4 checkpoint and restored ledger does not replay history', async () => {
  const start = day + at0800;
  const first = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [
      slotsChange(slotsId, [entry(1, 480), entry(2, 487)]),
    ], 'retime-k2-overlap-0807', 0, 2) },
  ]);
  assertRejectedUnchanged(first.rows[1], first.rows[0], 'overlap rejection before restore');
  assert.ok(Buffer.from(first.rows[1].checkpoint, 'hex').includes(Buffer.from('GFES\x02GFRG\x04', 'latin1')), 'checkpoint remains the keyed GFRG4 Range context');

  const restored = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 6 * minute, wall: start + 10 * minute },
    { mono: 16 * minute, wall: start + 20 * minute },
  ], { checkpoint: first.rows[1].checkpoint, compilation: first.artifact });
  assert.deepEqual(restored.rows.map(row => row.accepted), [true, true, true]);
  assert.deepEqual(restored.rows.map(row => row.outcome.trace.safe.pump), [false, false, true], 'restore preserves consumed K1 history but not the active timer, and K2 remains scheduled at 08:20');
  assert.equal(dueCount(restored.rows), 1, 'restore does not replay the rejected event or the admitted K1 occurrence');
  assert.deepEqual(slotEntries(restored.rows[0]), [entry(1, 480), entry(2, 500)]);
  assert.ok(occurrenceIds(restored.rows[2]).some(id => id.endsWith(':2')), 'final admission/history belongs to preserved K2');
});
