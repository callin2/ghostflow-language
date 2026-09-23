import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileSource, verifyArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const clone = value => structuredClone(value);
const basicSource = '# Coverage defensive\n\n```ghost\ncontrol CoverageDefensive {\n  input enabled: Bool;\n  output active: Bool;\n  active <- enabled;\n}\n```\n';
const sensorSource = '# Coverage sensor\n\n```ghost\ncontrol CoverageSensor {\n  sensor moisture?: Percent { sample = 1s; valid = 0% .. 100%; filter = median(5); stale_after = 3s; recover_after = 3 samples; }\n  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);\n  output active: Bool;\n  active <- case dry { ok(value) => value; fault(_) => false; };\n}\n```\n';

async function rejectManifest(artifact, mutate, diagnostic) {
  const manifest = clone(artifact.manifest);
  mutate(manifest);
  await assert.rejects(ControlRuntime.instantiate(wasm, { ...artifact, manifest }), diagnostic);
}

test('runtime covers defensive schedule, timer, sensor, and hysteresis validation', async () => {
  const basic = await compileSource(basicSource, { filename: 'coverage-defensive.ghost.md' });
  for (const [mutate, diagnostic] of [
    [m => { m.name = ''; }, /manifest.name/],
    [m => { m.name = '1bad'; }, /not an identifier/],
    [m => { m.schedules = [{}]; }, /schedule/],
    [m => { m.schedules = [{ name: 's', timezone: 'No/Such', slots: [], dueInput: '__gf_schedule_due_s' }]; }, /timezone/],
    [m => { m.schedules = [{ name: 's', timezone: 'UTC', slots: [1], dueInput: '__gf_schedule_due_s' }]; }, /15-minute/],
    [m => { m.schedules = [{ name: 's', timezone: 'UTC', slots: [0, 0], dueInput: '__gf_schedule_due_s' }]; }, /duplicate/],
    [m => { m.timers = [{ name: 't', state: 'x', clockInput: '__gf_bad' }]; }, /clockInput/],
    [m => { m.timers = [{ name: 't', mode: 'bad', clockInput: '__gf_now_ms' }]; }, /unsupported mode/],
    [m => { m.timers = [{ name: 't', state: 'bad-state', clockInput: '__gf_now_ms' }]; }, /identifier/],
    [m => { m.configs = [{ name: 'c', type: 'Nope', value: false }]; }, /unsupported type/],
    [m => { m.configs = [{ name: 'c', type: 'Bool', value: 1 }]; }, /must be boolean/],
    [m => { m.configs = [{ name: 'c', type: 'Bool', value: false, settings: {} }]; }, /unknown key|cannot contain/],
  ]) await rejectManifest(basic, mutate, diagnostic);

  const sensor = await compileSource(sensorSource, { filename: 'coverage-sensor.ghost.md' });
  for (const [mutate, diagnostic] of [
    [m => { m.sensors[0].sampleMs = 0; }, /sampleMs/],
    [m => { m.sensors[0].staleMs = 0; }, /staleMs/],
    [m => { m.sensors[0].recoverSamples = 0; }, /recoverSamples/],
    [m => { m.sensors[0].filter = 'bad'; }, /unsupported filter/],
    [m => { m.sensors[0].window = 4; }, /odd/],
    [m => { m.sensors[0].window = null; }, /requires a window/],
    [m => { m.sensors[0].filter = null; }, /requires a filter/],
    [m => { m.sensors[0].validMin = null; }, /valid range/],
    [m => { m.sensors[0].validMin = 90; m.sensors[0].validMax = 10; }, /inverted/],
    [m => { m.sensors[0].valueInput = 'forged'; }, /must be __gf_sensor_value/],
    [m => { m.sensors[0].optional = 'yes'; }, /optional/],
    [m => { m.sensors[0].filter = 'ema'; m.sensors[0].window = 1; }, /alpha is required/],
    [m => { m.sensors[0].filter = 'ema'; m.sensors[0].window = 1; m.sensors[0].alpha = 0; }, /alpha must be/],
    [m => { m.sensors[0].filter = 'ema'; m.sensors[0].window = 1; m.sensors[0].alpha = 2; }, /alpha must be/],
    [m => { m.sensors[0].validMin = -1; }, /validMin must be/],
    [m => { m.sensors[0].validMax = 101; }, /validMax must be/],
    [m => { m.signals[0].onBelow = 40; m.signals[0].offAbove = 30; }, /hysteresis/],
    [m => { m.signals[0].sensor = 'missing'; }, /unknown sensor/],
    [m => { m.signals[0].initial = 1; }, /initial/],
    [m => { m.signals[0].valueInput = 'forged'; }, /must be __gf_signal_value/],
  ]) await rejectManifest(sensor, mutate, diagnostic);
});

test('source-map validation covers malformed identity and byte inputs', async () => {
  const artifact = await compileSource(basicSource, { filename: 'coverage-map.ghost.md' });
  const base = { format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256, sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap, traceMetadata: artifact.traceMetadata };
  for (const [mutate, diagnostic] of [
    [m => { m.sourceDocument.kind = 'raw'; }, /kind/],
    [m => { m.sourceDocument.filename = '\0'; }, /filename/],
    [m => { m.sourceDocument.sha256 = 'A'.repeat(64); }, /lowercase/],
    [m => { m.sourceDocument.sha256 = '0'.repeat(64); }, /does not match text/],
    [m => { m.bytecodeSha256 = 'A'.repeat(64); }, /lowercase/],
    [m => { m.interactionSchema = {}; }, /persisted together/],
    [m => { m.interactionSourceIdentity = {}; }, /persisted together/],
  ]) { const map = clone(base); mutate(map); assert.throws(() => verifyArtifactSourceMap(map, artifact.bytes), diagnostic); }
  assert.throws(() => verifyArtifactSourceMap(base, new Uint8Array([1, 2, 3])), /does not match artifact/);
  assert.throws(() => verifyArtifactSourceMap(base, 'bytes'), /Buffer or Uint8Array/);
  const badClosure = clone(base); badClosure.sourceClosure = {};
  assert.throws(() => verifyArtifactSourceMap(badClosure, artifact.bytes), /source closure format/);
  const badClosureDocuments = clone(base); badClosureDocuments.sourceClosure = { format: 'GhostFlow/source-closure-v1', documents: [] };
  assert.throws(() => verifyArtifactSourceMap(badClosureDocuments, artifact.bytes), /canonical source closure|source closure|canonical JSON/);
});

test('artifact writer persists the validated bytecode, manifest, and source map', async () => {
  const artifact = await compileSource(basicSource, { filename: 'coverage-writer.ghost.md' });
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'build', 'coverage-writer-'));
  const output = path.join(directory, 'program.gfb');
  try {
    writeArtifact(artifact, output);
    assert.equal(fs.existsSync(output), true);
    assert.equal(fs.existsSync(`${output}.manifest.json`), true);
    assert.equal(fs.existsSync(`${output}.map.json`), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime covers true-for descriptor validation failures', async () => {
  const text = fs.readFileSync(new URL('./fixtures/true-for-certified.ghost.md', import.meta.url), 'utf8');
  const artifact = await compileSource(text, { filename: 'true-for-defensive.ghost.md' });
  for (const [mutate, diagnostic] of [
    [m => { m.signals[0].site = 0; }, /site/],
    [m => { m.signals[0].slot = 1; }, /slot/],
    [m => { m.signals[0].payloadType = 'Number'; }, /requires Bool/],
    [m => { m.signals[0].durationMs = 0; }, /durationMs/],
    [m => { m.signals[0].sources = []; }, /exactly one/],
    [m => { m.signals[0].sources[0].tag = 0; }, /tag/],
    [m => { m.signals[0].intervalInputs = null; }, /intervalInputs/],
    [m => { m.signals[0].intervalInputs.value = 'forged'; }, /must be __gf_interval_value/],
  ]) await rejectManifest(artifact, mutate, diagnostic);
});
