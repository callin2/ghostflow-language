import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import {
  CURRICULUM_REPLAY_IDS,
  prepareCurriculumReplays,
  readCurriculumReplayManifest,
  verifyCurriculumReplayWasm,
} from '../tools/curriculum-replay.mjs';
import {
  derivePc01Projection,
  PC01_DOCUMENT,
  PC01_PROJECTION,
  verifyPc01Projection,
} from '../tools/generate-pc-01-projection.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const wasmBytes = fs.readFileSync(wasmPath);

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
