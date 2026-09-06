import assert from 'node:assert/strict';
import test from 'node:test';
import { SignalConditioner } from '../runtimes/wasm/signals.mjs';

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
