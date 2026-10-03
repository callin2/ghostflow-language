import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'event_count_tape'], { cwd: root, stdio: 'inherit' });
const wasmBytes = readFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const config = { maxIntervals: 8, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 600_000n };

test('REF-03-079: actual durable typed-event ledgers return exact Int and accounting faults in native/WASM control traces', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-03-079');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/268');
  assert.equal(original.status, 'specified');
  assert.match(original.then, /CountOverflow/);
  const source = '# Exact event count\n\n```ghost\ncontrol CountFaults {\n'
    + 'event started: Event; account starts = count_events(started, over: local_day("UTC"), persistence: durable);\n'
    + 'output exact: Int; exact <- case starts.count { ok(count) => count; fault(_) => -1; };\n'
    + 'output ready: Bool; ready <- case starts.count { ok(count) => count < 3; fault(_) => false; };\n}\n```\n';
  const filename = 'event-count-faults.ghost.md';
  const artifact = await compileSource(source, { filename });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  const descriptor = artifact.manifest.accounting.bindings.find(value => value.name === 'starts');
  const binding = { site: descriptor.site, account: descriptor.name,
    event: descriptor.evidenceBinding.target, timezone: descriptor.basis.zone };
  const event = (id, localDay = 100) => ({ id, eventType: 9, localDay });
  const counted = [event(1), event(2), event(2), event(3, 99)];
  const cases = [
    { initialize: true, events: [], ack: true, localDay: 100, expected: 0, decision: 'Ok(0)' },
    { initialize: true, events: counted, ack: true, localDay: 100, expected: 2, decision: 'Ok(2)' },
    { initialize: true, events: counted, ack: true, restore: true, localDay: 100, expected: 2, decision: 'Ok(2)' },
    { initialize: false, events: [], localDay: 100, expected: -1, decision: 'Err(1)' },
    { initialize: true, events: counted, ack: true, corrupt: true, localDay: 100, expected: -1, decision: 'Err(2)' },
    { initialize: true, events: [event(1)], ack: false, localDay: 100, expected: -1, decision: 'Err(3)' },
    { initialize: true, events: [], ack: false, localDay: 100, expected: -1, decision: 'Err(3)' },
    { initialize: true, events: [event(1)], ack: false, recover: true, localDay: 100, expected: 1, decision: 'Ok(1)' },
    { initialize: true, events: counted, ack: true, localDay: null, expected: -1, decision: 'Err(0)' },
    { initialize: false, events: [], localDay: null, expected: -1, decision: 'Err(0)' },
  ];
  const directory = mkdtempSync(join(tmpdir(), 'ghostflow-event-count-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb'), tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  writeFileSync(tapePath, JSON.stringify({ binding, cases }));
  const runner = resolve(root, 'target/release/examples/event_count_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const native = JSON.parse(execFileSync(runner, [modulePath, tapePath], { cwd: root, encoding: 'utf8' }));
  assert.equal(native.length, cases.length, 'each bounded raw-event case executed');
  for (const [index, frame] of cases.entries()) {
    const ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'starts', eventType: 9, config });
    const control = new GhostFlowRuntime(ledger.wasm);
    try {
      assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
      assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
      let snapshot = null;
      const persist = async bytes => { snapshot = bytes.slice(); return true; }; // Explicit test-host acknowledgement.
      if (frame.initialize) {
        const initialization = ledger.initializeEmpty(async bytes => { snapshot = bytes.slice(); return frame.ack === true; });
        if (frame.ack) await initialization;
        else await assert.rejects(initialization, /not durably acknowledged/);
      }
      for (const entry of frame.events) {
        const promise = ledger.recordEvent({ eventId: new Uint8Array(16).fill(entry.id), eventType: entry.eventType, localDay: entry.localDay },
          async bytes => { snapshot = bytes.slice(); return frame.ack === true; });
        if (frame.ack) await promise;
        else await assert.rejects(promise, /not durably acknowledged/);
      }
      if (frame.recover) await ledger.persistPending(persist);
      if (frame.corrupt) {
        const damaged = snapshot.slice(); damaged[7] ^= 255;
        assert.throws(() => ledger.restore(damaged));
      } else if (frame.restore) ledger.restore(snapshot);
      control.load(artifact.bytes);
      control.addCapability('actuator', 'exact', 'int'); control.addCapability('actuator', 'ready', 'bool');
      ledger.activateControl(control, { bootEpoch: 1n, terminalCapacity: 8 });
      const trace = ledger.tickControl(control, { ...binding, eventType: 9, localDay: frame.localDay,
        monotonicMs: 0n, bootEpoch: 1n, wallMs: 1_700_000_000_000n, clockTrusted: true });
      assert.deepEqual(trace, native[index].trace, `complete native/WASM trace: ${frame.decision}`);
      assert.deepEqual(snapshot === null ? null : [...snapshot], native[index].snapshot, 'actual serialized ledger parity');
      assert.equal(trace.requested.exact, frame.expected);
      assert.equal(trace.safe.exact, frame.expected);
      assert.equal(trace.safe.ready, frame.expected >= 0 && frame.expected < 3);
      assert.ok(trace.contextTrace.some(entry => entry.decision === frame.decision), `typed accounting decision ${frame.decision}`);
    } finally { control.dispose(); ledger.dispose(); }
  }
});
