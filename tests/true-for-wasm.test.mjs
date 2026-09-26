import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const wasm = await fs.readFile(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const profile = (overrides = {}) => ({ timeEpoch: 7, rootDensity: [], certifiedBoolRoots: [7],
  budget: { maxRetainedSamples: 1, maxBytes: 4_000_000 }, ...overrides });
async function runtime(t, guard = false) {
  const instance = await GhostFlowRuntime.instantiate(wasm);
  t.after(() => instance.dispose());
  instance.load(compile(parse(tokenize(`(module Certified
    (input __gf_now_ms number) (input __gf_time_epoch number)
    (input present bool) (input epoch number) (input id number)
    (input start number) (input end number) (input value bool)
    (input quality number) (input fault number)
    ${guard ? '(input divisor number)' : ''}
    (temporal-context __gf_now_ms __gf_time_epoch)
    (strategy control 0 (device true)
      (true-for 17 sustained 7 hot 300000 (interval-inputs present epoch id start end value quality fault))
      (intent alarm (if (true-for-read 0 ok) (true-for-read 0 value) false))
      ${guard ? '(intent quotient (div 1 input.divisor))' : ''}))`))));
  return instance;
}
function tick(instance, { id = 1, start = 0, end = 300000, now = end, present = true,
  epoch = 11, value = true, quality = 1, fault = 0, divisor } = {}) {
  for (const [name, number] of Object.entries({ __gf_time_epoch: 7, epoch, id, start, end, quality, fault })) {
    instance.setNumber(name, number);
  }
  instance.setBool('present', present);
  instance.setBool('value', value);
  if (divisor !== undefined) instance.setNumber('divisor', divisor);
  instance.tickAt(now);
  return instance.trace;
}

test('WASM certified activation executes exact duration and preserves interval provenance', async t => {
  const instance = await runtime(t);
  instance.activateTemporal(profile());
  assert.equal(tick(instance, { end: 299999 }).safe.alarm, false);
  const boundary = tick(instance, { id: 2, start: 299999 });
  assert.equal(boundary.safe.alarm, true);
  assert.deepEqual(boundary.trueForTrace.map(({ site, sourceTag, sourceEpoch, certificateId,
    timeEpoch, startMs, endMs, coveredMs, value, fault }) => ({ site, sourceTag, sourceEpoch,
    certificateId, timeEpoch, startMs, endMs, coveredMs, value, fault })), [{ site: 17,
    sourceTag: 7, sourceEpoch: 11, certificateId: 2, timeEpoch: 7, startMs: 0,
    endMs: 300000, coveredMs: 300000, value: true, fault: null }]);
  assert.equal(tick(instance, { id: 2, start: 299999, now: 300001, present: false }).safe.alarm, false);
});

test('WASM certified activation requires exact root binding and admitted budget', async t => {
  const instance = await runtime(t);
  assert.throws(() => instance.activate(), /true_for activation requires runtime bindings/);
  assert.throws(() => instance.activateTemporal(profile({ certifiedBoolRoots: [8] })), /root contract mismatch/);
  assert.throws(() => instance.activateTemporal(profile({ budget: { maxRetainedSamples: 1, maxBytes: 1 } })), /temporal-budget-exceeded/);
  assert.throws(() => instance.activateTemporal(profile({ rootDensity: [{ sourceTag: 7, maxObservations: 1, intervalMs: 1 }] })), /certified interval activation does not accept point density/);
  instance.activateTemporal(profile());
  assert.equal(tick(instance).safe.alarm, true);
});

test('WASM certified interval state rolls back with downstream expression failure', async t => {
  const instance = await runtime(t, true);
  instance.activateTemporal(profile());
  tick(instance, { end: 100, divisor: 1 });
  assert.throws(() => tick(instance, { id: 2, start: 100, divisor: 0 }), /division by zero/);
  assert.equal(instance.journalLength, 1);
  const retry = tick(instance, { id: 2, start: 100, end: 200, now: 300000, divisor: 1 });
  assert.equal(retry.trueForTrace[0].coveredMs, 200);
  assert.equal(retry.safe.alarm, false);
  assert.throws(() => instance.rewind(1), /true_for rewind requires checkpoint support/);
  assert.throws(() => instance.replayTemporal({ count: 1, profile: profile(),
    maxPeakTemporalBytes: 8_000_000, maxJsonBytes: 100_000 }), /certified Bool roots require GFB6 runtime activation/);
  assert.equal(instance.journalLength, 2);
});

test('WASM true_for rejects fabricated continuity across uncovered or unmeasured intervals', async t => {
  const instance = await runtime(t);
  instance.activateTemporal(profile());
  assert.equal(tick(instance, { start: 0, end: 0 }).safe.alarm, false);
  assert.equal(tick(instance, { id: 2, start: 300000, end: 300000 }).safe.alarm, false);
  assert.equal(tick(instance, { id: 3, start: 300000, end: 599999 }).safe.alarm, false);
  assert.equal(tick(instance, { id: 4, start: 600000, end: 600001 }).safe.alarm, false);
  assert.equal(tick(instance, { id: 5, start: 600001, end: 900001, quality: 2 }).safe.alarm, false);
  assert.equal(tick(instance, { id: 6, start: 900001, end: 1200001 }).safe.alarm, true);
  assert.equal(tick(instance, { id: 1, epoch: 12, start: 1200001, end: 1200002 }).safe.alarm, false);
});

test('WASM malformed and changed duplicate certificates cannot change committed coverage', async t => {
  const instance = await runtime(t);
  instance.activateTemporal(profile());
  tick(instance, { end: 100 });
  for (const certificate of [
    { id: 1, end: 101 },
    { id: 2, start: 101, end: 100 },
    { id: 2, start: 100, end: 300000, now: 299999 },
    { id: 2.5, start: 100, end: 200 },
  ]) {
    assert.throws(() => tick(instance, certificate));
    assert.equal(instance.journalLength, 1);
    assert.equal(instance.trace.trueForTrace[0].coveredMs, 100);
  }
  assert.equal(tick(instance, { id: 2, start: 100 }).safe.alarm, true);
});
