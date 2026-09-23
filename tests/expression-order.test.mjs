import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const nativePath = path.join(root, 'target/release/examples/run');
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const source = `# Expression order

\`\`\`ghost
control ExpressionOrder {
  input a, b, c: Bool;
  output precedence, parentheses, subtraction, subtraction_right, division, division_right: Number;
  output grouping: Bool;
  precedence <- 1.0 + 2.0 * 3.0;
  parentheses <- (1.0 + 2.0) * 3.0;
  subtraction <- 6.0 - 2.0 - 1.0;
  subtraction_right <- 6.0 - (2.0 - 1.0);
  division <- 6.0 / 2.0 * 3.0;
  division_right <- 6.0 / (2.0 * 3.0);
  grouping <- a || b && !c;
}
\`\`\`
`;
const artifact = await compileSource(source, { filename: 'expression-order.ghost.md' });
const cases = [
  ['a=true,b=false,c=false baseline grouping case', { a: true, b: false, c: false }, true],
  ['a=true,b=false,c=true distinguishes short circuit grouping', { a: true, b: false, c: true }, true],
];

test('REF-01-079/080 native and WASM preserve expression precedence and associativity', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-expression-order-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'expression-order.gfb');
  const inputPath = path.join(temporary, 'expression-order.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(inputPath, `a,b,c\n${cases.map(([, input]) => `${input.a},${input.b},${input.c}`).join('\n')}\n`);
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const name of ['precedence', 'parentheses', 'subtraction', 'subtraction_right', 'division', 'division_right']) runtime.addCapability('actuator', name, 'number');
  runtime.addCapability('actuator', 'grouping', 'bool');
  runtime.activate();
  for (const [index, [label, input, grouping]] of cases.entries()) {
    await t.test(label, () => {
      const safe = native[index].trace.safe;
      assert.equal(native[index].status, 'OK');
      assert.deepEqual(
        ['precedence', 'parentheses', 'subtraction', 'subtraction_right', 'division', 'division_right'].map(name => safe[name]),
        [7, 9, 3, 5, 9, 1],
      );
      assert.equal(safe.grouping, grouping);
      runtime.setBool('a', input.a); runtime.setBool('b', input.b); runtime.setBool('c', input.c);
      runtime.tick();
      assert.deepEqual(
        ['precedence', 'parentheses', 'subtraction', 'subtraction_right', 'division', 'division_right'].map(name => runtime.intentNumber(name)),
        [7, 9, 3, 5, 9, 1],
      );
      assert.equal(runtime.intentBool('grouping'), grouping);
    });
  }
});
