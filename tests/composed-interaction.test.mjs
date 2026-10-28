import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { TemporarySettingsHost } from '../runtimes/wasm/temporary-settings-host.mjs';
import { verifyInteractionSchema, restoreInteractionSchema } from '../tools/interaction-schema.mjs';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { joinRuntimeSnapshot, prepareCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource as compileBrowser } from '../tools/browser-toolchain.mjs';
import { restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';
import { prepareObservationEventHistory } from '../tools/observation-event-history.mjs';
import { observeRuntimeValues } from '../tools/source-trace.mjs';
import { verifyComposedInteractionCorpus } from '../contracts/interaction-v0/verify-corpus.mjs';

const document = code => `# Cells\n\n<!-- ghostflow:anchor id=cell-intent kind=intent status=confirmed origin=user -->\nKeep each cell independent.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const cell = document(`control Cell {
  input start: Bool;
  // ghostflow:link id=cell-intent relation=implements
  config duration: Duration = 5s { min = 1s; max = 10s; step = 1s; access = operator; }
  // ghostflow:link id=cell-intent relation=implements
  state running: Bool = false;
  // ghostflow:link id=cell-intent relation=implements
  timer age = elapsed(running);
  running' = running || (start |> recover(false));
  output on: Bool;
  on <- running' && age < (duration |> recover(0s));
}`);
const source = document(`import Cell from "./cell.ghost.md" revision "r1" sha256 "${sha256Hex(cell)}";
control Pair {
  input east_start, west_start: Bool;
  output east_on, west_on: Bool;
  // ghostflow:link id=cell-intent relation=implements
  state running: Bool = false;
  running' = east_start |> recover(false);
  instance east: Cell;
  instance west: Cell;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_on <- east.on;
  connect west_on <- west.on;
}`);
const options = { filename: 'pair.ghost.md', sourceClosure: [{ filename: 'cell.ghost.md', revision: 'r1', text: cell }],
  interactionSourceIdentity: { documentId: 'pair', revisionId: 'r1' } };
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const packet = (nowMs, id, east, west) => ({ nowMs,
  samples: Object.fromEntries(Object.entries({ east_start: east, west_start: west }).map(([name, value]) => [name,
    { epoch: 1, id, timestampMs: nowMs, quality: 'Good', value }])),
  contextFacts: { clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: 1700000000000 + nowMs,
    uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'clock-r1' }, natural: [], schedules: [], settings: null },
});

test('composed schema retains instance-local authored identities and exact original provenance', async () => {
  const artifact = await compileSource(source, options);
  const schema = artifact.interactionSchema;
  assert.equal(schema.version, '0.5');
  assert.deepEqual(schema.descriptors.map(d => [d.instance, d.id]), [
    [null, 'state.running'], ['east', 'setting.duration'], ['east', 'state.running'], ['east', 'timer.age'],
    ['west', 'setting.duration'], ['west', 'state.running'], ['west', 'timer.age'],
  ]);
  for (const descriptor of schema.descriptors) {
    assert.deepEqual(descriptor.provenance.intentAnchors, [{ instance: descriptor.instance, anchorId: 'cell-intent' }]);
    const node = artifact.sourceMap.find(node => node.id === descriptor.provenance.sourceNode.id);
    assert.equal(node.filename, descriptor.instance === null ? 'pair.ghost.md' : 'cell.ghost.md');
    assert.equal(descriptor.provenance.sourceNode.source.line, node.line);
  }
  assert.deepEqual(schema.descriptors.find(d => d.instance === 'east' && d.kind === 'timer').operation,
    { kind: 'elapsed_since_change', subject: { instance: 'east', descriptorId: 'state.running' } });
  assert.ok(!JSON.stringify(schema).includes('instance_4_'));
  for (const field of ['sourceMap', 'traceMetadata', 'sourceClosure']) {
    const bad = structuredClone(artifact);
    if (field === 'sourceMap') bad.sourceMap.find(n => n.instance === 'east').line += 1;
    else if (field === 'traceMetadata') bad.traceMetadata.compositionIntent.instances[0].links[0].anchorId = 'other';
    else bad.sourceClosure.instances[0].instance = 'other';
    assert.throws(() => verifyInteractionSchema(bad, schema), /canonical closure/);
    assert.throws(() => restoreInteractionSchema(bad, schema), /canonical.*(?:closure|replay)/);
  }
  const forged = structuredClone(artifact);
  const provenance = forged.interactionSchema.descriptors.find(d => d.instance === 'east').provenance;
  const anchorId = 'GF-ABSENT-FROM-SOURCE';
  assert.equal(cell.includes(anchorId), false);
  forged.traceMetadata.compositionIntent.instances.find(entry => entry.instance === 'east').links
    .filter(link => link.nodeId === provenance.sourceNode.id).forEach(link => { link.anchorId = anchorId; });
  provenance.intentAnchors = [{ instance: 'east', anchorId }];
  assert.throws(() => restoreInteractionSchema(forged, forged.interactionSchema), /canonical.*(?:closure|replay)/);
  const swapped = structuredClone(schema);
  [swapped.descriptors[1].provenance.sourceNode, swapped.descriptors[4].provenance.sourceNode]
    = [swapped.descriptors[4].provenance.sourceNode, swapped.descriptors[1].provenance.sourceNode];
  assert.throws(() => verifyInteractionSchema(artifact, swapped), /does not match compiler provenance/);
});

test('actual settings host owns independent completed observations and read operations do not tick', async t => {
  const artifact = await compileSource(source, options);
  const eastId = artifact.manifest.configs[0].id;
  const host = await TemporarySettingsHost.instantiate(wasm, artifact, { runId: 'composed-run', grants: { operator: [eastId] },
    context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  t.after(() => host.dispose());
  assert.deepEqual(host.interactionSnapshot(), { snapshot: null, error: null });
  host.step(packet(0, 1, true, false));
  const second = host.step(packet(1000, 2, false, true));
  assert.equal(second.accepted, true);
  assert.equal(second.observation.error, null, JSON.stringify(second.outcome.frame));
  const observation = second.observation.snapshot;
  assert.equal(validateInteraction(artifact.interactionSchema, observation).valid, true);
  assert.equal(observation.version, '0.3');
  const timer = instance => observation.observations.find(o => o.instance === instance && o.descriptorId === 'timer.age');
  assert.equal(timer('east').value, 1000);
  assert.equal(timer('west').value, 0);
  const observed = observeRuntimeValues(artifact.traceMetadata, second.outcome.vm);
  assert.deepEqual(observed.values.filter(value => value.kind === 'timer').map(value => value.value),
    observation.observations.filter(value => value.descriptorId === 'timer.age').map(value => value.value));
  const before = host.snapshot();
  const changed = host.step(packet(2000, 3, false, false), { kind: 'ordinary', eventId: 'east-duration', actor: 'operator',
    reason: 'shorten east only', programFingerprint: before.programFingerprint, sourceSha256: before.sourceSha256,
    runId: before.runId, baseRevision: before.core.state.settingsRevision,
    changes: [{ configId: eastId, result: { ok: true, type: 'Duration', value: 1000 } }] });
  assert.equal(changed.accepted, true);
  assert.equal(changed.observation.error, null);
  const settings = changed.observation.snapshot.observations.filter(o => o.descriptorId === 'setting.duration');
  assert.deepEqual(settings.map(o => [o.instance, o.value, o.emissionRevision, o.applicationPosition]),
    [['east', 1000, 1, 3], ['west', 5000, 0, null]]);
  assert.deepEqual(changed.outcome.vm.safe, { east_on: false, west_on: true });
  const after = host.snapshot();
  const read = host.interactionSnapshot();
  read.snapshot.observations[0].value = true;
  assert.deepEqual(host.interactionSnapshot(), changed.observation);
  assert.deepEqual(host.snapshot(), after);
  assert.equal(joinRuntimeSnapshot(artifact.interactionSchema, observation, host.interactionIdentity).status, 'ready');
  assert.equal(joinRuntimeSnapshot(artifact.interactionSchema, observation, { ...host.interactionIdentity, runId: 'other-run' }).status, 'stale');
  assert.equal(joinRuntimeSnapshot(artifact.interactionSchema, observation, { ...host.interactionIdentity, sourceClosureSha256: '0'.repeat(64) }).status, 'stale');
  assert.ok(!JSON.stringify(observation).includes('instance_4_'));
});

test('persisted and browser artifacts reconstruct the same composed schema and reject tampering', async t => {
  const artifact = await compileSource(source, options);
  assert.deepEqual((await compileBrowser(source, options)).interactionSchema, artifact.interactionSchema);
  assert.deepEqual(restoreInteractionSchema(artifact, artifact.interactionSchema), artifact.interactionSchema);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'composed-interaction-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'pair.gfb');
  writeArtifact(artifact, output);
  const stored = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
  const restored = restoreArtifactSourceMap(stored, artifact.bytes, { manifest: artifact.manifest });
  assert.deepEqual(restored.interactionSchema, artifact.interactionSchema);
  stored.interactionSchema.descriptors[1].provenance.sourceNode.definitionNodeId += 1;
  assert.throws(() => restoreArtifactSourceMap(stored, artifact.bytes, { manifest: artifact.manifest }), /interactionSchema/);
  const downgraded = structuredClone(artifact.interactionSchema);
  downgraded.version = '0.3';
  for (const descriptor of downgraded.descriptors) delete descriptor.defaultValue;
  assert.throws(() => verifyInteractionSchema(artifact, downgraded), /does not match compiler provenance/);
});

test('nested instances retain full authored paths without decoding compiler names', async () => {
  const wrapper = document(`import Cell from "./cell.ghost.md" revision "r1" sha256 "${sha256Hex(cell)}";
control Group {
  input start: Bool;
  output on: Bool;
  instance inside: Cell;
  connect inside.start <- start;
  connect on <- inside.on;
}`);
  const nested = source.replace(`import Cell from "./cell.ghost.md" revision "r1" sha256 "${sha256Hex(cell)}";`,
    `import Cell from "./group.ghost.md" revision "r2" sha256 "${sha256Hex(wrapper)}";`);
  const artifact = await compileSource(nested, { ...options, sourceClosure: [...options.sourceClosure,
    { filename: 'group.ghost.md', revision: 'r2', text: wrapper }] });
  const timer = artifact.interactionSchema.descriptors.find(d => d.instance === 'east.inside' && d.kind === 'timer');
  assert.deepEqual(timer.operation.subject, { instance: 'east.inside', descriptorId: 'state.running' });
  assert.equal(timer.provenance.sourceNode.source.filename, 'cell.ghost.md');
  assert.deepEqual(timer.provenance.intentAnchors, [{ instance: 'east.inside', anchorId: 'cell-intent' }]);
  assert.equal(artifact.interactionSchema.composition.instances.find(entry => entry.instance === 'east').definition.revision, 'r2');
});

test('composed adapter owns verification inputs and event history retains closure identity', async t => {
  const artifact = await compileSource(source, options);
  const host = await TemporarySettingsHost.instantiate(wasm, artifact, { runId: 'adapter-run', grants: {},
    context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  t.after(() => host.dispose());
  const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: 'adapter-run' });
  const journal = prepareObservationEventHistory({ compilation: artifact, runId: 'adapter-run' });
  const schema = structuredClone(artifact.interactionSchema);
  artifact.sourceClosure.documents[0].text = 'tampered';
  artifact.sourceMap.length = 0;
  artifact.interactionSchema.composition.instances.length = 0;
  const result = host.step(packet(0, 1, true, false));
  const input = { completion: result.observation.snapshot.completion, trace: result.outcome.vm, settingsState: result.snapshot.core.state };
  const snapshot = producer.emit(input);
  assert.deepEqual(snapshot, result.observation.snapshot);
  snapshot.composition.instances[0].definition.revision = 'tampered';
  assert.deepEqual(producer.emit(input), result.observation.snapshot);
  journal.publish({ ...input, events: [] });
  assert.equal(journal.read().identity.sourceClosureSha256, schema.composition.sourceClosureSha256);
  assert.deepEqual(journal.read().snapshot, result.observation.snapshot);
  for (const mutate of [
    value => { value.composition.sourceClosureSha256 = '0'.repeat(64); },
    value => { value.observations[1].instance = 'west'; },
    value => { value.observations[1].emissionRevision = 1; },
    value => { value.observations[2].privateName = 'generated'; },
  ]) {
    const bad = structuredClone(result.observation.snapshot);
    mutate(bad);
    assert.equal(validateInteraction(schema, bad).valid, false);
  }
  for (const mutate of [
    value => { value.descriptors[1].provenance.intentAnchors[0].instance = null; },
    value => { value.descriptors[1].provenance.sourceNode.source.filename = 'wrong.ghost.md'; },
    value => { value.descriptors[1].provenance.sourceNode.id = value.descriptors[4].provenance.sourceNode.id; },
    value => { value.descriptors[3].operation.subject.instance = 'west'; },
    value => { value.composition.instances = {}; },
  ]) {
    const bad = structuredClone(schema);
    mutate(bad);
    assert.equal(validateInteraction(bad, result.observation.snapshot).valid, false);
  }
  assert.throws(() => producer.emit({ ...input, completion: { ...input.completion, logicalTimeMs: 1000 } }), /clock does not match/);
  assert.throws(() => producer.emit({ ...input, settingsState: { ...input.settingsState, programFingerprint: '0'.repeat(16) } }), /current Rust settings state/);
});

test('observation failure after committed dispatch remains accepted and cannot retry an event', async t => {
  const artifact = await compileSource(source, options);
  const id = artifact.manifest.configs[0].id;
  const host = await TemporarySettingsHost.instantiate(wasm, artifact, { runId: 'failure-run', grants: { operator: [id] },
    context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  t.after(() => host.dispose());
  const before = host.snapshot();
  const event = { kind: 'ordinary', eventId: 'accepted-once', actor: 'operator', reason: 'shorten east',
    programFingerprint: before.programFingerprint, sourceSha256: before.sourceSha256, runId: before.runId,
    baseRevision: 0, changes: [{ configId: id, result: { ok: true, type: 'Duration', value: 1000 } }] };
  const step = ControlRuntime.prototype.step;
  let result;
  try {
    ControlRuntime.prototype.step = function (packet) {
      const outcome = structuredClone(step.call(this, packet));
      outcome.vm.module = '0'.repeat(16);
      return outcome;
    };
    result = host.step(packet(0, 1, true, false), event);
  } finally { ControlRuntime.prototype.step = step; }
  assert.equal(result.accepted, true);
  assert.deepEqual(result.observation, { snapshot: null, error: 'completed-scan-observation-failed' });
  assert.equal(result.snapshot.core.state.settingsRevision, 1);
  assert.equal(result.snapshot.history.length, 1);
  assert.throws(() => host.step(packet(1000, 2, false, false), event), /identity|revision|event/);
  const next = host.step(packet(1000, 2, false, false));
  assert.equal(next.observation.error, null);
  assert.equal(next.observation.snapshot.completion.scanId, 1);
  assert.equal(next.snapshot.history.length, 1);
});

test('versioned composed corpus reconstructs its schema and replays actual owned observations', async t => {
  const corpus = JSON.parse(fs.readFileSync(new URL('../contracts/interaction-v0/examples/composed-v0.5.json', import.meta.url), 'utf8'));
  assert.equal((await verifyComposedInteractionCorpus({ corpus })).scanCount, 2);
  const artifact = await compileSource(corpus.sourceDocument.text, { filename: corpus.sourceDocument.filename,
    sourceClosure: corpus.sourceClosure.documents, interactionSourceIdentity: corpus.sourceIdentity });
  const host = await TemporarySettingsHost.instantiate(wasm, artifact, { runId: corpus.scans[0].snapshot.runId, grants: {},
    context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  t.after(() => host.dispose());
  for (const scan of corpus.scans) assert.deepEqual(host.step(scan.packet).observation, { snapshot: scan.snapshot, error: null });
  const bad = structuredClone(corpus);
  bad.schema.descriptors[1].provenance.intentAnchors[0].instance = 'west';
  await assert.rejects(() => verifyComposedInteractionCorpus({ corpus: bad }), /schema differs/);
  bad.schema = corpus.schema;
  bad.scans[1].snapshot.completion.scanId = 0;
  await assert.rejects(() => verifyComposedInteractionCorpus({ corpus: bad }), /scan identity differs/);
});

test('composed state-only observation uses the same profile without inventing settings or advancing time', async t => {
  const plainCell = document(`control Cell {
    input start: Bool;
    // ghostflow:link id=cell-intent relation=implements
    state running: Bool = false;
    running' = start |> recover(false);
    // ghostflow:link id=cell-intent relation=implements
    timer age = continuous_true(running);
    output on: Bool;
    on <- running';
  }`);
  const plainSource = source.replace(sha256Hex(cell), sha256Hex(plainCell));
  const artifact = await compileSource(plainSource, { ...options,
    sourceClosure: [{ filename: 'cell.ghost.md', revision: 'r1', text: plainCell }] });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: 'plain-composed-run' });
  const { samples } = packet(0, 1, true, false);
  const outcome = runtime.step({ nowMs: 0, samples });
  const completion = { kind: 'completed-scan', ...outcome.frame };
  const snapshot = producer.emit({ completion, trace: outcome.vm });
  assert.equal(snapshot.version, '0.3');
  assert.equal(snapshot.settingsRevision, 0);
  assert.ok(snapshot.observations.every(item => !item.descriptorId.startsWith('setting.')));
  assert.deepEqual(producer.emit({ completion, trace: outcome.vm }), snapshot);
  assert.equal(validateInteraction(artifact.interactionSchema, snapshot).valid, true);
  const timer = artifact.interactionSchema.descriptors.find(item => item.kind === 'timer');
  const subject = artifact.sourceMap.find(node => node.id === timer.operation.subjectNodeId);
  assert.equal(subject.instance, timer.instance);
  assert.equal(subject.kind, 'reference');
});

test('legacy and framed settings hosts publish the same accepted scans from their own completion owners', async t => {
  const artifact = await compileSource(source, options);
  const id = artifact.manifest.configs[0].id;
  const activate = framed => TemporarySettingsHost.instantiate(wasm, artifact, { framed, runId: 'entry-parity-run',
    grants: { operator: [id] }, context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  const framed = await activate(true), legacy = await activate(false);
  t.after(() => { framed.dispose(); legacy.dispose(); });
  const before = legacy.snapshot();
  const event = { kind: 'ordinary', eventId: 'legacy-edit', actor: 'operator', reason: 'shorten east',
    programFingerprint: before.programFingerprint, sourceSha256: before.sourceSha256, runId: before.runId,
    baseRevision: 0, changes: [{ configId: id, result: { ok: true, type: 'Duration', value: 1000 } }] };
  for (const [index, input] of [packet(0, 1, true, false), packet(1000, 2, false, true), packet(2000, 3, false, false)].entries()) {
    const setting = index === 1 ? event : null;
    const expected = framed.step(input, setting), actual = legacy.step(input, setting);
    assert.equal(actual.accepted, true);
    assert.equal(actual.observation.error, null);
    assert.equal(actual.outcome.frame, undefined);
    assert.deepEqual(actual.outcome.vm, expected.outcome.vm);
    assert.deepEqual(actual.observation, expected.observation);
    assert.equal(actual.observation.snapshot.completion.scanId, index);
    assert.deepEqual(legacy.interactionSnapshot(), actual.observation);
    assert.deepEqual(legacy.snapshot().core.state, framed.snapshot().core.state);
  }
});
