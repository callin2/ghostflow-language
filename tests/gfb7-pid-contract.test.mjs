import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const objectiveName = 'greenhouse_temperature';
const outputName = 'roof_vent.position';
const targetName = `__gf_objective_target_${objectiveName}`;
const safeMaxName = `__gf_objective_safe_max_${objectiveName}`;

function artifact() {
  // Format 7 remains a documented direct GFB profile. Canonical source PID
  // compilation uses the separate GFB11 config Result profile.
  const bytes = compile(parse(tokenize(`(module LegacyPid
    (input __gf_now_ms number)
    (input __gf_sensor_value_inside_temperature number)
    (input __gf_sensor_ok_inside_temperature bool)
    (input __gf_sensor_fault_inside_temperature number)
    (input ${targetName} number)
    (input ${safeMaxName} number)
    (strategy control 0 (device true))
    (pid-objective ${objectiveName} ${outputName}
      __gf_sensor_value_inside_temperature __gf_sensor_ok_inside_temperature
      ${targetName} ${safeMaxName} 10000 30000 reverse 2 0.1 1 0 80 0))`)));
  const manifest = {
    format: 'GhostFlow/control-v2', name: 'LegacyPid', inputs: [],
    outputs: [{ name: outputName, type: 'Percent' }],
    sensors: [{ name: 'inside_temperature', type: 'Temperature', canonicalUnit: 'K', sampleMs: null,
      validMin: null, validMax: null, filter: null, window: null, staleMs: null, recoverSamples: null,
      valueInput: '__gf_sensor_value_inside_temperature', okInput: '__gf_sensor_ok_inside_temperature',
      faultInput: '__gf_sensor_fault_inside_temperature' }],
    schedules: [], timers: [], signals: [],
    configs: [{ name: 'target_temperature', type: 'Temperature', canonicalUnit: 'K', value: 298.15,
      displayUnit: '°C', settings: { min: 283.15, max: 313.15, step: 0.5, stepType: 'TemperatureDelta', access: 'operator', label: 'Target' } }],
    objectives: [{ name: objectiveName, measure: 'inside_temperature', target: 'target_temperature',
      manipulate: 'roof_vent', output: { min: 0, max: 80 },
      controller: { kind: 'pid', periodMs: 10000, lateAfterMs: 30000, direction: 'reverse',
        kp: 2, ki: 0.1, kd: 1, bias: 0, antiWindup: 'conditional_safe', disabled: 'track_safe',
        transfer: 'track_safe', fault: 'disable', restart: { mode: 'reset', output: 0 } },
      binding: 'native-temperature-percent-v1', executable: false,
      bindings: { output: outputName, measure: '__gf_sensor_value_inside_temperature',
        measureOk: '__gf_sensor_ok_inside_temperature', target: targetName, safeMax: safeMaxName } }],
    bytecodeSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return { bytes, manifest };
}

test('GFB7 direct PID profile activates and commands bounded output on real WASM', async t => {
  const compiled = artifact();
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true), 7);
  const runtime = await ControlRuntime.instantiate(wasm, compiled, { acceptSettings: true });
  t.after(() => runtime.dispose());
  const first = runtime.step({ nowMs: 0, samples: { inside_temperature: {
    epoch: 1, id: 1, timestampMs: 0, value: 303.15, quality: 'Good',
  } }, objectiveSafeMax: { [objectiveName]: 80 } });
  const next = runtime.step({ nowMs: 10000, samples: { inside_temperature: {
    epoch: 1, id: 2, timestampMs: 10000, value: 303.15, quality: 'Good',
  } }, objectiveSafeMax: { [objectiveName]: 80 } });
  assert.equal(first.vm.safe?.[outputName] ?? first.vm.safeIntents?.[outputName], 0);
  const commanded = next.vm.safe?.[outputName] ?? next.vm.safeIntents?.[outputName];
  assert.ok(commanded > 0 && commanded <= 80);
});

test('GFB7 host rejects malformed protected PID bindings before activation', async () => {
  const compiled = artifact();
  const reject = (change, message) => {
    const manifest = structuredClone(compiled.manifest);
    change(manifest);
    return assert.rejects(() => ControlRuntime.instantiate(wasm, { ...compiled, manifest }, { acceptSettings: true }), message);
  };
  await reject(manifest => { manifest.objectives[0].bindings.target = '__gf_spoofed_target'; }, /target binding/);
  await reject(manifest => { manifest.objectives[0].bindings.measureOk = '__gf_spoofed_ok'; }, /measure binding mismatch/);
  await reject(manifest => { manifest.objectives[0].output.max = 101; }, /invalid Percent range/);
});
