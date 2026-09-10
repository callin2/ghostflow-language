import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalLessonJson, LessonBundleError, validateLessonBundle } from '../tools/lesson.mjs';

const encoder = new TextEncoder();

function digest(text) {
  return createHash('sha256').update(encoder.encode(text)).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validBundle() {
  const source = '# Boundary lesson\n\n```ghost\ncontrol Boundary {\n  input enabled: Bool;\n  output pump: Bool;\n  pump <- enabled;\n}\n```\n';
  const bundle = {
    format: 'ghostflow-lesson-v1', lessonId: 'boundary', revision: 'r1', title: 'Boundary lesson', locale: 'en',
    source: { text: source, sha256: digest(source), mediaType: 'text/markdown; profile=ghostflow-literate' },
    playback: { durationMs: 60_000, checkpoints: [{ atMs: 1_000, sourceSpan: { startLine: 4, endLine: 8 }, narration: 'Run the boundary lesson.', scenarioId: 'main' }] },
    scenarios: [{ id: 'main', title: 'Main', frames: [{ atMs: 0, inputs: { enabled: true } }, { atMs: 30_000, inputs: { enabled: false } }] }],
    toolchain: { compilerId: 'ghostc', compilerRevision: 'r1', runtimeId: 'ghostflow-wasm', runtimeRevision: 'r1', abiVersion: 1 },
  };
  return bundle;
}

function finalized(bundle) {
  const result = clone(bundle);
  result.source.sha256 = digest(result.source.text);
  delete result.bundleSha256;
  result.bundleSha256 = digest(canonicalLessonJson(result));
  return JSON.stringify(result);
}

async function expectCode(jsonText, code) {
  await assert.rejects(validateLessonBundle(jsonText), error => error instanceof LessonBundleError && error.code === code);
}

test('rejects unsupported fields at the bundle and nested frame boundaries', async () => {
  const topLevel = validBundle();
  topLevel.unsupported = true;
  await expectCode(finalized(topLevel), 'unknown-or-missing-field');

  const nested = validBundle();
  nested.scenarios[0].frames[0].extra = true;
  await expectCode(finalized(nested), 'unknown-or-missing-field');
});

test('enforces raw JSON and exact UTF-8 source limits', async () => {
  const oversizedJson = `${finalized(validBundle())}${' '.repeat(1024 * 1024)}`;
  await expectCode(oversizedJson, 'raw-json-limit');

  const oversizedSource = validBundle();
  oversizedSource.source.text = '가'.repeat(21_846);
  await expectCode(finalized(oversizedSource), 'source-limit');
});

test('rejects duplicate IDs and every aggregate count boundary', async () => {
  const duplicate = validBundle();
  duplicate.scenarios.push(clone(duplicate.scenarios[0]));
  await expectCode(finalized(duplicate), 'duplicate-id');

  const tooManyCheckpoints = validBundle();
  tooManyCheckpoints.playback.checkpoints = Array.from({ length: 257 }, (_, index) => ({
    atMs: index + 1, sourceSpan: { startLine: 4, endLine: 8 }, narration: 'n', scenarioId: 'main',
  }));
  await expectCode(finalized(tooManyCheckpoints), 'checkpoint-limit');

  const tooManyScenarios = validBundle();
  tooManyScenarios.scenarios = Array.from({ length: 17 }, (_, index) => ({
    id: `scenario${index}`, title: 'Scenario', frames: [{ atMs: 0, inputs: { enabled: true } }],
  }));
  await expectCode(finalized(tooManyScenarios), 'scenario-limit');

  const tooManyFrames = validBundle();
  tooManyFrames.scenarios[0].frames = Array.from({ length: 1_025 }, (_, index) => ({ atMs: index, inputs: {} }));
  await expectCode(finalized(tooManyFrames), 'frame-limit');

  const tooManyTotalFrames = validBundle();
  tooManyTotalFrames.scenarios = Array.from({ length: 16 }, (_, scenarioIndex) => ({
    id: `scenario${scenarioIndex}`, title: 'Scenario',
    frames: Array.from({ length: 257 }, (_, frameIndex) => ({ atMs: frameIndex, inputs: {} })),
  }));
  await expectCode(finalized(tooManyTotalFrames), 'frame-limit');
});

test('rejects nested input values and unsafe numeric narration/scenario times', async () => {
  const nestedInput = validBundle();
  nestedInput.scenarios[0].frames[0].inputs.enabled = { value: true };
  await expectCode(finalized(nestedInput), 'invalid-inputs');

  for (const mutate of [
    bundle => { bundle.playback.durationMs = Number.MAX_SAFE_INTEGER + 1; },
    bundle => { bundle.playback.checkpoints[0].atMs = Number.MAX_SAFE_INTEGER + 1; },
    bundle => { bundle.scenarios[0].frames[0].atMs = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    await expectCode(finalized((() => { const bundle = validBundle(); mutate(bundle); return bundle; })()), 'invalid-integer');
  }
});

test('canonicalization sorts object keys but preserves array order', () => {
  const first = canonicalLessonJson({ z: 1, a: [{ b: 2, a: 3 }, 'first'], m: true });
  const reorderedKeys = canonicalLessonJson({ m: true, z: 1, a: [{ a: 3, b: 2 }, 'first'] });
  const reorderedArray = canonicalLessonJson({ m: true, z: 1, a: ['first', { a: 3, b: 2 }] });

  assert.equal(first, '{"a":[{"a":3,"b":2},"first"],"m":true,"z":1}');
  assert.equal(reorderedKeys, first);
  assert.notEqual(reorderedArray, first);
});
