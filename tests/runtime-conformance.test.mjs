import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : ''));
const gfb = source => compile(parse(tokenize(source)));

// Feed identical deployed bytes and snapshots to two targets. The exact expected
// outcomes below remain an independent, hand-written oracle for their shared core.
async function differential(t, bytes, fields, rows, outputs = []) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-error-conformance-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'module.gfb');
  const csvPath = path.join(temporary, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(csvPath, `${fields.join(',')}\n${rows.map(row => fields.map(name => row[name] ?? '').join(',')).join('\n')}\n`);
  const native = execFileSync(nativePath, [modulePath, csvPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  const wasm = [];
  const errorOutcome = (phase, error) => ({ status: 'ERROR', phase, error: error.message, journalLength: runtime.journalLength });
  try { runtime.load(bytes); } catch (error) { wasm.push(errorOutcome('load', error)); }
  if (!wasm.length) {
    for (const [name, type] of outputs) runtime.addCapability('actuator', name, type);
    try { runtime.activate(); } catch (error) { wasm.push(errorOutcome('activate', error)); }
  }
  if (!wasm.length) {
    for (const row of rows) {
      runtime.clearInputs();
      for (const [name, value] of Object.entries(row)) {
        if (typeof value === 'boolean') runtime.setBool(name, value);
        else runtime.setNumber(name, value);
      }
      const previousTrace = runtime.trace;
      const previousIntents = outputs.map(([name, type]) => type === 'bool' ? runtime.intentBool(name) : runtime.intentNumber(name));
      try {
        runtime.tick();
        wasm.push({ status: 'OK', trace: runtime.trace });
      } catch (error) {
        wasm.push(errorOutcome('tick', error));
        assert.deepEqual(runtime.trace, previousTrace, 'a rejected tick cannot replace the committed trace');
        assert.deepEqual(outputs.map(([name, type]) => type === 'bool' ? runtime.intentBool(name) : runtime.intentNumber(name)), previousIntents,
          'a rejected tick cannot publish any partial output');
      }
    }
  }
  assert.deepEqual(wasm, native, 'native and release WASM must agree on exact OK/ERROR outcomes');
  return { outcomes: wasm, runtime };
}

test('GF-TEST-snapshot-commit: old reads, explicit next reads, and untouched states', async t => {
  const compiled = await compileSource(`control Snapshot {
    input enable: Bool;
    state left: Bool = false;
    state right: Bool = true;
    state untouched: Number = 7;
    let oldRight = right;
    left' = oldRight && enable;
    right' = left;
    output oldLeft, newLeft: Bool;
    oldLeft <- left;
    newLeft <- left';
  }`, { filename: 'snapshot.ghost' });
  const { outcomes, runtime } = await differential(t, compiled.bytes, ['enable'], [{ enable: true }, { enable: true }], [['oldLeft', 'bool'], ['newLeft', 'bool']]);
  assert.deepEqual(outcomes.map(row => row.trace.stateBefore), [
    { left: false, right: true, untouched: 7 }, { left: true, right: false, untouched: 7 },
  ]);
  assert.deepEqual(outcomes.map(row => row.trace.stateAfter), [
    { left: true, right: false, untouched: 7 }, { left: false, right: true, untouched: 7 },
  ]);
  assert.deepEqual(outcomes.map(row => row.trace.requested), [{ oldLeft: false, newLeft: true }, { oldLeft: true, newLeft: false }]);
  assert.equal(runtime.stateNumber('untouched'), 7);
});

for (const phase of ['transition', 'intent']) {
  for (const [operator, bad, expected] of [['div', 0, 'division by zero'], ['mul', Number.MAX_VALUE, 'non-finite arithmetic result']]) {
    test(`GF-TEST-error-atomicity: ${phase} ${expected}`, async t => {
      const expression = `(${operator} 2 input.divisor)`;
      const bytes = gfb(`(module Arithmetic (input divisor number) (state count number 0) (state value number 5)
        (strategy run 0 (device true)
          (next count (add state.count 1))
          (next value ${phase === 'transition' ? expression : '6'})
          (intent first next.count)
          (intent result ${phase === 'intent' ? expression : 'next.value'})))`);
      const { outcomes, runtime } = await differential(t, bytes, ['divisor'], [
        { divisor: bad }, { divisor: 2 }, { divisor: bad }, { divisor: 2 },
      ], [['first', 'number'], ['result', 'number']]);
      assert.deepEqual(outcomes.filter(row => row.status === 'ERROR'), [
        { status: 'ERROR', phase: 'tick', error: expected, journalLength: 0 },
        { status: 'ERROR', phase: 'tick', error: expected, journalLength: 1 },
      ]);
      const traces = outcomes.filter(row => row.status === 'OK').map(row => row.trace);
      assert.deepEqual(traces.map(trace => trace.tick), [1, 2]);
      assert.deepEqual(traces.map(trace => trace.stateBefore.count), [0, 1]);
      assert.deepEqual(traces.map(trace => trace.stateAfter.count), [1, 2]);
      const committedValue = phase === 'transition' ? (operator === 'div' ? 1 : 4) : 6;
      assert.deepEqual(traces.map(trace => trace.stateBefore.value), [5, committedValue]);
      assert.deepEqual(traces.map(trace => trace.stateAfter.value), [committedValue, committedValue]);
      assert.deepEqual(traces.map(trace => trace.safe.first), [1, 2]);
      assert.deepEqual(traces.map(trace => trace.requested.result), [operator === 'div' ? 1 : 4, operator === 'div' ? 1 : 4]);
      assert.equal(runtime.stateNumber('count'), 2);
    });
  }
}

test('GF-TEST-generated-input-error: omitted generated clock rejects and recovers without defaults', async t => {
  const bytes = gfb(`(module Clock (input __gf_now_ms number) (input enabled bool)
    (state count number 0) (strategy run 0 (device true)
      (next count (add state.count 1)) (intent result input.enabled)))`);
  const { outcomes } = await differential(t, bytes, ['__gf_now_ms', 'enabled'], [
    { enabled: true }, { __gf_now_ms: 10, enabled: true },
    { __gf_now_ms: 9, enabled: false }, { __gf_now_ms: 11, enabled: false },
  ], [['result', 'bool']]);
  assert.deepEqual(outcomes.filter(row => row.status === 'ERROR'), [
    { status: 'ERROR', phase: 'tick', error: 'missing input __gf_now_ms', journalLength: 0 },
    { status: 'ERROR', phase: 'tick', error: 'monotonic clock moved backwards', journalLength: 1 },
  ]);
  assert.deepEqual(outcomes.filter(row => row.status === 'OK').map(row => [row.trace.tick, row.trace.stateAfter.count, row.trace.safe.result]), [[1, 1, true], [2, 2, false]]);
});

test('GF-TEST-safety-fixed-point: snapshot rounds are false-only and independent of constraint order', async t => {
  const constraints = ['(requires pump valve)', '(requires valve permit)', '(mutex valve peer)'];
  for (const order of [constraints, [...constraints].reverse()]) {
    const bytes = gfb(`(module Safety (input enabled bool)
      (strategy run 0 (device true) (intent pump input.enabled) (intent valve true)
        (intent permit false) (intent peer true) (intent untouched true)) ${order.join(' ')})`);
    const { outcomes } = await differential(t, bytes, ['enabled'], [{ enabled: true }, { enabled: false }],
      ['pump', 'valve', 'permit', 'peer', 'untouched'].map(name => [name, 'bool']));
    for (const [index, { trace }] of outcomes.entries()) {
      assert.deepEqual(trace.requested, { pump: index === 0, valve: true, permit: false, peer: true, untouched: true });
      assert.deepEqual(trace.safe, { pump: false, valve: false, permit: false, peer: false, untouched: true });
      assert.ok(trace.faults.some(fault => fault.includes('mutex')));
      assert.ok(trace.faults.some(fault => fault.includes('requires')));
    }
  }
});

for (const [name, query, expected] of [
  ['no match', '(strategy run 0 (device false))', 'no device strategy matches capabilities'],
  ['priority tie', '(strategy one 0 (device true)) (strategy two 0 (device true))', 'ambiguous'],
]) {
  test(`GF-TEST-activation-error: ${name}`, async t => {
    const { outcomes } = await differential(t, gfb(`(module Activation ${query})`), [], []);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].status, 'ERROR');
    assert.equal(outcomes[0].phase, 'activate');
    assert.ok(outcomes[0].error.includes(expected));
  });
}

test('GF-TEST-load-error: every truncation and invalid format agree across targets', async t => {
  const valid = gfb('(module Tiny (strategy run 0 (device true) (intent result true)))');
  for (let end = 0; end < valid.length; end++) {
    const { outcomes } = await differential(t, valid.subarray(0, end), [], []);
    assert.equal(outcomes[0].status, 'ERROR', `truncation ${end}`);
    assert.equal(outcomes[0].phase, 'load');
  }
  for (const offset of [0, 4]) {
    const bytes = Buffer.from(valid); bytes[offset] = 255;
    const { outcomes } = await differential(t, bytes, [], []);
    assert.equal(outcomes[0].status, 'ERROR');
    assert.equal(outcomes[0].phase, 'load');
  }
});

test('GF-TEST-literate-runtime-equivalence: equivalent canonical literate documents deploy identical GFB and traces', async t => {
  const source = 'control Literate { input enabled: Bool; output result: Bool; result <- enabled; }';
  const first = await compileSource(`# Controller\n\n\`\`\`ghost\n${source}\n\`\`\`\n`, { filename: 'first.ghost.md' });
  const second = await compileSource(`# Same executable control, with independent intent prose.\n\n\`\`\`ghost\n${source}\n\`\`\`\n`, { filename: 'second.ghost.md' });
  assert.deepEqual(first.bytes, second.bytes);
  const firstRun = await differential(t, first.bytes, ['enabled'], [{ enabled: false }, { enabled: true }], [['result', 'bool']]);
  const secondRun = await differential(t, second.bytes, ['enabled'], [{ enabled: false }, { enabled: true }], [['result', 'bool']]);
  assert.deepEqual(secondRun.outcomes, firstRun.outcomes);
  assert.deepEqual(firstRun.outcomes.map(row => row.trace.safe.result), [false, true]);
});

// Independent minimal GFB envelope: no compiler-generated query can contain
// these malformed postfix programs. Counts and sizes follow docs/BYTECODE.md.
function queryArtifact(query) {
  const u16 = value => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
  const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const string = text => Buffer.concat([u16(Buffer.byteLength(text)), Buffer.from(text)]);
  return Buffer.concat([
    Buffer.from('GFB1'), u16(1), string('QueryProbe'), u32(1), u16(1), string('enabled'), Buffer.from([1]), u16(0), u16(1),
    string('run'), u32(0), u32(query.length), Buffer.from(query), u16(0), u16(0), u16(0),
  ]);
}

test('GF-TEST-query-verifier: exact postfix errors and stack maximum across release targets', async t => {
  const cases = [
    [[], 'query result count'], [[255], 'query opcode'], [[4], 'query underflow'],
    [[5, 2], 'invalid query bool or stack limit'], [[2, 0, 0], 'query group'],
    [[5, 1, 3, 2, 0], 'query group'], [[5, 1, 5, 0], 'query result count'],
    [Array.from({ length: 129 }, () => [5, 1]).flat(), 'invalid query bool or stack limit'],
  ];
  for (const [query, expected] of cases) {
    const { outcomes } = await differential(t, queryArtifact(query), [], []);
    assert.deepEqual(outcomes, [{ status: 'ERROR', phase: 'load', error: expected, journalLength: 0 }]);
  }
  // The maximum 128 stack entries reduce to one true result and activate.
  const query = [...Array.from({ length: 128 }, () => [5, 1]).flat(), 2, 128, 0];
  const { outcomes } = await differential(t, queryArtifact(query), ['enabled'], [{ enabled: true }]);
  assert.equal(outcomes[0].status, 'OK');
  assert.equal(outcomes[0].trace.strategy, 'run');
  assert.deepEqual(outcomes[0].trace.safe, {});
});

test('GF-TEST-short-circuit-if: unselected arithmetic fault permits state and intent commit', async t => {
  const bytes = gfb(`(module ShortCircuit (input divisor number) (state count number 0)
    (strategy run 0 (device true) (next count (add state.count 1))
      (intent result (if true 7 (div 1 input.divisor)))))`);
  const { outcomes } = await differential(t, bytes, ['divisor'], [{ divisor: 0 }, { divisor: 1 }], [['result', 'number']]);
  assert.equal(outcomes[0].trace.stateBefore.count, 0);
  assert.equal(outcomes[0].trace.stateAfter.count, 1);
  assert.equal(outcomes[0].trace.safe.result, 7);
  assert.equal(outcomes[1].trace.stateBefore.count, 1);
  assert.equal(outcomes[1].trace.stateAfter.count, 2);
  assert.equal(outcomes[1].trace.safe.result, 7);
});

test('GF-TEST-selected-if-error: selected arithmetic fault rejects without partial commit', async t => {
  const bytes = gfb(`(module SelectedFault (input divisor number) (state count number 0)
    (strategy run 0 (device true) (next count (add state.count 1))
      (intent result (if false 7 (div 1 input.divisor)))))`);
  const { outcomes } = await differential(t, bytes, ['divisor'], [{ divisor: 0 }, { divisor: 1 }], [['result', 'number']]);
  assert.deepEqual(outcomes[0], { status: 'ERROR', phase: 'tick', error: 'division by zero', journalLength: 0 });
  assert.equal(outcomes[1].trace.stateBefore.count, 0);
  assert.equal(outcomes[1].trace.stateAfter.count, 1);
  assert.equal(outcomes[1].trace.safe.result, 1);
});

test('GF-TEST-strategy-priority: only ties at the winning priority prevent activation', async t => {
  const bytes = gfb(`(module Priority (input enabled bool)
    (strategy lowerOne 0 (device true) (intent result false))
    (strategy winner 1 (device true) (intent result input.enabled))
    (strategy lowerTwo 0 (device true) (intent result false)))`);
  const { outcomes } = await differential(t, bytes, ['enabled'], [{ enabled: true }], [['result', 'bool']]);
  assert.equal(outcomes[0].trace.strategy, 'winner');
  assert.deepEqual(outcomes[0].trace.safe, { result: true });
});
