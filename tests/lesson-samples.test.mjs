import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { canonicalLessonJson, compileLessonBundle, LessonBundleError, validateLessonBundle } from '../tools/lesson.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const artifact = compilation => ({ ...compilation, manifest: { ...compilation.manifest, bytecodeSha256: digest(compilation.bytes) } });
const sample = (value, id = 1, timestampMs = 0, quality = 'Good') => ({ epoch: 1, id, timestampMs, quality, value });
const source = '# Typed lesson\n\n```ghost\ncontrol Lesson {\n  input enabled: Bool;\n  output pump: Bool;\n  pump <- enabled |> recover(false);\n}\n```\n';
function bundle(change = () => {}) {
  const value = {
    format: 'ghostflow-lesson-v1', lessonId: 'typed-input', revision: 'samples-v1', title: 'Typed input', locale: 'en',
    source: { text: source, sha256: '', mediaType: 'text/markdown; profile=ghostflow-literate' },
    playback: { durationMs: 1000, checkpoints: [{ atMs: 0, sourceSpan: { startLine: 4, endLine: 8 }, narration: 'Explicit input faults.', scenarioId: 'main' }] },
    scenarios: [{ id: 'main', title: 'Samples', frames: [{ atMs: 0, inputs: {}, samples: { enabled: sample(true) } }] }],
    toolchain: { compilerId: 'ghostc', compilerRevision: 'current', runtimeId: 'ghostflow-wasm', runtimeRevision: 'current', abiVersion: 1 },
  };
  change(value);
  value.source.sha256 = digest(value.source.text);
  value.bundleSha256 = digest(canonicalLessonJson(value));
  return JSON.stringify(value);
}
const frameChange = change => bundle(value => change(value.scenarios[0].frames[0]));
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof LessonBundleError && error.code === code);

test('lesson samples preserve explicit observations, omitted fields, canonical digests and deep freezing', async () => {
  const json = bundle(value => value.scenarios[0].frames.push({ atMs: 100, inputs: {} }, { atMs: 200, inputs: {}, samples: {} }));
  const result = await compileLessonBundle(json);
  const frames = result.bundle.scenarios[0].frames;
  assert.deepEqual(frames[0].samples.enabled, sample(true));
  assert.ok(Object.isFrozen(frames[0].samples.enabled));
  assert.equal(Object.hasOwn(frames[1], 'samples'), false);
  assert.deepEqual(frames[2].samples, {});
  assert.deepEqual(result.compilation.manifest.inputs, []);
  assert.deepEqual(result.compilation.manifest.sensors.map(({ name, type }) => ({ name, type })), [{ name: 'enabled', type: 'Bool' }]);
  const tampered = JSON.parse(json);
  tampered.scenarios[0].frames[0].samples.enabled.quality = 'Disconnected';
  await rejects(validateLessonBundle(JSON.stringify(tampered)), 'bundle-digest-mismatch');
  const numericQuality = await validateLessonBundle(frameChange(frame => { frame.samples.enabled.quality = 1; }));
  assert.equal(numericQuality.scenarios[0].frames[0].samples.enabled.quality, 1);
});

test('lesson samples reject unsupported shape, unsafe identity, future time, quality and count boundaries', async () => {
  for (const change of [
    frame => { frame.samples = null; },
    frame => { frame.samples = []; },
    frame => { frame.samples = JSON.parse('{"__proto__":{}}'); },
    frame => { frame.samples = { constructor: sample(true) }; },
    frame => { frame.samples.enabled.quality = 'Healthy'; },
    frame => { frame.samples.enabled.quality = 5; },
    frame => { frame.samples.enabled.value = null; },
    frame => { frame.samples.enabled.value = { ok: true }; },
  ]) await rejects(validateLessonBundle(frameChange(change)), 'invalid-samples');
  for (const change of [
    frame => { frame.samples.enabled.extra = true; },
    frame => { delete frame.samples.enabled.epoch; },
  ]) await rejects(validateLessonBundle(frameChange(change)), 'unknown-or-missing-field');
  for (const change of [
    frame => { frame.samples.enabled.epoch = -1; },
    frame => { frame.samples.enabled.id = Number.MAX_SAFE_INTEGER + 1; },
    frame => { frame.samples.enabled.id = 1.5; },
    frame => { frame.samples.enabled.timestampMs = 1; },
  ]) await rejects(validateLessonBundle(frameChange(change)), 'invalid-integer');
  await rejects(validateLessonBundle(frameChange(frame => {
    frame.samples = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`channel${i}`, sample(false)]));
  })), 'sample-limit');
});

test('compiled lesson frames bind acquisition names and payload categories to the actual manifest', async () => {
  await rejects(compileLessonBundle(frameChange(frame => { frame.inputs.enabled = true; })), 'unknown-input');
  await rejects(compileLessonBundle(frameChange(frame => { frame.samples.unknown = sample(true); })), 'unknown-sample');
  await rejects(compileLessonBundle(frameChange(frame => { frame.samples.enabled.value = 1; })), 'sample-type-mismatch');
  const numberBundle = change => bundle(value => {
    value.source.text = value.source.text.replace('enabled: Bool', 'enabled: Number').replace('enabled |> recover(false)', '(enabled |> recover(0)) > 0');
    value.scenarios[0].frames[0].samples.enabled.value = 1;
    change?.(value.scenarios[0].frames[0]);
  });
  assert.equal((await compileLessonBundle(numberBundle())).compilation.manifest.sensors[0].type, 'Number');
  await rejects(compileLessonBundle(numberBundle(frame => { frame.samples.enabled.value = true; })), 'sample-type-mismatch');
  const noSample = await compileLessonBundle(frameChange(frame => { delete frame.samples; }));
  assert.equal(Object.hasOwn(noSample.bundle.scenarios[0].frames[0], 'samples'), false);
});

test('typed lesson frames execute real WASM fault recovery and deterministic fresh-session replay', async () => {
  const compiled = await compileLessonBundle(bundle(value => {
    value.scenarios[0].frames = [
      { atMs: 0, inputs: {} },
      { atMs: 100, inputs: {}, samples: { enabled: sample(true, 1, 100) } },
      { atMs: 200, inputs: {}, samples: { enabled: sample(true, 2, 200, 'Disconnected') } },
      { atMs: 300, inputs: {}, samples: { enabled: sample(true, 3, 300) } },
      { atMs: 400, inputs: {}, samples: { enabled: sample(false, 4, 400) } },
    ];
  }));
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runs = [];
  for (let run = 0; run < 2; run++) {
    const runtime = await ControlRuntime.instantiateFramed(wasm, artifact(compiled.compilation));
    try {
      runs.push(compiled.bundle.scenarios[0].frames.map(({ atMs, ...observation }, index) => {
        const result = runtime.step({ nowMs: atMs, ...observation });
        assert.equal(result.sensors.enabled.quality, ['NotReady', 'Good', 'Disconnected', 'Good', 'Good'][index]);
        return structuredClone(runtime.lastFrameOutcome);
      }));
    } finally { runtime.dispose(); }
  }
  assert.deepEqual(runs[0].map(row => row.trace.safe.pump), [false, true, false, true, false]);
  assert.deepEqual(runs[0], runs[1]);
});

test('lesson sample values retain runtime ownership of typed numeric invalidity', async () => {
  const compiled = await compileLessonBundle(bundle(value => {
    value.source.text = value.source.text.replace('enabled: Bool', 'enabled: Int').replace('enabled |> recover(false)', '(enabled |> recover(0)) > 0');
    value.scenarios[0].frames[0].samples.enabled.value = 1.5;
  }));
  assert.equal(compiled.bundle.scenarios[0].frames[0].samples.enabled.value, 1.5);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact(compiled.compilation));
  try {
    const { atMs, ...observation } = compiled.bundle.scenarios[0].frames[0];
    const result = runtime.step({ nowMs: atMs, ...observation });
    assert.equal(result.sensors.enabled.quality, 'Invalid');
    assert.equal(runtime.lastFrameOutcome.trace.safe.pump, false);
  } finally { runtime.dispose(); }
});
