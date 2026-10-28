import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { naturalScheduledDateFacts } from '../runtimes/wasm/civil-date.mjs';

const cases = JSON.parse(readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url), 'utf8')).cases;
const source = (name, day) => {
  const entry = cases.find(item => item.source?.includes(`control ${name} {`));
  assert.ok(entry, `missing ${name} source`);
  return entry.source.replace('    basis =', `    on = day\`${day}\`;\n    basis =`)
    .replace('cancel_when = stop || unsafe_level;', 'cancel_when = false;');
};
const root = resolve(new URL('..', import.meta.url).pathname);
const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const nativeRunner = resolve(root, 'target/release/examples/context_tape');
const planned = Date.parse('2026-10-25T14:40:00Z'); // Sunday 23:40 in Asia/Seoul.
const sourceDay = Date.parse('2026-10-26T00:00:00Z') / 86_400_000;
const scheduledDay = sourceDay - 1;
const binding = { kind: 'tide', provider: 'harbor_tides', namespace: 'weekday', station: 'harbor',
  bindingRevision: 'binding-r1', location: 'seoul', timezone: 'Asia/Seoul', criteria: 'high', maxUncertaintyMs: 0 };
const activation = bootEpoch => ({ bootEpoch, terminalCapacity: 16, bindings: [binding] });

function tideSource(day) {
  return source('TideSchedule', day).replace('run(10min, within(5min))', 'run(30min, within(5min))')
    .replace('skip_after(60s)', 'skip_after(2h)')
    .replace('  input stop, unsafe_level: Bool;\n', '')
    .replace('  output active: Bool;', '  output active, due: Bool;')
    .replace('  active <- high.active;', '  active <- high.active;\n  due <- high.due;');
}
function tideFrame(site, mono, wall, { bootEpoch = 7, dates, providerRevision = 'harbor-r1' } = {}) {
  const contextFacts = { clock: { monotonicMs: mono, bootEpoch, wallMs: wall, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'rtc-r1' },
  natural: [], settings: null,
  schedules: [{ site, coverageStartMs: planned - 3_600_000, coverageEndMs: planned + 3_600_000,
    calendar: null, provider: { binding, providerRevision, coverageStartMs: planned - 3_600_000,
      coverageEndMs: planned + 3_600_000, expiresAtMs: planned + 3_600_001,
      uncertaintyMs: 0, fault: null, classifications: [] },
    rows: [{ sourceDay, slotKey: 0, minuteOfDay: 0, fold: 0, eventId: 'high-a', eventKind: 'high',
      instantMs: planned + 1_800_000, withdrawn: false, providerRevision, contextRevision: 'station-r1' }] }],
  ...(dates === undefined ? {} : { scheduledDates: dates }) };
  return { logicalTimeMs: mono, contextFacts };
}
function nativeFrames(artifact, frames) {
  return frames.map((frame, scanId) => ({ scanId: frame.scanId ?? scanId, logicalTimeMs: frame.logicalTimeMs,
    inputs: [], ...frame.contextFacts,
    scheduledDates: frame.contextFacts.scheduledDates === undefined
      ? naturalScheduledDateFacts(frame.contextFacts, artifact.manifest.schedules)
      : frame.contextFacts.scheduledDates }));
}
function runNative(t, artifact, frames, bootEpoch = 7, saved = null, profile = 'context-tide-v1') {
  const directory = mkdtempSync(join(tmpdir(), 'natural-weekday-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const module = join(directory, 'module.gfb'), tape = join(directory, 'tape.json');
  writeFileSync(module, artifact.bytes);
  writeFileSync(tape, JSON.stringify({ profile, activation: profile === 'context-solar-v1'
    ? { bootEpoch, terminalCapacity: 16, bindings: [] } : activation(bootEpoch),
  ...(saved ? { checkpoint: saved } : {}), steps: nativeFrames(artifact, frames) }));
  return execFileSync(nativeRunner, [module, tape], { encoding: 'utf8', timeout: 15_000 })
    .trim().split('\n').map(line => JSON.parse(line));
}
async function runWasm(artifact, frames, bootEpoch = 7, saved = null, solar = false) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact,
    { context: solar ? { bootEpoch, terminalCapacity: 16, bindings: [] } : activation(bootEpoch) });
  try {
    if (saved) runtime.restoreContextCheckpoint(Buffer.from(saved, 'hex'));
    return frames.map(frame => {
      try {
        runtime.step({ nowMs: frame.logicalTimeMs, contextFacts: frame.contextFacts });
        return { accepted: true, outcome: structuredClone(runtime.lastFrameOutcome),
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      } catch (error) {
        return { accepted: false, outcome: structuredClone(runtime.lastFrameOutcome),
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), error: error.message };
      }
    });
  } finally { runtime.dispose(); }
}
function parity(native, wasmRows) {
  assert.deepEqual(native.map(row => ({ accepted: row.accepted,
    outcome: row.accepted ? row.outcome : row.lastOutcome, checkpoint: row.checkpoint })),
  wasmRows.map(row => ({ accepted: row.accepted, outcome: row.outcome, checkpoint: row.checkpoint })));
}

test('weekday natural source compiles to a distinct fail-closed control and GFB profile', async () => {
  for (const [name, day] of [['TideSchedule', 'mon'], ['SolarValid', 'sun']]) {
    const compiled = await compileSource(source(name, day), { filename: `${name}-weekday.ghost.md` });
    assert.equal(compiled.manifest.format, 'GhostFlow/control-v24');
    assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 24);
    assert.deepEqual(compiled.manifest.schedules[0].day,
      { kind: 'weekday', mask: day === 'mon' ? 2 : 1 });
  }
  await assert.rejects(compileSource(source('TideSchedule', 'holiday'),
    { filename: 'tide-holiday.ghost.md' }), /weekday names only/);
  for (const [day, mask] of [['mon..fri', 62], ['mon,wed,fri', 42]]) {
    const compiled = await compileSource(source('SolarValid', day), { filename: `solar-${mask}.ghost.md` });
    assert.deepEqual(compiled.manifest.schedules[0].day, { kind: 'weekday', mask });
  }
  const legacySource = tideSource('sun').replace('    on = day`sun`;\n', '');
  const legacy = await compileSource(legacySource, { filename: 'tide-unfiltered.ghost.md' });
  assert.notEqual(legacy.manifest.format, 'GhostFlow/control-v24');
  assert.notEqual(new DataView(legacy.bytes.buffer, legacy.bytes.byteOffset).getUint16(4, true), 24);
});

test('REF-03-040 Tide uses scheduled Sunday to reject Monday filter and keep admitted Sunday Run through midnight', async t => {
  for (const [day, shouldAdmit] of [['mon', false], ['sun', true]]) {
    const artifact = await compileSource(tideSource(day), { filename: `tide-${day}.ghost.md` });
    const site = artifact.manifest.schedules[0].site;
    const frames = [tideFrame(site, 0, planned - 1), tideFrame(site, 1, planned),
      tideFrame(site, 1 + 25 * 60_000, planned + 25 * 60_000),
      tideFrame(site, 1 + 30 * 60_000, planned + 30 * 60_000)];
    const native = runNative(t, artifact, frames), actual = await runWasm(artifact, frames);
    assert.ok(actual.every(row => row.accepted), JSON.stringify({ inputs: artifact.manifest.inputs,
      sensors: artifact.manifest.sensors, errors: actual.map(row => row.error) }));
    parity(native, actual);
    const crossing = actual[1].outcome.trace;
    assert.equal(crossing.safe.due, shouldAdmit);
    const observation = crossing.contextTrace.find(row => row.decision === (shouldAdmit ? 'Due' : 'DayIneligible'));
    assert.equal(observation.sourceDay, sourceDay);
    assert.equal(observation.scheduledDay, scheduledDay);
    assert.equal(crossing.requested.missed, undefined);
    assert.equal(actual[2].outcome.trace.safe.active, shouldAdmit);
    if (shouldAdmit) {
      const active = actual[2].outcome.trace.contextTrace.find(row => row.decision === 'Active');
      assert.equal(active.sourceDay, sourceDay);
      assert.equal(active.scheduledDay, scheduledDay);
      assert.equal(actual[3].outcome.trace.safe.active, false);
      const saved = actual[1].checkpoint;
      const afterReboot = [tideFrame(site, 0, planned + 20 * 60_000, { bootEpoch: 8 }),
        tideFrame(site, 1, planned + 21 * 60_000, { bootEpoch: 8 })];
      const nativeRestored = runNative(t, artifact, afterReboot, 8, saved);
      const wasmRestored = await runWasm(artifact, afterReboot, 8, saved);
      parity(nativeRestored, wasmRestored);
      assert.deepEqual(wasmRestored.map(row => row.outcome.trace.safe.due), [false, false]);
      assert.deepEqual(wasmRestored.map(row => row.outcome.trace.safe.active), [false, false]);
    } else {
      const saved = actual[1].checkpoint;
      const afterReboot = [tideFrame(site, 0, planned + 20 * 60_000, { bootEpoch: 8 }),
        tideFrame(site, 1, planned + 21 * 60_000, { bootEpoch: 8 })];
      const nativeRestored = runNative(t, artifact, afterReboot, 8, saved);
      const wasmRestored = await runWasm(artifact, afterReboot, 8, saved);
      parity(nativeRestored, wasmRestored);
      assert.deepEqual(wasmRestored.map(row => row.outcome.trace.safe.due), [false, false]);
    }
  }
});

test('unavailable conversion stays Unknown, and missing or contradictory facts reject without advancing Tide state', async t => {
  const artifact = await compileSource(tideSource('sun'), { filename: 'tide-unknown.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const baseline = tideFrame(site, 0, planned - 1);
  const crossing = tideFrame(site, 1, planned);
  const known = naturalScheduledDateFacts(crossing.contextFacts, artifact.manifest.schedules)[0];
  const missing = tideFrame(site, 1, planned, { dates: [] });
  const contradictory = tideFrame(site, 1, planned,
    { dates: [{ ...known, scheduledDay: sourceDay }] });
  const recovered = tideFrame(site, 1, planned);
  const frames = [baseline, { ...missing, scanId: 1 }, { ...contradictory, scanId: 1 },
    { ...recovered, scanId: 1 }];
  const native = runNative(t, artifact, frames), actual = await runWasm(artifact, frames);
  parity(native, actual);
  assert.deepEqual(actual.map(row => row.accepted), [true, false, false, true]);
  assert.equal(actual[1].checkpoint, actual[0].checkpoint);
  assert.equal(actual[2].checkpoint, actual[0].checkpoint);
  assert.equal(actual[3].outcome.trace.safe.due, true);

  const unknown = { ...known, scheduledDay: null, unavailableReason: 'CivilDateUnavailable',
    resolverRevision: 'intl-gregory-v2' };
  const later = { ...known, resolverRevision: 'intl-gregory-v3' };
  const unavailableFrames = [baseline, tideFrame(site, 1, planned, { dates: [unknown] }),
    tideFrame(site, 2, planned + 1, { dates: [later] })];
  const nativeUnknown = runNative(t, artifact, unavailableFrames);
  const wasmUnknown = await runWasm(artifact, unavailableFrames);
  parity(nativeUnknown, wasmUnknown);
  assert.equal(wasmUnknown[1].outcome.trace.safe.due, false);
  assert.ok(wasmUnknown[1].outcome.trace.contextTrace.some(row => row.decision === 'Unknown(CivilDateUnavailable)'
    && row.sourceDay === sourceDay && row.scheduledDay === null));
  assert.equal(wasmUnknown[2].outcome.trace.safe.due, false);

  const unchangedRevision = [tideFrame(site, 0, planned - 1, { dates: [unknown] }),
    tideFrame(site, 1, planned, { dates: [{ ...known, resolverRevision: 'intl-gregory-v2' }] })];
  const nativeConflict = runNative(t, artifact, unchangedRevision);
  const wasmConflict = await runWasm(artifact, unchangedRevision);
  parity(nativeConflict, wasmConflict);
  assert.deepEqual(wasmConflict.map(row => row.accepted), [true, false]);
  assert.match(wasmConflict[1].error, /conflicting scheduled local-date revision/);
});

function solarFrame(site, mono, wall) {
  return { logicalTimeMs: mono, contextFacts: {
    clock: { monotonicMs: mono, bootEpoch: 7, wallMs: wall, uncertaintyMs: 0,
      trusted: true, unknownReason: null, sourceRevision: 'rtc-r1' },
    natural: [], settings: null, schedules: [],
    solars: [{ site, timezone: 'Asia/Seoul', latitude: 37.5665, longitude: 126.978,
      event: 0, offsetMs: 1_800_000, coverageStartMs: planned - 3_600_000,
      coverageEndMs: planned + 3_600_000,
      rows: [{ sourceDay, scheduledWallMs: planned, availability: 0,
        fallbackWallMs: null, unavailableReason: null,
        providerRevision: 'sun-r1', contextRevision: 'station-r1' }] }],
  } };
}

test('REF-03-040 Solar weekday admission uses scheduled date and emits the chosen cause', async t => {
  for (const [day, admitted] of [['mon', false], ['sun', true]]) {
    const artifact = await compileSource(source('SolarValid', day), { filename: `solar-${day}.ghost.md` });
    const site = artifact.manifest.schedules[0].site;
    const frames = [solarFrame(site, 0, planned - 1), solarFrame(site, 1, planned)];
    const native = runNative(t, artifact, frames, 7, null, 'context-solar-v1');
    const actual = await runWasm(artifact, frames, 7, null, true);
    parity(native, actual);
    assert.ok(actual.every(row => row.accepted));
    assert.equal(actual[1].outcome.trace.safe.due, admitted);
    const row = actual[1].outcome.trace.contextTrace.find(value => value.decision ===
      (admitted ? 'Due' : 'DayIneligible'));
    assert.equal(row.sourceDay, sourceDay);
    assert.equal(row.scheduledDay, scheduledDay);
  }
});

test('Solar fixed fallback uses the chosen planned instant and rejects a mismatched date fact', async t => {
  const src = source('SolarValid', 'sun')
    .replace('fallback = skip', 'fallback = fixed_time(time`23:40`, terminal: skip)');
  const artifact = await compileSource(src, { filename: 'solar-fallback-weekday.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const fallback = solarFrame(site, 0, planned - 1);
  const row = fallback.contextFacts.solars[0].rows[0];
  Object.assign(row, { sourceDay: scheduledDay, scheduledWallMs: null, availability: 1, fallbackWallMs: planned,
    unavailableReason: 2 });
  const crossing = structuredClone(fallback);
  crossing.logicalTimeMs = 1;
  Object.assign(crossing.contextFacts.clock, { monotonicMs: 1, wallMs: planned });
  const native = runNative(t, artifact, [fallback, crossing], 7, null, 'context-solar-v1');
  const actual = await runWasm(artifact, [fallback, crossing], 7, null, true);
  assert.ok(actual.every(row => row.accepted), JSON.stringify(actual.map(row => row.error)));
  parity(native, actual);
  assert.equal(actual[1].outcome.trace.safe.due, true);
  assert.ok(actual[1].outcome.trace.contextTrace.some(value =>
    value.decision === 'Due' && value.fallback === true && value.scheduledDay === scheduledDay));
  const wrong = structuredClone(crossing);
  const fact = naturalScheduledDateFacts(wrong.contextFacts, artifact.manifest.schedules)[0];
  wrong.contextFacts.scheduledDates = [{ ...fact, plannedWallMs: planned + 1 }];
  const rejected = await runWasm(artifact, [fallback, wrong], 7, null, true);
  assert.equal(rejected[1].accepted, false);
  assert.equal(rejected[1].checkpoint, rejected[0].checkpoint);
});

test('UTC and both sides of a New York DST boundary agree in native and WASM admission', async t => {
  const examples = [
    { timezone: 'UTC', instant: '2026-11-01T03:30:00Z', day: 'sun', expected: '2026-11-01' },
    { timezone: 'America/New_York', instant: '2026-11-01T03:30:00Z', day: 'sat', expected: '2026-10-31' },
    { timezone: 'America/New_York', instant: '2026-11-01T06:30:00Z', day: 'sun', expected: '2026-11-01' },
  ];
  for (const example of examples) {
    const src = source('SolarValid', example.day).replace('Asia/Seoul', example.timezone);
    const artifact = await compileSource(src, { filename: `solar-${example.timezone}-${example.day}.ghost.md` });
    const site = artifact.manifest.schedules[0].site;
    const instant = Date.parse(example.instant);
    const epochDay = Date.parse(`${example.expected}T00:00:00Z`) / 86_400_000;
    const frames = [solarFrame(site, 0, instant - 1), solarFrame(site, 1, instant)];
    for (const frame of frames) {
      const evidence = frame.contextFacts.solars[0];
      evidence.timezone = example.timezone;
      evidence.coverageStartMs = instant - 3_600_000;
      evidence.coverageEndMs = instant + 3_600_000;
      evidence.rows[0].sourceDay = epochDay;
      evidence.rows[0].scheduledWallMs = instant;
    }
    const native = runNative(t, artifact, frames, 7, null, 'context-solar-v1');
    const actual = await runWasm(artifact, frames, 7, null, true);
    parity(native, actual);
    assert.equal(actual[1].outcome.trace.safe.due, true);
    assert.equal(actual[1].outcome.trace.contextTrace.find(row => row.decision === 'Due').scheduledDay, epochDay);
  }
});

test('filtered Tide correction keeps admitted identity and the original Run date evidence', async t => {
  const artifact = await compileSource(tideSource('sun'), { filename: 'tide-correction-weekday.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const baseline = tideFrame(site, 0, planned - 1);
  const admission = tideFrame(site, 1, planned);
  const corrected = tideFrame(site, 2, planned + 1, { providerRevision: 'harbor-r2' });
  corrected.contextFacts.schedules[0].rows[0].instantMs += 60_000;
  const native = runNative(t, artifact, [baseline, admission, corrected]);
  const actual = await runWasm(artifact, [baseline, admission, corrected]);
  parity(native, actual);
  assert.deepEqual(actual.map(row => row.outcome.trace.safe.due), [false, true, false]);
  assert.equal(actual[2].outcome.trace.safe.active, true);
  const active = actual[2].outcome.trace.contextTrace.find(row => row.decision === 'Active');
  assert.equal(active.providerRevision, 'harbor-r1');
  assert.equal(active.sourceDay, sourceDay);
  assert.equal(active.scheduledDay, scheduledDay);
});
