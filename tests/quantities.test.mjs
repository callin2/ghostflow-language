import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { createOperatingSettingsCandidate } from '../tools/operating-settings.mjs';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import {
  QUANTITY_TYPES,
  QUANTITY_UNITS,
  canonicalUnitFor,
  decimalRational,
  formatCanonicalQuantityLiteral,
  isQuantityType,
  quantityLiteral,
  quantitySuffixAt,
  rationalToBinary64,
} from '../tools/quantities.mjs';

test('quantity catalog fixes all 17 nominal types, suffixes, and canonical units', () => {
  assert.deepEqual(QUANTITY_TYPES, [
    'Temperature', 'TemperatureDelta', 'RelativeHumidity', 'Pressure',
    'VaporPressureDeficit', 'CO2Concentration', 'FlowRate', 'Volume', 'Length',
    'Irradiance', 'PPFD', 'Energy', 'Power', 'ElectricalCurrent', 'Voltage',
    'Conductivity', 'Acidity',
  ]);
  assert.equal(new Set(QUANTITY_UNITS.map(unit => unit.suffix)).size, QUANTITY_UNITS.length);
  for (const unit of QUANTITY_UNITS) {
    assert.equal(isQuantityType(unit.type), true);
    assert.equal(canonicalUnitFor(unit.type), unit.canonicalUnit);
    assert.equal(quantityLiteral(`1${unit.suffix}`)?.type, unit.type, unit.suffix);
  }
  assert.equal(isQuantityType('Number'), false);
  assert.equal(canonicalUnitFor('Number'), undefined);
});

test('quantity suffix matching is longest-first and case-sensitive', () => {
  assert.equal(quantitySuffixAt('kPaVPDrest'), 'kPaVPD');
  assert.equal(quantitySuffixAt('PaVPDrest'), 'PaVPD');
  assert.equal(quantitySuffixAt('mL/minrest'), 'mL/min');
  assert.equal(quantitySuffixAt('mol/m2/srest'), 'mol/m2/s');
  assert.equal(quantityLiteral('1kPaVPD')?.type, 'VaporPressureDeficit');
  assert.equal(quantityLiteral('1KPA'), null);
  assert.equal(quantityLiteral('1kpa'), null);
});

test('quantity normalization applies exact linear and affine transforms before one binary64 rounding', () => {
  const cases = [
    ['25°C', 'Temperature', 298.15], ['77°F', 'Temperature', 298.15],
    ['-40°C', 'Temperature', 233.15], ['-40°F', 'Temperature', 233.15],
    ['-459.67°F', 'Temperature', 0], ['9Δ°F', 'TemperatureDelta', 5],
    ['70%RH', 'RelativeHumidity', 0.7], ['101.3kPa', 'Pressure', 101300],
    ['1.2kPaVPD', 'VaporPressureDeficit', 1200], ['800ppm', 'CO2Concentration', 0.0008],
    ['5L/min', 'FlowRate', 5 / 60000], ['5mL/min', 'FlowRate', 5 / 60000000],
    ['2.5L', 'Volume', 0.0025], ['25cm', 'Length', 0.25],
    ['600W/m2', 'Irradiance', 600], ['750umol/m2/s', 'PPFD', 0.00075],
    ['1kWh', 'Energy', 3600000], ['1.5kW', 'Power', 1500],
    ['250mA', 'ElectricalCurrent', 0.25], ['12mV', 'Voltage', 0.012],
    ['2mS/cm', 'Conductivity', 0.2], ['650uS/cm', 'Conductivity', 0.065],
    ['6.5pH', 'Acidity', 6.5],
  ];
  for (const [source, type, value] of cases) {
    assert.deepEqual(
      { type: quantityLiteral(source)?.type, value: quantityLiteral(source)?.value },
      { type, value },
      source,
    );
  }
});

test('exact rational conversion covers ties-to-even, subnormals, and finite overflow', () => {
  assert.equal(rationalToBinary64((1n << 53n) + 1n, 1n << 53n), 1);
  assert.equal(rationalToBinary64((1n << 53n) + 3n, 1n << 53n), 1 + 2 ** -51);
  assert.equal(rationalToBinary64(1n, 1n << 1074n), Number.MIN_VALUE);
  assert.equal(rationalToBinary64(1n, 1n << 1075n), 0);
  assert.equal(rationalToBinary64(3n, 1n << 1075n), 2 * Number.MIN_VALUE);
  assert.throws(() => rationalToBinary64(1n << 1024n), /finite binary64 range/);
});

test('exact rational conversion canonicalizes exact signed zero but preserves negative underflow', () => {
  assert.equal(Object.is(quantityLiteral('-0m').value, -0), false);
  assert.equal(Object.is(quantityLiteral('-1e-324m').value, -0), true);
});

test('decimal parser bounds work and preserves exact source rationals', () => {
  assert.deepEqual(decimalRational('-1.25e2'), { numerator: -125n, denominator: 1n });
  assert.deepEqual(decimalRational('0.00125'), { numerator: 1n, denominator: 800n });
  assert.deepEqual(decimalRational('0e999999999999999999999'), { numerator: 0n, denominator: 1n });
  assert.deepEqual(decimalRational('-0e-999999999999999999999'), { numerator: 0n, denominator: 1n });
  assert.throws(() => decimalRational('1e513'), /finite binary64 range/);
  assert.throws(() => decimalRational(`1${'0'.repeat(256 * 1024)}`), /source characters/);
  assert.equal(quantityLiteral(`0.${'0'.repeat(600)}1e600m`).value, 0.1);
});

test('decimal quantity literals reach exact subnormal boundaries without a smaller syntax cap', () => {
  const decimalPowerOfTwo = exponent => {
    const digits = (5n ** BigInt(exponent)).toString();
    return `0.${'0'.repeat(exponent - digits.length)}${digits}`;
  };
  assert.equal(quantityLiteral(`${decimalPowerOfTwo(1074)}m`).value, Number.MIN_VALUE);
  assert.equal(quantityLiteral(`${decimalPowerOfTwo(1075)}m`).value, 0);
  assert.equal(formatCanonicalQuantityLiteral('RelativeHumidity', 0.7), '70%RH');
  assert.equal(formatCanonicalQuantityLiteral('CO2Concentration', 0.0008), '800ppm');
  for (const [type, value] of [['RelativeHumidity', Number.MIN_VALUE], ['CO2Concentration', 1 / 3]]) {
    assert.equal(quantityLiteral(formatCanonicalQuantityLiteral(type, value)).value, value);
  }
});

test('compiler accepts the fixed quantity catalog, emits canonical metadata, and closes derived arithmetic', () => {
  assert.doesNotThrow(() => compileControl(`control EveryQuantitySuffix {
    ${QUANTITY_UNITS.map((unit, index) => `let value_${index} = 1${unit.suffix};`).join('\n    ')}
  }`, { filename: 'every-quantity-suffix.ghost' }));
  const compiled = compileControl(`
control QuantityCompiler {
  input ambient: Temperature;
  input voltage: Voltage;
  input current: ElectricalCurrent;
  output target: Temperature;
  output delivered: Volume;
  output energy: Energy;
  output power: Power;
  config desired: Temperature = 25°C {
    min = 18°C;
    max = 32°C;
    step = 0.5Δ°C;
    access = operator;
  }
  config pressure_limit: Pressure = 1bar {
    min = 50kPa;
    max = 150kPa;
    step = 1kPa;
    access = designer;
  }
  sensor measured: Temperature {
    valid = -40°C .. 100°C;
    filter = ema(alpha: 0.5);
  }
  let delta = 25°C - 20°C;
  let raised = 20°C + delta;
  let doubled = 1kW * 2;
  let scaled_pressure = 2 * 1kPa;
  let pressure_sum = 1kPa + 1bar;
  let volume_ratio = 2L / 1L;
  let reverse_volume = 2min * 5L/min;
  let recovered_flow = 10L / 2s;
  let reverse_energy = 30min * 2kW;
  let recovered_power = 1kWh / 30min;
  let reverse_electrical_power = current * voltage;
  target <- raised;
  delivered <- 5L/min * 2min;
  energy <- 2kW * 30min;
  power <- voltage * current;
}
`, { filename: 'quantity-compiler.ghost' });
  assert.deepEqual(compiled.manifest.inputs, [
    { name: 'ambient', type: 'Temperature', canonicalUnit: 'K' },
    { name: 'voltage', type: 'Voltage', canonicalUnit: 'V' },
    { name: 'current', type: 'ElectricalCurrent', canonicalUnit: 'A' },
  ]);
  assert.deepEqual(compiled.manifest.outputs, [
    { name: 'target', type: 'Temperature', canonicalUnit: 'K' },
    { name: 'delivered', type: 'Volume', canonicalUnit: 'm3' },
    { name: 'energy', type: 'Energy', canonicalUnit: 'J' },
    { name: 'power', type: 'Power', canonicalUnit: 'W' },
  ]);
  assert.deepEqual(compiled.manifest.configs[0], {
    name: 'desired', type: 'Temperature', canonicalUnit: 'K', value: 298.15,
    settings: { min: 291.15, max: 305.15, step: 0.5, access: 'operator', stepType: 'TemperatureDelta' },
    initialOffset: compiled.manifest.configs[0].initialOffset,
    initialEndOffset: compiled.manifest.configs[0].initialEndOffset,
  });
  assert.deepEqual(compiled.manifest.configs[1], {
    name: 'pressure_limit', type: 'Pressure', canonicalUnit: 'Pa', value: 100000,
    settings: { min: 50000, max: 150000, step: 1000, access: 'designer' },
    initialOffset: compiled.manifest.configs[1].initialOffset,
    initialEndOffset: compiled.manifest.configs[1].initialEndOffset,
  });
  assert.equal(compiled.manifest.sensors[0].canonicalUnit, 'K');
});

test('compiler enforces quantity nominal and affine operation boundaries', () => {
  const rejected = [
    ['absolute addition', 'let bad = 20°C + 5°C;', /Temperature|absolute|addition|operator|type/],
    ['nominal comparison', 'let bad = 1kPaVPD == 1kPa;', /same type|VaporPressureDeficit|Pressure/],
    ['humidity arithmetic', 'let bad = 50%RH + 10%RH;', /RelativeHumidity|operator|linear/],
    ['case-sensitive suffix', 'let bad = 1KPA;', /KPA|unexpected|unknown|expected/],
    ['implicit scalar', 'let bad = 1kW + 2;', /Power|Int|mix|type/],
  ];
  for (const [name, statement, pattern] of rejected) {
    assert.throws(
      () => compileControl(`control Rejected { ${statement} }`, { filename: `${name}.ghost` }),
      error => error instanceof ControlCompileError && pattern.test(error.message),
      name,
    );
  }
  assert.doesNotThrow(() => compileControl('control Signed { let cold = - 40°C; }', { filename: 'signed.ghost' }));
  assert.doesNotThrow(() => compileControl(`control SignedNumberContext {
    input measured: Number;
    let left_scaled = -2 * 1m;
    let right_scaled = 1m * -2;
    output below: Bool;
    below <- measured < (-2);
  }`, { filename: 'signed-number-context.ghost' }));
  assert.throws(() => compileControl(`control NoIntVariableCoercion {
    input measured: Number;
    input integer: Int;
    output below: Bool;
    below <- measured < -integer;
  }`, { filename: 'no-int-variable-coercion.ghost' }), error =>
    error instanceof ControlCompileError && /matching (?:ordered )?types|numeric types|same type/.test(error.message));
  assert.throws(
    () => compileControl('control UnaryAbsolute { let bad = -(40°C); }', { filename: 'unary-absolute.ghost' }),
    /unary - is not defined for Temperature/,
  );
});

test('actual WASM preserves quantity input, sensor EMA, hysteresis, and numeric output semantics', async () => {
  const compiled = await compileSource(`
control QuantityHost {
  input requested: Temperature;
  input humidity: RelativeHumidity;
  sensor measured: Temperature {
    valid = -40°C .. 100°C;
    filter = ema(alpha: 0.5);
  }
  signal cold = hysteresis(measured, on_below: 20°C, off_above: 22°C, initial: false);
  output echoed: Temperature;
  output negative_length: Length;
  output heat: Bool;
  output humid: Bool;
  echoed <- requested;
  negative_length <- 1m * -2;
  heat <- case cold { ok(value) => value; fault(_) => false; };
  humid <- humidity > 70%RH;
}
`, { filename: 'quantity-host.ghost' });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    const first = runtime.step({ nowMs: 1, inputs: { requested: 300, humidity: 0.8 }, samples: {
      measured: { epoch: 1, id: 1, timestampMs: 1, value: 290, quality: 'Good' },
    } });
    assert.equal(first.sensors.measured.value, 290);
    assert.equal(first.signals.cold.value, true);
    assert.equal(first.vm.safe.echoed, 300);
    assert.equal(first.vm.safe.negative_length, -2);

    const second = runtime.step({ nowMs: 2, inputs: { requested: 301, humidity: 0.8 }, samples: {
      measured: { epoch: 1, id: 2, timestampMs: 2, value: 300, quality: 'Good' },
    } });
    assert.equal(second.sensors.measured.value, 295);
    assert.equal(second.signals.cold.value, true);
    assert.equal(second.vm.safe.echoed, 301);
    assert.throws(() => runtime.step({ nowMs: 3, inputs: { requested: Infinity, humidity: 0.8 } }), /requested.*finite/);
    assert.throws(() => runtime.step({ nowMs: 3, inputs: { requested: 300, humidity: 1.1 } }), /humidity.*\[0, 1\]/);
  } finally { runtime.dispose(); }

  const framed = await ControlRuntime.instantiateFramed(wasm, compiled);
  try {
    const result = framed.step({ nowMs: 1, inputs: { requested: 300, humidity: 0.8 }, samples: {
      measured: { epoch: 1, id: 1, timestampMs: 1, value: 290, quality: 'Good' },
    } });
    assert.equal(result.vm.safe.echoed, 300);
    assert.equal(result.vm.safe.humid, true);
  } finally { framed.dispose(); }
});

test('runtime strictly validates quantity canonical units and Temperature setting step identity', async () => {
  const compiled = await compileSource(`control QuantityManifest {
    input humidity: RelativeHumidity;
    output target: Temperature;
    config desired: Temperature = 25°C { min = 20°C; max = 30°C; step = 1ΔK; access = operator; }
    target <- desired;
  }`, { filename: 'quantity-manifest.ghost' });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const instantiate = manifest => ControlRuntime.instantiateSimulation(wasm, { ...compiled, manifest });
  const input = compiled.manifest.inputs[0];
  const config = compiled.manifest.configs[0];
  await assert.rejects(() => instantiate({ ...compiled.manifest, inputs: [{ name: input.name, type: input.type }] }), /canonicalUnit.*required/);
  await assert.rejects(() => instantiate({ ...compiled.manifest, inputs: [{ ...input, canonicalUnit: 'percent' }] }), /canonicalUnit/);
  await assert.rejects(() => instantiate({ ...compiled.manifest, inputs: [{ ...input, type: 'Number' }] }), /canonicalUnit.*forbidden|unknown key/);
  await assert.rejects(() => instantiate({ ...compiled.manifest, configs: [{ ...config, settings: { ...config.settings, stepType: undefined } }] }), /stepType/);
});

test('quantity operating settings preserve source units and interaction schema nominal identity', async () => {
  const source = `<!-- ghostflow:anchor id=GF-INT-QUANTITY-SETTING kind=intent status=confirmed origin=user -->
Set the target temperature.

\`\`\`ghost
control QuantitySetting {
  // ghostflow:link id=GF-INT-QUANTITY-SETTING relation=implements
  config target: Temperature = 25°C { min = 20°C; max = 30°C; step = 0.5ΔK; access = operator; }
  output applied: Temperature;
  applied <- target;
}
\`\`\`
`;
  const result = await createOperatingSettingsCandidate({
    source,
    filename: 'quantity-setting.ghost.md',
    expectedSourceSha256: createHash('sha256').update(source).digest('hex'),
    changes: { target: 300.15 },
  });
  assert.match(result.source, /Temperature = 300\.15K/);
  assert.deepEqual(
    { value: result.manifest.configs[0].value, unit: result.manifest.configs[0].canonicalUnit, stepType: result.manifest.configs[0].settings.stepType },
    { value: 300.15, unit: 'K', stepType: 'TemperatureDelta' },
  );
  const candidate = await compileSource(result.source, { filename: 'quantity-setting.ghost.md' });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateSimulation(wasm, candidate);
  try { assert.equal(runtime.step({ nowMs: 0 }).vm.safe.applied, 300.15); }
  finally { runtime.dispose(); }

  const interaction = await compileSource(source, {
    filename: 'quantity-setting.ghost.md',
    interactionSourceIdentity: { documentId: 'source.quantity-setting', revisionId: 'revision.quantity-setting-v1' },
  });
  assert.deepEqual(interaction.interactionSchema.descriptors[0].sourceType, { kind: 'nominal', name: 'Temperature', unit: 'K' });
  const snapshot = emitCompletedScanSnapshot({
    compilation: interaction,
    runId: 'run.quantity-setting',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    trace: { module: interaction.traceMetadata.moduleFingerprint, inputs: {}, stateAfter: {} },
  });
  assert.deepEqual(snapshot.observations, [{ descriptorId: 'setting.target', status: 'ready', value: 298.15 }]);
  assert.equal(validateInteraction(interaction.interactionSchema, snapshot).valid, true);
  const invalid = structuredClone(snapshot);
  invalid.observations[0].value = '298.15';
  assert.equal(validateInteraction(interaction.interactionSchema, invalid).valid, false);
});
