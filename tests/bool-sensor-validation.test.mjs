import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileEvidence, projectSource, theoremInput, admissionInput } from '../experiments/bool-sensor-validation/bridge.mjs';
import { verify } from '../experiments/bool-sensor-validation/verify.mjs';
import { sourceTheoremInput, sourceAdmissionInput } from '../experiments/bool-sensor-validation/source-bridge.mjs';
import { sourceVariants } from '../experiments/bool-sensor-validation/source-cases.mjs';

const filename = 'experiments/bool-sensor-validation/fixtures/recover-false.ghost.md';
const source = () => readFile(new URL(`../${filename}`, import.meta.url), 'utf8');

test('original sensor source bytes independently bind parsed identities and observation', async () => {
  const bytes = await readFile(new URL(`../${filename}`, import.meta.url));
  const evidence = compileEvidence(bytes.toString('utf8'), filename);
  const certificate = sourceTheoremInput(evidence, bytes);
  assert.ok(certificate.includes(`def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...bytes])}`));
  assert.match(certificate, /SensorSourceReader.readSource originalSourceBytes = some parsedSource := by decide/);
  assert.match(certificate, /SensorSourceReader.readSource_ids originalSourceBytes parsedSource exactSourceRead/);
  assert.match(certificate, /actualMetadata = SensorSourceReader.metadataOf parsedSource := by decide/);
  assert.match(certificate, /originalSourceObservedExecution \(ops : NumberOps N\) \(laws : SmallNumberLaws ops\)/);
  const changed = structuredClone(evidence);
  changed.source = { text: 'untrusted replacement' };
  changed.decoded = new Proxy({}, { get() { throw new Error('untrusted decoded metadata'); } });
  assert.equal(sourceTheoremInput(changed, bytes), certificate);
  assert.notEqual(sourceTheoremInput(evidence, Buffer.from(bytes.toString().replace('recover(false)', 'recover(true)'))), certificate);
  assert.doesNotMatch(sourceAdmissionInput([0xc0, 0xaf], false), /sourceProfile|actualMetadata/);
});

test('renames and trivia preserve production sensor shape and source node construction order', async () => {
  const original = await source();
  const expected = compileEvidence(original, filename);
  for (const [name, mutate] of sourceVariants) {
    const changed = mutate(original);
    const evidence = compileEvidence(changed, filename);
    assert.deepEqual([evidence.projection.origin, evidence.projection.site], [1, 5], name);
    if (name === 'trivia') {
      assert.deepEqual(evidence.bytes, expected.bytes);
      assert.deepEqual(evidence.metadata, expected.metadata);
    }
  }
});

test('canonical Bool recovery emits actual quality rails and binds Result source identities', async () => {
  const evidence = compileEvidence(await source(), filename);
  assert.deepEqual(evidence.projection, { name: 'BoolSensorRecover', sensor: 'di', output: 'output_bit', origin: 1, site: 5 });
  assert.deepEqual(evidence.bytes.slice(0, 6), [71, 70, 66, 49, 3, 0]);
  assert.deepEqual(evidence.metadata.sites, [{ site: 5, nodeId: 5, kind: 'recover', errorType: 'SensorFault',
    origins: [{ tag: 1, nodeId: 1, kind: 'sensor', name: 'di' }] }]);
  const input = theoremInput(evidence);
  evidence.decoded = new Proxy({}, { get() { throw new Error('untrusted decoder read'); } });
  assert.equal(theoremInput(evidence), input);
  assert.match(input, /SmallNumberLaws ops/);
  assert.match(input, /runModule ops artifactBytes \(rails ops reading stalePayload\)/);
  assert.match(input, /actualMetadata = expectedMetadata sourceProfile := by decide/);
  assert.doesNotMatch(input, /\b(sorry|admit|axiom|native_decide)\b|artifactBytes\.drop/);
  assert.doesNotMatch(admissionInput(evidence.bytes), /sourceProfile|actualMetadata/);
});

test('sensor subprofile refuses unproved source shapes without weakening existing Bool admission', async () => {
  const text = await source();
  for (const changed of [
    text.replace('recover(false)', 'recover(true)'),
    text.replace('input di: Bool;', 'input di?: Bool;'),
    text.replace('input di: Bool;', 'input di: Bool { stale_after = 1s; }'),
    text.replace('input di: Bool;', 'input di: Bool; state held: Bool = false;'),
    text.replace('input di: Bool;', 'input di: Number;'),
  ]) assert.throws(() => projectSource(changed, filename));
  const { projectSource: oldProject } = await import('../experiments/bool-translation-validation/bridge.mjs');
  assert.throws(() => oldProject(text, filename), /unsupported source declaration sensor/);
});

test('raw and metadata changes reach different kernel obligations', async () => {
  const evidence = compileEvidence(await source(), filename), original = theoremInput(evidence);
  const changed = structuredClone(evidence);
  changed.metadata.sites[0].origins[0].tag = 2;
  assert.notEqual(theoremInput(changed), original);
  changed.bytes[changed.bytes.length - 6] = 6;
  assert.notEqual(admissionInput(changed.bytes), admissionInput(evidence.bytes));
  changed.projection.site = 6;
  assert.throws(() => theoremInput(changed), /source node assignment/);
});

test('failed sensor proof verification replaces a previous success report', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sensor-proof-failure-'));
  try {
    await writeFile(join(evidenceDir, 'verification.json'), JSON.stringify({ status: 'passed', stale: true }));
    await assert.rejects(verify({ lean: join(evidenceDir, 'missing-lean'), evidenceDir }), /Lean version check failed/);
    const report = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.stale, undefined);
    assert.ok(report.finishedAt.endsWith('Z'));
  } finally { await rm(evidenceDir, { recursive: true, force: true }); }
});
