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

const source = `# REF-03-081 keyed TimeSlots retime Range

<!-- ghostflow:anchor id=GF-INT-REF-03-081 kind=intent status=confirmed origin=user -->
Issue [#270](https://github.com/callin2/ghostflow-language/issues/270) requires a retained TimeSlots key retime to preserve the admitted Range occurrence and ledger while reevaluating the changed half-open interval.

\`\`\`ghost
control KeyedRetimeRange {
  // ghostflow:link id=GF-INT-REF-03-081 relation=implements
  config watering_slots: TimeSlots<1min, 8> = [time\`08:00\`] { access = operator; }
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
      sourceRevision: 'range-keyed-retime-v1',
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

async function artifact() {
  const out = await compileSource(source, { filename: 'range-keyed-retime.ghost.md' });
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-keyed-retime-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, a.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, steps: frames, checkpoint }));
    const native = spawnSync(nativePath, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
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

test('REF-03-081 retained key retime at 08:05 pauses then resumes same 08:07-08:17 Range without second due', async () => {
  const start = day + at0800;
  const result = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 8 * 60 + 7)])], 'retime-0807-at-0805', 0, 2) },
    { mono: 3 * minute, wall: start + 7 * minute },
    { mono: 12 * minute + 59_999, wall: start + 16 * minute + 59_999 },
    { mono: 13 * minute, wall: start + 17 * minute },
  ]);
  const { rows } = result;
  assert.deepEqual(rows.map(row => row.accepted), [true, true, true, true, true]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, false, true, true, false]);
  assert.deepEqual(rows.map(decisions), [['Due'], ['Waiting'], ['Active'], ['Active'], ['Completed']]);
  assert.equal(dueCount(rows), 1, 'the retimed occurrence is not admitted a second time');
  assert.equal(new Set(rows.flatMap(occurrenceIds)).size, 1, 'occurrence identity stays fixed across admission, pause, resume, and completion');
  assert.deepEqual(slotEntries(rows[1]), [entry(1, 8 * 60 + 7)], 'retime preserves the original opaque slot key');
  assert.equal(rows[1].settings.settingsRevision, 1);
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.equal(rows[4].outcome.trace.safe.pump, false, 'range end is half-open at exactly 08:17');

  const restored = await run([
    { mono: 0, wall: start + 16 * minute + 59_999 },
    { mono: 1, wall: start + 17 * minute },
  ], { checkpoint: rows[2].checkpoint, compilation: result.artifact });
  assert.deepEqual(restored.rows.map(row => row.accepted), [true, true]);
  assert.deepEqual(restored.rows.map(row => row.outcome.trace.safe.pump), [false, false], 'GFRG4 restores consumed identity/settings but does not resume the active timer');
  assert.equal(dueCount(restored.rows), 0, 'checkpoint restore does not replay admission');
  assert.deepEqual(slotEntries(restored.rows[0]), [entry(1, 8 * 60 + 7)], 'checkpoint restore keeps the retimed keyed entry');
});

test('REF-03-081 immediate 08:07 effective retime evaluates same occurrence active in that accepted frame', async () => {
  const start = day + at0800;
  const { rows } = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 8 * 60 + 7)])], 'retime-0807-at-0807', 0, 2) },
    { mono: 13 * minute - 1, wall: start + 16 * minute + 59_999 },
    { mono: 13 * minute, wall: start + 17 * minute },
  ]);
  assert.deepEqual(rows.map(row => row.accepted), [true, true, true, true]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, true, true, false]);
  assert.deepEqual(rows.map(decisions), [['Due'], ['Active'], ['Active'], ['Completed']]);
  assert.equal(dueCount(rows), 1, 'event at the changed start is active immediately but does not emit a second due');
  assert.equal(new Set(rows.flatMap(occurrenceIds)).size, 1);
  assert.deepEqual(slotEntries(rows[1]), [entry(1, 8 * 60 + 7)]);
  assert.equal(rows[3].outcome.trace.safe.pump, false, '08:17 is excluded from the retimed 10 minute Range');
});
