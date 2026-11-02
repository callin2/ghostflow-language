import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { observeRuntimeValues } from '../tools/source-trace.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `control ElapsedSnapshot {
  input request: Bool;
  state held: Bool = false;
  held' = request |> recover(false);
  timer age = elapsed(held);
  output age_ms: Duration;
  output held_output: Bool;
  age_ms <- age;
  held_output <- held';
}`;
const samples = [
  { nowMs: 100, request: false },
  { nowMs: 105, request: true },
  { nowMs: 105, request: true },
  { nowMs: 106, request: true },
  { nowMs: 109, request: false },
  { nowMs: 110, request: false },
];
const expected = [
  { expressionAge: 0, observedAge: 0, held: false },
  { expressionAge: 5, observedAge: 0, held: true },
  { expressionAge: 0, observedAge: 0, held: true },
  { expressionAge: 1, observedAge: 1, held: true },
  { expressionAge: 4, observedAge: 0, held: false },
  { expressionAge: 1, observedAge: 1, held: false },
];

for (const entry of ['instantiate', 'instantiateFramed']) {
  test(`elapsed expression keeps the old interval while the committed observation starts the new interval (${entry})`, async t => {
    const artifact = await compileSource(source, { filename: 'elapsed-snapshot.ghost' });
    const runtime = await ControlRuntime[entry](wasm, artifact);
    t.after(() => runtime.dispose());
    const actual = samples.map(({ nowMs, request }, index) => {
      const { vm } = runtime.step({ nowMs, samples: {
        request: { epoch: 1, id: index + 1, timestampMs: nowMs, quality: 'Good', value: request },
      } });
      const observation = observeRuntimeValues(artifact.traceMetadata, vm);
      const timer = observation.values.find(value => value.kind === 'timer' && value.name === 'age');
      assert.ok(timer, 'the execution exposes the source timer observation');
      assert.equal(timer.valueType, 'Duration');
      assert.equal(timer.unit, 'ms');
      const state = observation.values.find(value => value.kind === 'state' && value.name === 'held');
      assert.ok(state, 'the execution exposes the committed source state');
      assert.equal(vm.safe.held_output, state.value);
      return { expressionAge: vm.safe.age_ms, observedAge: timer.value, held: state.value };
    });
    assert.deepEqual(actual, expected);
  });
}
