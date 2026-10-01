import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { encode } from '@toon-format/toon';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { createHolidayCalendar, createWorkCalendar, composeCalendar, calendarEpochDay } from '../runtimes/node/calendar.mjs';

const source = (at = '23:45', length = '15min') => `# Reference calendar boundary

\`\`\`ghost
control CalendarBoundary {
  calendar workers: WorkCalendar;
  schedule work: Daily {
    timezone = "UTC";
    at = time\`${at}\`;
    on = day\`workday\`;
    calendar = workers;
    dst_missing = skip;
    dst_repeated = first;
    basis = range(${length});
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(30min);
    recovery = baseline;
    fallback = skip;
  }
  let working = calendar_is(workers, day\`workday\`);
  output active, permitted_rest: Bool;
  active <- work.active;
  permitted_rest <- case working { ok(value) => !value; fault(_) => false; };
}
\`\`\`
`;

test('REF-03-041: adopted calendar Result and same-day Range compile as executable GFB18', async () => {
  const artifact = await compileSource(source(), { filename: 'calendar-boundary.ghost.md' });
  assert.equal(artifact.bytes.readUInt16LE(4), 18);
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v18');
});

export { source };

const root = fileURLToPath(new URL('..', import.meta.url));
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [{ kind: 'calendar', provider: 'workers',
  namespace: 'reference-225', station: 'virtual', bindingRevision: 'utc-calendar-v1',
  location: 'virtual', timezone: 'UTC', criteria: 'calendar', maxUncertaintyMs: 0 }] };
const date = value => Date.parse(value);
const now = date('2026-09-01T00:00:00Z');
function calendar(restDay = true) {
  const base = createHolidayCalendar({ calendarId: 'dates', timezone: 'UTC', coveredFromDate: '2026-10-01', coveredToDateExclusive: '2026-10-03',
    expiresAtMs: date('2026-10-03T00:00:00Z'), holidays: [], datasetVersion: 'synthetic-225', nowMs: now,
    sources: [{ id: 'test', url: 'https://example.org/calendar-test', publishedOn: '2026-09-01', reviewedOn: '2026-09-01' }] });
  const workers = createWorkCalendar({ calendarId: 'work-base', base, weeklyWorkMask: 127, holidayPolicy: 'off', nowMs: now });
  return composeCalendar(workers, { calendarId: 'workers', timezone: 'UTC', nowMs: now,
    workdayOverrides: restDay ? [{ date: '2026-10-02', class: 'off', reason: 'Synthetic rest day' }] : [] });
}
function facts(artifact, mono, wall, snapshot, trusted = true) {
  const sites = [...artifact.manifest.schedules, ...(artifact.manifest.calendarConditions ?? [])];
  return { clock: { monotonicMs: mono, bootEpoch: 1, wallMs: wall, uncertaintyMs: 0, trusted,
    unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'reference-225-clock' }, natural: [], settings: null,
  schedules: sites.map(item => ({ site: item.site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: item.calendar || item.day?.calendar ? snapshot : null, rows: [] })) };
}
const wasm = () => readFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));

async function parity(artifact, steps, expected) {
  const directory = mkdtempSync(resolve(tmpdir(), 'ghostflow-reference-225-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm(), artifact, { context: activation });
  const plain = await ControlRuntime.instantiate(wasm(), artifact, { context: activation });
  try {
    const artifactPath = resolve(directory, 'calendar.gfb');
    writeArtifact(artifact, artifactPath);
    const frames = steps.map((step, scanId) => ({ scanId, logicalTimeMs: step.mono, inputs: [],
      ...facts(artifact, step.mono, step.wall, step.snapshot, step.trusted ?? true) }));
    const tapePath = resolve(directory, 'calendar.json');
    writeFileSync(tapePath, JSON.stringify({ profile: 'context-calendar-v1', activation, steps: frames }));
    const native = spawnSync(resolve(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`), [artifactPath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout || native.error?.message);
    const rows = native.stdout.trim().split('\n').map(row => JSON.parse(row));
    const traces = steps.map(step => runtime.step({ nowMs: step.mono,
      contextFacts: facts(artifact, step.mono, step.wall, step.snapshot, step.trusted ?? true) }).vm);
    const plainTraces = steps.map(step => plain.step({ nowMs: step.mono,
      contextFacts: facts(artifact, step.mono, step.wall, step.snapshot, step.trusted ?? true) }).vm);
    assert.deepEqual(traces.map(trace => trace.safe), expected);
    rows.forEach((row, index) => {
      assert.equal(row.accepted, true, JSON.stringify(row));
      assert.deepEqual(row.outcome.trace, traces[index], `native/framed WASM scan ${index}`);
      assert.deepEqual(plainTraces[index].safe, traces[index].safe, `plain/framed WASM outputs scan ${index}`);
      assert.deepEqual(plainTraces[index].contextTrace, traces[index].contextTrace, `plain/framed WASM context scan ${index}`);
    });
    const scenarioPath = resolve(directory, 'calendar.toon');
    writeFileSync(scenarioPath, encode({ format: 'GhostFlow/scenario-v1', id: 'reference-225', initialInputs: [], keyBindings: [],
      context: activation, actions: steps.map(step => ({ kind: 'scan', atMs: step.mono,
        contextFacts: facts(artifact, step.mono, step.wall, step.snapshot, step.trusted ?? true) })) }));
    const simulation = runScenario(artifactPath, scenarioPath, { format: 'json' });
    assert.equal(simulation.success, true, simulation.encoded);
    const scans = JSON.parse(simulation.encoded).scans;
    assert.deepEqual(scans.map(scan => scan.safeVirtualIntent), expected);
    scans.forEach((scan, index) => assert.deepEqual(scan.contextTrace, traces[index].contextTrace, `simulation/framed WASM context ${index}`));
    return traces;
  } finally {
    runtime.dispose(); plain.dispose(); rmSync(directory, { recursive: true, force: true });
  }
}

test('REF-03-041: work calendar intervals reject crossing midnight and accept an explicit split', async () => {
  await assert.rejects(() => compileSource(source('23:45', '30min')), /split overnight intervals/);
  const original = source();
  const block = original.match(/  schedule work: Daily \{[\s\S]*?\n  \}/)[0];
  const second = block.replace('schedule work:', 'schedule following:').replace('23:45', '00:00');
  const artifact = await compileSource(original.replace(block, `${block}\n${second}`).replace('active <- work.active;', 'active <- work.active || following.active;'));
  const snapshot = calendar().snapshot;
  const traces = await parity(artifact, [
    { mono: 0, wall: date('2026-10-01T23:44:59Z'), snapshot },
    { mono: 1000, wall: date('2026-10-01T23:45:00Z'), snapshot },
    { mono: 901000, wall: date('2026-10-02T00:00:00Z'), snapshot },
  ], [{ active: false, permitted_rest: false }, { active: true, permitted_rest: false }, { active: false, permitted_rest: true }]);
  assert.equal(traces[1].contextTrace.find(row => row.site === artifact.manifest.calendarConditions[0].site).providerRevision, snapshot.revision);
  const workBothDates = calendar(false).snapshot;
  const positiveSplit = await parity(artifact, [
    { mono: 0, wall: date('2026-10-01T23:44:59Z'), snapshot: workBothDates },
    { mono: 1000, wall: date('2026-10-01T23:45:00Z'), snapshot: workBothDates },
    { mono: 901000, wall: date('2026-10-02T00:00:00Z'), snapshot: workBothDates },
    { mono: 1801000, wall: date('2026-10-02T00:15:00Z'), snapshot: workBothDates },
  ], [{ active: false, permitted_rest: false }, { active: true, permitted_rest: false },
    { active: true, permitted_rest: false }, { active: false, permitted_rest: false }]);
  const midnight = positiveSplit[2].contextTrace;
  const firstSite = artifact.manifest.schedules[0].site;
  const secondSite = artifact.manifest.schedules[1].site;
  assert.deepEqual(midnight.filter(row => [firstSite, secondSite].includes(row.site)).map(row => ({ site: row.site,
    occurrence: row.occurrenceId, decision: row.decision, plannedMs: row.plannedWallMs, revision: row.providerRevision })), [
    { site: firstSite, occurrence: `${firstSite}:${calendarEpochDay('2026-10-01')}:1`, decision: 'Completed', plannedMs: date('2026-10-01T23:45:00Z'), revision: workBothDates.revision },
    { site: secondSite, occurrence: `${secondSite}:${calendarEpochDay('2026-10-02')}:1`, decision: 'Due', plannedMs: date('2026-10-02T00:00:00Z'), revision: workBothDates.revision },
  ]);
});

test('REF-03-041: actual coverage boundaries preserve Unknown and explicit Result fallback forbids rest permission', async () => {
  const artifact = await compileSource(source('00:00', '15min'));
  const snapshot = calendar().snapshot;
  for (const [wall, supplied, trusted, fault, expectedRest] of [
    [date('2026-09-30T23:59:59Z'), snapshot, true, 'CalendarOutOfRange', false],
    [date('2026-10-01T00:00:00Z'), snapshot, true, null, false],
    [date('2026-10-02T00:00:00Z'), snapshot, true, null, true],
    [date('2026-10-03T00:00:00Z'), { ...snapshot, expiresAtMs: date('2026-10-04T00:00:00Z') }, true, 'CalendarOutOfRange', false],
    [date('2026-10-01T00:00:00Z'), null, true, 'CalendarMissing', false],
    [date('2026-10-01T00:00:00Z'), { ...snapshot, expiresAtMs: date('2026-10-01T00:00:00Z') }, true, 'CalendarOutOfRange', false],
    [date('2026-10-01T00:00:00Z'), snapshot, false, 'ClockUnknown', false],
  ]) {
    const traces = await parity(artifact, [{ mono: 0, wall, snapshot: supplied, trusted }], [{ active: fault === null && !expectedRest, permitted_rest: expectedRest }]);
    if (fault) assert.match(traces[0].contextTrace.find(row => row.site === artifact.manifest.calendarConditions[0].site).decision, new RegExp(fault));
  }
  await assert.rejects(() => compileSource(source().replace('case working { ok(value) => !value; fault(_) => false; }', '!working')),
    error => !/unknown function/.test(error.message) && /Bool|Result/.test(error.message));
});

// The range itself has no calendar filter: only the authored negation guard
// decides admission. This separates Unknown handling from day-rule filtering.
const negatedAdmissionSource = () => source('00:00', '1min')
  .replace('    on = day`workday`;\n    calendar = workers;\n', '')
  .replace('when = true;', 'when = permitted;')
  .replace('  let working =', '  let permitted = case working { ok(value) => !value; fault(_) => false; };\n  let working =');

test('REF-07-005: direct calendar Result negation cannot type-check as admission permission', async () => {
  const guarded = negatedAdmissionSource();
  const artifact = await compileSource(guarded, { filename: 'unknown-negation-admission.ghost.md' });
  assert.equal(artifact.manifest.calendarConditions[0].calendar, 'workers');
  for (const [condition, diagnostic] of [['!working', /! requires Bool/], ['working', /Daily when must be Bool/]]) {
    await assert.rejects(() => compileSource(guarded.replace('when = permitted;', `when = ${condition};`)),
      error => !/unknown function/.test(error.message) && diagnostic.test(error.message));
  }
});

test('REF-07-005: Unknown calendar negation preserves its reason and cannot admit a Range across native WASM and simulation', async () => {
  const artifact = await compileSource(negatedAdmissionSource(), { filename: 'unknown-negation-admission.ghost.md' });
  const snapshot = calendar().snapshot;
  const querySite = artifact.manifest.calendarConditions[0].site;
  const scheduleSite = artifact.manifest.schedules[0].site;
  for (const [label, day, supplied, trusted, fault, allowed] of [
    ['known working day', '2026-10-01', snapshot, true, null, false],
    ['known rest day', '2026-10-02', snapshot, true, null, true],
    ['missing calendar', '2026-10-01', null, true, 'CalendarMissing', false],
    ['before coverage', '2026-09-30', snapshot, true, 'CalendarOutOfRange', false],
    ['after coverage', '2026-10-03', { ...snapshot, expiresAtMs: date('2026-10-04T00:00:00Z') }, true, 'CalendarOutOfRange', false],
    ['expired calendar', '2026-10-01', { ...snapshot, expiresAtMs: date('2026-10-01T00:00:00Z') }, true, 'CalendarOutOfRange', false],
    ['untrusted clock', '2026-10-01', snapshot, false, 'ClockUnknown', false],
  ]) {
    const start = date(`${day}T00:00:00Z`);
    const traces = await parity(artifact, [
      { mono: 0, wall: start - 1000, snapshot: supplied, trusted },
      { mono: 1000, wall: start, snapshot: supplied, trusted },
    ], [{ active: false, permitted_rest: label === 'after coverage' }, { active: allowed, permitted_rest: allowed }]);
    const query = traces[1].contextTrace.find(row => row.site === querySite);
    const admission = traces[1].contextTrace.find(row => row.site === scheduleSite);
    assert.equal(query.decision, fault ? `Fault(${fault})` : `Ok(${!allowed})`, label);
    assert.equal(admission.decision, allowed ? 'Due' : trusted ? 'Waiting' : 'Unknown(ClockUnknown)', JSON.stringify({ label, query, admission }));
    if (allowed) {
      assert.equal(admission.occurrenceId, `${scheduleSite}:${calendarEpochDay(day)}:1`);
      assert.equal(admission.plannedWallMs, start);
    }
  }
});

test('REF-07-004: serialized calendar Unknown retains reason revision and query identity separately from normal false', async () => {
  const artifact = await compileSource(source('00:00', '15min'));
  const snapshot = calendar().snapshot;
  const querySite = artifact.manifest.calendarConditions[0].site;
  for (const [trusted, supplied, decision] of [
    [true, snapshot, 'Ok(false)'],
    [true, null, 'Fault(CalendarMissing)'],
    [false, snapshot, 'Fault(ClockUnknown)'],
  ]) {
    const [trace] = await parity(artifact, [{ mono: 0, wall: date('2026-10-02T00:00:00Z'), snapshot: supplied, trusted }],
      [{ active: false, permitted_rest: decision === 'Ok(false)' }]);
    const serialized = JSON.parse(JSON.stringify(trace));
    assert.equal(serialized.module, trace.module);
    assert.deepEqual(serialized.contextTrace, trace.contextTrace);
    const query = serialized.contextTrace.find(row => row.site === querySite);
    assert.equal(query.decision, decision);
    assert.equal(query.providerRevision, supplied ? snapshot.revision : '');
    assert.equal(query.contextRevision, activation.bindings[0].bindingRevision);
    assert.equal(query.occurrenceId, `${querySite}:calendar`);
    assert.equal(query.unknownReason, decision.startsWith('Fault(') ? decision : undefined);
    assert.equal(typeof serialized.safe.active, 'boolean');
  }
});

test('REF-03-041: conflicting exceptions, mixed snapshots and changed revision contents reject atomically', async t => {
  const artifact = await compileSource(source());
  const snapshot = calendar().snapshot;
  const runtime = await ControlRuntime.instantiateFramed(wasm(), artifact, { context: activation });
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 0, contextFacts: facts(artifact, 0, date('2026-10-01T23:44:59Z'), snapshot) });
  const saved = runtime.contextSnapshot().bytes;
  const conflict = { ...snapshot, exceptions: [{ date: calendarEpochDay('2026-10-01'), class: 'work' }, { date: calendarEpochDay('2026-10-01'), class: 'off' }] };
  assert.throws(() => runtime.step({ nowMs: 1000, contextFacts: facts(artifact, 1000, date('2026-10-01T23:45:00Z'), conflict) }), /calendar|context|invalid/i);
  assert.deepEqual(runtime.contextSnapshot().bytes, saved);
  const mixed = facts(artifact, 1000, date('2026-10-01T23:45:00Z'), snapshot);
  mixed.schedules[1].calendar = { ...snapshot, revision: 'other-revision' };
  assert.throws(() => runtime.step({ nowMs: 1000, contextFacts: mixed }), /calendar|context|invalid/i);
  assert.deepEqual(runtime.contextSnapshot().bytes, saved);
  const changed = { ...snapshot, exceptions: [] };
  assert.throws(() => runtime.step({ nowMs: 1000, contextFacts: facts(artifact, 1000, date('2026-10-01T23:45:00Z'), changed) }), /calendar|context|invalid/i);
  assert.deepEqual(runtime.contextSnapshot().bytes, saved);
});

test('REF-03-041: strict UTC activation, missing facts and protected projections cannot bypass the owner', async t => {
  const artifact = await compileSource(source());
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm(), artifact, { context: { ...activation,
    bindings: activation.bindings.map(binding => ({ ...binding, timezone: 'Asia/Seoul' })) } }), /activation|UTC|binding|context/i);
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const runtime = await instantiate.call(ControlRuntime, wasm(), artifact, { context: activation });
    t.after(() => runtime.dispose());
    const packet = facts(artifact, 0, date('2026-10-01T00:00:00Z'), calendar().snapshot);
    packet.schedules.pop();
    assert.throws(() => runtime.step({ nowMs: 0, contextFacts: packet }), /context|facts|evidence|binding/i);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { [artifact.manifest.calendarConditions[0].projectionInputs.value]: true },
      contextFacts: facts(artifact, 0, date('2026-10-01T00:00:00Z'), calendar().snapshot) }), /input|reserved|unexpected/i);
  }
  const runtime = await GhostFlowRuntime.instantiate(wasm());
  t.after(() => runtime.dispose());
  const downgraded = Buffer.from(artifact.bytes); downgraded.writeUInt16LE(11, 4);
  assert.throws(() => runtime.load(downgraded), /load|invalid|format|prelude/i);
  const old = await compileSource('# Old\n\n```ghost\ncontrol Old { output value: Bool; value <- true; }\n```\n');
  const claimed = Buffer.from(old.bytes); claimed.writeUInt16LE(18, 4);
  assert.throws(() => runtime.load(claimed), /load|invalid|format|prelude/i);
});
