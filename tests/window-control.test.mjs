import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const filename = 'window-control.ghost.md';
const document = code => `# Window control\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const compile = code => compileSource(document(code), { filename });
const format = artifact => new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset, artifact.bytes.byteLength).getUint16(4, true);
const windows = artifact => artifact.manifest.signals.filter(signal => signal.kind === 'window');
const hasBytes = (bytes, expected) => bytes.some((_, start) => expected.every((value, offset) => bytes[start + offset] === value));
const encodedNumber = value => {
  const bytes = new Uint8Array(9); bytes[0] = 2; new DataView(bytes.buffer).setFloat64(1, value, true); return [...bytes];
};

test('window_average accepts measured Temperature evidence and preserves its payload type', async () => {
  const artifact = await compile(`control WindowAverageTemperature {
    sensor temperature: Temperature;
    signal average_temperature = window_average(temperature, over: 10min, quality: measured, max_age: 2min);
    output cold: Bool;
    cold <- average_temperature |> map(below(280K)) |> recover(false);
  }`);
  const signalNode = artifact.sourceMap.find(node => node.kind === 'signal' && node.signalMode === 'window_average');
  const sensorNode = artifact.sourceMap.find(node => node.kind === 'sensor');
  assert.equal(format(artifact), 4);
  assert.deepEqual(windows(artifact), [{
    kind: 'window', name: 'average_temperature', site: signalNode.id, slot: 0, operation: 'average', payloadType: 'Temperature',
    errorType: 'SensorFault', quality: 'measured', overMs: 600_000, maxAgeMs: 120_000,
    clockInput: '__gf_now_ms', timeEpochInput: '__gf_time_epoch', sources: [{ name: 'temperature', tag: sensorNode.id }],
  }]);
  assert.ok(hasBytes([...artifact.bytes], [57, 0, 0, 1]), 'output consumes slot 0 value projection');
});

test('window_min and window_max accept measured Temperature evidence', async () => {
  const artifact = await compile(`control WindowTemperatureExtrema {
    sensor temperature: Temperature;
    signal minimum_temperature = window_min(temperature, over: 10min, quality: measured, max_age: 2min);
    signal maximum_temperature = window_max(temperature, over: 10min, quality: measured, max_age: 2min);
    output low, high: Bool;
    low <- minimum_temperature |> map(below(280K)) |> recover(false);
    high <- maximum_temperature |> map(below(310K)) |> recover(false);
  }`);
  assert.deepEqual(windows(artifact).map(({ operation, payloadType, slot }) => ({ operation, payloadType, slot })), [
    { operation: 'min', payloadType: 'Temperature', slot: 0 },
    { operation: 'max', payloadType: 'Temperature', slot: 1 },
  ]);
});

test('window_rate produces an expression-only Rate<Temperature> consumed by a static threshold pipeline', async () => {
  const artifact = await compile(`control WindowTemperatureRate {
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
    output slow: Bool;
    slow <- warming |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);
  }`);
  assert.deepEqual(windows(artifact).map(({ operation, payloadType, slot }) => ({ operation, payloadType, slot })), [
    { operation: 'rate', payloadType: 'Rate<Temperature>', slot: 0 },
  ]);
});

test('window_rate accepts a negative TemperatureDelta threshold in its expected Rate context', async () => {
  const artifact = await compile(`control WindowCoolingRate {
    sensor temperature: Temperature;
    signal cooling = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
    output fast: Bool;
    fast <- cooling |> map(below(rate(delta: -1ΔK, time: 1s))) |> recover(false);
  }`);
  assert.equal(windows(artifact)[0].payloadType, 'Rate<Temperature>');
});

test('window_rate keeps a dynamic Duration denominator for runtime zero rejection', async () => {
  const artifact = await compile(`control DynamicWindowRateThreshold {
    input interval: Duration;
    sensor temperature: Temperature;
    signal warming = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
    output fast: Bool;
    fast <- warming |> map(below(rate(delta: 1ΔK, time: interval))) |> recover(false);
  }`);
  assert.equal(windows(artifact)[0].payloadType, 'Rate<Temperature>');
  assert.ok(hasBytes([...artifact.bytes], [22]), 'dynamic rate threshold retains GFB division');
});

test('window_rate normalizes a finite large threshold without an overflowing intermediate', async () => {
  const artifact = await compile(`control LargePressureRateThreshold {
    sensor pressure: Pressure;
    signal changing = window_rate(pressure, over: 10min, quality: measured, max_age: 2min);
    output extreme: Bool;
    extreme <- changing |> map(below(rate(delta: 1e308Pa, time: 1s))) |> recover(false);
  }`);
  assert.equal(windows(artifact)[0].payloadType, 'Rate<Pressure>');
  assert.ok(hasBytes([...artifact.bytes], [...encodedNumber(1e308), ...encodedNumber(1000), ...encodedNumber(1000), 22, 22]),
    'rate threshold divides by normalized seconds before applying the delta');
});

test('window_average maps measured Int evidence to Number while extrema preserve Int', async () => {
  const artifact = await compile(`control WindowMappedInt {
    fn count(value: Number) -> Int { int_trunc(value) }
    sensor reading: Number;
    signal average_count = window_average(reading |> map(count), over: 10s, quality: measured, max_age: 2s);
    signal minimum_count = window_min(reading |> map(count), over: 10s, quality: measured, max_age: 2s);
    signal maximum_count = window_max(reading |> map(count), over: 10s, quality: measured, max_age: 2s);
    output average_small, minimum_small, maximum_small: Bool;
    average_small <- average_count |> map(below(2.5)) |> recover(false);
    minimum_small <- minimum_count |> map(below(2)) |> recover(false);
    maximum_small <- maximum_count |> map(below(2)) |> recover(false);
  }`);
  assert.deepEqual(windows(artifact).map(({ operation, payloadType }) => ({ operation, payloadType })), [
    { operation: 'average', payloadType: 'Number' },
    { operation: 'min', payloadType: 'Int' },
    { operation: 'max', payloadType: 'Int' },
  ]);
});

test('window_average preserves Number, Percent, and nominal quantity payload types', async () => {
  const artifact = await compile(`control WindowNumericKinds {
    sensor number_reading: Number;
    sensor position: Percent;
    sensor pressure: Pressure;
    signal number_average = window_average(number_reading, over: 10s, quality: measured, max_age: 2s);
    signal position_average = window_average(position, over: 10s, quality: measured, max_age: 2s);
    signal pressure_average = window_average(pressure, over: 10s, quality: measured, max_age: 2s);
    output number_low, position_low, pressure_low: Bool;
    number_low <- number_average |> map(below(2.5)) |> recover(false);
    position_low <- position_average |> map(below(50%)) |> recover(false);
    pressure_low <- pressure_average |> map(below(100kPa)) |> recover(false);
  }`);
  assert.deepEqual(windows(artifact).map(({ payloadType }) => payloadType), ['Number', 'Percent', 'Pressure']);
});

test('a window accepts a measured Result branch over multiple physical roots', async () => {
  const artifact = await compile(`control WindowPhysicalBranches {
    input use_inside: Bool;
    sensor inside: Temperature;
    sensor outside: Temperature;
    signal average_temperature = window_average(
      if use_inside then inside else outside,
      over: 10min, quality: measured, max_age: 2min);
    output cold: Bool;
    cold <- average_temperature |> map(below(280K)) |> recover(false);
  }`);
  assert.deepEqual(windows(artifact)[0].sources.map(source => source.name), ['inside', 'outside']);
});

const invalidCases = [
  {
    name: 'missing over',
    source: `control MissingWindowOver {
      sensor temperature: Temperature;
      signal average_temperature = §window_average(temperature, quality: measured, max_age: 2min);
    }`,
    message: 'window_average requires window_average(source, over: Duration, quality: measured, max_age: Duration)',
  },
  {
    name: 'missing max_age',
    source: `control MissingWindowMaxAge {
      sensor temperature: Temperature;
      signal average_temperature = §window_average(temperature, over: 10min, quality: measured);
    }`,
    message: 'window_average requires window_average(source, over: Duration, quality: measured, max_age: Duration)',
  },
  {
    name: 'dynamic over',
    source: `control DynamicWindowOver {
      input span: Duration;
      sensor temperature: Temperature;
      signal average_temperature = window_average(temperature, over: §span, quality: measured, max_age: 2min);
    }`,
    message: 'window_average over must be a positive constant Duration',
  },
  {
    name: 'dynamic max_age',
    source: `control DynamicWindowMaxAge {
      input freshness: Duration;
      sensor temperature: Temperature;
      signal average_temperature = window_average(temperature, over: 10min, quality: measured, max_age: §freshness);
    }`,
    message: 'window_average max_age must be a positive constant Duration',
  },
  {
    name: 'missing quality',
    source: `control MissingWindowQuality {
      sensor temperature: Temperature;
      signal average_temperature = §window_average(temperature, over: 10min, max_age: 2min);
    }`,
    message: 'window_average requires window_average(source, over: Duration, quality: measured, max_age: Duration)',
  },
  {
    name: 'unsupported quality',
    source: `control EstimatedWindowQuality {
      sensor temperature: Temperature;
      signal average_temperature = window_average(temperature, over: 10min, quality: §estimated, max_age: 2min);
    }`,
    message: 'window_average quality must be measured',
  },
  {
    name: 'raw source',
    source: `control RawWindowSource {
      input temperature: Temperature;
      signal average_temperature = window_average(§temperature, over: 10min, quality: measured, max_age: 2min);
    }`,
    message: 'window_average source must be Result<ordered numeric or physical quantity, SensorFault>',
  },
  {
    name: 'Bool payload',
    source: `control BoolWindowSource {
      sensor enabled: Bool;
      signal average_enabled = window_average(§enabled, over: 10min, quality: measured, max_age: 2min);
    }`,
    message: 'window_average source must be Result<ordered numeric or physical quantity, SensorFault>',
  },
  {
    name: 'Number rate payload',
    source: `control NumberWindowRate {
      sensor reading: Number;
      signal changing = window_rate(§reading, over: 10min, quality: measured, max_age: 2min);
    }`,
    message: 'window_rate source must be Result of a supported linear physical quantity',
  },
  {
    name: 'excluded physical rate payload',
    source: `control RelativeHumidityWindowRate {
      sensor humidity: RelativeHumidity;
      signal changing = window_rate(§humidity, over: 10min, quality: measured, max_age: 2min);
    }`,
    message: 'window_rate source must be Result of a supported linear physical quantity',
  },
  {
    name: 'mismatched rate delta quantity',
    source: `control MismatchedWindowRate {
      sensor temperature: Temperature;
      signal warming = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
      output fast: Bool;
      fast <- warming |> map(below(rate(delta: §1kPa, time: 1s))) |> recover(false);
    }`,
    message: 'rate delta must be TemperatureDelta for Rate<Temperature>',
  },
  {
    name: 'zero rate time',
    source: `control ZeroTimeWindowRate {
      sensor temperature: Temperature;
      signal warming = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
      output fast: Bool;
      fast <- warming |> map(below(rate(delta: 1ΔK, time: §0s))) |> recover(false);
    }`,
    message: 'rate time must be a positive Duration',
  },
  {
    name: 'non-finite rate threshold',
    source: `control OverflowingPressureRate {
      sensor pressure: Pressure;
      signal changing = window_rate(pressure, over: 10min, quality: measured, max_age: 2min);
      output extreme: Bool;
      extreme <- changing |> map(below(§rate(delta: 1e308Pa, time: 1ms))) |> recover(false);
    }`,
    message: 'constant arithmetic result is not finite',
  },
  {
    name: 'nominal Rate payload mismatch',
    source: `control MismatchedNominalRates {
      sensor temperature: Temperature;
      sensor change: TemperatureDelta;
      signal warming = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
      signal changing = window_rate(change, over: 10min, quality: measured, max_age: 2min);
      output fast: Bool;
      fast <- warming |> map(below(changing §|> recover(rate(delta: 1ΔK, time: 1s)))) |> recover(false);
    }`,
    message: 'below limit must be Rate<Temperature>',
  },
  {
    name: 'Rate Result let binding',
    source: `control BoundWindowRate {
      sensor temperature: Temperature;
      signal warming = window_rate(temperature, over: 10min, quality: measured, max_age: 2min);
      §let saved = warming;
    }`,
    message: 'Rate<Q> is expression-only and cannot be bound by let',
  },
];

for (const entry of invalidCases) test(`window diagnostic: ${entry.name}`, async () => {
  const marked = document(entry.source);
  const offset = marked.indexOf('§');
  assert.notEqual(offset, -1);
  const before = marked.slice(0, offset);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename);
    assert.equal(error.line, line);
    assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: ${entry.message}`);
    return true;
  });
});
