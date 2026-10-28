import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEvidence, decodeModule, sha256, validateArtifact } from '../experiments/bool-translation-validation/bridge.mjs';
import { generatedCase, generatedCases, generatedCaseCount, generatedSeed } from '../experiments/bool-translation-validation/generated-cases.mjs';
import { sourceTheoremInput } from '../experiments/bool-translation-validation/source-bridge.mjs';
import { leanOutcomeMatches } from '../experiments/lean-outcome.mjs';

test('fixed generation budget, seed, domain and feature coverage', () => {
  const cases = generatedCases();
  assert.equal(cases.length, generatedCaseCount);
  assert.deepEqual(cases, generatedCases());
  assert.notEqual(generatedCase(1, generatedSeed).source, generatedCase(1, generatedSeed + 1).source);
  assert.throws(() => generatedCase(-1), RangeError);
  assert.throws(() => generatedCase(generatedCaseCount), RangeError);
  assert.throws(() => generatedCase(0, -1), RangeError);
  assert.deepEqual(new Set(cases.map(x => x.states.length)), new Set([1, 2, 3, 4]));
  assert.deepEqual(new Set(cases.map(x => x.outputs.length)), new Set([1, 2, 3]));
  assert.ok(cases.some(x => x.states.some(s => s.initial) && x.states.some(s => !s.initial)));
  assert.ok(cases.some(x => x.transitions.length < x.states.length));
  assert.ok(cases.some(x => x.features.includes('swap')));
  assert.ok(cases.some(x => x.features.includes('forward')));
  const features = new Set(cases.flatMap(x => x.features));
  for (const name of ['candidate', 'negation', '&&', '||', 'if', 'grouping', 'swap', 'retained', 'forward']) {
    assert.ok(features.has(name), `missing ${name}`);
  }
  for (const sample of cases) {
    assert.ok(sample.states.length >= 1 && sample.states.length <= 4);
    assert.ok(sample.outputs.length >= 1 && sample.outputs.length <= 3);
    assert.ok(sample.transitions.every(t => !JSON.stringify(t.expression).includes('"candidate":true')));
  }
});

test('all generated cases compile through production and bind original bytes to the raw module certificate', async () => {
  const hashes = new Set();
  for (const sample of generatedCases()) {
    const evidence = await compileEvidence(sample.source, sample.filename);
    hashes.add(evidence.artifact.sha256);
    assert.equal(evidence.source.sha256, sha256(Buffer.from(sample.source)));
    assert.equal(evidence.projection.states.length, sample.states.length);
    assert.equal(evidence.projection.outputs.length, sample.outputs.length);
    assert.deepEqual(evidence.decoded.transitions.map(x => x.target), sample.states.map((_, i) => i));
    assert.doesNotThrow(() => validateArtifact(evidence.projection, Uint8Array.from(evidence.artifact.bytes)));
    const certificate = sourceTheoremInput(evidence, Buffer.from(sample.source));
    assert.match(certificate, /theorem exactModuleLoaded/);
    assert.match(certificate, /theorem exactSourceRead/);
    assert.match(certificate, /theorem originalSourceInitializedTrace \(n : Nat\)/);
  }
  assert.equal(hashes.size, generatedCaseCount);
});

test('semantic mutants remain valid programs while their old certificates disagree', async () => {
  const sample = generatedCase(1);
  const original = await compileEvidence(sample.source, sample.filename);
  const changedSource = sample.source.replace('state s0: Bool = false;', 'state s0: Bool = true;');
  const compiledSourceMutant = await compileEvidence(changedSource, sample.filename);
  assert.notEqual(compiledSourceMutant.artifact.sha256, original.artifact.sha256);
  const changedBytes = Uint8Array.from(original.artifact.bytes);
  changedBytes[original.decoded.states[0].initialOffset] ^= 1;
  assert.equal(decodeModule(changedBytes).states[0].initial, true);
  assert.notEqual(sourceTheoremInput(original, Buffer.from(changedSource)),
    sourceTheoremInput(original, Buffer.from(sample.source)));
});

test('failed-certificate outcomes cannot be satisfied by Lean infrastructure errors', () => {
  const contradiction = "error: tactic 'decide' proved that the proposition";
  const failed = { status: 1, signal: null, error: undefined };
  assert.equal(leanOutcomeMatches(failed, contradiction, false, contradiction.slice(7)), true);
  for (const problem of ['could not import SourceReader', 'unknown identifier sourceModule',
    'unknown module ModuleLoader', 'failed to load olean', 'no such file']) {
    assert.equal(leanOutcomeMatches(failed, `${problem}\n${contradiction}`, false, contradiction.slice(7)), false);
  }
  assert.equal(leanOutcomeMatches({ ...failed, signal: 'SIGKILL' }, contradiction, false, contradiction.slice(7)), false);
  assert.equal(leanOutcomeMatches({ ...failed, error: new Error('timeout') }, contradiction, false, contradiction.slice(7)), false);
});
