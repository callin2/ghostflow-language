import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target/release/examples/run');
const channels = Array.from({ length: 8 }, (_, index) => index + 1);
const names = prefix => channels.map(channel => `${prefix}${channel}`);

const source = `control EightChannelBench {
  input ${names('DI').join(', ')}: Bool;
  output ${names('RO').join(', ')}: Bool;
  ${channels.map(channel => `RO${channel} <- DI${channel};`).join('\n  ')}
}`;

const vectors = [
  // Exhaust the full 2^8 input space, including all-off/on and alternating bits.
  ...Array.from({ length: 256 }, (_, mask) =>
    channels.map((_, index) => Boolean(mask & (1 << index)))),
];

function observable(trace) {
  return {
    tick: trace.tick,
    strategy: trace.strategy,
    inputs: trace.inputs,
    stateBefore: trace.stateBefore,
    stateAfter: trace.stateAfter,
    requested: trace.requested,
    safe: trace.safe,
    faults: trace.faults,
  };
}

test('GF-TEST-output-native-wasm-differential: all 8DI vectors produce identical 8RO traces', async t => {
  assert.ok(fs.existsSync(wasmPath), 'release WASM artifact is required; run the full language verifier');
  assert.ok(fs.existsSync(nativePath), 'release native runner is required; run the full language verifier');
  const compiled = await compileSource(source, { filename: 'eight-channel-conformance.ghost' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-output-conformance-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'eight-channel.gfb');
  const csvPath = path.join(temporary, 'inputs.csv');
  fs.writeFileSync(modulePath, compiled.bytes);
  fs.writeFileSync(csvPath, `${names('DI').join(',')}\n${vectors.map(vector => vector.join(',')).join('\n')}\n`);

  const native = execFileSync(nativePath, [modulePath, csvPath], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  const wasm = await ControlRuntime.instantiate(fs.readFileSync(wasmPath), compiled);
  try {
    assert.equal(wasm.runtime.intentBool('RO1'), undefined, 'activation must not invent a pre-scan intent');
    const browser = vectors.map((vector, index) => wasm.step({
      nowMs: index,
      inputs: Object.fromEntries(names('DI').map((name, input) => [name, vector[input]])),
    }).vm);
    assert.deepEqual(browser.map(observable), native.map(observable));
    for (const [index, trace] of browser.entries()) {
      assert.deepEqual(names('RO').map(name => trace.requested[name]), vectors[index]);
      assert.deepEqual(names('RO').map(name => trace.safe[name]), vectors[index]);
      assert.deepEqual(trace.faults, []);
    }
  } finally {
    wasm.dispose();
  }
});
