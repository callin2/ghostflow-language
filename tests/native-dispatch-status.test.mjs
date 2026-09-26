import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { NativeDispatchError } from '../runtimes/wasm/native-dispatch.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const artifact = await compileSource('```ghost\ncontrol DispatchStatus {\n input divisor: Number;\n state count: Number = 0.0; count\' = count + 1.0;\n output guard: Int; guard <- 1 div int_exact(divisor);\n}\n```\n', { filename: 'dispatch-status.ghost.md' });
const frame = divisor => ({ scanId: 0, logicalTimeMs: 0, inputs: [{ name: 'divisor', type: 'Number', value: divisor }] });
async function active(t, framed) {
  const runtime = await (framed ? FramedGhostFlowRuntime : GhostFlowRuntime).instantiate(wasm);
  const original = runtime.wasm;
  t.after(() => { runtime.wasm = original; runtime.dispose(); });
  runtime.load(artifact.bytes);
  runtime.addCapability('actuator', 'guard', 'int');
  runtime.activate();
  return { runtime, original };
}
function failure(operation, committed, cause) {
  let caught;
  assert.throws(operation, error => {
    assert.ok(error instanceof NativeDispatchError, `${error.constructor.name}: ${error.message}`);
    assert.equal(error.committed, committed);
    if (cause) assert.equal(error.cause, cause);
    caught = error;
    return true;
  });
  return caught;
}

test('framed encoding failure is known not committed and never invokes native scan', async t => {
  const { runtime, original } = await active(t, true);
  let calls = 0;
  runtime.wasm = { ...original, gf_frame_scan: (...args) => { calls++; return original.gf_frame_scan(...args); } };
  const error = failure(() => runtime.dispatch({ ...frame(1), logicalTimeMs: -1 }), false);
  assert.ok(error.cause instanceof RangeError);
  assert.equal(calls, 0);
  assert.equal(runtime.outcome, null);
});

test('framed allocation failure is known not committed and permits a valid retry', async t => {
  const { runtime, original } = await active(t, true);
  let calls = 0;
  runtime.wasm = { ...original, gf_alloc: () => 0, gf_frame_scan: (...args) => { calls++; return original.gf_frame_scan(...args); } };
  const error = failure(() => runtime.dispatch(frame(1)), false);
  assert.equal(error.cause.message, 'WASM allocation failed');
  assert.equal(calls, 0);
  runtime.wasm = original;
  assert.equal(runtime.scan(frame(1)).trace.stateAfter.count, 1);
});

for (const framed of [false, true]) {
  const mode = framed ? 'framed' : 'legacy';
  test(`${mode} actual native rejection stays uncommitted when its error getter throws`, async t => {
    const { runtime, original } = await active(t, framed);
    const cause = new Error('injected error getter failure');
    runtime.wasm = { ...original, [framed ? 'gf_frame_error_ptr' : 'gf_last_error_ptr']: () => { throw cause; } };
    if (!framed) runtime.setNumber('divisor', 0);
    failure(() => framed ? runtime.dispatch(frame(0)) : runtime.tick(), false, cause);
    runtime.wasm = original;
    if (framed) assert.equal(runtime.scan(frame(1)).trace.stateAfter.count, 1);
    else {
      assert.equal(runtime.journalLength, 0);
      runtime.setNumber('divisor', 1); runtime.tick();
      assert.equal(runtime.trace.stateAfter.count, 1);
    }
  });

  test(`${mode} actual WASM trap during dispatch has unknown commit status`, async t => {
    const { runtime, original } = await active(t, framed);
    // A real WASM `unreachable` instruction replaces only the dispatch export.
    const trapBytes = Uint8Array.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,7,8,1,4,116,114,97,112,0,0,10,5,1,3,0,0,11]);
    const { instance } = await WebAssembly.instantiate(trapBytes);
    runtime.wasm = { ...original, [framed ? 'gf_frame_scan' : 'gf_tick']: instance.exports.trap };
    if (!framed) runtime.setNumber('divisor', 1);
    const error = failure(() => framed ? runtime.dispatch(frame(1)) : runtime.tick(), null);
    assert.ok(error.cause instanceof WebAssembly.RuntimeError);
  });
}

test('framed positive native status survives cleanup failure with committed state intact', async t => {
  const { runtime, original } = await active(t, true);
  const cause = new Error('injected postcommit deallocation failure');
  runtime.wasm = { ...original, gf_dealloc: (...args) => { original.gf_dealloc(...args); throw cause; } };
  failure(() => runtime.dispatch(frame(1)), true, cause);
  runtime.wasm = original;
  assert.equal(runtime.outcome.trace.stateAfter.count, 1);
  assert.equal(runtime.outcome.trace.safe.guard, 1);
});

test('legacy invalid tick time is classified before native dispatch', async t => {
  const { runtime, original } = await active(t, false);
  let calls = 0;
  runtime.wasm = { ...original, gf_tick_at: (...args) => { calls++; return original.gf_tick_at(...args); } };
  const error = failure(() => runtime.tickAt(-1), false);
  assert.equal(error.message, 'invalid monotonic milliseconds');
  assert.equal(calls, 0);
  assert.equal(runtime.journalLength, 0);
});

test('framed recorded positive status overrides a contradictory typed cleanup error', async t => {
  const { runtime, original } = await active(t, true);
  const cause = new NativeDispatchError('misleading cleanup status', { committed: false });
  runtime.wasm = { ...original, gf_dealloc: (...args) => { original.gf_dealloc(...args); throw cause; } };
  failure(() => runtime.dispatch(frame(1)), true, cause);
  runtime.wasm = original;
  assert.equal(runtime.outcome.trace.stateAfter.count, 1);
});

test('framed recorded zero status overrides a contradictory typed error getter failure', async t => {
  const { runtime, original } = await active(t, true);
  const cause = new NativeDispatchError('misleading rejection status', { committed: true });
  runtime.wasm = { ...original, gf_frame_error_ptr: () => { throw cause; } };
  failure(() => runtime.dispatch(frame(0)), false, cause);
  runtime.wasm = original;
  assert.equal(runtime.scan(frame(1)).trace.stateAfter.count, 1);
});

test('framed outcome decoding failure retains positive native commit status', async t => {
  const { runtime } = await active(t, true);
  const cause = new SyntaxError('injected outcome decoding failure');
  Object.defineProperty(runtime, 'outcome', { configurable: true, get() { throw cause; } });
  failure(() => runtime.scan(frame(1)), true, cause);
  delete runtime.outcome;
  assert.equal(runtime.outcome.trace.stateAfter.count, 1);
});
