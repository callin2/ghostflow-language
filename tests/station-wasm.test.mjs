import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');

if (!existsSync(wasmPath)) {
  execFileSync('cargo', ['build', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {
    cwd: root,
    stdio: 'inherit',
  });
}

const wasmBytes = readFileSync(wasmPath);

async function station(config = {}) {
  return GhostFlowStation.instantiate(wasmBytes, {
    valveCount: 4,
    maxOpenValves: 2,
    dailyQuotaMs: 1_000,
    maxStartBudgetMs: 800,
    ...config,
  });
}

function synchronize(instance, nowMs = 0n) {
  instance.synchronizeDay({ day: 20_000, nowMs, nextDayDeadlineMs: 10_000n, trusted: true });
}

function enterAuto(instance, requestId = 1n) {
  instance.enter({ requestId, ...instance.claim, mode: 'Auto' });
}

function startRequest(instance, requestId, occurrenceId, nowMs = 10n, budgetMs = 100n) {
  return {
    requestId,
    ...instance.claim,
    sessionId: 77n,
    ownerId: 88n,
    mode: 'Auto',
    valves: 0b11n,
    budgetMs,
    occurrenceId,
    nowMs,
  };
}

test('uses the built WASM and keeps optional capacity advisory', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  const writes = [];
  const grant = await instance.start(startRequest(instance, 2n, 501n), async (bytes, token) => {
    writes.push({ bytes: bytes.slice(), token });
    return true;
  });
  assert.equal(grant.capacity, 'Unknown');
  assert.equal(writes.length, 1);
  assert(writes[0].bytes.length > 16);
  const output = instance.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 10n });
  assert.equal(output.pumpOn, true);
  instance.reportApplied({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 10n });
  instance.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 110n });
  instance.requestStop({ requestId: 3n, ...instance.claim });
  await instance.finish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 110n }, async () => true);
  assert.equal(instance.dailyUsedMs, 100n);
  assert.equal(instance.reservedMs, 0n);
  instance.dispose();
});

test('immediate Stop cancels a hanging Start persistence before it can grant output', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  let releasePersistence;
  const starting = instance.start(
    startRequest(instance, 2n, 502n),
    () => new Promise((resolvePersistence) => { releasePersistence = resolvePersistence; }),
  );
  await Promise.resolve();
  const directive = instance.requestStop({ requestId: 3n, ...instance.claim, skippedOccurrenceIds: [502n] });
  assert.deepEqual(directive, { forceSafeOutputs: true, reason: 'StopRequested' });
  assert.equal(instance.stopping, true);
  assert(instance.snapshot().length > 16);
  assert.throws(() => instance.commitStart(1n), /no matching prepared transition/);
  releasePersistence(false);
  await assert.rejects(starting, /did not acknowledge/);
  assert.throws(() => instance.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 11n }));
  instance.dispose();
});

test('stop invokes its synchronous safe-output callback before hanging or rejected persistence', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  const order = [];
  let releasePersistence;
  const stopping = instance.stop({ requestId: 2n, ...instance.claim, skippedOccurrenceIds: [599n] }, (bytes, token) => {
    order.push('persist');
    assert.equal(token, 0n);
    assert(bytes.length > 16);
    return new Promise((resolvePersistence) => { releasePersistence = resolvePersistence; });
  }, (directive) => {
    order.push('safe');
    assert.deepEqual(directive, { forceSafeOutputs: true, reason: 'StopRequested' });
  });
  assert.deepEqual(order, ['safe', 'persist']);
  assert.equal(instance.stopping, true);
  releasePersistence(false);
  await assert.rejects(stopping, /did not acknowledge/);
  instance.dispose();
});

test('advance returns a safe-output directive when the finite lease expires', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  await instance.start(startRequest(instance, 2n, undefined, 10n, 100n), async () => true);
  assert.deepEqual(instance.advance(109n), { forceSafeOutputs: false, reason: undefined });
  assert.deepEqual(instance.advance(110n), { forceSafeOutputs: true, reason: 'LeaseExpired' });
  instance.dispose();
});

test('a pending start that outlives its lease cannot commit or rewind monotonic time', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  const prepared = instance.prepareStart(startRequest(instance, 2n, 504n, 10n, 100n));
  assert.deepEqual(instance.advance(110n), { forceSafeOutputs: false, reason: undefined });
  assert.throws(() => instance.commitStart(prepared.token), /lease/i);
  assert.equal(instance.reservedMs, 100n);
  assert.throws(() => instance.advance(109n), /monotonic/i);
  instance.dispose();
});

test('restored active reservation is held, then still deduplicates its occurrence', async () => {
  const original = await station();
  synchronize(original);
  enterAuto(original);
  await original.start(startRequest(original, 2n, 503n), async () => true);
  const snapshot = original.snapshot();
  const restored = new GhostFlowStation(original.wasm, { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1_000, maxStartBudgetMs: 800 });
  restored.restore(snapshot);
  synchronize(restored, 1n);
  restored.acknowledgeRecoverySafeOutput({ nowMs: 2n });
  enterAuto(restored, 3n);
  assert.throws(() => restored.prepareStart(startRequest(restored, 4n, 503n, 10n)), /occurrence id was already accepted/);
  original.dispose();
  restored.dispose();
});

test('restore rejects a snapshot made with different safety configuration', async () => {
  const original = await station();
  synchronize(original);
  const snapshot = original.snapshot();
  const mismatched = new GhostFlowStation(original.wasm, { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1_000, maxStartBudgetMs: 799 });
  assert.throws(() => mismatched.restore(snapshot), /safety configuration/i);
  original.dispose();
  mismatched.dispose();
});

test('wrapper rejects narrowing/coercion and use after disposal', async () => {
  const instance = await station();
  assert.throws(() => instance.synchronizeDay({ day: 1.5, nowMs: 0n, nextDayDeadlineMs: 10n, trusted: true }), /32-bit/);
  assert.throws(() => instance.synchronizeDay({ day: 1, nowMs: Number.MAX_SAFE_INTEGER + 1, nextDayDeadlineMs: 10n, trusted: true }), /safe integer/);
  synchronize(instance);
  enterAuto(instance);
  assert.throws(() => instance.prepareStart({ ...startRequest(instance, 2n, undefined), valves: '3' }), /BigInt or safe integer/);
  assert.throws(() => instance.authorizeOutput({ sessionId: 77n, pumpOn: 1, valves: 1n, nowMs: 10n }), /boolean/);
  instance.dispose();
  assert.throws(() => instance.snapshot(), /disposed/);
  assert.throws(() => instance.claim, /disposed/);
});
