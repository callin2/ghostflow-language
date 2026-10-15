import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { emitCompletedScanSnapshot, expectedRuntimeIdentity, joinRuntimeSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { externalOracleCaseIds } from '../tools/reference-evidence.mjs';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const copy = value => JSON.parse(JSON.stringify(value));
const document = code => '# Diagnostic owner fixture\n\n<!-- ghostflow:anchor id=GF-INT-DIAGNOSTIC-OWNERS kind=intent status=confirmed origin=user -->\nPreserve the cause and execution effect at each owner boundary.\n\n```ghost\n' + code + '\n```\n';
const compile = code => compileSource(document(code), { filename: 'diagnostic-owners.ghost.md',
  interactionSourceIdentity: { documentId: 'diagnostic-owners', revisionId: 'diagnostic-owners.r1' } });
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const facts = (ms, trusted = true, settings = null, schedules = []) => ({ clock: { monotonicMs: ms, bootEpoch: 1, wallMs: trusted ? ms : null,
  uncertaintyMs: 0, trusted, unknownReason: trusted ? null : 'TrustExpired', sourceRevision: 'diagnostic-clock.r1' }, natural: [], schedules, settings });

test('REF-07-002 preserves five owner diagnostics without collapsing execution effects', async t => {
  let compiler;
  const invalid = 'control Broken { output permit: Bool; permit <- 3; }';
  await assert.rejects(compile(invalid), error => { compiler = error.diagnosticEnvelope; return compiler?.diagnostics[0].code === 'GF_TYPE'; });
  assert.equal(compiler.source.sha256, createHash('sha256').update(document(invalid)).digest('hex'));

  const artifact = await compile(`control InputOwner {
    input demand: Bool;
    // ghostflow:link id=GF-INT-DIAGNOSTIC-OWNERS relation=implements
    state observed: Bool = false;
    observed' = demand |> recover(false);
    output permit: Bool; permit <- observed';
  }`);
  const input = await ControlRuntime.instantiateFramed(wasm, artifact); t.after(() => input.dispose());
  const sample = (id, quality, value) => ({ epoch: 1, id, timestampMs: id, quality, value });
  const normalFalse = input.step({ nowMs: 0, samples: { demand: sample(0, 'Good', false) } });
  const fault = input.step({ nowMs: 1, samples: { demand: sample(1, 'Disconnected', true) } });
  assert.equal(normalFalse.vm.safe.permit, false); assert.equal(fault.vm.safe.permit, false);
  assert.equal(normalFalse.sensors.demand.quality, 'Good');
  const origin = artifact.sourceMap.find(node => node.kind === 'sensor').id;

  const scheduled = await compile(`control ClockOwner {
    schedule work: Daily { timezone = "UTC"; at = time\`00:01\`; basis = range(1min);
      dst_missing = skip; dst_repeated = first; when = true; cancel_when = false;
      clock = trusted_only; gap = skip_after(1min); recovery = baseline; fallback = skip; }
    output permit: Bool; permit <- work.active;
  }`);
  const clock = await ControlRuntime.instantiateFramed(wasm, scheduled, { context: activation }); t.after(() => clock.dispose());
  const site = scheduled.manifest.schedules[0].site;
  const coverage = [{ site, coverageStartMs: 0, coverageEndMs: 180000, provider: null, calendar: null, rows: [] }];
  const unknown = clock.step({ nowMs: 0, contextFacts: facts(0, false, null, coverage) });
  assert.equal(unknown.vm.safe.permit, false);
  const known = await ControlRuntime.instantiateFramed(wasm, scheduled, { context: activation }); t.after(() => known.dispose());
  const notDue = known.step({ nowMs: 0, contextFacts: facts(0, true, null, coverage) });
  assert.equal(notDue.vm.safe.permit, false);
  assert.equal(known.step({ nowMs: 60000, contextFacts: facts(60000, true, null, coverage) }).vm.safe.permit, true);

  const settingArtifact = await compileSource(read('contracts/interaction-v0/examples/operator-settings.ghost.md'), {
    filename: 'operator-settings.ghost.md', interactionSourceIdentity: { documentId: 'diagnostic-settings', revisionId: 'diagnostic-settings.r1' } });
  const settings = await ControlRuntime.instantiateFramed(wasm, settingArtifact, { context: activation }); t.after(() => settings.dispose());
  settings.step({ nowMs: 0, contextFacts: facts(0) });
  const before = settings.contextSnapshot(), previousOutcome = copy(settings.lastFrameOutcome);
  const request = { programFingerprint: before.state.programFingerprint, eventId: 'diagnostic-settings.1', baseRevision: 1, position: 2, origin: 'operatorEdit',
    changes: [{ configId: settingArtifact.manifest.configs.find(config => config.name === 'enabled').id, result: { ok: true, type: 'Bool', value: true } }] };
  let rejection;
  assert.throws(() => settings.step({ nowMs: 1, contextFacts: facts(1, true, request) }), error => {
    rejection = { name: error.name, committed: error.committed, message: error.message }; return error.committed === false;
  });
  assert.deepEqual(settings.contextSnapshot(), before); assert.deepEqual(settings.lastFrameOutcome, previousOutcome);
  assert.equal(settings.step({ nowMs: 1, contextFacts: facts(1, true, { ...request, baseRevision: 0 }) }).vm.safe.ready, true);
  assert.equal(settings.contextSnapshot().state.settingsRevision, 1);

  const snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId: 'diagnostic-run.previous', completion: { kind: 'completed-scan', scanId: 1, logicalTimeMs: 1 }, trace: fault.vm });
  const expected = expectedRuntimeIdentity(artifact.interactionSchema, 'diagnostic-run.current');
  const mismatch = joinRuntimeSnapshot(artifact.interactionSchema, snapshot, expected);
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot, expectedRuntimeIdentity(artifact.interactionSchema, snapshot.runId)), { status: 'ready', staleReasons: [] });
  assert.deepEqual(input.lastFrameOutcome.trace, fault.vm, 'observation rejection cannot execute control');

  // Test collection only: these are the existing producers' own records, not a
  // new diagnostic protocol or an inferred physical cause/application receipt.
  const records = { compiler, fault, schedule: unknown.vm,
    settings: { request, rejection, before: before.state, checkpointSha256: createHash('sha256').update(before.bytes).digest('hex') },
    observation: { snapshot, expected, mismatch } };
  const distinguish = values => {
    assert.equal(values.compiler.format, 'GhostFlow/diagnostics-v1'); assert.equal(values.compiler.diagnostics[0].code, 'GF_TYPE');
    assert.equal(values.compiler.source.revisionId, 'diagnostic-owners.r1');
    assert.equal(values.fault.sensors.demand.quality, 'Disconnected');
    assert.deepEqual(values.fault.vm.resultTrace.map(row => ({ choice: row.choice, origin: row.origin })), [{ choice: 1, origin }]);
    assert.match(values.schedule.contextTrace.find(row => row.site === site).decision, /Unknown.*ClockUnknown/);
    assert.equal(values.settings.rejection.name, 'NativeDispatchError'); assert.equal(values.settings.rejection.committed, false);
    assert.match(values.settings.rejection.message, /invalid or stale settings transaction/);
    assert.equal(values.settings.before.programFingerprint, values.settings.request.programFingerprint);
    assert.equal(values.settings.checkpointSha256, createHash('sha256').update(before.bytes).digest('hex'));
    assert.deepEqual(values.observation.mismatch, { status: 'stale', staleReasons: ['runId'] });
    assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, values.observation.snapshot, values.observation.expected), values.observation.mismatch);
  };
  const serialized = copy(records); distinguish(serialized); assert.deepEqual(serialized, records);
  for (const category of Object.keys(records)) for (const collapsed of [false, { status: 'failure' }]) {
    assert.throws(() => distinguish({ ...serialized, [category]: collapsed }), `${category}: a generic failure loses the required owner evidence`);
  }
  assert.equal(input.step({ nowMs: 2, samples: { demand: sample(2, 'Good', true) } }).vm.safe.permit, true);
});

test('REF-07-002 diagnostic oracle is active and linked to the current catalog and original issue', () => {
  const cases = JSON.parse(read('tests/reference/cases/03-settings-boundaries.json')).cases;
  const catalog = JSON.parse(read('contracts/feature-status/catalog.json'));
  assert.equal(cases.find(entry => entry.id === 'REF-07-002').issue, 'https://github.com/callin2/ghostflow-language/issues/311');
  assert.equal(JSON.parse(read('tests/reference/cases-input-v1/03-settings-boundaries.json')).cases.find(entry => entry.id === 'REF-07-002').issue,
    'https://github.com/callin2/ghostflow-language/issues/311');
  const row = catalog.entries.find(entry => entry.id === 'diagnostic-owner-boundaries'); assert.ok(row);
  assert.deepEqual(row.referenceCaseIds, ['REF-07-002']); assert.deepEqual(row.issues, [311]);
  assert.equal(row.evidence[0].refs[0].testId, 'REF-07-002 preserves five owner diagnostics without collapsing execution effects');
  assert.equal(row.evidence[0].refs[0].path, 'tests/diagnostic-owner-boundaries.test.mjs');
  assert.ok(read('tools/verify-language.mjs').includes("  'tests/diagnostic-owner-boundaries.test.mjs',"));
  assert.ok(externalOracleCaseIds(catalog, cases).has('REF-07-002'));
});
