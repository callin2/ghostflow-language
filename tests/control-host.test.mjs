import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const wasmBytes = fs.readFileSync(wasmPath);
const source = `
control MoistureHost {
  input start: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }
  signal dry = hysteresis(moisture, on_below: 30%, off_above: 35%, initial: false);
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  output pump: Bool;
  pump <- start && dry_ok;
}
`;

async function artifact() { return compileSource(source, { filename: 'control-host.ghost' }); }
async function host() { return ControlRuntime.instantiate(wasmBytes, await artifact()); }
function sample(id, value, quality = 'Good') { return { epoch: 1, id, timestampMs: id * 1000, value, quality }; }

const scheduledSource = extractLiterate(
  fs.readFileSync(new URL('../examples/scheduled-watering.ghost.md', import.meta.url), 'utf8'),
  { filename: 'examples/scheduled-watering.ghost.md' },
).code;

test('runs compiled control through real WASM with sensor fault/recovery and virtual output capability', async () => {
  const runtime = await host();
  try {
    const missing = runtime.step({ nowMs: 0, inputs: { start: true } });
    assert.equal(missing.sensors.moisture.quality, 'NotReady');
    assert.equal(missing.signals.dry.value, false);
    for (const [id, value] of [[1, 28], [2, 29], [3, 90], [4, 28]]) {
      const result = runtime.step({ nowMs: id * 1000, inputs: { start: true }, samples: { moisture: sample(id, value) } });
      assert.equal(result.sensors.moisture.ok, false);
    }
    const ready = runtime.step({ nowMs: 5000, inputs: { start: true }, samples: { moisture: sample(5, 29) } });
    assert.equal(ready.sensors.moisture.ok, true);
    assert.equal(ready.signals.dry.value, true);
    assert.equal(ready.vm.safe?.pump ?? ready.vm.safeIntents?.pump, true);

    const fault = runtime.step({ nowMs: 6000, inputs: { start: true }, samples: { moisture: sample(6, 0, 'Disconnected') } });
    assert.equal(fault.sensors.moisture.quality, 'Disconnected');
    assert.equal(fault.signals.dry.value, false);
    for (const id of [7, 8, 9, 10]) {
      const recovery = runtime.step({ nowMs: id * 1000, inputs: { start: true }, samples: { moisture: sample(id, 20) } });
      // Reference 4.2 requires a faulted sensor to expose NotReady while its
      // filter window and recover_after evidence are rebuilt.
      assert.equal(recovery.sensors.moisture.quality, 'NotReady');
      assert.equal(recovery.sensors.moisture.ok, false);
      assert.equal(recovery.signals.dry.value, false);
    }
    const recovered = runtime.step({ nowMs: 11000, inputs: { start: true }, samples: { moisture: sample(11, 20) } });
    assert.equal(recovered.sensors.moisture.quality, 'Good');
    assert.equal(recovered.signals.dry.value, true);
  } finally { runtime.dispose(); }
});

test('runs moving_average sensor filter through real WASM with full-window and sliding semantics', async () => {
  const compiled = await compileSource(`
control MovingAverageHost {
  sensor level: Number { filter = moving_average(4); }
  output ready: Bool;
  ready <- case level { ok(_) => true; fault(_) => false; };
}
`, { filename: 'moving-average-host.ghost' });
  assert.equal(compiled.manifest.sensors[0].filter, 'moving_average');
  assert.equal(compiled.manifest.sensors[0].window, 4);
  const boundary = await compileSource(`control MovingAverageBounds {
    sensor percent_one: Percent { filter = moving_average(1); }
    sensor number_thirty_one: Number { filter = moving_average(31); }
  }`, { filename: 'moving-average-bounds.ghost' });
  assert.deepEqual(boundary.manifest.sensors.map(({ filter, window }) => ({ filter, window })), [
    { filter: 'moving_average', window: 1 },
    { filter: 'moving_average', window: 31 },
  ]);
  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    for (const [id, value] of [[1, 1], [2, 2], [3, 5]]) {
      assert.equal(runtime.step({ nowMs: id * 1000, samples: { level: sample(id, value) } }).sensors.level.quality, 'NotReady');
    }
    const ready = runtime.step({ nowMs: 4000, samples: { level: sample(4, 8) } });
    assert.equal(ready.sensors.level.value, 4);
    const sliding = runtime.step({ nowMs: 5000, samples: { level: sample(5, 10) } });
    assert.equal(sliding.sensors.level.value, 6.25);

    const fault = runtime.step({ nowMs: 6000, samples: { level: sample(6, 0, 'Invalid') } });
    assert.equal(fault.sensors.level.quality, 'Invalid');
    assert.equal(fault.sensors.level.ok, false);
    for (const id of [7, 8, 9]) {
      const pending = runtime.step({ nowMs: id * 1000, samples: { level: sample(id, 20) } });
      assert.equal(pending.sensors.level.quality, 'NotReady');
      assert.equal(pending.sensors.level.ok, false);
    }
    const duplicate = runtime.step({ nowMs: 9001, samples: { level: sample(9, 99) } });
    assert.equal(duplicate.sensors.level.quality, 'NotReady');
    const recovered = runtime.step({ nowMs: 10000, samples: { level: sample(10, 20) } });
    assert.equal(recovered.sensors.level.quality, 'Good');
    assert.equal(recovered.sensors.level.value, 20);
  } finally { runtime.dispose(); }
});

test('runs EMA Number and Percent sensors through real WASM with seed, recurrence, duplicate, and recovery semantics', async () => {
  const compiled = await compileSource(`
control EmaHost {
  sensor level: Number {
    filter = ema(alpha: 0.25);
    recover_after = 2 samples;
  }
  sensor demand: Percent { filter = ema(alpha: 1.0); }
  output level_ready, demand_ready: Bool;
  level_ready <- case level { ok(_) => true; fault(_) => false; };
  demand_ready <- case demand { ok(_) => true; fault(_) => false; };
}
`, { filename: 'ema-host.ghost' });
  assert.deepEqual(
    compiled.manifest.sensors.map(({ name, filter, window, alpha }) => ({ name, filter, window, alpha })),
    [
      { name: 'level', filter: 'ema', window: 1, alpha: 0.25 },
      { name: 'demand', filter: 'ema', window: 1, alpha: 1 },
    ],
  );

  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    const seeded = runtime.step({ nowMs: 1000, samples: {
      level: sample(1, 8), demand: sample(1, 40),
    } });
    assert.deepEqual(
      { level: seeded.sensors.level.value, demand: seeded.sensors.demand.value },
      { level: 8, demand: 40 },
    );

    const recurrence = runtime.step({ nowMs: 2000, samples: {
      level: sample(2, 16), demand: sample(2, 50),
    } });
    assert.deepEqual(
      { level: recurrence.sensors.level.value, demand: recurrence.sensors.demand.value },
      { level: 10, demand: 50 },
    );

    const duplicate = runtime.step({ nowMs: 2001, samples: { level: sample(2, 100) } });
    assert.equal(duplicate.sensors.level.value, 10);

    const fault = runtime.step({ nowMs: 3000, samples: { level: sample(3, 0, 'Invalid') } });
    assert.equal(fault.sensors.level.quality, 'Invalid');
    const firstRecovery = runtime.step({ nowMs: 4000, samples: { level: sample(4, 20) } });
    assert.equal(firstRecovery.sensors.level.quality, 'NotReady');
    const recoveryDuplicate = runtime.step({ nowMs: 4001, samples: { level: sample(4, 100) } });
    assert.equal(recoveryDuplicate.sensors.level.quality, 'NotReady');
    const recovered = runtime.step({ nowMs: 5000, samples: { level: sample(5, 30) } });
    assert.deepEqual(recovered.sensors.level, { ok: true, value: 22.5, quality: 'Good' });
  } finally { runtime.dispose(); }
});

test('computes EMA with the specified weighted formula without overflowing finite opposite-sign samples', async () => {
  const compiled = await compileSource(`
control EmaFiniteExtremes {
  sensor latest: Number { filter = ema(alpha: 1.0); }
  sensor midpoint: Number { filter = ema(alpha: 0.5); }
}
`, { filename: 'ema-finite-extremes.ghost' });
  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    const first = runtime.step({ nowMs: 1, samples: {
      latest: { ...sample(1, Number.MAX_VALUE), timestampMs: 1 },
      midpoint: { ...sample(1, Number.MAX_VALUE), timestampMs: 1 },
    } });
    assert.deepEqual(
      { latest: first.sensors.latest.value, midpoint: first.sensors.midpoint.value },
      { latest: Number.MAX_VALUE, midpoint: Number.MAX_VALUE },
    );

    const second = runtime.step({ nowMs: 2, samples: {
      latest: { ...sample(2, -Number.MAX_VALUE), timestampMs: 2 },
      midpoint: { ...sample(2, -Number.MAX_VALUE), timestampMs: 2 },
    } });
    assert.deepEqual(second.sensors.latest, { ok: true, value: -Number.MAX_VALUE, quality: 'Good' });
    assert.deepEqual(second.sensors.midpoint, { ok: true, value: 0, quality: 'Good' });
  } finally { runtime.dispose(); }
});

test('rejects invalid EMA source payloads and alpha forms', async () => {
  const rejectsEma = (body, diagnostic) => assert.rejects(
    () => compileSource(`control InvalidEma { ${body} }`, { filename: 'invalid-ema.ghost' }),
    diagnostic,
  );
  await rejectsEma('sensor flag: Bool { filter = ema(alpha: 0.5); }', /numeric filtering|Number or Percent/);
  await rejectsEma('input factor: Number; sensor value: Number { filter = ema(alpha: factor); }', /ema alpha.*constant Number/);
  await rejectsEma('sensor value: Number { filter = ema(); }', /ema.*alpha/);
  await rejectsEma('sensor value: Number { filter = ema(alpha: 0.5, window: 2); }', /ema.*alpha/);
  await rejectsEma('sensor value: Number { filter = ema(0.5); }', /ema.*alpha/);
  await rejectsEma('sensor value: Number { filter = ema(alpha: 0.0); }', /ema alpha.*\(0, 1\]/);
  await rejectsEma('sensor value: Number { filter = ema(alpha: 1.0001); }', /ema alpha.*\(0, 1\]/);
  await rejectsEma('sensor value: Number { filter = ema(alpha: 1e309); }', /finite|ema alpha/);
});

test('strictly validates canonical EMA manifest alpha metadata', async () => {
  const ema = await compileSource('control EmaManifest { sensor value: Number { filter = ema(alpha: 0.5); } }', { filename: 'ema-manifest.ghost' });
  const moving = await compileSource('control MovingManifest { sensor value: Number { filter = moving_average(3); } }', { filename: 'moving-manifest.ghost' });
  const mutateSensor = (compiled, mutate) => {
    const sensor = { ...compiled.manifest.sensors[0] };
    mutate(sensor);
    return { ...compiled, manifest: { ...compiled.manifest, sensors: [sensor] } };
  };

  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, mutateSensor(ema, sensor => { delete sensor.alpha; })), /ema.*alpha.*required/);
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, mutateSensor(moving, sensor => { sensor.alpha = 0.5; })), /alpha.*only.*ema|unexpected.*alpha/);
  for (const alpha of [Number.NaN, Number.POSITIVE_INFINITY, 0, 1.0001]) {
    await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, mutateSensor(ema, sensor => { sensor.alpha = alpha; })), /alpha/);
  }
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, mutateSensor(ema, sensor => { sensor.window = 2; })), /ema.*window.*1/);
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, mutateSensor(ema, sensor => { sensor.type = 'Bool'; })), /ema.*numeric payload/);
});

test('rejects clock reversal and does not return a stale trace as a new step', async () => {
  const runtime = await host();
  try {
    const first = runtime.step({ nowMs: 100, inputs: { start: false } });
    assert.equal(first.vm.tick, 1);
    assert.throws(() => runtime.step({ nowMs: 99, inputs: { start: false } }), /monotonic/);
  } finally { runtime.dispose(); }
});

test('rejects malformed manifest and mismatched bytecode hash', async () => {
  const compiled = await artifact();
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, { ...compiled, manifest: { ...compiled.manifest, format: 'GhostFlow/other-v1' } }), /manifest format/);
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, { ...compiled, manifest: { ...compiled.manifest, bytecodeSha256: '0'.repeat(64) } }), /SHA-256/);
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, { ...compiled, manifest: { ...compiled.manifest, inputs: [{ ...compiled.manifest.inputs[0], extra: true }] } }), /unknown key/);
});

test('accepts compiler-emitted v2 settings and executes the compiled config value', async () => {
  const compiled = await compileSource(`
control SettingsHost {
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; label = "관수 시간"; }
  output enabled: Bool;
  enabled <- duration > 0min;
}
`, { filename: 'settings-host.ghost' });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v2');
  assert.deepEqual(compiled.manifest.configs[0].settings, {
    min: 60000, max: 1200000, step: 60000, access: 'operator', label: '관수 시간',
  });
  const runtime = await ControlRuntime.instantiateSimulation(wasmBytes, compiled);
  try {
    assert.equal(runtime.manifest.configs[0].settings.apply, 'stopped');
    const result = runtime.step({ nowMs: 0 });
    assert.equal(result.vm.safe?.enabled ?? result.vm.safeIntents?.enabled, true);
  } finally { runtime.dispose(); }
});

test('strictly validates v2 settings metadata and keeps v1 metadata-free', async () => {
  const v2 = await compileSource('control V2 { config level: Percent = 50% { min = 0%; max = 100%; step = 10%; access = designer; label = "Level"; } output ready: Bool; ready <- level >= 0%; }', { filename: 'v2-settings.ghost' });
  const invalid = change => ({ ...v2, manifest: { ...v2.manifest, configs: [{ ...v2.manifest.configs[0], settings: { ...v2.manifest.configs[0].settings, ...change } }] } });
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, invalid({ access: 'viewer' })), /access/);
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, invalid({ apply: 'running' })), /apply/);
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, invalid({ min: 10, max: 20, step: 3 })), /aligned/);
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, invalid({ label: 'x'.repeat(129) })), /label/);
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, invalid({ min: '0' })), /must be/);
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, { ...v2, manifest: { ...v2.manifest, configs: [{ ...v2.manifest.configs[0], initialOffset: '0' }] } }), /Offset|offset/);

  const v1 = await compileSource('control V1 { config duration: Duration = 5min; output ready: Bool; ready <- duration > 0min; }', { filename: 'v1-settings.ghost' });
  assert.equal(v1.manifest.format, 'GhostFlow/control-v1');
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, { ...v1, manifest: { ...v1.manifest, configs: [{ ...v1.manifest.configs[0], settings: { access: 'operator' } }] } }), /unknown key|v1 config/);
});

test('deep-copies and freezes the validated manifest', async () => {
  const compiled = await artifact();
  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    compiled.manifest.inputs[0].name = 'mutated_after_validation';
    compiled.manifest.sensors[0].validMin = 99;
    compiled.manifest.sensors.push({ name: 'mutated', type: 'Number' });
    assert.equal(Object.isFrozen(runtime.manifest), true);
    assert.equal(Object.isFrozen(runtime.manifest.sensors[0]), true);
    const result = runtime.step({ nowMs: 0, inputs: { start: false } });
    assert.equal(result.vm.inputs.start, false);
    assert.equal(runtime.manifest.inputs[0].name, 'start');
    assert.equal(runtime.manifest.sensors[0].validMin, 0);
  } finally { runtime.dispose(); }
});

test('freezes nested v2 settings and preserves the bytecode hash boundary', async () => {
  const compiled = await compileSource('control FrozenSettings { config level: Percent = 50% { min = 0%; max = 100%; step = 10%; access = operator; } output ready: Bool; ready <- level > 0%; }', { filename: 'frozen-settings.ghost' });
  const runtime = await ControlRuntime.instantiateSimulation(wasmBytes, compiled);
  try {
    assert.equal(Object.isFrozen(runtime.manifest.configs[0]), true);
    assert.equal(Object.isFrozen(runtime.manifest.configs[0].settings), true);
    assert.equal(runtime.manifest.bytecodeSha256, compiled.manifest.bytecodeSha256);
    assert.throws(() => { runtime.manifest.configs[0].settings.access = 'designer'; }, TypeError);
  } finally { runtime.dispose(); }
  await assert.rejects(() => ControlRuntime.instantiateSimulation(wasmBytes, { ...compiled, manifest: { ...compiled.manifest, bytecodeSha256: '0'.repeat(64) } }), /SHA-256/);
});

test('routes non-finite and finite out-of-range numeric sensor payloads to core Invalid', async () => {
  const runtime = await host();
  try {
    const invalid = runtime.step({ nowMs: 1000, inputs: { start: true }, samples: {
      moisture: { epoch: 1, id: 1, timestampMs: 1000, value: Number.NaN, quality: 'Good' },
    } });
    assert.equal(invalid.sensors.moisture.ok, false);
    assert.equal(invalid.sensors.moisture.quality, 'Invalid');
    assert.equal(invalid.sensors.moisture.value, 0);
    assert.equal(invalid.signals.dry.value, false);
    assert.equal(invalid.vm.inputs.__gf_sensor_value_moisture, 0);
    assert.equal(invalid.vm.inputs.__gf_sensor_ok_moisture, false);

    const outOfRange = runtime.step({ nowMs: 2000, inputs: { start: true }, samples: {
      moisture: { epoch: 1, id: 2, timestampMs: 2000, value: 101, quality: 'Good' },
    } });
    assert.equal(outOfRange.sensors.moisture.quality, 'Invalid');
    assert.equal(outOfRange.sensors.moisture.value, 0);
    assert.equal(outOfRange.signals.dry.quality, 'Invalid');
  } finally { runtime.dispose(); }
});

test('keeps typed Percent inputs strict while sensor Percent payloads remain fallible', async () => {
  const compiled = await compileSource(`
control PercentInputHost {
  input level: Percent;
  output pump: Bool;
  pump <- level > 50%;
}
`, { filename: 'percent-input-host.ghost' });
  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { level: 101 } }), /in \[0, 100\]/);
  } finally { runtime.dispose(); }
});

test('rejects compiler recovery range beyond the fixed core profile', async () => {
  await assert.rejects(
    () => compileSource(source.replace('recover_after = 3 samples;', 'recover_after = 128 samples;'), { filename: 'recover-limit.ghost' }),
    /recover_after.*1 to 31/,
  );
});

test('rejects unknown names, missing inputs, and invalid sample schema', async () => {
  const runtime = await host();
  try {
    assert.throws(() => runtime.step({ nowMs: 0, inputs: {} }), /missing input/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: false, extra: true } }), /unknown input/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: false }, samples: { moisture: { epoch: -1, id: 1, timestampMs: 0, value: 20, quality: 'Good' } } }), /safe integer/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: false }, samples: { moisture: { epoch: 1, id: 1, timestampMs: 0, value: 20, quality: 'Noise' } } }), /unsupported/);
  } finally { runtime.dispose(); }
});

test('injects strict schedule due values and uses tickAt for timers', async () => {
  const compiled = await compileSource(scheduledSource, { filename: 'scheduled-host.ghost' });
  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    const first = runtime.step({ nowMs: 0 });
    assert.equal(first.vm.inputs.__gf_now_ms, 0);
    assert.equal(first.vm.inputs.__gf_schedule_due_starts, false);
    const second = runtime.step({ nowMs: 1, due: { starts: true } });
    assert.equal(second.vm.inputs.__gf_now_ms, 1);
    assert.equal(second.vm.inputs.__gf_schedule_due_starts, true);
    assert.throws(() => runtime.step({ nowMs: 2, due: { starts: 1 } }), /must be boolean/);
  } finally { runtime.dispose(); }
});

test('accepts a schedule with all slots disabled and validates the real timezone database', async () => {
  const compiled = await compileSource(scheduledSource.replace('selected = [06:00, 06:15, 12:30, 18:45];', 'selected = [];'), { filename: 'scheduled-disabled-host.ghost' });
  const runtime = await ControlRuntime.instantiate(wasmBytes, compiled);
  try {
    const result = runtime.step({ nowMs: 0 });
    assert.equal(result.vm.inputs.__gf_schedule_due_starts, false);
  } finally { runtime.dispose(); }
  const invalidTimezone = { ...compiled.manifest, schedules: [{ ...compiled.manifest.schedules[0], timezone: 'Not/AZone' }] };
  await assert.rejects(() => ControlRuntime.instantiate(wasmBytes, { ...compiled, manifest: invalidTimezone }), /Intl timezone/);
});
