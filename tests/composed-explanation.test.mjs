import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { prepareOutputExplanation, joinOutputExplanation } from '../tools/explanation.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { TemporarySettingsHost } from '../runtimes/wasm/temporary-settings-host.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const document = code => `# Independent cells

<!-- ghostflow:anchor id=cell-intent kind=intent status=confirmed origin=user -->
Each cell keeps its own requested output.

\`\`\`ghost
${code}
\`\`\`
`;
function compile(expression = 'running && true', extra = '') {
  const cell = document(`control Cell {
  input start: Bool;
  // ghostflow:link id=cell-intent relation=implements
  config unused: Bool = false { access = operator; }
  // ghostflow:link id=cell-intent relation=implements
  state running: Bool = false;
  running' = start |> recover(false);
  ${extra}
  output on: Bool;
  on <- ${expression};
}`);
  const source = document(`import Cell from "./cell.ghost.md" revision "cell-r1" sha256 "${sha256Hex(cell)}";
control Pair {
  input east_start, west_start: Bool;
  output east_on, west_on: Bool;
  instance east: Cell;
  instance west: Cell;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_on <- east.on;
  connect west_on <- west.on;
}`);
  return compileSourceSync(source, { filename: 'pair.ghost.md',
    sourceClosure: [{ filename: 'cell.ghost.md', revision: 'cell-r1', text: cell }],
    interactionSourceIdentity: { documentId: 'pair', revisionId: 'pair-r1' } });
}
const artifact = compile();
const packet = (nowMs, east = false, west = false) => ({ nowMs,
  samples: Object.fromEntries(Object.entries({ east_start: east, west_start: west }).map(([name, value]) => [name,
    { epoch: 1, id: nowMs + 1, timestampMs: nowMs, quality: 'Good', value }])),
  contextFacts: { clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: nowMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'clock-r1' }, natural: [], schedules: [], settings: null },
});
const create = (compiled = artifact, options = {}) => TemporarySettingsHost.instantiate(wasm, compiled,
  { runId: 'pair-run', outputExplanations: true, grants: { operator: compiled.manifest.configs.map(config => config.id) },
    context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] }, ...options });
function edit(host, eventId = 'east-setting') {
  const before = host.snapshot();
  return { kind: 'ordinary', eventId, actor: 'operator', reason: 'change east setting',
    programFingerprint: before.programFingerprint, sourceSha256: before.sourceSha256, runId: before.runId,
    baseRevision: before.core.state.settingsRevision,
    changes: [{ configId: artifact.manifest.configs[0].id, result: { ok: true, type: 'Bool', value: true } }] };
}
const proofFor = (result, outputId = 'output.east_on') => result.explanation.proofs.find(proof => proof.outputId === outputId);
const mutated = (value, change) => { const copy = structuredClone(value); change(copy); return copy; };

test('composed output explanation uses actual owned WASM witnesses and distinct imported state provenance', async t => {
  const host = await create();
  t.after(() => host.dispose());
  assert.deepEqual(host.explanationSnapshot(), { proofs: [], error: null });
  host.step(packet(0, true, false));
  const result = host.step(packet(1000, false, true), edit(host));
  assert.equal(result.accepted, true);
  assert.equal(result.explanation.error, null);
  assert.deepEqual(result.explanation.proofs.map(proof => [proof.outputId, proof.status, proof.value, proof.settingsRevision]),
    [['output.east_on', 'ready', true, 1], ['output.west_on', 'ready', false, 1]]);
  assert.ok(result.outcome.vm.instructionWitnesses.length > 0);
  assert.deepEqual(result.explanation, host.explanationSnapshot());
  const descriptor = host.explanationDescriptor;
  const east = descriptor.nodes.find(node => node.label === 'east.running');
  const west = descriptor.nodes.find(node => node.label === 'west.running');
  assert.notEqual(east.id, west.id);
  const eastSource = east.sources[0].sourceNode, westSource = west.sources[0].sourceNode;
  assert.notEqual(eastSource.nodeId, westSource.nodeId);
  assert.equal(eastSource.definitionNodeId, westSource.definitionNodeId);
  for (const [instance, source] of [['east', eastSource], ['west', westSource]]) {
    assert.equal(source.instance, instance);
    assert.equal(source.filename, 'cell.ghost.md');
    assert.equal(source.sourceRevision, 'cell-r1');
    assert.equal(source.sourceSha256, artifact.sourceClosure.documents[0].sha256);
    const node = artifact.sourceMap.find(node => node.id === source.nodeId);
    assert.deepEqual([source.line, source.column, source.endLine, source.endColumn],
      [node.line, node.column, node.endLine, node.endColumn]);
  }
  assert.equal(east.sources[0].intentProvenance[0].anchorId, 'cell-intent');
  const eastProof = proofFor(result), westProof = proofFor(result, 'output.west_on');
  assert.equal(eastProof.evaluations.find(item => item.nodeId === east.id).value, true);
  assert.equal(westProof.evaluations.find(item => item.nodeId === west.id).value, false);
  assert.ok(westProof.evaluations.some(item => item.reason === 'not-evaluated' && !Object.hasOwn(item, 'value')));
  assert.ok(eastProof.evaluations.every(item => item.evaluated));
  assert.deepEqual(eastProof.composition, result.observation.snapshot.composition);
  assert.equal(eastProof.source.revisionId, 'pair-r1');
  for (const node of descriptor.nodes.filter(node => node.kind !== 'state')) {
    assert.ok(node.sources.every(source => source.sourceRole === 'output-connection'
      && source.sourceNode.filename === 'pair.ghost.md' && source.sourceNode.instance === null));
  }
  assert.doesNotMatch(JSON.stringify([descriptor, result.explanation]), /__gf_|instance_4_east|instance_4_west/);
  assert.equal(joinOutputExplanation(artifact.interactionSchema, eastProof, result.observation.snapshot,
    host.interactionIdentity, descriptor, result).status, 'ready');
  const before = host.snapshot();
  const read = host.explanationSnapshot();
  read.proofs[0].value = false;
  descriptor.nodes.length = 0;
  assert.deepEqual(host.explanationSnapshot(), result.explanation);
  assert.ok(host.explanationDescriptor.nodes.length > 0);
  assert.deepEqual(host.snapshot(), before, 'read-only explanation queries never advance a scan or settings event');
});

test('composed explanation rejects other runs scans settings closure mappings and witness payloads', async t => {
  const host = await create();
  t.after(() => host.dispose());
  const result = host.step(packet(0, true, false));
  const producer = prepareOutputExplanation({ compilation: artifact, runId: 'pair-run' });
  const proof = proofFor(result), snapshot = result.observation.snapshot;
  const join = candidate => joinOutputExplanation(artifact.interactionSchema, candidate, snapshot,
    producer.expected, producer.descriptor, result);
  assert.equal(join({ ...proof, runId: 'old-run' }).status, 'stale');
  assert.equal(join({ ...proof, completion: { ...proof.completion, scanId: 1 } }).status, 'stale');
  assert.equal(join({ ...proof, settingsRevision: 1 }).status, 'stale');
  assert.throws(() => join(mutated(proof, value => { value.composition.sourceClosureSha256 = '0'.repeat(64); })), /contract validation/);
  assert.throws(() => producer.emit({ runId: 'old-run', result, outputId: proof.outputId }), /epoch mismatch/);
  for (const change of [
    value => { value.sourceClosure.documents[0].revision = 'other-revision'; },
    value => { value.sourceClosure.instances[0].instance = 'other-instance'; },
    value => { value.sourceMap.find(node => node.instance === 'east').line += 1; },
    value => { value.traceMetadata.compositionIntent.instances[0].links[0].anchorId = 'other-intent'; },
    value => { value.explanationArtifact.nodes[0].label = 'other-state'; },
  ]) assert.throws(() => prepareOutputExplanation({ compilation: mutated(artifact, change), runId: 'pair-run' }),
    /mismatch|revision/);
  for (const change of [
    value => { value.snapshot.runId = 'old-run'; },
    value => { value.outcome.frame.scanId += 1; },
    value => { value.snapshot.core.state.settingsRevision += 1; },
    value => { value.outcome.vm.instructionWitnesses[0].steps[0].end += 1;
      value.snapshot.lastOutcome.trace = structuredClone(value.outcome.vm); },
    value => { value.outcome.vm.requested.east_on = true;
      value.snapshot.lastOutcome.trace = structuredClone(value.outcome.vm); },
  ]) assert.throws(() => producer.emit({ runId: 'pair-run', result: mutated(result, change), outputId: proof.outputId }), /mismatch/);
  assert.throws(() => producer.emit({ runId: 'pair-run', result: { ...result, accepted: false }, outputId: proof.outputId }),
    /accepted completed scan/);
});

test('activation owns caller compilation and unavailable capture profiles are explicit', async t => {
  const supplied = structuredClone(artifact);
  const host = await create(supplied), ordinary = await create(artifact, { outputExplanations: false });
  t.after(() => { host.dispose(); ordinary.dispose(); });
  supplied.sourceClosure.documents[0].text = 'tampered';
  supplied.sourceMap.length = 0;
  supplied.explanationArtifact.nodes.length = 0;
  const result = host.step(packet(0));
  assert.equal(result.explanation.error, null);
  const withoutCapture = ordinary.step(packet(0));
  assert.equal(Object.hasOwn(withoutCapture.outcome.vm, 'instructionWitnesses'), false);
  assert.deepEqual(ordinary.explanationSnapshot(), { proofs: [], error: 'output-explanations-disabled' });
  const producer = prepareOutputExplanation({ compilation: artifact, runId: 'pair-run' });
  assert.equal(producer.emit({ runId: 'pair-run', result: withoutCapture, outputId: 'output.east_on' }).reason,
    'instruction-witnesses-disabled');
  await assert.rejects(create(artifact, { framed: false }), /framed host/);
  await assert.rejects(create({ ...artifact, interactionSchema: null }), /Interaction Schema/);
  await assert.rejects(create(artifact, { instructionWitnesses: true }), /use outputExplanations/);
  await assert.rejects(create(artifact, { outputExplanations: 'yes' }), /must be Boolean/);
});

test('failed real scan clears the latest explanation without promoting the retained prior outcome', async t => {
  const compiled = compile('running && (1.0 / divisor > 0.0)',
    '// ghostflow:link id=cell-intent relation=implements\nstate divisor: Number = 0.0;');
  const host = await create(compiled);
  t.after(() => host.dispose());
  const accepted = host.step(packet(0, true, false));
  assert.equal(proofFor(accepted).status, 'ready');
  const before = host.snapshot();
  assert.throws(() => host.step(packet(1000)), /division by zero/);
  assert.deepEqual(host.explanationSnapshot(), { proofs: [], error: 'scan-not-completed' });
  assert.deepEqual(host.snapshot(), before);
});

test('post-commit projection failure preserves accepted event and refuses a retry', async t => {
  const host = await create();
  t.after(() => host.dispose());
  const event = edit(host, 'apply-once');
  const original = ControlRuntime.prototype.step;
  let result;
  try {
    ControlRuntime.prototype.step = function (packet) {
      const result = structuredClone(original.call(this, packet));
      result.vm.module = '0'.repeat(16);
      return result;
    };
    result = host.step(packet(0), event);
  } finally { ControlRuntime.prototype.step = original; }
  assert.equal(result.accepted, true);
  assert.deepEqual(result.explanation, { proofs: [], error: 'completed-scan-explanation-failed' });
  assert.equal(result.snapshot.core.state.settingsRevision, 1);
  assert.equal(result.snapshot.history.length, 1);
  assert.throws(() => host.step(packet(1000), event), /revision|event/);
  const next = host.step(packet(1000));
  assert.equal(next.explanation.error, null);
  assert.equal(proofFor(next).completion.scanId, 1);
  assert.equal(proofFor(next).settingsRevision, 1);
  assert.equal(next.snapshot.history.length, 1);
});

test('config and timer expression rails remain explicit unavailable outputs after a real completed scan', async t => {
  for (const [compiled, reason] of [
    [compile('unused |> recover(false)'), 'unsupported-kind:result_trace'],
    [compile('age < 1s', '// ghostflow:link id=cell-intent relation=implements\ntimer age = elapsed(running);'), 'unsupported-kind:generated-rail'],
  ]) {
    const host = await create(compiled);
    t.after(() => host.dispose());
    const result = host.step(packet(0));
    assert.equal(result.accepted, true);
    assert.equal(result.explanation.error, null);
    assert.ok(result.explanation.proofs.every(proof => proof.status === 'unavailable'
      && proof.reason === reason && proof.evaluations.length === 0));
  }
});

test('admitted compact-profile source prepares explanations while public compilation still requires profiles', () => {
  const definition = { kind: 'board', connections: {}, defaults: {}, channels: { RO1: { role: 'output', type: 'Bool' } } };
  const source = `---\nprofile: example-board@1\nbindings:\n  on: board.RO1\n---\n${document(`control Profile {
  // ghostflow:link id=cell-intent relation=implements
  state running: Bool = true;
  output on: Bool;
  on <- running;
}`)}`;
  const options = { filename: 'profile.ghost.md', interactionSourceIdentity: { documentId: 'profile', revisionId: 'r1' } };
  assert.throws(() => compileSourceSync(source, options), /supply hardwareProfiles/);
  const compiled = compileSourceSync(source, { ...options,
    hardwareProfiles: [{ ref: 'example-board@1', definition, sha256: sha256Hex(canonicalJson(definition)) }] });
  const { hardwarePlan: _plan, ...persisted } = compiled;
  const producer = prepareOutputExplanation({ compilation: persisted, runId: 'profile-run' });
  assert.equal(producer.descriptor.nodes.find(node => node.kind === 'state').sources[0].intentProvenance[0].anchorId, 'cell-intent');
  const forged = structuredClone(persisted), invented = 'GF-ABSENT-FROM-PROFILE-SOURCE';
  assert.equal(source.includes(invented), false);
  forged.traceMetadata.intentLinks.forEach(link => { link.anchorId = invented; });
  forged.interactionSchema.descriptors[0].provenance.intentAnchorIds = [invented];
  forged.explanationArtifact.nodes.forEach(node => node.sources.forEach(source => source.intentProvenance.forEach(link => { link.anchorId = invented; })));
  assert.throws(() => prepareOutputExplanation({ compilation: forged, runId: 'profile-run' }), /mapping mismatch/);
});

test('identical imported literals share a semantic node while each occurrence retains only its own output connection', async t => {
  const compiled = compile('true');
  const host = await create(compiled);
  t.after(() => host.dispose());
  const result = host.step(packet(0));
  const [east, west] = result.explanation.proofs;
  assert.equal(east.rootNodeId, west.rootNodeId);
  assert.equal(host.explanationDescriptor.nodes.find(node => node.id === east.rootNodeId).sources.length, 2);
  for (const proof of [east, west]) {
    const binding = compiled.traceMetadata.bindings.find(binding => binding.kind === 'connection'
      && `output.${binding.name}` === proof.outputId);
    assert.equal(proof.value, true);
    assert.equal(proof.evaluations.length, 1);
    const source = proof.evaluations[0].source;
    assert.equal(source.sourceRole, 'output-connection');
    assert.equal(source.sourceNode.instance, null);
    assert.equal(source.sourceNode.filename, 'pair.ghost.md');
    assert.equal(source.sourceNode.nodeId, binding.nodeId);
  }
  assert.notEqual(east.evaluations[0].source.sourceNode.nodeId, west.evaluations[0].source.sourceNode.nodeId);
});
