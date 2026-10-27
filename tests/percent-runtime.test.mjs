import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { softwareQualityRails } from './helpers/software-quality-observations.mjs';

const nativePath = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const canonical = code => compileSourceSync(`# Percent execution\n\n\`\`\`ghost\n${code}\n\`\`\`\n`,
  { filename: 'percent-runtime.ghost.md' });
const raw = code => Buffer.from(compile(parse(tokenize(code))));

function native(t, bytes, observations, artifact) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-percent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'module.gfb');
  const inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes);
  const packets = artifact ? observations.map((values, index) => softwareQualityRails(artifact, values, index + 1, index)) : observations;
  const names = Object.keys(packets[0]);
  fs.writeFileSync(inputPath, `${names.join(',')}\n${packets.map(packet => names.map(name => packet[name]).join(',')).join('\n')}\n`);
  return execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
}

async function wasm(t, bytes, output, sensor) {
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(bytes);
  runtime.addCapability('actuator', output, 'number');
  if (sensor) runtime.addCapability('sensor', sensor, 'number');
  runtime.activate();
  return runtime;
}

test('canonical dynamic Percent overflow faults in actual WASM execution', async t => {
  const artifact = canonical('control PercentOverflow { state a: Percent = 90%; output x: Percent; x <- a + 20%; }');
  const runtime = await wasm(t, artifact.bytes, 'x');
  assert.throws(() => runtime.tick(), /percent-out-of-range/);
  assert.deepEqual(artifact.manifest.requiredRuntimeFeatures, ['percent-range-v1']);
  assert.equal(runtime.journalLength, 0);
  assert.equal(runtime.stateNumber('a'), 90);
  assert.equal(native(t, artifact.bytes, [{}])[0].error, 'percent-out-of-range');
});

test('canonical Percent boundaries, fractional results and failed-tick retry agree in native and WASM', async t => {
  const artifact = canonical(`fn add_percent(value: Percent, increment: Percent) -> Percent { value + increment }
control PercentRetry {
  input step: Percent;
  state total: Percent = 0%;
  state accepted: Int = 0;
  let amount = case step { ok(value) => value; fault(_) => 0%; };
  total' = add_percent(total, amount);
  accepted' = accepted + 1;
  output position: Percent;
  position <- total';
}`);
  assert.deepEqual(artifact.manifest.requiredRuntimeFeatures, ['percent-range-v1']);
  const values = [0, 99.5, 0.5, 0.5, 0];
  const outcomes = native(t, artifact.bytes, values.map(step => ({ step })), artifact);
  const runtime = await wasm(t, artifact.bytes, 'position', 'step');
  let committed;
  for (const [index, value] of values.entries()) {
    for (const [name, payload] of Object.entries(softwareQualityRails(artifact, { step: value }, index + 1, index))) {
      if (typeof payload === 'boolean') runtime.setBool(name, payload);
      else runtime.setNumber(name, payload);
    }
    if (index === 3) {
      assert.deepEqual(outcomes[index], { status: 'ERROR', phase: 'tick', error: 'percent-out-of-range', journalLength: 3 });
      assert.throws(() => runtime.tick(), /percent-out-of-range/);
      assert.deepEqual(runtime.trace, committed);
      assert.equal(runtime.stateNumber('total'), 100);
      assert.equal(runtime.stateInt('accepted'), 3);
      continue;
    }
    runtime.tick();
    committed = runtime.trace;
    assert.equal(runtime.intentNumber('position'), outcomes[index].trace.safe.position);
    assert.equal(runtime.stateInt('accepted'), outcomes[index].trace.stateAfter.accepted);
  }
  assert.deepEqual(outcomes.filter(item => item.status === 'OK').map(item => item.trace.safe.position), [0, 99.5, 100, 100]);
});

test('Percent underflow, unary negation and invalid intermediate fault before cancellation', async t => {
  for (const expression of ['a - b', '-b', '(a - b) + b']) {
    const artifact = canonical(`control PercentArithmetic {
      state a: Percent = 0%; state b: Percent = 1%; output result: Percent;
      result <- ${expression};
    }`);
    assert.deepEqual(artifact.manifest.requiredRuntimeFeatures, ['percent-range-v1']);
    const runtime = await wasm(t, artifact.bytes, 'result');
    assert.throws(() => runtime.tick(), /percent-out-of-range/, expression);
    assert.equal(native(t, artifact.bytes, [{}])[0].error, 'percent-out-of-range');
  }
});

test('unselected invalid Percent branch stays lazy and Percent ratio is Number', async t => {
  const artifact = canonical(`control PercentBranch {
    state condition: Bool = false; state a: Percent = 0%; state b: Percent = 1%;
    output position: Percent; output ratio: Number;
    position <- if condition then a - b else 0%;
    ratio <- a / b;
  }`);
  assert.deepEqual(artifact.manifest.requiredRuntimeFeatures, ['percent-range-v1']);
  const runtime = await wasm(t, artifact.bytes, 'position');
  runtime.addCapability('actuator', 'ratio', 'number');
  runtime.tick();
  assert.equal(runtime.intentNumber('position'), 0);
  assert.equal(runtime.intentNumber('ratio'), 0);
  assert.equal(native(t, artifact.bytes, [{}])[0].trace.safe.position, 0);
  const ratio = canonical('control PercentRatio { state a: Percent = 100%; state b: Percent = 1%; output result: Number; result <- a / b; }');
  assert.equal(ratio.manifest.requiredRuntimeFeatures, undefined);
});

test('Percent guard syntax and bytecode reject wrong type, stack and old profile', async t => {
  assert.throws(() => raw('(module Bad (strategy control 0 (device true) (intent result (check-percent true))))'),
    /check-percent expects one Number operand/);
  const valid = raw('(module Guard (strategy control 0 (device true) (intent result (check-percent 1))))');
  const expression = Buffer.alloc(10); expression[0] = 2; expression.writeDoubleLE(1, 1); expression[9] = 60;
  const at = valid.indexOf(expression); assert.notEqual(at, -1);
  const replace = (code, format = 3) => {
    const prefix = Buffer.from(valid.subarray(0, at)); prefix.writeUInt16LE(format, 4); prefix.writeUInt32LE(code.length, at - 4);
    return Buffer.concat([prefix, Buffer.from(code), valid.subarray(at + expression.length)]);
  };
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  for (const [bytes, expected] of [
    [replace(expression, 1), /Percent guard requires GFB format 3/],
    [replace([1, 1, 60]), /Percent guard expects Number/],
    [replace([60]), /stack underflow/],
  ]) {
    assert.match(native(t, bytes, [{}])[0].error, expected);
    assert.throws(() => runtime.load(bytes), expected);
  }
});
