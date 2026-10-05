import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import {
  CURRICULUM_REPLAY_IDS,
  prepareCurriculumReplays,
  readCurriculumReplayManifest,
  verifyCurriculumReplayWasm,
  captureCurriculumReplayAcquisition,
} from '../tools/curriculum-replay.mjs';
import {
  derivePc01Projection,
  PC01_DOCUMENT,
  PC01_PROJECTION,
  verifyPc01Projection,
} from '../tools/generate-pc-01-projection.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const wasmBytes = fs.readFileSync(wasmPath);

test('recorded healthy Bool frames acquire quality samples without mutating history and expose the same native rails', async t => {
  const artifact = await compileSource('# New explicit input fixture\n\n```ghost\ncontrol Observation { input request: Bool; signal latest = hold_last(request, for_at_most: 1s, quality: measured); output enabled: Bool; enabled <- latest |> recover(true); }\n```\n', { filename: 'fixture.ghost.md' });
  const scenario = { id: 'EXPLICIT-FIXTURE', frames: [
    { atMs: 0, inputs: { request: false } }, { atMs: 3000, inputs: { request: true } },
    { atMs: 6000, inputs: { request: false } },
  ] };
  const retained = structuredClone(scenario);
  const entry = { scenario, artifact, outputNames: ['enabled'], checkpoints: new Map([
    [0, { requested: { enabled: false }, safe: { enabled: false } }],
    [1, { requested: { enabled: true }, safe: { enabled: true } }],
    [2, { requested: { enabled: false }, safe: { enabled: false } }],
  ]) };
  const result = await verifyCurriculumReplayWasm(wasmBytes, { prepared: { scenarios: [entry] } });
  assert.equal(result.legacy.checkpoints, 3); assert.equal(result.framed.checkpoints, 3);
  const accepted = await captureCurriculumReplayAcquisition(wasmBytes, entry);
  assert.deepEqual(scenario, retained);
  for (const [index, frame] of accepted.entries()) {
    assert.equal(frame.inputs.__gf_sensor_ok_request, true);
    assert.equal(frame.inputs.__gf_sensor_value_request, scenario.frames[index].inputs.request);
    assert.equal(frame.inputs.__gf_sensor_fault_request, 0);
    assert.equal(frame.inputs.__gf_sensor_sample_epoch_request, 1);
    assert.equal(frame.inputs.__gf_sensor_sample_id_request, index + 1);
    assert.equal(frame.inputs.__gf_sensor_sample_timestamp_request, scenario.frames[index].atMs);
    assert.equal(frame.safe.enabled, scenario.frames[index].inputs.request);
    assert.equal(Object.hasOwn(frame.inputs, 'request'), false);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-curriculum-quality-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'fixture.gfb'), tapePath = path.join(directory, 'fixture.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  const names = Object.keys(accepted[0].inputs);
  fs.writeFileSync(tapePath, `${names.join(',')}\n${accepted.map(frame => names.map(name => frame.inputs[name]).join(',')).join('\n')}\n`);
  const runner = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
  const native = execFileSync(runner, [modulePath, tapePath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
  for (const [index, outcome] of native.entries()) {
    assert.equal(outcome.status, 'OK');
    assert.deepEqual(outcome.trace.requested, accepted[index].requested);
    assert.deepEqual(outcome.trace.safe, accepted[index].safe);
  }
});

test('PC-01 generated projection exactly follows the canonical book E01', () => {
  const document = fs.readFileSync(new URL(`../${PC01_DOCUMENT}`, import.meta.url), 'utf8');
  const projection = fs.readFileSync(new URL(`../${PC01_PROJECTION}`, import.meta.url), 'utf8');
  assert.equal(projection, derivePc01Projection(document));
  assert.notEqual(projection, derivePc01Projection(`${document}\n`), 'a book revision requires regeneration');
  assert.match(projection, /The book remains the only canonical source\./);
  assert.doesNotThrow(() => verifyPc01Projection());
});

test('PC-01 projection verifier fails after an unregenerated canonical book revision', () => {
  const document = fs.readFileSync(new URL(`../${PC01_DOCUMENT}`, import.meta.url), 'utf8');
  const projection = fs.readFileSync(new URL(`../${PC01_PROJECTION}`, import.meta.url), 'utf8');
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-pc01-stale-'));
  try {
    fs.mkdirSync(path.join(repositoryRoot, 'docs'));
    fs.mkdirSync(path.join(repositoryRoot, 'examples/curriculum/generated'), { recursive: true });
    fs.writeFileSync(path.join(repositoryRoot, PC01_DOCUMENT), `${document}\n`);
    fs.writeFileSync(path.join(repositoryRoot, PC01_PROJECTION), projection);
    assert.throws(() => verifyPc01Projection({ repositoryRoot }), /stale generated PC-01 projection/);
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true });
  }
});

test('all ten canonical curriculum sources emit a source-identified interaction schema with declared-state provenance', async () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../examples/curriculum/catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.lessons.length, 10);
  for (const lesson of catalog.lessons) {
    const relative = lesson.id === 'PC-01' ? lesson.source.generatedPath : lesson.source.path;
    const compilation = await compileSource(fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'), {
      filename: relative,
      interactionSourceIdentity: {
        documentId: `curriculum.${lesson.id.toLowerCase()}`,
        revisionId: 'revision.curriculum-intent-anchors-v1',
      },
    });
    assert.equal(compilation.interactionSchema.source.documentId, `curriculum.${lesson.id.toLowerCase()}`);
    for (const descriptor of compilation.interactionSchema.descriptors) {
      assert.ok(descriptor.provenance.intentAnchorIds.length > 0, `${lesson.id} ${descriptor.id} has intent provenance`);
    }
  }
});

test('six replay scenarios bind exact sources, semantic Bool ports, and complete monotonic frames', async () => {
  const prepared = await prepareCurriculumReplays();
  assert.deepEqual(prepared.scenarios.map(entry => entry.scenario.id), CURRICULUM_REPLAY_IDS);
  assert.equal(prepared.scenarios.reduce((count, entry) => count + entry.scenario.frames.length, 0), 40);
  assert.equal(prepared.scenarios.reduce((count, entry) => count + entry.scenario.checkpoints.length, 0), 31);
});

test('replay verification rejects stale source identity and mismatched semantic names', async () => {
  const stale = structuredClone(readCurriculumReplayManifest());
  stale.scenarios[1].source.canonicalSha256 = '0'.repeat(64);
  await assert.rejects(() => prepareCurriculumReplays({ manifest: stale }), /catalog|SHA-256/);

  const renamed = structuredClone(readCurriculumReplayManifest());
  renamed.scenarios[2].inputs[0] = 'renamed_start';
  await assert.rejects(() => prepareCurriculumReplays({ manifest: renamed }), /compiled control manifest/);
});

test('replay verification rejects incomplete Bool frames and non-increasing virtual time', async () => {
  const incomplete = structuredClone(readCurriculumReplayManifest());
  delete incomplete.scenarios[3].frames[0].inputs.close_limit;
  await assert.rejects(() => prepareCurriculumReplays({ manifest: incomplete }), /must contain exactly/);

  const reversed = structuredClone(readCurriculumReplayManifest());
  reversed.scenarios[4].frames[1].atMs = reversed.scenarios[4].frames[0].atMs;
  await assert.rejects(() => prepareCurriculumReplays({ manifest: reversed }), /strictly increasing virtual time/);
});

test('actual host simulation and framed WASM traces match every replay checkpoint', async () => {
  const result = await verifyCurriculumReplayWasm(wasmBytes);
  assert.deepEqual(result.legacy, { runtime: 'host-simulation', scenarios: 6, frames: 40, checkpoints: 31 });
  assert.deepEqual(result.framed, { runtime: 'framed-wasm', scenarios: 6, frames: 40, checkpoints: 31 });
});

test('actual runtime verification rejects a stale expected trace', async () => {
  const replay = structuredClone(readCurriculumReplayManifest());
  replay.scenarios[0].checkpoints[1].safe.lamp = false;
  await assert.rejects(() => verifyCurriculumReplayWasm(wasmBytes, { manifest: replay }), /expected false, got true/);
});
