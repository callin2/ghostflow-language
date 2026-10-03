import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { pidSaturationSource, pidActivation, pidSaturationSteps, pidStages } from './helpers/pid-saturation-vectors.mjs';
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const objective = `control ObjectiveTest {
sensor inside_temperature: Temperature;
config target_temperature: Temperature = 25°C { min = 10°C; max = 40°C; step = 0.5Δ°C; access = operator; label = "Target"; }
resource roof_vent: ContinuousActuator<Percent>;
objective greenhouse_temperature { measure = inside_temperature; target = target_temperature; manipulate = roof_vent.position; output = 0% .. 80%; controller = pid { period = 10s; late_after = 30s; direction = reverse; kp = proportional_gain(output: 2%, error: 1Δ°C); ki = integral_gain(output: 0.1%, error: 1Δ°C, time: 1s); kd = derivative_gain(output: 1%, time: 1s, error: 1Δ°C); bias = 0%; anti_windup = conditional_safe; disabled = track_safe; transfer = track_safe; fault = disable; restart = reset(output: 0%); } }
}`;
test('continuous objective retains the executable native PID contract', () => {
  const descriptor = typeCheckControl(objective).manifest.objectives[0];
  assert.deepEqual(descriptor, {
    name: 'greenhouse_temperature', measure: 'inside_temperature', target: 'target_temperature',
    manipulate: 'roof_vent', output: { min: 0, max: 80 },
    controller: {
      kind: 'pid', periodMs: 10_000, lateAfterMs: 30_000, direction: 'reverse',
      kp: 2, ki: 0.1, kd: 1, bias: 0,
      antiWindup: 'conditional_safe', disabled: 'track_safe', transfer: 'track_safe',
      fault: 'disable', restart: { mode: 'reset', output: 0 },
    },
    binding: 'native-temperature-percent-v1', executable: false,
    bindings: {
      output: 'roof_vent.position', measure: '__gf_sensor_value_inside_temperature',
      measureOk: '__gf_sensor_ok_inside_temperature', target: '__gf_config_3_value',
      targetOk: '__gf_config_3_ok',
      safeMax: '__gf_objective_safe_max_greenhouse_temperature',
    },
  });
});
test('continuous objective emits the GFB11 PID profile with typed setting status', () => {
  const compiled = compileControl(objective);
  const view = new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset, compiled.bytes.byteLength);
  assert.equal(view.getUint16(4, true), 11);
  assert.equal(compiled.manifest.objectives[0].executable, false);
  assert.ok(compiled.manifest.outputs.some(output => output.name === 'roof_vent.position' && output.type === 'Percent'));
  const strings = ['greenhouse_temperature', 'roof_vent.position'];
  let at = compiled.bytes.length - (81 + strings.reduce((sum, value) => sum + new TextEncoder().encode(value).length, 0));
  const readString = () => { const length = view.getUint16(at, true); at += 2; const value = new TextDecoder().decode(compiled.bytes.subarray(at, at + length)); at += length; return value; };
  assert.equal(view.getUint16(at, true), 1); at += 2;
  assert.equal(readString(), strings[0]); assert.equal(readString(), strings[1]);
  assert.deepEqual(Array.from({ length: 4 }, () => { const value = view.getUint16(at, true); at += 2; return value; }), [0, 1, 6, 8]);
  assert.equal(view.getUint16(at, true), 5); at += 2;
  assert.equal(view.getBigUint64(at, true), 10_000n); at += 8;
  assert.equal(view.getBigUint64(at, true), 30_000n); at += 8;
  assert.equal(view.getUint8(at++), 1);
  assert.deepEqual(Array.from({ length: 6 }, () => { const value = view.getFloat64(at, true); at += 8; return value; }), [2, 0.1, 1, 0, 80, 0]);
  assert.equal(at, compiled.bytes.length);
});
test('GFB11 PID activation verifies protected sensor and typed target Result bindings', async t => {
  const artifact = await compileSource(objective, { filename: 'objective-contract.ghost' });
  const options = { context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] } };
  const runtime = await ControlRuntime.instantiate(wasm, artifact, options);
  t.after(() => runtime.dispose());
  assert.ok(runtime.contextSnapshot().bytes.length > 0);
  const reject = (change, message) => {
    const manifest = structuredClone(artifact.manifest);
    change(manifest);
    return assert.rejects(() => ControlRuntime.instantiate(wasm, { ...artifact, manifest }, options), message);
  };
  await reject(manifest => { manifest.objectives[0].bindings.targetOk = '__gf_spoofed_ok'; },
    /context PID protected Result binding mismatch/);
  await reject(manifest => { manifest.objectives[0].bindings.measureOk = '__gf_spoofed_sensor_ok'; },
    /context PID protected Result binding mismatch/);
  await reject(manifest => { manifest.sensors[0].canonicalUnit = 'Pa'; },
    /context PID sensor must be canonical Temperature/);
  await reject(manifest => { manifest.objectives[0].binding = 'host-pid-v1'; },
    /unsupported context PID objective binding/);
  const sensorCapability = { kind: 'sensor', name: 'inside_temperature', type: 'Temperature' };
  const withSensor = await ControlRuntime.instantiate(wasm, artifact,
    { ...options, capabilities: [sensorCapability] });
  withSensor.dispose();
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact, {
    ...options, capabilities: [{ ...sensorCapability, name: 'unknown_temperature' }],
  }), /unknown capability sensor unknown_temperature/);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact, {
    ...options, capabilities: [{ ...sensorCapability, type: 'bool' }],
  }), /capability sensor inside_temperature type mismatch/);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact, {
    ...options, capabilities: [sensorCapability, sensorCapability],
  }), /duplicate capability sensor inside_temperature/);
});
test('native Temperature PID descriptor rejects unsupported timing and output domains', () => {
  assert.throws(() => typeCheckControl(objective.replace('0% .. 80%', '1% .. 80%')), /output minimum.*0%/);
  assert.throws(() => typeCheckControl(objective.replace('late_after = 30s', 'late_after = 5s')), /late_after >= period/);
  assert.throws(() => typeCheckControl(objective.replace('bias = 0%', 'bias = 90%')), /bias.*output range/);
  assert.throws(() => typeCheckControl(objective.replace('reset(output: 0%)', 'reset(output: 90%)')), /restart output.*output range/);
  assert.throws(() => typeCheckControl(objective.replace('ContinuousActuator<Percent>', 'ContinuousActuator')), /ContinuousActuator<Percent>/);
});
test('native PID descriptor rejects unsupported quantity, manual and degraded paths', () => {
  const pressure = objective
    .replace('sensor inside_temperature: Temperature;', 'sensor inside_temperature: Pressure;')
    .replace('config target_temperature: Temperature = 25°C { min = 10°C; max = 40°C; step = 0.5Δ°C;', 'config target_temperature: Pressure = 25Pa { min = 10Pa; max = 40Pa; step = 1Pa;')
    .replaceAll('1Δ°C', '1Pa');
  assert.throws(() => typeCheckControl(pressure), /requires Temperature measure and target/);
  assert.throws(() => typeCheckControl(objective.replace('restart = reset(output: 0%);', 'restart = reset(output: 0%); manual = track_safe;')), /unsupported PID field manual/);
  const degraded = objective.replace(/}\s*$/, `degraded Fallback for greenhouse_temperature {
    branch Backup priority 1 when inside_temperature quality in { measured }
      use objective greenhouse_temperature authority automatic_degraded output 0% .. 30%;
    otherwise disable;
    resume = require_start;
  }
}`);
  assert.throws(() => typeCheckControl(degraded), /native PID objective does not support degraded control/);
});
test('degraded control requires exhaustive otherwise', () => { assert.throws(() => typeCheckControl('control X { sensor s: Temperature; degraded D for missing { branch B priority 1 when s quality in { measured } use objective O authority automatic_degraded output 0% .. 30%; otherwise disable; resume = require_start; } }'), /unknown degraded objective|requires at least one branch/); });
test('bounded adaptation produces host binding manifest', () => { const r = typeCheckControl('control X { config target: Pressure = 1.0kPa { min = 0.7kPa; max = 1.2kPa; step = 0.05kPa; access = operator; label = "VPD"; } adapt_setting policy for target { allowed = 0.7kPa .. 1.2kPa; max_step = 0.05kPa; max_change = 0.05kPa per 1h; authority = optimizer; } }'); assert.equal(r.manifest.adaptSettings[0].target, 'target'); });

test('REF-04-060 canonical native/WASM PID records distinct observation stages and conditional_safe rejects saturation growth', async t => {
  const compiled = await compileSource(pidSaturationSource, { filename: 'reference-pid-saturation.ghost' });
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 11);
  const descriptor = compiled.manifest.objectives[0];
  assert.equal(descriptor.binding, 'native-temperature-percent-v1');
  assert.equal(descriptor.controller.antiWindup, 'conditional_safe');
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'context_tape'], { cwd: root, stdio: 'pipe' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-pid-saturation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, compiled.bytes);
  const execute = async steps => {
    const runtime = await ControlRuntime.instantiate(wasm, compiled, { context: pidActivation });
    let rows;
    try { rows = steps.map(step => runtime.step(step)); }
    finally { runtime.dispose(); }
    // Native consumes the same accepted sensor-conditioned rails. Context
    // settings/clock projections remain core-owned and cannot be supplied here.
    const projected = new Set(compiled.manifest.configs.flatMap(config =>
      ['ok', 'value', 'fault'].map(role => `__gf_config_${config.id}_${role}`)));
    for (const objective of compiled.manifest.objectives) {
      projected.add(objective.bindings.target); projected.add(objective.bindings.targetOk);
    }
    projected.add('__gf_now_ms');
    projected.add('__gf_time_epoch');
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1', activation: pidActivation,
      steps: rows.map(({ vm }, scanId) => ({ scanId, logicalTimeMs: steps[scanId].nowMs,
        inputs: Object.entries(vm.inputs).filter(([name]) => !projected.has(name))
          .map(([name, value]) => ({ name, value })), ...steps[scanId].contextFacts })) }));
    const records = execFileSync(path.join(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : '')),
      [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }).trim().split('\n').map(JSON.parse);
    assert.ok(records.every(record => record.accepted), JSON.stringify(records));
    assert.deepEqual(records.map(record => record.outcome.trace), rows.map(row => row.vm));
    return records.map(record => pidStages(record.outcome.trace, descriptor.controller.antiWindup));
  };
  const stages = await execute(pidSaturationSteps());
  assert.deepEqual(stages.map(row => [row.requested, row.safe]),
    [[92,20], [92,20], [92,20], [92,20], [92,20], [97,97]]);
  assert.deepEqual(stages[0], { antiWindup: 'conditional_safe', requested: 92, safe: 20,
    appliedObservation: { percent: 20, driverRevision: 3 },
    feedbackObservation: { percent: 17, good: true, epoch: 9, id: 1, atMs: 0 } });
  // Initial error=5, P=10 and I=82 track restart92. The release tick adds only
  // its own 5 points, yielding97; hidden accumulation over the clamp horizon
  // would produce100. This tests controller memory without inventing a getter.
  const changed = await execute(pidSaturationSteps({ applied: 12, feedback: 8, good: false }));
  assert.deepEqual(changed.map(row => [row.requested, row.safe]), stages.map(row => [row.requested, row.safe]));
  assert.ok(changed.every(row => row.appliedObservation.percent === 12
    && row.feedbackObservation.percent === 8 && !row.feedbackObservation.good));
  // The fixtures are public observations, not Driver receipts or the sensor
  // admission engine. Unknown/missing source references must still fail closed.
  await assert.rejects(() => compileSource(pidSaturationSource.replace('measure = inside_temperature', 'measure = missing_temperature')), /objective measure must reference a declared sensor/);
  await assert.rejects(() => compileSource(pidSaturationSource.replace('target = target_temperature', 'target = missing_target')), /objective target must reference a declared config or setting/);
  const runtime = await ControlRuntime.instantiate(wasm, compiled, { context: pidActivation });
  try {
    const step = pidSaturationSteps()[0];
    assert.throws(() => runtime.step({ ...step, inputs: { ...step.inputs, unknown_feedback: 17 } }), /unknown input/);
    const { driver_applied, ...missing } = step.inputs;
    assert.throws(() => runtime.step({ ...step, inputs: missing }), /missing.*driver_applied/);
    assert.equal(runtime.step(step).vm.requested['roof_vent.position'], 92);
  } finally { runtime.dispose(); }
});
