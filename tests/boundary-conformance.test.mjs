import assert from 'node:assert/strict';
import test from 'node:test';
import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { compile as compileGfb, parse as parseGfb, tokenize as tokenizeGfb, CompileError as GfbCompileError } from '../tools/gfb1.mjs';

function expectControlError(source, message) {
  assert.throws(
    () => compileControl(source, { filename: 'boundary-control.ghost' }),
    error => error instanceof ControlCompileError && error.message.includes(message),
  );
}

function controlWithInputs(count) {
  const names = Array.from({ length: count }, (_, index) => `input${index}`);
  return `control InputBoundary { input ${names.join(', ')}: Bool; }`;
}

function controlWithStates(count) {
  const states = Array.from({ length: count }, (_, index) => `state state${index}: Bool = false;`);
  return `control StateBoundary { ${states.join(' ')} }`;
}

function controlWithOutputs(count, constraint = '') {
  const names = Array.from({ length: count }, (_, index) => `output${index}`);
  return `control ConstraintBoundary {
    output ${names.join(', ')}: Bool;
    ${names.map(name => `${name} <- true;`).join('\n    ')}
    ${constraint}
  }`;
}

const controlResourceBoundaries = [
  {
    id: 'GF-TEST-61.3-CONTROL-INPUTS',
    // Each canonical Bool observation consumes value/ok/fault slots. The VM
    // still allows 128 inputs; 42 authored inputs fit and 43 need 129 slots.
    limit: 42,
    source: controlWithInputs,
    error: 'input budget exceeded',
  },
  {
    id: 'GF-TEST-61.3-CONTROL-STATES',
    limit: 128,
    source: controlWithStates,
    error: 'state budget exceeded',
  },
];

for (const boundary of controlResourceBoundaries) {
  test(`${boundary.id}: accepts declared maximum and rejects just-over`, () => {
    assert.doesNotThrow(() => compileControl(boundary.source(boundary.limit)));
    expectControlError(boundary.source(boundary.limit + 1), boundary.error);
  });
}

test('GF-TEST-61.3-CONTROL-SOURCE-BYTES: accepts 256 KiB and rejects 256 KiB plus one character', () => {
  const limit = 256 * 1024;
  const prefix = 'control SourceBoundary {';
  const suffix = '}';
  const sourceAtLimit = `${prefix}${' '.repeat(limit - prefix.length - suffix.length)}${suffix}`;
  assert.equal(sourceAtLimit.length, limit);
  assert.doesNotThrow(() => compileControl(sourceAtLimit));
  expectControlError(`${sourceAtLimit} `, 'control source exceeds 256 KiB parser limit');
});

test('GF-TEST-61.3-CONTROL-TOKENS: accepts the last source below the 8192-token guard and rejects the next declaration', () => {
  const makeSource = count => `control TokenBoundary { ${Array.from({ length: count }, (_, index) => `let value${index} = true;`).join(' ')} }`;
  // Each let contributes five control tokens; the 1638th declaration crosses
  // the tokenizer guard before semantic lowering begins.
  assert.doesNotThrow(() => compileControl(makeSource(1637)));
  expectControlError(makeSource(1638), 'token limit exceeded (8192)');
});

test('GF-TEST-61.3-CONTROL-PARSER-DEPTH: accepts 63 nested expressions and rejects the 64th', () => {
  const makeSource = depth => `control DepthBoundary { output result: Bool; result <- ${'('.repeat(depth)}true${')'.repeat(depth)}; }`;
  assert.doesNotThrow(() => compileControl(makeSource(63)));
  expectControlError(makeSource(64), 'parser nesting exceeds 64');
});

const gfbModule = ({ inputs = 0, states = 0, strategies = 1, constraints = [], intentNames = [] } = {}) => {
  const forms = [
    '(module GfbBoundary (version 1)',
    ...Array.from({ length: inputs }, (_, index) => `(input input${index} bool)`),
    ...Array.from({ length: states }, (_, index) => `(state state${index} bool false)`),
    ...Array.from({ length: strategies }, (_, index) => {
      const intents = intentNames.map(name => `(intent ${name} true)`).join(' ');
      return `(strategy strategy${index} 0 (device true) ${intents})`;
    }),
    ...constraints,
    ')',
  ];
  return forms.join(' ');
};

function compileGfbSource(source) {
  return compileGfb(parseGfb(tokenizeGfb(source)));
}

const gfbResourceBoundaries = [
  {
    id: 'GF-TEST-61.3-GFB-INPUTS',
    limit: 128,
    option: 'inputs',
  },
  {
    id: 'GF-TEST-61.3-GFB-STATES',
    limit: 128,
    option: 'states',
  },
  {
    id: 'GF-TEST-61.3-GFB-STRATEGIES',
    limit: 32,
    option: 'strategies',
  },
  {
    id: 'GF-TEST-61.3-GFB-CONSTRAINTS',
    limit: 128,
    option: 'constraints',
  },
];

for (const boundary of gfbResourceBoundaries) {
  test(`${boundary.id}: accepts maximum resource count and rejects just-over`, () => {
    const options = { [boundary.option]: boundary.limit };
    if (boundary.option === 'constraints') {
      options.constraints = Array.from({ length: boundary.limit }, () => '(requires pump valve)');
      options.intentNames = ['pump', 'valve'];
    }
    assert.doesNotThrow(() => compileGfbSource(gfbModule(options)));
    const over = { ...options, [boundary.option]: boundary.limit + 1 };
    if (boundary.option === 'constraints') over.constraints = Array.from({ length: boundary.limit + 1 }, () => '(requires pump valve)');
    assert.throws(() => compileGfbSource(gfbModule(over)), error => error instanceof GfbCompileError && error.message.includes('module resource limit'));
  });
}

const boolConstraintBoundaries = [
  { id: 'GF-TEST-61.3-GFB-REQUIRES-ANY', head: 'requires-any' },
  { id: 'GF-TEST-61.3-GFB-MUTEX', head: 'mutex' },
];

for (const boundary of boolConstraintBoundaries) {
  test(`${boundary.id}: accepts arity 2 through 32 and rejects one or 33`, () => {
    const makeConstraint = arity => `(${boundary.head} ${Array.from({ length: arity }, (_, index) => `intent${index}`).join(' ')})`;
    const makeSource = arity => gfbModule({ constraints: [makeConstraint(arity)], intentNames: Array.from({ length: Math.max(arity, 2) }, (_, index) => `intent${index}`) });
    assert.doesNotThrow(() => compileGfbSource(makeSource(2)));
    assert.doesNotThrow(() => compileGfbSource(makeSource(32)));
    assert.throws(() => compileGfbSource(makeSource(1)), error => error instanceof GfbCompileError && error.message.includes(boundary.head === 'mutex' ? 'mutex needs at least 2' : 'requires-any expects target and prerequisites'));
    assert.throws(() => compileGfbSource(makeSource(33)), error => error instanceof GfbCompileError && error.message.includes(boundary.head === 'mutex' ? 'invalid constraint names or arity' : 'requires-any expects target and prerequisites'));
  });
}

test('GF-TEST-61.3-GFB-SOURCE-BYTES: accepts 1 MiB input and rejects one byte over', () => {
  const limit = 1024 * 1024;
  assert.doesNotThrow(() => tokenizeGfb(' '.repeat(limit)));
  assert.throws(() => tokenizeGfb(' '.repeat(limit + 1)), error => error instanceof GfbCompileError && error.message.includes('source byte limit exceeded'));
});

function nestedNotAst(depth) {
  let expression = 'true';
  for (let index = 0; index < depth; index++) expression = ['not', expression];
  return expression;
}

test('GF-TEST-61.3-GFB-EXPRESSION-DEPTH: compiler accepts effective depth 128 and rejects effective depth 129', () => {
  const makeAst = depth => ['module', 'ExpressionDepthBoundary', ['strategy', 'strategy', '0', ['device', 'true'], ['intent', 'result', nestedNotAst(depth)]]];
  assert.doesNotThrow(() => compileGfb(makeAst(127)));
  assert.throws(() => compileGfb(makeAst(128)), error => error instanceof GfbCompileError && error.message.includes('expression complexity limit exceeded'));
});

function balancedOr(count) {
  if (count === 1) return 'true';
  const middle = Math.floor(count / 2);
  return `(or ${balancedOr(middle)} ${balancedOr(count - middle)})`;
}

test('GF-TEST-61.3-GFB-EXPRESSION-SIZE: accepts 4096 encoded bytes and rejects 4097 bytes', () => {
  // A short-circuit OR tree with N Bool leaves uses 2*N + 8*(N-1) bytes.
  // 410 leaves use 4092 bytes; each surrounding NOT adds exactly one byte.
  const makeSource = padding => gfbModule({
    strategies: 1,
    intentNames: [],
  }).replace('(device true) )', `(device true) (intent result ${'(not '.repeat(padding)}${balancedOr(410)}${')'.repeat(padding)}))`);
  const bytes = Buffer.from(compileGfbSource(makeSource(4)));
  // The single intent ends immediately before the empty u16 constraint count.
  assert.equal(bytes.readUInt32LE(bytes.length - 4096 - 6), 4096);
  assert.throws(() => compileGfbSource(makeSource(5)), error => error instanceof GfbCompileError && error.message.includes('strategy resource limit exceeded'));
});

const boolDecisionBoundaries = [
  {
    id: 'GF-TEST-61.3-BOOL-LITERALS',
    expression: 'true',
    valid: true,
  },
  {
    id: 'GF-TEST-61.3-BOOL-NEGATION',
    expression: '!false',
    valid: true,
  },
  {
    id: 'GF-TEST-61.3-BOOL-CONJUNCTION',
    expression: 'true && false',
    valid: true,
  },
  {
    id: 'GF-TEST-61.3-BOOL-NUMBER-MISMATCH',
    expression: '1',
    error: 'output result must be Bool',
  },
  {
    id: 'GF-TEST-61.3-BOOL-OPERATOR-MISMATCH',
    expression: '1 && true',
    error: '&& requires Bool operands',
  },
];

for (const boundary of boolDecisionBoundaries) {
  test(`${boundary.id}: GhostFlow Bool decision boundary`, () => {
    const source = `control BoolBoundary { output result: Bool; result <- ${boundary.expression}; }`;
    if (boundary.valid) assert.doesNotThrow(() => compileControl(source));
    else expectControlError(source, boundary.error);
  });
}

test('GF-TEST-61.3-TRUNCATED-CONTROL: JavaScript parser reports a truncated control block', () => {
  expectControlError('control Truncated { output result: Bool;', 'unclosed control block');
});

test('GF-TEST-61.3-TRUNCATED-GFB: JavaScript GFB parser reports a truncated list', () => {
  assert.throws(() => parseGfb(tokenizeGfb('(module Truncated')), error => error instanceof GfbCompileError && error.message.includes('unclosed ('));
});

console.log('boundary conformance tests loaded');
