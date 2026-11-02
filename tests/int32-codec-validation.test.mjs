import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileEvidence, fixtureSource, inspectModule, mutations, theoremInput, values } from '../experiments/int32-codec-validation/bridge.mjs';
import { leanOutcomeMatches, verify } from '../experiments/int32-codec-validation/verify.mjs';

test('i32 compiler witnesses retain canonical source, GFB2 initial and opcode23 bytes', () => {
  const evidence = compileEvidence();
  assert.equal(evidence.source, fixtureSource());
  assert.equal(evidence.records.length, values.length*2);
  for (const record of evidence.records) {
    const representative = BigInt(record.value) < 0n ? BigInt(record.value) + 4294967296n : BigInt(record.value);
    const expected = [0n, 8n, 16n, 24n].map(shift => Number(representative >> shift & 255n));
    assert.deepEqual(record.bytes, expected, `${record.kind} value ${record.value}`);
    assert.deepEqual([...evidence.compiled.bytes.slice(record.offset, record.offset + 4)], expected);
  }
});

test('i32 witnesses cover signed and byte boundaries', () => {
  for (const n of [-2147483648, -2147483647, -1, 0, 1, 127, 128, 255, 256, 257,
    65535, 65536, 65537, 16777215, 16777216, 16777217, 2147483646, 2147483647]) assert.ok(values.includes(n));
  assert.equal(new Set(values).size, values.length);
});

test('each endian/sign mutant changes only its constant and remains structurally admitted', () => {
  const evidence = compileEvidence(), changed = mutations(evidence);
  assert.equal(changed.length, 3);
  for (const mutant of changed) {
    assert.notDeepEqual(mutant.oldBytes, mutant.newBytes);
    assert.deepEqual(mutant.bytes.slice(0, mutant.offset), evidence.compiled.bytes.slice(0, mutant.offset));
    assert.deepEqual(mutant.bytes.slice(mutant.offset + 4), evidence.compiled.bytes.slice(mutant.offset + 4));
    assert.equal(inspectModule(mutant.bytes).length, evidence.records.length);
    assert.match(mutant.theorem, /theorem witness0 : decode \(\(artifactBytes.drop \d+\).take 4\) = some/);
  }
});

test('Lean witnesses bind the full actual byte array and both encoding directions', () => {
  const evidence = compileEvidence(), input = theoremInput(evidence.compiled.bytes, evidence.records);
  assert.ok(input.includes(`def artifactBytes : List Nat := [${[...evidence.compiled.bytes].join(', ')}]`));
  assert.equal((input.match(/theorem witness\d+/g) ?? []).length, values.length*2);
  assert.equal((input.match(/theorem canonical\d+/g) ?? []).length, values.length*2);
  assert.ok(!/\b(sorry|admit|axiom|native_decide)\b/.test(input));
});

test('only an ordinary Lean failure for the exact mutant equality counts as rejection', () => {
  const mutant = mutations(compileEvidence())[0];
  const ordinary = { status: 1, signal: null }, log = `mutant.lean:6:88: error: ${mutant.diagnostic}\n`;
  assert.equal(leanOutcomeMatches(ordinary, log, false, mutant.diagnostic), true);
  for (const result of [{ status: null }, { status: undefined }, { status: 0 },
    { status: 1, signal: 'SIGTERM' }, { status: 1, error: new Error('ETIMEDOUT') }]) {
    assert.equal(leanOutcomeMatches(result, log, false, mutant.diagnostic), false);
  }
  for (const extra of ['error: unknown module Int32Codec', 'could not import Int32Codec',
    'unknown identifier decode', 'maximum recursion depth has been reached', 'timed out']) {
    assert.equal(leanOutcomeMatches(ordinary, `${log}\n${extra}`, false, mutant.diagnostic), false);
  }
  assert.equal(leanOutcomeMatches(ordinary, `${log}\nextra.lean:1:1: error: unrelated`, false, mutant.diagnostic), false);
  assert.equal(leanOutcomeMatches(ordinary, log.replace('some 65537', 'some 65536'), false, mutant.diagnostic), false);
  assert.equal(leanOutcomeMatches(ordinary, log.replace('List.drop 2554', 'List.drop 2553'), false, mutant.diagnostic), false);
  assert.equal(leanOutcomeMatches(ordinary, log, false), false);
  assert.equal(leanOutcomeMatches({ status: 0 }, '', true), true);
  assert.equal(leanOutcomeMatches({ status: 0 }, 'sorryAx', true), false);
});

test('failed verification replaces a prior passed receipt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'i32-receipt-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'verification.json');
  await writeFile(path, '{"status":"passed"}\n');
  await assert.rejects(verify({ lean: join(directory, 'missing-lean'), evidenceDir: directory }));
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(receipt.status, 'failed'); assert.ok(receipt.startedAt); assert.ok(receipt.finishedAt);
  assert.ok(receipt.error); assert.equal(receipt.productionCompilerProof, false);
  assert.equal(receipt.productionRustRefinementProof, false);
});
