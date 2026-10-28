import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { jsonSha256, SCHEMAS } from '../tools/integration-contract.mjs';
import { InstalledControlHost } from '../runtimes/wasm/installed-control-host.mjs';

const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const document = code => `# Installed cells

<!-- ghostflow:anchor id=cell-intent kind=intent status=confirmed origin=user -->
Each installed cell keeps its own state and operating duration.

\`\`\`ghost
${code}
\`\`\`
`;
function compile({ output = 'running', childStale = '3s', rootStale = '4s', type = 'Bool', valid = '', rootValid = valid, extra = '' } = {}) {
  const cell = document(`control Cell {
  input start: ${type} { sample = 1s; stale_after = ${childStale}; ${valid} }
  // ghostflow:link id=cell-intent relation=implements
  config duration: Duration = 5s { min = 1s; max = 10s; step = 1s; access = operator; }
  // ghostflow:link id=cell-intent relation=implements
  state running: Bool = false;
  // ghostflow:link id=cell-intent relation=implements
  timer age = elapsed(running);
  ${extra}
  running' = ${type === 'Bool' ? 'start |> recover(false)' : 'case start { ok(value) => value > 0; fault(_) => false; }'};
  output on: Bool;
  on <- ${output};
}`);
  const root = document(`import Cell from "./cell.ghost.md" revision "cell-r1" sha256 "${sha256Hex(cell)}";
control Pair {
  input east_start, west_start: ${type} { sample = 1s; stale_after = ${rootStale}; ${rootValid} }
  output east_on, west_on: Bool;
  instance east: Cell;
  instance west: Cell;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_on <- east.on;
  connect west_on <- west.on;
}`);
  return compileSourceSync(root, { filename: 'pair.ghost.md',
    sourceClosure: [{ filename: 'cell.ghost.md', revision: 'cell-r1', text: cell }],
    interactionSourceIdentity: { documentId: 'pair', revisionId: 'pair-r1' } });
}
const artifact = compile();
function repin(candidate) {
  const sha256 = jsonSha256(candidate.boardProfile);
  candidate.release.device.boardProfile.sha256 = sha256;
  candidate.installation.boardProfile.sha256 = sha256;
  candidate.release.installation.sha256 = jsonSha256(candidate.installation);
  return candidate;
}
function installation(revision = 'r1', type = 'Bool', gap = 1000) {
  const sensor = { format: SCHEMAS.sensorObservation, canonicalUnit: null, maxInterSampleGapMs: gap,
    ...(type === 'Number' ? { minValue: 0, maxValue: 100 } : {}) };
  const boardProfile = { schema: SCHEMAS.profileV2, id: 'board', revision, boardModel: 'REFERENCE-ONLY', endpoints: {
    eastInput: { direction: 'input', type, driver: 'fixture', address: `east/${revision}`, sensor },
    westInput: { direction: 'input', type, driver: 'fixture', address: `west/${revision}`, sensor },
    eastRelay: { direction: 'output', type: 'Bool', driver: 'fixture', address: 'east/relay', activeLevel: 'high', safeLevel: 0 },
    westRelay: { direction: 'output', type: 'Bool', driver: 'fixture', address: 'west/relay', activeLevel: 'high', safeLevel: 0 },
  } };
  const profile = { id: 'board', revision, sha256: jsonSha256(boardProfile) };
  const installation = { schema: SCHEMAS.installation, id: 'site', revision, boardProfile: profile,
    bindings: { east_start: 'eastInput', west_start: 'westInput', east_on: 'eastRelay', west_on: 'westRelay' } };
  const release = { schema: SCHEMAS.release, toolchain: { version: 'reference', sha256: '1'.repeat(64) },
    runtimeSemanticsVersion: 'reference-host', bytecodeFormat: 'GFB1', protocolVersion: 'reference',
    device: { firmwareSha256: '2'.repeat(64), boardProfile: profile },
    installation: { id: 'site', revision, sha256: jsonSha256(installation) } };
  return { release, boardProfile, installation };
}
const create = (compiled = artifact, candidate = installation()) => InstalledControlHost.instantiate(wasm, compiled,
  { runId: 'run-1', ...candidate, grants: { east: [compiled.manifest.configs[0].id], west: [compiled.manifest.configs[1].id] },
    context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
const frame = (nowMs, id, east = false, west = false, revision = 'r1') => ({ bindingRevision: revision, nowMs,
  samples: Object.fromEntries([['east_start', east, 'eastInput'], ['west_start', west, 'westInput']].map(([name, value, endpointId]) => [name,
    { bindingRevision: revision, endpointId, sample: { epoch: 1, id, timestampMs: nowMs, quality: 'Good', value } }])),
  contextFacts: { clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: nowMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'clock-r1' }, natural: [], schedules: [], settings: null } });
function setting(host, kind = 'ordinary') {
  const state = host.snapshot().execution;
  return { kind, eventId: `east-${kind}`, actor: 'east', reason: 'change east duration',
    programFingerprint: state.programFingerprint, sourceSha256: state.sourceSha256, runId: state.runId,
    baseRevision: state.core.state.settingsRevision,
    changes: [{ configId: artifact.manifest.configs[0].id, result: { ok: true, type: 'Duration', value: 1000 } }],
    ...(kind === 'temporary' ? { lifetime: { kind: 'Run' } } : {}) };
}
const mutate = (value, change) => { const result = structuredClone(value); change(result); return result; };

test('installed composition keeps actual east and west settings, state, timers and binding routes independent', async t => {
  const host = await create(); t.after(() => host.dispose());
  host.step(frame(0, 1, false, true));
  const before = host.step(frame(1000, 2, false, true));
  const changed = host.step(frame(1000, 3, true, true), setting(host));
  assert.equal(changed.vm.stateAfter.instance_4_east_running, true);
  assert.equal(changed.vm.stateAfter.instance_4_west_running, true);
  const westBefore = before.execution.observation.snapshot.observations.filter(value => value.instance === 'west');
  const westAfter = changed.execution.observation.snapshot.observations.filter(value => value.instance === 'west');
  assert.equal(westBefore.length, 3);
  assert.equal(westBefore.find(value => value.descriptorId === 'timer.age').value, 1000);
  assert.deepEqual(westAfter, westBefore);
  const settings = changed.execution.snapshot.core.state.settings;
  assert.deepEqual(settings.map(setting => [setting.result.value, setting.emissionRevision]), [[1000, 1], [5000, 0]]);
  assert.deepEqual(changed.provenance.routes.inputs[1], before.provenance.routes.inputs[1]);
  assert.deepEqual(changed.provenance.routes.outputs[1], before.provenance.routes.outputs[1]);
  assert.equal(changed.provenance.bindingRevision, before.provenance.bindingRevision);
  assert.deepEqual(changed.provenance.routes.outputs.map(route => route.endpointId), ['eastRelay', 'westRelay']);
  assert.equal(changed.provenance.routes.inputs[0].definition.sha256, artifact.sourceClosure.documents[0].sha256);
  assert.equal(changed.assessment.physical.status, 'unknown');
  const result = host.step(frame(2000, 4, true, true));
  const joined = host.explainOutput('output.east_on', result);
  assert.equal(joined.status, 'ready');
  assert.equal(joined.installation.settingsRevision, 1);
  assert.equal(joined.outputRoute.instance, 'east');
  assert.equal(joined.outputRoute.endpointId, 'eastRelay');
  assert.equal(joined.inputRoutes[0].endpointId, 'eastInput');
  assert.deepEqual(joined.effectiveSettings.map(setting => setting.result.value), [1000]);
  assert.deepEqual(joined.installation.admission, result.assessment.identity);
  assert.equal(result.execution.explanation.proofs[0].status, 'ready');
  assert.equal(result.execution.explanation.proofs[0].value, true);
  assert.throws(() => host.explainOutput('output.east_on', before), /current owned/);
  for (const change of [
    c => { c.provenance.routes.outputs[0].endpointId = 'westRelay'; },
    c => { c.provenance.routes.inputs[0].instance = 'west'; },
    c => { c.provenance.bindingRevision = 'old'; },
    c => { c.provenance.settingsRevision = 0; },
    c => { c.provenance.routes.sourceClosureSha256 = '0'.repeat(64); },
    c => { c.execution.snapshot.core.state.settings[0].result.value = 5000; },
  ]) assert.throws(() => host.explainOutput('output.east_on', mutate(result, change)), /current owned/);
});

test('REF-06-016 installed explanations keep each instance occurrence and exact provenance', async t => {
  const host = await create(); t.after(() => host.dispose());
  host.step(frame(0, 1, true, false));
  const completed = host.step(frame(1000, 2, true, false), setting(host));
  assert.deepEqual(completed.vm.safe, { east_on: true, west_on: false });

  const east = host.explainOutput('output.east_on', completed);
  const west = host.explainOutput('output.west_on', completed);
  const closure = artifact.sourceClosure.documents[0];
  const sourceClosureSha256 = sha256Hex(canonicalJson(artifact.sourceClosure));
  const expected = [
    [east, 'east', 'eastInput', 'eastRelay', true, 1000],
    [west, 'west', 'westInput', 'westRelay', false, 5000],
  ];
  for (const [explanation, instance, inputEndpoint, outputEndpoint, value, duration] of expected) {
    assert.equal(explanation.status, 'ready');
    assert.equal(explanation.proof.status, 'ready');
    assert.equal(explanation.proof.value, value);
    assert.equal(explanation.installation.scanId, completed.frame.scanId);
    assert.equal(explanation.installation.logicalTimeMs, completed.frame.logicalTimeMs);
    assert.equal(explanation.installation.settingsRevision, 1);
    assert.equal(explanation.installation.bindingRevision, 'r1');
    assert.equal(explanation.installation.routes.sourceClosureSha256, sourceClosureSha256);
    assert.equal(explanation.outputRoute.instance, instance);
    assert.equal(explanation.outputRoute.endpointId, outputEndpoint);
    assert.deepEqual(explanation.inputRoutes.map(route => route.endpointId), [inputEndpoint]);
    assert.deepEqual(explanation.effectiveSettings.map(setting => setting.result.value), [duration]);
    assert.deepEqual(explanation.outputRoute.definition,
      { filename: closure.filename, revision: closure.revision, sha256: closure.sha256 });

    const occurrences = explanation.proof.evaluations.filter(evaluation => evaluation.source?.sourceNode?.instance === instance);
    assert.ok(occurrences.length > 0);
    for (const occurrence of occurrences) {
      const source = occurrence.source.sourceNode;
      const node = artifact.sourceMap.find(node => node.id === source.nodeId);
      assert.ok(node);
      assert.deepEqual(source, {
        nodeId: node.id, definitionNodeId: node.definitionNodeId, instance,
        filename: closure.filename, line: node.line, column: node.column,
        endLine: node.endLine, endColumn: node.endColumn,
        sourceSha256: closure.sha256, sourceRevision: closure.revision,
      });
      assert.equal(occurrence.occurrenceId.startsWith(`output.${instance}_on:`), true);
    }
    assert.equal(explanation.proof.evaluations.some(evaluation =>
      evaluation.source?.sourceNode?.instance === (instance === 'east' ? 'west' : 'east')), false);
  }
  const eastNodes = east.proof.evaluations.filter(item => item.source?.sourceNode?.instance === 'east');
  const westNodes = west.proof.evaluations.filter(item => item.source?.sourceNode?.instance === 'west');
  assert.notEqual(eastNodes[0].source.sourceNode.nodeId, westNodes[0].source.sourceNode.nodeId);
  assert.equal(eastNodes[0].source.sourceNode.definitionNodeId, westNodes[0].source.sourceNode.definitionNodeId);
});

test('installed acquisition rejection precedes settings commit and preserves the last completed proof', async t => {
  const host = await create(); t.after(() => host.dispose());
  host.step(frame(0, 1, true, true));
  const before = host.snapshot();
  for (const change of [
    f => { f.bindingRevision = 'old'; },
    f => { f.samples.east_start.bindingRevision = 'old'; },
    f => { f.samples.east_start.endpointId = 'westInput'; },
    f => { f.samples.east_start.sample.timestampMs = 1001; },
    f => { f.samples.east_start.sample.id = -1; },
    f => { f.samples.east_start.sample.quality = 'Invented'; },
    f => { f.samples.east_start.sample.value = 0; },
  ]) {
    assert.throws(() => host.step(mutate(frame(1000, 2, true, true), change), setting(host)), /binding revision|endpoint mismatch|invalid acquired sample/);
    assert.deepEqual(host.snapshot(), before);
    assert.equal(host.explainOutput('output.east_on').status, 'ready');
  }
  const invalid = frame(1000, 2, true, true);
  invalid.samples.east_start.sample.quality = 'Invalid';
  const fault = host.step(invalid);
  assert.equal(fault.sensors.east_start.quality, 'Invalid');
  assert.equal(fault.vm.stateAfter.instance_4_east_running, false);
  const staleFrame = frame(5000, 3); staleFrame.samples = {};
  const stale = host.step(staleFrame);
  assert.equal(stale.sensors.west_start.quality, 'Stale');
  assert.equal(stale.vm.stateAfter.instance_4_west_running, false);
});

test('installation checks every child sensor against its actual admitted endpoint', async () => {
  await assert.rejects(create(artifact, installation('r1', 'Bool', 3000)), /instance sensor contract east.start/);
  const number = compile({ type: 'Number', valid: 'valid = -10 .. 110;', rootValid: 'valid = 0 .. 100;' });
  await assert.rejects(create(number, installation('r1', 'Number')), /instance sensor contract east.start/);
  for (const change of [
    c => { c.sourceClosure.documents[0].revision = 'old'; },
    c => { c.sourceClosure.documents[0].text += '\nchanged'; },
    c => { c.sourceClosure.instances[0].instance = 'west'; },
    c => { c.manifest.sensorInstances[0].sourceSensor = 'west_start'; },
    c => { c.sourceMap.find(node => node.instance === 'east').line += 1; },
  ]) await assert.rejects(create(mutate(artifact, change)), /revision mismatch|digest mismatch|differs from compiler output|source, manifest/);
});

test('failed replacement preserves settings, overlays, history, conditioners, state, timers and latest proof; success starts fresh', async t => {
  const host = await create(); t.after(() => host.dispose());
  host.step(frame(0, 1, true, true));
  host.step(frame(1000, 2, true, true), setting(host, 'temporary'));
  const before = host.snapshot();
  const bad = installation('r2', 'Bool', 3000);
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...bad }), /instance sensor contract/);
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.explainOutput('output.east_on').status, 'ready');
  const changedOutput = installation('r2');
  changedOutput.installation.bindings.east_on = 'westRelay';
  changedOutput.installation.bindings.west_on = 'eastRelay'; repin(changedOutput);
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...changedOutput }), /changes output binding/);
  assert.deepEqual(host.snapshot(), before);
  await host.replaceBinding({ runId: 'run-2', ...installation('r2') });
  const fresh = host.snapshot();
  assert.equal(fresh.latest, null);
  assert.deepEqual(fresh.execution.overlays, []);
  assert.deepEqual(fresh.execution.history, []);
  assert.equal(fresh.execution.core.state.settingsRevision, 0);
  assert.deepEqual(fresh.execution.core.state.settings.map(setting => setting.result.value), [5000, 5000]);
  assert.throws(() => host.explainOutput('output.east_on', before.latest), /current owned/);
  const result = host.step(frame(0, 1, false, false, 'r2'));
  assert.deepEqual(result.vm.safe, { east_on: false, west_on: false });
  assert.equal(result.provenance.runId, 'run-2');
  assert.equal(result.provenance.bindingRevision, 'r2');
  assert.equal(result.assessment.physical.status, 'unknown');
});

test('installed config and timer expressions retain unavailable explanation status', async t => {
  const timed = compile({ output: "running' && age < (duration |> recover(0s))" });
  const host = await create(timed); t.after(() => host.dispose());
  const result = host.step(frame(0, 1, true, false));
  assert.deepEqual(result.vm.safe, { east_on: true, west_on: false });
  assert.ok(result.execution.explanation.proofs.every(proof => proof.status === 'unavailable'));
  const before = host.step(frame(1000, 2, true, true));
  const changed = host.step(frame(1000, 3, true, true), setting(host));
  assert.deepEqual(changed.vm.safe, { east_on: false, west_on: true });
  const west = result => result.execution.observation.snapshot.observations.filter(value => value.instance === 'west');
  assert.deepEqual(west(changed), west(before));
  assert.ok(changed.execution.explanation.proofs.every(proof => proof.status === 'unavailable'));
  assert.equal(host.explainOutput('output.east_on').proof.status, 'unavailable');
});

test('installed instance conditioners retain sample identity and their own freshness boundaries', async t => {
  const host = await create(); t.after(() => host.dispose());
  host.step(frame(0, 1, true, true));
  const repeated = host.step(frame(1000, 1, false, false));
  assert.equal(repeated.vm.stateAfter.instance_4_east_running, true);
  assert.equal(repeated.vm.stateAfter.instance_4_west_running, true);
  const noSample = frame(3000, 2); noSample.samples = {};
  const expired = host.step(noSample);
  assert.equal(expired.sensors.east_start.quality, 'Good');
  assert.equal(expired.sensors.instance_4_east_start.quality, 'Stale');
  assert.equal(expired.vm.stateAfter.instance_4_east_running, false);
  const recovered = host.step(frame(3000, 2, true, false));
  assert.equal(recovered.vm.stateAfter.instance_4_east_running, true);
  assert.equal(recovered.vm.stateAfter.instance_4_west_running, false);
});

test('installed route projection rejects otherwise valid root computations', async () => {
  const source = artifact.sourceDocument.text.replace('control Pair {',
    'control Pair {\n  // ghostflow:link id=cell-intent relation=implements\n  state extra: Bool = false;');
  const compiled = compileSourceSync(source, { filename: artifact.sourceDocument.filename,
    sourceClosure: artifact.sourceClosure.documents, interactionSourceIdentity: artifact.interactionSourceIdentity });
  await assert.rejects(create(compiled), /root requires direct instance port connections/);
});

test('failed actual installed scan invalidates current explanation without rewriting the historical completion', async t => {
  const compiled = compile({ output: 'running && (1.0 / divisor > 0.0)',
    extra: '// ghostflow:link id=cell-intent relation=implements\n  state divisor: Number = 0.0;' });
  const host = await create(compiled); t.after(() => host.dispose());
  const accepted = host.step(frame(0, 1, true, false));
  const historical = structuredClone(accepted);
  assert.equal(host.explainOutput('output.east_on').status, 'ready');
  assert.deepEqual(host.snapshot().currentFrameCompletion, accepted.frame);
  assert.throws(() => host.step(frame(1000, 2, true, false)), /division by zero/);
  assert.equal(host.snapshot().currentFrameCompletion, null);
  assert.throws(() => host.explainOutput('output.east_on'), /current owned installed completion/);
  assert.throws(() => host.explainOutput('output.east_on', accepted), /current owned installed completion/);
  assert.deepEqual(accepted, historical);
  assert.deepEqual(host.snapshot().latest, historical);
  await host.replaceBinding({ runId: 'run-2', ...installation('r2') });
  host.step(frame(0, 1, false, false, 'r2'));
  assert.equal(host.explainOutput('output.east_on').status, 'ready');
});

test('nonaccepted installed runtime execution invalidates current proof while preflight rejection preserves it', async t => {
  const compiled = compile({ output: 'running && (1.0 / divisor > 0.0)',
    extra: '// ghostflow:link id=cell-intent relation=implements\n  state divisor: Number = 0.0;' });
  const host = await create(compiled); t.after(() => host.dispose());
  const accepted = host.step(frame(0, 1, true, false), setting(host, 'temporary'));
  const before = host.snapshot();
  assert.throws(() => host.step(frame(1000, 2, true, false),
    mutate(setting(host), event => { event.actor = 'unknown'; })), /permission/);
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.explainOutput('output.east_on').status, 'ready');
  assert.throws(() => host.step(mutate(frame(1000, 2, true, false), packet => {
    packet.contextFacts.clock.monotonicMs = -1;
  })), /monotonic|clock/);
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.explainOutput('output.east_on').status, 'ready');
  const rejected = host.step(frame(1000, 2, true, false), setting(host));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'settings-unavailable');
  assert.throws(() => host.explainOutput('output.east_on'), /current owned installed completion/);
  assert.deepEqual(host.snapshot().latest, accepted);
});
