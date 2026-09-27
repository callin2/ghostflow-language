import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');

execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {
  cwd: root, stdio: 'inherit',
});
const wasmBytes = readFileSync(wasmPath);
const config = { maxIntervals: 8, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 600_000n };
const id = value => new Uint8Array(16).fill(value);
const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
  .cases.find(entry => entry.id === 'REF-03-050');

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

test('WASM rolling admission rejects the reference reserve atomically and durably settles evidence', async () => {
  const runtime = await AccountingRuntime.instantiate(wasmBytes, config);
  const persist = async () => true;
  await runtime.initializeEmpty(persist);

  assert.equal(await runtime.reserveRolling({ reservationId: id(20), resourceId: 7,
    admittedAtMs: 1_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 310_000n }, persist), 'Rejected');
  assert.equal(runtime.usedRolling(7, 1_000n, 60_000n), 0n);

  assert.equal(await runtime.reserveRolling({ reservationId: id(21), resourceId: 7,
    admittedAtMs: 1_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 30_000n }, persist), 'Inserted');
  assert.equal(await runtime.reserveRolling({ reservationId: id(22), resourceId: 7,
    admittedAtMs: 1_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 1n }, persist), 'Rejected');
  await runtime.recordAppliedSegment({ receiptId: id(2), resourceId: 7,
    startMs: 0n, endMs: 5_000n, localDay: 100 }, persist);
  await assert.rejects(runtime.settleRolling({ reservationId: id(21), appliedReceiptId: id(2) }, persist),
    /settlement evidence is missing/);
  await runtime.recordReservedAppliedSegment({ reservationId: id(21), receiptId: id(4), resourceId: 7,
    startMs: 5_000n, endMs: 10_000n, localDay: 100 }, persist);
  assert.equal(await runtime.settleRolling({ reservationId: id(21), appliedReceiptId: id(4) }, persist), 'Inserted');
  assert.equal(await runtime.reserveRolling({ reservationId: id(23), resourceId: 7,
    admittedAtMs: 5_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 25_000n }, persist), 'Inserted');
  assert.equal(await runtime.cancelRolling({ reservationId: id(23), cancellationEvidenceId: id(30) }, persist), 'Inserted');
  runtime.dispose();
});

test('REF-03-050 exact source binds applied pump evidence and stable Event identities', async () => {
  const persist = async () => true;
  const applied = await AccountingRuntime.instantiateSource(wasmBytes, reference.source, {
    filename: reference.filename, account: 'pump_applied', resourceId: 7, config,
  });
  assert.equal(applied.source.text, reference.source);
  await applied.initializeEmpty(persist);
  assert.equal(await applied.reserveRolling({ reservationId: id(40), resourceId: 7,
    admittedAtMs: 0n, windowMs: 600_000n, limitMs: 360_000n, reserveMs: 310_000n }, persist), 'Inserted');
  await assert.rejects(applied.reserveRolling({ reservationId: id(41), resourceId: 7,
    admittedAtMs: 0n, windowMs: 600_000n, limitMs: 361_000n, reserveMs: 310_000n }, persist),
  /does not match the bound source constraint/);
  await applied.recordReservedAppliedSegment({ reservationId: id(40), receiptId: id(42), resourceId: 7,
    startMs: 0n, endMs: 300_000n, localDay: 100 }, persist);
  assert.equal(await applied.settleRolling({ reservationId: id(40), appliedReceiptId: id(42) }, persist), 'Inserted');
  assert.equal(applied.usedRolling(7, 300_000n, 600_000n), 300_000n);
  applied.dispose();

  const events = await AccountingRuntime.instantiateSource(wasmBytes, reference.source, {
    filename: reference.filename, account: 'normal_starts', eventType: 9, config,
  });
  await events.initializeEmpty(persist);
  assert.equal(await events.recordEvent({ eventId: id(50), eventType: 9, localDay: 100 }, persist), 'Inserted');
  assert.equal(await events.recordEvent({ eventId: id(50), eventType: 9, localDay: 100 }), 'Duplicate');
  assert.equal(events.eventCount(9, 100), 1n);
  const compiled = await compileSource(reference.source, { filename: reference.filename });
  const countBinding = compiled.manifest.accounting.bindings.find(item => item.name === 'normal_starts');
  const control = new GhostFlowRuntime(events.wasm);
  control.load(compiled.bytes);
  assert.throws(() => events.tickControl(control, {
    site: countBinding.site, account: countBinding.name, event: countBinding.evidenceBinding.target,
    timezone: countBinding.basis.zone, eventType: 10, localDay: 100,
    monotonicMs: 0n, bootEpoch: 3n, wallMs: 1n, clockTrusted: true,
  }), /wrong bound Event type/);
  control.dispose();
  events.dispose();
});

test('REF-03-050 evaluates its protected count Result from the durable Rust ledger', async () => {
  const artifact = await compileSource(reference.source, { filename: reference.filename });
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const control = new GhostFlowRuntime(instance.exports);
  const accounting = new AccountingRuntime(instance.exports, config);
  const binding = artifact.manifest.accounting.bindings.find(item => item.name === 'normal_starts');
  const persist = async () => true;

  control.load(artifact.bytes);
  control.addCapability('actuator', 'ready', 'bool');
  await accounting.initializeEmpty(persist);
  accounting.activateControl(control, { bootEpoch: 3n, terminalCapacity: 8 });
  const beforeInvalidFlags = control.journalLength;
  assert.equal(instance.exports.gf_tick_accounting(
    control.handle, accounting.handle, binding.site,
    0, 0, 0, 0, 0, 0, 9, 2, 100, 0n, 3n, 1, 1n, 1,
  ), 0);
  assert.equal(control.journalLength, beforeInvalidFlags);
  let trace = accounting.tickControl(control, {
    site: binding.site, account: binding.name, event: binding.evidenceBinding.target,
    timezone: binding.basis.zone, eventType: 9, localDay: 100,
    monotonicMs: 0n, bootEpoch: 3n, wallMs: 1_700_000_000_000n, clockTrusted: true,
  });
  assert.equal(trace.inputs[binding.resultInputs.value], 0);
  assert.equal(trace.requested.ready, true);

  await accounting.recordEvent({ eventId: id(60), eventType: 9, localDay: 100 }, persist);
  trace = accounting.tickControl(control, {
    site: binding.site, account: binding.name, event: binding.evidenceBinding.target,
    timezone: binding.basis.zone, eventType: 9, localDay: 100,
    monotonicMs: 1n, bootEpoch: 3n, wallMs: 1_700_000_000_001n, clockTrusted: true,
  });
  assert.equal(trace.inputs[binding.resultInputs.value], 1);
  assert.equal(trace.requested.ready, true);
  assert.equal(trace.safe.ready, true);
  accounting.dispose();
  control.dispose();
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
  }), /executable accounting requires durable applied/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('persistence: durable', 'persistence: volatile'), {
    filename, account: 'applied', resourceId: 7, config,
  }), /executable accounting requires durable applied/);
});
