import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

// Producer observations exist only where the test supplies a value.
const good = (nowMs, values) => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { epoch: 1, id: nowMs + 1, timestampMs: nowMs, quality: 'Good', value }]));

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const wasmBytes = fs.readFileSync(wasmPath);

async function civilArtifact() {
  const book = fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.md', import.meta.url), 'utf8');
  const section = book.slice(book.indexOf('### E09 —'), book.indexOf('### E10 —'));
  const code = section.match(/```ghost\n([\s\S]*?)\n```/)[1];
  return compileSource(code, { filename: 'E09-framed.ghost' });
}
const civilStart = Date.UTC(2026, 8, 24, 21);
function civilFacts(site, atMs) {
  return { clock: { monotonicMs: atMs, bootEpoch: 7, wallMs: civilStart - 1 + atMs,
    trusted: true, uncertaintyMs: 0, sourceRevision: 'framed-test-clock-v1' },
  schedules: [{ kind: 'daily-slots', site, coverageFromWallMs: civilStart - 1,
    coverageToWallMs: civilStart + 300001, rows: [{ sourceDay: 20721, slotKey: 361,
      minuteOfDay: 360, fold: 0, available: true, scheduledWallMs: civilStart,
      providerRevision: 'framed-test-provider-v1', contextRevision: 'framed-test-context-v1' }] }] };
}

test('framed civil E09 preserves canonical admission and five-minute boundary', async t => {
  const artifact = await civilArtifact(), site = artifact.manifest.schedules[0].site;
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact,
    { schedule: { bootEpoch: 7, terminalCapacity: 8 } });
  t.after(() => runtime.dispose());
  assert.throws(() => runtime.step({ nowMs: 0, inputs: {}, due: { starts: true }, scheduleFacts: civilFacts(site, 0) }), /runtime-owned due/);
  assert.throws(() => runtime.step({ nowMs: 0, inputs: {}, scheduleFacts: civilFacts(site, 1) }), /must equal nowMs/);
  for (const [scanId, [atMs, on, phase]] of [[0, false, 0], [1, true, 1], [2, true, 1], [300000, true, 1], [300001, false, 0]].entries()) {
    const result = runtime.step({ nowMs: atMs, inputs: {}, scheduleFacts: civilFacts(site, atMs) });
    assert.deepEqual(result.frame, { scanId, logicalTimeMs: atMs });
    assert.equal(result.vm.safe.pump, on); assert.equal(result.vm.safe.valve, on);
    assert.equal(result.vm.stateAfter.phase, phase);
  }
});

test('raw framed civil rejects forged clock, malformed facts and duplicate scans without consuming admission', async t => {
  const artifact = await civilArtifact(), site = artifact.manifest.schedules[0].site;
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
  runtime.activateSchedules({ bootEpoch: 7, terminalCapacity: 8 });
  const frame = (scanId, logicalTimeMs) => ({ scanId, logicalTimeMs, inputs: [] });
  const rejected = fn => assert.throws(fn, error => error.committed === false);
  rejected(() => runtime.dispatchSchedules(frame(0, 0), civilFacts(site, 1)));
  rejected(() => runtime.dispatchSchedules({ ...frame(0, 0), inputs: [{ name: '__gf_time_epoch', type: 'Number', value: 7 }] }, civilFacts(site, 0)));
  rejected(() => runtime.dispatchSchedules({ ...frame(0, 0), inputs: [{ name: '__gf_schedule_due_starts', type: 'Bool', value: true }] }, civilFacts(site, 0)));
  const malformed = civilFacts(site, 0); malformed.schedules[0].rows[0].slotKey = 362;
  rejected(() => runtime.dispatchSchedules(frame(0, 0), malformed));
  runtime.dispatchSchedules(frame(0, 0), civilFacts(site, 0));
  assert.equal(runtime.outcome.trace.safe.pump, false);
  rejected(() => runtime.dispatchSchedules(frame(0, 0), civilFacts(site, 0)));
  const original = runtime.wasm;
  runtime.wasm = { ...original, gf_frame_scan_schedules: (...args) => original.gf_frame_scan_schedules(...args.slice(0, -1), 5) };
  rejected(() => runtime.dispatchSchedules(frame(1, 1), civilFacts(site, 1)));
  runtime.wasm = original;
  const wrongSlot = civilFacts(site, 1);
  wrongSlot.schedules[0].rows[0].minuteOfDay = 375;
  wrongSlot.schedules[0].rows[0].slotKey = 376;
  rejected(() => runtime.dispatchSchedules(frame(1, 1), wrongSlot));
  const mismatched = civilFacts(site + 1, 1);
  rejected(() => runtime.dispatchSchedules(frame(1, 1), mismatched));
  runtime.dispatchSchedules(frame(1, 1), civilFacts(site, 1));
  assert.equal(runtime.outcome.trace.safe.pump, true);
  rejected(() => runtime.dispatchSchedules(frame(1, 1), civilFacts(site, 1)));
  runtime.dispatchSchedules(frame(2, 2), civilFacts(site, 2));
  assert.equal(runtime.outcome.scanId, 2);
  assert.equal(runtime.outcome.trace.stateAfter.phase, 1);
});

test('civil framed ABI requires real schedule exports', async () => {
  for (const name of ['gf_frame_activate_schedules', 'gf_frame_scan_schedules']) {
    await withWasmExports(exports => Object.fromEntries(Object.entries(exports).filter(([key]) => key !== name)), async () => {
      await assert.rejects(FramedGhostFlowRuntime.instantiate(wasmBytes), new RegExp(`missing ${name}`));
    });
  }
});

test('framed Daily uses GFSF2 with runtime-owned crossing', async t => {
  const entry = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases.find(item => item.id === 'REF-03-024');
  const artifact = await compileSource(entry.source, { filename: entry.filename });
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact,
    { schedule: { bootEpoch: 7, terminalCapacity: 8 } });
  t.after(() => runtime.dispose());
  const planned = Date.parse('2026-09-23T21:30:00Z');
  for (const [scanId, wallMs, due] of [[0, planned - 100, false], [1, planned, true], [2, planned + 1, false]]) {
    const scheduleFacts = { clock: { monotonicMs: scanId, bootEpoch: 7, wallMs, trusted: true },
      schedules: [{ kind: 'daily', site: artifact.manifest.schedules[0].site,
        coverageFromWallMs: planned - 1000, coverageToWallMs: planned + 1000,
        rows: [{ sourceDay: Date.UTC(2026, 8, 24) / 86400000, fold: 0, available: true,
          scheduledWallMs: planned, providerRevision: 'daily-test-v1', contextRevision: 'daily-context-v1' }] }] };
    const result = runtime.step({ nowMs: scanId, scheduleFacts });
    assert.deepEqual(result.frame, { scanId, logicalTimeMs: scanId });
    assert.equal(result.vm.safe.due, due);
  }
});

async function framed(source, filename = 'framed-host.ghost') {
  return ControlRuntime.instantiateFramed(wasmBytes, await compileSource(source, { filename }));
}

async function withWasmExports(transform, callback) {
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async (...args) => {
    const result = await instantiate(...args);
    return { instance: { exports: transform(result.instance.exports) } };
  };
  try { return await callback(); }
  finally { WebAssembly.instantiate = instantiate; }
}

test('GF-TEST-framed-control-host: dispatches complete no-timer inputs once with separate frame metadata', async t => {
  const runtime = await framed(`
control FramedConstraint {
  input enabled: Bool;
  output pump: Bool;
  output permit: Bool;
  pump <- enabled |> recover(false);
  permit <- false;
  require pump => permit;
}
`);
  t.after(() => runtime.dispose());
  assert.throws(() => runtime.step({ nowMs: 0, samples: good(0, { enabled: 1 }) }), /boolean/);
  let reads = 0;
  const first = runtime.step({
    nowMs: 0,
    samples: { enabled: { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', get value() { reads += 1; return true; } } },
  });
  assert.equal(reads, 1, 'each DI primitive is captured exactly once');
  assert.deepEqual(first.frame, { scanId: 0, logicalTimeMs: 0 });
  assert.equal(first.vm.tick, 1, 'legacy TickRecord namespace is unchanged');
  assert.equal(first.vm.requested.pump, true);
  assert.equal(first.vm.safe.pump, false, 'a safety block is a successful framed scan');
  assert.equal(Object.hasOwn(first.vm, 'frame'), false);
  assert.equal(runtime.lastFrameOutcome.scanId, 0, 'framed outcome remains separate from the TickRecord');

  const second = runtime.step({ nowMs: 1, samples: good(1, { enabled: false }) });
  assert.deepEqual(second.frame, { scanId: 1, logicalTimeMs: 1 });
  assert.equal(second.vm.tick, 2);
});

test('GF-TEST-framed-control-host: supplies generated timer, sensor, signal, and schedule inputs to actual WASM', async t => {
  const runtime = await framed(`
control FramedGenerated {
  input start: Bool;
  state running: Bool = false;
  timer age = elapsed(running);
  running' = start |> recover(false);
  input moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
  schedule starts: DailySlots<15min> { timezone = "UTC"; selected = [00:00]; }
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  output pump: Bool;
  pump <- (start |> recover(false)) && dry_ok && starts.due && age >= 100ms;
}
`, 'framed-generated.ghost');
  t.after(() => runtime.dispose());
  const sample = { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', value: 20 };
  const first = runtime.step({ nowMs: 0, samples: { ...good(0, { start: true }), moisture: sample } });
  assert.equal(first.vm.inputs.__gf_now_ms, 0);
  assert.equal(first.vm.inputs.__gf_sensor_ok_moisture, true);
  assert.equal(first.vm.inputs.__gf_signal_value_dry, true);
  assert.equal(first.vm.inputs.__gf_schedule_due_starts, false, 'absent due is an explicit false frame value');
  assert.equal(first.vm.safe.pump, false);

  const next = runtime.step({ nowMs: 100, samples: good(100, { start: true }), due: { starts: true } });
  assert.deepEqual(next.frame, { scanId: 1, logicalTimeMs: 100 });
  assert.equal(next.vm.inputs.__gf_now_ms, 100);
  assert.equal(next.vm.inputs.__gf_schedule_due_starts, true);
  assert.equal(next.vm.safe.pump, true);
});

test('GF-TEST-framed-control-host: does not invoke legacy exports and latches an unknown dispatch trap', async () => {
  const legacyCalls = [];
  const forbidden = new Set(['gf_create', 'gf_destroy', 'gf_load', 'gf_activate', 'gf_tick', 'gf_tick_at', 'gf_set_bool', 'gf_set_number', 'gf_trace_ptr', 'gf_trace_len']);
  await withWasmExports(exports => new Proxy({ ...exports }, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof key === 'string' && forbidden.has(key)) {
        return (...args) => { legacyCalls.push([key, args]); throw new Error(`legacy export ${key} was invoked`); };
      }
      return value;
    },
  }), async () => {
    const runtime = await framed('control FramedLegacy { input enabled: Bool; output pump: Bool; pump <- enabled |> recover(false); }', 'framed-legacy.ghost');
    try {
      const first = runtime.step({ nowMs: 0, samples: good(0, { enabled: true }) });
      assert.equal(first.vm.safe.pump, true);
      const committed = runtime.runtime.outcome;
      runtime.runtime.dispatch = () => { throw new Error('injected framed dispatch failure'); };
      assert.throws(() => runtime.step({ nowMs: 1, samples: good(1, { enabled: false }) }), /injected framed dispatch failure/);
      assert.deepEqual(runtime.runtime.outcome, committed, 'the committed framed outcome remains available');
      assert.deepEqual(runtime.lastFrameOutcome, committed, 'the getter reads the live framed outcome, not a host cache');
      assert.throws(() => runtime.step({ nowMs: 1, samples: good(1, { enabled: false }) }), /faulted/);
      assert.deepEqual(legacyCalls, []);
    } finally { runtime.dispose(); }
  });
});

test('GF-TEST-framed-control-host: rejects an old artifact diagnostic, supports retry, and disposes framed ownership', async () => {
  await withWasmExports(exports => Object.fromEntries(Object.entries(exports).filter(([name]) => name !== 'gf_frame_scan')), async () => {
    await assert.rejects(
      () => framed('control FramedOld { output pump: Bool; pump <- false; }', 'framed-old.ghost'),
      /framed scan ABI v1: missing gf_frame_scan/,
    );
  });
  const runtime = await framed('control FramedRetry { output pump: Bool; pump <- false; }', 'framed-retry.ghost');
  runtime.dispose();
  assert.throws(() => runtime.step({ nowMs: 0 }), /disposed/);
  assert.throws(() => runtime.lastFrameOutcome, /disposed/);
});

test('GF-TEST-framed-control-host: validation failures do not touch conditioners and permit a valid retry', async t => {
  const runtime = await framed(`
control FramedValidation {
  input start: Bool;
  input moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
  schedule starts: DailySlots<15min> { timezone = "UTC"; selected = []; }
  output pump: Bool;
  pump <- start |> recover(false);
}
`, 'framed-validation.ghost');
  t.after(() => runtime.dispose());
  const counts = { read: 0, update: 0 };
  for (const entry of [...runtime.sensors.values(), ...runtime.signals.values()]) {
    const read = entry.conditioner.read.bind(entry.conditioner);
    const update = entry.conditioner.update.bind(entry.conditioner);
    entry.conditioner.read = (...args) => { counts.read += 1; return read(...args); };
    entry.conditioner.update = (...args) => { counts.update += 1; return update(...args); };
  }
  const sample = { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', value: 20 };
  assert.throws(() => runtime.step({ nowMs: -1, samples: good(-1, { start: true }) }), /safe integer/);
  assert.throws(() => runtime.step({ nowMs: 0, samples: good(0, { start: 1 }) }), /boolean/);
  assert.throws(() => runtime.step({ nowMs: 0, samples: { ...good(0, { start: true }), moisture: { ...sample, timestampMs: 1 } } }), /future/);
  assert.throws(() => runtime.step({ nowMs: 0, samples: good(0, { start: true }), due: { starts: 1 } }), /boolean/);
  assert.deepEqual(counts, { read: 0, update: 0 });
  const accepted = runtime.step({ nowMs: 0, samples: { ...good(0, { start: true }), moisture: sample }, due: { starts: false } });
  assert.deepEqual(accepted.frame, { scanId: 0, logicalTimeMs: 0 });
  assert.deepEqual(counts, { read: 3, update: 3 });
});

test('GF-TEST-framed-control-host: a known core rejection preserves the committed frame and permits the same ID retry', async t => {
  const runtime = await framed(`
control FramedCoreFault {
  input divisor: Number;
  output pump: Number;
  pump <- 1 / (divisor |> recover(0.0));
}
`, 'framed-core-fault.ghost');
  t.after(() => runtime.dispose());
  const first = runtime.step({ nowMs: 0, samples: good(0, { divisor: 1 }) });
  const committed = runtime.lastFrameOutcome;
  assert.equal(first.vm.safe.pump, 1);
  assert.throws(() => runtime.step({ nowMs: 1, samples: good(1, { divisor: 0 }) }), /division by zero/);
  assert.equal(runtime.lastNowMs, 0);
  assert.deepEqual(runtime.lastFrameOutcome, committed);
  const retry = runtime.step({ nowMs: 1, samples: good(1, { divisor: 1 }) });
  assert.deepEqual(retry.frame, { scanId: 1, logicalTimeMs: 1 });
  assert.equal(retry.vm.safe.pump, 1);
});

test('GF-TEST-framed-control-host: generated sensor and signal snapshots match legacy for the same artifact', async t => {
  const artifact = await compileSource(`
control FramedParity {
  input start: Bool;
  input moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  output pump: Bool;
  pump <- (start |> recover(false)) && dry_ok;
}
`, { filename: 'framed-parity.ghost' });
  const legacy = await ControlRuntime.instantiate(wasmBytes, artifact);
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact);
  t.after(() => { runtime.dispose(); legacy.dispose(); });
  for (const [nowMs, value] of [[0, 20], [1_000, 50]]) {
    const snapshot = { nowMs, samples: { ...good(nowMs, { start: true }), moisture: { epoch: 1, id: nowMs / 1_000 + 1, timestampMs: nowMs, quality: 'Good', value } } };
    const expected = legacy.step(snapshot);
    const actual = runtime.step(snapshot);
    assert.deepEqual(actual.sensors, expected.sensors);
    assert.deepEqual(actual.signals, expected.signals);
    assert.deepEqual(actual.vm.inputs, expected.vm.inputs);
    assert.deepEqual(actual.vm.requested, expected.vm.requested);
    assert.deepEqual(actual.vm.safe, expected.vm.safe);
  }
});
