import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { compileSource, literateDocument } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const activation = { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// REF-05-014 (#275): these tests verify source/artifact identity and live settings.
// External host run-lifecycle identity remains unverified: context state has no
// runId, and comparing absent properties cannot prove that an execution epoch stays.
const facts = (atMs, settings = null) => ({
  clock: { monotonicMs: atMs, bootEpoch: 1, wallMs: atMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'settings-clock-v1' },
  natural: [], schedules: [], settings,
});

test('an unused setting still has an initial Result and a stable bytecode identity', async () => {
  const source = literateDocument(`// preserve this
control irrigation {
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
  state running: Bool = false;
}`);
  const artifact = await compileSource(source, { filename: 'irrigation.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  const runtime = await ControlRuntime.instantiate(wasm(), artifact, activation);
  try {
    const initial = runtime.contextSnapshot();
    assert.deepEqual(initial.state.settings[0].result, { ok: true, value: 300_000 });
    runtime.step({ nowMs: 0, contextFacts: facts(0, {
      programFingerprint: initial.state.programFingerprint, eventId: 'duration-10m',
      baseRevision: 0, position: 1, origin: 'operatorEdit',
      changes: [{ configId: artifact.manifest.configs[0].id,
        result: { ok: true, type: 'Duration', value: 600_000 } }],
    }) });
    assert.deepEqual(runtime.contextSnapshot().state.settings[0].result, { ok: true, value: 600_000 });
    assert.equal(artifact.manifest.bytecodeSha256, runtime.manifest.bytecodeSha256);
    assert.equal(artifact.sourceDocument.text, source);
  } finally { runtime.dispose(); }
});

test('ordinary Duration consumer reads the current Result in the same artifact', async () => {
  const source = literateDocument(`control SettingsEffect {
    config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
    output duration_ms: Duration;
    duration_ms <- case duration { ok(value) => value; fault(_) => 0ms; };
  }`);
  const artifact = await compileSource(source, { filename: 'settings-effect.ghost.md' });
  const originalBytes = Uint8Array.from(artifact.bytes);
  const originalBytecodeSha256 = sha256(originalBytes);
  const runtime = await ControlRuntime.instantiate(wasm(), artifact, activation);
  try {
    const initial = runtime.contextSnapshot();
    const fingerprint = initial.state.programFingerprint;
    assert.match(fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(runtime.step({ nowMs: 0, contextFacts: facts(0) }).vm.safe.duration_ms, 300_000);
    const edited = { programFingerprint: fingerprint, eventId: 'duration-10m', baseRevision: 0,
      position: 2, origin: 'operatorEdit', changes: [{ configId: artifact.manifest.configs[0].id,
        result: { ok: true, type: 'Duration', value: 600_000 } }] };
    assert.equal(runtime.step({ nowMs: 1, contextFacts: facts(1, edited) }).vm.safe.duration_ms, 600_000);
    const afterEdit = runtime.contextSnapshot().state;
    assert.equal(artifact.manifest.configs[0].value, 300_000);
    assert.equal(afterEdit.programFingerprint, fingerprint);
    assert.equal(artifact.sourceDocument.text, source);
    assert.equal(artifact.sourceDocument.sha256, sha256(source));
    assert.deepEqual(Uint8Array.from(artifact.bytes), originalBytes);
    assert.equal(artifact.manifest.bytecodeSha256, originalBytecodeSha256);
    assert.equal(runtime.manifest.bytecodeSha256, originalBytecodeSha256);
    assert.equal(afterEdit.settingsRevision, 1);
  } finally { runtime.dispose(); }
});

test('editing a source default is a new source and Program candidate, not a live settings event', async () => {
  const source = defaultValue => `<!-- ghostflow:anchor id=GF-INT-SETTINGS-BOUNDARY kind=intent status=confirmed origin=user -->
Tune watering duration deliberately.

<!-- ghostflow:anchor id=GF-ASSUME-SETTINGS-BOUNDARY kind=assumption status=unconfirmed origin=ai -->
The author must review whether a duration request is permanent or operational.

\`\`\`ghost
control SettingsBoundary {
  // ghostflow:link id=GF-INT-SETTINGS-BOUNDARY relation=implements
  config duration: Duration = ${defaultValue} { min = 1min; max = 20min; step = 1min; access = operator; }
  output duration_ms: Duration;
  duration_ms <- case duration { ok(value) => value; fault(_) => 0ms; };
}
\`\`\`
`;
  const defaultFive = await compileSource(source('5min'), { filename: 'settings-boundary.ghost.md' });
  const defaultTen = await compileSource(source('10min'), { filename: 'settings-boundary.ghost.md' });
  const originalBytes = Uint8Array.from(defaultFive.bytes);
  const originalBytecodeSha256 = sha256(originalBytes);
  assert.notEqual(defaultTen.sourceDocument.sha256, defaultFive.sourceDocument.sha256);
  assert.notEqual(defaultTen.manifest.bytecodeSha256, defaultFive.manifest.bytecodeSha256);
  assert.equal(defaultFive.manifest.configs[0].value, 300_000);
  assert.equal(defaultTen.manifest.configs[0].value, 600_000);
  assert.deepEqual(defaultTen.traceMetadata.intentAnchors.map(anchor => ({ kind: anchor.kind, status: anchor.status })), [
    { kind: 'intent', status: 'confirmed' },
    { kind: 'assumption', status: 'unconfirmed' },
  ]);

  const runtime = await ControlRuntime.instantiate(wasm(), defaultFive, activation);
  try {
    const initial = runtime.contextSnapshot().state;
    assert.match(initial.programFingerprint, /^[0-9a-f]{16}$/);
    runtime.step({ nowMs: 0, contextFacts: facts(0, {
      programFingerprint: initial.programFingerprint,
      eventId: 'duration-10m-live',
      baseRevision: 0,
      position: 1,
      origin: 'operatorEdit',
      changes: [{
        configId: defaultFive.manifest.configs[0].id,
        result: { ok: true, type: 'Duration', value: 600_000 },
      }],
    }) });
    const afterLiveEdit = runtime.contextSnapshot().state;
    assert.equal(afterLiveEdit.programFingerprint, initial.programFingerprint);
    assert.equal(defaultFive.sourceDocument.text, source('5min'));
    assert.equal(defaultFive.sourceDocument.sha256, sha256(source('5min')));
    assert.deepEqual(Uint8Array.from(defaultFive.bytes), originalBytes);
    assert.equal(defaultFive.manifest.bytecodeSha256, originalBytecodeSha256);
    assert.equal(afterLiveEdit.settingsRevision, 1);
    assert.equal(defaultFive.manifest.bytecodeSha256, runtime.manifest.bytecodeSha256);
    assert.equal(defaultFive.manifest.configs[0].value, 300_000);
    assert.deepEqual(afterLiveEdit.settings[0].result, { ok: true, value: 600_000 });
  } finally { runtime.dispose(); }
});

test('Bool setting emits success and fault on one stream without numeric bounds or last-good', async () => {
  const source = literateDocument(`control BoolSettings {
    config enabled: Bool = false { access = operator; label = "사용"; }
    output value: Bool;
    value <- case enabled { ok(current) => current; fault(_) => false; };
  }`);
  const artifact = await compileSource(source, { filename: 'bool-settings.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm(), artifact, activation);
  try {
    const fingerprint = runtime.contextSnapshot().state.programFingerprint;
    const configId = artifact.manifest.configs[0].id;
    const edit = (position, eventId, result, origin = 'operatorEdit') => ({
      programFingerprint: fingerprint, eventId, baseRevision: position - 2, position,
      origin, changes: [{ configId, result }],
    });
    assert.equal(runtime.step({ nowMs: 0, contextFacts: facts(0) }).vm.safe.value, false);
    assert.equal(runtime.step({ nowMs: 1, contextFacts: facts(1,
      edit(2, 'bool-on', { ok: true, type: 'Bool', value: true })) }).vm.safe.value, true);
    assert.equal(runtime.step({ nowMs: 2, contextFacts: facts(2,
      edit(3, 'bool-fault', { ok: false, fault: 'SettingsUnavailable' }, 'producerObservation')) }).vm.safe.value, false);
    assert.deepEqual(runtime.contextSnapshot().state.settings[0].result,
      { ok: false, fault: 'SettingsUnavailable' });
  } finally { runtime.dispose(); }
});

test('compiler rejects invalid setting declarations before activation', async () => {
  const declaration = (initial, settings) => `control InvalidSettings {
    config level: Number = ${initial} { ${settings} }
    output value: Number;
    value <- case level { ok(current) => current; fault(_) => 0; };
  }`;
  for (const [initial, settings, message] of [
    ['1 + 1', 'min = 0; max = 10; step = 1; access = operator;', /supported literal/],
    ['5', 'min = 0; max = 4; step = 1; access = operator;', /outside settings range/],
    ['5', 'min = 0; max = 10; step = 3; access = operator;', /not aligned/],
    ['5', 'min = -10; max = 10; step = 1; access = operator; label = "";', /label must be 1 to 128/],
  ]) await assert.rejects(() => compileSource(declaration(initial, settings), { filename: 'invalid-settings.ghost' }), message);
});
