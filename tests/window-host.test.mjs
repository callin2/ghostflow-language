import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Window host

\`\`\`ghost
control WindowHost {
  input threshold_time: Duration;
  sensor temperature: Temperature;
  signal average = window_average(temperature, over: 1s, quality: measured, max_age: 1s);
  signal minimum = window_min(temperature, over: 1s, quality: measured, max_age: 1s);
  signal maximum = window_max(temperature, over: 1s, quality: measured, max_age: 1s);
  signal rate = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
  output average_value, minimum_value, maximum_value: Temperature;
  output fast: Bool;
  average_value <- average |> recover(0K);
  minimum_value <- minimum |> recover(0K);
  maximum_value <- maximum |> recover(0K);
  fast <- rate |> map(below(rate(delta: 1ΔK, time: threshold_time))) |> recover(false);
}
\`\`\`\n`;
const profile = (sourceTag = 1) => ({
  timeEpoch: 5,
  rootDensity: [{ sourceTag, maxObservations: 3, intervalMs: 1000 }],
  budget: { maxRetainedSamples: 12, maxBytes: 33554432 },
});
const sample = (id, timestampMs, value, quality = 'Good') => ({ epoch: 5, id, timestampMs, value, quality });
const compile = () => compileSource(source, { filename: 'window-host.ghost.md' });

test('window host compiles all physical operations with format 4 descriptors', async () => {
  const artifact = await compile();
  assert.equal(artifact.bytes.readUInt16LE(4), 4);
  assert.deepEqual(artifact.manifest.signals.filter(signal => signal.kind === 'window').map(signal => signal.operation), ['average', 'min', 'max', 'rate']);
});

for (const [label, instantiate] of [['legacy', ControlRuntime.instantiate], ['framed', ControlRuntime.instantiateFramed]]) {
  test(`window host ${label} executes average/min/max/rate with temporal profile`, async t => {
    const artifact = await compile();
    const options = { acceptSettings: true, temporal: profile(artifact.manifest.signals[0].sources[0].tag) };
    const runtime = await instantiate.call(ControlRuntime, wasm, artifact, options);
    t.after(() => runtime.dispose());
    const first = runtime.step({ nowMs: 1000, inputs: { threshold_time: 1000 }, samples: { temperature: sample(1, 1000, 280) } });
    assert.deepEqual(first.vm.safe, { average_value: 280, minimum_value: 280, maximum_value: 280, fast: false });
    assert.equal(first.vm.windowTrace[0].timeEpoch, 5);
    assert.throws(() => runtime.step({ nowMs: 1400, inputs: { threshold_time: 0 }, samples: { temperature: sample(2, 1400, 284) } }), /division by zero/);
    const second = runtime.step({ nowMs: 1400, inputs: { threshold_time: 1000 }, samples: { temperature: sample(2, 1400, 284) } });
    assert.deepEqual(second.vm.safe, { average_value: 282, minimum_value: 280, maximum_value: 284, fast: false });
    assert.equal(second.vm.windowTrace[0].timeEpoch, 5);
    assert.deepEqual(second.vm.windowTrace.map(entry => [entry.value, entry.count, entry.admissionRevision]), [[282, 2, 2], [280, 2, 2], [284, 2, 2], [10, 2, 2]]);
    options.temporal.timeEpoch = 99;
    const expired = runtime.step({ nowMs: 2000, inputs: { threshold_time: 1000 } });
    assert.deepEqual(expired.vm.safe, { average_value: 284, minimum_value: 284, maximum_value: 284, fast: false });
    assert.equal(expired.vm.windowTrace[0].timeEpoch, 5);
    assert.deepEqual(expired.vm.windowTrace.map(entry => [entry.value, entry.count]), [[284, 1], [284, 1], [284, 1], [null, 1]]);
  });
}

test('window host retries a zero-time rate fault without committing the window', async t => {
  const artifact = await compile();
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { acceptSettings: true, temporal: profile(artifact.manifest.signals[0].sources[0].tag) });
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 1000, inputs: { threshold_time: 1000 }, samples: { temperature: sample(1, 1000, 280) } });
  assert.throws(() => runtime.step({ nowMs: 1400, inputs: { threshold_time: 0 }, samples: { temperature: sample(2, 1400, 284) } }), /division by zero/);
  const retry = runtime.step({ nowMs: 1400, inputs: { threshold_time: 1000 }, samples: { temperature: sample(2, 1400, 284) } });
  assert.equal(retry.vm.safe.average_value, 282);
});

test('window host rejects missing and malformed temporal profiles before execution', async () => {
  const artifact = await compile();
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /temporal|profile|window/i);
  for (const [mutate, diagnostic] of [
    [value => { value.timeEpoch = -1; }, /timeEpoch must be an integer/],
    [value => { value.rootDensity[0].maxObservations = 0; }, /maxObservations must be an integer/],
    [value => { value.budget.maxRetainedSamples = 0; }, /maxRetainedSamples must be an integer/],
    [value => { value.rootDensity[0].intervalMs = 0; }, /intervalMs must be an integer/],
  ]) {
    const invalid = profile(); mutate(invalid);
    await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact, { acceptSettings: true, temporal: invalid }), diagnostic);
  }
});

test('window host rejects malformed descriptor domains before WASM execution', async t => {
  const artifact = await compile();
  for (const [label, mutate, diagnostic] of [
    ['slot gap', m => { m.signals[0].slot = 1; }, /slot must follow window declaration order/],
    ['zero site', m => { m.signals[0].site = 0; }, /site must be a safe integer/],
    ['duplicate site', m => { m.signals[1].site = m.signals[0].site; }, /duplicate window site/],
    ['clock alias', m => { m.signals[0].timeEpochInput = '__gf_now_ms'; }, /invalid window clock bindings/],
    ['unknown source', m => { m.signals[0].sources[0].name = 'missing'; }, /unknown or unbound sample source/],
    ['Bool payload', m => { m.signals[0].payloadType = 'Bool'; }, /payloadType is unsupported/],
    ['invalid rate quantity', m => { m.signals[3].payloadType = 'Rate<Percent>'; }, /payloadType is unsupported/],
    ['zero duration', m => { m.signals[0].overMs = 0; }, /overMs must be a safe integer/],
    ['wrong manifest format', m => { m.format = 'GhostFlow/control-v1'; }, /GFB format 4 requires a v4 window manifest/],
  ]) await t.test(label, async () => {
    const manifest = structuredClone(artifact.manifest);
    mutate(manifest);
    await assert.rejects(() => ControlRuntime.instantiate(wasm, { ...artifact, manifest }, { temporal: profile() }), diagnostic);
  });
});

test('window host rejects temporal configuration for a non-window artifact', async () => {
  const artifact = await compileSource(`# Plain\n\n\`\`\`ghost\ncontrol Plain { output status: Bool; status <- true; }\n\`\`\`\n`, { filename: 'plain-host.ghost.md' });
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact, { acceptSettings: true, temporal: profile() }), /temporal|window|profile/i);
});
