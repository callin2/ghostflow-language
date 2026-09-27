import assert from 'node:assert/strict';
import test from 'node:test';
import { lowerExpression } from '../tools/core-ir.mjs';

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
  assert.doesNotMatch(JSON.stringify(ir), /"(?:opcode|bytes|format|usesFormat3)"/);
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
