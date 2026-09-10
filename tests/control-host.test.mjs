import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
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

const scheduledSource = fs.readFileSync(new URL('../examples/scheduled-watering.ghost', import.meta.url), 'utf8');

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
      assert.equal(recovery.sensors.moisture.quality, 'Disconnected');
    }
    const recovered = runtime.step({ nowMs: 11000, inputs: { start: true }, samples: { moisture: sample(11, 20) } });
    assert.equal(recovered.sensors.moisture.quality, 'Good');
    assert.equal(recovered.signals.dry.value, true);
  } finally { runtime.dispose(); }
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
  const v2 = await compileSource('control V2 { config level: Percent = 50% { min = 0%; max = 100%; step = 10%; access = designer; apply = stopped; label = "Level"; } output ready: Bool; ready <- level >= 0%; }', { filename: 'v2-settings.ghost' });
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
