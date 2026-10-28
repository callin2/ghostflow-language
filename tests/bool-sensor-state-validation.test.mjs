import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileEvidence, theoremInput, admissionInput, sourceAdmissionInput } from '../experiments/bool-sensor-state-validation/bridge.mjs';
import { verify } from '../experiments/bool-sensor-state-validation/verify.mjs';

const filename = 'experiments/bool-sensor-state-validation/fixtures/toggle.ghost.md';
const original = () => readFile(new URL(`../${filename}`, import.meta.url));

test('stateful canonical compiler evidence retains actual source, full artifact and metadata', async () => {
  const source = await original(), evidence = compileEvidence(source.toString(), filename);
  assert.deepEqual(evidence.projection, { name: 'SensorToggle', sensor: 'trigger', state: 'held',
    initial: false, output: 'relay', origin: 1, site: 7 });
  assert.deepEqual(evidence.metadata.sites, [{ site: 7, nodeId: 7, kind: 'recover', errorType: 'SensorFault',
    origins: [{ tag: 1, nodeId: 1, kind: 'sensor', name: 'trigger' }] }]);
  const certificate = theoremInput(evidence, source);
  assert.ok(certificate.includes(`def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...source])}`));
  assert.ok(certificate.includes(`def artifactBytes : List Nat := ${JSON.stringify(evidence.bytes)}`));
  assert.match(certificate, /\(inputs : List ScanInput\)/);
  assert.match(certificate, /SmallNumberLaws ops/);
  assert.match(certificate, /original_source_input_trace/);
  assert.doesNotMatch(certificate, /\b(sorry|admit|axiom|native_decide)\b|artifactBytes\.drop/);
  evidence.decoded = new Proxy({}, { get() { throw new Error('must not trust decoder'); } });
  assert.equal(theoremInput(evidence, source), certificate);
  assert.doesNotMatch(admissionInput(evidence.bytes), /sourceProfile|actualMetadata/);
  assert.doesNotMatch(sourceAdmissionInput(source, true), /sourceProfile|actualMetadata/);
});

test('both initial values and renamed state use real compilation', async () => {
  const source = (await original()).toString();
  const changed = source.replace('held: Bool = false', 'held: Bool = true').replaceAll('held', 'memory_bit');
  const compiled = compileEvidence(changed, filename);
  assert.equal(compiled.projection.initial, true);
  assert.equal(compiled.projection.state, 'memory_bit');
  assert.equal(compiled.projection.site, 7);
  const trivia = compileEvidence(source.replace('  input', '  // comment\n  input'), filename);
  assert.deepEqual(trivia.bytes, compileEvidence(source, filename).bytes);
});

test('projection refuses unproved recovery, candidate and state shapes', async () => {
  const source = (await original()).toString();
  for (const changed of [
    source.replace('recover(false)', 'recover(true)'),
    source.replace("relay <- held'", 'relay <- held'),
    source.replace('!held', "!held'"),
    source.replace('input trigger: Bool;', 'input trigger?: Bool;'),
    source.replace('held: Bool = false', 'held: Bool = !true'),
    source.replace('!held', '!other'),
  ]) assert.throws(() => compileEvidence(changed, filename));
});

test('failed proof run replaces stale success without claiming kernel acceptance', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'sensor-state-failure-'));
  try {
    await writeFile(join(evidenceDir, 'verification.json'), JSON.stringify({ status: 'passed', stale: true }));
    await assert.rejects(verify({ lean: join(evidenceDir, 'missing-lean'), evidenceDir }), /Lean version check failed/);
    const report = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.stale, undefined);
    assert.equal(report.productionCompilerProof, false);
    assert.ok(report.finishedAt.endsWith('Z'));
  } finally { await rm(evidenceDir, { recursive: true, force: true }); }
});
