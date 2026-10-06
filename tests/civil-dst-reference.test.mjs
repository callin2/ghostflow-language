import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = resolve(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : ''));
const dayMs = 86_400_000;
const minuteMs = 60_000;
const zone = 'America/New_York';

execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'context_tape'],
  { cwd: root, stdio: 'inherit' });
const wasmBytes = readFileSync(wasmPath);

const source = `# REF-03-039 civil DST conformance

Issue [#223](https://github.com/callin2/ghostflow-language/issues/223) / REF-03-039: civil recurrence explicitly distinguishes missing-time and repeated-time policies.

\`\`\`ghost
control CivilDstReference {
  schedule gap_skip: Cron { timezone = "America/New_York"; at = cron5\`30 2 8 3 *\`; dst_missing = skip; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
  schedule gap_next: Cron { timezone = "America/New_York"; at = cron5\`30 2 8 3 *\`; dst_missing = next_valid; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
  schedule fold_first: Cron { timezone = "America/New_York"; at = cron5\`30 1 1 11 *\`; dst_missing = skip; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
  schedule fold_second: Cron { timezone = "America/New_York"; at = cron5\`30 1 1 11 *\`; dst_missing = skip; dst_repeated = second; basis = pulse; when = true; clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
  schedule fold_both: Cron { timezone = "America/New_York"; at = cron5\`30 1 1 11 *\`; dst_missing = skip; dst_repeated = both; basis = pulse; when = true; clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
  schedule fold_skip: Cron { timezone = "America/New_York"; at = cron5\`30 1 1 11 *\`; dst_missing = skip; dst_repeated = skip; basis = pulse; when = true; clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
  output gap_skip_due: Bool; gap_skip_due <- gap_skip.due;
  output gap_next_due: Bool; gap_next_due <- gap_next.due;
  output fold_first_due: Bool; fold_first_due <- fold_first.due;
  output fold_second_due: Bool; fold_second_due <- fold_second.due;
  output fold_both_due: Bool; fold_both_due <- fold_both.due;
  output fold_skip_due: Bool; fold_skip_due <- fold_skip.due;
}
\`\`\`
`;

function localPartsFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function localParts(fmt, instantMs) {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(instantMs)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}
function compareCivil(a, b) {
  for (const key of ['year', 'month', 'day', 'hour', 'minute', 'second']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}
function matchingInstants(timeZone, target) {
  const fmt = localPartsFormatter(timeZone);
  const center = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second ?? 0);
  const hits = [];
  for (let instant = center - 12 * 3_600_000; instant <= center + 12 * 3_600_000; instant += minuteMs) {
    if (compareCivil(localParts(fmt, instant), target) === 0) hits.push(instant);
  }
  return hits;
}
function nextValidInstant(timeZone, target) {
  const fmt = localPartsFormatter(timeZone);
  const center = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second ?? 0);
  for (let instant = center - 12 * 3_600_000; instant <= center + 18 * 3_600_000; instant += minuteMs) {
    const local = localParts(fmt, instant);
    if (local.year === target.year && local.month === target.month && local.day === target.day && compareCivil(local, target) > 0) return instant;
  }
  throw new Error(`no next valid local time found after ${JSON.stringify(target)} in ${timeZone}`);
}
function sourceDay(year, month, day) { return Date.UTC(year, month - 1, day) / dayMs; }

const springTarget = { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 };
const fallTarget = { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 };
const springMatches = matchingInstants(zone, springTarget);
const fallMatches = matchingInstants(zone, fallTarget);
assert.equal(springMatches.length, 0, 'installed Intl tzdb must expose the New York 2026 spring 02:30 gap');
assert.equal(fallMatches.length, 2, 'installed Intl tzdb must expose the New York 2026 fall 01:30 fold');
const springNext = nextValidInstant(zone, springTarget);
assert.deepEqual(localParts(localPartsFormatter(zone), springNext), { year: 2026, month: 3, day: 8, hour: 3, minute: 0, second: 0 });

function row({ sourceDay, minuteOfDay, fold, instantMs, providerRevision = 'intl-tzdb-runtime', contextRevision = `node-${process.versions.node}-icu-${process.versions.icu}-tz-${process.versions.tz ?? 'unknown'}` }) {
  return { sourceDay, slotKey: 0, minuteOfDay, fold, eventId: '', eventKind: 'civil', instantMs,
    withdrawn: false, providerRevision, contextRevision };
}
// This bounded test host resolves civil facts from the checked source policy.
// The production Rust owner validates the rows and owns admission/identity.
function resolvedRows(schedule, target) {
  let instants = matchingInstants(schedule.timezone, target);
  if (!instants.length) {
    if (schedule.dstMissing === 'skip') return [];
    assert.equal(schedule.dstMissing, 'next_valid');
    return [row({ sourceDay: sourceDay(target.year, target.month, target.day),
      minuteOfDay: target.hour * 60 + target.minute, fold: 0,
      instantMs: nextValidInstant(schedule.timezone, target) })];
  }
  const resolved = instants.map((instantMs, index) => row({
    sourceDay: sourceDay(target.year, target.month, target.day),
    minuteOfDay: target.hour * 60 + target.minute, fold: instants.length === 1 ? 0 : index + 1, instantMs }));
  if (resolved.length === 1 || schedule.dstRepeated === 'both') return resolved;
  if (schedule.dstRepeated === 'skip') return [];
  return resolved.filter(row => row.fold === (schedule.dstRepeated === 'first' ? 1 : 2));
}
function scheduleFacts(site, coverageStartMs, coverageEndMs, rows) {
  return { site, coverageStartMs, coverageEndMs, provider: null, calendar: null, rows };
}
function allScheduleFacts(sites, coverageStartMs, coverageEndMs, rowsByName = {}) {
  return Object.entries(sites).map(([name, site]) => scheduleFacts(site, coverageStartMs, coverageEndMs, rowsByName[name] ?? []));
}
function clock(monotonicMs, wallMs, { trusted = true, bootEpoch = 223 } = {}) {
  return { monotonicMs, bootEpoch, wallMs: trusted ? wallMs : null, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'clock-ref-03-039' };
}
function frame(scanId, wallMs, schedules, options = {}) {
  const nowMs = options.monotonicMs ?? scanId * 1000;
  return { scanId, nowMs, clock: clock(nowMs, wallMs, options), natural: [], settings: null, schedules };
}
function timedFrames(walls, schedules, options = {}) {
  return walls.map((wallMs, index) => frame(index, wallMs, schedules, { ...options, monotonicMs: wallMs - walls[0] }));
}
function nativeRun(compiled, activation, steps, { checkpoint = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ref-03-039-civil-dst-'));
  try {
    const modulePath = join(dir, 'module.gfb');
    const tapePath = join(dir, 'tape.json');
    writeFileSync(modulePath, compiled.bytes);
    writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, checkpoint,
      steps: steps.map((step, scanId) => ({ scanId: step.scanId ?? scanId, logicalTimeMs: step.nowMs, inputs: [],
        clock: step.clock, natural: [], settings: null, schedules: step.schedules })) }));
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `native failed ${result.status}`);
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function wasmRun(compiled, activation, steps, { checkpoint = null } = {}) {
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, compiled, { context: activation });
  try {
    if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
    return steps.map(step => {
      let accepted = true, error;
      try {
        const result = runtime.step({ nowMs: step.nowMs, contextFacts: { clock: step.clock, natural: [], settings: null, schedules: step.schedules } });
        assert.equal(result.frame.scanId, step.scanId);
      } catch (cause) { accepted = false; error = cause.message; }
      return { accepted, ...(error ? { error } : {}), outcome: structuredClone(runtime.lastFrameOutcome),
        trace: structuredClone(runtime.lastFrameOutcome?.trace), settings: runtime.contextSnapshot().state,
        checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
    });
  } finally { runtime.dispose(); }
}
async function compareNativeWasm(compiled, activation, steps, options = {}) {
  const wasmRows = await wasmRun(compiled, activation, steps, options);
  const nativeRows = nativeRun(compiled, activation, steps, options);
  assert.equal(nativeRows.length, wasmRows.length);
  nativeRows.forEach((record, index) => {
    const actual = wasmRows[index];
    assert.equal(record.accepted, actual.accepted);
    assert.deepEqual(record.accepted ? record.outcome : record.lastOutcome, actual.outcome);
    assert.deepEqual(record.settings, actual.settings);
    assert.equal(record.checkpoint, actual.checkpoint);
    if (!record.accepted) assert.match(record.error, /Cron occurrence|Fold|invalid/i);
  });
  return wasmRows;
}

test('REF-03-039 resolves New York spring gap and fall fold through Intl rows while Rust owns occurrence decisions', async () => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'))).cases.find(entry => entry.id === 'REF-03-039');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/223');
  assert.equal(original.scope, 'runtime'); assert.equal(original.status, 'specified');
  const compiled = await compileSource(source, { filename: 'ref-03-039-civil-dst.ghost.md' });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v10');
  const sites = Object.fromEntries(compiled.manifest.schedules.map(item => [item.name, item.site]));
  assert.deepEqual(compiled.manifest.schedules.map(({ name, timezone, dstMissing, dstRepeated }) => ({ name, timezone, dstMissing, dstRepeated })), [
    { name: 'gap_skip', timezone: zone, dstMissing: 'skip', dstRepeated: 'first' },
    { name: 'gap_next', timezone: zone, dstMissing: 'next_valid', dstRepeated: 'first' },
    { name: 'fold_first', timezone: zone, dstMissing: 'skip', dstRepeated: 'first' },
    { name: 'fold_second', timezone: zone, dstMissing: 'skip', dstRepeated: 'second' },
    { name: 'fold_both', timezone: zone, dstMissing: 'skip', dstRepeated: 'both' },
    { name: 'fold_skip', timezone: zone, dstMissing: 'skip', dstRepeated: 'skip' },
  ]);
  const activation = { bootEpoch: 223, terminalCapacity: 64, bindings: [] };
  const springDay = sourceDay(2026, 3, 8);
  const fallDay = sourceDay(2026, 11, 1);
  const springRow = row({ sourceDay: springDay, minuteOfDay: 150, fold: 0, instantMs: springNext });
  const firstRow = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 1, instantMs: fallMatches[0] });
  const secondRow = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 2, instantMs: fallMatches[1] });
  assert.ok(fallMatches[0] < fallMatches[1]);
  const springResolved = Object.fromEntries(compiled.manifest.schedules.filter(schedule => schedule.name.startsWith('gap_'))
    .map(schedule => [schedule.name, resolvedRows(schedule, springTarget)]));
  assert.deepEqual(springResolved, { gap_skip: [], gap_next: [springRow] });
  const springSchedules = allScheduleFacts(sites, springNext - 120_000, springNext + 120_000, springResolved);
  const springRows = await compareNativeWasm(compiled, activation,
    timedFrames([springNext - 1, springNext, springNext + minuteMs], springSchedules));
  assert.ok(springRows.every(row => row.accepted));
  assert.deepEqual(springRows.map(row => row.trace.safe.gap_skip_due), [false, false, false]);
  assert.deepEqual(springRows.map(row => row.trace.safe.gap_next_due), [false, true, false]);
  const springDue = springRows[1].trace.contextTrace.find(entry => entry.site === sites.gap_next && entry.decision === 'Due');
  assert.equal(springDue.occurrenceId, `${springDay}:150:0`);
  assert.equal(springDue.plannedWallMs, springNext);

  const foldResolved = Object.fromEntries(compiled.manifest.schedules.filter(schedule => schedule.name.startsWith('fold_'))
    .map(schedule => [schedule.name, resolvedRows(schedule, fallTarget)]));
  assert.deepEqual(foldResolved, { fold_first: [firstRow], fold_second: [secondRow], fold_both: [firstRow, secondRow], fold_skip: [] });
  const foldSchedules = allScheduleFacts(sites, fallMatches[0] - 120_000, fallMatches[1] + 120_000, foldResolved);
  const foldFrames = timedFrames([fallMatches[0] - 1, fallMatches[0], fallMatches[1] - 1,
    fallMatches[1], fallMatches[1] + minuteMs], foldSchedules);
  const foldRows = await compareNativeWasm(compiled, activation, foldFrames);
  assert.ok(foldRows.every(row => row.accepted));
  assert.deepEqual(foldRows.map(row => row.trace.safe.fold_first_due), [false, true, false, false, false]);
  assert.deepEqual(foldRows.map(row => row.trace.safe.fold_second_due), [false, false, false, true, false]);
  assert.deepEqual(foldRows.map(row => row.trace.safe.fold_both_due), [false, true, false, true, false]);
  assert.deepEqual(foldRows.map(row => row.trace.safe.fold_skip_due), [false, false, false, false, false]);
  const bothDue = foldRows.flatMap(row => (row.trace.contextTrace ?? []).filter(entry => entry.site === sites.fold_both && entry.decision === 'Due'));
  assert.deepEqual(bothDue.map(entry => entry.occurrenceId), [`${fallDay}:90:1`, `${fallDay}:90:2`]);
  assert.notEqual(bothDue[0].occurrenceId, bothDue[1].occurrenceId);
  assert.deepEqual(bothDue.map(entry => entry.plannedWallMs), fallMatches);
  assert.deepEqual(await compareNativeWasm(compiled, activation, foldFrames), foldRows,
    'fresh replay preserves complete outcomes, settings and checkpoints');

  const replayRows = await compareNativeWasm(compiled, { ...activation, bootEpoch: 224 },
    timedFrames([fallMatches[0] - 1, fallMatches[0], fallMatches[1]], foldSchedules, { bootEpoch: 224 }),
    { checkpoint: foldRows[3].checkpoint });
  assert.ok(replayRows.every(row => row.accepted));
  assert.deepEqual(replayRows.map(row => [row.trace.safe.fold_first_due, row.trace.safe.fold_second_due, row.trace.safe.fold_both_due]),
    [[false, false, false], [false, false, false], [false, false, false]], 'restored terminal identities prevent occurrence replay');
});

test('REF-03-039 rejects malformed civil rows atomically so retry can still consume the occurrence once', async () => {
  const compiled = await compileSource(source, { filename: 'ref-03-039-civil-dst.ghost.md' });
  const sites = Object.fromEntries(compiled.manifest.schedules.map(item => [item.name, item.site]));
  const activation = { bootEpoch: 223, terminalCapacity: 64, bindings: [] };
  const fallDay = sourceDay(2026, 11, 1);
  const valid = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 1, instantMs: fallMatches[0] });
  const second = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 2, instantMs: fallMatches[1] });
  const start = fallMatches[0] - 120_000, end = fallMatches[1] + 120_000;
  const baseline = frame(0, fallMatches[0] - 1, allScheduleFacts(sites, start, end));
  const goodSchedules = allScheduleFacts(sites, start, end, { fold_both: [valid] });
  for (const [name, illegal] of [['fold_first', second], ['fold_second', valid], ['fold_skip', valid]]) {
    const bad = frame(1, fallMatches[0], allScheduleFacts(sites, start, end, { fold_both: [valid], [name]: [illegal] }));
    const retry = { ...frame(1, fallMatches[0], goodSchedules), nowMs: 2000, clock: clock(2000, fallMatches[0]) };
    const duplicate = { ...frame(2, fallMatches[0], goodSchedules), nowMs: 3000, clock: clock(3000, fallMatches[0]) };
    const actual = await compareNativeWasm(compiled, activation, [baseline, bad, retry, duplicate]);
    assert.deepEqual(actual.map(row => row.accepted), [true, false, true, true], name);
    assert.match(actual[1].error, /Cron occurrence|Fold|context|invalid/i);
    for (const field of ['outcome', 'settings', 'checkpoint']) assert.deepEqual(actual[1][field], actual[0][field], `${name}: rejected ${field} unchanged`);
    assert.equal(actual[2].trace.safe.fold_both_due, true);
    assert.equal(actual[2].trace.contextTrace.find(entry => entry.site === sites.fold_both && entry.decision === 'Due').occurrenceId, `${fallDay}:90:1`);
    assert.equal(actual[3].trace.safe.fold_both_due, false);
    const replay = await compareNativeWasm(compiled, activation, [baseline, retry, duplicate]);
    assert.deepEqual(actual.slice(2), replay.slice(1), `${name}: valid retry equals clean complete replay`);
  }
});
