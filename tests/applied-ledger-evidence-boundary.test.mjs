import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';
import { fileURLToPath } from 'node:url';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { verifyArtifactSourceMap } from '../tools/toolchain.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const wasmBytes = readFileSync(wasmPath);
const config = { maxIntervals: 32, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 86_400_000n };

const id = value => {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
};
const hex = bytes => Buffer.from(bytes).toString('hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function actualSnapshot(ledger) {
  assert.equal(ledger.wasm.gf_accounting_snapshot(ledger.handle), 1);
  const ptr = ledger.wasm.gf_accounting_snapshot_ptr(ledger.handle), len = ledger.wasm.gf_accounting_snapshot_len(ledger.handle);
  return { bytes: new Uint8Array(ledger.wasm.memory.buffer, ptr, len).slice(), revision: ledger.wasm.gf_accounting_revision(ledger.handle) };
}

test('REF-08-008: durable applied ledger uses stable resource evidence and ignores requested and UI display time', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/03-settings-boundaries.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-08-008');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/325');
  assert.equal(original.scope, 'host');
  assert.equal(original.status, 'specified');
  assert.match(original.given, /자동·수동 요청/);
  assert.match(original.then, /applied 또는 confirmed/);

  const source = '# REF-08-008 applied evidence ledger\n\n```ghost\ncontrol EvidenceBoundary {\n'
    + 'resource pump: BoolActuator;\n'
    + 'account pump_applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'constraints Duty { limit used(pump_applied, rolling(60s)) <= 45s { reserve = 5s; on_unknown = block; } }\n'
    + 'output ready: Bool; ready <- false;\n}\n```\n';
  const filename = 'ref-08-008-applied-evidence.ghost.md';
  const artifact = await compileSource(source, { filename });
  verifyArtifactSourceMap({ format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata, interactionSchema: null, interactionSourceIdentity: null }, artifact.bytes,
  { manifest: artifact.manifest });
  const binding = artifact.manifest.accounting.bindings.find(item => item.name === 'pump_applied');
  assert.deepEqual(binding.evidenceBinding, { kind: 'applied_interval', target: 'pump', stage: 'applied', identity: 'receipt_id' });
  assert.equal(binding.persistence, 'durable');
  const resourceId = 38;
  const limit = artifact.manifest.accounting.constraints[0].limits[0];
  assert.deepEqual([limit.account, limit.basis.kind, limit.basis.durationMs, limit.boundMs, limit.reserveMs],
    ['pump_applied', 'rolling', 60_000, 45_000, 5_000]);

  const requestedAndUiFacts = Object.freeze([
    { path: 'automatic', requested: [0, 60_000], uiDisplayMs: 999_000, label: 'screen animates old request' },
    { path: 'manual', requested: [5_000, 12_000], uiDisplayMs: 1_001_000, label: 'operator panel displays another time' },
    { path: 'automatic', requested: [70_000, 90_000], uiDisplayMs: 1_002_000, label: 'future request not applied' },
  ]);
  assert.notDeepEqual(requestedAndUiFacts.map(fact => fact.requested), [[10_000, 30_000], [25_000, 45_000], [50_000, 55_000]]);
  // An actual compiled producer executes automatic/manual requests. It is
  // independent of the caller-validated Driver interval ingestion contract.
  const producer = await compileSource('# Request producer\n\n```ghost\ncontrol Requests {\n'
    + 'input automatic, manual: Bool; output pump: Bool; pump <- case automatic { ok(a) => case manual { ok(m) => a || m; fault(_) => a; }; fault(_) => case manual { ok(m) => m; fault(_) => false; }; };\n}\n```\n', { filename: 'requests.ghost.md' });
  const requestRuntime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasmBytes, producer));
  t.after(() => requestRuntime.dispose());
  const requestFrames = [
    { nowMs: 0, inputs: { automatic: false, manual: false } },
    { nowMs: 5000, inputs: { automatic: true, manual: false } },
    { nowMs: 12_000, inputs: { automatic: false, manual: true } },
    { nowMs: 70_000, inputs: { automatic: true, manual: false } },
  ];
  const requestOutcomes = [];

  let durableSnapshot;
  const persist = async bytes => { durableSnapshot = bytes.slice(); return true; };
  const ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => ledger.dispose());
  assert.equal(ledger.source.text, source);
  assert.equal(ledger.source.filename, filename);
  assert.equal(ledger.source.account, binding.name);
  assert.equal(ledger.source.target, 'pump');
  assert.equal(ledger.source.stage, 'applied');
  assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
  assert.equal(ledger.usedRolling(resourceId, 60_000n, 60_000n), null, 'missing durable snapshot fails closed');

  await ledger.initializeEmpty(persist);
  const emptySnapshot = durableSnapshot.slice();
  const beforeRequestBytes = hex(emptySnapshot);
  const beforeRequests = actualSnapshot(ledger);
  for (const [index, variant] of requestedAndUiFacts.entries()) {
    requestRuntime.step(requestFrames[index]);
    requestOutcomes.push(structuredClone(requestRuntime.lastFrameOutcome));
    assert.equal(ledger.usedRolling(resourceId, 60_000n, 60_000n), 0n, variant.label);
    assert.equal(hex(durableSnapshot), beforeRequestBytes, 'request/UI metadata alone is not ledger evidence');
    assert.deepEqual(actualSnapshot(ledger), beforeRequests, 'actual live ledger bytes and revision do not change during request execution');
  }

  const appliedReceipts = [
    { receiptId: id(1), resourceId, startMs: 10_000n, endMs: 30_000n, localDay: 24, provenance: 'automatic driver applied' },
    { receiptId: id(2), resourceId, startMs: 25_000n, endMs: 45_000n, localDay: 24, provenance: 'manual driver applied alias' },
    { receiptId: id(3), resourceId, startMs: 50_000n, endMs: 55_000n, localDay: 24, provenance: 'automatic later applied' },
  ];
  assert.equal(await ledger.recordAppliedSegment(appliedReceipts[0], persist), 'Inserted');
  assert.equal(ledger.usedRolling(resourceId, 60_000n, 60_000n), 20_000n);
  const afterFirst = durableSnapshot.slice();
  assert.equal(await ledger.recordAppliedSegment(appliedReceipts[1], persist), 'Inserted');
  assert.equal(ledger.usedRolling(resourceId, 60_000n, 60_000n), 35_000n, 'overlapping automatic/manual aliases union by stable resource');
  assert.equal(await ledger.recordAppliedSegment(appliedReceipts[1]), 'Duplicate');
  assert.equal(ledger.usedLocalDay(resourceId, 24), 35_000n, 'duplicate receipt is idempotent');
  assert.equal(await ledger.recordAppliedSegment(appliedReceipts[2], persist), 'Inserted');
  assert.equal(ledger.usedRolling(resourceId, 60_000n, 60_000n), 40_000n);
  assert.equal(ledger.usedLocalDay(resourceId, 24), 40_000n);
  const afterApplied = durableSnapshot.slice();
  const actualAfterApplied = actualSnapshot(ledger);
  requestRuntime.step(requestFrames.at(-1));
  requestOutcomes.push(structuredClone(requestRuntime.lastFrameOutcome));
  assert.deepEqual(actualSnapshot(ledger), actualAfterApplied, 'post-applied producer execution cannot mutate the actual usage owner');
  assert.deepEqual(requestOutcomes.map(outcome => outcome.trace.requested.pump), [false, true, true, true]);
  assert.notEqual(hex(afterFirst), hex(afterApplied));
  for (const variant of [...requestedAndUiFacts].reverse()) {
    assert.equal(ledger.usedRolling(resourceId, 60_000n, 60_000n), 40_000n, variant.label);
    assert.equal(hex(durableSnapshot), hex(afterApplied), 'changed request/UI facts still do not change durable bytes');
  }
  assert.throws(() => ledger.usedRolling(resourceId + 1, 60_000n, 60_000n), /wrong bound resource ID/);

  const restored = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => restored.dispose());
  restored.restore(afterApplied);
  assert.equal(restored.usedRolling(resourceId, 60_000n, 60_000n), 40_000n);
  assert.equal(restored.usedLocalDay(resourceId, 24), 40_000n);
  const restarted = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => restarted.dispose());
  assert.equal(restarted.usedRolling(resourceId, 60_000n, 60_000n), null, 'fresh owner without restored bytes is fail closed');
  restarted.restore(afterApplied);
  assert.equal(restarted.usedRolling(resourceId, 60_000n, 60_000n), 40_000n);
  const corrupt = afterApplied.slice();
  corrupt[7] ^= 1;
  assert.throws(() => restarted.restore(corrupt), /invalid accounting ledger snapshot/);
  assert.equal(restarted.usedRolling(resourceId, 60_000n, 60_000n), null, 'corrupt restore poisons the owner fail closed');

  const pending = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => pending.dispose());
  pending.restore(emptySnapshot);
  await assert.rejects(pending.recordAppliedSegment(appliedReceipts[0], async () => false), /accounting snapshot was not durably acknowledged/);
  assert.equal(pending.usedRolling(resourceId, 60_000n, 60_000n), null, 'pending persistence is Unknown');
  await pending.persistPending(persist);
  assert.equal(pending.usedRolling(resourceId, 60_000n, 60_000n), 20_000n);

  const wrongResource = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => wrongResource.dispose());
  await wrongResource.initializeEmpty(async () => true);
  await assert.rejects(wrongResource.recordAppliedSegment({ ...appliedReceipts[0], resourceId: resourceId + 1 }, async () => true), /wrong bound resource ID/);
  const collision = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => collision.dispose());
  await collision.initializeEmpty(async () => true);
  await collision.recordAppliedSegment(appliedReceipts[0], async () => true);
  await assert.rejects(collision.recordAppliedSegment({ ...appliedReceipts[0], endMs: 31_000n }, async () => true), /accounting identity was reused with different evidence/);

  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'accounting_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'ref-08-008-accounting-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb');
  const tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  const frames = [
    { nowMs: 30_000, segments: [{ receiptId: 1, resourceId, startMs: 10_000, endMs: 30_000 }], query: true },
    { nowMs: 45_000, segments: [{ receiptId: 2, resourceId, startMs: 25_000, endMs: 45_000 }], query: true },
    { nowMs: 60_000, segments: [{ receiptId: 3, resourceId, startMs: 50_000, endMs: 55_000 }], query: true },
  ];
  const nativeRequest = { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, manifest: artifact.manifest,
    account: binding.name, target: 'pump', resourceId, windowMs: 60_000, frames };
  const runner = resolve(root, 'target/release/examples/accounting_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const runNative = request => {
    writeFileSync(tapePath, JSON.stringify(request));
    return JSON.parse(execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  };
  const native = runNative(nativeRequest);
  const expectedNative = { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, account: binding.name,
    target: 'pump', stage: 'applied', resourceId, observations: [
      { nowMs: 30_000, usedMs: 20_000 }, { nowMs: 45_000, usedMs: 35_000 }, { nowMs: 60_000, usedMs: 40_000 },
    ] };
  assert.deepEqual(native, expectedNative);
  const parityLedger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => parityLedger.dispose());
  await parityLedger.initializeEmpty(async () => true);
  const wasmObservations = [];
  for (const frame of frames) {
    for (const segment of frame.segments) await parityLedger.recordAppliedSegment({ ...segment,
      receiptId: id(segment.receiptId), startMs: BigInt(segment.startMs), endMs: BigInt(segment.endMs), localDay: 100 }, async () => true);
    wasmObservations.push({ nowMs: frame.nowMs, usedMs: Number(parityLedger.usedRolling(resourceId, BigInt(frame.nowMs), 60_000n)) });
  }
  assert.deepEqual(native, { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, account: parityLedger.source.account,
    target: parityLedger.source.target, stage: parityLedger.source.stage, resourceId, observations: wasmObservations });
  assert.deepEqual(runNative(nativeRequest), native, 'fresh native deterministic replay preserves all observations; each segment internally snapshot/restores');
  const producerModule = join(directory, 'requests.gfb'), producerTape = join(directory, 'requests.tsv');
  writeFileSync(producerModule, producer.bytes);
  writeFileSync(producerTape, requestFrames.map((frame, scan) => [scan, frame.nowMs,
    ...Object.entries(requestOutcomes[scan].trace.inputs).filter(([name]) => name !== '__gf_now_ms')
      .flatMap(([name, value]) => [name, typeof value === 'boolean' ? 'b' : 'n', value])].join('\t')).join('\n') + '\n');
  const scanRunner = resolve(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const nativeRequests = execFileSync(scanRunner, [producerModule, producerTape], { encoding: 'utf8', timeout: 10_000 })
    .trim().split('\n').map(line => JSON.parse(line));
  assert.equal(nativeRequests.length, requestFrames.length, 'every producer frame has a native receipt');
  assert.ok(nativeRequests.every(row => row.accepted));
  assert.deepEqual(nativeRequests.map(row => row.outcome), requestOutcomes, 'complete native and WASM automatic/manual producer outcomes agree');
  for (const [mutate, reason] of [
    [request => { request.frames[0].segments[0].resourceId = resourceId + 1; }, /wrong bound resource ID/],
    [request => { request.manifest.accounting.bindings[0].evidenceBinding.stage = 'confirmed'; }, /unsupported source accounting binding/],
    [request => { request.moduleFingerprint = '0'.repeat(16); }, /compiled module identity mismatch/],
  ]) {
    const invalid = structuredClone(nativeRequest);
    mutate(invalid);
    assert.throws(() => runNative(invalid), reason);
  }

  t.diagnostic(JSON.stringify({ sourceSha256: artifact.sourceDocument.sha256,
    artifactSha256: artifact.manifest.bytecodeSha256, durableSnapshotSha256: sha256(afterApplied),
    selectedProfile: { account: binding.name, resourceId, stage: 'applied', persistence: 'durable' },
    limit: 'native accounting_tape emits source-bound metadata and observations; byte snapshot preservation is asserted through the WASM ABI' }));
});
