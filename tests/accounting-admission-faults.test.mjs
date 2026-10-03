import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = readFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const config = { maxIntervals: 8, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 600_000n };
const id = value => new Uint8Array(16).fill(value);
const source = '# Fail closed admission\n\n```ghost\ncontrol AccountingAdmission {\n'
  + 'resource pump: BoolActuator; account applied = on_time(pump, stage: applied, persistence: durable);\n'
  + 'event started: Event; account starts = count_events(started, over: local_day("UTC"), persistence: durable);\n'
  + 'constraints Budget { limit used(applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }\n'
  + 'output ready: Bool; ready <- case starts.count { ok(count) => count < 3; fault(_) => false; };\n}\n```\n';
const filename = 'accounting-admission.ghost.md';
const proposal = { reservationId: id(20), resourceId: 7, admittedAtMs: 0n,
  windowMs: 60_000n, limitMs: 30_000n, reserveMs: 5_000n };

// Inspect actual ABI snapshots, including cached bytes when the ledger is
// unknown. Preparing a snapshot is not a persistence acknowledgement.
function snapshot(ledger) {
  const w = ledger.wasm, handle = ledger.handle;
  const status = w.gf_accounting_snapshot(handle);
  const bytes = new Uint8Array(w.memory.buffer, w.gf_accounting_snapshot_ptr(handle),
    w.gf_accounting_snapshot_len(handle)).slice();
  return { status, bytes, revision: w.gf_accounting_revision(handle) };
}

test('REF-03-080: actual count faults map false in native/WASM and source-bound unknown protective admission preserves complete ledgers', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-03-080');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/269');
  assert.equal(original.scope, 'runtime'); assert.equal(original.status, 'specified');
  assert.match(original.then, /does not write a count event or create, consume, or release a reservation/);
  const artifact = await compileSource(source, { filename });
  const descriptor = artifact.manifest.accounting.bindings.find(value => value.name === 'starts');
  const binding = { site: descriptor.site, account: descriptor.name,
    event: descriptor.evidenceBinding.target, timezone: descriptor.basis.zone };
  const frames = [
    { name: 'missing', initialize: false, events: [], ack: false, localDay: 100, decision: 'Err(1)' },
    { name: 'corrupt', initialize: true, events: [], ack: true, corrupt: true, localDay: 100, decision: 'Err(2)' },
    { name: 'initialization failed acknowledgement', initialize: true, events: [], ack: false, localDay: 100, decision: 'Err(3)' },
    { name: 'record failed acknowledgement', initialize: true, events: [{ id: 1, eventType: 9, localDay: 100 }], ack: false, localDay: 100, decision: 'Err(3)' },
    { name: 'explicit recovery', initialize: true, events: [], ack: false, recover: true, localDay: 100, decision: 'Ok(0)' },
  ];
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-wasm', '--example', 'accounting_admission_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'ghostflow-accounting-admission-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb'), tapePath = join(directory, 'tape.json');
  const moduleFingerprint = artifact.bytes.reduce((hash, byte) => BigInt.asUintN(64,
    (hash ^ BigInt(byte)) * 0x100000001b3n), 0xcbf29ce484222325n).toString(16).padStart(16, '0');
  const tape = { moduleFingerprint, manifest: artifact.manifest, cases: frames };
  writeFileSync(modulePath, artifact.bytes); writeFileSync(tapePath, JSON.stringify(tape));
  const runner = resolve(root, 'target/release/examples/accounting_admission_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const native = JSON.parse(execFileSync(runner, [modulePath, tapePath], { cwd: root, encoding: 'utf8' }));
  for (const change of [value => { value.moduleFingerprint = '0000000000000000'; },
    value => { value.manifest.accounting.constraints[0].limits[0].onUnknown = 'allow'; }]) {
    const invalid = structuredClone(tape); change(invalid); writeFileSync(tapePath, JSON.stringify(invalid));
    assert.throws(() => execFileSync(runner, [modulePath, tapePath], { cwd: root, stdio: 'pipe' }), /identity mismatch|protective policy/);
  }
  const comparable = value => ({ ...value, bytes: [...value.bytes], revision: Number(value.revision) });
  for (const [index, frame] of frames.entries()) {
    const counts = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'starts', eventType: 9, config });
    const applied = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId: 7, config });
    const control = new GhostFlowRuntime(counts.wasm);
    try {
      for (const ledger of [counts, applied]) {
        assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
        assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
        if (frame.initialize) {
          const initialization = ledger.initializeEmpty(async () => frame.ack);
          if (frame.ack) await initialization;
          else await assert.rejects(initialization, /not durably acknowledged/);
        }
      }
      if (frame.events.length) {
        await assert.rejects(counts.recordEvent({ eventId: id(1), eventType: 9, localDay: 100 }, async () => false), /not durably acknowledged/);
        await assert.rejects(applied.recordAppliedSegment({ receiptId: id(1), resourceId: 7, startMs: 0n, endMs: 1n, localDay: 100 }, async () => false), /not durably acknowledged/);
      }
      if (frame.corrupt) for (const ledger of [counts, applied]) {
        const damaged = snapshot(ledger).bytes; damaged[7] ^= 255;
        assert.throws(() => ledger.restore(damaged));
      }
      if (frame.recover) for (const ledger of [counts, applied]) await ledger.persistPending(async () => true);
      const countBefore = snapshot(counts), appliedBefore = snapshot(applied);
      assert.deepEqual(comparable(countBefore), native[index].countBefore);
      assert.deepEqual(comparable(appliedBefore), native[index].appliedBefore);
      control.load(artifact.bytes); control.addCapability('actuator', 'ready', 'bool');
      counts.activateControl(control, { bootEpoch: 1n, terminalCapacity: 8 });
      const trace = counts.tickControl(control, { ...binding, eventType: 9, localDay: 100,
        monotonicMs: 0n, bootEpoch: 1n, wallMs: 1_700_000_000_000n, clockTrusted: true });
      assert.deepEqual(trace, native[index].trace, `same canonical complete trace: ${frame.name}`);
      assert.equal(trace.safe.ready, frame.recover === true);
      assert.ok(trace.contextTrace.some(entry => entry.decision === frame.decision));
      assert.deepEqual(snapshot(counts), countBefore, 'control evaluation writes no count event');
      let persistCalls = 0;
      const persist = async () => { persistCalls++; return true; };
      if (frame.recover) {
        assert.equal(applied.usedRolling(7, 0n, 60_000n), 0n);
        assert.equal(await applied.reserveRolling(proposal, persist), 'Inserted');
        assert.equal(persistCalls, 1);
        assert.equal(native[index].admissionStatus, 1);
      } else {
        assert.equal(applied.usedRolling(7, 0n, 60_000n), null);
        await assert.rejects(applied.reserveRolling(proposal, persist));
        assert.equal(persistCalls, 0, 'unknown admission must never invoke persistence');
        assert.deepEqual(snapshot(applied), appliedBefore, 'no create/consume/release or revision mutation');
        assert.deepEqual(snapshot(counts), countBefore);
        assert.equal(native[index].admissionStatus, 0);
      }
      assert.equal(persistCalls, native[index].persistCalls);
      assert.deepEqual(comparable(snapshot(counts)), native[index].countAfter);
      assert.deepEqual(comparable(snapshot(applied)), native[index].appliedAfter);
    } finally { control.dispose(); counts.dispose(); applied.dispose(); }
  }
});

test('REF-03-080: pending reservation retries block without persistence and explicit acknowledgement recovers exact admission identity', async t => {
  const ledger = await AccountingRuntime.instantiateSource(wasm, source, { filename, account: 'applied', resourceId: 7, config });
  t.after(() => ledger.dispose());
  await ledger.initializeEmpty(async () => true);
  let release;
  const pending = ledger.reserveRolling(proposal, () => new Promise(resolve => { release = resolve; }));
  const failed = assert.rejects(pending, /not durably acknowledged/);
  const before = snapshot(ledger);
  let calls = 0;
  for (const reservationId of [proposal.reservationId, id(21)]) {
    await assert.rejects(ledger.reserveRolling({ ...proposal, reservationId }, async () => { calls++; return true; }), /not durably acknowledged/);
    assert.deepEqual(snapshot(ledger), before);
    assert.equal(ledger.usedRolling(7, 0n, 60_000n), null);
  }
  assert.equal(calls, 0);
  release(false); await failed;
  assert.deepEqual(snapshot(ledger), before, 'failed persistence retains the one pending reservation');
  await ledger.persistPending(async () => true);
  assert.equal(await ledger.reserveRolling(proposal, async () => true), 'Duplicate');
  assert.deepEqual(snapshot(ledger), before, 'acknowledgement and exact duplicate do not recreate usage');
  for (let value = 21; value <= 25; value++) {
    assert.equal(await ledger.reserveRolling({ ...proposal, reservationId: id(value) }, async () => true), 'Inserted');
  }
  const full = snapshot(ledger);
  assert.equal(await ledger.reserveRolling({ ...proposal, reservationId: id(26) }, async () => { calls++; return true; }), 'Rejected');
  assert.equal(calls, 0);
  assert.deepEqual(snapshot(ledger), full, 'known exhausted budget rejects without changing reservations');
});
