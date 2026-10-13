import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { emitCompletedScanSnapshot, expectedRuntimeIdentity, joinRuntimeSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { externalOracleCaseIds } from '../tools/reference-evidence.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const wire = value => JSON.parse(JSON.stringify(value));
const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = body => `# Diagnostic boundaries\n\n<!-- ghostflow:anchor id=GF-INT-REF-07-002 kind=intent status=confirmed origin=user -->\nPreserve causes and execution effects.\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const compile = body => compileSource(source(body), { filename: 'ref-07-002.ghost.md',
  interactionSourceIdentity: { documentId: 'source.ref-07-002', revisionId: 'revision.ref-07-002.1' } });
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const facts = (ms, schedules = [], settings = null, trusted = true) => ({
  clock: { monotonicMs: ms, bootEpoch: 1, wallMs: trusted ? ms : null, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'TrustExpired', sourceRevision: 'rtc.ref-07-002.1' },
  natural: [], schedules, settings,
});

test('REF-07-002: five owner-produced records retain causes provenance and distinct execution effects through serialization', async t => {
  // Reference 7.2 correction owners: author (compiler), input producer/driver
  // plus authored recovery (fault), clock/context provider (Unknown), operator
  // against current settings baseline (rejection), observation consumer (join).
  // These are test oracles, not a new diagnostic envelope or fabricated receipt.
  let compiler;
  await assert.rejects(() => compile('control Broken { output pump: Bool; pump <- 2; }'), error => {
    compiler = error.diagnosticEnvelope;
    assert.equal(error.bytes, undefined, 'author must correct the type before any executable artifact exists');
    return true;
  });
  const artifact = await compile(`control Fault {
    input reading: Number;
    // ghostflow:link id=GF-INT-REF-07-002 relation=implements
    state retained: Number = 0.0;
    retained' = reading |> recover(7.0);
    output value: Number; value <- retained';
  }`);
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  const sample = (id, quality, value) => ({ epoch: 7, id, timestampMs: id, quality, value });
  const healthy = runtime.step({ nowMs: 0, samples: { reading: sample(0, 'Good', 2) } });
  const fault = runtime.step({ nowMs: 1, samples: { reading: sample(1, 'Disconnected', 2) } });
  assert.equal(healthy.vm.safe.value, 2);
  assert.equal(fault.vm.safe.value, 7, 'fault executes the authored recovery, rather than preventing the scan');
  assert.equal(fault.sensors.reading.quality, 'Disconnected');
  const origin = artifact.sourceMap.find(node => node.kind === 'sensor').id;
  assert.deepEqual(fault.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })), [{ choice: 1, origin }]);

  const scheduled = await compile(`control Scheduled {
    schedule work: Daily {
      timezone = "UTC"; at = time\`00:01\`; basis = range(1min);
      dst_missing = skip; dst_repeated = first;
      when = true; cancel_when = false; clock = trusted_only;
      gap = skip_after(1min); recovery = baseline; fallback = skip;
    }
    output active: Bool; active <- work.active;
  }`);
  const scheduler = await ControlRuntime.instantiateFramed(wasm, scheduled, { context: activation });
  t.after(() => scheduler.dispose());
  const site = scheduled.manifest.schedules[0].site;
  const planned = 60000;
  // This UTC Daily range lowers to Rust Periodic policy and needs no supplied
  // civil occurrence rows; the clock facts remain external evidence.
  const rows = [{ site, coverageStartMs: 0, coverageEndMs: planned + 120000, provider: null, calendar: null, rows: [] }];
  const unknown = scheduler.step({ nowMs: 0, contextFacts: facts(0, rows, null, false) });
  const scheduleRecord = unknown.vm.contextTrace.find(row => row.site === site);
  assert.match(scheduleRecord.decision, /Unknown.*ClockUnknown/);
  assert.equal(unknown.vm.safe.active, false, 'missing trusted clock cannot grant schedule admission');
  const knownScheduler = await ControlRuntime.instantiateFramed(wasm, scheduled, { context: activation });
  t.after(() => knownScheduler.dispose());
  const knownFacts = (ms, wallMs) => {
    const value = facts(ms, rows);
    value.clock.wallMs = wallMs;
    return value;
  };
  knownScheduler.step({ nowMs: 0, contextFacts: knownFacts(0, planned - 1) });
  const due = knownScheduler.step({ nowMs: 1, contextFacts: knownFacts(1, planned) });
  assert.equal(due.vm.safe.active, true, 'trusted provider evidence at the occurrence admits the authored range');
  assert.ok(due.vm.contextTrace.some(row => row.site === site && row.decision === 'Due'));

  const settingsArtifact = await compileSource(read('contracts/interaction-v0/examples/operator-settings.ghost.md'), {
    filename: 'operator-settings.ghost.md', interactionSourceIdentity: {
      documentId: 'source.ref-07-002.settings', revisionId: 'revision.ref-07-002.settings.1' },
  });
  const settingsRuntime = await ControlRuntime.instantiateFramed(wasm, settingsArtifact, { context: activation });
  t.after(() => settingsRuntime.dispose());
  settingsRuntime.step({ nowMs: 0, contextFacts: facts(0) });
  const before = settingsRuntime.contextSnapshot();
  const last = wire(settingsRuntime.lastFrameOutcome);
  const request = { programFingerprint: before.state.programFingerprint, eventId: 'settings.ref-07-002',
    baseRevision: 1, position: 2, origin: 'operatorEdit', changes: [{
      configId: settingsArtifact.manifest.configs.find(config => config.name === 'enabled').id,
      result: { ok: true, type: 'Bool', value: true },
    }] };
  let rejection;
  assert.throws(() => settingsRuntime.step({ nowMs: 1, contextFacts: facts(1, [], request) }), error => {
    rejection = { name: error.name, message: error.message, committed: error.committed };
    assert.equal(error.committed, false);
    assert.match(error.message, /invalid or stale settings transaction/);
    return true;
  });
  const after = settingsRuntime.contextSnapshot();
  assert.deepEqual(after, before, 'operator must retry the actual baseline; rejection commits neither settings nor checkpoint');
  assert.deepEqual(settingsRuntime.lastFrameOutcome, last);
  const retry = settingsRuntime.step({ nowMs: 1, contextFacts: facts(1, [], { ...request, baseRevision: 0 }) });
  assert.equal(retry.vm.safe.ready, true, 'correcting only the baseline admits the same event and scan');
  assert.equal(settingsRuntime.contextSnapshot().state.settingsRevision, 1);

  const snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'run.ref-07-002.previous',
    completion: { kind: 'completed-scan', scanId: 1, logicalTimeMs: 1 }, trace: fault.vm });
  const expected = expectedRuntimeIdentity(artifact.interactionSchema, 'run.ref-07-002.current');
  const mismatch = joinRuntimeSnapshot(artifact.interactionSchema, snapshot, expected);
  assert.deepEqual(mismatch, { status: 'stale', staleReasons: ['runId'] });
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot,
    expectedRuntimeIdentity(artifact.interactionSchema, snapshot.runId)), { status: 'ready', staleReasons: [] });
  assert.deepEqual(runtime.lastFrameOutcome.trace, fault.vm, 'consumer identity correction never executes or modifies control');

  const records = wire({ compiler, fault, schedule: { facts: facts(0, rows, null, false), trace: unknown.vm },
    settings: { request, rejection, before: before.state, after: after.state }, observation: { snapshot, expected, mismatch } });
  // A catalog consumer must retain every producer's own discriminants. This
  // oracle deliberately fails when any one record is flattened to generic
  // failure, even though both real faults and normal decisions may output false.
  const assertKinds = received => {
    assert.equal(received.compiler.format, 'GhostFlow/diagnostics-v1');
    assert.equal(received.compiler.diagnostics[0].code, 'GF_TYPE');
    assert.equal(received.fault.sensors.reading.quality, 'Disconnected');
    assert.deepEqual(received.fault.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })), [{ choice: 1, origin }]);
    assert.match(received.schedule.trace.contextTrace.find(row => row.site === site).decision, /Unknown.*ClockUnknown/);
    assert.equal(received.settings.rejection.name, 'NativeDispatchError');
    assert.equal(received.settings.rejection.committed, false);
    assert.match(received.settings.rejection.message, /invalid or stale settings transaction/);
    assert.deepEqual(received.observation.mismatch, { status: 'stale', staleReasons: ['runId'] });
  };
  assertKinds(records);
  for (const key of Object.keys(records)) for (const collapsed of [false, { status: 'failure' }]) {
    assert.throws(() => assertKinds({ ...records, [key]: collapsed }), `${key}: generic collapse must lose the required oracle`);
  }
  assert.deepEqual(records.compiler, compiler);
  assert.equal(records.compiler.diagnostics[0].code, 'GF_TYPE');
  assert.equal(records.compiler.source.revisionId, 'revision.ref-07-002.1');
  assert.equal(records.compiler.diagnostics[0].span.file, 'ref-07-002.ghost.md');
  assert.equal(records.fault.vm.module, artifact.interactionSchema.module.moduleFingerprint);
  assert.deepEqual(records.fault.sensors, wire(fault.sensors));
  assert.deepEqual(records.fault.vm.resultTrace, wire(fault.vm.resultTrace));
  assert.deepEqual(records.schedule.trace.contextTrace, wire(unknown.vm.contextTrace));
  assert.equal(records.schedule.trace.module, scheduled.interactionSchema.module.moduleFingerprint);
  assert.equal(records.schedule.facts.clock.sourceRevision, 'rtc.ref-07-002.1');
  assert.deepEqual(records.settings.request, request);
  assert.deepEqual(records.settings.rejection, rejection);
  assert.equal(records.settings.before.programFingerprint, request.programFingerprint);
  assert.deepEqual(records.observation.snapshot, wire(snapshot));
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, records.observation.snapshot, expected), mismatch);
  // Existing contracts reject generic collapse where a structured validator exists.
  for (const collapsed of [false, { status: 'failure' }]) {
    assert.equal(validateInteraction(artifact.interactionSchema, collapsed).valid, false);
    assert.throws(() => joinRuntimeSnapshot(artifact.interactionSchema, collapsed, expected));
  }
  const next = runtime.step({ nowMs: 2, samples: { reading: sample(2, 'Good', 3) } });
  assert.equal(next.vm.safe.value, 3, 'input producer correction restores the normal payload');
  assert.equal(next.sensors.reading.quality, 'Good');
});

test('REF-07-002: executable catalog links the exact five-record oracle and preserves the issue backlink', () => {
  const cases = JSON.parse(read('tests/reference/cases-input-v1/03-settings-boundaries.json')).cases;
  const catalog = JSON.parse(read('contracts/feature-status/catalog.json'));
  assert.equal(cases.find(entry => entry.id === 'REF-07-002').issue, 'https://github.com/callin2/ghostflow-language/issues/311');
  const feature = catalog.entries.find(entry => entry.id === 'diagnostic-kind-boundaries');
  assert.deepEqual(feature.issues, [311]);
  for (const evidence of feature.evidence) for (const ref of evidence.refs) {
    assert.equal(evidence.status, 'verified');
    assert.equal(ref.caseId, 'REF-07-002');
    assert.equal(ref.path, 'tests/reference-diagnostic-kinds.test.mjs');
    assert.equal(ref.testId, 'REF-07-002: five owner-produced records retain causes provenance and distinct execution effects through serialization');
  }
  assert.ok(read('tools/verify-language.mjs').includes("  'tests/reference-diagnostic-kinds.test.mjs',"));
  assert.ok(externalOracleCaseIds(catalog, cases).has('REF-07-002'));
});
