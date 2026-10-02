import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { SignalConditioner } from '../runtimes/wasm/signals.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

function fakeExports() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let nextPointer = 64;
  let updates = 0;
  return {
    memory,
    gf_signal_sizeof: () => 64,
    gf_alloc: () => nextPointer,
    gf_dealloc: () => {},
    gf_signal_create: () => 1,
    gf_signal_free: () => {},
    gf_signal_update: () => { updates += 1; return 1; },
    gf_signal_readquality: () => 1,
    gf_signal_readvalue: () => 42,
    gf_signal_readhysteresis: () => 1,
    gf_signal_reset: () => 1,
    gf_signal_last_error_ptr: () => 0,
    gf_signal_last_error_len: () => 0,
    get updates() { return updates; },
  };
}

const validConfig = () => ({
  filter: 'median', window: 5, validMin: 0, validMax: 100,
  staleMs: 3_000, recoverSamples: 3,
  hysteresis: { onBelow: 30, offAbove: 35, initial: false },
});

test('rejects config integer/range and finite violations before ABI narrowing', () => {
  for (const [key, value] of [
    ['window', 257], ['window', 0], ['recoverSamples', NaN], ['recoverSamples', 32],
    ['staleMs', -1], ['validMin', NaN], ['validMax', Infinity],
  ]) {
    const config = validConfig();
    config[key] = value;
    assert.throws(() => new SignalConditioner(fakeExports(), config));
  }
  const ema = validConfig();
  ema.filter = 'ema';
  ema.window = 1;
  ema.alpha = NaN;
  assert.throws(() => new SignalConditioner(fakeExports(), ema));
});

test('rejects unsafe sample/time values, unknown quality, and non-finite values', () => {
  const exports = fakeExports();
  const conditioner = new SignalConditioner(exports, validConfig());
  const sample = { epoch: 1, id: 1, timestampMs: 1, value: 20, quality: 'Good' };
  for (const [field, value] of [['epoch', -1], ['id', -1], ['timestampMs', -1]]) {
    assert.throws(() => conditioner.update({ ...sample, [field]: value }, 1));
  }
  assert.throws(() => conditioner.update({ ...sample, quality: 'Noise' }, 1));
  assert.throws(() => conditioner.update({ ...sample, quality: 99 }, 1));
  assert.throws(() => conditioner.update({ ...sample, value: NaN }, 1));
  assert.equal(exports.updates, 0);
  conditioner.dispose();
});

test('rejects all operations after dispose', () => {
  const conditioner = new SignalConditioner(fakeExports(), validConfig());
  conditioner.dispose();
  assert.throws(() => conditioner.read(1), /disposed/);
  assert.throws(() => conditioner.update({ epoch: 1, id: 1, timestampMs: 1, value: 20, quality: 'Good' }, 1), /disposed/);
  assert.throws(() => conditioner.reset(), /disposed/);
});

// Reference §4.2–4.3: exercise the Rust conditioner through the real WASM ABI.
async function realExports() {
  const bytes = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

async function realConditioner(t, overrides = {}, exports = null) {
  const conditioner = new SignalConditioner(exports ?? await realExports(), {
    ...validConfig(), window: 1, recoverSamples: 1, ...overrides,
  });
  t.after(() => conditioner.dispose());
  return conditioner;
}

const goodSample = (id, value, timestampMs = id) => ({ epoch: 1, id, timestampMs, value, quality: 'Good' });

for (const window of [1, 31]) {
  test(`real WASM median(${window}) is NotReady at N-1, ready at N, and slides at N+1`, async t => {
    const sensor = await realConditioner(t, { window });
    assert.equal(sensor.read(0).quality, 'NotReady');
    for (let id = 1; id < window; id++) {
      assert.equal(sensor.update(goodSample(id, id), id).quality, 'NotReady', `sample ${id}`);
    }
    const ready = sensor.update(goodSample(window, window), window);
    assert.equal(ready.quality, 'Good');
    assert.equal(ready.value, (window + 1) / 2);
    const next = sensor.update(goodSample(window + 1, window + 1), window + 1);
    assert.equal(next.quality, 'Good');
    assert.equal(next.value, (window + 1) / 2 + 1);
  });
}

test('real WASM hysteresis retains either prior state exactly at both thresholds', async t => {
  const sensor = await realConditioner(t);
  const sequence = [
    [30, false], [35, false], [29, true],
    [30, true], [35, true], [36, false], [35, false],
  ];
  for (const [index, [value, expected]] of sequence.entries()) {
    const reading = sensor.update(goodSample(index + 1, value), index + 1);
    assert.equal(reading.quality, 'Good');
    assert.equal(reading.dry, expected, `step ${index}: value ${value}`);
  }
});

test('real WASM REF-04-016 median five clears its window after Invalid fault', async t => {
  const sensor = await realConditioner(t, { window: 5, recoverSamples: 1 });
  for (const [id, value] of [[1, 28], [2, 29], [3, 90], [4, 28]]) {
    assert.equal(sensor.update(goodSample(id, value), id).quality, 'NotReady');
  }
  assert.deepEqual(sensor.update(goodSample(5, 29), 5), {
    ok: true, value: 29, quality: 'Good', dry: true,
  });
  assert.deepEqual(sensor.update({ ...goodSample(6, 29), quality: 'Invalid' }, 6), {
    ok: false, value: null, quality: 'Invalid', dry: false,
  });
  for (const [id, value] of [[7, 28], [8, 29], [9, 90], [10, 28]]) {
    assert.equal(sensor.update(goodSample(id, value), id).quality, 'NotReady');
  }
  assert.deepEqual(sensor.update(goodSample(11, 29), 11), {
    ok: true, value: 29, quality: 'Good', dry: true,
  });
});

test('real WASM REF-04-019 hysteresis preserves thresholds and exposes fault', async t => {
  const sensor = await realConditioner(t, { window: 1, recoverSamples: 1 });
  for (const [id, value, expected] of [[1, 30, false], [2, 29, true], [3, 33, true], [4, 35, true], [5, 36, false]]) {
    const reading = sensor.update(goodSample(id, value), id);
    assert.equal(reading.quality, 'Good');
    assert.equal(reading.dry, expected);
  }
  assert.deepEqual(sensor.update({ ...goodSample(6, 36), quality: 'Invalid' }, 6), {
    ok: false, value: null, quality: 'Invalid', dry: false,
  });
});

test('real WASM valid range includes both endpoints and rejects values immediately outside', async t => {
  const sensor = await realConditioner(t);
  const sequence = [[0, 'Good'], [100, 'Good'], [-Number.MIN_VALUE, 'Invalid'], [100 + 2 ** -46, 'Invalid']];
  for (const [index, [value, quality]] of sequence.entries()) {
    const reading = sensor.update(goodSample(index + 1, value), index + 1);
    assert.equal(reading.quality, quality, `value ${value}`);
    assert.equal(reading.ok, quality === 'Good');
    if (quality === 'Good') assert.equal(reading.value, value);
  }
});

test('real WASM recovery does not combine samples across source epochs', async t => {
  const sensor = await realConditioner(t, { window: 5, recoverSamples: 3 });
  for (const [id, value] of [[1, 10], [2, 20], [3, 30], [4, 40], [5, 50]]) {
    assert.equal(sensor.update(goodSample(id, value), id).quality, id === 5 ? 'Good' : 'NotReady');
  }
  assert.equal(sensor.update({ ...goodSample(6, 0), quality: 'Invalid' }, 6).quality, 'Invalid');
  for (const [id, value] of [[7, 1], [8, 2], [9, 3]]) {
    assert.equal(sensor.update(goodSample(id, value), id).quality, 'NotReady');
  }
  for (const [id, value] of [[10, 20], [11, 30]]) {
    const now = id;
    assert.equal(sensor.update({ ...goodSample(id, value, now), epoch: 2 }, now).quality, 'NotReady');
  }
  for (const [id, value] of [[12, 40], [13, 50]]) {
    const now = id;
    assert.equal(sensor.update({ ...goodSample(id, value, now), epoch: 2 }, now).quality, 'NotReady');
  }
  const recovered = sensor.update({ ...goodSample(14, 60, 14), epoch: 2 }, 14);
  assert.equal(recovered.quality, 'Good');
  assert.equal(recovered.value, 40);
  const rebooted = await realConditioner(t, { window: 5, recoverSamples: 3 });
  assert.equal(rebooted.read(0).quality, 'NotReady');
  assert.equal(rebooted.read(0).value, null);
  for (const [id, value] of [[1, 10], [2, 20], [3, 30], [4, 40]]) {
    assert.equal(rebooted.update(goodSample(id, value), id).quality, 'NotReady');
  }
  const rebootReady = rebooted.update(goodSample(5, 50), 5);
  assert.equal(rebootReady.quality, 'Good');
  assert.equal(rebootReady.value, 30);
});

test('real WASM stale boundary and fresh conditioner reboot start at NotReady', async t => {
  const sensor = await realConditioner(t, { staleMs: 3_000 });
  assert.equal(sensor.update(goodSample(1, 42, 0), 0).quality, 'Good');
  assert.equal(sensor.read(2_999).quality, 'Good');
  assert.equal(sensor.read(2_999).value, 42);
  assert.equal(sensor.read(3_000).quality, 'Stale');
  assert.equal(sensor.read(3_000).value, null);
  assert.equal(sensor.read(3_000).ok, false);
  const fresh = await realConditioner(t, { staleMs: 3_000 });
  assert.equal(fresh.read(0).quality, 'NotReady');
  assert.equal(fresh.read(0).value, null);
});

test('real WASM REF-04-023 delayed evaluation and duplicate samples keep the 3999 Good and 4000 Stale boundary', async t => {
  const sensor = await realConditioner(t, { staleMs: 3_000 });
  const sample = goodSample(1, 42, 1000);
  assert.equal(sensor.update(sample, 1500).quality, 'Good');
  assert.equal(sensor.read(2500).value, 42);
  assert.deepEqual(sensor.update(sample, 3999), { ok: true, value: 42, quality: 'Good', dry: false });
  assert.deepEqual(sensor.read(4000), { ok: false, value: null, quality: 'Stale', dry: false });
  assert.deepEqual(sensor.update(sample, 4001), { ok: false, value: null, quality: 'Stale', dry: false });
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 1000 });
});

test('real WASM sample identity preserves accepted, duplicate, and fault samples and reset clears it', async t => {
  const sensor = await realConditioner(t, { window: 1, recoverSamples: 1 });
  assert.equal(sensor.sampleIdentity(), null);
  const first = { ...goodSample(0, 42, 100), epoch: 7 };
  assert.equal(sensor.update(first, 100).quality, 'Good');
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 7, id: 0, timestampMs: 100 });
  sensor.read(101);
  sensor.read(102);
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 7, id: 0, timestampMs: 100 });
  sensor.update({ ...first, value: 99, timestampMs: 101 }, 101);
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 7, id: 0, timestampMs: 100 });
  const epochChange = { ...goodSample(1, 42, 150), epoch: 8 };
  sensor.update(epochChange, 150);
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 8, id: 1, timestampMs: 150 });
  const fault = { ...goodSample(2, 42, 200), epoch: 8, quality: 'Invalid' };
  assert.equal(sensor.update(fault, 200).quality, 'Invalid');
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 8, id: 2, timestampMs: 200 });
  sensor.reset();
  assert.equal(sensor.sampleIdentity(), null);
});

test('REF-01-077 hysteresis retains the original three-value trace across an in-memory WASM checkpoint and replay', async t => {
  const artifact = await compileSource(`control HysteresisCheckpoint {
    sensor moisture: Percent { valid = 0% .. 100%; filter = median(1); stale_after = 3s; recover_after = 1 samples; }
    signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
    output pump: Bool;
    pump <- case dry { ok(value) => value; fault(_) => false; };
  }`, { filename: 'hysteresis-checkpoint.ghost' });
  const sourceSensor = artifact.manifest.sensors.find(item => item.name === 'moisture');
  const sourceSignal = artifact.manifest.signals.find(item => item.name === 'dry');
  const config = {
    filter: sourceSensor.filter, window: sourceSensor.window,
    validMin: sourceSensor.validMin, validMax: sourceSensor.validMax,
    staleMs: sourceSensor.staleMs, recoverSamples: sourceSensor.recoverSamples,
    hysteresis: { onBelow: sourceSignal.onBelow, offAbove: sourceSignal.offAbove, initial: sourceSignal.initial },
  };
  assert.deepEqual(config.hysteresis, { onBelow: 30, offAbove: 35, initial: false });
  const sensor = await realConditioner(t, config);
  assert.equal(sensor.read(0).dry, false);
  const values = [29, 32, 36];
  const advance = (conditioner, index) => {
    const nowMs = (index + 1) * 1000;
    conditioner.update(goodSample(index + 1, values[index], nowMs), nowMs);
    return { reading: conditioner.read(nowMs), identity: conditioner.sampleIdentity() };
  };
  const first = advance(sensor, 0);
  sensor.begin(); // existing ABI takes a bounded clone of complete Rust Sensor state
  const original = [first, advance(sensor, 1), advance(sensor, 2)];
  assert.deepEqual(original.map(item => item.reading.dry), [true, true, false]);
  assert.deepEqual(original.map(item => item.reading.value), values);
  sensor.rollback();
  assert.deepEqual({ reading: sensor.read(1000), identity: sensor.sampleIdentity() }, first);
  const resumed = [first, advance(sensor, 1), advance(sensor, 2)];
  assert.deepEqual(resumed, original, 'resumed deadband must retain the checkpoint hysteresis memory');
  const fresh = await realConditioner(t, config);
  assert.deepEqual(values.map((_, index) => advance(fresh, index)), original,
    'independent full replay must reproduce readings, quality, hysteresis and sample identities');
});

test('real WASM signal transaction rollback restores reading and identity', async t => {
  const sensor = await realConditioner(t, { window: 1, recoverSamples: 1 });
  sensor.update(goodSample(1, 10, 100), 100);
  const before = sensor.read(100);
  const identity = sensor.sampleIdentity();
  sensor.begin();
  sensor.update(goodSample(2, 20, 200), 200);
  sensor.rollback();
  assert.deepEqual(sensor.read(200), before);
  assert.deepEqual(sensor.sampleIdentity(), identity);
});

test('real WASM signal transaction commit retains the update', async t => {
  const sensor = await realConditioner(t, { window: 1, recoverSamples: 1 });
  sensor.begin();
  sensor.update(goodSample(1, 10, 100), 100);
  sensor.commit();
  assert.equal(sensor.read(100).value, 10);
  assert.deepEqual(sensor.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 100 });
});

test('real WASM signal transactions reject nesting without losing the original transaction', async t => {
  const sensor = await realConditioner(t, { window: 1, recoverSamples: 1 });
  sensor.begin();
  assert.throws(() => sensor.begin(), error => error?.constructor === Error && error.message === 'signal transaction already active');
  sensor.update(goodSample(1, 10, 100), 100);
  sensor.rollback();
  assert.equal(sensor.sampleIdentity(), null);
});

test('real WASM signal transactions reject inactive commit and rollback', async t => {
  const sensor = await realConditioner(t);
  assert.throws(() => sensor.commit(), error => error?.constructor === Error && error.message === 'signal transaction is not active');
  assert.throws(() => sensor.rollback(), error => error?.constructor === Error && error.message === 'signal transaction is not active');
});

test('real WASM signal transaction rollback restores reset state', async t => {
  const sensor = await realConditioner(t, { window: 1, recoverSamples: 1 });
  sensor.update(goodSample(1, 10, 100), 100);
  const before = sensor.read(100);
  const identity = sensor.sampleIdentity();
  sensor.begin();
  sensor.reset();
  sensor.rollback();
  assert.deepEqual(sensor.read(100), before);
  assert.deepEqual(sensor.sampleIdentity(), identity);
});

test('real WASM signal disposal with active transaction remains disposed', async t => {
  const sensor = await realConditioner(t);
  sensor.begin();
  sensor.dispose();
  assert.throws(() => sensor.commit(), /disposed/);
  assert.throws(() => sensor.rollback(), /disposed/);
});

test('real WASM duplicate samples and reads do not postpone the exact stale boundary', async t => {
  const sensor = await realConditioner(t, { staleMs: 10 });
  assert.equal(sensor.update(goodSample(1, 20, 100), 100).quality, 'Good');
  const duplicate = sensor.update(goodSample(1, 90, 109), 109);
  assert.equal(duplicate.value, 20);
  assert.equal(duplicate.quality, 'Good');
  for (const [now, quality] of [[109, 'Good'], [110, 'Stale'], [111, 'Stale']]) {
    assert.equal(sensor.read(now).quality, quality, `time ${now}`);
    assert.equal(sensor.read(now).quality, quality, `repeated read at ${now}`);
  }
});

for (const recoverSamples of [1, 31]) {
  test(`real WASM recovery(${recoverSamples}) requires N fresh samples after fault`, async t => {
    const sensor = await realConditioner(t, { recoverSamples });
    for (let id = 1; id <= recoverSamples; id++) sensor.update(goodSample(id, 20), id);
    assert.equal(sensor.read(recoverSamples).quality, 'Good');
    const faultId = recoverSamples + 1;
    assert.deepEqual(sensor.update({ ...goodSample(faultId, 20), quality: 'Invalid' }, faultId), {
      ok: false, value: null, quality: 'Invalid', dry: false,
    });
    const recovering = [];
    for (let count = 1; count <= recoverSamples; count++) {
      const id = faultId + count;
      recovering.push(sensor.update(goodSample(id, 20), id));
    }
    assert.deepEqual(recovering.at(-1), {
      ok: true, value: 20, quality: 'Good', dry: true,
    }, 'exactly N fresh samples restore the payload and signal');
    assert.deepEqual(
      recovering.slice(0, -1),
      Array.from({ length: recoverSamples - 1 }, () => ({
        ok: false, value: null, quality: 'NotReady', dry: false,
      })),
    );
  });
}

test('real WASM duplicate samples neither look valid nor advance recovery(31)', async t => {
  const sensor = await realConditioner(t, { recoverSamples: 31 });
  assert.equal(sensor.update(goodSample(1, 20), 1).quality, 'Good');
  assert.equal(sensor.update({ ...goodSample(2, 20), quality: 'Invalid' }, 2).quality, 'Invalid');

  const duplicates = [];
  let final;
  for (let count = 1; count <= 31; count++) {
    const id = 2 + count;
    final = sensor.update(goodSample(id, 20), id);
    if (count < 31) duplicates.push(sensor.update(goodSample(id, 90), id));
  }

  assert.deepEqual(final, { ok: true, value: 20, quality: 'Good', dry: true });
  assert.deepEqual(
    duplicates,
    Array.from({ length: 30 }, () => ({
      ok: false, value: null, quality: 'NotReady', dry: false,
    })),
    'duplicates preserve the pending fault and do not expose their payload',
  );
});

for (const quality of ['Disconnected', 'Stale', 'Invalid', 'NotReady']) {
  test(`real WASM exposes ${quality} without a payload or normal Bool result`, async t => {
    const sensor = await realConditioner(t);
    const reading = sensor.update({ ...goodSample(1, 99), quality }, 1);
    assert.deepEqual(reading, { ok: false, value: null, quality, dry: false }, quality);
  });
}

test('real WASM conditioners keep filter, fault, and hysteresis state instance-local', async t => {
  const exports = await realExports();
  const first = await realConditioner(t, {}, exports);
  const second = await realConditioner(t, {}, exports);

  assert.deepEqual(first.update(goodSample(1, 20), 1), {
    ok: true, value: 20, quality: 'Good', dry: true,
  });
  assert.deepEqual(second.update(goodSample(1, 40), 1), {
    ok: true, value: 40, quality: 'Good', dry: false,
  });
  assert.deepEqual(first.update({ ...goodSample(2, 20), quality: 'Disconnected' }, 2), {
    ok: false, value: null, quality: 'Disconnected', dry: false,
  });
  assert.deepEqual(second.read(2), {
    ok: true, value: 40, quality: 'Good', dry: false,
  });
});

test('real WASM stale recovery waits for both fresh-sample count and filter readiness', async t => {
  const sensor = await realConditioner(t, { window: 3, recoverSamples: 2, staleMs: 10 });
  for (const [id, value] of [[1, 10], [2, 20], [3, 30]]) {
    sensor.update(goodSample(id, value, 99 + id), 99 + id);
  }
  assert.deepEqual(sensor.read(112), {
    ok: false, value: null, quality: 'Stale', dry: false,
  });

  const pending = [];
  for (const [id, value] of [[4, 40], [5, 50]]) {
    pending.push(sensor.update(goodSample(id, value, 109 + id), 109 + id));
  }
  const recovered = sensor.update(goodSample(6, 60, 115), 115);
  assert.deepEqual(recovered, {
    ok: true, value: 50, quality: 'Good', dry: false,
  });
  assert.deepEqual(
    pending,
    Array.from({ length: 2 }, () => ({
      ok: false, value: null, quality: 'NotReady', dry: false,
    })),
  );
});
