import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { softwareQualityAbi, softwareQualityCsv } from './helpers/software-quality-observations.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, `target/release/examples/run${process.platform === 'win32' ? '.exe' : ''}`);
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
  grouping <- (a |> recover(false)) || (b |> recover(false)) && !(c |> recover(false));
}
\`\`\`
`;
const artifact = await compileSource(source, { filename: 'expression-order.ghost.md' });
const cases = [
  ['a=true,b=false,c=false baseline grouping case', { a: true, b: false, c: false }, true],
  ['a=true,b=false,c=true distinguishes short circuit grouping', { a: true, b: false, c: true }, true],
];

test('REF §2.2 signed whole literals receive the common Number type of either if branch', async t => {
  const document = `# Signed branch context

\`\`\`ghost
control SignedBranches {
  input choose: Bool;
  input measured: Number;
  state retained_measured: Number = 0.0;
  let scalar_measured = case measured { ok(observed) => observed; fault(_) => retained_measured; };
  retained_measured' = scalar_measured;
  let scalar_choose = choose |> recover(false);
  let first = if scalar_choose then -1 else scalar_measured;
  let second = if scalar_choose then scalar_measured else -1;
  let below_int = if scalar_choose then -2147483649 else scalar_measured;
  let above_int = if scalar_choose then scalar_measured else 2147483648;
  output first_out, second_out, below_int_out, above_int_out: Number;
  first_out <- first;
  second_out <- second;
  below_int_out <- below_int;
  above_int_out <- above_int;
}
\`\`\`
`;
  const compiled = await compileSource(document, { filename: 'signed-branches.ghost.md' });
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(compiled.bytes);
  softwareQualityAbi(runtime, compiled);
  const names = ['first_out', 'second_out', 'below_int_out', 'above_int_out'];
  for (const name of names) runtime.addCapability('actuator', name, 'number');
  runtime.activate();
  for (const [choose, expected] of [[true, [-1, 2.5, -2147483649, 2.5]], [false, [2.5, -1, 2.5, 2147483648]]]) {
    runtime.setNumber('measured', 2.5);
    runtime.setBool('choose', choose);
    runtime.tick();
    assert.deepEqual(names.map(name => runtime.intentNumber(name)), expected);
  }
});

test('REF §2.2 branch context never changes an already inferred Int binding', async () => {
  const wrap = body => `# Branch type boundaries\n\n\`\`\`ghost\ncontrol BranchTypes {\n${body}\n}\n\`\`\`\n`;
  for (const expression of ['if choose then exact else measured', 'if choose then measured else exact']) {
    await assert.rejects(compileSource(wrap(`
      state choose: Bool = false;
      state measured: Number = 0.0;
      let exact = -1;
      let selected = ${expression};
      output result: Number;
      result <- selected;
    `), { filename: 'branch-types.ghost.md' }), /if branches must have the same type/);
  }
  await assert.rejects(compileSource(wrap(`
    state choose: Bool = false;
    let selected = if choose then -2147483649 else 0;
    output result: Number;
    result <- selected;
  `), { filename: 'branch-types.ghost.md' }), /Int literal is outside/);
});

test('REF-01-079/080 native and WASM preserve expression precedence and associativity', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-expression-order-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'expression-order.gfb');
  const inputPath = path.join(temporary, 'expression-order.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(inputPath, softwareQualityCsv(artifact, cases.map(([, input]) => input)));
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  softwareQualityAbi(runtime, artifact);
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
