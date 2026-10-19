import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { softwareQualityAbi, softwareQualityRails } from './helpers/software-quality-observations.mjs';
import { prepareCurriculumReplays, readCurriculumReplayManifest, verifyCurriculumReplayWasm } from '../tools/curriculum-replay.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { compileSource, restoreArtifactSourceMap, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

// Proof ends at VM requested/safe intent and source/constraint provenance.
// Driver applied/confirmed, physical flow, and full evaluated-path DAG (#88) are separate claims.
const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, `target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`);
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));

function sourceMap(artifact) {
  return {
    format: 'GhostFlow/source-map-v1',
    bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument,
    nodes: artifact.sourceMap,
    lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata,
  };
}

async function runBoth(t, artifact, frames) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-irrigation-proof-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'control.gfb');
  const tapePath = path.join(directory, 'frames.tsv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, `${frames.map(({ atMs, inputs }, scanId) => [scanId, atMs,
    ...Object.entries(softwareQualityRails(artifact, inputs, scanId + 1, atMs)).flatMap(([name, value]) => [name, typeof value === 'boolean' ? 'b' : 'n', String(value)]),
  ].join('\t')).join('\n')}\n`);
  const nativeRun = spawnSync(nativePath, [modulePath, tapePath], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(nativeRun.status, 0, nativeRun.stderr || nativeRun.stdout);
  const native = nativeRun.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(native.every(record => record.accepted), 'all hand-authored proof frames commit');

  const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  softwareQualityAbi(runtime, artifact);
  for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
  runtime.activate();
  const wasm = [];
  for (const { atMs, inputs } of frames) {
    for (const [name, value] of Object.entries(inputs)) runtime.setBool(name, value);
    runtime.tickAt(atMs);
    wasm.push(runtime.trace);
  }
  assert.deepEqual(wasm, native.map(record => record.outcome.trace));
  const replay = runtime.replayCore({ count: frames.length, maxJsonBytes: 1024 * 1024 });
  assert.equal(replay.checkpointTick, 0);
  assert.deepEqual(replay.records, wasm);
  return { traces: wasm, replay };
}

test('PC-02 core irrigation proof links canonical intent, state, pump and valve across native/WASM replay', async t => {
  const prepared = await prepareCurriculumReplays();
  const { scenario, artifact } = prepared.scenarios.find(entry => entry.scenario.id === 'PC-02');
  assert.deepEqual(['schedules', 'timers', 'signals', 'configs'].map(key => artifact.manifest[key]),
    [[], [], [], []], 'PC-02 keeps Bool/state/constraint logic with typed acquisition rails');
  assert.deepEqual(artifact.manifest.sensors.map(({ name, type }) => ({ name, type })),
    [{ name: 'start', type: 'Bool' }, { name: 'stop_ok', type: 'Bool' }]);
  const original = fs.readFileSync(path.join(root, scenario.source.canonicalPath), 'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'), scenario.source.canonicalSha256);
  assert.equal(artifact.sourceDocument.sha256, scenario.source.canonicalSha256);
  const map = sourceMap(artifact);
  assert.deepEqual(verifyArtifactSourceMap(map, artifact.bytes, {
    expectedSourceSha256: scenario.source.canonicalSha256,
  }), artifact.sourceDocument);
  assert.equal(restoreArtifactSourceMap(map, artifact.bytes).sourceDocument.text, original);
  assert.throws(() => verifyArtifactSourceMap(map, artifact.bytes, {
    expectedSourceSha256: '0'.repeat(64),
  }), /expected revision/);

  const intentId = 'GF-INT-PC02-START-STOP-REARM-V1';
  assert.ok(artifact.traceMetadata.intentAnchors.some(anchor => anchor.id === intentId && anchor.status === 'confirmed'));
  const runningState = artifact.traceMetadata.bindings.find(binding => binding.kind === 'state' && binding.name === 'running');
  assert.ok(artifact.traceMetadata.intentLinks.some(link => link.anchorId === intentId && link.nodeId === runningState.nodeId));
  for (const output of ['pump', 'valve']) {
    assert.ok(artifact.traceMetadata.dependencies.some(entry => entry.target.field === 'requested'
      && entry.target.name === output && entry.reads.some(read => read.field === 'stateAfter' && read.name === 'running')));
  }

  const { traces, replay } = await runBoth(t, artifact, scenario.frames);
  const expected = [
    [true, false, false], [false, true, true], [true, true, true], [false, false, false],
    [false, false, false], [true, false, false], [false, true, true],
  ];
  assert.deepEqual(traces.map(trace => [trace.stateAfter.armed, trace.stateAfter.running, trace.safe.pump]), expected);
  assert.deepEqual(traces.map(trace => [trace.requested.pump, trace.safe.pump, trace.requested.valve, trace.safe.valve]),
    expected.map(([, , on]) => [on, on, on, on]));
  assert.equal(replay.records[6].tick, 7);
  const observed = observeSourceTrace(artifact.traceMetadata, traces[6]);
  assert.equal(observed.sourceDocumentSha256, scenario.source.canonicalSha256);
  for (const output of ['pump', 'valve']) {
    assert.deepEqual(observed.bindings.find(binding => binding.name === output).observations,
      [{ field: 'requested', observed: true, value: true }, { field: 'safe', observed: true, value: true }]);
  }
  const tampered = structuredClone(readCurriculumReplayManifest());
  const pc02 = tampered.scenarios.find(entry => entry.id === 'PC-02');
  pc02.checkpoints.find(checkpoint => checkpoint.frame === 6).safe.pump = false;
  await assert.rejects(() => verifyCurriculumReplayWasm(wasmBytes, { manifest: tampered }),
    /PC-02 .* checkpoint 6 safe\.pump expected false, got true/);
});

test('pump permission source links a blocked request to the authored require node', async t => {
  const filename = 'examples/authoring/pump-rev-2.ghost.md';
  const artifact = await compileSource(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
  const { traces } = await runBoth(t, artifact, [
    { atMs: 0, inputs: { start: true, stop: false, permit_ok: false } },
  ]);
  const trace = traces[0];
  assert.deepEqual([trace.requested.pump, trace.safe.pump, trace.requested.permit, trace.safe.permit],
    [true, false, false, false]);
  const observed = observeSourceTrace(artifact.traceMetadata, trace);
  const blocked = observed.constraints[0];
  assert.equal(blocked.kind, 'requires');
  assert.deepEqual(blocked.observed.firstViolation.blocked, ['pump']);
  assert.equal(blocked.source.filename, filename);
  assert.ok(artifact.traceMetadata.intentLinks.some(link => link.anchorId === 'GF-INT-PUMP-PERMIT'
    && link.relation === 'constrains' && link.nodeId === blocked.nodeId));
  const pump = observed.bindings.find(binding => binding.name === 'pump');
  assert.deepEqual(pump.observations,
    [{ field: 'requested', observed: true, value: true }, { field: 'safe', observed: true, value: false }]);
  assert.ok(artifact.traceMetadata.intentLinks.some(link => link.anchorId === 'GF-INT-PUMP-REQUEST'
    && link.relation === 'implements' && link.nodeId === pump.nodeId));
});
