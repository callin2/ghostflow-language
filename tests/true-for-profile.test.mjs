import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeTemporalProfile } from '../runtimes/wasm/temporal-profile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

const profile = certifiedBoolRoots => ({
  timeEpoch: 7,
  rootDensity: [],
  certifiedBoolRoots,
  budget: { maxRetainedSamples: 1, maxBytes: 4_000_000 },
});

test('certified Bool source binding uses bounded GFTA v2 packet', () => {
  const bytes = encodeTemporalProfile(profile([11]));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes.length, 32);
  assert.equal(view.getUint16(4, true), 2);
  assert.equal(view.getUint16(6, true), 0);
  assert.equal(view.getBigUint64(8, true), 7n);
  assert.equal(view.getUint16(24, true), 1);
  assert.equal(view.getUint16(26, true), 0);
  assert.equal(view.getUint32(28, true), 11);
});

test('certified Bool source list rejects missing and ambiguous identities', () => {
  for (const roots of [[], [0], [11, 11], [12, 11], [0x1_0000_0000]]) {
    assert.throws(() => encodeTemporalProfile(profile(roots)));
  }
});

test('public ControlRuntime validates the manifest before accepting a verified GFB6 module', async () => {
  const bytes = compile(parse(tokenize(`(module Certified
    (input __gf_now_ms number) (input __gf_time_epoch number)
    (input present bool) (input epoch number) (input id number)
    (input start number) (input end number) (input value bool)
    (input quality number) (input fault number)
    (temporal-context __gf_now_ms __gf_time_epoch)
    (strategy control 0 (device true)
      (true-for 17 sustained 7 hot 300000 (interval-inputs present epoch id start end value quality fault))
      (intent alarm (if (true-for-read 0 ok) (true-for-read 0 value) false))))`)));
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, true), 6);
  await assert.rejects(
    ControlRuntime.instantiate(new Uint8Array(), { bytes, manifest: {} }, { temporal: profile([7]) }),
    /manifest.format is required/,
  );
});
