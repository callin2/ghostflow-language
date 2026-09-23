import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const nativePath = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const gfb = source => Buffer.from(compile(parse(tokenize(source))));
function native(t, bytes, header, rows) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-result-trace-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'module.gfb'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes); fs.writeFileSync(inputPath, `${header}\n${rows.join('\n')}\n`);
  return execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
}

test('GF-TEST-result-trace-runtime: selected diagnostics preserve payloads, order and repeats in native and both WASM ABIs', async t => {
  const bytes = gfb(`(module ResultTrace (input selected bool) (strategy run 0 (device true)
    (intent result (if input.selected (trace-result 7 (trace-result 7 42 0 11) 3 12) 9))
    (intent flag (if input.selected (trace-result 8 true 1 0) true)) (intent count (if input.selected (trace-result 9 (int -7) 0 0) (int -7)))))`);
  assert.equal(bytes.readUInt16LE(4), 3);
  const outcomes = native(t, bytes, 'selected', ['false', 'true']);
  const wasm = fs.readFileSync(wasmPath);
  for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const runtime = await Runtime.instantiate(wasm); t.after(() => runtime.dispose());
    runtime.load(bytes);
    for (const [name, type] of [['result', 'number'], ['flag', 'bool'], ['count', 'int']]) runtime.addCapability('actuator', name, type);
    runtime.activate();
    for (const [index, selected] of [false, true].entries()) {
      let trace;
      if (Runtime === GhostFlowRuntime) { runtime.setBool('selected', selected); runtime.tick(); trace = runtime.trace; }
      else trace = runtime.scan({ scanId: index, logicalTimeMs: index, inputs: [{ name: 'selected', value: selected }] }).trace;
      const expected = selected ? [{ site: 7, choice: 0, origin: 11 }, { site: 7, choice: 3, origin: 12 }, { site: 8, choice: 1, origin: 0 }, { site: 9, choice: 0, origin: 0 }] : [];
      assert.deepEqual(trace.resultTrace, expected);
      assert.deepEqual(outcomes[index].trace.resultTrace, expected);
      assert.deepEqual(trace.requested, { count: -7, flag: true, result: selected ? 42 : 9 });
      assert.deepEqual(trace.safe, trace.requested);
    }
  }
});

test('GF-TEST-result-trace-atomicity: later faults discard all diagnostic events and candidate state', async t => {
  const bytes = gfb(`(module ResultTraceFault (input divisor number) (input choice number) (input origin number)
    (state accepted number 0) (strategy run 0 (device true)
      (next accepted (trace-result 1 (add state.accepted 1) 0 0))
      (intent result (div (trace-result 2 10 input.choice input.origin) input.divisor))))`);
  const rows = [[2, 65535, 4294967295], [0, 1, 2], [2, -1, 0], [2, 0.5, 0], [2, 65536, 0], [2, 0, -1], [2, 0, 0.5], [2, 0, 4294967296], [2, 0, 0]];
  const outcomes = native(t, bytes, 'divisor,choice,origin', rows.map(row => row.join(',')));
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath)); t.after(() => runtime.dispose());
  runtime.load(bytes); runtime.addCapability('actuator', 'result', 'number'); runtime.activate();
  let accepted = 0, prior;
  for (const [index, [divisor, choice, origin]] of rows.entries()) {
    runtime.setNumber('divisor', divisor); runtime.setNumber('choice', choice); runtime.setNumber('origin', origin);
    if (index === 0 || index === rows.length - 1) {
      runtime.tick(); accepted++; prior = runtime.trace;
      assert.deepEqual(prior.resultTrace, [{ site: 1, choice: 0, origin: 0 }, { site: 2, choice, origin }]);
      assert.deepEqual(outcomes[index].trace.resultTrace, prior.resultTrace);
    } else {
      assert.throws(() => runtime.tick(), index === 1 ? /division/ : /result-trace-out-of-range/);
      assert.equal(outcomes[index].status, 'ERROR');
      assert.deepEqual(runtime.trace, prior);
    }
    assert.equal(runtime.stateNumber('accepted'), accepted);
    assert.equal(runtime.journalLength, accepted);
  }
});

test('GF-TEST-result-trace-loader: profile, site, truncation and typed stack are validated before activation', async t => {
  const bytes = gfb('(module TraceLoader (strategy run 0 (device true) (intent result (trace-result 1 true 0 0))))');
  const expression = Buffer.concat([Buffer.from([1, 1, 2]), Buffer.alloc(8), Buffer.from([2]), Buffer.alloc(8), Buffer.from([56, 1, 0, 0, 0])]);
  const at = bytes.indexOf(expression); assert.notEqual(at, -1);
  const replace = (code, version = 3) => {
    const prefix = Buffer.from(bytes.subarray(0, at)); prefix.writeUInt16LE(version, 4); prefix.writeUInt32LE(code.length, at - 4);
    return Buffer.concat([prefix, Buffer.from(code), bytes.subarray(at + expression.length)]);
  };
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath)); t.after(() => runtime.dispose());
  for (const invalid of [replace(expression, 1), replace(expression, 2), replace([...expression.subarray(0, -4), 0, 0, 0, 0]), replace(expression.subarray(0, -1)), replace([56, 1, 0, 0, 0]), replace(expression.subarray(2)), replace([1, 1, 1, 1, 1, 1, 56, 1, 0, 0, 0]), replace([1, 1, 30, 2, 0, ...expression])]) {
    assert.throws(() => runtime.load(invalid));
    assert.equal(native(t, invalid, 'unused', ['0'])[0].phase, 'load');
  }
  for (const form of ['(trace-result 0 true 0 0)', '(trace-result 4294967296 true 0 0)', '(trace-result 1 true false 0)', '(trace-result 1 true 0)']) {
    assert.throws(() => gfb(`(module Invalid (strategy run 0 (device true) (intent result ${form})))`));
  }
});
