import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { dailySlotsRange } from './helpers/range-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const activation = { bootEpoch: 1, terminalCapacity: 128, bindings: [] };
const DAY = 86_400_000, HOUR = 3_600_000;
const seoul = text => Date.parse(`${text}+09:00`);
const trafficSource = fs.readFileSync(new URL('./fixtures/issue541-seoul-traffic.ghost.md', import.meta.url), 'utf8');
const compile = source => compileSource(source, { filename: 'civil-range.ghost.md' });
const rangeSource = options => dailySlotsRange({ timezone: 'Asia/Seoul', selected: '[22:00]', duration: '7h', ...options });
const cache = new Map();

// Real host tzdb enumeration is input evidence; output logic exists only in the compiled control.
function resolveCivil(zone, sourceDay, minute, missing, repeated) {
  const key = JSON.stringify([zone, sourceDay, minute, missing, repeated]);
  if (cache.has(key)) return cache.get(key);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const nominal = sourceDay * DAY + minute * 60_000;
  const matches = [];
  let next;
  for (let instant = nominal - 15 * HOUR; instant <= nominal + 15 * HOUR; instant += 60_000) {
    const p = Object.fromEntries(fmt.formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (local === nominal) matches.push(instant);
    if (local > nominal && (!next || local < next.local)) next = { local, instant };
  }
  let result = matches.map((instantMs, index) => ({ instantMs, fold: matches.length === 1 ? 0 : index + 1 }));
  if (!matches.length) result = missing === 'next_valid' ? [{ instantMs: next.instant, fold: 0 }] : [];
  if (matches.length > 1 && repeated !== 'both') result = result.filter(row => row.fold === ({ first: 1, second: 2 }[repeated]));
  cache.set(key, result);
  return result;
}

function row(sourceDay, minuteOfDay, instantMs, fold = 0, slotKey = 1) {
  return { sourceDay, slotKey, minuteOfDay, fold, eventId: '', eventKind: 'civil', instantMs,
    withdrawn: false, providerRevision: `intl-${process.versions.icu}-${process.versions.tz}`,
    contextRevision: 'immutable-slots-v1' };
}
function evidence(artifact, from, to) {
  return artifact.manifest.schedules.map(schedule => {
    const rows = [];
    for (let day = Math.floor(from / DAY) - 1; day <= Math.floor(to / DAY) + 1; day++) {
      schedule.slots.forEach((minute, index) => {
        for (const resolved of resolveCivil(schedule.timezone, day, minute, schedule.dstMissing, schedule.dstRepeated)) {
          if (resolved.instantMs >= from && resolved.instantMs < to) rows.push(row(day, minute, resolved.instantMs, resolved.fold, index + 1));
        }
      });
    }
    return { site: schedule.site, coverageStartMs: from, coverageEndMs: to, provider: null, calendar: null, rows };
  });
}
function frame(scanId, mono, wall, schedules, trusted = true, bootEpoch = 1) {
  return { scanId, logicalTimeMs: mono, inputs: [], clock: { monotonicMs: mono, bootEpoch,
    wallMs: wall, uncertaintyMs: 0, trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'test-clock-v1' },
    natural: [], schedules, settings: null };
}
function timed(artifact, walls) {
  const schedules = evidence(artifact, Math.min(...walls) - 2 * DAY, Math.max(...walls) + 2 * DAY);
  return walls.map((wall, index) => frame(index, wall - walls[0], wall, schedules));
}
async function parity(artifact, frames, { ghostsim = true, checkpoint, bootEpoch = 1, save } = {}) {
  const directory = save ?? fs.mkdtempSync(path.join(os.tmpdir(), 'civil-range-541-'));
  fs.mkdirSync(directory, { recursive: true });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: { ...activation, bootEpoch } });
  const artifactPath = path.join(directory, 'program.gfb');
  try {
    writeArtifact(artifact, artifactPath);
    if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
    const tape = { profile: 'context-settings-civil-v1', activation: { ...activation, bootEpoch }, ...(checkpoint ? { checkpoint } : {}), steps: frames };
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(tapePath, JSON.stringify(tape));
    const native = spawnSync(path.join(root, 'target/release/examples/context_tape'), [artifactPath, tapePath],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const nativeRows = native.stdout.trim().split('\n').map(line => JSON.parse(line));
    const rows = frames.map(step => {
      const { scanId, logicalTimeMs, inputs, ...contextFacts } = step;
      let accepted = true;
      try { runtime.step({ nowMs: logicalTimeMs, contextFacts }); }
      catch { accepted = false; }
      return { accepted, outcome: structuredClone(runtime.lastFrameOutcome), checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
    });
    assert.equal(nativeRows.length, rows.length);
    nativeRows.forEach((native, index) => {
      assert.equal(native.accepted, rows[index].accepted, `native/WASM acceptance ${index}: ${native.error}`);
      assert.deepEqual(native.accepted ? native.outcome : native.lastOutcome, rows[index].outcome, `native/WASM full outcome ${index}`);
      assert.equal(native.checkpoint, rows[index].checkpoint, `native/WASM checkpoint ${index}`);
    });
    if (ghostsim) {
      assert.ok(rows.every(row => row.accepted), JSON.stringify(nativeRows.filter(row => !row.accepted)));
      const actions = frames.map(({ logicalTimeMs, scanId, inputs, ...contextFacts }) => ({ kind: 'scan', atMs: logicalTimeMs, contextFacts }));
      const scenarioPath = path.join(directory, 'scenario.toon');
      fs.writeFileSync(scenarioPath, encode({ format: 'GhostFlow/scenario-v1', id: 'civil-range-541', initialInputs: [], keyBindings: [], context: activation, actions }));
      const simulation = runScenario(artifactPath, scenarioPath, { format: 'json' });
      assert.equal(simulation.success, true, simulation.encoded.slice(0, 2000));
      const scans = JSON.parse(simulation.encoded).scans;
      assert.deepEqual(scans.map(scan => scan.safeVirtualIntent), rows.map(row => row.outcome.trace.safe), 'ghostsim/WASM outputs');
      scans.forEach((scan, index) => assert.deepEqual(scan.scheduleTrace, rows[index].outcome.trace.scheduleTrace, `ghostsim schedule ${index}`));
      if (save) fs.writeFileSync(path.join(directory, 'ghostsim.json'), simulation.encoded);
    }
    if (save) fs.writeFileSync(path.join(directory, 'native.ndjson'), native.stdout);
    return rows;
  } finally {
    runtime.dispose();
    if (!save) fs.rmSync(directory, { recursive: true, force: true });
  }
}
const outputs = rows => rows.map(row => row.outcome.trace.safe);

test('GFB22 lifecycle wraps GFB21 IANA Range without changing schedule semantics', async t => {
  const source = rangeSource().replace('control PlannedWatering {', `control PlannedWatering {
  type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
  input restart_reason: RestartReason;
  input restart_event: Bool;`).replace('pump <- watering.active;',
    'pump <- if restart_event then false else watering.active;');
  const artifact = await compile(source);
  const bytes = Buffer.from(artifact.bytes);
  assert.equal(bytes.readUInt16LE(4), 22);
  assert.equal(bytes.readUInt16LE(14), 21);
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, {
    context: activation, restart: { reasonOrdinal: 0, eventPending: true },
  });
  t.after(() => runtime.dispose());
  const walls = [seoul('2026-10-11T21:59:59'), seoul('2026-10-11T22:00:00'), seoul('2026-10-12T04:59:59')];
  const frames = timed(artifact, walls);
  const rows = frames.map(({ logicalTimeMs, scanId, inputs, ...contextFacts }) => {
    const result = runtime.step({ nowMs: logicalTimeMs, contextFacts });
    return { pump: runtime.lastFrameOutcome.trace.safe.pump, reason: result.vm.inputs.restart_reason,
      event: result.vm.inputs.restart_event };
  });
  assert.deepEqual(rows, [
    { pump: false, reason: 0, event: true },
    { pump: true, reason: 0, event: false },
    { pump: true, reason: 0, event: false },
  ]);
});

test('civil Range allocates GFB21 and rejects older headers and unsupported mutable/other recurrence profiles', async () => {
  const artifact = await compile(rangeSource());
  assert.equal(artifact.bytes.readUInt16LE(4), 21);
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v21');
  assert.equal(artifact.manifest.schedules[0].gridMs, 900_000);
  for (const format of [12, 19, 20]) {
    const bad = Buffer.from(artifact.bytes); bad.writeUInt16LE(format, 4);
    const runtime = await GhostFlowRuntime.instantiate(wasm);
    try { assert.throws(() => runtime.load(bad), /tag|prelude|format|descriptor|version/); }
    finally { runtime.dispose(); }
  }
  for (const source of [rangeSource().replace('DailySlots<15min>', 'Daily').replace('selected = [22:00];', 'at = time`22:00`;'),
    rangeSource({ duration: 'duration', config: 'config duration: Duration = 7h { min = 1h; max = 7h; step = 1h; access = operator; }' }),
    rangeSource({ selected: 'starts', config: 'config starts: TimeSlots<15min,4> = [time`22:00`] { access = operator; }' }),
    rangeSource({ config: 'provider tides: TidePredictions;' })]) {
    await assert.rejects(() => compile(source), /non-overlap|immutable|UTC/);
  }
});

test('REF-03-085 Seoul actual compiled traffic switches at 22:00, midnight and 05:00; late night/noon first scans admit', async () => {
  const a = await compile(trafficSource);
  const night = await parity(a, timed(a, ['2026-10-11T21:59:59.900','2026-10-11T22:00:00.000','2026-10-11T22:00:00.500','2026-10-11T22:00:01.000'].map(seoul)));
  assert.deepEqual(outputs(night), [{ red: true, green: false, yellow: false }, { red: false, green: false, yellow: true },
    { red: false, green: false, yellow: false }, { red: false, green: false, yellow: true }]);
  const morning = await parity(a, timed(a, ['2026-10-12T04:59:59.900','2026-10-12T05:00:00.000','2026-10-12T05:00:00.100'].map(seoul)),
    { save: path.join(root, 'build/issue541/boundary') });
  assert.deepEqual(outputs(morning), [{ red: false, green: false, yellow: true }, { red: true, green: false, yellow: false }, { red: true, green: false, yellow: false }]);
  for (const [time, output] of [['2026-10-11T23:00:00', { red: false, green: false, yellow: true }],
    ['2026-10-12T12:00:00', { red: true, green: false, yellow: false }]]) {
    assert.deepEqual(outputs(await parity(a, timed(a, [seoul(time)]))), [output]);
  }
  const midnight = await parity(a, timed(a, ['2026-10-11T23:59:59.900','2026-10-12T00:00:00.000','2026-10-12T00:00:00.100'].map(seoul)));
  assert.ok(outputs(midnight).every(o => !o.red && !o.green && o.yellow));
  assert.equal(midnight.flatMap(r => r.outcome.trace.contextTrace).filter(row => row.decision === 'Due').length, 1);
});

test('100ms scans execute 60/20/3 second daytime periods and repeat red at 83 seconds through native/WASM/ghostsim', async () => {
  const a = await compile(trafficSource), start = seoul('2026-10-12T05:00:00');
  const schedules = evidence(a, start - 17 * HOUR, start + 83_001);
  const frames = Array.from({ length: 831 }, (_, i) => frame(i, i * 100, start + i * 100, schedules));
  const rows = await parity(a, frames, { ghostsim: false, save: path.join(root, 'build/issue541/day-cycle') });
  rows.forEach((row, i) => {
    const seconds = (i * 100) % 83_000;
    assert.deepEqual(row.outcome.trace.safe, { red: seconds < 60_000, green: seconds >= 60_000 && seconds < 80_000, yellow: seconds >= 80_000 }, `scan ${i}`);
  });
  const checkpoints = [0, 59_900, 60_000, 79_900, 80_000, 82_900, 83_000];
  const sparse = await parity(a, checkpoints.map((at, i) => frame(i, at, start + at, schedules)),
    { save: path.join(root, 'build/issue541/day-boundaries') });
  assert.deepEqual(outputs(sparse), checkpoints.map(at => rows[at / 100].outcome.trace.safe));
});

test('civil Range rejects malformed, missing, duplicate, conflicting and overlapping facts without committing a scan', async () => {
  const a = await compile(rangeSource()), start = seoul('2026-10-11T23:00:00');
  const [good] = timed(a, [start]);
  const mutations = [
    f => { f.schedules = []; },
    f => { f.schedules[0].rows[0].minuteOfDay++; },
    f => { f.schedules[0].rows[0].slotKey = 9; },
    f => { f.schedules[0].rows[0].fold = 2; },
    f => { f.schedules[0].rows[0].instantMs = f.schedules[0].coverageStartMs - 1; },
    f => { f.schedules[0].coverageStartMs = start; f.schedules[0].rows = []; },
    f => { f.schedules[0].coverageEndMs = start; f.schedules[0].rows = []; },
    f => { f.schedules[0].rows[1].providerRevision = 'conflict'; },
    f => { f.schedules[0].rows.splice(1, 0, structuredClone(f.schedules[0].rows[0])); },
    f => { f.schedules[0].rows[1].instantMs = f.schedules[0].rows[0].instantMs + HOUR; },
    f => { f.schedules[0].rows[0].withdrawn = true; },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(good); mutate(bad);
    const rows = await parity(a, [bad, good], { ghostsim: false });
    assert.deepEqual(rows.map(r => r.accepted), [false, true]);
    assert.equal(rows[0].outcome, null);
    assert.equal(rows[1].outcome.scanId, 0, 'rejected frame does not consume scan ID');
  }
  for (const mutate of [f => { f.schedules[0].rows.splice(1, 1); }, f => { f.schedules[0].rows[1].instantMs += 1000; }]) {
    const next = { ...structuredClone(good), scanId: 1, logicalTimeMs: 100 };
    next.clock.monotonicMs = 100; next.clock.wallMs += 100;
    const bad = structuredClone(next); mutate(bad);
    const rows = await parity(a, [good, bad, next], { ghostsim: false });
    assert.deepEqual(rows.map(r => r.accepted), [true, false, true]);
    assert.deepEqual(rows[1].outcome, rows[0].outcome);
    assert.equal(rows[1].checkpoint, rows[0].checkpoint);
  }
});

test('civil Range trust recovery, frozen deadline, and durable restart dedup reuse RangeEngine', async () => {
  const a = await compile(rangeSource()), start = seoul('2026-10-11T23:00:00');
  const schedules = evidence(a, start - 2 * DAY, start + 2 * DAY);
  const frames = [frame(0, 0, null, schedules, false), frame(1, 100, start, schedules),
    frame(2, 200, null, schedules, false), frame(3, 6 * HOUR + 100, null, schedules, false),
    frame(4, 6 * HOUR + 200, start, schedules)];
  const rows = await parity(a, frames);
  assert.deepEqual(outputs(rows).map(o => o.pump), [false, true, true, false, false]);
  const restarted = await parity(a, [frame(0, 0, start + 1000, schedules, true, 2)],
    { ghostsim: false, checkpoint: rows[1].checkpoint, bootEpoch: 2 });
  assert.equal(restarted[0].outcome.trace.safe.pump, false);
});

test('rolling coverage spans multiple days without duplicate admissions; unknown initial omissions remain host responsibility', async () => {
  const a = await compile(rangeSource());
  const walls = ['2026-10-11T21:59:59.900','2026-10-11T22:00:00','2026-10-11T23:00:00',
    '2026-10-12T00:00:00','2026-10-12T05:00:00','2026-10-12T22:00:00',
    '2026-10-13T05:00:00','2026-10-13T22:00:00'].map(seoul);
  const frames = walls.map((wall, index) => frame(index, wall - walls[0], wall, evidence(a, wall - DAY, wall + DAY)));
  const rows = await parity(a, frames);
  assert.deepEqual(outputs(rows).map(o => o.pump), [false,true,true,true,false,true,false,true]);
  const due = rows.flatMap(r => r.outcome.trace.contextTrace).filter(row => row.decision === 'Due');
  assert.equal(due.length, 3);
  assert.equal(new Set(due.map(row => row.occurrenceId)).size, 3);
  const incomplete = timed(a, [seoul('2026-10-11T23:00:00')]);
  incomplete[0].schedules[0].rows = [];
  assert.equal(outputs(await parity(a, incomplete))[0].pump, false, 'no invented occurrence or output from an initially empty host packet');
});

test('a declared missing DST occurrence is inert, and conflicting ordinary/fold identities reject', async () => {
  const a = await compile(rangeSource({ timezone: 'America/New_York', selected: '[02:30]', duration: '30min' }));
  const instant = Date.parse('2026-03-08T07:00:00Z');
  const frames = timed(a, [instant]);
  const gap = row(Date.UTC(2026, 2, 8) / DAY, 150, null);
  frames[0].schedules[0].rows.push(gap);
  frames[0].schedules[0].rows.sort((a,b) => a.sourceDay-b.sourceDay || a.slotKey-b.slotKey || a.fold-b.fold);
  assert.equal(outputs(await parity(a, frames))[0].pump, false);
  const b = await compile(rangeSource({ timezone: 'America/New_York', selected: '[01:30]', duration: '30min', dstRepeated: 'both' }));
  const folds = timed(b, [Date.parse('2026-11-01T05:30:00Z')]);
  const ordinary = structuredClone(folds[0].schedules[0].rows.find(row => row.fold === 1));
  ordinary.fold = 0;
  folds[0].schedules[0].rows.push(ordinary);
  folds[0].schedules[0].rows.sort((a,b) => a.sourceDay-b.sourceDay || a.slotKey-b.slotKey || a.fold-b.fold);
  assert.equal((await parity(b, folds, { ghostsim: false }))[0].accepted, false);
  const reversed = timed(b, [Date.parse('2026-11-01T05:30:00Z')]);
  const pair = reversed[0].schedules[0].rows.filter(row => row.fold > 0);
  [pair[0].instantMs, pair[1].instantMs] = [pair[1].instantMs, pair[0].instantMs];
  assert.equal((await parity(b, reversed, { ghostsim: false }))[0].accepted, false, 'fold first precedes second even when intervals do not overlap');
});

test('actual IANA DST gap/fold facts select policy, preserve elapsed duration and reject actual overlap', async () => {
  const zone = 'America/New_York';
  const springDay = Date.UTC(2026, 2, 8) / DAY, fallDay = Date.UTC(2026, 10, 1) / DAY;
  assert.deepEqual(resolveCivil(zone, springDay, 150, 'skip', 'first'), []);
  assert.deepEqual(resolveCivil(zone, springDay, 150, 'next_valid', 'first'), [{ instantMs: Date.parse('2026-03-08T07:00:00Z'), fold: 0 }]);
  for (const policy of ['first','second','both','skip']) {
    const a = await compile(rangeSource({ timezone: zone, selected: '[01:30]', duration: '30min', dstRepeated: policy }));
    const walls = ['05:30','06:00','06:30','07:00'].map(time => Date.parse(`2026-11-01T${time}:00Z`));
    const rows = await parity(a, timed(a, walls));
    assert.deepEqual(outputs(rows).map(o => o.pump), { first: [true,false,false,false], second: [false,false,true,false], both: [true,false,true,false], skip: [false,false,false,false] }[policy]);
  }
  for (const policy of ['skip','next_valid']) {
    const a = await compile(rangeSource({ timezone: zone, selected: '[02:30]', duration: '30min', dstMissing: policy }));
    const rows = await parity(a, timed(a, ['07:00','07:29','07:30'].map(time => Date.parse(`2026-03-08T${time}:00Z`))));
    assert.deepEqual(outputs(rows).map(o => o.pump), policy === 'skip' ? [false,false,false] : [true,true,false]);
  }
  const overlapping = await compile(rangeSource({ timezone: zone, selected: '[01:30]', duration: '2h', dstRepeated: 'both' }));
  const rejected = await parity(overlapping, timed(overlapping, [Date.parse('2026-11-01T05:30:00Z')]), { ghostsim: false });
  assert.equal(rejected[0].accepted, false, 'nominal spacing passes compiler but DST actual interval overlap fails closed');
  const gapOverlap = await compile(rangeSource({ timezone: zone, selected: '[02:30, 03:00]', duration: '30min', dstMissing: 'next_valid' }));
  assert.equal((await parity(gapOverlap, timed(gapOverlap, [Date.parse('2026-03-08T07:00:00Z')]), { ghostsim: false }))[0].accepted, false);
});
