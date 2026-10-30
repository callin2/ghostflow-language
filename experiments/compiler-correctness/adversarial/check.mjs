import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../../../tools/toolchain.mjs';
import { ControlRuntime } from '../../../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../../../runtimes/wasm/ghostflow-runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const doc = code => `# Compiler correctness adversarial example\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const out = path.join(here, 'evidence');
fs.mkdirSync(out, { recursive: true });
const results = [];
const selected = process.argv.find(argument => argument.startsWith('--only='))?.slice(7).split(',');
const record = (name, value) => fs.writeFileSync(path.join(out, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');

async function artifact(name, code, options = {}) {
  const source = doc(code);
  record(`${name}.ghost.md`, source);
  const compiled = await compileSource(source, { filename: `${name}.ghost.md`, ...options });
  record(`${name}.gfb`, compiled.bytes);
  record(`${name}.manifest.json`, compiled.manifest);
  return compiled;
}

async function check(name, run) {
  if (selected && !selected.includes(name)) return;
  try { results.push({ name, passed: true, evidence: await run() }); }
  catch (error) { results.push({ name, passed: false, error: error.message, stack: error.stack }); }
}

async function execute(name, code, frames, inspect, options = {}) {
  const compiled = await artifact(name, code, options);
  const traces = [];
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    for (const frame of frames) {
      try { traces.push({ ok: true, vm: structuredClone(runtime.step(frame).vm) }); }
      catch (error) { traces.push({ ok: false, error: error.message }); }
    }
    record(`${name}.traces.json`, traces);
    inspect(traces);
    return { sourceSha256: digest(doc(code)), artifactSha256: digest(compiled.bytes), frames: frames.length };
  } finally { runtime.dispose(); }
}

const once = [{ nowMs: 0 }];

await check('binary64-constant-and-state', () => execute('binary64-constant-and-state', `control Precision {
  state a: Number = 16777216.0;
  state one: Number = 1.0;
  state third: Number = 0.3333333333333333;
  output constant, dynamic, rational: Number;
  constant <- (16777216.0 + 1.0) - 16777216.0;
  dynamic <- (a + one) - a;
  rational <- third * 3.0;
}`, once, traces => assert.deepEqual(traces[0].vm.safe, { constant: 1, dynamic: 1, rational: 1 })));

await check('constant-folded-conversions', () => execute('constant-folded-conversions', `control Folded {
  state high: Int = 2147483647;
  state n: Number = 2147483647.75;
  output folded, dynamic: Number;
  output truncated_constant, truncated_dynamic: Int;
  folded <- number(2147483647);
  dynamic <- number(high);
  truncated_constant <- int_trunc(2147483647.75);
  truncated_dynamic <- int_trunc(n);
}`, once, traces => assert.deepEqual(traces[0].vm.safe, {
  folded: 2147483647, dynamic: 2147483647, truncated_constant: 2147483647, truncated_dynamic: 2147483647,
})));

await check('int-boundary-oracle-and-atomicity', async () => {
  const values = [-2147483648, -2147483647, -16777217, -46341, -7, -1, 0, 1, 7, 46341, 16777217, 2147483646, 2147483647];
  const pairs = values.flatMap(a => [-2147483648, -1, 0, 1, 46341, 2147483647].map(b => [a, b]));
  const operations = [['+', (a, b) => a + b, 'integer-overflow'], ['*', (a, b) => a * b, 'integer-overflow'],
    ['div', (a, b) => a / b, 'integer-division-by-zero'], ['%', (a, b) => a % b, 'integer-division-by-zero']];
  let rows = 0;
  for (const [operator, oracle, zeroFault] of operations) {
    const name = `integer-${operator === '+' ? 'add' : operator === '*' ? 'multiply' : operator === '%' ? 'remainder' : 'divide'}`;
    const code = `control IntegerOracle {
      input left, right: Int;
      let a = left |> recover(0);
      let b = right |> recover(1);
      state committed: Int = 0;
      committed' = committed + 1;
      output value, accepted: Int;
      value <- a ${operator} b;
      accepted <- committed';
    }`;
    const frames = pairs.map(([a, b], id) => ({ nowMs: id, samples: Object.fromEntries([['left', a], ['right', b]].map(([name, value]) => [name, { epoch: 1, id: id + 1, timestampMs: id, quality: 'Good', value }])) }));
    await execute(name, code, frames, traces => {
      let accepted = 0;
      traces.forEach((trace, i) => {
        const [a, b] = pairs[i].map(BigInt);
        const quotientOverflow = operator === 'div' && a === -2147483648n && b === -1n;
        const zero = ['div', '%'].includes(operator) && b === 0n;
        const expected = zero || quotientOverflow ? undefined : oracle(a, b);
        const overflow = quotientOverflow || expected !== undefined && (expected < -2147483648n || expected > 2147483647n);
        if (zero || overflow) {
          assert.equal(trace.ok, false, `${name} ${a} ${operator} ${b} rejects`);
          assert.match(trace.error, new RegExp(zero ? zeroFault : 'integer-overflow'));
        } else {
          accepted++;
          assert.equal(trace.ok, true, `${name} ${a} ${operator} ${b} succeeds`);
          assert.equal(trace.vm.safe.value, Number(expected));
          assert.equal(trace.vm.safe.accepted, accepted);
          assert.equal(trace.vm.stateBefore.committed, accepted - 1);
        }
      });
    });
    rows += pairs.length;
  }
  return { rows, oracle: 'independent BigInt arithmetic with explicit i32 range and fault contracts' };
});

await check('left-to-right-fault-selection', () => execute('left-to-right-fault-selection', `control FaultOrder {
  input choose: Bool;
  state zero: Number = 0.0;
  state too_big: Number = 2147483648.0;
  state committed: Int = 0;
  committed' = committed + 1;
  output value: Bool;
  value <- if (choose |> recover(false)) then (int_exact(1.0 / zero) == 0 || int_exact(too_big) == 0)
    else (int_exact(too_big) == 0 || int_exact(1.0 / zero) == 0);
}`, [false, true].map((value, i) => ({ nowMs: i, samples: { choose: { epoch: 1, id: i + 1, timestampMs: i, quality: 'Good', value } } })), traces => {
  assert.equal(traces[0].ok, false);
  assert.match(traces[0].error, /integer-conversion-out-of-range/);
  assert.equal(traces[1].ok, false);
  assert.match(traces[1].error, /division by zero/);
}));

await check('short-circuit-function-and-result', () => execute('short-circuit-function-and-result', `fn guarded(enabled: Bool, divisor: Number) -> Number { if enabled then 1.0 / divisor else 7.0 }
fn unsafe(value: Number) -> Number { 1.0 / value }
control UnselectedFaults {
  state zero: Number = 0.0;
  let unavailable: Result<Number, SensorFault> = fault(Disconnected);
  let transform = map(unsafe) >> recover(9.0);
  output conditional, recovered: Number;
  output conjunction, disjunction: Bool;
  conditional <- guarded(false, zero);
  recovered <- unavailable |> transform;
  conjunction <- false && (1.0 / zero > 0.0);
  disjunction <- true || (1.0 / zero > 0.0);
}`, once, traces => assert.deepEqual(traces[0].vm.safe, { conditional: 7, recovered: 9, conjunction: false, disjunction: true })));

await check('timer-reset-and-same-time', () => execute('timer-reset-and-same-time', `control TimerBoundary {
  input enabled: Bool;
  let active = enabled |> recover(false);
  timer hot_for = continuous_true(active);
  output age: Duration;
  output done: Bool;
  age <- hot_for;
  done <- hot_for >= 1000ms;
}`, [[0, true], [999, true], [1000, true], [1000, true], [1001, false], [9000, true], [9999, true], [10000, true]].map(([nowMs, value], i) => ({ nowMs, samples: { enabled: { epoch: 1, id: i + 1, timestampMs: nowMs, quality: 'Good', value } } })), traces => assert.deepEqual(traces.map(x => x.vm.safe), [
  { age: 0, done: false }, { age: 999, done: false }, { age: 1000, done: true }, { age: 1000, done: true },
  { age: 0, done: false }, { age: 0, done: false }, { age: 999, done: false }, { age: 1000, done: true },
])));

await check('composition-independent-instance-state', async () => {
  const cell = doc(`control Cell { input enabled: Bool; state total: Int = 0; total' = if (enabled |> recover(false)) then total + 1 else total; output value: Int; value <- total'; }`);
  record('cell.ghost.md', cell);
  const imports = `import Cell from "./cell.ghost.md" revision "adversarial-v1" sha256 "${digest(cell)}";`;
  const connections = ['instance east: Cell;', 'instance west: Cell;', 'connect east.enabled <- left;', 'connect west.enabled <- right;', 'connect a <- east.value;', 'connect b <- west.value;'];
  const frames = [[true, false], [true, false], [false, true], [false, false]].map(([left, right], i) => ({ nowMs: i,
    samples: Object.fromEntries(Object.entries({ left, right }).map(([name, value]) => [name, { epoch: 1, id: i + 1, timestampMs: i, quality: 'Good', value }])) }));
  for (const reversed of [false, true]) {
    const code = `${imports}\ncontrol Pair { input left, right: Bool; output a, b: Int; ${(reversed ? [...connections].reverse() : connections).join('\n')} }`;
    await execute(`composition-${reversed ? 'reverse' : 'forward'}`, code, frames, traces => {
      assert.deepEqual(traces.map(trace => trace.vm.safe), [{ a: 1, b: 0 }, { a: 2, b: 0 }, { a: 2, b: 1 }, { a: 2, b: 1 }]);
    }, { sourceClosure: [{ filename: 'cell.ghost.md', revision: 'adversarial-v1', text: cell }] });
  }
  return { orders: 2, framesPerOrder: 4 };
});

await check('percent-runtime-domain', () => execute('percent-runtime-domain', `control PercentDomain {
  state a: Percent = 90%;
  output above, below: Percent;
  above <- a + 20%;
  below <- a - 100%;
}`, once, traces => {
  if (traces[0].ok) for (const value of Object.values(traces[0].vm.safe)) {
    assert.ok(value >= 0 && value <= 100, `Percent results must remain in 0..100, observed ${JSON.stringify(traces[0])}`);
  }
}));

await check('percent-state-domain', () => execute('percent-state-domain', `control PercentState {
  state amount: Percent = 90%;
  amount' = amount + 20%;
  output value: Percent;
  value <- amount';
}`, [{ nowMs: 0 }, { nowMs: 1 }], traces => {
  for (const trace of traces.filter(trace => trace.ok)) {
    assert.ok(trace.vm.stateAfter.amount >= 0 && trace.vm.stateAfter.amount <= 100,
      `committed Percent state exceeds its domain, observed ${JSON.stringify(trace)}`);
  }
}));

await check('percent-boundaries-branch-and-ratio', () => execute('percent-boundaries-branch-and-ratio', `fn raise(value: Percent) -> Percent { value + 20% }
control PercentMatrix {
  input observed: Percent;
  input enabled: Bool;
  let a = observed |> recover(0%);
  let active = enabled |> recover(false);
  output value: Percent;
  output ratio: Number;
  value <- if active then raise(a) else 0.5%;
  ratio <- a / 0.5%;
}`, [[0, true], [79.5, true], [80, true], [90, false], [90, true], [100, true]].map(([value, enabled], i) => ({ nowMs: i,
  samples: Object.fromEntries(Object.entries({ observed: value, enabled }).map(([name, value]) => [name, { epoch: 1, id: i + 1, timestampMs: i, quality: 'Good', value }])) })), traces => {
  assert.deepEqual(traces.slice(0, 4).map(trace => trace.vm.safe), [
    { value: 20, ratio: 0 }, { value: 99.5, ratio: 159 }, { value: 100, ratio: 160 }, { value: 0.5, ratio: 180 },
  ]);
  for (const trace of traces.slice(4).filter(trace => trace.ok)) {
    assert.ok(trace.vm.safe.value >= 0 && trace.vm.safe.value <= 100,
      `selected Percent function result exceeds its domain, observed ${JSON.stringify(trace)}`);
  }
}));

await check('percent-constant-domain', async () => {
  const code = 'control PercentConstant { output value: Percent; value <- 90% + 20%; }';
  record('percent-constant-domain.ghost.md', doc(code));
  await assert.rejects(() => compileSource(doc(code), { filename: 'percent-constant-domain.ghost.md' }), /Percent constant must be between 0% and 100%/);
  return { diagnostic: 'Percent constant must be between 0% and 100%' };
});

await check('artifact-mutation-detection', async () => {
  const compiled = await artifact('mutation-add', 'control Mutation { output value: Number; value <- 8.0 + 3.0; }');
  const needle = Buffer.alloc(19);
  needle[0] = 2; needle.writeDoubleLE(8, 1); needle[9] = 2; needle.writeDoubleLE(3, 10); needle[18] = 19;
  const at = compiled.bytes.indexOf(needle);
  assert.notEqual(at, -1, 'the targeted addition is present in this artifact');
  assert.equal(compiled.bytes.indexOf(needle, at + 1), -1, 'the targeted addition is unique');
  const mutant = Buffer.from(compiled.bytes);
  mutant[at + 18] = 20;
  record('mutation-subtract.gfb', mutant);
  const observations = [];
  for (const bytes of [compiled.bytes, mutant]) {
    const runtime = await GhostFlowRuntime.instantiate(wasm);
    try {
      runtime.load(bytes); runtime.addCapability('actuator', 'value', 'number'); runtime.activate(); runtime.tick();
      observations.push(runtime.intentNumber('value'));
    } finally { runtime.dispose(); }
  }
  assert.deepEqual(observations, [11, 5]);
  assert.throws(() => assert.equal(observations[1], 11));
  record('mutation-results.json', { observations, expected: 11, killed: true });
  return { observations, expected: 11, killed: true };
});

const report = { format: 'compiler-correctness-adversarial-v1', at: new Date().toISOString(), wasmSha256: digest(wasm),
  scope: 'finite independent semantic checks through canonical compileSource, emitted GFB and actual WASM; no universal correctness claim', results,
  passed: results.filter(x => x.passed).length, failed: results.filter(x => !x.passed).length };
record('results.json', report);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failed ? 1 : 0;
