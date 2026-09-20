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
  expectedRuntimeIdentity,
  joinRuntimeSnapshot,
} from '../tools/interaction-runtime-snapshot.mjs';
import { verifyInteractionCorpus } from '../contracts/interaction-v0/verify-corpus.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'contracts/interaction-v0/examples/corpus.json'), 'utf8'));
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''));

const directSource = `# Direct input to output

The pump follows the enable input without authored state or a timer.

\`\`\`ghost
control DirectOutput {
  input enabled: Bool;
  output pump: Bool;
  pump <- enabled;
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

function nativeRun(artifact, scans) {
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
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  const outcomes = [];
  const snapshots = [];
  const joins = [];
  const events = [];
  const observe = (outcome, scan) => {
    events.push(`observe:${scan.completion.scanId}`);
    const snapshot = emitCompletedScanSnapshot({
      compilation: artifact, runId: run.runId, completion: scan.completion, trace: outcome.trace,
    });
    snapshots.push(snapshot);
    joins.push(joinRuntimeSnapshot(artifact.interactionSchema, snapshot,
      expectedRuntimeIdentity(artifact.interactionSchema, run.runId)));
  };
  try {
    runtime.load(artifact.bytes);
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
    runtime.activate();
    for (const scan of run.scans) {
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
      const native = nativeRun(artifact, run.scans);
      const wasm = await wasmRun(artifact, run.scans);
      assert.deepEqual(wasm, native, `${fixture.caseId}/${run.runId}: completed scan outcomes must match`);
      const nativeSnapshots = native.map((outcome, index) => emitCompletedScanSnapshot({
        compilation: artifact, runId: run.runId, completion: run.scans[index].completion, trace: outcome.trace,
      }));
      const wasmSnapshots = wasm.map((outcome, index) => emitCompletedScanSnapshot({
        compilation: artifact, runId: run.runId, completion: run.scans[index].completion, trace: outcome.trace,
      }));
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

  active' = enabled;
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
  const native = nativeRun(artifact, scans);
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
});
