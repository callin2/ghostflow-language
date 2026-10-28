import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const artifact = await compileSource(`# Elapsed clock admission

[Compiler correctness intent and clock boundary scope](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6482980280).

\`\`\`ghost
control ElapsedClockAdmission {
  input request: Bool;
  state held: Bool = false;
  state accepted: Int = 0;
  held' = request |> recover(false);
  accepted' = accepted + 1;
  timer age = elapsed(held);
  output age_ms: Duration;
  output held_output: Bool;
  output accepted_count: Int;
  age_ms <- age;
  held_output <- held';
  accepted_count <- accepted';
}
\`\`\`
`, { filename: 'elapsed-clock-admission.ghost.md' });

function frame(nowMs, request, id) {
  return { nowMs, samples: {
    request: { epoch: 1, id, timestampMs: nowMs, quality: 'Good', value: request },
  } };
}

for (const entry of ['instantiate', 'instantiateFramed']) {
  test(`elapsed preserves integer milliseconds through the exact clock limit (${entry})`, async t => {
    const runtime = await ControlRuntime[entry](wasm, artifact);
    t.after(() => runtime.dispose());
    const steps = [
      [0, false], [0, false],
      [2147483647, false], [2147483648, false],
      [4294967295, false], [4294967296, false],
      [9007199254740989, false], [9007199254740990, false],
      [9007199254740991, false], [9007199254740991, false],
    ];
    const actual = steps.map(([nowMs, request], index) => runtime.step(frame(nowMs, request, index + 1)).vm.safe);
    assert.deepEqual(actual, [
      { age_ms: 0, held_output: false, accepted_count: 1 },
      { age_ms: 0, held_output: false, accepted_count: 2 },
      { age_ms: 2147483647, held_output: false, accepted_count: 3 },
      { age_ms: 2147483648, held_output: false, accepted_count: 4 },
      { age_ms: 4294967295, held_output: false, accepted_count: 5 },
      { age_ms: 4294967296, held_output: false, accepted_count: 6 },
      { age_ms: 9007199254740989, held_output: false, accepted_count: 7 },
      { age_ms: 9007199254740990, held_output: false, accepted_count: 8 },
      { age_ms: 9007199254740991, held_output: false, accepted_count: 9 },
      { age_ms: 9007199254740991, held_output: false, accepted_count: 10 },
    ]);
  });

  test(`elapsed initializes and resets without losing a millisecond near the clock limit (${entry})`, async t => {
    const runtime = await ControlRuntime[entry](wasm, artifact);
    t.after(() => runtime.dispose());
    const actual = [[9007199254740989, false], [9007199254740990, true],
      [9007199254740991, true], [9007199254740991, true]]
      .map(([nowMs, request], index) => runtime.step(frame(nowMs, request, index + 1)).vm.safe);
    assert.deepEqual(actual, [
      { age_ms: 0, held_output: false, accepted_count: 1 },
      { age_ms: 1, held_output: true, accepted_count: 2 },
      { age_ms: 1, held_output: true, accepted_count: 3 },
      { age_ms: 1, held_output: true, accepted_count: 4 },
    ]);
  });

  test(`rejected clocks preserve elapsed interval and accepted state for the next valid call (${entry})`, async t => {
    const runtime = await ControlRuntime[entry](wasm, artifact);
    t.after(() => runtime.dispose());
    assert.deepEqual(runtime.step(frame(100, true, 1)).vm.safe,
      { age_ms: 0, held_output: true, accepted_count: 1 });
    const attempts = [
      [99, 101, 1, 2],
      [-1, 102, 2, 3],
      [102.5, 103, 3, 4],
      [9007199254740992, 104, 4, 5],
      [Number.NaN, 105, 5, 6],
      [Number.POSITIVE_INFINITY, 106, 6, 7],
    ];
    for (const [invalid, nowMs, age, accepted] of attempts) {
      assert.throws(() => runtime.step({ nowMs: invalid }), /nowMs/);
      assert.deepEqual(runtime.step(frame(nowMs, true, accepted)).vm.safe,
        { age_ms: age, held_output: true, accepted_count: accepted });
    }
  });
}
