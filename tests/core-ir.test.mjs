import assert from 'node:assert/strict';
import test from 'node:test';
import { lowerExpression } from '../tools/core-ir.mjs';
import { compile, emitGfb, lowerCoreModule, parse, tokenize } from '../tools/gfb1.mjs';

const env = {
  inputs: new Map([['start', { index: 0, type: 1 }]]),
  states: new Map([['running', { index: 0, type: 1 }]]),
};

test('expression IR resolves old and candidate state with semantic tags and types', () => {
  const ir = lowerExpression(['if', 'input.start', 'next.running', 'state.running'], env, true);
  assert.equal(ir.kind, 'conditional');
  assert.equal(ir.type, 'Bool');
  assert.deepEqual([ir.condition.kind, ir.condition.index, ir.condition.type], ['input', 0, 'Bool']);
  assert.deepEqual([ir.whenTrue.kind, ir.whenTrue.index], ['candidate_next', 0]);
  assert.deepEqual([ir.whenFalse.kind, ir.whenFalse.index], ['previous_state', 0]);
  assert.doesNotMatch(JSON.stringify(ir, (_, value) => typeof value === 'bigint' ? String(value) : value), /"(?:opcode|bytes|format|usesFormat3)"/);
});

test('only intents may read candidate state', () => {
  assert.equal(lowerExpression('state.running', env).kind, 'previous_state');
  assert.throws(() => lowerExpression('next.running', env), /next\.\* is allowed only in intents/);
});

test('short-circuit, conversion, and context projections remain semantic nodes', () => {
  const branch = lowerExpression(['and', 'input.start', ['eq', ['int-exact', '1'], ['int', '1']]], env);
  assert.equal(branch.kind, 'logical_and');
  assert.equal(branch.right.kind, 'comparison');
  assert.equal(branch.right.left.kind, 'conversion');
  assert.equal(branch.right.left.type, 'Int');
  const window = lowerExpression(['window-read', '0', 'quality'], { ...env, windows: [{ payloadType: 2 }] });
  assert.deepEqual([window.kind, window.type, window.slot, window.field], ['window_projection', 'Number', 0, 'quality']);
  assert.doesNotMatch(JSON.stringify([branch, window]), /"(?:opcode|bytes|format|usesFormat3)"/);
});

test('short-circuit lowering retains the implicit-branch resource budget', () => {
  let expression = 'true';
  for (let level = 0; level < 11; level++) expression = ['and', expression, expression];
  assert.throws(() => lowerExpression(expression, env), /expression complexity limit exceeded/);
});

test('module IR resolves semantic bindings and leaves byte encoding to one emitter', () => {
  const forms = parse(tokenize('(module latch (input start bool) (state running bool false) (strategy main 0 (device true) (next running input.start) (intent pump next.running) (intent permit input.start)) (requires pump permit))'));
  const ir = lowerCoreModule(forms);
  assert.deepEqual(ir.inputs.map(input => [input.name, input.type, input.index]), [['start', 'Bool', 0]]);
  assert.deepEqual(ir.states.map(state => [state.name, state.type, state.index]), [['running', 'Bool', 0]]);
  assert.equal(ir.strategies[0].transitions[0].expression.kind, 'input');
  assert.equal(ir.strategies[0].intents[0].expression.kind, 'candidate_next');
  assert.equal(ir.constraints[0].kind, 'requires');
  assert.doesNotMatch(JSON.stringify(ir), /"(?:opcode|bytes|format|usesFormat3)"/);
  assert.deepEqual(emitGfb(ir), compile(forms));
});

test('temporal extension stays an explicit typed descriptor in module IR', () => {
  const forms = parse(tokenize(`(module windowed
    (input __gf_now_ms number) (input __gf_time_epoch number)
    (input present bool) (input epoch number) (input id number) (input timestamp number)
    (temporal-context __gf_now_ms __gf_time_epoch)
    (temporal-root 1 temperature present epoch id timestamp)
    (strategy main 0 (device true)
      (window 1 average_window average number 1000 1000 (roots 1) (source true 1 0 0 1 1))
      (intent value (window-read 0 value))))`));
  const ir = lowerCoreModule(forms);
  const extension = ir.strategies[0].extensions.preludes[0];
  assert.equal(extension.kind, 'window');
  assert.deepEqual([extension.value.operation, extension.value.payloadType], ['average', 'Number']);
  assert.equal(extension.value.source[0].expression.kind, 'literal');
  assert.doesNotMatch(JSON.stringify(ir, (_, value) => typeof value === 'bigint' ? String(value) : value), /"(?:opcode|bytes|format|usesFormat3)"/);
  assert.deepEqual(emitGfb(ir), compile(forms));
});
