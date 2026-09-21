import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlCompileError, compileControl, typeCheckControl } from '../tools/control.mjs';

function checks(source) {
  return typeCheckControl(source, { filename: 'integer.ghost' });
}

function rejects(source, diagnostic, { line, column } = {}) {
  assert.throws(
    () => checks(source),
    error => error instanceof ControlCompileError
      && error.message.includes(diagnostic)
      && (line === undefined || error.line === line)
      && (column === undefined || error.column === column),
  );
}

test('N1-LIT-01/03: Int boundaries and context-sensitive whole literals type-check', () => {
  const result = checks(`control IntegerLiterals {
  state minimum: Int = -2147483648;
  state zero: Int = 0;
  state maximum: Int = 2147483647;
  let exact = 30;
  let approximate = 30.0;
  output exact_out: Int;
  output approximate_out: Number;
  exact_out <- exact;
  approximate_out <- approximate;
}`);
  assert.deepEqual(result.manifest.outputs, [
    { name: 'exact_out', type: 'Int' },
    { name: 'approximate_out', type: 'Number' },
  ]);
});

test('N1-LIT-02: out-of-range integer literals report their source position', () => {
  rejects('control TooLarge { state count: Int = 2147483648; }', 'Int literal is outside -2147483648..2147483647', { line: 1, column: 39 });
  rejects('control TooSmall { state count: Int = -2147483649; }', 'Int literal is outside -2147483648..2147483647', { line: 1, column: 39 });
});

test('whole literals remain Number in immediate Number contexts', () => {
  checks(`control NumberContexts {
  input temperature: Number;
  config threshold: Number = 30;
  fn below(value: Number, threshold_value: Number) -> Bool { value < threshold_value }
  output cool: Bool;
  cool <- below(temperature, 30) && temperature < 31;
}`);
});

test('N1-TYPE-01/02: mixed numeric operations and Int slash division are rejected', () => {
  rejects('control MixedAdd { input count: Int; input measure: Number; output x: Int; x <- count + measure; }', '+ does not implicitly mix Int and Number');
  rejects('control MixedCompare { input count: Int; input measure: Number; output x: Bool; x <- count < measure; }', '< requires matching numeric types');
  rejects('control Slash { input a, b: Int; output x: Int; x <- a / b; }', '/ is not defined for Int operands; use div or convert both operands to Number');
});

test('Int operators and exact constant arithmetic type-check', () => {
  checks(`control IntegerOperators {
  input a, b: Int;
  output quotient, remainder: Int;
  output ordered: Bool;
  quotient <- a div b;
  remainder <- a % b;
  ordered <- -a + b * 2 <= 2147483647;
}`);
  rejects('control Overflow { config x: Int = 2147483647 + 1; }', 'constant Int arithmetic overflows');
});

test('N1-CONV-01/02: explicit conversions type-check and invalid constants diagnose', () => {
  checks(`control IntegerConversions {
  config low: Number = number(-2147483648);
  config high: Number = number(2147483647);
  config exact: Int = int_exact(3.0);
  config floor: Int = int_floor(-2.5);
  config ceil: Int = int_ceil(-2.5);
  config trunc: Int = int_trunc(-2.5);
  config nearest: Int = int_nearest_even(-2.5);
}`);
  rejects('control Fractional { config x: Int = int_exact(3.5); }', 'int_exact constant must be integral');
  rejects('control ConversionRange { config x: Int = int_floor(2147483648.0); }', 'integer conversion constant is outside -2147483648..2147483647');
});

test('Int programs use the distinct integer-capable GFB v2 format', () => {
  const compiled = compileControl(`control IntegerGfb {
    state minimum: Int = -2147483648;
    state zero: Int = 0;
    state maximum: Int = 2147483647;
    output count: Int;
    count <- maximum;
  }`, { filename: 'integer-gfb.ghost' });
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 2);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v4');
});
