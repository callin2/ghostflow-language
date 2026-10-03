import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const contextTape = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);

const source = `# REF-03-029 Tide occurrence identity

\`\`\`ghost
control TideOccurrenceIdentity {
  provider harbor_tides: TidePredictions;
  schedule first_high: Tide {
    source = harbor_tides;
    timezone = "UTC";
    at = tide\`high - 30min\`;
    basis = run(1s, within(5min));
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule second_high: Tide {
    source = harbor_tides;
    timezone = "UTC";
    at = tide\`high - 30min\`;
    basis = run(1s, within(5min));
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  state first_runs: Int = 0;
  state second_runs: Int = 0;
  first_runs' = if first_high.due then first_runs + 1 else first_runs;
  second_runs' = if second_high.due then second_runs + 1 else second_runs;
  output first_active, second_active: Bool;
  output first_count, second_count: Int;
  first_active <- first_high.active;
  second_active <- second_high.active;
  first_count <- first_runs';
  second_count <- second_runs';
}
\`\`\`
`;

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-tide-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const binding = Object.freeze({ kind: 'tide', provider: 'harbor_tides', namespace: 'ref-03-029-tide', station: 'reference-harbor',
  bindingRevision: 'binding-v1', location: 'reference-site', timezone: 'UTC', criteria: 'high', maxUncertaintyMs: 0 });

function clock(nowMs) {
  return { monotonicMs: nowMs, bootEpoch: 218, wallMs: nowMs, uncertaintyMs: 0, trusted: true,
    unknownReason: null, sourceRevision: 'clock-v1' };
}

function provider(providerRevision, coverageEndMs = 10_000) {
  return { binding, providerRevision, coverageStartMs: 0, coverageEndMs, expiresAtMs: coverageEndMs + 1,
    uncertaintyMs: 0, fault: null, classifications: ['high'] };
}

function row({ eventId, instantMs, providerRevision, contextRevision = 'context-v1' }) {
  return { sourceDay: 0, slotKey: 0, minuteOfDay: 0, fold: 0, eventId, eventKind: 'high', instantMs,
    withdrawn: false, providerRevision, contextRevision };
}

function schedule(site, rows, providerRevision) {
  return { site, coverageStartMs: 0, coverageEndMs: 10_000, provider: provider(providerRevision), calendar: null, rows };
}

function facts(nowMs, sites, rows, providerRevision) {
  return { clock: clock(nowMs), natural: [], settings: null, solars: [],
    schedules: sites.map(site => schedule(site, rows, providerRevision)) };
}

function contextFacts(step) {
  return { clock: step.clock, natural: step.natural, settings: step.settings, solars: [], schedules: step.schedules };
}

function tapeSteps(sites) {
  const e1v1 = row({ eventId: 'tide-event-E', instantMs: 1_801_000, providerRevision: 'tide-v1', contextRevision: 'ctx-v1' });
  const e1v2 = row({ eventId: 'tide-event-E', instantMs: 1_802_000, providerRevision: 'tide-v2', contextRevision: 'ctx-v2' });
  const e2 = row({ eventId: 'tide-event-E2', instantMs: 1_803_000, providerRevision: 'tide-v2', contextRevision: 'ctx-v2' });
  return [
    { scanId: 0, logicalTimeMs: 999, inputs: [], clock: clock(999), natural: [], schedules: sites.map(site => schedule(site, [e1v1], 'tide-v1')), settings: null },
    { scanId: 1, logicalTimeMs: 1000, inputs: [], clock: clock(1000), natural: [], schedules: sites.map(site => schedule(site, [e1v1], 'tide-v1')), settings: null },
    { scanId: 2, logicalTimeMs: 1500, inputs: [], clock: clock(1500), natural: [], schedules: sites.map(site => schedule(site, [e1v2], 'tide-v2')), settings: null },
    { scanId: 3, logicalTimeMs: 2000, inputs: [], clock: clock(2000), natural: [], schedules: sites.map(site => schedule(site, [e1v2], 'tide-v2')), settings: null },
    { scanId: 4, logicalTimeMs: 2500, inputs: [], clock: clock(2500), natural: [], schedules: sites.map(site => schedule(site, [e1v2], 'tide-v2')), settings: null },
    { scanId: 5, logicalTimeMs: 3000, inputs: [], clock: clock(3000), natural: [], schedules: sites.map(site => schedule(site, [e1v2, e2], 'tide-v2')), settings: null },
  ];
}

function outputSummary(record) {
  const safe = record.outcome.trace.safe;
  const state = record.outcome.trace.stateAfter;
  return { firstActive: safe.first_active, secondActive: safe.second_active,
    firstCount: safe.first_count, secondCount: safe.second_count,
    firstRuns: state.first_runs, secondRuns: state.second_runs };
}

function observations(record) {
  return JSON.stringify(record.outcome.trace.contextTrace ?? record.outcome.trace.scheduleTrace ?? []);
}

async function wasmRun(artifact, activation, steps, checkpoint = null) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  try {
    if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
    return steps.map(step => {
      try {
        const result = runtime.step({ nowMs: step.logicalTimeMs, contextFacts: contextFacts(step) });
        assert.equal(result.frame.scanId, step.scanId);
        return { accepted: true, outcome: structuredClone(runtime.lastFrameOutcome),
          settings: runtime.contextSnapshot().state,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      } catch (error) {
        return { accepted: false, error: error.message, outcome: structuredClone(runtime.lastFrameOutcome),
          settings: runtime.contextSnapshot().state,
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
      }
    });
  } finally { runtime.dispose(); }
}

function nativeRun(t, artifact, activation, steps, checkpoint = null) {
  const directory = workspace(t), modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-tide-v1', activation, checkpoint, steps }));
  return execFileSync(contextTape, [modulePath, tapePath], { encoding: 'utf8', timeout: 20_000 })
    .trim().split('\n').filter(Boolean).map(line => {
      const record = JSON.parse(line);
      return record.accepted ? record : { ...record, outcome: record.lastOutcome };
    });
}

function normalizeOutcome(outcome) {
  return { ...outcome, trace: { ...outcome.trace, contextTrace: outcome.trace.contextTrace ?? [] } };
}

test('REF-03-029 Tide provider correction keeps admitted occurrence identity and separate schedules independent', async t => {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'tests/reference/cases/02-time-control.json'), 'utf8')).cases.find(entry => entry.id === 'REF-03-029');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/218');
  assert.equal(original.scope, 'runtime');
  assert.match(original.then, /AlreadyAdmitted/);
  const artifact = await compileSource(source, { filename: 'ref-03-029-tide-occurrence-identity.ghost.md' });
  const descriptors = artifact.manifest.schedules;
  const sites = descriptors.map(schedule => schedule.site);
  assert.equal(new Set(sites).size, 2, 'canonical source has two explicit Tide schedule sites');
  assert.deepEqual(new Set(descriptors.map(schedule => schedule.source)), new Set(['harbor_tides']),
    'distinct schedule sites independently authorize the same provider key');
  const activation = { bootEpoch: 218, terminalCapacity: 16, bindings: [binding] };
  const steps = tapeSteps(sites);

  const legacy = await ControlRuntime.instantiate(wasm, artifact, { context: activation });
  t.after(() => legacy.dispose());
  const legacyRows = steps.map(step => legacy.step({ nowMs: step.logicalTimeMs, contextFacts: contextFacts(step) }).vm);
  assert.deepEqual(legacyRows.map(trace => ({ safe: trace.safe, state: trace.stateAfter })), [
    { safe: { first_active: false, second_active: false, first_count: 0, second_count: 0 }, state: { first_runs: 0, second_runs: 0 } },
    { safe: { first_active: true, second_active: true, first_count: 1, second_count: 1 }, state: { first_runs: 1, second_runs: 1 } },
    { safe: { first_active: true, second_active: true, first_count: 1, second_count: 1 }, state: { first_runs: 1, second_runs: 1 } },
    { safe: { first_active: false, second_active: false, first_count: 1, second_count: 1 }, state: { first_runs: 1, second_runs: 1 } },
    { safe: { first_active: false, second_active: false, first_count: 1, second_count: 1 }, state: { first_runs: 1, second_runs: 1 } },
    { safe: { first_active: true, second_active: true, first_count: 2, second_count: 2 }, state: { first_runs: 2, second_runs: 2 } },
  ]);
  assert.match(JSON.stringify(legacyRows[1].contextTrace), /Due/);
  assert.match(JSON.stringify(legacyRows[2].contextTrace), /Active/);
  assert.match(JSON.stringify(legacyRows[2].contextTrace), /tide-v1/);
  assert.doesNotMatch(JSON.stringify(legacyRows[2].contextTrace), /Due|CorrectionPastHighWater/,
    'the corrected E at 2000 does not readmit the actual E admitted at 1000');

  const framed = await wasmRun(artifact, activation, steps);
  const native = nativeRun(t, artifact, activation, steps);
  assert.deepEqual(native.map(row => row.accepted), [true, true, true, true, true, true]);
  assert.deepEqual(framed.map(row => row.accepted), native.map(row => row.accepted));
  for (const [index, row] of native.entries()) {
    assert.deepEqual(normalizeOutcome(framed[index].outcome), normalizeOutcome(row.outcome), `full framed/native outcome parity ${index}`);
    assert.deepEqual(framed[index].settings, row.settings, `settings identity ${index}`);
    assert.equal(framed[index].settings.programFingerprint, framed[0].settings.programFingerprint, `source fingerprint stable ${index}`);
    assert.equal(framed[index].checkpoint, row.checkpoint, `checkpoint parity ${index}`);
  }
  assert.deepEqual(native.map(outputSummary), legacyRows.map(trace => ({ firstActive: trace.safe.first_active, secondActive: trace.safe.second_active,
    firstCount: trace.safe.first_count, secondCount: trace.safe.second_count, firstRuns: trace.stateAfter.first_runs, secondRuns: trace.stateAfter.second_runs })));
  assert.match(observations(native[2]), /Active/);
  assert.match(observations(native[2]), /tide-v1/);
  assert.doesNotMatch(observations(native[2]), /Due|CorrectionPastHighWater/);
  const admitted = native[1].outcome.trace.contextTrace;
  const corrected = native[2].outcome.trace.contextTrace;
  assert.deepEqual(admitted.map(record => record.site), sites);
  assert.equal(new Set(admitted.map(record => record.occurrenceId)).size, 1);
  assert.equal(new Set(admitted.map(record => `${record.site}:${record.occurrenceId}`)).size, 2);
  assert.ok(admitted.every(record => record.decision === 'Due' && record.plannedWallMs === 1000));
  assert.deepEqual(corrected, admitted.map(record => ({ ...record, decision: 'Active' })), 'actual admitted ID and revisions survive provider/time correction');
  assert.doesNotMatch(observations(native[4]), /tide-event-E|Due/, 'core omits terminal E and emits no new admission on corrected recrossing');
  assert.match(observations(native[5]), /tide-event-E2/,
    'fresh E2 at 3000 is a separate occurrence after corrected terminal E');

  const restoredStep = { ...steps[5], scanId: 0 };
  const restoredNative = nativeRun(t, artifact, activation, [restoredStep], native[3].checkpoint);
  const restoredWasm = await wasmRun(artifact, activation, [restoredStep], native[3].checkpoint);
  assert.equal(restoredNative[0].accepted, true, restoredNative[0].error);
  assert.equal(restoredWasm[0].accepted, true, restoredWasm[0].error);
  assert.deepEqual(restoredWasm[0].outcome.trace, restoredNative[0].outcome.trace, 'restore/replay trace parity');
  assert.equal(restoredWasm[0].checkpoint, restoredNative[0].checkpoint, 'restored checkpoint parity');
  const restoredAgain = await wasmRun(artifact, activation, [restoredStep], native[3].checkpoint);
  assert.deepEqual(restoredAgain[0].outcome.trace, restoredWasm[0].outcome.trace, 'restored replay is deterministic');
  assert.equal(restoredAgain[0].checkpoint, restoredWasm[0].checkpoint, 'restored checkpoint is deterministic');

  const forged = structuredClone(steps[2]);
  forged.scanId = 2;
  forged.schedules[0].provider.binding = { ...forged.schedules[0].provider.binding, station: 'forged-harbor' };
  const retry = { ...steps[2], scanId: 2 };
  const wasmRetry = await wasmRun(artifact, activation, [steps[0], steps[1], forged, retry]);
  assert.deepEqual(wasmRetry.map(row => row.accepted), [true, true, false, true]);
  assert.match(wasmRetry[2].error, /provider observation binding mismatch|binding mismatch/i);
  assert.equal(wasmRetry[2].checkpoint, wasmRetry[1].checkpoint, 'WASM rejected facts preserve checkpoint');
  assert.deepEqual(wasmRetry[2].settings, wasmRetry[1].settings, 'WASM rejected facts preserve settings/source identity');
  assert.deepEqual(wasmRetry[3].outcome.trace, framed[2].outcome.trace, 'valid retry resumes the Active E correction deterministically');
});

test('REF-03-029 native and WASM reject forged Tide bindings atomically and retry without duplicate admission', async t => {
  const artifact = await compileSource(source, { filename: 'ref-03-029-tide-occurrence-identity.ghost.md' });
  const sites = artifact.manifest.schedules.map(schedule => schedule.site);
  const activation = { bootEpoch: 218, terminalCapacity: 16, bindings: [binding] };
  const steps = tapeSteps(sites);
  const forged = structuredClone(steps[2]);
  forged.schedules[0].provider.binding.station = 'forged-harbor';
  const tape = [steps[0], steps[1], forged, steps[2]];
  const native = nativeRun(t, artifact, activation, tape);
  const framed = await wasmRun(artifact, activation, tape);
  assert.deepEqual(native.map(row => row.accepted), [true, true, false, true]);
  assert.deepEqual(framed.map(row => row.accepted), native.map(row => row.accepted));
  for (const rows of [native, framed]) {
    assert.match(rows[2].error, /binding mismatch/i);
    assert.equal(rows[2].checkpoint, rows[1].checkpoint);
    assert.deepEqual(rows[2].settings, rows[1].settings);
    assert.deepEqual(rows[2].outcome, rows[1].outcome);
    assert.deepEqual(outputSummary(rows[3]), { firstActive: true, secondActive: true, firstCount: 1, secondCount: 1, firstRuns: 1, secondRuns: 1 });
  }
  assert.deepEqual(normalizeOutcome(framed[3].outcome), normalizeOutcome(native[3].outcome));
  assert.equal(framed[3].checkpoint, native[3].checkpoint);
  assert.deepEqual(framed[3].settings, native[3].settings);

  const directory = workspace(t);
  const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, artifact.bytes);
  for (const kind of ['moon', 'calendar']) {
    const invalid = { profile: 'context-tide-v1', activation: { ...activation, bindings: [{ ...binding, kind }] }, checkpoint: null, steps };
    fs.writeFileSync(tapePath, JSON.stringify(invalid));
    assert.throws(() => execFileSync(contextTape, [modulePath, tapePath], { encoding: 'utf8', stdio: 'pipe' }), /invalid provider binding kind|tide tape requires tide bindings/);
  }
});
