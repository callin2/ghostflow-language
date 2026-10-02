import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { prepareCompletedScanSnapshot, joinRuntimeSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const native = path.join(root, `target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`);
const scans = [0, 1000].map((logicalTimeMs, scanId) => ({ scanId, logicalTimeMs, inputs: [] }));

async function compile(initial, revision) {
  const source = [
    '# Keep completed observations bound to their actual Program and run', '',
    '<!-- ghostflow:anchor id=GF-INT-REF-05-024 kind=intent status=confirmed origin=user -->',
    'Issue [#284](https://github.com/callin2/ghostflow-language/issues/284) checks REF-05-024: observations from another Program or execution epoch cannot be presented as the current snapshot.', '',
    '```ghost', 'control SnapshotIdentity {',
    '  // ghostflow:link id=GF-INT-REF-05-024 relation=implements',
    `  state running: Bool = ${initial};`,
    "  running' = !running;", '  output pump: Bool;',
    '  // ghostflow:link id=GF-INT-REF-05-024 relation=implements',
    "  pump <- running';", '}', '```', '',
  ].join('\n');
  return compileSource(source, { filename: 'snapshot-identity.ghost.md', interactionSourceIdentity: {
    documentId: 'source.ref-05-024', revisionId: revision,
  } });
}

async function completed(compilation, runId) {
  const producer = prepareCompletedScanSnapshot({ compilation, runId });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-snapshot-identity-'));
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, compilation.bytes);
    fs.writeFileSync(tapePath, scans.map(frame => `${frame.scanId}\t${frame.logicalTimeMs}\n`).join(''));
    const result = spawnSync(native, [modulePath, tapePath], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const nativeOutcomes = result.stdout.trim().split('\n').map(line => JSON.parse(line).outcome);
    runtime.load(compilation.bytes);
    runtime.addCapability('actuator', 'pump', 'bool');
    runtime.activate();
    const wasmOutcomes = scans.map(frame => runtime.scan(frame));
    assert.deepEqual(wasmOutcomes, nativeOutcomes, 'same canonical bytecode has identical complete native/WASM outcomes');
    const project = outcome => producer.emit({
      completion: { kind: 'completed-scan', scanId: outcome.scanId, logicalTimeMs: outcome.logicalTimeMs },
      trace: outcome.trace,
    });
    const snapshots = wasmOutcomes.map(project);
    assert.deepEqual(snapshots, nativeOutcomes.map(project));
    for (const snapshot of snapshots) assert.deepEqual(joinRuntimeSnapshot(producer.schema, snapshot, producer.expected), {
      status: 'ready', staleReasons: [],
    });
    return { producer, snapshots, outcomes: wasmOutcomes };
  } finally {
    runtime.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('REF-05-024 canonical native and WASM snapshots reject crossed Program documents and mark a valid foreign Program stale', async () => {
  const a = await compile(false, 'revision.ref-05-024.a');
  const b = await compile(true, 'revision.ref-05-024.b');
  const first = await completed(a, 'run.ref-05-024.shared');
  const second = await completed(b, 'run.ref-05-024.shared');
  assert.notEqual(a.interactionSchema.module.moduleFingerprint, b.interactionSchema.module.moduleFingerprint);
  assert.notEqual(a.interactionSchema.module.bytecodeSha256, b.interactionSchema.module.bytecodeSha256);
  assert.notEqual(first.snapshots[0].observations[0].value, second.snapshots[0].observations[0].value);
  const retained = structuredClone([first, second].map(run => ({ snapshots: run.snapshots, outcomes: run.outcomes })));
  assert.throws(() => joinRuntimeSnapshot(first.producer.schema, second.snapshots[0], first.producer.expected), /failed contract validation/);
  const stale = joinRuntimeSnapshot(second.producer.schema, second.snapshots[0], first.producer.expected);
  assert.deepEqual(stale, { status: 'stale', staleReasons: [
    'schema.sha256', 'module.moduleFingerprint', 'module.bytecodeSha256', 'source.revisionId', 'source.sha256',
  ] });
  const forged = structuredClone(first.snapshots[0]);
  forged.module = structuredClone(second.snapshots[0].module);
  assert.equal(validateInteraction(first.producer.schema, forged).valid, false);
  assert.throws(() => joinRuntimeSnapshot(first.producer.schema, forged, first.producer.expected), /failed contract validation/);
  assert.deepEqual([first, second].map(run => ({ snapshots: run.snapshots, outcomes: run.outcomes })), retained);
});

test('REF-05-024 separate native and WASM execution instances with reused scan zero remain stale across host-owned run epochs', async () => {
  const compilation = await compile(false, 'revision.ref-05-024.same');
  const prior = await completed(compilation, 'run.ref-05-024.before');
  const current = await completed(compilation, 'run.ref-05-024.after');
  assert.deepEqual(prior.outcomes, current.outcomes, 'fresh instances may reuse identical scan IDs, times and values');
  assert.deepEqual(prior.snapshots[0].module, current.snapshots[0].module);
  assert.deepEqual(prior.snapshots[0].source, current.snapshots[0].source);
  assert.deepEqual(prior.snapshots[0].completion, current.snapshots[0].completion);
  const retained = structuredClone([prior.snapshots, current.snapshots]);
  assert.deepEqual(joinRuntimeSnapshot(current.producer.schema, prior.snapshots[0], current.producer.expected), {
    status: 'stale', staleReasons: ['runId'],
  });
  assert.deepEqual(joinRuntimeSnapshot(prior.producer.schema, current.snapshots[0], prior.producer.expected), {
    status: 'stale', staleReasons: ['runId'],
  });
  const forged = structuredClone(prior.snapshots[0]);
  forged.observations[0].status = 'stale';
  assert.equal(validateInteraction(prior.producer.schema, forged).valid, false);
  assert.throws(() => joinRuntimeSnapshot(prior.producer.schema, forged, current.producer.expected), /failed contract validation/);
  assert.deepEqual([prior.snapshots, current.snapshots], retained);
});
