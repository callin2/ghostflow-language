import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');

execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {
  cwd: root, stdio: 'inherit',
});
const wasmBytes = readFileSync(wasmPath);
const config = { maxIntervals: 8, maxEvents: 8, maxRollingWindowMs: 60_000n };
const id = value => new Uint8Array(16).fill(value);

test('WASM accounting stays Unknown until exact snapshot revision is persisted', async () => {
  const runtime = await AccountingRuntime.instantiate(wasmBytes, config);
  let durableSnapshot;
  let durableRevision;
  const persist = async (snapshot, revision) => {
    durableSnapshot = snapshot.slice();
    durableRevision = revision;
    return true;
  };

  assert.equal(runtime.eventCount(9, 100), null);
  await runtime.initializeEmpty(persist);
  assert.equal(runtime.eventCount(9, 100), 0n);

  await assert.rejects(runtime.recordEvent({ eventId: id(1), eventType: 9, localDay: 100 }, async () => false), /not durably acknowledged/);
  assert.equal(runtime.eventCount(9, 100), null);
  await runtime.persistPending(persist);
  assert.equal(runtime.eventCount(9, 100), 1n);
  assert.equal(durableRevision, 2n);

  assert.equal(await runtime.recordEvent({ eventId: id(1), eventType: 9, localDay: 100 }), 'Duplicate');
  assert.equal(runtime.eventCount(9, 100), 1n);

  await runtime.recordAppliedSegment({ receiptId: id(2), resourceId: 7, startMs: 0n, endMs: 20_000n, localDay: 100 }, persist);
  await runtime.recordAppliedSegment({ receiptId: id(3), resourceId: 7, startMs: 10_000n, endMs: 30_000n, localDay: 100 }, persist);
  assert.equal(runtime.usedRolling(7, 30_000n, 20_000n), 20_000n);
  assert.equal(runtime.usedLocalDay(7, 100), 30_000n);

  const restored = await AccountingRuntime.instantiate(wasmBytes, config);
  restored.restore(durableSnapshot);
  assert.equal(restored.eventCount(9, 100), 1n);
  assert.equal(restored.usedLocalDay(7, 100), 30_000n);

  const corrupt = durableSnapshot.slice();
  corrupt[7] ^= 1;
  assert.throws(() => restored.restore(corrupt), /invalid accounting ledger snapshot/);
  assert.equal(restored.eventCount(9, 100), null);
  runtime.dispose();
  restored.dispose();
});

test('accounting wrapper validates stable IDs and integer bounds', async () => {
  const runtime = await AccountingRuntime.instantiate(wasmBytes, config);
  assert.throws(() => runtime.usedLocalDay(7, 0x8000_0000), /integer range/);
  await assert.rejects(runtime.recordEvent({ eventId: new Uint8Array(8), eventType: 9, localDay: 100 }), /16-byte/);
  runtime.dispose();
});

test('canonical source binds only supported ledger accounts to explicit host IDs', async () => {
  const filename = 'accounting-source.ghost.md';
  const source = `# Accounting\n\n\`\`\`ghost
control Accounting {
  resource pump: BoolActuator;
  event started: Event;
  account applied = on_time(pump, stage: applied, persistence: durable);
  account starts = count_events(started, over: local_day("Asia/Seoul"), persistence: durable);
  output ready: Bool;
  ready <- true;
}
\`\`\`\n`;
  const persist = async () => true;
  const applied = await AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'applied', resourceId: 7, config,
  });
  assert.equal(applied.source.text, source);
  assert.equal(applied.source.filename, filename);
  assert.equal(applied.source.account, 'applied');
  assert.equal(applied.source.target, 'pump');
  assert.equal(applied.source.stage, 'applied');
  assert.match(applied.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(applied.source.artifactSha256, /^[a-f0-9]{64}$/);
  await applied.initializeEmpty(persist);
  await assert.rejects(applied.recordAppliedSegment({ receiptId: id(1), resourceId: 8,
    startMs: 0n, endMs: 1n, localDay: 100 }, persist), /bound resource ID/);
  await applied.recordAppliedSegment({ receiptId: id(1), resourceId: 7,
    startMs: 0n, endMs: 10n, localDay: 100 }, persist);
  assert.equal(applied.usedLocalDay(7, 100), 10n);
  assert.throws(() => applied.usedRolling(8, 10n, 10n), /bound resource ID/);
  assert.throws(() => applied.eventCount(9, 100), /bound account operation/);
  applied.dispose();

  const starts = await AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'starts', eventType: 9, config,
  });
  await starts.initializeEmpty(persist);
  await starts.recordEvent({ eventId: id(2), eventType: 9, localDay: 100 }, persist);
  assert.equal(starts.eventCount(9, 100), 1n);
  await assert.rejects(starts.recordEvent({ eventId: id(3), eventType: 8, localDay: 100 }, persist), /bound Event type/);
  assert.throws(() => starts.usedLocalDay(7, 100), /bound account operation/);
  starts.dispose();

  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'missing', resourceId: 7, config,
  }), /no accounting account/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'applied', eventType: 9, config,
  }), /resourceId is required/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'starts', resourceId: 7, config,
  }), /eventType is required/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('stage: applied', 'stage: requested'), {
    filename, account: 'applied', resourceId: 7, config,
  }), /unsupported accounting stage/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('persistence: durable', 'persistence: volatile'), {
    filename, account: 'applied', resourceId: 7, config,
  }), /unsupported accounting persistence/);
});
