import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');

execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {
  cwd: root, stdio: 'inherit',
});
const wasmBytes = readFileSync(wasmPath);
const config = { maxIntervals: 16, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 60_000n };
const id = value => new Uint8Array(16).fill(value);
const source = '# REF-03-019 rolling overlap admission boundary\n\n```ghost\ncontrol RollingOverlapAdmission {\n'
  + 'resource pump: BoolActuator;\naccount pump_applied = on_time(pump, stage: applied, persistence: durable);\n'
  + 'constraints Budget { limit used(pump_applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }\n'
  + 'output ready: Bool; ready <- false;\n}\n```\n';
const filename = 'ref-03-019-rolling-overlap.ghost.md';
const resourceId = 7;
const windowMs = 60_000n;
const limitMs = 30_000n;
const reserveMs = 5_000n;

function snapshot(ledger) {
  const { bytes, revision } = ledger.snapshot();
  return { bytes: [...bytes], revision };
}

function receipt(sequence) {
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(sequence), true);
  return bytes;
}

test('REF-03-019: source-bound rolling overlap blocks exact limit and admits exact recovered reserve', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-03-019');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/209');
  assert.equal(original.scope, 'runtime');
  assert.equal(original.status, 'specified');
  assert.match(original.given, /\(0,20\].*\(30,40\]/);
  assert.match(original.then, /15초.*10초.*used=25s/);

  const artifact = await compileSource(source, { filename });
  const binding = artifact.manifest.accounting.bindings.find(entry => entry.name === 'pump_applied');
  assert.deepEqual(binding.evidenceBinding, { kind: 'applied_interval', target: 'pump', stage: 'applied', identity: 'receipt_id' });
  const sourceLimit = artifact.manifest.accounting.constraints[0].limits[0];
  assert.deepEqual([sourceLimit.account, sourceLimit.basis.kind, BigInt(sourceLimit.basis.durationMs), BigInt(sourceLimit.boundMs), BigInt(sourceLimit.reserveMs)],
    ['pump_applied', 'rolling', windowMs, limitMs, reserveMs]);

  const ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => ledger.dispose());
  assert.equal(ledger.source.text, source);
  assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
  assert.deepEqual([ledger.source.account, ledger.source.target, ledger.source.stage], [binding.name, 'pump', 'applied']);

  let durableSnapshot;
  const persist = async bytes => { durableSnapshot = bytes.slice(); return true; };
  await ledger.initializeEmpty(persist);
  await ledger.recordAppliedSegment({ receiptId: receipt(1), resourceId, startMs: 0n, endMs: 20_000n, localDay: 100 }, persist);
  await ledger.recordAppliedSegment({ receiptId: receipt(2), resourceId, startMs: 30_000n, endMs: 40_000n, localDay: 100 }, persist);

  const atLimit = { nowMs: 40_000n, windowMs, limitMs, reserveMs };
  const atRecovered = { nowMs: 65_000n, windowMs, limitMs, reserveMs };
  const explanation40 = ledger.explainRolling(atLimit);
  assert.deepEqual([explanation40.usedMs, explanation40.reservedMs, explanation40.blocked, explanation40.blockReason],
    [30_000n, 0n, true, 'rolling-budget']);
  assert.equal(ledger.usedRolling(resourceId, 40_000n, windowMs), 30_000n);
  const beforeRejected = snapshot(ledger);
  let rejectedPersistCalls = 0;
  assert.equal(await ledger.reserveRolling({ reservationId: id(40), resourceId, admittedAtMs: 40_000n, ...atLimit }, async () => { rejectedPersistCalls++; return true; }), 'Rejected');
  assert.equal(rejectedPersistCalls, 0, 'exact-limit rejection never asks the host to persist');
  assert.deepEqual(snapshot(ledger), beforeRejected, 'rejection does not mutate ledger revision, reservations, or bytes');
  assert.deepEqual(ledger.explainRolling(atLimit), explanation40);

  const explanation65 = ledger.explainRolling(atRecovered);
  assert.deepEqual([explanation65.usedMs, explanation65.reservedMs, explanation65.blocked, explanation65.blockReason, explanation65.nextReleaseMs],
    [25_000n, 0n, false, null, null]);
  assert.equal(ledger.usedRolling(resourceId, 65_000n, windowMs), 25_000n);
  await assert.rejects(ledger.reserveRolling({ reservationId: id(65), resourceId, admittedAtMs: 65_000n, ...atRecovered }, async () => false), /not durably acknowledged/);
  assert.equal(ledger.explainRolling(atRecovered), null, 'accepted-but-unacknowledged admission is Unknown until persistence is acknowledged');
  let retryPersistenceCalls = 0;
  await assert.rejects(ledger.reserveRolling({ reservationId: id(65), resourceId, admittedAtMs: 65_000n, ...atRecovered }, async () => { retryPersistenceCalls++; return true; }), /not durably acknowledged/);
  assert.equal(retryPersistenceCalls, 0, 'pending admission retry fails closed before another persistence attempt');
  await ledger.persistPending(persist);
  assert.equal(await ledger.reserveRolling({ reservationId: id(65), resourceId, admittedAtMs: 65_000n, ...atRecovered }, persist), 'Duplicate');
  const accepted = ledger.explainRolling(atRecovered);
  assert.deepEqual([accepted.usedMs, accepted.reservedMs, accepted.blocked, accepted.nextReleaseMs], [25_000n, 5_000n, true, 70_000n]);

  const restored = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
  t.after(() => restored.dispose());
  restored.restore(durableSnapshot);
  assert.equal(restored.usedRolling(resourceId, 65_000n, windowMs), 25_000n);
  assert.deepEqual([restored.explainRolling(atRecovered).usedMs, restored.explainRolling(atRecovered).reservedMs], [25_000n, 5_000n]);
  assert.throws(() => ledger.usedRolling(8, 65_000n, windowMs), /wrong bound resource ID/);
  assert.throws(() => ledger.explainRolling({ ...atRecovered, reserveMs: 1_000n }), /bound source constraint/);
});

test('REF-03-019: native accounting_tape and WASM observe the same clipped partial overlap oracle', async t => {
  const artifact = await compileSource(source, { filename });
  const binding = artifact.manifest.accounting.bindings.find(entry => entry.name === 'pump_applied');
  const frames = [
    { nowMs: 40_000, segments: [
      { receiptId: 1, resourceId, startMs: 0, endMs: 20_000 },
      { receiptId: 2, resourceId, startMs: 30_000, endMs: 40_000 },
    ], query: true, admission: { reservationId: 40, limitMs: 30_000, reserveMs: 5_000, retry: false } },
    { nowMs: 65_000, segments: [], query: true,
      admission: { reservationId: 65, limitMs: 30_000, reserveMs: 5_000, retry: true } },
  ];
  const expected = [{ nowMs: 40_000, usedMs: 30_000 }, { nowMs: 65_000, usedMs: 25_000 }];
  const expectedAdmissions = [
    { nowMs: 40_000, status: 'Rejected', snapshotUnchanged: true, retry: null, usedMs: 30_000, reservedMs: 0 },
    { nowMs: 65_000, status: 'Inserted', snapshotUnchanged: false, retry: 'Duplicate', usedMs: 25_000, reservedMs: 5_000 },
  ];

  const executeWasm = async () => {
    const ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: binding.name, resourceId, config });
    try {
      await ledger.initializeEmpty(async () => true);
      for (const segment of frames[0].segments) {
        await ledger.recordAppliedSegment({ ...segment, receiptId: receipt(segment.receiptId),
          startMs: BigInt(segment.startMs), endMs: BigInt(segment.endMs), localDay: 100 }, async () => true);
      }
      const observations = [], admissions = [];
      for (const frame of frames) {
        observations.push({ nowMs: frame.nowMs, usedMs: Number(ledger.usedRolling(resourceId, BigInt(frame.nowMs), windowMs)) });
        const before = snapshot(ledger);
        const proposal = { reservationId: receipt(frame.admission.reservationId), resourceId,
          admittedAtMs: BigInt(frame.nowMs), windowMs, limitMs, reserveMs };
        const status = await ledger.reserveRolling(proposal, async () => true);
        const unchanged = JSON.stringify(snapshot(ledger), (_, value) => typeof value === 'bigint' ? value.toString() : value)
          === JSON.stringify(before, (_, value) => typeof value === 'bigint' ? value.toString() : value);
        const retry = frame.admission.retry ? await ledger.reserveRolling(proposal, async () => true) : null;
        const explanation = ledger.explainRolling({ nowMs: BigInt(frame.nowMs), windowMs, limitMs, reserveMs });
        admissions.push({ nowMs: frame.nowMs, status, snapshotUnchanged: unchanged, retry,
          usedMs: Number(explanation.usedMs), reservedMs: Number(explanation.reservedMs) });
      }
      return { observations, admissions };
    } finally { ledger.dispose(); }
  };

  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'accounting_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'ref-03-019-accounting-tape-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb');
  const tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  const runner = resolve(root, 'target/release/examples/accounting_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const request = { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, manifest: artifact.manifest,
    account: binding.name, target: binding.evidenceBinding.target, resourceId, windowMs: Number(windowMs), frames };
  writeFileSync(tapePath, JSON.stringify(request));
  const native = JSON.parse(execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  assert.deepEqual(native, { moduleFingerprint: artifact.traceMetadata.moduleFingerprint,
    account: binding.name, target: 'pump', stage: 'applied', resourceId, observations: expected,
    admissionObservations: expectedAdmissions });
  assert.deepEqual(await executeWasm(), { observations: expected, admissions: expectedAdmissions });
  const wrongBound = structuredClone(request);
  wrongBound.frames[0].admission.limitMs++;
  writeFileSync(tapePath, JSON.stringify(wrongBound));
  assert.throws(() => execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, stdio: 'pipe' }),
    /source rolling admission constraint mismatch/);
});
