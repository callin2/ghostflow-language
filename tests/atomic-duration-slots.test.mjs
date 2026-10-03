import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const minute = 60_000;
const start = Date.UTC(2026, 9, 3, 8);
const source = '# Atomic Duration and slots\n\nIssue [#331](https://github.com/callin2/ghostflow-language/issues/331) / REF-08-014: one settings event preserves an ongoing control timer while editing typed civil slots and elapsed Duration.\n\n```ghost\ncontrol TypedSlotsDuration {\nconfig starts: TimeSlots<15min,8> = [time`08:00`] { access = operator; }\nconfig duration: Duration = 10min { min = 1min; max = 20min; step = 1min; access = operator; }\nschedule watering: DailySlots<15min> { timezone = "UTC"; selected = starts; dst_missing = skip; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(20min); recovery = baseline; fallback = skip; }\nlet effective_duration = case duration { ok(value) => value; fault(_) => 0ms; };\nstate running: Bool = false;\ntimer age = elapsed(running);\nrunning\' = if running then age < effective_duration else watering.due;\noutput pump: Bool; pump <- running\';\noutput age_ms: Duration; age_ms <- age;\n}\n```\n';

const slots = (id, entries) => ({ configId: id, result: { ok: true, type: 'TimeSlots<900000ms,8>', value: { kind: 'slots', entries } } });
const duration = (id, value) => ({ configId: id, result: { ok: true, type: 'Duration', value } });
const entry = (key, minuteOfDay) => ({ key, minuteOfDay });

async function run(steps) {
  const a = await compileSource(source, { filename: 'atomic-duration-slots.ghost.md' });
  assert.equal(a.manifest.format, 'GhostFlow/control-v10');
  assert.equal(new DataView(a.bytes.buffer, a.bytes.byteOffset).getUint16(4, true), 11);
  assert.equal(a.manifest.bytecodeSha256, sha256Hex(a.bytes));
  const runtime = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  const ids = Object.fromEntries(a.manifest.configs.map(c => [c.name, c.id]));
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const frames = steps.map((s, i) => ({ scanId: s.scanId ?? i, logicalTimeMs: s.mono, inputs: [],
    clock: { monotonicMs: s.mono, bootEpoch: 1, wallMs: s.wall, uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'ref-08-014-clock-v1' },
    natural: [], schedules: [{ site: a.manifest.schedules[0].site, coverageStartMs: 0, coverageEndMs: 253402300799999, provider: null, calendar: null,
      rows: (s.mono < 2 * minute ? [entry(1, 480)] : [entry(1, 480), entry(2, 495)]).map(e => ({ sourceDay: Math.floor(start / 86_400_000), slotKey: e.key, minuteOfDay: e.minuteOfDay, fold: 0, eventId: '', eventKind: 'civil', instantMs: start + (e.minuteOfDay - 480) * minute, withdrawn: false, providerRevision: 'utc-civil-r1', contextRevision: 'ref-08-014-v1' })) }],
    settings: s.change ? { programFingerprint: s.fingerprint ?? fingerprint, eventId: s.eventId ?? `edit-${i}`, baseRevision: s.baseRevision ?? 0, position: s.position ?? i + 1, origin: 'operatorEdit', changes: s.change(ids) } : null }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-atomic-slots-'));
  try {
    const modulePath = path.join(dir, 'module.gfb'), tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(modulePath, a.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, steps: frames }));
    const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const rows = native.stdout.trim().split('\n').map(s => JSON.parse(s));
    frames.forEach((frame, i) => {
      let accepted = true, outcome;
      const { scanId, logicalTimeMs, inputs, ...contextFacts } = frame;
      try { runtime.step({ nowMs: logicalTimeMs, inputs: {}, contextFacts }); outcome = runtime.lastFrameOutcome; }
      catch (error) { accepted = false; assert.equal(rows[i].accepted, false, error.message); }
      assert.equal(rows[i].accepted, accepted, `native/WASM acceptance ${i}: ${rows[i].error}`);
      if (accepted) assert.deepEqual(rows[i].outcome, outcome, `full native/WASM outcome ${i}`);
      assert.equal(rows[i].checkpoint, Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), `native/WASM checkpoint ${i}`);
      assert.deepEqual(rows[i].settings, runtime.contextSnapshot().state, `native/WASM settings ${i}`);
    });
    return { rows, a, fingerprint };
  } finally { runtime.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('REF-08-014 atomic Duration and civil slots preserve the running timer and apply future slot boundaries', async () => {
  const { rows } = await run([
    { mono: 0, wall: start - 1 },
    { mono: 1, wall: start },
    { mono: 2 * minute + 1, wall: start + 2 * minute, change: ids => [duration(ids.duration, 5 * minute), slots(ids.starts, [entry(1, 480), entry(0, 495)])] },
    { mono: 5 * minute, wall: start + 5 * minute - 1 },
    { mono: 5 * minute + 1, wall: start + 5 * minute },
    { mono: 15 * minute + 1, wall: start + 15 * minute },
  ]);
  assert.deepEqual(rows.map(r => r.accepted), [true, true, true, true, true, true]);
  assert.deepEqual(rows.map(r => r.outcome.trace.safe.pump), [false, true, true, true, false, true]);
  assert.equal(rows[2].outcome.trace.safe.age_ms, 2 * minute);
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.equal(rows[2].outcome.trace.stateAfter.running, true);
  assert.equal(rows[2].outcome.trace.stateAfter.__gf_timer_since_age,
    rows[1].outcome.trace.stateAfter.__gf_timer_since_age, 'the settings event preserves the active timer anchor');
  const current = Object.fromEntries(rows[2].settings.settings.map(s => [s.name, s]));
  assert.equal(current.duration.result.value, 5 * minute);
  assert.deepEqual(current.starts.result.value.entries, [entry(1, 480), entry(2, 495)]);
  assert.equal(current.duration.emissionRevision, current.starts.emissionRevision);
  assert.equal(current.duration.applicationPosition, current.starts.applicationPosition);
  assert.equal(rows[3].outcome.trace.safe.age_ms, 5 * minute - 1);
  assert.equal(rows[4].outcome.trace.safe.age_ms, 5 * minute);
  assert.equal(rows[5].outcome.trace.contextTrace.find(t => t.decision === 'Due').plannedWallMs, start + 15 * minute,
    'the elapsed Duration remains distinct from the selected civil slot');
  assert.equal(rows[2].outcome.trace.contextTrace.some(t => t.decision === 'Due'), false, 'editing does not readmit the consumed start');
  assert.ok(rows.every(r => r.settings.programFingerprint === rows[0].settings.programFingerprint));
});

test('REF-08-014 wrong Program rejects the whole live event without resetting owners', async () => {
  for (const mistake of ['foreign-program']) {
    const change = ids => [duration(ids.duration, 5 * minute), slots(ids.starts, [entry(1, 480), entry(0, 495)])];
    const { rows } = await run([
      { mono: 0, wall: start - 1 },
      { mono: 1, wall: start },
      { scanId: 2, mono: 2 * minute + 1, wall: start + 2 * minute, fingerprint: mistake === 'foreign-program' ? '0' : undefined,
        eventId: 'retry-edit', position: 3, change: ids => {
          const changes = change(ids);
          if (mistake === 'civil-duration') changes[0].result.type = 'TimeOfDay';
          return changes;
        } },
      { scanId: 2, mono: 2 * minute + 1, wall: start + 2 * minute, eventId: 'retry-edit', position: 3, change },
    ]);
    assert.deepEqual(rows.map(r => r.accepted), [true, true, false, true], mistake);
    assert.match(rows[2].error, mistake === 'foreign-program' ? /fingerprint|transaction/i : /type|semantic|transaction/i);
    assert.equal(rows[2].checkpoint, rows[1].checkpoint, mistake);
    assert.deepEqual(rows[2].settings, rows[1].settings, mistake);
    assert.equal(rows[3].settings.settingsRevision, 1, 'rejected envelope consumes neither event ID nor revision');
    assert.equal(rows[3].outcome.trace.safe.pump, true);
    assert.equal(rows[3].outcome.trace.safe.age_ms, 2 * minute);
    assert.equal(rows[3].outcome.trace.stateAfter.__gf_timer_since_age, rows[1].outcome.trace.stateAfter.__gf_timer_since_age);
  }
});

test('REF-08-014 civil values never become successful Duration settings and keep the adopted aggregate fault rail', async () => {
  await assert.rejects(compileSource(source.replace('Duration = 10min', 'Duration = time`08:00`'),
    { filename: 'invalid-civil-duration.ghost.md' }), /Duration|type/i);
  const { rows } = await run([
    { mono: 0, wall: start - 1 },
    { mono: 1, wall: start, change: ids => [
      { configId: ids.duration, result: { ok: true, type: 'TimeOfDay', value: 5 * minute } },
      slots(ids.starts, [entry(1, 480), entry(0, 495)]),
    ] },
  ]);
  assert.deepEqual(rows.map(r => r.accepted), [true, true], 'the selected settings contract emits an aggregate Result fault');
  assert.equal(rows[1].settings.settingsRevision, 1);
  for (const setting of rows[1].settings.settings) {
    assert.deepEqual(setting.result, { ok: false, fault: 'SettingsInvalid' });
    assert.equal(setting.emissionRevision, 1);
    assert.equal(setting.applicationPosition, 2);
  }
  assert.equal(rows[1].outcome.trace.safe.pump, false, 'the source-authored fault fallback prevents a run');
});
