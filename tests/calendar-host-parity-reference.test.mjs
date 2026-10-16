import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { createHolidayCalendar, createWorkCalendar, composeCalendar, calendarEpochDay } from '../runtimes/node/calendar.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = resolve(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : ''));
const dayMs = 86_400_000;
const minuteMs = 60_000;
const zone = 'America/New_York';
const nodeTzRevision = `node-${process.versions.node}-icu-${process.versions.icu}-tz-${process.versions.tz ?? 'unknown'}`;

execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'context_tape'],
  { cwd: root, stdio: 'inherit' });
const wasmBytes = readFileSync(wasmPath);

const source = `# REF-08-013 calendar and DST host parity

Issue [#330](https://github.com/callin2/ghostflow-language/issues/330) / REF-08-013: 달력·DST 제공자는 §3의 명시 정책과 동일한 occurrence 결과를 공급한다.

- Given: 같은 Program, 날짜·zone·tzdb·calendar revision 및 gap/fold 정책을 두 host에 준다.
- When: 같은 시간 snapshot으로 예약 발생을 평가한다.
- Then: 두 host의 occurrence identity와 due/Unknown가 같다. 인터넷 연결 여부가 의미를 바꾸지 않는다.

\`\`\`ghost
control CalendarHostParityReference {
  calendar workers: WorkCalendar;

  schedule gap_next: Cron {
    timezone = "America/New_York";
    at = cron5\`30 2 8 3 *\`;
    dst_missing = next_valid;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(1h);
    recovery = baseline;
    fallback = skip;
  }

  schedule fold_both: Cron {
    timezone = "America/New_York";
    at = cron5\`30 1 1 11 *\`;
    dst_missing = skip;
    dst_repeated = both;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(1h);
    recovery = baseline;
    fallback = skip;
  }

  schedule work_open: Daily {
    timezone = "UTC";
    at = time\`00:00\`;
    on = day\`workday\`;
    calendar = workers;
    dst_missing = skip;
    dst_repeated = first;
    basis = range(15min);
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(1h);
    recovery = baseline;
    fallback = skip;
  }

  let workday_now = calendar_is(workers, day\`workday\`);
  output gap_due, fold_due, work_active, workday_known: Bool;
  gap_due <- gap_next.due;
  fold_due <- fold_both.due;
  work_active <- work_open.active;
  workday_known <- case workday_now { ok(value) => value; fault(_) => false; };
}
\`\`\``;

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
  for (const key of ['year', 'month', 'day', 'hour', 'minute', 'second']) if (a[key] !== b[key]) return a[key] - b[key];
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
function row({ sourceDay, minuteOfDay, fold, instantMs, providerRevision = nodeTzRevision, contextRevision = nodeTzRevision }) {
  return { sourceDay, slotKey: 0, minuteOfDay, fold, eventId: '', eventKind: 'civil', instantMs,
    withdrawn: false, providerRevision, contextRevision };
}
function date(value) { return Date.parse(value); }
function calendarSnapshot(restDay = false) {
  const nowMs = date('2026-09-01T00:00:00Z');
  const base = createHolidayCalendar({ calendarId: 'ref-08-013-dates', timezone: 'UTC',
    coveredFromDate: '2026-10-01', coveredToDateExclusive: '2026-10-04', expiresAtMs: date('2026-10-04T00:00:00Z'),
    holidays: [], datasetVersion: 'fixture-ref-08-013-not-official-holidays', nowMs,
    sources: [{ id: 'fixture', url: 'https://example.org/ghostflow/ref-08-013-fixture', publishedOn: '2026-09-01', reviewedOn: '2026-09-01' }] });
  const work = createWorkCalendar({ calendarId: 'ref-08-013-work-base', base, weeklyWorkMask: 127, holidayPolicy: 'off', nowMs });
  return composeCalendar(work, { calendarId: 'workers', timezone: 'UTC', nowMs,
    workdayOverrides: restDay ? [{ date: '2026-10-02', class: 'off', reason: 'bounded fixture rest day' }] : [] }).snapshot;
}
function clock(monotonicMs, wallMs, { trusted = true, bootEpoch = 330 } = {}) {
  return { monotonicMs, bootEpoch, wallMs: trusted ? wallMs : null, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'ref-08-013-clock' };
}
function scheduleFact(site, coverageStartMs, coverageEndMs, rows = [], calendar = null) {
  return { site, coverageStartMs, coverageEndMs, provider: null, calendar, rows };
}
function facts(compiled, { mono, wall, rowsByName = {}, calendar = null, trusted = true, bootEpoch = 330, omitCalendarCondition = false }) {
  const schedules = compiled.manifest.schedules.map(schedule => scheduleFact(schedule.site, 0, 253402300799999,
    rowsByName[schedule.name] ?? [], schedule.day?.calendar ? calendar : null));
  if (!omitCalendarCondition) {
    for (const condition of compiled.manifest.calendarConditions ?? []) {
      schedules.push(scheduleFact(condition.site, 0, 253402300799999, [], calendar));
    }
  }
  return { clock: clock(mono, wall, { trusted, bootEpoch }), natural: [], settings: null, schedules };
}
function frame(compiled, scanId, mono, wall, options = {}) {
  return { scanId, nowMs: mono, contextFacts: facts(compiled, { mono, wall, ...options }) };
}
function nativeRun(compiled, activation, steps, { checkpoint = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ref-08-013-calendar-host-parity-'));
  try {
    const modulePath = join(dir, 'module.gfb');
    const tapePath = join(dir, 'tape.json');
    writeFileSync(modulePath, compiled.bytes);
    writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-calendar-v1', activation, checkpoint,
      steps: steps.map(step => ({ scanId: step.scanId, logicalTimeMs: step.nowMs, inputs: [], ...step.contextFacts })) }));
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
        const result = runtime.step({ nowMs: step.nowMs, contextFacts: step.contextFacts });
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
    assert.equal(record.accepted, actual.accepted, `accepted parity scan ${index}`);
    if (record.accepted) assert.deepEqual(record.outcome, actual.outcome, `full outcome parity scan ${index}`);
    else {
      assert.ok(Object.hasOwn(record, 'lastOutcome'), 'rejected native receipt must expose its committed outcome');
      assert.deepEqual(record.lastOutcome, actual.outcome, `rejected last outcome parity scan ${index}`);
    }
    assert.ok(Object.hasOwn(record, 'settings'), 'native receipt must expose complete production context state');
    assert.deepEqual(record.settings, actual.settings, `settings parity scan ${index}`);
    assert.equal(record.checkpoint, actual.checkpoint, `checkpoint parity scan ${index}`);
  });
  return wasmRows;
}

const springTarget = { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 };
const fallTarget = { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 };
const springNext = nextValidInstant(zone, springTarget);
const fallMatches = matchingInstants(zone, fallTarget);
assert.equal(matchingInstants(zone, springTarget).length, 0, 'installed Intl tzdb must expose the New York 2026 spring 02:30 gap');
assert.equal(fallMatches.length, 2, 'installed Intl tzdb must expose the New York 2026 fall 01:30 fold');

async function compileReference() {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/03-settings-boundaries.json'), 'utf8')).cases.find(entry => entry.id === 'REF-08-013');
  assert.deepEqual({ issue: original.issue, rule: original.rule, given: original.given, when: original.when, then: original.then }, {
    issue: 'https://github.com/callin2/ghostflow-language/issues/330',
    rule: '달력·DST 제공자는 §3의 명시 정책과 동일한 occurrence 결과를 공급한다.',
    given: '같은 Program, 날짜·zone·tzdb·calendar revision 및 gap/fold 정책을 두 host에 준다.',
    when: '같은 시간 snapshot으로 예약 발생을 평가한다.',
    then: '두 host의 occurrence identity와 due/Unknown가 같다. 인터넷 연결 여부가 의미를 바꾸지 않는다.',
  });
  const compiled = await compileSource(source, { filename: 'ref-08-013-calendar-host-parity.ghost.md' });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v18');
  assert.deepEqual(compiled.manifest.calendars, [{ name: 'workers', type: 'WorkCalendar' }]);
  assert.deepEqual(compiled.manifest.schedules.map(({ name, timezone, dstMissing, dstRepeated, day }) => ({ name, timezone, dstMissing, dstRepeated, day })), [
    { name: 'gap_next', timezone: zone, dstMissing: 'next_valid', dstRepeated: 'first', day: undefined },
    { name: 'fold_both', timezone: zone, dstMissing: 'skip', dstRepeated: 'both', day: undefined },
    { name: 'work_open', timezone: 'UTC', dstMissing: 'skip', dstRepeated: 'first', day: { kind: 'workday', calendar: 'workers' } },
  ]);
  assert.equal(compiled.manifest.calendarConditions[0].calendar, 'workers');
  return compiled;
}

function activationFromManifest(compiled) {
  assert.equal(compiled.manifest.calendars[0].name, 'workers');
  return { bootEpoch: 330, terminalCapacity: 64, bindings: [{ kind: 'calendar', provider: compiled.manifest.calendars[0].name,
    namespace: 'ref-08-013', station: 'virtual', bindingRevision: 'utc-calendar-v1', location: 'virtual',
    timezone: 'UTC', criteria: 'calendar', maxUncertaintyMs: 0 }] };
}

test('REF-08-013 compares native Rust context owner and framed WASM with identical manifest-derived DST and calendar facts', async () => {
  const compiled = await compileReference();
  const activation = activationFromManifest(compiled);
  const sites = Object.fromEntries(compiled.manifest.schedules.map(item => [item.name, item.site]));
  const querySite = compiled.manifest.calendarConditions[0].site;
  const springDay = sourceDay(2026, 3, 8);
  const fallDay = sourceDay(2026, 11, 1);
  const snapshot = calendarSnapshot(false);
  const springRow = row({ sourceDay: springDay, minuteOfDay: 150, fold: 0, instantMs: springNext });
  const firstFold = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 1, instantMs: fallMatches[0] });
  const secondFold = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 2, instantMs: fallMatches[1] });
  assert.equal(springRow.providerRevision, nodeTzRevision);
  assert.equal(snapshot.calendarId, 'workers');
  assert.equal(snapshot.timezone, 'UTC');
  assert.match(snapshot.revision, /^sha256:/);

  const steps = [
    frame(compiled, 0, 0, springNext - 1, { calendar: snapshot, rowsByName: { gap_next: [springRow] } }),
    frame(compiled, 1, 1000, springNext, { calendar: snapshot, rowsByName: { gap_next: [springRow] } }),
    frame(compiled, 2, 2000, date('2026-10-01T00:00:00Z'), { calendar: snapshot }),
    frame(compiled, 3, 3000, date('2026-10-02T00:00:00Z'), { calendar: null }),
  ];
  assert.deepEqual(steps[0].contextFacts.schedules.map(item => item.site), [sites.gap_next, sites.fold_both, sites.work_open, querySite]);
  const rows = await compareNativeWasm(compiled, activation, steps);
  assert.ok(rows.every(row => row.accepted));
  assert.deepEqual(rows.map(row => row.trace.safe), [
    { gap_due: false, fold_due: false, work_active: false, workday_known: false },
    { gap_due: true, fold_due: false, work_active: false, workday_known: false },
    { gap_due: false, fold_due: false, work_active: true, workday_known: true },
    { gap_due: false, fold_due: false, work_active: true, workday_known: false },
  ]);
  const gapDue = rows[1].trace.contextTrace.find(entry => entry.site === sites.gap_next && entry.decision === 'Due');
  assert.deepEqual({ occurrenceId: gapDue.occurrenceId, plannedWallMs: gapDue.plannedWallMs, providerRevision: gapDue.providerRevision, contextRevision: gapDue.contextRevision },
    { occurrenceId: `${springDay}:150:0`, plannedWallMs: springNext, providerRevision: nodeTzRevision, contextRevision: nodeTzRevision });
  const missingCalendar = rows[3].trace.contextTrace.find(entry => entry.site === querySite);
  assert.equal(missingCalendar.decision, 'Fault(CalendarMissing)');
  assert.equal(missingCalendar.unknownReason, 'Fault(CalendarMissing)');
  assert.equal(missingCalendar.providerRevision, '');
  const knownCalendar = rows[2].trace.contextTrace.find(entry => entry.site === querySite);
  assert.equal(knownCalendar.providerRevision, snapshot.revision, 'actual calendar content revision reaches the production observation');
  assert.deepEqual(await compareNativeWasm(compiled, activation, steps), rows, 'fresh independent initialization preserves full native/framed-WASM outcomes, settings and checkpoint bytes');

  const foldSteps = [
    frame(compiled, 0, 0, fallMatches[0] - 1, { calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } }),
    frame(compiled, 1, 1000, fallMatches[0], { calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } }),
    frame(compiled, 2, 2000, fallMatches[1], { calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } }),
  ];
  const foldRows = await compareNativeWasm(compiled, activation, foldSteps);
  const foldDue = foldRows.flatMap(row => row.trace.contextTrace.filter(entry => entry.site === sites.fold_both && entry.decision === 'Due'));
  assert.deepEqual(foldDue.map(entry => [entry.occurrenceId, entry.plannedWallMs, entry.providerRevision]), [
    [`${fallDay}:90:1`, fallMatches[0], nodeTzRevision],
    [`${fallDay}:90:2`, fallMatches[1], nodeTzRevision],
  ]);

  const replay = await compareNativeWasm(compiled, { ...activation, bootEpoch: 331 }, [
    frame(compiled, 0, 0, fallMatches[0], { bootEpoch: 331, calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } }),
    frame(compiled, 1, 1000, fallMatches[1], { bootEpoch: 331, calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } }),
  ], { checkpoint: foldRows[2].checkpoint });
  assert.deepEqual(replay.map(row => row.trace.safe.fold_due), [false, false], 'restored terminal identities prevent duplicate replay');
});

test('REF-08-013 supplied pinned evidence yields identical complete host receipts with fetch unavailable and unknown clock recovery', async () => {
  const compiled = await compileReference(), activation = activationFromManifest(compiled);
  const snapshot = calendarSnapshot(false), fallDay = sourceDay(2026, 11, 1);
  const firstFold = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 1, instantMs: fallMatches[0] });
  const secondFold = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 2, instantMs: fallMatches[1] });
  const rowsByName = { fold_both: [firstFold, secondFold] };
  const steps = [
    frame(compiled, 0, 0, fallMatches[0] - 1, { calendar: snapshot, rowsByName }),
    frame(compiled, 1, 1000, fallMatches[0], { calendar: snapshot, rowsByName, trusted: false }),
    frame(compiled, 2, 2000, fallMatches[0], { calendar: snapshot, rowsByName }),
    frame(compiled, 3, 3_602_000, fallMatches[1], { calendar: snapshot, rowsByName }),
  ];
  const available = await compareNativeWasm(compiled, activation, steps);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = () => { fetchCalls++; throw Error('network unavailable in bounded reference host'); };
    assert.deepEqual(await compareNativeWasm(compiled, activation, steps), available,
      'provider acquisition availability cannot alter execution of identical complete pinned facts');
  } finally { globalThis.fetch = previousFetch; }
  assert.equal(fetchCalls, 0, 'no internet acquisition path executes');
  const foldSite = compiled.manifest.schedules.find(item => item.name === 'fold_both').site;
  const rangeSite = compiled.manifest.schedules.find(item => item.name === 'work_open').site;
  const unknown = available[1].trace.contextTrace.find(entry => entry.site === rangeSite);
  assert.equal(unknown.decision, 'Unknown(ClockUnknown)');
  assert.equal(unknown.occurrenceId, '');
  assert.equal(unknown.plannedWallMs, null);
  assert.equal(unknown.providerRevision, snapshot.revision);
  const queryUnknown = available[1].trace.contextTrace.find(entry => entry.site === compiled.manifest.calendarConditions[0].site);
  assert.equal(queryUnknown.decision, 'Fault(ClockUnknown)');
  assert.equal(available[1].trace.safe.fold_due, false);
  assert.equal(available[2].trace.safe.fold_due, false, 'authored recovery=baseline establishes a new baseline without catching up the first fold');
  assert.equal(available[3].trace.safe.fold_due, true);
  assert.equal(available[3].trace.contextTrace.find(entry => entry.site === foldSite && entry.decision === 'Due').occurrenceId, `${fallDay}:90:2`);
});

test('REF-08-013 rejects malformed context atomically and a valid retry matches clean replay', async () => {
  const compiled = await compileReference();
  const activation = activationFromManifest(compiled);
  const sites = Object.fromEntries(compiled.manifest.schedules.map(item => [item.name, item.site]));
  const fallDay = sourceDay(2026, 11, 1);
  const snapshot = calendarSnapshot(false);
  const firstFold = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 1, instantMs: fallMatches[0] });
  const secondFold = row({ sourceDay: fallDay, minuteOfDay: 90, fold: 2, instantMs: fallMatches[1] });
  const baseline = frame(compiled, 0, 0, fallMatches[0] - 1, { calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } });
  const malformed = frame(compiled, 1, 1000, fallMatches[0], { calendar: snapshot,
    rowsByName: { fold_both: [{ ...firstFold, fold: 0 }, secondFold] }, omitCalendarCondition: true });
  const retry = frame(compiled, 1, 2000, fallMatches[0], { calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } });
  const duplicate = frame(compiled, 2, 3000, fallMatches[0] + minuteMs, { calendar: snapshot, rowsByName: { fold_both: [firstFold, secondFold] } });
  const actual = await compareNativeWasm(compiled, activation, [baseline, malformed, retry, duplicate]);
  assert.deepEqual(actual.map(row => row.accepted), [true, false, true, true]);
  assert.match(actual[1].error, /Cron occurrence|Fold|context|invalid/i);
  for (const field of ['outcome', 'settings', 'checkpoint']) assert.deepEqual(actual[1][field], actual[0][field], `rejected ${field} unchanged`);
  assert.equal(actual[2].trace.safe.fold_due, true);
  assert.equal(actual[2].trace.contextTrace.find(entry => entry.site === sites.fold_both && entry.decision === 'Due').occurrenceId, `${fallDay}:90:1`);
  assert.equal(actual[3].trace.safe.fold_due, false);
  const clean = await compareNativeWasm(compiled, activation, [baseline, retry, duplicate]);
  assert.deepEqual(actual.slice(2), clean.slice(1));
});
