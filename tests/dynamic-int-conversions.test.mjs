import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { compile as compileGfb, parse, tokenize } from '../tools/gfb1.mjs';
import { softwareQualityAbi, softwareQualityCsv } from './helpers/software-quality-observations.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, `target/release/examples/run${process.platform === 'win32' ? '.exe' : ''}`);
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const fractional = 'integer-conversion-fractional';
const range = 'integer-conversion-out-of-range';
const cases = [
  ['number', 'Int', 'Number', [[-2147483648, -2147483648], [-1, -1], [0, 0], [2147483647, 2147483647]]],
  ['int_exact', 'Number', 'Int', [[0, 0], [-0, 0], [-2147483648, -2147483648], [2147483647, 2147483647], [1.5, fractional], [-1.5, fractional], [2147483648.5, fractional], [-2147483648.5, fractional], [2147483648, range], [-2147483649, range], [Number.MAX_VALUE, range], [7, 7]]],
  ['int_floor', 'Number', 'Int', [[1.9, 1], [-1.1, -2], [2147483647.75, 2147483647], [-2147483648.25, range], [2147483648, range], [7, 7]]],
  ['int_ceil', 'Number', 'Int', [[1.1, 2], [-1.9, -1], [-2147483648.75, -2147483648], [2147483647.25, range], [-2147483649, range], [7, 7]]],
  ['int_trunc', 'Number', 'Int', [[1.9, 1], [-1.9, -1], [2147483647.9, 2147483647], [-2147483648.9, -2147483648], [2147483648, range], [-2147483649, range], [7, 7]]],
  ['int_nearest_even', 'Number', 'Int', [[0.5, 0], [-0.5, 0], [1.5, 2], [-1.5, -2], [2.5, 2], [-2.5, -2], [2147483646.5, 2147483646], [2147483647.5, range], [-2147483648.5, -2147483648], [-2147483648.75, range], [7, 7]]],
];

for (const [conversion, inputType, outputType, rows] of cases) {
  test(`GF-TEST-dynamic-conversion-${conversion}: native/WASM results, faults and atomic commits`, async t => {
    const filename = `${conversion}.ghost.md`;
    const artifact = await compileSource(`# Dynamic ${conversion}\n\n\`\`\`ghost\ncontrol Conversion {\n input value: ${inputType};\n state retained_value: ${inputType} = ${inputType === 'Int' ? '0' : '0.0'};\n let scalar_value = case value { ok(observed) => observed; fault(_) => retained_value; };\n retained_value' = scalar_value;\n state accepted: Int = 0;\n accepted' = accepted + 1;\n output result: ${outputType};\n result <- ${conversion}(scalar_value);\n}\n\`\`\`\n`, { filename });
    assert.equal(artifact.bytes.readUInt16LE(4), 3);
    assert.equal(artifact.manifest.format, 'GhostFlow/control-v4');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-conversion-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, 'conversion.gfb'), inputPath = path.join(directory, 'inputs.csv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(inputPath, softwareQualityCsv(artifact, rows.map(([value]) => ({ value }))));
    const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
    const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
    t.after(() => runtime.dispose());
    runtime.load(artifact.bytes); softwareQualityAbi(runtime, artifact); runtime.addCapability('actuator', 'result', outputType.toLowerCase()); runtime.activate();
    let accepted = 0, previous;
    const output = () => outputType === 'Int' ? runtime.intentInt('result') : runtime.intentNumber('result');
    for (const [index, [value, expected]] of rows.entries()) {
      if (inputType === 'Int') runtime.setInt('value', value); else runtime.setNumber('value', value);
      if (typeof expected === 'string') {
        assert.equal(native[index].error, expected);
        assert.equal(native[index].journalLength, accepted);
        assert.throws(() => runtime.tick(), new RegExp(expected));
        assert.equal(output(), previous);
      } else {
        assert.equal(native[index].trace.stateBefore.accepted, accepted);
        assert.equal(native[index].trace.safe.result, expected);
        runtime.tick();
        assert.equal(output(), expected);
        previous = expected;
        accepted++;
      }
      assert.equal(runtime.stateInt('accepted'), accepted);
      assert.equal(runtime.journalLength, accepted);
      assert.equal(runtime.trace.tick, accepted);
    }
  });
}

test('GF-TEST-dynamic-conversion-branches: transition faults are atomic and unselected conversions are skipped', async t => {
  const artifact = await compileSource('# Conditional conversion\n\n```ghost\ncontrol Conditional { input guard: Bool; input value: Number; state converted: Int = 0; state accepted: Int = 0; converted\' = case guard { ok(enabled) => if enabled then (case value { ok(observed) => int_exact(observed); fault(_) => converted; }) else 7; fault(_) => converted; }; accepted\' = accepted + 1; output result: Int; result <- converted\'; }\n```\n', { filename: 'conditional-conversion.ghost.md' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-conversion-branch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'branch.gfb'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(inputPath, softwareQualityCsv(artifact, [{ guard: false, value: 2147483648.5 }, { guard: true, value: 2147483648.5 }, { guard: true, value: 8 }]));
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(native[0].trace.safe.result, 7);
  assert.deepEqual(native[1], { status: 'ERROR', phase: 'tick', error: fractional, journalLength: 1 });
  assert.deepEqual(native[2].trace.stateBefore, { accepted: 1, converted: 7 });
  assert.equal(native[2].trace.safe.result, 8);
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes); softwareQualityAbi(runtime, artifact); runtime.addCapability('actuator', 'result', 'int'); runtime.activate();
  runtime.setBool('guard', false); runtime.setNumber('value', 2147483648.5); runtime.tick();
  assert.equal(runtime.intentInt('result'), 7);
  runtime.setBool('guard', true); runtime.setNumber('value', 2147483648.5);
  assert.throws(() => runtime.tick(), /integer-conversion-fractional/);
  assert.equal(runtime.stateInt('converted'), 7);
  assert.equal(runtime.stateInt('accepted'), 1);
  assert.equal(runtime.intentInt('result'), 7);
  assert.equal(runtime.journalLength, 1);
  runtime.setBool('guard', true); runtime.setNumber('value', 8); runtime.tick();
  assert.equal(runtime.intentInt('result'), 8);
  assert.equal(runtime.stateInt('accepted'), 2);
});

test('GF-TEST-dynamic-conversion-verifier: wrong profiles, operand types and stack underflow reject on both targets', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-conversion-verifier-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'conversion.gfb'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(inputPath, 'unused\n0\n');
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  for (const [index, [conversion]] of cases.entries()) {
    const opcode = 48 + index;
    const head = conversion === 'number' ? 'int-to-number' : conversion.replaceAll('_', '-');
    const expression = Buffer.alloc(opcode === 48 ? 6 : 10);
    expression[0] = opcode === 48 ? 23 : 2;
    if (opcode === 48) expression.writeInt32LE(7, 1); else expression.writeDoubleLE(1.5, 1);
    expression[expression.length - 1] = opcode;
    const valid = Buffer.from(compileGfb(parse(tokenize(`(module Conversion (strategy control 0 (device true) (intent result (${head} ${opcode === 48 ? '(int 7)' : '1.5'}))))`))));
    const at = valid.indexOf(expression);
    assert.notEqual(at, -1);
    assert.equal(valid.indexOf(expression, at + 1), -1);
    const replace = (code, format = 3) => {
      const prefix = Buffer.from(valid.subarray(0, at)); prefix.writeUInt16LE(format, 4); prefix.writeUInt32LE(code.length, at - 4);
      return Buffer.concat([prefix, Buffer.from(code), valid.subarray(at + expression.length)]);
    };
    for (const [bytes, expected] of [
      [replace(expression, 1), /invalid type|requires GFB format/],
      [replace(expression, 2), /conversion opcode requires GFB format 3/],
      [replace([1, 1, opcode]), /conversion operand type/],
      [replace([opcode]), /stack underflow/],
    ]) {
      fs.writeFileSync(modulePath, bytes);
      const native = JSON.parse(execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim());
      assert.equal(native.phase, 'load'); assert.match(native.error, expected);
      assert.throws(() => runtime.load(bytes), expected);
    }
    assert.throws(() => compileGfb(parse(tokenize(`(module Invalid (strategy control 0 (device true) (intent result (${head} true))))`))), /expects one/);
  }
});
