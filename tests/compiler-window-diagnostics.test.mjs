import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const filename = 'compiler-window-diagnostics.ghost.md';
const document = code => `# Window diagnostics\n\nThe prose remains outside execution.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

async function locatedFailure(name, bad, good, message, inspectValid = () => {}) {
  await test(name, async () => {
    const valid = await compileSource(document(good), { filename: `valid-${filename}` });
    inspectValid(valid);
    assert.equal(bad.split('§').length, 2, 'the rejected source has one location marker');
    const marked = document(bad);
    const offset = marked.indexOf('§');
    const before = marked.slice(0, offset);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
      assert.ok(error instanceof ControlCompileError);
      assert.equal(error.filename, filename);
      assert.equal(error.line, line);
      assert.equal(error.column, column);
      assert.equal(error.message, `${filename}:${line}:${column}: ${message}`);
      return true;
    });
  });
}

const validAverage = `control ValidAverage {
  sensor temperature: Temperature;
  signal average = window_average(temperature, over: 1s, quality: measured, max_age: 1s);
}`;

await locatedFailure(
  'window diagnostics reject a duplicate named argument at the duplicate name',
  `control DuplicateWindowArgument {
    sensor temperature: Temperature;
    signal average = window_average(temperature, over: 1s, §over: 2s, quality: measured, max_age: 1s);
  }`,
  validAverage,
  'duplicate window_average argument over',
);

await locatedFailure(
  'window diagnostics reject a zero constant duration at its literal',
  `control ZeroWindowDuration {
    sensor temperature: Temperature;
    signal average = window_average(temperature, over: §0ms, quality: measured, max_age: 1s);
  }`,
  validAverage,
  'window_average over must be a positive constant Duration',
);

await locatedFailure(
  'window diagnostics distinguish a non-SensorFault Result source',
  `fn clock_value(value: Temperature) -> Result<Temperature, ClockFault> { fault(ClockUnknown) }
  control WrongWindowError {
    input temperature: Temperature;
    signal average = window_average(§clock_value(temperature), over: 1s, quality: measured, max_age: 1s);
  }`,
  validAverage,
  'window_average source must be Result<ordered numeric or physical quantity, SensorFault>',
);

await locatedFailure(
  'window diagnostics reject measured evidence without physical sample lineage',
  `fn wrap(value: Temperature) -> Result<Temperature, SensorFault> { ok(value) }
  control UnsourcedWindow {
    input temperature: Temperature;
    signal average = window_average(§wrap(temperature), over: 1s, quality: measured, max_age: 1s);
  }`,
  validAverage,
  'window_average measured source requires physical sample lineage',
);

await locatedFailure(
  'rate constructor requires a contextual Rate quantity',
  `control UncontextualRate {
    let threshold = §rate(delta: 1ΔK, time: 1s);
  }`,
  `control ContextualRate {
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);
  }`,
  'rate requires an expected Rate<Q> context',
);

await locatedFailure(
  'rate constructor rejects a duplicate named argument at the duplicate name',
  `control DuplicateRateArgument {
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, §delta: 2ΔK, time: 1s))) |> recover(false);
  }`,
  `control ValidRate {
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);
  }`,
  'duplicate rate argument delta',
);

await locatedFailure(
  'rate constructor reports its exact required argument shape',
  `control MissingRateTime {
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(§rate(delta: 1ΔK))) |> recover(false);
  }`,
  `control ValidRateShape {
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);
  }`,
  'rate expects rate(delta: quantity, time: Duration)',
);

await locatedFailure(
  'rate constructor rejects a non-Duration dynamic time at its reference',
  `control WrongRateTime {
    input enabled: Bool;
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, time: §enabled))) |> recover(false);
  }`,
  `control DynamicRateTime {
    input interval: Duration;
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, time: interval))) |> recover(false);
  }`,
  'rate time must be Duration',
);

await locatedFailure(
  'rate constructor reports a nominal delta mismatch for a non-temperature quantity',
  `control WrongPressureRateDelta {
    sensor pressure: Pressure;
    signal changing = window_rate(pressure, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- changing |> map(below(rate(delta: §1m3, time: 1s))) |> recover(false);
  }`,
  `control PressureRateDelta {
    sensor pressure: Pressure;
    signal changing = window_rate(pressure, over: 1s, quality: measured, max_age: 1s);
    output fast: Bool;
    fast <- changing |> map(below(rate(delta: 1Pa, time: 1s))) |> recover(false);
  }`,
  'rate delta must be Pressure for Rate<Pressure>',
);

const temporalStateBudget = count => `control WindowStateBudget {
  ${Array.from({ length: count }, (_, index) => `state value_${index}: Number = 0.0;`).join('\n  ')}
  sensor temperature: Temperature;
  signal average = window_average(temperature, over: 1s, quality: measured, max_age: 1s);
}`;

await locatedFailure(
  'window slots count toward the temporal state limit',
  `§${temporalStateBudget(128)}`,
  temporalStateBudget(127),
  'temporal state limit exceeded',
  artifact => {
    assert.equal(artifact.manifest.signals.filter(signal => signal.kind === 'window').length, 1);
  },
);
