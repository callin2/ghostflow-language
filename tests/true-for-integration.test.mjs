import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

// Executable target contract, initially RED. The compiler rejection is not
// caught: accepting syntax alone must still fail the manifest/runtime assertions.
const filename = 'true-for-certified.ghost.md';
async function compile() {
  const source = await fs.readFile(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8');
  return compileSource(source, { filename });
}
const intervalInputs = Object.fromEntries(
  ['present', 'epoch', 'id', 'start', 'end', 'value', 'quality', 'fault']
    .map(field => [field, `__gf_interval_${field}_hot`]),
);
function descriptor(artifact) {
  const sensor = artifact.sourceMap.find(node => node.kind === 'sensor');
  const signal = artifact.sourceMap.find(node => node.kind === 'signal' && node.signalMode === 'true_for');
  assert.ok(sensor && signal, 'source identities survive literate compilation');
  return {
    kind: 'true-for', name: 'sustained', site: signal.id, slot: 0,
    payloadType: 'Bool', errorType: 'SensorFault', quality: 'measured', durationMs: 300_000,
    clockInput: '__gf_now_ms', timeEpochInput: '__gf_time_epoch',
    sources: [{ name: 'hot', tag: sensor.id }], intervalInputs,
  };
}
function profile(sourceTag) {
  return {
    timeEpoch: 7, rootDensity: [], certifiedBoolRoots: [sourceTag],
    budget: { maxRetainedSamples: 1, maxBytes: 4_000_000 },
  };
}
const interval = (id, startMs, endMs) => ({
  epoch: 11, id, startMs, endMs, value: true, quality: 'Measured',
});
async function instantiate(t, artifact, temporal) {
  // Read only after compilation, so the first RED cannot be a missing build.
  const wasm = await fs.readFile(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { acceptSettings: true, temporal });
  t.after(() => runtime.dispose());
  return runtime;
}

test('true_for literate artifact declares certified interval bindings and a Bool Result prelude', async () => {
  const artifact = await compile();
  assert.deepEqual(artifact.manifest.signals, [descriptor(artifact)]);
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset, artifact.bytes.byteLength).getUint16(4, true), 6);
  assert.equal(artifact.manifest.timers.length, 0, 'certificates are not scan timers');
});

test('true_for public runtime uses explicit Driver intervals and reaches the exact duration boundary', async t => {
  const artifact = await compile();
  const expected = descriptor(artifact);
  assert.deepEqual(artifact.manifest.signals, [expected]);
  const sourceTag = expected.sources[0].tag;
  const runtime = await instantiate(t, artifact, profile(sourceTag));
  const before = runtime.step({ nowMs: 299_999, intervals: { hot: interval(1, 0, 299_999) } });
  assert.equal(before.vm.safe.alarm, false);
  const boundary = runtime.step({ nowMs: 300_000, intervals: { hot: interval(2, 299_999, 300_000) } });
  assert.equal(boundary.vm.safe.alarm, true);
  assert.deepEqual(boundary.vm.trueForTrace.map(({ site, sourceTag, sourceEpoch, certificateId, timeEpoch, startMs, endMs, coveredMs, value, fault }) =>
    ({ site, sourceTag, sourceEpoch, certificateId, timeEpoch, startMs, endMs, coveredMs, value, fault })), [{
    site: expected.site, sourceTag, sourceEpoch: 11, certificateId: 2, timeEpoch: 7,
    startMs: 0, endMs: 300_000, coveredMs: 300_000, value: true, fault: null,
  }]);
  const absent = runtime.step({ nowMs: 300_001 });
  assert.equal(absent.vm.safe.alarm, false, 'clock-only tick supplies no measured interval');
});

test('true_for point samples alone never satisfy certified duration', async t => {
  const artifact = await compile();
  const runtime = await instantiate(t, artifact, profile(descriptor(artifact).sources[0].tag));
  for (const [id, nowMs] of [[1, 0], [2, 300_000], [3, 600_000]]) {
    const result = runtime.step({ nowMs, samples: { hot: { epoch: 11, id, timestampMs: nowMs, value: true, quality: 'Good' } } });
    assert.equal(result.vm.safe.alarm, false, `point sample at ${nowMs} certifies no interval`);
  }
});

test('true_for does not interpolate a gap between Driver intervals', async t => {
  const artifact = await compile();
  const runtime = await instantiate(t, artifact, profile(descriptor(artifact).sources[0].tag));
  const first = runtime.step({ nowMs: 100_000, intervals: { hot: interval(1, 0, 100_000) } });
  assert.equal(first.vm.safe.alarm, false);
  const gap = runtime.step({ nowMs: 300_000, intervals: { hot: interval(2, 200_000, 300_000) } });
  assert.equal(gap.vm.safe.alarm, false, 'unobserved time cannot be inferred as true');
  assert.equal(gap.vm.trueForTrace[0].coveredMs, 100_000);
});

test('true_for unavailable Driver evidence resets coverage and preserves fault provenance', async t => {
  const artifact = await compile();
  const runtime = await instantiate(t, artifact, profile(descriptor(artifact).sources[0].tag));
  runtime.step({ nowMs: 100_000, intervals: { hot: interval(1, 0, 100_000) } });
  const unavailable = runtime.step({ nowMs: 100_001, intervals: {
    hot: { epoch: 11, id: 2, startMs: 100_000, endMs: 100_001, value: true, quality: 'Stale' },
  } });
  assert.equal(unavailable.vm.safe.alarm, false);
  assert.equal(unavailable.vm.trueForTrace[0].fault, 1, 'fault code preserves Stale provenance');
  assert.equal(unavailable.vm.trueForTrace[0].coveredMs, 0);
});
