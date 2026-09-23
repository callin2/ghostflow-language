import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Derived windows

\`\`\`ghost
control DerivedWindows {
  sensor probe: Number;
  signal inner = window_average(probe, over: 2ms, quality: measured, max_age: 2ms);
  signal outer = window_average(inner, over: 10ms, quality: measured, max_age: 10ms);
  output inner_value, outer_value: Number;
  inner_value <- inner |> recover(-1.0);
  outer_value <- outer |> recover(-1.0);
}
\`\`\`\n`;
const delayedSource = source
  .replace('over: 2ms, quality: measured, max_age: 2ms', 'over: 10ms, quality: measured, max_age: 10ms')
  .replace('window_average(inner, over: 10ms, quality: measured, max_age: 10ms)', 'window_average(inner, over: 10ms, quality: measured, max_age: 2ms)');
const retrySource = source
  .replace('sensor probe: Number;', 'input divisor: Number;\n  sensor probe: Number;')
  .replace('output inner_value, outer_value: Number;', 'output inner_value, outer_value, ratio: Number;')
  .replace('outer_value <- outer |> recover(-1.0);', 'outer_value <- outer |> recover(-1.0);\n  ratio <- 1.0 / divisor;');
const sample = (id, timestampMs, value) => ({ epoch: 5, id, timestampMs, value, quality: 'Good' });
const compile = text => compileSource(text, { filename: 'window-derived-host.ghost.md' });

async function instantiate(t, artifact, framed, intervalMs = 1) {
  const tag = artifact.manifest.signals.find(signal => signal.name === 'inner').sources[0].tag;
  const options = { acceptSettings: true, temporal: { timeEpoch: 5, rootDensity: [{ sourceTag: tag, maxObservations: 1, intervalMs }], budget: { maxRetainedSamples: 100, maxBytes: 64 * 1024 * 1024 } } };
  const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact, options);
  t.after(() => runtime.dispose());
  return runtime;
}

for (const framed of [false, true]) {
  test(`${framed ? 'framed' : 'legacy'} nested windows retain exact derived averages and duplicate state`, async t => {
    const artifact = await compile(source);
    const runtime = await instantiate(t, artifact, framed);
    for (const [nowMs, id, value, inner, outer] of [[0, 1, 0, 0, 0], [1, 2, 10, 5, 2.5], [2, 3, 20, 15, 20 / 3]]) {
      const result = runtime.step({ nowMs, samples: { probe: sample(id, nowMs, value) } });
      assert.equal(result.vm.safe.inner_value, inner);
      assert.equal(result.vm.safe.outer_value, outer);
      const observed = observeSourceTrace(artifact.traceMetadata, result.vm).windowEvents[1];
      assert.equal(observed.value, outer);
      assert.equal(observed.count, id);
      assert.equal(observed.contributors.at(-1).kind, 'derived');
    }
    const duplicate = runtime.step({ nowMs: 3 });
    assert.equal(duplicate.vm.safe.inner_value, 20);
    assert.equal(duplicate.vm.safe.outer_value, 20 / 3);
    assert.equal(duplicate.vm.windowTrace[1].count, 3);
    assert.equal(duplicate.vm.windowTrace[1].admissionRevision, 3);
    assert.equal(observeSourceTrace(artifact.traceMetadata, duplicate.vm).windowEvents[1].count, 3);
  });

  test(`${framed ? 'framed' : 'legacy'} nested windows enforce derived max age at delayed evaluation`, async t => {
    const artifact = await compile(delayedSource);
    const runtime = await instantiate(t, artifact, framed, 10);
    const result = runtime.step({ nowMs: 9, samples: { probe: sample(1, 0, 20) } });
    assert.equal(result.vm.safe.inner_value, 20);
    assert.equal(result.vm.safe.outer_value, -1);
    assert.equal(observeSourceTrace(artifact.traceMetadata, result.vm).windowEvents[1].fault.fault, 'NotReady');
  });

  test(`${framed ? 'framed' : 'legacy'} maps aggregate payloads while preserving original proof values`, async t => {
    const mapped = source
      .replace('control DerivedWindows {', 'fn fixed(value: Number) -> Number { 300.0 }\ncontrol DerivedWindows {')
      .replace('window_average(inner,', 'window_average(inner |> map(fixed),');
    const artifact = await compile(mapped);
    const runtime = await instantiate(t, artifact, framed);
    runtime.step({ nowMs: 0, samples: { probe: sample(1, 0, 10) } });
    const result = runtime.step({ nowMs: 1, samples: { probe: sample(2, 1, 20) } });
    assert.equal(result.vm.safe.inner_value, 15);
    assert.equal(result.vm.safe.outer_value, 300);
    const observed = observeSourceTrace(artifact.traceMetadata, result.vm).windowEvents[1];
    assert.deepEqual(observed.contributors.map(point => point.value), [300, 300]);
    assert.deepEqual(observed.contributors.map(point => observed.proof[point.proofRoot].value), [10, 15]);
  });

  test(`${framed ? 'framed' : 'legacy'} rejected late fault rolls back nested evidence and identical sample retry admits once`, async t => {
    const artifact = await compile(retrySource);
    const runtime = await instantiate(t, artifact, framed);
    runtime.step({ nowMs: 0, inputs: { divisor: 1 }, samples: { probe: sample(1, 0, 0) } });
    runtime.step({ nowMs: 1, inputs: { divisor: 1 }, samples: { probe: sample(2, 1, 10) } });
    const committed = structuredClone(framed ? runtime.lastFrameOutcome : runtime.trace);

    assert.throws(() => runtime.step({
      nowMs: 2, inputs: { divisor: 0 }, samples: { probe: sample(3, 2, 20) },
    }), /division by zero/);
    assert.deepEqual(framed ? runtime.lastFrameOutcome : runtime.trace, committed);

    const retry = runtime.step({
      nowMs: 2, inputs: { divisor: 1 }, samples: { probe: sample(3, 2, 20) },
    });
    assert.equal(retry.vm.safe.outer_value, 20 / 3);
    assert.equal(retry.vm.windowTrace[1].count, 3);
    assert.equal(retry.vm.windowTrace[1].admissionRevision, 3);
    const observed = observeSourceTrace(artifact.traceMetadata, retry.vm).windowEvents[1];
    assert.deepEqual(observed.contributors.map(point => point.admissionRevision), [1, 2, 3]);
    assert.equal(observed.proof.filter(point => point.kind === 'physical' && point.id === 3).length, 1);
  });
}
