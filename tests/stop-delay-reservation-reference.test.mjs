import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const native = path.join(root, `target/release/examples/stop_delay_reservation_tape${process.platform === 'win32' ? '.exe' : ''}`);
execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-wasm', '--example', 'stop_delay_reservation_tape'], { cwd: root, stdio: 'inherit' });
const source = `# REF-03-049 finite reservation includes stop delay

\`\`\`ghost
control StopDelayReservation {
 resource pump: BoolActuator;
 let worst_case_on: Duration = 5min;
 let stop_delay: Duration = 2min;
 account applied = on_time(pump, stage: applied, persistence: durable);
 constraints Budget {
  limit used(applied, rolling(1h)) <= 10min {
   reserve = worst_case_on + stop_delay;
   on_unknown = block;
  }
 }
 output ready: Bool; ready <- false;
}
\`\`\`
`;
const filename = 'ref-03-049-stop-delay-reservation.ghost.md';
const config = { maxIntervals: 8, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 3_600_000n };
const resourceId = 7, windowMs = 3_600_000, limitMs = 600_000, reserveMs = 420_000;
const start = () => [
 { action: 'initialize', nowMs: 0, ack: true },
 { action: 'record', nowMs: 240_000, receiptId: 1, startMs: 0, endMs: 240_000, ack: true },
 { action: 'reserve', nowMs: 240_000, reservationId: 2, ack: true },
 { action: 'reserve', nowMs: 3_660_000, reservationId: 3, ack: true },
 { action: 'save', nowMs: 3_660_000, checkpoint: 'outstanding' },
];
const identity = bytes => bytes.reduce((h, b) => BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n), 0xcbf29ce484222325n).toString(16).padStart(16, '0');
const request = (artifact, steps) => ({ moduleFingerprint: identity(artifact.bytes), manifest: artifact.manifest,
 account: 'applied', target: 'pump', resourceId, windowMs, limitMs, reserveMs, steps });

function nativeRun(artifact, tape, expectSuccess = true) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-ref-03-049-'));
 try {
  const modulePath = path.join(dir, 'module.gfb'), tapePath = path.join(dir, 'tape.json');
  fs.writeFileSync(modulePath, artifact.bytes); fs.writeFileSync(tapePath, JSON.stringify(tape));
  const run = spawnSync(native, [modulePath, tapePath], { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  if (!expectSuccess) return run;
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  return JSON.parse(run.stdout);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function wasmRun(artifact, tape) {
 const create = () => AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
 let ledger = await create();
 const checkpoints = new Map(), rows = [];
 const snapshot = () => {
  const w = ledger.wasm, h = ledger.handle, status = w.gf_accounting_snapshot(h);
  return { status, bytes: [...new Uint8Array(w.memory.buffer, w.gf_accounting_snapshot_ptr(h), Number(w.gf_accounting_snapshot_len(h)))], revision: Number(w.gf_accounting_revision(h)) };
 };
 const withBytes = (bytes, action) => {
  const w = ledger.wasm, ptr = w.gf_alloc(bytes.length);
  try { new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes); return action(ptr, bytes.length); }
  finally { w.gf_dealloc(ptr, bytes.length); }
 };
 const withId = (tag, action) => withBytes(new Uint8Array(16).fill(tag), action);
 const withIds = (a, b, action) => withId(a, first => withId(b, second => action(first, second)));
 const explanation = nowMs => {
  const w = ledger.wasm, ptr = w.gf_alloc(48);
  try {
   const status = w.gf_accounting_explain_rolling(ledger.handle, resourceId, BigInt(nowMs), BigInt(windowMs), BigInt(limitMs), BigInt(reserveMs), ptr);
   return { status, fields: status === 1 ? [...new BigUint64Array(w.memory.buffer, ptr, 6)].map(Number) : null };
  } finally { w.gf_dealloc(ptr, 48); }
 };
 try {
  assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
  assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
  for (const step of tape.steps) {
   const before = snapshot(); let status;
   const w = ledger.wasm, h = ledger.handle;
   switch (step.action) {
    case 'initialize': status = w.gf_accounting_initialize_empty(h); break;
    case 'record': status = withId(step.receiptId, ptr => w.gf_accounting_record_applied_segment(h, ptr, resourceId, BigInt(step.startMs), BigInt(step.endMs), 100)); break;
    case 'reserve': status = withId(step.reservationId, ptr => w.gf_accounting_reserve_rolling(h, ptr, resourceId, BigInt(step.nowMs), BigInt(windowMs), BigInt(limitMs), BigInt(reserveMs))); break;
    case 'recordReserved': status = withIds(step.reservationId, step.receiptId, (a, b) => w.gf_accounting_record_reserved_segment(h, a, b, resourceId, BigInt(step.startMs), BigInt(step.endMs), 100)); break;
    case 'settle': status = withIds(step.reservationId, step.receiptId, (a, b) => w.gf_accounting_settle_rolling(h, a, b)); break;
    case 'cancel': status = withIds(step.reservationId, step.evidenceId, (a, b) => w.gf_accounting_cancel_rolling(h, a, b)); break;
    case 'observe': status = 1; break;
    case 'save': checkpoints.set(step.checkpoint, Uint8Array.from(snapshot().bytes)); status = 1; break;
    case 'restart': {
     ledger.dispose(); ledger = await create();
     if (step.checkpoint) {
      const saved = checkpoints.get(step.checkpoint).slice(); if (step.corrupt) saved[7] ^= 255;
      status = withBytes(saved, (ptr, length) => ledger.wasm.gf_accounting_restore(ledger.handle, ptr, length));
     } else status = 1;
     break;
    }
    default: throw Error('unknown operation');
   }
   const mutation = ['initialize', 'record', 'reserve', 'recordReserved', 'settle', 'cancel'].includes(step.action);
   const ack = mutation && (status === 1 || status === 2) && step.ack === true;
   if (ack) {
    assert.equal(ledger.wasm.gf_accounting_snapshot(ledger.handle), 1);
    assert.equal(ledger.wasm.gf_accounting_ack_persisted(ledger.handle, ledger.wasm.gf_accounting_revision(ledger.handle)), 1);
   }
   rows.push({ action: step.action, nowMs: step.nowMs, status, persistCalls: Number(ack), before, after: snapshot(), explanation: explanation(step.nowMs) });
  }
  return { moduleFingerprint: identity(artifact.bytes), account: 'applied', target: 'pump', stage: 'applied', resourceId, rows };
 } finally { ledger.dispose(); }
}

async function execute(steps) {
 const artifact = await compileSource(source, { filename });
 const limit = artifact.manifest.accounting.constraints[0].limits[0];
 assert.deepEqual([limit.boundMs, limit.reserveMs, limit.basis.durationMs, limit.onUnknown], [limitMs, reserveMs, windowMs, 'block']);
 const tape = request(artifact, steps);
 const native = nativeRun(artifact, tape), wasm = await wasmRun(artifact, tape);
 assert.deepEqual(wasm, native, 'complete production C ABI statuses, revisions, snapshots and explanations match native/WASM');
 assert.deepEqual(nativeRun(artifact, tape), native, 'fresh native replay preserves every operation outcome');
 assert.deepEqual(await wasmRun(artifact, tape), wasm, 'fresh source-bound WASM replay preserves every operation outcome');
 return { artifact, tape, rows: native.rows };
}

test('REF-03-049 five-minute maximum ON plus two-minute stop delay rejects six-minute remaining budget without mutation and admits exact seven-minute recovery', async () => {
 const { rows } = await execute(start());
 const denied = rows[2];
 assert.equal(limitMs - rows[1].explanation.fields[0], 360_000);
 assert.equal(reserveMs, 300_000 + 120_000);
 assert.equal(denied.status, 3);
 assert.equal(denied.persistCalls, 0);
 assert.deepEqual(denied.after, denied.before);
 assert.deepEqual(denied.explanation.fields.slice(0, 3), [240_000, 0, 1]);
 const exact = rows[3];
 assert.equal(exact.status, 1);
 assert.deepEqual(exact.explanation.fields.slice(0, 3), [180_000, 420_000, 1]);
 assert.equal(exact.persistCalls, 1);
});

test('REF-03-049 power-loss restore retains uncertain outstanding reservation after window expiry and rejects evidence-free release or duplicate collision', async () => {
 const { rows } = await execute([...start(),
  { action: 'restart', nowMs: 3_660_000, checkpoint: 'outstanding' },
  { action: 'observe', nowMs: 10_000_000 },
  { action: 'settle', nowMs: 10_000_000, reservationId: 3, receiptId: 99, ack: true },
  { action: 'cancel', nowMs: 10_000_000, reservationId: 3, evidenceId: 0, ack: true },
  { action: 'reserve', nowMs: 10_000_000, reservationId: 4, ack: true },
  { action: 'reserve', nowMs: 10_000_000, reservationId: 3, ack: true },
  { action: 'reserve', nowMs: 3_660_000, reservationId: 3, ack: true },
 ]);
 assert.deepEqual(rows[5].after.bytes, rows[4].after.bytes, 'restart restores exact outstanding reservation bytes');
 assert.deepEqual(rows[6].explanation.fields.slice(0, 3), [0, 420_000, 1], 'elapsed time alone releases no uncertain reservation');
 for (const index of [7, 8, 9, 10]) {
  assert.equal(rows[index].status, index === 9 ? 3 : 0);
  assert.equal(rows[index].persistCalls, 0);
  assert.deepEqual(rows[index].after, rows[index].before);
  assert.equal(rows[index].explanation.fields[1], 420_000);
 }
 assert.equal(rows[11].status, 2, 'exact duplicate after collision remains idempotent');
 assert.deepEqual(rows[11].after, rows[11].before);
});

test('REF-03-049 missing or corrupt durable state stays Unknown and fails closed until explicit restore with the outstanding reservation intact', async () => {
 const { rows } = await execute([...start(),
  { action: 'restart', nowMs: 10_000_000 },
  { action: 'reserve', nowMs: 10_000_000, reservationId: 4, ack: true },
  { action: 'restart', nowMs: 10_000_000, checkpoint: 'outstanding', corrupt: true },
  { action: 'reserve', nowMs: 10_000_000, reservationId: 4, ack: true },
  { action: 'restart', nowMs: 10_000_000, checkpoint: 'outstanding' },
  { action: 'observe', nowMs: 10_000_000 },
 ]);
 for (const index of [5, 6, 7, 8]) assert.deepEqual(rows[index].explanation, { status: 2, fields: null });
 for (const index of [6, 8]) { assert.equal(rows[index].status, 0); assert.equal(rows[index].persistCalls, 0); assert.deepEqual(rows[index].after, rows[index].before); }
 assert.equal(rows[7].status, 0);
 assert.deepEqual(rows[10].explanation.fields.slice(0, 3), [0, 420_000, 1]);
});

test('REF-03-049 only correlated applied receipt evidence settles the reservation and source-bound guards reject omitting stop delay', async () => {
 const { artifact, tape, rows } = await execute([...start(),
  { action: 'recordReserved', nowMs: 3_960_000, reservationId: 3, receiptId: 2, startMs: 3_660_000, endMs: 3_960_000, ack: true },
  { action: 'settle', nowMs: 3_960_000, reservationId: 3, receiptId: 2, ack: true },
  { action: 'settle', nowMs: 3_960_000, reservationId: 3, receiptId: 2, ack: true },
 ]);
 assert.equal(rows[5].status, 1); assert.equal(rows[6].status, 1); assert.equal(rows[7].status, 2);
 assert.deepEqual(rows[6].explanation.fields.slice(0, 3), [300_000, 0, 1]);
 assert.deepEqual(rows[7].after, rows[7].before);
 for (const change of [value => { value.reserveMs = 300_000; }, value => { value.moduleFingerprint = '0000000000000000'; }, value => { value.target = 'other'; }]) {
  const invalid = structuredClone(tape); change(invalid); const rejected = nativeRun(artifact, invalid, false);
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /identity|binding|descriptor/);
 }
 const owner = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId, config });
 try {
  await owner.initializeEmpty(async () => true); const before = owner.snapshot(); let persistence = 0;
  await assert.rejects(owner.reserveRolling({ reservationId: new Uint8Array(16).fill(5), resourceId, admittedAtMs: 0n,
   windowMs: BigInt(windowMs), limitMs: BigInt(limitMs), reserveMs: 300_000n }, async () => { persistence++; return true; }), /bound source constraint/);
  assert.equal(persistence, 0); assert.deepEqual(owner.snapshot(), before);
 } finally { owner.dispose(); }
});
