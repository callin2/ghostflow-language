import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { compile as compileGfb, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const MAX = Number.MAX_SAFE_INTEGER;
const nativePath = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
const source = `# Dynamic Duration runtime

\`\`\`ghost
control DurationRuntime {
  input a, b: Duration;
  state accepted: Int = 0;
  accepted' = accepted + 1;
  output result: Duration;
  result <- a + b;
}
\`\`\`
`;

async function runtimeFor(t, expression = 'a + b') {
  const artifact = await compileSource(source.replace('a + b', expression), { filename: 'duration-runtime.ghost.md' });
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  runtime.addCapability('actuator', 'result', 'number');
  runtime.activate();
  return runtime;
}
function nativeFor(t, bytes, header, rows) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-duration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'duration.gfb'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, `${header}\n${rows.join('\n')}\n`);
  return execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
}
function snapshot(runtime) {
  return { tick: runtime.trace.tick, journalLength: runtime.journalLength, state: runtime.stateInt('accepted'), intent: runtime.intentNumber('result') };
}

test('duration runtime MAX plus zero succeeds', async t => {
  const runtime = await runtimeFor(t);
  runtime.setNumber('a', MAX); runtime.setNumber('b', 0); runtime.tick();
  assert.equal(runtime.intentNumber('result'), MAX);
});
test('duration runtime zero minus zero succeeds', async t => {
  const runtime = await runtimeFor(t, 'a - b');
  runtime.setNumber('a', 0); runtime.setNumber('b', 0); runtime.tick();
  assert.equal(runtime.intentNumber('result'), 0);
});

for (const [name, expression, a, b] of [
  ['MAX plus one', 'a + b', MAX, 1],
  ['zero minus one', 'a - b', 0, 1],
  ['intermediate underflow before cancellation', '(a - b) + b', 0, 1],
]) {
  test(`duration runtime rejects ${name} and rolls back`, async t => {
    const runtime = await runtimeFor(t, expression);
    runtime.setNumber('a', 1); runtime.setNumber('b', 0); runtime.tick();
    const before = snapshot(runtime);
    runtime.setNumber('a', a); runtime.setNumber('b', b);
    assert.throws(() => runtime.tick(), /duration-out-of-range/);
    assert.deepEqual(snapshot(runtime), before);
    runtime.setNumber('a', 1); runtime.setNumber('b', 0); runtime.tick();
    assert.equal(runtime.stateInt('accepted'), before.state + 1);
  });
}

test('duration checked arithmetic rejects invalid intermediate results on native execution', async t => {
  for (const [expression, safe, invalid] of [
    ['a + b', '1,0', `${MAX},1`], ['a - b', '1,0', '0,1'],
    ['(a - b) + b', '1,0', '0,1'], ['-a', '0,0', '1,0'],
  ]) {
    const artifact = await compileSource(source.replace('a + b', expression), { filename: 'duration-native.ghost.md' });
    assert.equal(artifact.bytes.readUInt16LE(4), 3);
    const outcomes = nativeFor(t, artifact.bytes, 'a,b', [safe, invalid, safe]);
    assert.equal(outcomes[0].trace.stateAfter.accepted, 1);
    assert.deepEqual(outcomes[1], { status: 'ERROR', phase: 'tick', error: 'duration-out-of-range', journalLength: 1 });
    assert.equal(outcomes[2].trace.stateBefore.accepted, 1);
    assert.equal(outcomes[2].trace.stateAfter.accepted, 2);
  }
});

test('duration unary minus and unselected underflow follow the same WASM guard contract', async t => {
  const unary = await runtimeFor(t, '-a');
  unary.setNumber('a', 0); unary.setNumber('b', 0); unary.tick();
  const before = snapshot(unary);
  unary.setNumber('a', 1); unary.setNumber('b', 0);
  assert.throws(() => unary.tick(), /duration-out-of-range/);
  assert.deepEqual(snapshot(unary), before);
  const expression = 'if a == 0ms then 7ms else a - b';
  const skipped = await runtimeFor(t, expression);
  skipped.setNumber('a', 0); skipped.setNumber('b', 1); skipped.tick();
  assert.equal(skipped.intentNumber('result'), 7);
  skipped.setNumber('a', 1); skipped.setNumber('b', 2);
  assert.throws(() => skipped.tick(), /duration-out-of-range/);
  assert.equal(skipped.stateInt('accepted'), 1);
  const artifact = await compileSource(source.replace('a + b', expression), { filename: 'duration-branch.ghost.md' });
  const native = nativeFor(t, artifact.bytes, 'a,b', ['0,1', '1,2']);
  assert.equal(native[0].trace.safe.result, 7);
  assert.equal(native[1].error, 'duration-out-of-range');
});

test('duration guard bytecode rejects wrong profiles, wrong types and stack underflow on both loaders', async t => {
  const valid = Buffer.from(compileGfb(parse(tokenize('(module Guard (strategy control 0 (device true) (intent result (check-duration 1))))'))));
  const expression = Buffer.alloc(10); expression[0] = 2; expression.writeDoubleLE(1, 1); expression[9] = 54;
  const at = valid.indexOf(expression); assert.notEqual(at, -1);
  const replace = (code, format = 3) => {
    const prefix = Buffer.from(valid.subarray(0, at)); prefix.writeUInt16LE(format, 4); prefix.writeUInt32LE(code.length, at - 4);
    return Buffer.concat([prefix, Buffer.from(code), valid.subarray(at + expression.length)]);
  };
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  for (const [bytes, expected] of [
    [replace(expression, 1), /Duration guard requires GFB format 3/],
    [replace(expression, 2), /Duration guard requires GFB format 3/],
    [replace([1, 1, 54]), /Duration guard expects Number/],
    [replace([54]), /stack underflow/],
  ]) {
    const [native] = nativeFor(t, bytes, 'unused', ['0']);
    assert.equal(native.phase, 'load'); assert.match(native.error, expected);
    assert.throws(() => runtime.load(bytes), expected);
  }
});
