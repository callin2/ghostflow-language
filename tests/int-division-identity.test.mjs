import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { softwareQualityAbi, softwareQualityRails, softwareQualityCsv } from './helpers/software-quality-observations.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, `target/release/examples/run${process.platform === 'win32' ? '.exe' : ''}`);
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const MIN = -2_147_483_648;
const MAX = 2_147_483_647;
const values = [MIN, MIN + 1, -46_341, -7, -1, 0, 1, 7, 46_341, MAX - 1, MAX];
const divisors = [MIN, -7, -3, -1, 1, 3, 7, MAX];
const pairs = values.flatMap(a => divisors.filter(b => !(a === MIN && b === -1)).map(b => [a, b]));
const source = `# Integer division identity

\`\`\`ghost
control IntegerDivisionIdentity {
  input a, b: Int;
  state retained_a: Int = 0;
  state retained_b: Int = 1;
  let scalar_a = case a { ok(value) => value; fault(_) => retained_a; };
  let scalar_b = case b { ok(value) => value; fault(_) => retained_b; };
  retained_a' = scalar_a; retained_b' = scalar_b;
  output quotient, remainder: Int;
  quotient <- scalar_a div scalar_b;
  remainder <- scalar_a % scalar_b;
}
\`\`\`
`;
const artifact = await compileSource(source, { filename: 'int-division-identity.ghost.md' });

function expected(a, b) {
  const q = BigInt(a) / BigInt(b);
  const r = BigInt(a) % BigInt(b);
  return { q: Number(q), r: Number(r) };
}

test('REF-01-063 native and WASM signed division preserve quotient/remainder identity', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-int-identity-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'identity.gfb');
  const inputPath = path.join(temporary, 'identity.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(inputPath, softwareQualityCsv(artifact, pairs.map(([a, b]) => ({ a, b }))));
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  assert.equal(native.length, pairs.length);
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  softwareQualityAbi(runtime, artifact);
  runtime.addCapability('actuator', 'quotient', 'int');
  runtime.addCapability('actuator', 'remainder', 'int');
  runtime.activate();
  for (const [index, [a, b]] of pairs.entries()) {
    await t.test(`a=${a}, b=${b}`, () => {
      const { q, r } = expected(a, b);
      assert.equal(native[index].status, 'OK');
      const nativeQ = native[index].trace.safe.quotient;
      const nativeR = native[index].trace.safe.remainder;
      assert.equal(nativeQ, q);
      assert.equal(nativeR, r);
      assert.equal(BigInt(a), BigInt(nativeQ) * BigInt(b) + BigInt(nativeR));
      assert.ok(nativeR === 0 || Math.sign(nativeR) === Math.sign(a));
      runtime.setInt('a', a); runtime.setInt('b', b); runtime.tick();
      const wasmQ = runtime.intentInt('quotient');
      const wasmR = runtime.intentInt('remainder');
      assert.equal(wasmQ, q);
      assert.equal(wasmR, r);
      assert.equal(BigInt(a), BigInt(wasmQ) * BigInt(b) + BigInt(wasmR));
      assert.ok(wasmR === 0 || Math.sign(wasmR) === Math.sign(a));
    });
  }
});
