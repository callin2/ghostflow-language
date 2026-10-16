import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { encodeContextFacts, solarContextEvidence } from '../runtimes/wasm/context-abi.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const document = fs.readFileSync(new URL('./fixtures/issue-145-solar-config.ghost.md', import.meta.url), 'utf8');
const activation = { bootEpoch: 7, terminalCapacity: 32, bindings: [] };
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : ''));
let wasm;
function wasmBytes() {
  if (!wasm) wasm = fs.readFileSync(wasmPath);
  return wasm;
}
const artifact = () => compileSource(document, { filename: 'issue-145-solar-config.ghost.md' });
const clock = (monotonicMs, wallMs) => ({ monotonicMs, bootEpoch: 7, wallMs, uncertaintyMs: 0,
  trusted: true, unknownReason: null, sourceRevision: 'ref-08-007-clock-v1' });
function providerRows(rows, providerRevision = 'solar-ref-08-007-r1', contextRevision = 'seoul-ref-08-007-binding-r1') {
  return rows.map(row => ({ providerRevision, contextRevision, ...row }));
}
function facts(compiled, monotonicMs, wallMs, rows, revisions = {}) {
  return { clock: clock(monotonicMs, wallMs), natural: [], schedules: [], settings: null,
    solars: compiled.manifest.schedules.map(schedule => solarContextEvidence(schedule, {
      site: schedule.site, coverageFromWallMs: 0, coverageToWallMs: 259_200_000,
      rows: providerRows(rows, revisions.providerRevision, revisions.contextRevision),
    })) };
}
function native(t, compiled, steps) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-ref-08-007-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'solar.gfb');
  const tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, compiled.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-solar-v1', activation,
    steps: steps.map((step, index) => ({ scanId: step.scanId ?? index, logicalTimeMs: step.nowMs,
      inputs: [{ name: 'divisor', value: step.divisor ?? 1 }], ...step.contextFacts })) }));
  return execFileSync(nativePath, [modulePath, tapePath], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
}
function solarRows(compiled, trace) {
  return trace.contextTrace.filter(row => compiled.manifest.schedules.some(schedule => schedule.site === row.site));
}

// REF-08-007: provider-created time input must not be reduced to a Bool pulse that loses cause,
// data revision, validity, or occurrence identity.
test('REF-08-007 same-data/time Solar occurrence keeps revision, validity and occurrence identity across WASM and native runtime', async t => {
  const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8'));
  const refCase = cases.cases.find(entry => entry.id === 'REF-08-007');
  assert.equal(refCase.issue, 'https://github.com/callin2/ghostflow-language/issues/324');
  assert.ok(refCase.references.some(reference => reference.includes('08-language-runtime-and-device-boundaries.md#84')));

  const compiled = await artifact();
  assert.ok(compiled.manifest.schedules.length > 0, 'canonical fixture must expose Solar schedules');
  const providerRevision = 'solar-ref-08-007-r17';
  const contextRevision = 'seoul-ref-08-007-binding-r4';
  const occurrenceRows = [
    { sourceDay: 0, scheduledWallMs: 1000, available: true },
    { sourceDay: 1, scheduledWallMs: 86_401_000, available: true },
  ];
  const steps = [
    { nowMs: 0, contextFacts: facts(compiled, 0, 900, occurrenceRows, { providerRevision, contextRevision }) },
    { nowMs: 100, contextFacts: facts(compiled, 100, 1000, occurrenceRows, { providerRevision, contextRevision }) },
    { nowMs: 200, contextFacts: facts(compiled, 200, 1000, occurrenceRows, { providerRevision, contextRevision }) },
    { nowMs: 300, contextFacts: facts(compiled, 300, 1001, occurrenceRows, { providerRevision, contextRevision }) },
  ];
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes(), compiled, { context: activation });
  t.after(() => runtime.dispose());
  const outcomes = steps.map(step => {
    runtime.step({ ...step, inputs: { divisor: 1 } });
    return structuredClone(runtime.lastFrameOutcome);
  });
  const traces = outcomes.map(outcome => outcome.trace);
  assert.deepEqual(traces.map(trace => trace.safe.due), [false, true, false, false],
    'same occurrence is admitted once, not replayed as duplicate Bool pulses');
  assert.equal(traces[1].module, compiled.traceMetadata.moduleFingerprint,
    'runtime trace remains bound to the compiled source/definition identity');
  assert.equal(compiled.sourceDocument.filename, 'issue-145-solar-config.ghost.md');
  assert.equal(compiled.traceMetadata.sourceDocumentSha256, compiled.sourceDocument.sha256);

  const admitted = solarRows(compiled, traces[1]);
  assert.equal(admitted.length, compiled.manifest.schedules.length);
  for (const row of admitted) {
    assert.equal(row.decision, 'Due');
    assert.equal(row.plannedWallMs, 1000);
    assert.equal(row.providerRevision, providerRevision);
    assert.equal(row.contextRevision, contextRevision);
    assert.equal(row.fallback, false);
    assert.match(row.occurrenceId, new RegExp(`^${row.site}:0:0:0$`), 'public occurrence ID includes site and source-day identity');
    assert.equal(row.clockSourceRevision, 'ref-08-007-clock-v1');
  }
  for (const duplicateTrace of [traces[2], traces[3]]) {
    assert.equal(solarRows(compiled, duplicateTrace).some(row => row.decision === 'Due'), false,
      'duplicate transport/admission does not create an extra occurrence');
  }

  const records = native(t, compiled, steps);
  assert.ok(records.every(record => record.accepted));
  assert.deepEqual(records.map(record => record.outcome), outcomes);
  assert.deepEqual(records.map(record => record.outcome.trace.safe.due), [false, true, false, false]);
  assert.deepEqual(records.map(record => solarRows(compiled, record.outcome.trace)), traces.map(trace => solarRows(compiled, trace)));
});

test('REF-08-007 missing and unavailable Solar evidence preserves typed cause instead of proving false', async t => {
  const compiled = await artifact();
  const providerRevision = 'solar-ref-08-007-stale-r3';
  const contextRevision = 'seoul-ref-08-007-binding-r4';
  const staleRows = [{ sourceDay: 0, scheduledWallMs: null, available: false, unavailableReason: 4 }];
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes(), compiled, { context: activation });
  t.after(() => runtime.dispose());
  const trace = runtime.step({ nowMs: 100, inputs: { divisor: 1 },
    contextFacts: facts(compiled, 100, 1000, staleRows, { providerRevision, contextRevision }) }).vm;
  assert.equal(trace.safe.due, false);
  for (const row of solarRows(compiled, trace)) {
    assert.equal(row.decision, 'Unknown(OccurrenceUnavailable)');
    assert.equal(row.unavailableReason, 4, 'typed ABI cause PredictionStale is retained');
    assert.equal(row.providerRevision, providerRevision);
    assert.equal(row.contextRevision, contextRevision);
    assert.equal(row.plannedWallMs, null);
    assert.match(row.occurrenceId, new RegExp(`^${row.site}:0:0:0$`),
      'unavailable evidence still carries source-day occurrence identity for missing/duplicate judgment');
  }
  const before = runtime.contextSnapshot();
  const missing = facts(compiled, 200, 1000, staleRows, { providerRevision, contextRevision });
  missing.solars.pop();
  assert.throws(() => runtime.step({ nowMs: 200, inputs: { divisor: 1 }, contextFacts: missing }), /missing context Solar evidence/);
  assert.deepEqual(runtime.contextSnapshot(), before, 'missing-reference rejection commits no runtime state');

  const records = native(t, compiled, [
    { nowMs: 100, contextFacts: facts(compiled, 100, 1000, staleRows, { providerRevision, contextRevision }) },
  ]);
  assert.deepEqual(records[0].outcome, runtime.lastFrameOutcome);
  assert.deepEqual(records.map(record => record.outcome.trace.safe.due), [false]);
  assert.deepEqual(solarRows(compiled, records[0].outcome.trace), solarRows(compiled, trace));
});

test('REF-08-007 rejects caller-supplied due oracle and invalid binding without consuming occurrence; retry uses real core admission', async t => {
  const compiled = await artifact();
  const occurrenceRows = [{ sourceDay: 0, scheduledWallMs: 1000, available: true }];
  const packet = facts(compiled, 100, 1000, occurrenceRows);
  assert.throws(() => encodeContextFacts({ ...packet, due: true }), /unexpected/,
    'caller may provide astronomical facts but not a due/admission oracle');

  const runtime = await ControlRuntime.instantiateFramed(wasmBytes(), compiled, { context: activation });
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 0, inputs: { divisor: 1 }, contextFacts: facts(compiled, 0, 900, occurrenceRows) });
  const before = runtime.contextSnapshot();
  const badBinding = facts(compiled, 100, 1000, occurrenceRows);
  badBinding.solars[0].latitude = 0;
  assert.throws(() => runtime.step({ nowMs: 100, inputs: { divisor: 1 }, contextFacts: badBinding }), /Solar|binding|context/i);
  assert.deepEqual(runtime.contextSnapshot(), before,
    'rejected binding preserves the actual snapshot and does not consume the occurrence');
  const admitted = runtime.step({ nowMs: 100, inputs: { divisor: 1 }, contextFacts: packet }).vm;
  assert.equal(admitted.safe.due, true, 'valid retry is admitted by the Rust core, not by a hand-written scheduler');
  assert.ok(solarRows(compiled, admitted).every(row => row.decision === 'Due' && row.occurrenceId !== ''));

  const retryRecords = native(t, compiled, [
    { nowMs: 0, contextFacts: facts(compiled, 0, 900, occurrenceRows) },
    { nowMs: 100, scanId: 1, contextFacts: badBinding },
    { nowMs: 100, scanId: 1, contextFacts: packet },
  ]);
  assert.deepEqual(retryRecords.map(record => record.accepted), [true, false, true]);
  assert.equal(retryRecords[1].outcome, undefined);
  assert.equal(retryRecords[2].outcome.trace.safe.due, true);
  assert.deepEqual(retryRecords[2].outcome, runtime.lastFrameOutcome);
});

test('REF-08-007 outside coverage stays Unknown without catch up and renewed evidence admits a later occurrence', async t => {
  const compiled = await artifact(), occurrenceRows = [{ sourceDay: 0, scheduledWallMs: 1000, available: true }];
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes(), compiled, { context: activation });
  t.after(() => runtime.dispose());
  const expired = facts(compiled, 100, 1001, occurrenceRows);
  for (const solar of expired.solars) solar.coverageEndMs = 1000;
  const steps = [
    { nowMs: 0, contextFacts: facts(compiled, 0, 900, occurrenceRows) },
    { nowMs: 100, contextFacts: expired },
    { nowMs: 101, contextFacts: facts(compiled, 101, 1002, occurrenceRows) },
    { nowMs: 200, contextFacts: facts(compiled, 200, 86_400_900, occurrenceRows) },
    { nowMs: 300, contextFacts: facts(compiled, 300, 86_401_000,
      [...occurrenceRows, { sourceDay: 1, scheduledWallMs: 86_401_000, available: true }]) },
  ];
  const outcomes = steps.map(step => {
    runtime.step({ ...step, inputs: { divisor: 1 } }); return structuredClone(runtime.lastFrameOutcome);
  });
  assert.equal(outcomes[1].trace.safe.due, false);
  assert.ok(solarRows(compiled, outcomes[1].trace).every(row => /Unknown.*Coverage/.test(row.decision)));
  assert.ok(!solarRows(compiled, outcomes[1].trace).some(row => row.decision === 'Due'));
  // Coverage failure was an accepted unknown scan; later past evidence is not
  // implicit catch-up. A later source-day crossing proves renewed facts work.
  assert.equal(outcomes[2].trace.safe.due, false);
  assert.equal(outcomes[4].trace.safe.due, true);
  assert.ok(solarRows(compiled, outcomes[4].trace).every(row => row.providerRevision === 'solar-ref-08-007-r1'
    && row.contextRevision === 'seoul-ref-08-007-binding-r1' && row.occurrenceId === `${row.site}:1:0:0`));
  const records = native(t, compiled, steps);
  assert.ok(records.every(record => record.accepted));
  assert.deepEqual(records.map(record => record.outcome), outcomes);
});
