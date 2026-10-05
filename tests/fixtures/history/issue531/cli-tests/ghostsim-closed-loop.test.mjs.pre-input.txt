import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const cli = new URL('../tools/ghostsim.mjs', import.meta.url).pathname;
const catalog = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url), 'utf8'));
const reference = catalog.cases.find(entry => entry.id === 'REF-04-058');

async function execute(t, source, id) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-pid-loop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'greenhouse.gfb');
  writeArtifact(await compileSource(source, { filename: reference.filename }), artifact);
  const scenarioPath = path.join(directory, 'greenhouse.toon');
  fs.writeFileSync(scenarioPath, encode({
    format: 'GhostFlow/scenario-v1', id, initialInputs: [], keyBindings: [],
    context: { bootEpoch: 9, terminalCapacity: 8, bindings: [] },
    actuatorBindings: [{ actuator: 'roof-vent', output: 'roof_vent.position', type: 'Percent', min: 0, max: 80 }],
    plant: {
      kind: 'GhostFlow/greenhouse-temperature-v1', sensor: 'inside_temperature', actuator: 'roof-vent', epoch: 9,
      initialTemperature: { value: 30, unit: '°C' }, outsideTemperature: { value: 20, unit: '°C' }, heatingKPerSecond: 0.001,
      leakPerSecond: 0.0001, ventilationPerSecond: 0.001,
    },
    actions: [0, 10_000, 20_000].map(atMs => ({ kind: 'scan', atMs,
      contextFacts: { clock: { monotonicMs: atMs, bootEpoch: 9, wallMs: atMs,
        uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'pid-clock-v1' },
      natural: [], schedules: [], settings: null } })),
  }) + '\n');
  const invoke = () => spawnSync(process.execPath, [cli, artifact, scenarioPath, '--format', 'json'], {
    encoding: 'utf8', timeout: 10_000,
  });
  const first = invoke();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const result = JSON.parse(first.stdout);
  return { result, invoke };
}

test('REF-04-058 PID closes the greenhouse temperature and roof vent loop deterministically', async t => {
  const { result, invoke } = await execute(t, reference.source, 'ref-04-058-closed-loop');
  assert.equal(result.outcome, 'completed');
  assert.equal(result.scans.length, 3);
  const applied = result.scans.map(scan => scan.virtualActuators['roof-vent'].applied);
  assert.equal(applied[0], 0);
  assert.ok(applied[1] > 0 && applied[1] <= 80);
  assert.equal(result.scans[2].plant.priorAppliedPercent, applied[1]);
  assert.equal(result.scans[2].inputs.__gf_sensor_value_inside_temperature, result.scans[2].plant.insideTemperature.value + 273.15);
  assert.equal(result.scans[2].plant.insideTemperature.unit, '°C');
  const priorK = result.scans[1].inputs.__gf_sensor_value_inside_temperature;
  const loss = 0.0001 + 0.001 * applied[1] / 100;
  const equilibriumK = 293.15 + 0.001 / loss;
  const expectedNextK = equilibriumK + (priorK - equilibriumK) * Math.exp(-loss * 10);
  assert.ok(Math.abs(result.scans[2].inputs.__gf_sensor_value_inside_temperature - expectedNextK) < 1e-12);
  assert.deepEqual(JSON.parse(invoke().stdout), result);
});

test('greenhouse trace follows the explicit Celsius or Kelvin target setting unit', async t => {
  const kelvinSource = reference.source
    .replace('25°C', '298.15K').replace('10°C', '283.15K').replace('40°C', '313.15K').replace('0.5Δ°C', '0.5ΔK');
  const celsius = (await execute(t, reference.source, 'display-celsius')).result;
  const kelvin = (await execute(t, kelvinSource, 'display-kelvin')).result;
  assert.equal(celsius.scans[2].plant.insideTemperature.unit, '°C');
  assert.equal(kelvin.scans[2].plant.insideTemperature.unit, 'K');
  assert.ok(Math.abs(celsius.scans[2].plant.insideTemperature.value + 273.15
    - kelvin.scans[2].plant.insideTemperature.value) < 1e-12);
  assert.deepEqual(celsius.scans.map(scan => scan.virtualActuators['roof-vent'].applied),
    kelvin.scans.map(scan => scan.virtualActuators['roof-vent'].applied));
});

test('native objective activation rejects missing target display unit before a scan', async () => {
  const artifact = await compileSource(reference.source, { filename: reference.filename });
  delete artifact.manifest.configs[0].displayUnit;
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact,
    { context: { bootEpoch: 9, terminalCapacity: 8, bindings: [] } }),
  /display unit is required/);
});
