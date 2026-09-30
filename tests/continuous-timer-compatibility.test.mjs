import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

// Exact historical consumer, not a reconstruction of its validator:
// https://github.com/callin2/ghostflow-language/blob/410e8c6e6340684c5639fdf76e5ac7de23a6ff26/runtimes/wasm/control-runtime.mjs
// Git blob 590a881cc218f7f2843fb8af29f9118dc09ddd55.
const frozen = fs.readFileSync(new URL('./fixtures/continuous-timer/legacy-control-runtime.mjs.txt', import.meta.url));
assert.equal(createHash('sha256').update(frozen).digest('hex'),
  'aeacafae2b8b62e538280feee7e9c56861d8a615960b1a5be03ead888751e992');
// Resolve only import locations to today's test dependencies; retain the old
// consumer's complete validation and activation code without semantic edits.
const origin = new URL('../runtimes/wasm/control-runtime.mjs', import.meta.url);
const executable = frozen.toString('utf8').replace(/from '(\.\/[^']+)'/g,
  (_, specifier) => `from '${new URL(specifier, origin).href}'`);
const { ControlRuntime: LegacyControlRuntime } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);

test('T01 compatibility: old consumer rejects continuous descriptors before either VM is created', async t => {
  const artifact = await compileSource(`control UnsupportedContinuous {
    input hot: Bool;
    timer hot_for = continuous_true(hot);
    output ready: Bool;
    ready <- hot_for >= 1ms;
  }`, { filename: 'unsupported-continuous.ghost' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v1');
  assert.deepEqual(artifact.manifest.timers, [{ name: 'hot_for', mode: 'continuous-true', clockInput: '__gf_now_ms' }]);
  const vm = t.mock.method(GhostFlowRuntime, 'instantiate', () => { throw new Error('VM creation reached'); });
  const framed = t.mock.method(FramedGhostFlowRuntime, 'instantiate', () => { throw new Error('framed VM creation reached'); });
  for (const entry of ['instantiate', 'instantiateFramed']) {
    await assert.rejects(() => LegacyControlRuntime[entry](new Uint8Array(), artifact), error => {
      assert.equal(error.constructor, Error);
      assert.equal(error.message, 'manifest.timers[0] has unknown key mode');
      return true;
    });
  }
  assert.equal(vm.mock.callCount(), 0);
  assert.equal(framed.mock.callCount(), 0);
});

test('T01 compatibility: old and new consumers execute the unchanged legacy elapsed descriptor', async t => {
  const artifact = await compileSource(`control SupportedElapsed {
    input hot: Bool;
    state phase: Bool = false;
    timer age = elapsed(phase);
    phase' = hot;
    output ready: Bool;
    ready <- age >= 8ms;
    output age_ms: Duration;
    age_ms <- age;
  }`, { filename: 'supported-elapsed.ghost' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v1');
  assert.deepEqual(artifact.manifest.timers, [{ name: 'age', state: 'phase', clockInput: '__gf_now_ms' }]);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const expected = [{ age: 0, ready: false }, { age: 5, ready: false }, { age: 10, ready: true }, { age: 10, ready: true }];
  for (const consumer of [LegacyControlRuntime, ControlRuntime]) {
    const runtime = await consumer.instantiate(wasm, artifact);
    t.after(() => runtime.dispose());
    const observed = [[0, true], [5, true], [10, false], [20, false]].map(([nowMs, hot]) => {
      const { vm } = runtime.step({ nowMs, inputs: { hot } });
      return { age: vm.safe.age_ms, ready: vm.safe.ready };
    });
    assert.deepEqual(observed, expected);
  }
});
