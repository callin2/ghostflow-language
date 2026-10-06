import assert from 'node:assert/strict';
import test from 'node:test';
import { compileControl, ControlCompileError } from '../tools/control.mjs';

function rejects(source, pattern, label = source) {
  assert.throws(
    () => compileControl(source, { filename: 'validation.ghost' }),
    error => error instanceof ControlCompileError && pattern.test(error.message),
    label,
  );
}

function oneConfig(declaration) {
  const result = compileControl(`control X { ${declaration} }`, { filename: 'validation.ghost' });
  assert.equal(result.manifest.configs.length, 1);
  return result.manifest.configs[0];
}

for (const [name, source, diagnostic] of [
  ['purefn', 'purefn f(x: Bool) -> Bool { x } control X {}', /purefn/],
  ['enum', 'control X { enum Mode = Off | On; }', /enum/],
  ['next', 'control X { state x: Bool = false; next x = true; }', /next/],
  ['qualified input', 'control X { input x: Bool; output y: Bool; y <- input.x; }', /input\.x/],
  ['ifthenelse', 'control X { input x: Bool; output y: Bool; y <- ifthenelse(x, true, false); }', /ifthenelse/],
]) {
  test(`retired ${name} spelling is rejected independently`, () => rejects(source, diagnostic));
}

test('canonical forms emit the expected public input and output metadata', () => {
  const result = compileControl(`
    fn identity(x: Bool) -> Bool { x }
    control Canonical {
      type Mode = Off | On;
      input request: Bool;
      state active: Bool = false;
      active' = case request { ok(value) => identity(value); fault(_) => active; };
      output permit: Bool;
      permit <- if active' then true else false;
    }
  `);
  assert.deepEqual({
    name: result.manifest.name,
    inputs: result.manifest.sensors.map(({ name, type }) => ({ name, type })),
    outputs: result.manifest.outputs,
  }, {
    name: 'Canonical',
    inputs: [{ name: 'request', type: 'Bool' }],
    outputs: [{ name: 'permit', type: 'Bool' }],
  });
});

for (const value of ['stopped', 'live']) {
  test(`config apply = ${value} is rejected independently`, () => {
    rejects(`control X {
      config duration: Duration = 5min {
        min = 1min; max = 10min; step = 1min; access = operator; apply = ${value};
      }
    }`, /unknown config option apply/);
  });
}

test('canonical config metadata contains no apply policy', () => {
  const result = compileControl(`control X {
    config duration: Duration = 5min {
      min = 1min; max = 10min; step = 1min; access = operator;
    }
  }`);
  assert.equal(Object.hasOwn(result.manifest.configs[0].settings, 'apply'), false);
});

for (const [unit, factor, maximum, over] of [
  ['ms', 1n, '9007199254740991', '9007199254740992'],
  ['s', 1000n, '9007199254740', '9007199254741'],
  ['min', 60000n, '150119987579', '150119987580'],
  ['h', 3600000n, '2501999792', '2501999793'],
]) {
  for (const value of ['0', maximum]) {
    test(`Duration ${value}${unit} emits its exact millisecond value`, () => {
      const config = oneConfig(`config d: Duration = ${value}${unit};`);
      assert.deepEqual({ type: config.type, value: config.value }, {
        type: 'Duration', value: Number(BigInt(value) * factor),
      });
    });
  }
  test(`Duration ${over}${unit} is rejected immediately above the unit boundary`, () => {
    rejects(`control X { config d: Duration = ${over}${unit}; }`, /Duration literal exceeds/, `${over}${unit}`);
  });
}

for (const literal of ['900719925474099199999999999999ms', '999999999999999999999999999999h']) {
  test(`very long Duration ${literal} is rejected independently`, () => {
    rejects(`control X { config d: Duration = ${literal}; }`, /Duration literal exceeds/, literal);
  });
}

test('negative Duration literal is rejected beside accepted zero', () => {
  assert.equal(oneConfig('config zero: Duration = 0ms;').value, 0);
  rejects('control X { config d: Duration = -1s; }', /non-negative integer number of milliseconds/);
});

test('fractional Duration unit literal is rejected beside exact milliseconds', () => {
  assert.equal(oneConfig('config half_second: Duration = 500ms;').value, 500);
  rejects('control X { config d: Duration = 0.5s; }', /whole-number unit quantity/);
});

for (const expression of ['9007199254740991ms + 0ms', '0ms + 0ms']) {
  test(`Duration arithmetic accepts ${expression}`, () => {
    const config = oneConfig(`config d: Duration = ${expression};`);
    assert.equal(config.value, expression.startsWith('9007199254740991') ? 9007199254740991 : 0);
  });
}

for (const [expression, diagnostic] of [
  ['9007199254740991ms + 1ms', /Duration|overflow|2\^53-1/],
  ['0ms - 1ms', /Duration constant must be a non-negative integer/],
  ['1ms / 2.0', /Duration constant must be a non-negative integer/],
]) {
  test(`Duration arithmetic rejects ${expression}`, () => {
    rejects(`control X { config d: Duration = ${expression}; }`, diagnostic, expression);
  });
}

for (const [name, declaration, expected] of [
  ['equal Duration bounds', 'config d: Duration = 5s { min = 5s; max = 5s; step = 1s; access = operator; }',
    { name: 'd', type: 'Duration', value: 5000, settings: { min: 5000, max: 5000, step: 1000, access: 'operator' } }],
  ['Number default at min', 'config at_min: Number = -10.0 { min = -10.0; max = 10.0; step = 1.0; access = operator; }',
    { name: 'at_min', type: 'Number', value: -10, settings: { min: -10, max: 10, step: 1, access: 'operator' } }],
  ['Number default at max', 'config at_max: Number = 10.0 { min = -10.0; max = 10.0; step = 1.0; access = operator; }',
    { name: 'at_max', type: 'Number', value: 10, settings: { min: -10, max: 10, step: 1, access: 'operator' } }],
]) {
  test(`config accepts ${name} and emits exact metadata`, () => {
    const { initialOffset, initialEndOffset, ...actual } = oneConfig(declaration);
    assert.ok(Number.isInteger(initialOffset) && initialEndOffset > initialOffset);
    assert.deepEqual(actual, { ...expected, id: actual.id });
    assert.ok(Number.isInteger(actual.id) && actual.id > 0);
  });
}

for (const [name, declaration, diagnostic] of [
  ['zero Duration step', 'config d: Duration = 5s { min = 1s; max = 10s; step = 0ms; access = operator; }', /positive step|numeric config/],
  ['negative Number step', 'config n: Number = 5.0 { min = 0.0; max = 10.0; step = -1.0; access = operator; }', /positive step|numeric config/],
  ['negative Duration setting', 'config d: Duration = 5s { min = -1s; max = 10s; step = 1s; access = operator; }', /Duration setting must use a duration literal/],
  ['inverted Number bounds', 'config n: Number = 5.0 { min = 10.0; max = 0.0; step = 1.0; access = operator; }', /min|max|numeric config/],
  ['Number below min', 'config n: Number = -11.0 { min = -10.0; max = 10.0; step = 1.0; access = operator; }', /outside settings range/],
  ['Number above max', 'config n: Number = 11.0 { min = -10.0; max = 10.0; step = 1.0; access = operator; }', /outside settings range/],
]) {
  test(`config rejects ${name} independently`, () => {
    rejects(`control X { ${declaration} }`, diagnostic, declaration);
  });
}

test('false, zero, and zero percent remain explicit config defaults', () => {
  const result = compileControl(`control ExplicitZeroSettings {
    config enabled: Bool = false { access = operator; label = "Enabled"; }
    config count: Number = 0 { min = 0; max = 10; step = 1; access = operator; }
    config duty: Percent = 0% { min = 0%; max = 100%; step = 10%; access = designer; }
  }`);
  assert.deepEqual(result.manifest.configs.map(({ name, type, value, settings }) => ({ name, type, value, settings })), [
    { name: 'enabled', type: 'Bool', value: false, settings: { access: 'operator', label: 'Enabled' } },
    { name: 'count', type: 'Number', value: 0, settings: { min: 0, max: 10, step: 1, access: 'operator' } },
    { name: 'duty', type: 'Percent', value: 0, settings: { min: 0, max: 100, step: 10, access: 'designer' } },
  ]);
});

for (const [name, declaration, diagnostic] of [
  ['missing numeric step', 'config n: Number = 0 { min = 0; max = 10; access = operator; }', /valid min, max and positive step/],
  ['numeric settings on Bool', 'config enabled: Bool = false { min = false; max = true; step = true; access = operator; }', /Bool config cannot have numeric bounds/],
  ['Number bound on Duration', 'config d: Duration = 5s { min = 1.0; max = 10s; step = 1s; access = operator; }', /Duration setting must use a duration literal/],
  ['default off the step grid', 'config n: Number = 6 { min = 0; max = 10; step = 4; access = operator; }', /not aligned to settings\.step/],
  ['duplicate config option', 'config n: Number = 0 { min = 0; min = 0; max = 10; step = 1; access = operator; }', /duplicate config option min/],
]) {
  test(`config rejects ${name} with a complete neighboring control`, () => {
    rejects(`control X { ${declaration} }`, diagnostic, declaration);
  });
}

test('integer-shaped hysteresis thresholds use the Number sensor context', () => {
  const result = compileControl(`control X {
    input temperature: Number;
    signal hot = hysteresis(temperature, on_below: 1, off_above: 2, initial: false);
  }`);
  assert.deepEqual(
    { onBelow: result.manifest.signals[0].onBelow, offAbove: result.manifest.signals[0].offAbove },
    { onBelow: 1, offAbove: 2 },
  );
});

for (const [type, below, above, expected] of [
  ['Number', '1', '2', { onBelow: 1, offAbove: 2 }],
  ['Number', '-2', '-1', { onBelow: -2, offAbove: -1 }],
  ['Percent', '30%', '35%', { onBelow: 30, offAbove: 35 }],
]) {
  test(`hysteresis accepts ordered ${type} thresholds ${below} < ${above}`, () => {
    const result = compileControl(`control X {
      input measured: ${type};
      signal condition = hysteresis(measured, on_below: ${below}, off_above: ${above}, initial: false);
    }`);
    assert.deepEqual(
      { onBelow: result.manifest.signals[0].onBelow, offAbove: result.manifest.signals[0].offAbove },
      expected,
    );
  });
}

for (const [below, above] of [['1', '1'], ['2', '1']]) {
  test(`hysteresis rejects unordered Number thresholds ${below} < ${above} independently`, () => {
    rejects(`control X {
      input measured: Number;
      signal condition = hysteresis(measured, on_below: ${below}, off_above: ${above}, initial: false);
    }`, /on_below must be less than off_above/, `${below} < ${above}`);
  });
}
