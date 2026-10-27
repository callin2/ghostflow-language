import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { TemporarySettingsHost } from '../runtimes/wasm/temporary-settings-host.mjs';
import { solarContextEvidence } from '../runtimes/wasm/context-abi.mjs';
import { SolarSchedule, SOLAR_CALCULATION } from '../runtimes/wasm/solar-schedule.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = readFileSync(join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const cases = JSON.parse(readFileSync(join(root, 'tests/reference/cases/02-time-control.json'))).cases;
const activation = { bootEpoch: 590, terminalCapacity: 64, bindings: [] };
const binding = { kind: 'tide', provider: 'harbor', namespace: 'reference-590', station: 'fixture-harbor',
  bindingRevision: 'binding-v1', location: 'fixture-site', timezone: 'UTC', criteria: 'high', maxUncertaintyMs: 0 };
const tideActivation = { ...activation, bindings: [binding] };
const policy = 'clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;';
const document = code => '# Reference temporal contracts\n\n```ghost\n' + code + '\n```\n';
const compile = code => compileSource(document(code), { filename: 'reference-foundations-temporal.ghost.md' });
const clock = (nowMs, wallMs = nowMs) => ({ monotonicMs: nowMs, wallMs, bootEpoch: 590,
  uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'fixture-clock-v1' });
const facts = (nowMs, wallMs = nowMs) => ({ clock: clock(nowMs, wallMs), natural: [], schedules: [], settings: null });
const frame = (nowMs, contextFacts, inputs = {}) => ({ nowMs, contextFacts, inputs });
const receiptId = n => { const bytes = new Uint8Array(16); new DataView(bytes.buffer).setBigUint64(0, BigInt(n), true); return bytes; };
const config = { maxIntervals: 256, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 86_400_000n };
const persist = async () => true;

function reference(id) {
  const entry = cases.find(entry => entry.id === id);
  assert.equal(entry.status, 'specified');
  return entry;
}

function native(t, artifact, frames, profile, context = activation) {
  const dir = mkdtempSync(join(tmpdir(), 'reference-temporal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const module = join(dir, 'module.gfb'), tape = join(dir, 'tape.json');
  writeFileSync(module, artifact.bytes);
  let scanId = 0;
  writeFileSync(tape, JSON.stringify({ profile, activation: context,
    steps: frames.map(f => ({ scanId: f.scanId ?? scanId++, logicalTimeMs: f.nowMs,
      inputs: Object.entries(softwareQualityRails(artifact, f.inputs ?? {}, scanId, f.nowMs))
        .map(([name, value]) => ({ name, value })), ...f.contextFacts })) }));
  return execFileSync(join(root, 'target/release/examples/context_tape'), [module, tape],
    { encoding: 'utf8', timeout: 15_000 }).trim().split('\n').map(line => JSON.parse(line));
}

async function parity(t, artifact, frames, profile, context = activation) {
  const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasm, artifact, { context }));
  t.after(() => runtime.dispose());
  const actual = frames.map(f => {
    runtime.step(f);
    const snapshot = runtime.contextSnapshot();
    return { outcome: structuredClone(runtime.lastFrameOutcome), settings: snapshot.state,
      checkpoint: Buffer.from(snapshot.bytes).toString('hex') };
  });
  const expected = native(t, artifact, frames, profile, context);
  assert.ok(expected.every(row => row.accepted));
  expected.forEach((row, index) => {
    assert.deepEqual(actual[index].outcome, row.outcome, `complete outcome ${index}`);
    assert.deepEqual(actual[index].settings, row.settings, `settings ${index}`);
    assert.equal(actual[index].checkpoint, row.checkpoint, `checkpoint ${index}`);
  });
  return actual;
}

const tideRow = (eventId, instantMs, revision = 'tide-v1', withdrawn = false) => ({ sourceDay: Math.floor(instantMs / 86_400_000),
  slotKey: 0, minuteOfDay: 0, fold: 0, eventId, eventKind: 'high', instantMs, withdrawn,
  providerRevision: revision, contextRevision: 'fixture-context-v1' });
function tides(artifact, nowMs, wallMs, rows, revision = 'tide-v1') {
  return { ...facts(nowMs, wallMs), schedules: artifact.manifest.schedules.map(schedule => ({ site: schedule.site,
    coverageStartMs: 0, coverageEndMs: 864_000_000, calendar: null,
    provider: { binding, providerRevision: revision, coverageStartMs: 0, coverageEndMs: 864_000_000,
      expiresAtMs: 864_000_001, uncertaintyMs: 0, fault: null, classifications: ['high'] }, rows })) };
}
function tideProgram(basis = 'run(5min, within(10min))', offset = '') {
  return `control TideContract {
    input allowed: Bool; provider harbor: TidePredictions;
    schedule tide_event: Tide { source = harbor; timezone = "UTC"; at = tide\`high${offset}\`;
      basis = ${basis}; when = allowed |> recover(false); cancel_when = false; ${policy} }
    output due, active: Bool; due <- tide_event.due;
    active <- tide_event.active;
  }`;
}

async function appliedParity(t, source, ledger, segments, nowMs, windowMs) {
  const artifact = await compileSource(source);
  const dir = mkdtempSync(join(tmpdir(), 'reference-applied-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const module = join(dir, 'module.gfb'), tape = join(dir, 'tape.json');
  writeFileSync(module, artifact.bytes);
  writeFileSync(tape, JSON.stringify({ moduleFingerprint: artifact.traceMetadata.moduleFingerprint,
    manifest: artifact.manifest, account: ledger.source.account, target: ledger.source.target,
    resourceId: 7, windowMs, maxRollingWindowMs: Number(config.maxRollingWindowMs), recordCheckpoints: true,
    frames: [{ nowMs, segments: segments.map(([startMs, endMs], index) => ({ receiptId: index + 1,
      resourceId: 7, startMs, endMs, localDay: 0 })), query: true, dayQueries: [0] }] }));
  const result = JSON.parse(execFileSync(join(root, 'target/release/examples/accounting_tape'), [module, tape],
    { encoding: 'utf8', timeout: 10_000 }));
  assert.deepEqual(result.observations, [{ nowMs, usedMs: Number(ledger.usedRolling(7, BigInt(nowMs), BigInt(windowMs))) }]);
  assert.deepEqual(result.dayObservations, [{ nowMs, localDay: 0, usedMs: Number(ledger.usedLocalDay(7, 0)) }]);
  assert.deepEqual(result.recordObservations.at(-1).snapshotAfter, [...ledger.snapshot().bytes]);
  assert.equal(result.stage, 'applied');
  assert.equal(result.target, 'pump');
}

test('REF-03-018 partial: state age, continuous true and physical rolling/day accounting keep independent clocks', async t => {
  assert.match(reference('REF-03-018').then, /40초.*20초.*30초/);
  const artifact = await compile(`control TimeQuestions {
    config marker: Bool = true;
    input pump_on: Bool; state phase: Bool = true;
    timer phase_age = elapsed(phase);
    timer on_age = continuous_true(pump_on |> recover(false));
    output age, continuous: Duration; age <- phase_age; continuous <- on_age;
  }`);
  const timeline = [[0, true], [10_000, false], [20_000, true], [40_000, true]];
  const rows = await parity(t, artifact, timeline.map(([at, pump_on]) => frame(at, facts(at), { pump_on })), 'context-settings-v1');
  assert.deepEqual(rows.map(row => row.outcome.trace.safe), [
    { age: 0, continuous: 0 }, { age: 10_000, continuous: 0 },
    { age: 20_000, continuous: 0 }, { age: 40_000, continuous: 20_000 },
  ]);
  const source = document(`control PhysicalTime { resource pump: BoolActuator;
    account physical = on_time(pump, stage: applied, persistence: durable); output ready: Bool; ready <- true; }`);
  const ledger = await AccountingRuntime.instantiateSource(wasm, source, { account: 'physical', resourceId: 7, config });
  t.after(() => ledger.dispose());
  await ledger.initializeEmpty(persist);
  for (const [index, [startMs, endMs]] of [[0, 10_000], [20_000, 40_000]].entries()) {
    await ledger.recordAppliedSegment({ receiptId: receiptId(index + 1), resourceId: 7, startMs, endMs, localDay: 0 }, persist);
  }
  assert.equal(ledger.usedRolling(7, 40_000n, 25_000n), 20_000n);
  assert.equal(ledger.usedLocalDay(7, 0), 30_000n);
  await appliedParity(t, source, ledger, [[0, 10_000], [20_000, 40_000]], 40_000, 25_000);
  t.diagnostic('Remaining REF-03-018 clause: no job-scoped cumulative ON API; physical receipt totals do not establish job ownership/reset semantics.');
});

test('context and scalar timer validation retain strict continuous and elapsed descriptor contracts', async () => {
  for (const context of [false, true]) {
    const artifact = await compile(`control TimerDescriptors { ${context ? 'config marker: Bool = true;' : ''}
      state phase: Bool = true; timer age = elapsed(phase); timer on_age = continuous_true(phase);
      output age_ms, on_ms: Duration; age_ms <- age; on_ms <- on_age; }`);
    for (const [mutate, expected] of [
      [a => { a.manifest.timers[1].mode = 'continuous-false'; }, /unsupported mode continuous-false/],
      [a => { a.manifest.timers[1].state = 'phase'; }, /unknown key state/],
      [a => { delete a.manifest.timers[0].state; }, /state is required/],
      [a => { a.manifest.timers[0].mode = 'continuous-true'; }, /unknown key state/],
      [a => { a.manifest.timers[1].clockInput = 'wall_clock'; }, /clockInput must be __gf_now_ms/],
    ]) {
      const invalid = structuredClone(artifact); mutate(invalid);
      for (const method of ['instantiate', 'instantiateFramed']) {
        await assert.rejects(ControlRuntime[method](wasm, invalid, context ? { context: activation } : {}), expected);
      }
    }
  }
});

test('REF-03-021 partial: a twenty-second blocked request remains distinct from safe output and applied evidence', async t => {
  assert.match(reference('REF-03-021').given, /20초.*safe=false/);
  const artifact = await compile(`control Blocked {
    config marker: Bool = true; input manual, low_water: Bool;
    output pump, water_ready: Bool; pump <- manual |> recover(false);
    water_ready <- case low_water { ok(value) => !value; fault(_) => false; }; require pump => water_ready;
  }`);
  const rows = await parity(t, artifact, [0, 20_000].map(at => frame(at, facts(at), { manual: true, low_water: true })), 'context-settings-v1');
  for (const row of rows) {
    assert.equal(row.outcome.trace.requested.pump, true);
    assert.equal(row.outcome.trace.safe.pump, false);
  }
  for (const stage of ['requested', 'safe', 'confirmed']) {
    await assert.rejects(compile(`control Unsupported { resource pump: BoolActuator;
      account usage = on_time(pump, stage: ${stage}, persistence: durable); }`), /executable accounting requires durable applied/);
  }
  t.diagnostic('Remaining REF-03-021 clauses: executable safe accounting and confirmed flow Result/feedback-quality binding are absent; safe false is not a measured safe ledger.');
});

test('REF-03-026 partial: Pulse misses its false crossing while a late Tide Run retains its monotonic five-minute deadline', async t => {
  assert.match(reference('REF-03-026').given, /08:02.*08:03.*08:04/);
  const planned = 28_800_000, origin = planned - 10_000;
  const times = Array.from({ length: 15 }, (_, i) => i * 30_000 + 10_000);
  times.unshift(0); times.push(429_999, 430_000);
  times.sort((a, b) => a - b);
  const allowed = at => at >= 130_000 && (at < 190_000 || at >= 250_000);
  const artifact = await compile(tideProgram());
  const frames = times.map(at => frame(at, tides(artifact, at, origin + at, [tideRow('E', planned)]), { allowed: allowed(at) }));
  const rows = await parity(t, artifact, frames, 'context-tide-v1', tideActivation);
  assert.equal(rows.filter(row => row.outcome.trace.safe.due).length, 1);
  rows.forEach((row, i) => {
    assert.equal(row.outcome.trace.safe.active, times[i] >= 130_000 && times[i] < 430_000);
    assert.equal(row.outcome.trace.safe.due, times[i] === 130_000);
  });
  const pulse = await compile(`control PulseContract { config marker: Bool = true; input allowed: Bool;
    schedule pulse_event: Solar { timezone = "UTC"; latitude = 0; longitude = 0; at = sun\`rise\`;
      basis = pulse; when = allowed |> recover(false); ${policy} }
    output due: Bool; due <- pulse_event.due;
  }`);
  const pulseFrames = times.map(at => frame(at, { ...facts(at, origin + at), solars: [solarContextEvidence(pulse.manifest.schedules[0], {
    site: pulse.manifest.schedules[0].site, coverageFromWallMs: 0, coverageToWallMs: 86_400_000,
    rows: [{ sourceDay: 0, scheduledWallMs: planned, available: true, providerRevision: 'solar-v1', contextRevision: 'site-v1' }],
  })] }, { allowed: allowed(at) }));
  const pulseRows = await parity(t, pulse, pulseFrames, 'context-solar-v1');
  assert.ok(pulseRows.every(row => row.outcome.trace.safe.due === false));
  assert.ok(pulseRows[1].outcome.trace.contextTrace.some(row => row.decision === 'ConditionsFalseAtPulse'));
  await assert.rejects(compile(tideProgram('window(5min)')), /basis.*pulse.*run|unsupported.*basis/i);
  t.diagnostic('Remaining REF-03-026 clause: Window first-true admission and non-rearming await the language-owned executable Window basis.');
});

test('REF-03-030 partial: observation gap terminalizes an open within interval and recovery cannot revive it', async t => {
  assert.match(reference('REF-03-030').given, /07:59:50.*08:02:00/);
  const artifact = await compile(tideProgram()), planned = 28_800_000;
  const frames = [0, 130_000, 130_001, 190_000].map(at => frame(at,
    tides(artifact, at, planned - 10_000 + at, [tideRow('E', planned)]), { allowed: true }));
  const rows = await parity(t, artifact, frames, 'context-tide-v1', tideActivation);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.active), [false, false, false, false]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.due), [false, false, false, false]);
  const missed = rows[1].outcome.trace.contextTrace.filter(row => row.decision === 'ObservationGap');
  assert.equal(missed.length, 1);
  assert.equal(missed[0].occurrenceId, 'reference-590:fixture-harbor:E');
  assert.ok(rows.slice(2).every(row => !(row.outcome.trace.contextTrace ?? []).some(observation => observation.decision === 'Due')));
  t.diagnostic('Remaining REF-03-030 clause: the original 08:00-08:05 Window is not executable; this verifies the independent open-within terminalization clause only.');
});

test('REF-03-037 invalid target rejects the whole Periodic settings event without changing run identity or phase', async t => {
  assert.match(reference('REF-03-037').given, /interval=10min.*invalid setting/);
  const artifact = await compile(`control AtomicInterval {
    config interval: Duration = 15min { min = 1min; max = 1h; step = 1min; access = operator; }
    config other: Bool = true { access = operator; }
    schedule cycle: Periodic { every = interval; anchor = instant(datetime\`1970-01-01T00:00:00Z\`);
      interval_change = preserve_anchor; basis = pulse; when = true;
      clock = trusted_only; gap = skip_after(1h); recovery = baseline; fallback = skip; }
    output due: Bool; due <- cycle.due;
  }`);
  const ids = Object.fromEntries(artifact.manifest.configs.map(c => [c.name, c.id]));
  const host = await TemporarySettingsHost.instantiate(wasm, artifact, { runId: 'run-590-periodic',
    grants: { operator: Object.values(ids) }, context: activation });
  t.after(() => host.dispose());
  const packet = at => frame(at, { ...facts(at), schedules: [{ site: artifact.manifest.schedules[0].site,
    coverageStartMs: 0, coverageEndMs: 3_600_000, provider: null, calendar: null, rows: [] }] });
  host.step(packet(0)); host.step(packet(1_000_000));
  const before = host.snapshot(), bytes = Uint8Array.from(artifact.bytes);
  const changes = [
    { configId: ids.interval, result: { ok: true, type: 'Duration', value: 600_000 } },
    { configId: 999_999, result: { ok: true, type: 'Bool', value: false } },
  ];
  const event = { kind: 'ordinary', eventId: 'interval-ten', programFingerprint: before.programFingerprint,
    sourceSha256: before.sourceSha256, runId: before.runId, baseRevision: 0, actor: 'operator', reason: 'reference fixture', changes };
  assert.throws(() => host.step(packet(1_000_001), event), /setting identity/);
  assert.deepEqual(host.snapshot(), before);
  assert.deepEqual(artifact.bytes, bytes);
  const coreEvent = { programFingerprint: before.programFingerprint, eventId: event.eventId,
    baseRevision: 0, position: before.position + 1, origin: 'operatorEdit', changes };
  const attempts = [packet(0), packet(1_000_000), { ...packet(1_000_001), scanId: 2,
    contextFacts: { ...packet(1_000_001).contextFacts, settings: coreEvent } }];
  const rejected = native(t, artifact, attempts, 'context-settings-periodic-v1');
  assert.deepEqual(rejected.map(row => row.accepted), [true, true, false]);
  assert.equal(rejected[2].checkpoint, rejected[1].checkpoint);
  assert.deepEqual(rejected[2].settings, rejected[1].settings);
  assert.deepEqual(rejected[2].lastOutcome, rejected[1].outcome);
  const valid = host.step(packet(1_000_001), { ...event, changes: [changes[0], { ...changes[1], configId: ids.other }] });
  assert.equal(valid.accepted, true);
  assert.equal(valid.snapshot.runId, before.runId);
  assert.equal(valid.snapshot.core.state.settingsRevision, 1);
  assert.equal(valid.outcome.vm.safe.due, false, 'a valid live change does not catch up the past ten-minute occurrence');
  assert.equal(host.step(packet(1_200_000)).outcome.vm.safe.due, true, 'preserve_anchor retains the next twenty-minute phase');
  assert.deepEqual(artifact.bytes, bytes);
});

test('REF-03-040 partial: admitted natural Run crosses midnight independently of its source date', async t => {
  assert.match(reference('REF-03-040').given, /00:10.*-30min.*23:40/);
  const code = tideProgram('run(30min, within(10min))', ' - 30min');
  const artifact = await compile(code);
  const instant = Date.parse('1970-01-05T00:10:00Z'), planned = instant - 1_800_000;
  const times = [0, 1, 600_001, 1_200_001, 1_799_999, 1_800_001];
  const frames = times.map(at => frame(at, tides(artifact, at, planned - 1 + at,
    [tideRow('midnight-E', instant)]), { allowed: true }));
  const rows = await parity(t, artifact, frames, 'context-tide-v1', tideActivation);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.active), [false, true, true, true, true, false]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.due), [false, true, false, false, false, false]);
  await assert.rejects(compile(code.replace('basis = run(', 'on = day`mon`; basis = run(')), /unsupported Tide schedule option on/);
  t.diagnostic('Remaining REF-03-040 clause: natural scheduled-start Date filtering has no Solar/Tide on option; the Monday filter rejecting Sunday 23:40 remains unimplemented.');
});

test('REF-03-047 Tide corrections and withdrawals retain stable IDs and do not cancel an admitted Run', async t => {
  assert.match(reference('REF-03-047').then, /CorrectionPastHighWater.*LocationUnknown/);
  const artifact = await compile(tideProgram());
  const rowsV1 = [tideRow('A', 1000), tideRow('E', 5000), tideRow('W', 8000)];
  const rowsV2 = [tideRow('A', 1000, 'tide-v2'), tideRow('E', 500, 'tide-v2'), tideRow('W', 8000, 'tide-v2', true)];
  const frames = [999, 1000, 1500, 2000].map(at => frame(at,
    tides(artifact, at, at, at < 1500 ? rowsV1 : rowsV2, at < 1500 ? 'tide-v1' : 'tide-v2'), { allowed: true }));
  const rows = await parity(t, artifact, frames, 'context-tide-v1', tideActivation);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.active), [false, true, true, true]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.due), [false, true, false, false]);
  const observations = rows[2].outcome.trace.contextTrace;
  for (const [id, decision] of [['E', 'CorrectionPastHighWater'], ['W', 'EventWithdrawn']]) {
    const record = observations.find(row => row.occurrenceId === `reference-590:fixture-harbor:${id}`);
    assert.equal(record.decision, decision);
    assert.equal(record.providerRevision, 'tide-v2');
  }
  assert.equal(rows[3].outcome.trace.contextTrace.some(row => ['CorrectionPastHighWater', 'EventWithdrawn'].includes(row.decision)), false);
  const solar = await compile(`control SolarUnknown { config marker: Bool = true;
    schedule dawn: Solar { timezone = "UTC"; latitude = 0; longitude = 0; at = sun\`rise\`;
      basis = pulse; when = true; ${policy} }
    output due: Bool; due <- dawn.due;
  }`);
  const solarFrames = [0, 1000, 2000].map(at => frame(at, { ...facts(at, 1000 + at),
    solars: [solarContextEvidence(solar.manifest.schedules[0], { site: solar.manifest.schedules[0].site,
      coverageFromWallMs: 0, coverageToWallMs: 86_400_000, rows: [{ sourceDay: 0,
        available: false, scheduledWallMs: null, unavailableReason: 1, providerRevision: 'missing-location-v1', contextRevision: 'location-absent' }] })] }));
  const solarRows = await parity(t, solar, solarFrames, 'context-solar-v1');
  for (const row of solarRows) {
    assert.equal(row.outcome.trace.safe.due, false);
    const unknown = row.outcome.trace.contextTrace.find(row => row.decision === 'Unknown(OccurrenceUnavailable)');
    assert.equal(unknown.unavailableReason, 1, 'LocationUnknown is retained, with terminal skip and no inferred event');
    assert.equal(unknown.plannedWallMs, null);
    assert.equal(unknown.fallback, false);
  }
  const provider = new SolarSchedule(solar.manifest.schedules[0]);
  const preview = provider.preview(Date.parse('2026-10-01T12:00:00Z'));
  assert.equal(SOLAR_CALCULATION, 'suncalc-2.0.2/sea-level');
  assert.equal(preview.calculation, SOLAR_CALCULATION);
  assert.ok(Number.isSafeInteger(preview.eventWallMs));
  assert.equal(preview.scheduledWallMs, preview.eventWallMs);
});

test('REF-04-055 partial: applied ledger counts only five seconds of merged physical intervals and cannot invent confirmed flow', async t => {
  assert.match(reference('REF-04-055').given, /3초 queue.*2초 constraint block.*5초 applied/);
  const source = document(`control MergedApplied { resource pump: BoolActuator;
    account usage = on_time(pump, stage: applied, persistence: durable); output ready: Bool; ready <- true; }`);
  const ledger = await AccountingRuntime.instantiateSource(wasm, source, { account: 'usage', resourceId: 7, config });
  t.after(() => ledger.dispose());
  await ledger.initializeEmpty(persist);
  const before = ledger.snapshot();
  assert.equal(ledger.usedLocalDay(7, 0), 0n, 'request/queue/blocked metadata is not physical evidence');
  assert.deepEqual(ledger.snapshot(), before);
  for (const [index, [startMs, endMs]] of [[5000, 9000], [7000, 10_000]].entries()) {
    await ledger.recordAppliedSegment({ receiptId: receiptId(index + 1), resourceId: 7, startMs, endMs, localDay: 0 }, persist);
  }
  assert.equal(ledger.usedLocalDay(7, 0), 5000n);
  assert.equal(ledger.usedRolling(7, 10_000n, 10_000n), 5000n);
  await appliedParity(t, source, ledger, [[5000, 9000], [7000, 10_000]], 10_000, 10_000);
  await assert.rejects(compile(`control NoConfirmedFlow { resource pump: BoolActuator;
    account physical_flow = on_time(pump, stage: confirmed, persistence: durable); }`), /executable accounting requires durable applied/);
  t.diagnostic('Remaining REF-04-055 clauses: Device driver evidence must bind queue/block/apply lifecycle to receipts; executable confirmed-flow Result with feedback quality is absent.');
});
