import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import {
  emitCompletedScanSnapshot,
  prepareCompletedScanSnapshot,
  expectedRuntimeIdentity,
  joinRuntimeSnapshot,
} from '../tools/interaction-runtime-snapshot.mjs';
import { verifyInteractionCorpus } from '../contracts/interaction-v0/verify-corpus.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'contracts/interaction-v0/examples/corpus.json'), 'utf8'));
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''));

test('REF-01-055 typed values retain identity through verified portable handoff, Interaction Schema and native/WASM execution', async () => {
  const link = '// ghostflow:link id=GF-INT-REF-01-055 relation=implements\n';
  const source = '# Typed value boundaries\n\n<!-- ghostflow:anchor id=GF-INT-REF-01-055 kind=intent status=confirmed origin=user -->\n'
    + 'Retain the authored type of each state through execution and read-only observation.\n\n```ghost\ncontrol TypeBoundaries {\n'
    + link + 'state percent: Percent = 30%;\n' + link + 'state number: Number = 30.0;\n'
    + link + 'state duration: Duration = 30ms;\n' + link + 'state clock: TimeOfDay = time`06:00`;\n'
    + 'output percent_out: Percent; output number_out: Number;\n'
    + 'output duration_out: Duration; output clock_out: TimeOfDay;\n'
    + 'percent_out <- percent; number_out <- number; duration_out <- duration; clock_out <- clock;\n}\n```\n';
  const interactionSourceIdentity = { documentId: 'source.ref-01-055', revisionId: 'revision.ref-01-055.1' };
  const artifact = await compileSource(source, { filename: 'ref-01-055.ghost.md', interactionSourceIdentity });
  const expectedPorts = [
    { name: 'percent_out', type: 'Percent' }, { name: 'number_out', type: 'Number' },
    { name: 'duration_out', type: 'Duration' }, { name: 'clock_out', type: 'TimeOfDay' },
  ];
  assert.deepEqual(artifact.manifest.outputs, expectedPorts);
  const identity = {
    compilerRevision: 'ref-01-055-test-compiler', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'virtual-ref-01-055-v1',
    // Numeric transport categories coexist with the retained language types.
    requiredCapabilities: expectedPorts.map(port => ({ kind: 'actuator', name: port.name, type: 'number' })),
  };
  const key = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const buildOptions = {
    signers: [{ keyId: 'ref-01-055-test-key', privateKey: key.privateKey }],
    verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  };
  const packageValue = await buildPortablePackage(artifact, identity, buildOptions);
  const verified = await verifyPortablePackage(packageValue, {
    trustedKeys: [{ keyId: 'ref-01-055-test-key', publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: [artifact.manifest.format], availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
    verifyBytecode: async (bytes, received) => {
      assert.deepEqual(received.manifest.outputs, expectedPorts);
      const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
      try {
        runtime.load(bytes);
        for (const capability of received.identity.requiredCapabilities) runtime.addCapability(capability.kind, capability.name, capability.type);
        runtime.activate();
        return true;
      } finally { runtime.dispose(); }
    },
  });
  assert.deepEqual(verified.manifest.outputs, expectedPorts);
  assert.equal(verified.identity.bindingRevision, identity.bindingRevision);
  const received = await compileSource(verified.source.text, { filename: verified.source.filename, interactionSourceIdentity });
  assert.deepEqual(new Uint8Array(received.bytes), verified.bytecode.copy());
  assert.deepEqual(received.manifest, verified.manifest);
  assert.deepEqual(received.traceMetadata, verified.sourceMap.traceMetadata);
  // Execute the bytes and metadata returned by verification, then reconstruct
  // the read-only UI schema from that exact received source.
  received.bytes = verified.bytecode.copy();
  received.manifest = verified.manifest;
  received.traceMetadata = verified.sourceMap.traceMetadata;
  const expectedTypes = [
    ['state.percent', { kind: 'nominal', name: 'Percent', unit: 'percent' }],
    ['state.number', { kind: 'builtin', name: 'Number', unit: null }],
    ['state.duration', { kind: 'builtin', name: 'Duration', unit: 'ms' }],
    ['state.clock', { kind: 'builtin', name: 'TimeOfDay', unit: null }],
  ];
  assert.deepEqual(received.interactionSchema.descriptors.map(descriptor => [descriptor.id, descriptor.sourceType]), expectedTypes);
  const scans = [{ completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 100 }, inputs: [] }];
  const native = await nativeRun(received, scans);
  const wasm = await wasmRun(received, scans);
  assert.deepEqual(wasm, native);
  assert.deepEqual(await wasmRun(received, scans), wasm);
  assert.deepEqual(wasm[0].trace.safe, { percent_out: 30, number_out: 30, duration_out: 30, clock_out: 21_600_000 });
  const snapshot = emitCompletedScanSnapshot({ compilation: received, runId: 'run.ref-01-055', completion: scans[0].completion, trace: wasm[0].trace });
  assert.deepEqual(snapshot.observations, [
    { descriptorId: 'state.percent', status: 'ready', value: 30 },
    { descriptorId: 'state.number', status: 'ready', value: 30 },
    { descriptorId: 'state.duration', status: 'ready', value: 30 },
    { descriptorId: 'state.clock', status: 'ready', value: 21_600_000 },
  ]);
  assert.deepEqual(joinRuntimeSnapshot(received.interactionSchema, snapshot,
    expectedRuntimeIdentity(received.interactionSchema, 'run.ref-01-055')), { status: 'ready', staleReasons: [] });
  const schedule = await compileSource('```ghost\ncontrol Slots { schedule starts: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; } output due: Bool; due <- starts.due; }\n```\n');
  assert.deepEqual(schedule.manifest.schedules, [{ name: 'starts', timezone: 'UTC', slots: [360], dueInput: '__gf_schedule_due_starts' }]);
  assert.equal(schedule.manifest.schedules[0].slots[0] * 60_000, snapshot.observations[3].value);
  const forged = structuredClone(artifact);
  forged.manifest.outputs[0].type = 'Number';
  await assert.rejects(buildPortablePackage(forged, identity, buildOptions), error => error.code === 'compilation-mismatch');
  const forgedSchema = structuredClone(received.interactionSchema);
  forgedSchema.descriptors[0].sourceType = { kind: 'builtin', name: 'Number', unit: null };
  assert.throws(() => prepareCompletedScanSnapshot({ compilation: received, schema: forgedSchema, runId: 'run.ref-01-055' }), /interaction schema:/);
});

test('REF-01-055 rejects implicit interchange of Percent, Number, Duration and TimeOfDay', async () => {
  for (const [type, expression] of [['Number', '30%'], ['Percent', '30.0'], ['Duration', 'time`06:00`'], ['TimeOfDay', '30ms']]) {
    await assert.rejects(compileSource('```ghost\ncontrol TypeMismatch { output value: ' + type + '; value <- ' + expression + '; }\n```\n'), new RegExp('output value must be ' + type));
  }
});

const directSource = `# Direct input to output

The pump follows the enable input without authored state or a timer.

\`\`\`ghost
control DirectOutput {
  input enabled: Bool;
  output pump: Bool;
  pump <- enabled |> recover(false);
}
\`\`\`
`;

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function tapeDigest(tape) {
  const unsigned = structuredClone(tape);
  delete unsigned.digest;
  return sha256(canonicalJson(unsigned, {
    rejectSparseArrays: true,
    rejectUnsafeIntegers: true,
  }));
}

async function compileFixture(fixture) {
  const source = read(fixture.sourcePath);
  const artifact = await compileSource(source, {
    filename: fixture.sourcePath,
    interactionSourceIdentity: {
      documentId: fixture.source.documentId,
      revisionId: fixture.source.revisionId,
    },
  });
  assert.deepEqual(artifact.interactionSchema.module, fixture.module);
  assert.equal(artifact.sourceDocument.sha256, fixture.source.sha256);
  return artifact;
}

function tsv(scans) {
  return `${scans.map(scan => [
    scan.completion.scanId,
    scan.completion.logicalTimeMs,
    ...scan.inputs.flatMap(input => [input.name, typeof input.value === 'boolean' ? 'b' : 'n', String(input.value)]),
  ].join('\t')).join('\n')}\n`;
}

async function acquiredScans(artifact, scans) {
  if (!artifact.manifest.sensors.length) return scans;
  const acquisition = await ControlRuntime.instantiate(wasmBytes, artifact);
  try {
    return scans.map(scan => {
      const nowMs = scan.completion.logicalTimeMs;
      const samples = Object.fromEntries(scan.inputs.map(input => [input.name,
        { epoch: 1, id: scan.completion.scanId + 1, timestampMs: nowMs,
          quality: 'Good', value: input.value }]));
      const result = acquisition.step({ nowMs, samples });
      return { ...scan, inputs: Object.entries(result.vm.inputs)
        .filter(([name]) => name !== '__gf_now_ms')
        .map(([name, value]) => ({ name, value })) };
    });
  } finally { acquisition.dispose(); }
}

async function nativeRun(artifact, scans) {
  scans = await acquiredScans(artifact, scans);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-interaction-snapshot-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, tsv(scans));
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line).outcome);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function wasmRun(artifact, scans) {
  scans = await acquiredScans(artifact, scans);
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  try {
    runtime.load(artifact.bytes);
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
    runtime.activate();
    return scans.map(scan => runtime.scan({
      scanId: scan.completion.scanId,
      logicalTimeMs: scan.completion.logicalTimeMs,
      inputs: scan.inputs,
    }));
  } finally {
    runtime.dispose();
  }
}

function controlShape(outcome) {
  return {
    stateAfter: outcome.trace.stateAfter,
    requested: outcome.trace.requested,
    safe: outcome.trace.safe,
  };
}

async function executeWasm(artifact, run, mode) {
  const acquired = await acquiredScans(artifact, run.scans);
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  const outcomes = [];
  const snapshots = [];
  const joins = [];
  const events = [];
  const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: run.runId });
  const observe = (outcome, scan) => {
    events.push(`observe:${scan.completion.scanId}`);
    const snapshot = emitCompletedScanSnapshot({
      compilation: artifact, runId: run.runId, completion: scan.completion, trace: outcome.trace,
    });
    assert.deepEqual(producer.emit({ completion: scan.completion, trace: outcome.trace }), snapshot);
    snapshots.push(snapshot);
    joins.push(joinRuntimeSnapshot(artifact.interactionSchema, snapshot,
      expectedRuntimeIdentity(artifact.interactionSchema, run.runId)));
  };
  try {
    runtime.load(artifact.bytes);
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
    runtime.activate();
    for (const scan of acquired) {
      const outcome = structuredClone(runtime.scan({
        scanId: scan.completion.scanId,
        logicalTimeMs: scan.completion.logicalTimeMs,
        inputs: scan.inputs,
      }));
      outcomes.push(outcome);
      events.push(`scan:${scan.completion.scanId}`);
      // This is deliberately between scan N and scan N+1, not a post-run map.
      if (mode === 'every-scan') observe(outcome, scan);
    }
    if (mode === 'delayed-consumer') {
      // Read only retained, copied completed outcomes after the complete run.
      outcomes.forEach((outcome, index) => observe(outcome, run.scans[index]));
    }
    return { outcomes, snapshots, joins, events };
  } finally {
    runtime.dispose();
  }
}

test('GF-TEST-interaction-runtime-snapshot: exact corpus source/tape produces identical native and actual WASM typed snapshots', async () => {
  const verifiedCorpus = await verifyInteractionCorpus();
  assert.deepEqual(verifiedCorpus.cases.map(entry => entry.caseId), corpus.cases.map(entry => entry.caseId));
  for (const fixture of corpus.cases) {
    const artifact = await compileFixture(fixture);
    const tape = JSON.parse(read(fixture.tapePath));
    assert.equal(sha256(read(fixture.sourcePath)), fixture.source.sha256, `${fixture.caseId}: exact canonical literate source hash`);
    assert.equal(tapeDigest(tape), tape.digest.sha256, `${fixture.caseId}: exact canonical scan-tape digest`);
    for (const run of tape.runs) {
      const native = await nativeRun(artifact, run.scans);
      const wasm = await wasmRun(artifact, run.scans);
      assert.deepEqual(wasm, native, `${fixture.caseId}/${run.runId}: completed scan outcomes must match`);
      const nativeSnapshots = native.map((outcome, index) => emitCompletedScanSnapshot({
        compilation: artifact, runId: run.runId, completion: run.scans[index].completion, trace: outcome.trace,
      }));
      const wasmSnapshots = wasm.map((outcome, index) => emitCompletedScanSnapshot({
        compilation: artifact, runId: run.runId, completion: run.scans[index].completion, trace: outcome.trace,
      }));
      const producer = prepareCompletedScanSnapshot({ compilation: artifact, runId: run.runId });
      assert.deepEqual(native.map((outcome, index) => producer.emit({ completion: run.scans[index].completion, trace: outcome.trace })), nativeSnapshots);
      assert.deepEqual(wasm.map((outcome, index) => producer.emit({ completion: run.scans[index].completion, trace: outcome.trace })), wasmSnapshots);
      assert.deepEqual(wasmSnapshots, nativeSnapshots, `${fixture.caseId}/${run.runId}: native and WASM snapshot projection must match`);
      for (const snapshot of wasmSnapshots) {
        assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot,
          expectedRuntimeIdentity(artifact.interactionSchema, run.runId)), { status: 'ready', staleReasons: [] });
        assert.equal(JSON.stringify(snapshot).includes('__gf_'), false);
      }
      if (fixture.caseId === 'multiple-values' && run.runId === 'multiple-values-run-before-reset') {
        const after250ms = wasmSnapshots[2];
        assert.equal(after250ms.completion.logicalTimeMs, 250);
        assert.deepEqual(after250ms.observations.filter(entry => entry.descriptorId.startsWith('timer.')), [
          { descriptorId: 'timer.first_age', status: 'ready', value: 240 },
          { descriptorId: 'timer.second_age', status: 'ready', value: 0 },
        ]);
      }
    }
  }
});

test('GF-TEST-interaction-runtime-prepared: owned static data is verified once and isolated across scans', async t => {
  const fixture = corpus.cases[0];
  const artifact = await compileFixture(fixture);
  const tape = JSON.parse(read(fixture.tapePath));
  const run = tape.runs[0];
  const [outcome] = await wasmRun(artifact, run.scans.slice(0, 1));
  const request = { completion: run.scans[0].completion, trace: outcome.trace };
  const baseline = emitCompletedScanSnapshot({ compilation: artifact, runId: run.runId, ...request });
  const suppliedSchema = structuredClone(artifact.interactionSchema);
  let sourceReads = 0;
  const document = artifact.sourceDocument;
  Object.defineProperty(artifact, 'sourceDocument', { configurable: true, get() { sourceReads++; return document; } });
  // Instrument the owned copy too: accessing only the caller once would not
  // detect accidentally reparsing the copied source or rehashing copied bytes.
  const clone = structuredClone;
  let ownedSourceReads = 0, ownedByteReads = 0;
  const copySpy = t.mock.method(globalThis, 'structuredClone', value => {
    const copied = clone(value);
    if (copied?.sourceDocument && copied?.bytes && copied?.interactionSchema) {
      const text = copied.sourceDocument.text, bytes = copied.bytes;
      Object.defineProperty(copied.sourceDocument, 'text', { enumerable: true, get() { ownedSourceReads++; return text; } });
      Object.defineProperty(copied, 'bytes', { enumerable: true, get() { ownedByteReads++; return bytes; } });
    }
    return copied;
  });
  const producer = prepareCompletedScanSnapshot({ compilation: artifact, schema: suppliedSchema, runId: run.runId });
  copySpy.mock.restore();
  assert.ok(ownedSourceReads > 0 && ownedByteReads > 0, 'activation must verify source and bytecode');
  const verifiedReads = { source: ownedSourceReads, bytes: ownedByteReads };
  assert.equal(sourceReads, 1, 'copy the canonical document once at preparation');
  assert.ok(Object.isFrozen(producer));
  assert.ok(Object.isFrozen(producer.expected));
  const assertFrozen = value => {
    if (value !== null && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(assertFrozen);
    }
  };
  assertFrozen(producer.schema);
  assert.equal(Object.isFrozen(suppliedSchema), false, 'never freeze caller-owned schema');
  assert.equal(Object.isFrozen(document), false, 'never freeze caller-owned artifact');
  const first = producer.emit(request);
  assert.deepEqual(first, baseline);
  // One-shot snapshots have mutable nested data; each emission must own its data.
  first.module.id = 'changed';
  first.source.documentId = 'changed';
  first.completion.scanId = 999;
  first.observations[0].value = true;
  suppliedSchema.descriptors[0].name = 'changed';
  artifact.interactionSchema.descriptors[0].name = 'changed';
  artifact.traceMetadata.moduleFingerprint = '0'.repeat(16);
  artifact.traceMetadata.bindings.length = 0;
  artifact.bytes.fill(0);
  Object.defineProperty(artifact, 'sourceDocument', { get() { throw new Error('static source revisited'); } });
  for (let index = 0; index < 100; index++) {
    assert.deepEqual(producer.emit(request), baseline);
  }
  assert.equal(sourceReads, 1, 'static artifact verification must not recur during emit');
  assert.deepEqual({ source: ownedSourceReads, bytes: ownedByteReads }, verifiedReads, 'no copied source access or byte verification during emits');
  assert.throws(() => { producer.schema.descriptors[0].access.push('write'); }, TypeError);
  assert.deepEqual(joinRuntimeSnapshot(producer.schema, producer.emit(request), producer.expected), { status: 'ready', staleReasons: [] });
  const fresh = await compileFixture(fixture);
  const restarted = prepareCompletedScanSnapshot({ compilation: fresh, runId: 'run.restarted' });
  assert.deepEqual(joinRuntimeSnapshot(producer.schema, restarted.emit(request), producer.expected), { status: 'stale', staleReasons: ['runId'] });
});

test('GF-TEST-interaction-runtime-snapshot-enum-phase-age: completed WASM scan observes nominal phase and elapsed phase age', async () => {
  const sourcePath = 'contracts/interaction-v0/examples/enum-phase-age.ghost.md';
  const artifact = await compileSource(read(sourcePath), {
    filename: sourcePath,
    interactionSourceIdentity: {
      documentId: 'source.fixture-enum-phase-age',
      revisionId: 'revision.fixture-enum-phase-age-v0',
    },
  });
  const run = {
    runId: 'enum-phase-age-run',
    scans: [
      { completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 100 }, inputs: [{ name: 'advance', value: false }] },
      { completion: { kind: 'completed-scan', scanId: 1, logicalTimeMs: 175 }, inputs: [{ name: 'advance', value: true }] },
      { completion: { kind: 'completed-scan', scanId: 2, logicalTimeMs: 230 }, inputs: [{ name: 'advance', value: true }] },
    ],
  };
  const execution = await executeWasm(artifact, run, 'every-scan');
  assert.equal(execution.outcomes[1].trace.stateAfter.phase, 1, 'enum runtime state is exposed as its scalar ordinal');
  assert.deepEqual(execution.snapshots[2].observations, [
    { descriptorId: 'state.phase', status: 'ready', value: 1 },
    { descriptorId: 'timer.age', status: 'ready', value: 55 },
  ]);
  const invalidTrace = structuredClone(execution.outcomes[1].trace);
  invalidTrace.stateAfter.phase = 2;
  const invalid = emitCompletedScanSnapshot({ compilation: artifact, runId: run.runId,
    completion: run.scans[1].completion, trace: invalidTrace });
  assert.deepEqual(invalid.observations.find(entry => entry.descriptorId === 'state.phase'),
    { descriptorId: 'state.phase', status: 'error', error: 'runtime-value-type-mismatch' });
});

test('GF-TEST-interaction-runtime-snapshot-watering: eight outputs follow edge latch, priority stops, and exact five-minute cutoff', async () => {
  const fixture = corpus.cases[0];
  const artifact = await compileFixture(fixture);
  const tape = JSON.parse(read(fixture.tapePath));
  const run = tape.runs[0];
  const execution = await executeWasm(artifact, run, 'every-scan');
  const wateringByScan = [false, true, true, false, false, false, true, false, false, false, true, false, false];
  const timerAgeByScan = [0, 0, 1000, 0, 1000, 2000, 0, 0, 1000, 2000, 0, 0, 1000];

  assert.deepEqual(execution.outcomes.map(outcome => outcome.trace.stateAfter.watering), wateringByScan);
  assert.deepEqual(execution.snapshots.map(snapshot => snapshot.observations.find(entry => entry.descriptorId === 'timer.age').value), timerAgeByScan);
  for (const [index, outcome] of execution.outcomes.entries()) {
    const expectedOutputs = Object.fromEntries(Array.from({ length: 8 }, (_, channel) => {
      const name = `RO${channel + 1}`;
      return [name, name === 'RO1' || name === 'RO2' ? wateringByScan[index] : false];
    }));
    assert.deepEqual(outcome.trace.requested, expectedOutputs, `scan ${index}: exact requested output set`);
    assert.deepEqual(outcome.trace.safe, expectedOutputs, `scan ${index}: exact safe output set`);
  }

  const scans = run.scans;
  assert.equal(scans[2].inputs[0].value, false, 'release after the start edge');
  assert.deepEqual(scans[2].inputs.slice(3).map(input => input.value), [true, true, true, true, true], 'spare DI4-DI8 inputs may be asserted without affecting control');
  assert.equal(execution.outcomes[2].trace.stateAfter.watering, true, 'released request maintains watering');
  assert.equal(scans[3].inputs[1].value, true, 'stop is asserted while a new request edge is present');
  assert.equal(execution.outcomes[3].trace.stateBefore.watering, true);
  assert.equal(execution.outcomes[3].trace.stateAfter.watering, false, 'stop has priority in the same scan');
  assert.equal(scans[4].inputs[0].value, true);
  assert.equal(scans[4].inputs[1].value, false);
  assert.equal(execution.outcomes[4].trace.stateAfter.watering, false, 'clearing stop while DI1 stays held does not restart');
  assert.equal(execution.outcomes[6].trace.stateAfter.watering, true, 'release then a new request edge restarts');
  assert.equal(scans[7].inputs[2].value, true);
  assert.equal(execution.outcomes[7].trace.stateBefore.watering, true);
  assert.equal(execution.outcomes[7].trace.stateAfter.watering, false, 'low-water has priority in the same scan');
  assert.equal(scans[8].inputs[0].value, true);
  assert.equal(scans[8].inputs[2].value, false);
  assert.equal(execution.outcomes[8].trace.stateAfter.watering, false, 'clearing low-water while DI1 stays held does not restart');
  assert.equal(execution.outcomes[10].trace.stateAfter.watering, true, 'a second release and new edge starts a fresh timed run');
  assert.equal(scans[11].completion.logicalTimeMs - scans[10].completion.logicalTimeMs, 300000);
  assert.equal(execution.outcomes[11].trace.stateBefore.watering, true);
  assert.equal(execution.outcomes[11].trace.stateAfter.watering, false, 'the exact five-minute boundary turns watering off');
  assert.equal(scans[12].inputs[0].value, true);
  assert.equal(execution.outcomes[12].trace.stateAfter.watering, false, 'holding DI1 beyond cutoff does not restart');
});

test('GF-TEST-interaction-runtime-snapshot-observation: disabled, immediate, and delayed observation never change control outcomes', async () => {
  for (const fixture of corpus.cases) {
    const artifact = await compileFixture(fixture);
    const tape = JSON.parse(read(fixture.tapePath));
    for (const run of tape.runs) {
      const disabled = await executeWasm(artifact, run, 'disabled');
      const immediate = await executeWasm(artifact, run, 'every-scan');
      const delayed = await executeWasm(artifact, run, 'delayed-consumer');
      const expected = disabled.outcomes.map(controlShape);
      assert.deepEqual(immediate.outcomes.map(controlShape), expected);
      assert.deepEqual(delayed.outcomes.map(controlShape), expected);
      assert.deepEqual(immediate.joins, run.scans.map(() => ({ status: 'ready', staleReasons: [] })));
      assert.deepEqual(delayed.joins, run.scans.map(() => ({ status: 'ready', staleReasons: [] })));
      assert.equal(disabled.joins.length, 0);
      assert.equal(disabled.snapshots.length, 0);
      assert.equal(immediate.snapshots.length, run.scans.length);
      assert.equal(delayed.snapshots.length, run.scans.length);
      const scanEvents = run.scans.map(scan => `scan:${scan.completion.scanId}`);
      const observationEvents = run.scans.map(scan => `observe:${scan.completion.scanId}`);
      assert.deepEqual(disabled.events, scanEvents);
      assert.deepEqual(immediate.events, run.scans.flatMap(scan => [
        `scan:${scan.completion.scanId}`, `observe:${scan.completion.scanId}`,
      ]));
      assert.deepEqual(delayed.events, [...scanEvents, ...observationEvents]);
    }
  }
});

test('GF-TEST-interaction-runtime-snapshot-identity: run epoch prevents a reused scan zero from joining a prior execution', async () => {
  const fixture = corpus.cases[0];
  const artifact = await compileFixture(fixture);
  const tape = JSON.parse(read(fixture.tapePath));
  const before = await executeWasm(artifact, tape.runs[0], 'every-scan');
  const after = await executeWasm(artifact, tape.runs[1], 'every-scan');
  assert.notEqual(tape.runs[0].runId, tape.runs[1].runId);
  assert.equal(tape.runs[1].scans.length, 1, 'the reset run is the minimum fresh scan-zero proof');
  assert.equal(before.snapshots[0].completion.scanId, 0);
  assert.equal(after.snapshots[0].completion.scanId, 0);
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, after.snapshots[0],
    expectedRuntimeIdentity(artifact.interactionSchema, tape.runs[0].runId)), {
    status: 'stale', staleReasons: ['runId'],
  });
  assert.throws(() => joinRuntimeSnapshot(artifact.interactionSchema, {
    ...after.snapshots[0], observations: [{ descriptorId: 'state.watering', status: 'stale' }],
  }, expectedRuntimeIdentity(artifact.interactionSchema, tape.runs[1].runId)), /failed contract validation/);
});

test('GF-TEST-interaction-runtime-snapshot-statuses: false and zero are ready while missing and malformed values are explicit', async () => {
  const fixture = corpus.cases[0];
  const artifact = await compileFixture(fixture);
  const tape = JSON.parse(read(fixture.tapePath));
  const [outcome] = await wasmRun(artifact, tape.runs[0].scans.slice(0, 1));
  const ready = emitCompletedScanSnapshot({
    compilation: artifact, runId: tape.runs[0].runId, completion: tape.runs[0].scans[0].completion, trace: outcome.trace,
  });
  assert.deepEqual(ready.observations, [
    { descriptorId: 'state.request_was_high', status: 'ready', value: false },
    { descriptorId: 'state.watering', status: 'ready', value: false },
    { descriptorId: 'timer.age', status: 'ready', value: 0 },
  ]);
  assert.equal(ready.completion.scanId, tape.runs[0].scans[0].completion.scanId, 'REF-05-021 values share one completed scan');
  const unavailableTrace = structuredClone(outcome.trace);
  delete unavailableTrace.stateAfter.request_was_high;
  const unavailable = emitCompletedScanSnapshot({
    compilation: artifact, runId: tape.runs[0].runId, completion: tape.runs[0].scans[0].completion, trace: unavailableTrace,
  });
  assert.deepEqual(unavailable.observations[0], {
    descriptorId: 'state.request_was_high', status: 'unavailable', reason: 'runtime-value-unavailable',
  });
  const malformedTrace = structuredClone(outcome.trace);
  malformedTrace.stateAfter.request_was_high = null;
  const malformed = emitCompletedScanSnapshot({
    compilation: artifact, runId: tape.runs[0].runId, completion: tape.runs[0].scans[0].completion, trace: malformedTrace,
  });
  assert.deepEqual(malformed.observations[0], {
    descriptorId: 'state.request_was_high', status: 'error', error: 'runtime-value-invalid',
  });
  assert.equal(JSON.stringify(malformed).includes('__gf_'), false);
});

test('GF-TEST-interaction-runtime-snapshot-state-only: a completed state scan does not require a generated timer clock', async () => {
  const source = `# State-only interaction fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-STATE-ONLY-V0 kind=intent status=unconfirmed origin=ai -->
This fixture proves that an authored state remains observable without inventing a timer.

\`\`\`ghost
control StateOnly {
  input enabled: Bool;
  output active_output: Bool;

  // ghostflow:link id=GF-INT-FIXTURE-STATE-ONLY-V0 relation=implements
  state active: Bool = false;

  active' = case enabled { ok(value) => value; fault(_) => active; };
  active_output <- active';
}
\`\`\`
`;
  const artifact = await compileSource(source, {
    filename: 'state-only.ghost.md',
    interactionSourceIdentity: {
      documentId: 'document.state-only',
      revisionId: 'revision.state-only.1',
    },
  });
  const scan = {
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 125 },
    inputs: [{ name: 'enabled', value: true }],
  };
  const [outcome] = await wasmRun(artifact, [scan]);
  assert.equal(Object.hasOwn(outcome.trace.inputs, '__gf_now_ms'), false);

  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.state-only.1',
    completion: scan.completion,
    trace: outcome.trace,
  });
  assert.deepEqual(snapshot.observations, [
    { descriptorId: 'state.active', status: 'ready', value: true },
  ]);
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot,
    expectedRuntimeIdentity(artifact.interactionSchema, 'run.state-only.1')), {
    status: 'ready', staleReasons: [],
  });
});

test('GF-TEST-interaction-runtime-snapshot-empty: direct control preserves native/WASM output parity with an identified empty observation', async () => {
  const artifact = await compileSource(directSource, {
    filename: 'direct-output.ghost.md',
    interactionSourceIdentity: {
      documentId: 'source.direct-output',
      revisionId: 'revision.direct-output.1',
    },
  });
  const scans = [{
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 125 },
    inputs: [{ name: 'enabled', value: true }],
  }];
  const native = await nativeRun(artifact, scans);
  const wasm = await wasmRun(artifact, scans);
  assert.deepEqual(wasm, native);
  assert.equal(wasm[0].trace.safe.pump, true);

  const snapshot = emitCompletedScanSnapshot({
    compilation: artifact,
    runId: 'run.direct-output.1',
    completion: scans[0].completion,
    trace: wasm[0].trace,
  });
  assert.deepEqual(snapshot.observations, []);
  const serialized = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(serialized, snapshot);
  assert.equal(serialized.source.revisionId, 'revision.direct-output.1');
  assert.equal(serialized.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(serialized.module.moduleFingerprint, wasm[0].trace.module);
  assert.equal(serialized.runId, 'run.direct-output.1');
  assert.deepEqual(serialized.completion, scans[0].completion);
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, serialized,
    expectedRuntimeIdentity(artifact.interactionSchema, 'run.direct-output.1')), { status: 'ready', staleReasons: [] });
  assert.deepEqual(joinRuntimeSnapshot(artifact.interactionSchema, snapshot,
    expectedRuntimeIdentity(artifact.interactionSchema, 'run.direct-output.1')), {
    status: 'ready', staleReasons: [],
  });
});

test('GF-TEST-interaction-runtime-snapshot-fail-closed: producer rejects schema or trace identity drift without exposing generated storage', async () => {
  const fixture = corpus.cases[0];
  const artifact = await compileFixture(fixture);
  const tape = JSON.parse(read(fixture.tapePath));
  const [outcome] = await wasmRun(artifact, tape.runs[0].scans.slice(0, 1));
  const request = {
    compilation: artifact,
    runId: tape.runs[0].runId,
    completion: tape.runs[0].scans[0].completion,
    trace: outcome.trace,
  };
  const tamperedSchema = structuredClone(artifact.interactionSchema);
  tamperedSchema.module.moduleFingerprint = '0'.repeat(16);
  assert.throws(() => emitCompletedScanSnapshot({ ...request, schema: tamperedSchema }), /interaction schema:/);
  const rejectedTrace = { ...outcome.trace, module: '0'.repeat(16) };
  assert.throws(() => emitCompletedScanSnapshot({ ...request, trace: rejectedTrace }), error => {
    assert.match(error.message, /runtime observation could not be verified/);
    assert.equal(error.message.includes('__gf_'), false);
    return true;
  });
  const missingTimerClock = structuredClone(outcome.trace);
  delete missingTimerClock.inputs.__gf_now_ms;
  assert.throws(() => emitCompletedScanSnapshot({ ...request, trace: missingTimerClock }), /completed trace clock does not match completion/);
  const mismatchedTimerClock = structuredClone(outcome.trace);
  mismatchedTimerClock.inputs.__gf_now_ms += 1;
  assert.throws(() => emitCompletedScanSnapshot({ ...request, trace: mismatchedTimerClock }), /completed trace clock does not match completion/);
  assert.throws(() => prepareCompletedScanSnapshot({ ...request, schema: tamperedSchema }), /interaction schema:/);
  for (const mutate of [
    candidate => { candidate.bytes[0] ^= 1; },
    candidate => { candidate.sourceDocument.text += '\nchanged'; },
    candidate => { candidate.interactionSchema.descriptors[0].access.push('write'); },
  ]) {
    const candidate = structuredClone(artifact);
    mutate(candidate);
    assert.throws(() => prepareCompletedScanSnapshot({ compilation: candidate, runId: request.runId }));
  }
  assert.throws(() => prepareCompletedScanSnapshot({ compilation: artifact, runId: {} }), /runId/);
  const producer = prepareCompletedScanSnapshot(request);
  for (let scan = 0; scan < 3; scan++) {
    assert.throws(() => producer.emit({ ...request, trace: rejectedTrace }), /runtime observation could not be verified/);
    for (const trace of [missingTimerClock, mismatchedTimerClock]) {
      assert.throws(() => producer.emit({ ...request, trace }), /completed trace clock does not match completion/);
    }
    for (const completion of [undefined, { ...request.completion, extra: true },
      { ...request.completion, kind: 'in-progress' }, { ...request.completion, scanId: -1 },
      { ...request.completion, logicalTimeMs: 0.5 }]) {
      assert.throws(() => producer.emit({ ...request, completion }), /completion/);
    }
    const malformed = structuredClone(producer.emit(request));
    malformed.observations[0].status = 'stale';
    assert.throws(() => joinRuntimeSnapshot(producer.schema, malformed, producer.expected), /failed contract validation/);
    assert.throws(() => joinRuntimeSnapshot(producer.schema, producer.emit(request), { ...producer.expected, extra: true }), /expected identity/);
    for (const [field, reason] of [['sourceRevisionId', 'source.revisionId'], ['sourceSha256', 'source.sha256'], ['runId', 'runId']]) {
      const expected = { ...producer.expected, [field]: field === 'sourceSha256' ? '0'.repeat(64) : 'different' };
      assert.deepEqual(joinRuntimeSnapshot(producer.schema, producer.emit(request), expected), { status: 'stale', staleReasons: [reason] });
    }
  }
});
