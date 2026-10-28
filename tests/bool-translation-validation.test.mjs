import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { compileEvidence, decodeExpression, decodeModule, projectSource, theoremInput, validateArtifact, wireBytes }
  from '../experiments/bool-translation-validation/bridge.mjs';
import { verify } from '../experiments/bool-translation-validation/verify.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = async name => {
  const filename = `experiments/bool-translation-validation/fixtures/${name}.ghost.md`;
  return compileEvidence(await readFile(join(root, filename), 'utf8'), filename);
};
const document = code => `# Bool admission test\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

test('real canonical compilation binds Bool profile 1 and 3 byte slices and complete state targets', async () => {
  for (const [name, format] of [['boolean-literals', 1], ['snapshot-branches', 3]]) {
    const evidence = await fixture(name);
    assert.equal(evidence.decoded.format, format);
    assert.deepEqual(evidence.decoded.transitions.map(x => x.target), evidence.projection.states.map((_, i) => i));
    for (const entry of [...evidence.decoded.transitions, ...evidence.decoded.outputs]) {
      assert.deepEqual(wireBytes(entry.wire), evidence.artifact.bytes.slice(entry.offset, entry.offset + entry.length));
    }
    const input = theoremInput(evidence);
    assert.match(input, /theorem artifactTickPreserved \(env : Env\)/);
    assert.match(input, /theorem outputs0Bound/);
    assert.doesNotMatch(input, /\b(sorry|axiom|native_decide)\b/);
  }
});

test('source projection retains old-state default and normalizes simultaneous declaration order', () => {
  const source = document("control Order { state a: Bool = false; state b: Bool = true; state held: Bool = false; b' = a; a' = b; output out: Bool; out <- held'; }");
  const projected = projectSource(source, 'order.ghost.md');
  assert.deepEqual(projected.transitions, [
    { target: 0, expression: { kind: 'previous', index: 1 } },
    { target: 1, expression: { kind: 'previous', index: 0 } },
    { target: 2, expression: { kind: 'previous', index: 2 } },
  ]);
});

test('unsupported source forms fail closed before proof generation', () => {
  for (const code of [
    'control Bad { input x: Bool; output out: Bool; out <- true; }',
    'control Bad { state x: Int = 0; output out: Bool; out <- true; }',
    'control Bad { state x: Bool = true; let y = x; output out: Bool; out <- y; }',
    "control Bad { state x: Bool = true; x' = x'; output out: Bool; out <- true; }",
    'control Bad { output out: Bool; out <- 1.0 > 0.0; }',
  ]) assert.throws(() => projectSource(document(code), 'bad.ghost.md'), /Bool validator admission/);
});

test('unknown opcodes, broken offsets, incomplete and surplus expression stacks are rejected', () => {
  for (const bytes of [[255], [4, 0], [1, 0, 1, 1], [10], [1, 1, 30, 2, 0], [1, 2]]) {
    assert.throws(() => decodeExpression(Uint8Array.from(bytes)), /Bool validator admission/);
  }
});

test('module admission binds headers, state initial values, target mapping and complete byte consumption', async () => {
  const evidence = await fixture('snapshot-branches');
  const reject = (mutate, pattern) => {
    const bytes = Uint8Array.from(evidence.artifact.bytes);
    assert.throws(() => validateArtifact(evidence.projection, mutate(bytes) ?? bytes), pattern);
  };
  reject(bytes => { bytes[4] = 21; }, /unsupported GFB format/);
  reject(bytes => { bytes[8] = 88; }, /module name differs/);
  reject(bytes => { bytes[evidence.decoded.states[0].initialOffset] ^= 1; }, /initial values differ/);
  reject(bytes => { bytes[evidence.decoded.states[0].typeOffset] = 2; }, /non-Bool state/);
  reject(bytes => {
    bytes[evidence.decoded.transitions[0].targetOffset] = 1;
    bytes[evidence.decoded.transitions[1].targetOffset] = 0;
  }, /state declaration order/);
  reject(bytes => { bytes[evidence.decoded.transitions[1].targetOffset] = 0; }, /duplicate transition/);
  reject(bytes => { bytes[evidence.decoded.transitions[0].offset] = 5; }, /unsupported read namespace/);
  reject(bytes => bytes.slice(0, -1), /truncated bytes/);
  reject(bytes => Uint8Array.from([...bytes, 0]), /trailing bytes/);
  assert.throws(() => decodeModule(new Uint8Array()), /truncated bytes/);
});

test('failed proof invocation replaces stale success with failed evidence', async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'bool-proof-stale-test-'));
  try {
    await writeFile(join(evidenceDir, 'verification.json'), JSON.stringify({ status: 'passed', stale: true }));
    await assert.rejects(verify({ lean: join(evidenceDir, 'missing-lean'), evidenceDir }), /Lean version check failed/);
    const evidence = JSON.parse(await readFile(join(evidenceDir, 'verification.json'), 'utf8'));
    assert.equal(evidence.status, 'failed');
    assert.equal(evidence.stale, undefined);
    assert.match(evidence.error.message, /Lean version check failed/);
    assert.ok(evidence.startedAt.endsWith('Z') && evidence.finishedAt.endsWith('Z'));
  } finally { await rm(evidenceDir, { recursive: true, force: true }); }
});
