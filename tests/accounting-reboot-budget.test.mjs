import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = readFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const config = { maxIntervals: 8, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 600_000n };
const id = value => new Uint8Array(16).fill(value);
const source = '# REF-03-022 reboot budget oracle\n\n```ghost\ncontrol RebootBudget {\n'
  + 'resource pump: BoolActuator;\n'
  + 'account applied = on_time(pump, stage: applied, persistence: durable);\n'
  + 'constraints Budget { limit used(applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }\n'
  + 'output ready: Bool; ready <- false;\n}\n```\n';
const filename = 'ref-03-022-reboot-budget.ghost.md';
const resourceId = 7;
const windowMs = 60_000n, limitMs = 30_000n, reserveMs = 5_000n;
const rebootNowMs = 28_000n, expiryNowMs = 63_000n;

function rawSnapshot(ledger) {
  const w = ledger.wasm, handle = ledger.handle;
  const status = w.gf_accounting_snapshot(handle);
  const bytes = new Uint8Array(w.memory.buffer, w.gf_accounting_snapshot_ptr(handle),
    w.gf_accounting_snapshot_len(handle)).slice();
  return { status, bytes: [...bytes], revision: Number(w.gf_accounting_revision(handle)) };
}
async function expectUnknownAdmissionNoMutation(ledger, proposal) {
  const before = rawSnapshot(ledger);
  let persistCalls = 0;
  await assert.rejects(ledger.reserveRolling(proposal, async () => { persistCalls++; return true; }), /accounting|snapshot|ledger|Unknown/i);
  assert.equal(persistCalls, 0, 'Unknown fail-closed admission must not invoke persistence');
  assert.deepEqual(rawSnapshot(ledger), before, 'Unknown admission must not reserve, revise, or mutate bytes');
  return before;
}
function comparableNativeSnapshot(value) {
  return { status: value.status, bytes: value.bytes, revision: Number(value.revision) };
}

test('REF-03-022: durable applied reboot budget blocks Unknown after reboot and preserves restored 28s history', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-03-022');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/212');
  assert.equal(original.scope, 'runtime'); assert.equal(original.status, 'specified');
  assert.match(original.given + original.when + original.then, /checkpoint|reboot|reset|window/iu);

  const artifact = await compileSource(source, { filename });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  const binding = artifact.manifest.accounting.bindings.find(entry => entry.name === 'applied');
  assert.deepEqual(binding.evidenceBinding, { kind: 'applied_interval', target: 'pump', stage: 'applied', identity: 'receipt_id' });
  const sourceLimit = artifact.manifest.accounting.constraints[0].limits[0];
  assert.deepEqual([sourceLimit.account, sourceLimit.basis.kind, sourceLimit.basis.durationMs,
    sourceLimit.boundMs, sourceLimit.reserveMs, sourceLimit.onUnknown, sourceLimit.persistence],
  ['applied', 'rolling', 60_000, 30_000, 5_000, 'block', 'durable']);

  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-wasm', '--example', 'accounting_reboot_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'ghostflow-reboot-budget-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb'), tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  const moduleFingerprint = artifact.bytes.reduce((hash, byte) => BigInt.asUintN(64,
    (hash ^ BigInt(byte)) * 0x100000001b3n), 0xcbf29ce484222325n).toString(16).padStart(16, '0');
  const tape = { moduleFingerprint, manifest: artifact.manifest, account: 'applied', target: 'pump', resourceId,
    windowMs: Number(windowMs), limitMs: Number(limitMs), reserveMs: Number(reserveMs), rebootNowMs: Number(rebootNowMs),
    expiryNowMs: Number(expiryNowMs), actualStartMs: 0, actualEndMs: 28_000 };
  writeFileSync(tapePath, JSON.stringify(tape));
  const runner = resolve(root, 'target/release/examples/accounting_reboot_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const native = JSON.parse(execFileSync(runner, [modulePath, tapePath], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual([native.account, native.target, native.stage, native.resourceId], ['applied', 'pump', 'applied', resourceId]);
  for (const [mutate, reason] of [
    [value => { value.moduleFingerprint = '0000000000000000'; }, /identity mismatch/],
    [value => { value.target = 'other'; }, /source target mismatch/],
    [value => { value.manifest.accounting.constraints[0].limits[0].onUnknown = 'allow'; }, /constraint mismatch/],
  ]) {
    const invalid = structuredClone(tape); mutate(invalid); writeFileSync(tapePath, JSON.stringify(invalid));
    assert.throws(() => execFileSync(runner, [modulePath, tapePath], { cwd: root, stdio: 'pipe' }), reason);
  }

  let persisted;
  const persistedOwner = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
  try {
    assert.equal(persistedOwner.source.sha256, artifact.sourceDocument.sha256);
    assert.equal(persistedOwner.source.artifactSha256, artifact.manifest.bytecodeSha256);
    assert.deepEqual([persistedOwner.source.account, persistedOwner.source.target, persistedOwner.source.stage], ['applied', 'pump', 'applied']);
    const persist = async bytes => { persisted = bytes.slice(); return true; };
    await persistedOwner.initializeEmpty(persist);
    await persistedOwner.recordAppliedSegment({ receiptId: id(1), resourceId, startMs: 0n, endMs: 28_000n, localDay: 100 }, persist);
    assert.deepEqual(rawSnapshot(persistedOwner), comparableNativeSnapshot(native.durable));
  } finally { persistedOwner.dispose(); }

  const fresh = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
  try {
    assert.equal(fresh.explainRolling({ nowMs: rebootNowMs, windowMs, limitMs, reserveMs }), null,
      'fresh source-bound owner without initializeEmpty and without durable checkpoint is Unknown, not zero');
    assert.equal(fresh.usedRolling(resourceId, rebootNowMs, windowMs), null);
    const before = await expectUnknownAdmissionNoMutation(fresh, { reservationId: id(2), resourceId,
      admittedAtMs: rebootNowMs, windowMs, limitMs, reserveMs });
    assert.deepEqual(before, comparableNativeSnapshot(native.fresh.before));
    assert.deepEqual(rawSnapshot(fresh), comparableNativeSnapshot(native.fresh.after));
    assert.deepEqual(native.fresh.used, { status: 2, value: null });
    assert.equal(native.fresh.admission.status, 0);
    assert.equal(native.fresh.admission.persistCalls, 0);
  } finally { fresh.dispose(); }

  const restored = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
  try {
    restored.restore(persisted);
    assert.deepEqual(rawSnapshot(restored), comparableNativeSnapshot(native.restored.before));
    const known = restored.explainRolling({ nowMs: rebootNowMs, windowMs, limitMs, reserveMs });
    assert.notEqual(known, null, 'valid restored checkpoint is Known');
    assert.deepEqual([known.usedMs, known.reservedMs, known.blocked, known.nextReleaseMs], [28_000n, 0n, true, 63_000n]);
    assert.equal(restored.usedRolling(resourceId, rebootNowMs, windowMs), 28_000n);
    assert.equal(await restored.reserveRolling({ reservationId: id(3), resourceId, admittedAtMs: rebootNowMs, windowMs, limitMs, reserveMs }, async () => {
      throw new Error('rejected admission must not persist');
    }), 'Rejected');
    assert.deepEqual(rawSnapshot(restored), comparableNativeSnapshot(native.restored.afterBlock));
    assert.deepEqual(native.restored.used, { status: 1, value: 28_000 });
    assert.deepEqual(native.restored.block.before, native.restored.block.after);
    assert.equal(native.restored.block.status, 3);
    assert.equal(native.restored.block.persistCalls, 0);

    const expired = restored.explainRolling({ nowMs: expiryNowMs, windowMs, limitMs, reserveMs });
    assert.deepEqual([expired.usedMs, expired.blocked, expired.nextReleaseMs], [25_000n, false, null],
      'caller-supplied comparable monotonic time lets the historical window expire without a physical-clock bridge');
    assert.equal(restored.usedRolling(resourceId, expiryNowMs, windowMs), 25_000n);
    assert.deepEqual(native.restored.expiryUsed, { status: 1, value: 25_000 });
    let persistCalls = 0;
    assert.equal(await restored.reserveRolling({ reservationId: id(4), resourceId, admittedAtMs: expiryNowMs, windowMs, limitMs, reserveMs }, async () => {
      persistCalls++; return true;
    }), 'Inserted');
    assert.equal(persistCalls, 1);
    assert.equal(restored.explainRolling({ nowMs: expiryNowMs, windowMs, limitMs, reserveMs }).reservedMs, 5_000n);
    assert.deepEqual(rawSnapshot(restored), comparableNativeSnapshot(native.restored.afterExpiry));
    assert.equal(native.restored.expiryGrant.status, 1);
  } finally { restored.dispose(); }

  const corrupt = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
  try {
    const damaged = persisted.slice(); damaged[7] ^= 255;
    assert.throws(() => corrupt.restore(damaged));
    assert.equal(corrupt.explainRolling({ nowMs: rebootNowMs, windowMs, limitMs, reserveMs }), null,
      'corrupt checkpoint remains Unknown rather than restoring zero');
    await expectUnknownAdmissionNoMutation(corrupt, { reservationId: id(5), resourceId,
      admittedAtMs: rebootNowMs, windowMs, limitMs, reserveMs });
    assert.equal(native.corrupt.restoreStatus, 0);
    assert.deepEqual(native.corrupt.used, { status: 2, value: null });
    assert.equal(native.corrupt.admission.status, 0);
    assert.equal(native.corrupt.admission.persistCalls, 0);
    assert.deepEqual(native.corrupt.before, native.corrupt.after);
    assert.deepEqual(rawSnapshot(corrupt), comparableNativeSnapshot(native.corrupt.after));
  } finally { corrupt.dispose(); }

  await assert.rejects(AccountingRuntime.instantiateSource(wasm, source.replace('stage: applied', 'stage: safe'), {
    filename, account: 'applied', resourceId, config,
  }), /applied|unsupported accounting stage/);
  const bounded = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
  try {
    await bounded.initializeEmpty(async () => true);
    assert.throws(() => bounded.explainRolling({ nowMs: rebootNowMs, windowMs: 120_000n, limitMs, reserveMs }), /bound source constraint/);
    assert.throws(() => bounded.usedRolling(resourceId + 1, rebootNowMs, windowMs), /wrong bound resource ID/);
    await assert.rejects(bounded.reserveRolling({ reservationId: id(6), resourceId, admittedAtMs: rebootNowMs,
      windowMs, limitMs: 31_000n, reserveMs }, async () => true), /bound source constraint/);
  } finally { bounded.dispose(); }
});
