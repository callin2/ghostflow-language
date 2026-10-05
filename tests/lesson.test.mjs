import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalLessonJson, compileLessonBundle, LessonBundleError, validateLessonBundle } from '../tools/lesson.mjs';

const encoder = new TextEncoder();

async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function bundleJson(change = value => value) {
  const source = [
    '# Pump lesson',
    '',
    '```ghost',
    'control LessonPump {',
    '  input enabled: Bool;',
    '  output pump: Bool;',
    '  pump <- enabled |> recover(false);',
    '}',
    '```',
  ].join('\n');
  const bundle = {
    format: 'ghostflow-lesson-v1', lessonId: 'pump-basics', revision: 'input-v1', title: 'Pump basics', locale: 'en',
    source: { text: source, sha256: await digest(source), mediaType: 'text/markdown; profile=ghostflow-literate' },
    playback: { durationMs: 60_000, checkpoints: [{ atMs: 10_000, sourceSpan: { startLine: 4, endLine: 8 }, narration: 'Connect input to output.', scenarioId: 'enabled' }] },
    scenarios: [{ id: 'enabled', title: 'Enabled pump', frames: [{ atMs: 0, inputs: { enabled: true } }, { atMs: 30_000, inputs: { enabled: false } }] }],
    toolchain: { compilerId: 'ghostc', compilerRevision: 'r1', runtimeId: 'ghostflow-wasm', runtimeRevision: 'r1', abiVersion: 1 },
  };
  await change(bundle);
  bundle.source.sha256 = await digest(bundle.source.text);
  bundle.bundleSha256 = await digest(canonicalLessonJson(bundle));
  return JSON.stringify(bundle);
}

async function expectsError(promise, code) {
  await assert.rejects(promise, error => error instanceof LessonBundleError && error.code === code);
}

test('validates and compiles a detached GhostFlow literate lesson bundle', async () => {
  const result = await compileLessonBundle(await bundleJson());
  assert.equal(result.bundle.lessonId, 'pump-basics');
  assert.equal(result.bundle.source.text.includes('control LessonPump'), true);
  assert.equal(Object.isFrozen(result.bundle), true);
  assert.equal(result.extraction.code.includes('control LessonPump'), true);
  assert.equal(result.compilation.manifest.name, 'LessonPump');
});

test('rejects bundle and source digest tampering plus unsupported versions', async () => {
  const valid = await bundleJson();
  const sourceTampered = JSON.parse(valid);
  sourceTampered.source.text += '\n';
  await expectsError(validateLessonBundle(JSON.stringify(sourceTampered)), 'source-digest-mismatch');

  const bundleTampered = JSON.parse(valid);
  bundleTampered.title = 'Tampered title';
  await expectsError(validateLessonBundle(JSON.stringify(bundleTampered)), 'bundle-digest-mismatch');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.format = 'ghostflow-lesson-v2'; })), 'unsupported-format');
});

test('rejects invalid spans, scenario references, ordering, and declared limits', async () => {
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.playback.checkpoints[0].sourceSpan.endLine = 99; })), 'invalid-integer');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.playback.checkpoints[0].scenarioId = 'missing'; })), 'missing-scenario');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.scenarios[0].frames.push({ atMs: 0, inputs: {} }); })), 'invalid-order');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.playback.durationMs = 600_001; })), 'invalid-integer');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.playback.checkpoints[0].narration = 'x'.repeat(4097); })), 'invalid-string');
  await expectsError(validateLessonBundle(await bundleJson(bundle => {
    bundle.scenarios[0].frames[0].inputs = JSON.parse('{"__proto__":true}');
  })), 'invalid-inputs');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.playback.checkpoints = []; })), 'checkpoint-limit');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.scenarios = []; })), 'scenario-limit');
  await expectsError(validateLessonBundle(await bundleJson(bundle => { bundle.scenarios[0].frames = []; })), 'frame-limit');
  await expectsError(validateLessonBundle(await bundleJson(bundle => {
    bundle.scenarios[0].frames[0].inputs = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`input${index}`, true]));
  })), 'input-limit');
});

test('accepts independently-clocked scenario frames beyond the narration duration', async () => {
  const result = await validateLessonBundle(await bundleJson(bundle => {
    bundle.playback.durationMs = 100;
    bundle.playback.checkpoints[0].atMs = 100;
    bundle.scenarios[0].frames[1].atMs = 1_000;
  }));
  assert.equal(result.playback.durationMs, 100);
  assert.equal(result.scenarios[0].frames[1].atMs, 1_000);
});

test('remaps compiler errors to their original Markdown source location', async () => {
  await assert.rejects(
    compileLessonBundle(await bundleJson(bundle => {
      bundle.source.text = bundle.source.text.replace('pump <- enabled |> recover(false);', 'pump <- ;');
    })),
    error => error.line === 7 && error.column === 11 && error.filename === 'pump-basics@input-v1.ghost.md',
  );
});

test('preserves original CRLF source bytes for hashing and rejects ignored nested ghost fences', async () => {
  const crlf = await bundleJson(bundle => { bundle.source.text = bundle.source.text.replaceAll('\n', '\r\n'); });
  const validated = await validateLessonBundle(crlf);
  assert.equal(validated.source.text.includes('\r\n'), true);
  assert.equal((await compileLessonBundle(crlf)).compilation.manifest.name, 'LessonPump');

  await expectsError(compileLessonBundle(await bundleJson(bundle => {
    bundle.source.text = [
      '- Ignored nested block:',
      '  ```ghost',
      '  control Ignored {}',
      '  ```',
      '',
      bundle.source.text,
    ].join('\n');
  })), 'literate-warnings');
});

test('counts bare CR source lines when validating lesson checkpoint spans', async () => {
  const bareCr = await bundleJson(bundle => { bundle.source.text = bundle.source.text.replaceAll('\n', '\r'); });
  const validated = await validateLessonBundle(bareCr);
  assert.equal(validated.playback.checkpoints[0].sourceSpan.endLine, 8);
  assert.equal(validated.source.text.includes('\r'), true);
});

test('uses browser globals when Buffer is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: undefined });
  try {
    const result = await compileLessonBundle(await bundleJson());
    assert.equal(result.compilation.manifest.name, 'LessonPump');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Buffer', descriptor);
    else delete globalThis.Buffer;
  }
});
