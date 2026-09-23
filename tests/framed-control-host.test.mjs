import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const wasmBytes = fs.readFileSync(wasmPath);

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
  pump <- enabled;
  permit <- false;
  require pump => permit;
}
`);
  t.after(() => runtime.dispose());
  assert.throws(() => runtime.step({ nowMs: 0, inputs: {} }), /missing input/);
  let reads = 0;
  const first = runtime.step({
    nowMs: 0,
    inputs: {
      get enabled() { reads += 1; return true; },
    },
  });
  assert.equal(reads, 1, 'each DI primitive is captured exactly once');
  assert.deepEqual(first.frame, { scanId: 0, logicalTimeMs: 0 });
  assert.equal(first.vm.tick, 1, 'legacy TickRecord namespace is unchanged');
  assert.equal(first.vm.requested.pump, true);
  assert.equal(first.vm.safe.pump, false, 'a safety block is a successful framed scan');
  assert.equal(Object.hasOwn(first.vm, 'frame'), false);
  assert.equal(runtime.lastFrameOutcome.scanId, 0, 'framed outcome remains separate from the TickRecord');

  const second = runtime.step({ nowMs: 1, inputs: { enabled: false } });
  assert.deepEqual(second.frame, { scanId: 1, logicalTimeMs: 1 });
  assert.equal(second.vm.tick, 2);
});

test('GF-TEST-framed-control-host: supplies generated timer, sensor, signal, and schedule inputs to actual WASM', async t => {
  const runtime = await framed(`
control FramedGenerated {
  input start: Bool;
  state running: Bool = false;
  timer age = elapsed(running);
  running' = start;
  sensor moisture: Percent {
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
  pump <- start && dry_ok && starts.due && age >= 100ms;
}
`, 'framed-generated.ghost');
  t.after(() => runtime.dispose());
  const sample = { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', value: 20 };
  const first = runtime.step({ nowMs: 0, inputs: { start: true }, samples: { moisture: sample } });
  assert.equal(first.vm.inputs.__gf_now_ms, 0);
  assert.equal(first.vm.inputs.__gf_sensor_ok_moisture, true);
  assert.equal(first.vm.inputs.__gf_signal_value_dry, true);
  assert.equal(first.vm.inputs.__gf_schedule_due_starts, false, 'absent due is an explicit false frame value');
  assert.equal(first.vm.safe.pump, false);

  const next = runtime.step({ nowMs: 100, inputs: { start: true }, due: { starts: true } });
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
    const runtime = await framed('control FramedLegacy { input enabled: Bool; output pump: Bool; pump <- enabled; }', 'framed-legacy.ghost');
    try {
      const first = runtime.step({ nowMs: 0, inputs: { enabled: true } });
      assert.equal(first.vm.safe.pump, true);
      const committed = runtime.runtime.outcome;
      runtime.runtime.dispatch = () => { throw new Error('injected framed dispatch failure'); };
      assert.throws(() => runtime.step({ nowMs: 1, inputs: { enabled: false } }), /injected framed dispatch failure/);
      assert.deepEqual(runtime.runtime.outcome, committed, 'the committed framed outcome remains available');
      assert.deepEqual(runtime.lastFrameOutcome, committed, 'the getter reads the live framed outcome, not a host cache');
      assert.throws(() => runtime.step({ nowMs: 1, inputs: { enabled: false } }), /faulted/);
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
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
  schedule starts: DailySlots<15min> { timezone = "UTC"; selected = []; }
  output pump: Bool;
  pump <- start;
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
  assert.throws(() => runtime.step({ nowMs: -1, inputs: { start: true } }), /safe integer/);
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: 1 } }), /boolean/);
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: true }, samples: { moisture: { ...sample, timestampMs: 1 } } }), /future/);
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: true }, due: { starts: 1 } }), /boolean/);
  assert.deepEqual(counts, { read: 0, update: 0 });
  const accepted = runtime.step({ nowMs: 0, inputs: { start: true }, samples: { moisture: sample }, due: { starts: false } });
  assert.deepEqual(accepted.frame, { scanId: 0, logicalTimeMs: 0 });
  assert.deepEqual(counts, { read: 2, update: 2 });
});

test('GF-TEST-framed-control-host: a known core rejection preserves the committed frame and permits the same ID retry', async t => {
  const runtime = await framed(`
control FramedCoreFault {
  input divisor: Number;
  output pump: Number;
  pump <- 1 / divisor;
}
`, 'framed-core-fault.ghost');
  t.after(() => runtime.dispose());
  const first = runtime.step({ nowMs: 0, inputs: { divisor: 1 } });
  const committed = runtime.lastFrameOutcome;
  assert.equal(first.vm.safe.pump, 1);
  assert.throws(() => runtime.step({ nowMs: 1, inputs: { divisor: 0 } }), /division by zero/);
  assert.equal(runtime.lastNowMs, 0);
  assert.deepEqual(runtime.lastFrameOutcome, committed);
  const retry = runtime.step({ nowMs: 1, inputs: { divisor: 1 } });
  assert.deepEqual(retry.frame, { scanId: 1, logicalTimeMs: 1 });
  assert.equal(retry.vm.safe.pump, 1);
});

test('GF-TEST-framed-control-host: generated sensor and signal snapshots match legacy for the same artifact', async t => {
  const artifact = await compileSource(`
control FramedParity {
  input start: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(1);
    stale_after = 3s;
    recover_after = 1 samples;
  }
  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  output pump: Bool;
  pump <- start && dry_ok;
}
`, { filename: 'framed-parity.ghost' });
  const legacy = await ControlRuntime.instantiate(wasmBytes, artifact);
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact);
  t.after(() => { runtime.dispose(); legacy.dispose(); });
  for (const [nowMs, value] of [[0, 20], [1_000, 50]]) {
    const snapshot = { nowMs, inputs: { start: true }, samples: { moisture: { epoch: 1, id: nowMs / 1_000 + 1, timestampMs: nowMs, quality: 'Good', value } } };
    const expected = legacy.step(snapshot);
    const actual = runtime.step(snapshot);
    assert.deepEqual(actual.sensors, expected.sensors);
    assert.deepEqual(actual.signals, expected.signals);
    assert.deepEqual(actual.vm.inputs, expected.vm.inputs);
    assert.deepEqual(actual.vm.requested, expected.vm.requested);
    assert.deepEqual(actual.vm.safe, expected.vm.safe);
  }
});
