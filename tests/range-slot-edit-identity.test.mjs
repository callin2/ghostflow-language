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

const source = (initial = '[time`08:00`]') => `# REF-03-082 keyed TimeSlots remove/add identity

<!-- ghostflow:anchor id=GF-INT-REF-03-082 kind=intent status=confirmed origin=user -->
Issue [#271](https://github.com/callin2/ghostflow-language/issues/271) requires retained-key retime and remove/add to have distinct identity and baseline effects for current-date Range occurrences.

\`\`\`ghost
control SlotEditIdentityRange {
  // ghostflow:link id=GF-INT-REF-03-082 relation=implements
  config watering_slots: TimeSlots<1min, 8> = ${initial} { access = operator; }
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
      sourceRevision: 'range-slot-edit-identity-v1',
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

async function artifact(initial = '[time`08:00`]') {
  const out = await compileSource(source(initial), { filename: 'range-slot-edit-identity.ghost.md' });
  out.bytes = Buffer.from(out.bytes);
  assert.equal(out.bytes.readUInt16LE(4), 20);
  assert.equal(out.manifest.format, 'GhostFlow/control-v20');
  assert.equal(out.manifest.bytecodeSha256, sha256Hex(out.bytes));
  assert.equal(out.manifest.schedules[0].selectedConfig, 'watering_slots');
  return out;
}

async function run(steps, { initial, checkpoint = null, compilation = null } = {}) {
  const a = compilation ?? await artifact(initial);
  const site = a.manifest.schedules[0].site;
  const slotsId = a.manifest.configs.find(c => c.name === 'watering_slots')?.id;
  const probe = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const frames = steps.map((step, scanId) => ({
    scanId: step.scanId ?? scanId,
    logicalTimeMs: step.mono,
    inputs: [],
    ...facts(site, step.mono, step.wall, step.settings?.({ fingerprint, slotsId }), step.trusted ?? true),
  }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-slot-edit-identity-'));
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
        const step = runtime.step({
          nowMs: frame.logicalTimeMs,
          inputs: {},
          contextFacts: facts(site, frame.logicalTimeMs, frame.clock.wallMs, frame.settings, frame.clock.trusted),
        });
        return {
          accepted: true,
          vm: step.vm,
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
      assert.deepEqual(row.settings, wasmRows[i].settings, `native/WASM settings ${i}`);
      assert.equal(row.checkpoint, wasmRows[i].checkpoint, `native/WASM checkpoint ${i}`);
      if (row.accepted) assert.deepEqual(row.outcome, wasmRows[i].outcome, `native/WASM complete framed outcome ${i}`);
    });
    return { artifact: a, rows, ids: { slotsId, fingerprint } };
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
const slotEntries = row => row.settings.settings.find(setting => setting.name === 'watering_slots').result.value.entries;

function assertSingleOldOccurrence(rows) {
  assert.equal(new Set(rows.flatMap(occurrenceIds)).size, 1, 'all schedule observations refer to the original occurrence only');
  assert.equal(dueCount(rows), 1, 'the original occurrence is admitted exactly once');
}

test('REF-03-082 retained-key retime pauses the admitted K occurrence while terminal remove/add allocates a new baseline key', async () => {
  const start = day + at0800;
  const retimed = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 8 * 60 + 7)])], 'retime-k-0807', 0, 2) },
    { mono: 3 * minute, wall: start + 7 * minute },
    { mono: 13 * minute, wall: start + 17 * minute },
  ]);
  assert.deepEqual(retimed.rows.map(row => row.accepted), [true, true, true, true]);
  assert.deepEqual(retimed.rows.map(row => row.outcome.trace.safe.pump), [true, false, true, false]);
  assert.deepEqual(retimed.rows.map(decisions), [['Due'], ['Waiting'], ['Active'], ['Completed']]);
  assertSingleOldOccurrence(retimed.rows);
  assert.deepEqual(slotEntries(retimed.rows[1]), [entry(1, 8 * 60 + 7)], 'retime retains opaque key K');

  const replaced = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 6 * minute, wall: start + 10 * minute },
    { mono: 7 * minute, wall: start + 11 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(0, 8 * 60 + 7)])], 'remove-k-add-0807-after-terminal', 0, 3) },
    { mono: 8 * minute, wall: start + 12 * minute },
  ]);
  assert.deepEqual(replaced.rows.map(row => row.accepted), [true, true, true, true]);
  assert.deepEqual(replaced.rows.map(row => row.outcome.trace.safe.pump), [true, false, false, false], 'remove/add after terminal does not rearm the old K Range or replay the elapsed new baseline');
  assert.deepEqual(replaced.rows.map(decisions), [['Due'], ['Completed'], [], []]);
  assertSingleOldOccurrence(replaced.rows);
  assert.deepEqual(slotEntries(replaced.rows[2]), [entry(2, 8 * 60 + 7)], 'remove/add allocates a fresh stable key instead of relabeling K');
  assert.equal(replaced.rows[2].settings.settingsRevision, 1);
});

test('REF-03-082 removing admitted K retains its already admitted Range until the original deadline', async () => {
  const start = day + at0800;
  const { rows } = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [])], 'remove-admitted-k', 0, 2) },
    { mono: 6 * minute - 1, wall: start + 9 * minute + 59_999 },
    { mono: 6 * minute, wall: start + 10 * minute },
  ]);
  assert.deepEqual(rows.map(row => row.accepted), [true, true, true, true]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, true, true, false]);
  assert.deepEqual(rows.map(decisions), [['Due'], ['Active'], ['Active'], ['Completed']]);
  assertSingleOldOccurrence(rows);
  assert.deepEqual(slotEntries(rows[1]), []);
});

test('REF-03-082 terminal current-date K cannot be rearmed by retime or remove/add to an elapsed 08:07 slot', async () => {
  const start = day + at0800;
  for (const [label, change] of [
    ['retime-terminal-k', [entry(1, 8 * 60 + 7)]],
    ['remove-add-terminal-k', [entry(0, 8 * 60 + 7)]],
  ]) {
    const { rows } = await run([
      { mono: 0, wall: start + 4 * minute },
      { mono: 6 * minute, wall: start + 10 * minute },
      { mono: 7 * minute, wall: start + 11 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, change)], label, 0, 3) },
      { mono: 8 * minute, wall: start + 12 * minute },
    ]);
    assert.deepEqual(rows.map(row => row.accepted), [true, true, true, true], label);
    assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, false, false, false], label);
    assert.deepEqual(decisions(rows[0]), ['Due'], label);
    assert.deepEqual(decisions(rows[1]), ['Completed'], label);
    assert.equal(dueCount(rows), 1, `${label}: terminal K is not admitted again`);
    assertSingleOldOccurrence(rows);
    assert.deepEqual(slotEntries(rows[2]), [entry(label === 'retime-terminal-k' ? 1 : 2, 8 * 60 + 7)], `${label}: retime retains K; remove/add allocates a distinct key`);
    assert.equal(rows[2].settings.settingsRevision, 1);
  }
});

test('REF-03-082 added entries use ordinary baseline: future additions can admit, current or past insertions do not', async () => {
  const start = day + at0800;
  const future = await run([
    { mono: 0, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(0, 8 * 60 + 7)])], 'add-future-0807', 0, 1) },
    { mono: 2 * minute, wall: start + 7 * minute },
    { mono: 12 * minute, wall: start + 17 * minute },
  ], { initial: '[]' });
  assert.deepEqual(future.rows.map(row => row.accepted), [true, true, true]);
  assert.deepEqual(slotEntries(future.rows[0]), [entry(1, 8 * 60 + 7)]);
  assert.deepEqual(future.rows.map(row => row.outcome.trace.safe.pump), [false, true, false]);
  assert.equal(dueCount(future.rows), 1, 'a genuinely future added key admits once at its slot');

  const current = await run([
    { mono: 0, wall: start + 7 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(0, 8 * 60 + 7)])], 'add-current-0807', 0, 1) },
    { mono: minute, wall: start + 8 * minute },
  ], { initial: '[]' });
  assert.deepEqual(current.rows.map(row => row.accepted), [true, true]);
  assert.deepEqual(current.rows.map(row => row.outcome.trace.safe.pump), [false, false]);
  assert.equal(dueCount(current.rows), 0, 'the effective event position itself is a baseline, not a due frame');

  const past = await run([
    { mono: 0, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(0, 8 * 60)])], 'add-past-0800', 0, 1) },
    { mono: minute, wall: start + 6 * minute },
  ], { initial: '[]' });
  assert.deepEqual(past.rows.map(row => row.accepted), [true, true]);
  assert.deepEqual(past.rows.map(row => row.outcome.trace.safe.pump), [false, false]);
  assert.equal(dueCount(past.rows), 0, 'an already elapsed same-day added key is not replayed');
});

test('REF-03-082 terminal GFRG4 checkpoint preserves consumed history and new key after remove/add without replaying the add baseline', async () => {
  const start = day + at0800;
  const first = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 6 * minute, wall: start + 10 * minute },
    { mono: 7 * minute, wall: start + 11 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(0, 8 * 60 + 7)])], 'remove-k-add-0807-after-terminal', 0, 3) },
  ]);
  assert.deepEqual(first.rows.map(row => row.outcome.trace.safe.pump), [true, false, false]);
  assert.deepEqual(slotEntries(first.rows[2]), [entry(2, 8 * 60 + 7)]);
  assert.ok(Buffer.from(first.rows[2].checkpoint, 'hex').includes(Buffer.from('GFES\x02GFRG\x04', 'latin1')), 'checkpoint uses GFRG4 keyed Range context');

  const restored = await run([
    { mono: 0, wall: start + 7 * minute },
    { scanId: 1, mono: 3 * minute, wall: start + 10 * minute },
  ], { checkpoint: first.rows[2].checkpoint, compilation: first.artifact });
  assert.deepEqual(restored.rows.map(row => row.accepted), [true, true]);
  assert.deepEqual(slotEntries(restored.rows[0]), [entry(2, 8 * 60 + 7)], 'restore keeps the newly allocated key identity');
  assert.deepEqual(restored.rows.map(row => row.outcome.trace.safe.pump), [false, false], 'restore preserves consumed history but does not resume an active timer');
  assert.equal(dueCount(restored.rows), 0, 'restore does not replay the fresh-key add baseline or the old K admission');
});
