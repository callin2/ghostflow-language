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
  state above_minimum: Int = -2147483647;
  state zero: Int = 0;
  state below_maximum: Int = 2147483646;
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
  rejects('control MixedCompare { input count: Int; input measure: Number; output x: Bool; x <- count < measure; }', '< requires matching ordered types');
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
  rejects('control Underflow { config x: Int = -2147483648 - 1; }', 'constant Int arithmetic overflows');
  rejects('control ProductOverflow { config x: Int = 46341 * 46341; }', 'constant Int arithmetic overflows');
  rejects('control NegationOverflow { config x: Int = -(-2147483648); }', 'constant Int arithmetic overflows');
  rejects('control DivideByZero { config x: Int = 1 div 0; }', 'constant integer division by zero');
  rejects('control RemainderByZero { config x: Int = 1 % 0; }', 'constant integer division by zero');
  rejects('control DivisionOverflow { config x: Int = (-2147483648) div -1; }', 'constant Int arithmetic overflows');
  rejects('control BareDivisionOverflow { config x: Int = -2147483648 div -1; }', 'constant Int arithmetic overflows');
  checks('control MinimumRemainder { config x: Int = (-2147483648) % -1; }');
  checks('control BareMinimumRemainder { config x: Int = -2147483648 % -1; }');
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
  config floor_inside_high: Int = int_floor(2147483647.9);
  config ceil_inside_low: Int = int_ceil(-2147483648.9);
}`);
  rejects('control Fractional { config x: Int = int_exact(3.5); }', 'int_exact constant must be integral');
  rejects('control ConversionRange { config x: Int = int_floor(2147483648.0); }', 'integer conversion constant is outside -2147483648..2147483647');
  rejects('control FloorBelowRange { config x: Int = int_floor(-2147483648.1); }', 'integer conversion constant is outside -2147483648..2147483647');
  rejects('control CeilAboveRange { config x: Int = int_ceil(2147483647.1); }', 'integer conversion constant is outside -2147483648..2147483647');
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

test('Int intermediate conjunctions select GFB v3 without an Int module boundary', () => {
  const compiled = compileControl(`control IntegerIntermediates {
    let quotient = -7 div 3;
    let remainder = -7 % 3;
    output valid: Bool;
    valid <- quotient == -2 && remainder == -1;
  }`, { filename: 'integer-intermediates.ghost' });
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 3);
  assert.deepEqual(compiled.manifest.outputs, [{ name: 'valid', type: 'Bool' }]);
});

test('constant explicit conversions retain literal types inside GFB3 conjunctions', () => {
  const compiled = compileControl(`control ConstantIntegerConversions {
    let approximate = number(7);
    let exact = int_exact(7.0);
    let down = int_floor(1.9);
    let up = int_ceil(1.1);
    let toward_zero = int_trunc(-1.9);
    let positive_odd_tie = int_nearest_even(1.5);
    let positive_even_tie = int_nearest_even(2.5);
    let negative_odd_tie = int_nearest_even(-1.5);
    let negative_even_tie = int_nearest_even(-2.5);
    output valid: Bool;
    valid <- approximate == 7.0 && exact == 7 && down == 1 && up == 2 && toward_zero == -1
      && positive_odd_tie == 2 && positive_even_tie == 2
      && negative_odd_tie == -2 && negative_even_tie == -2;
  }`, { filename: 'constant-integer-conversions.ghost' });
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 3);
  assert.deepEqual(compiled.manifest.outputs, [{ name: 'valid', type: 'Bool' }]);
});

test('dynamic explicit conversions select GFB3 with preserved typed conversion', () => {
  const compiled = compileControl(`control DynamicIntegerConversion {
      input count: Int;
      output approximate: Number;
      approximate <- number(count);
    }`, { filename: 'dynamic-integer-conversion.ghost' });
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 3);
});
