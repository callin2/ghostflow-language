import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const book = fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.md', import.meta.url), 'utf8');
function source(id) {
  const section = book.slice(book.indexOf(`### ${id} —`));
  const code = /```ghost\n([\s\S]*?)\n```/.exec(section);
  assert.ok(code, `missing ${id}`);
  return `${section.slice(0, code.index + code[0].length)}\n`;
}
const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const sample = (id, value) => ({ epoch: 1, id, timestampMs: id, value, quality: 'Good' });

test('PIG E38 turns the fan on at 30°C, keeps the deadband, and turns it off for stale input', async t => {
  const compiled = compileSourceSync(source('E38'), { filename: 'E38.ghost.md' });
  const runtime = await ControlRuntime.instantiateFramed(wasm(), compiled);
  t.after(() => runtime.dispose());
  const temperatures = [[28, false], [29, false], [30, true], [28, true], [27, true], [26, false], [30, true]];
  for (const [index, [celsius, on]] of temperatures.entries()) {
    const nowMs = (index + 1) * 1000;
    const reading = runtime.step({ nowMs, samples: { air: sample(nowMs, celsius + 273.15) } });
    assert.equal(reading.vm.safe.fan, on, `fan at ${celsius}°C`);
  }
  const stale = runtime.step({ nowMs: 10_001 });
  assert.equal(stale.sensors.air.quality, 'Stale');
  assert.equal(stale.vm.safe.fan, false);
  const recovered = runtime.step({ nowMs: 11_000, samples: { air: sample(11_000, 303.15) } });
  assert.equal(recovered.vm.safe.fan, true);
});

test('PIG climate chapter preserves heater unit equivalence and separate VPD domain', () => {
  const heaters = ['E16', 'E17', 'E18'].map(id => compileSourceSync(source(id), { filename: `${id}.ghost.md` }));
  for (const heater of heaters) {
    assert.equal(heater.manifest.sensors[0].type, 'Temperature');
    assert.equal(heater.manifest.sensors[0].validMin, 233.15);
    assert.equal(heater.manifest.sensors[0].validMax, 323.15);
    assert.equal(heater.manifest.signals[0].onBelow, 291.15);
    assert.equal(heater.manifest.signals[0].offAbove, 295.15);
  }
  for (const id of ['E19', 'E20', 'E21']) {
    const compiled = compileSourceSync(source(id), { filename: `${id}.ghost.md` });
    assert.deepEqual(compiled.manifest.sensors.map(item => item.type), ['Temperature', 'RelativeHumidity', 'PPFD']);
    assert.equal(compiled.manifest.sensors[0].validMin, 273.15);
    assert.equal(compiled.manifest.outputs.find(item => item.name === 'air_vpd_value').type, 'VaporPressureDeficit');
    assert.equal(compiled.manifest.outputs.find(item => item.name === 'vpd_valid').type, 'Bool');
  }
});

for (const id of ['E19', 'E20', 'E21']) {
  test(`PIG ${id} real WASM air VPD meets independent FAO exp oracle on the entire bounded grid`, async t => {
    const compiled = compileSourceSync(source(id), { filename: `${id}.ghost.md` });
    const runtime = await ControlRuntime.instantiateFramed(wasm(), compiled);
    t.after(() => runtime.dispose());
    let index = 0, maximumError = 0;
    for (let tenth = 0; tenth <= 500; tenth++) {
      const celsius = tenth / 10;
      for (const rh of [0, 0.25, 0.5, 0.75, 1]) {
        index++;
        const result = runtime.step({ nowMs: index, samples: {
          air: sample(index, celsius + 273.15), humidity: sample(index, rh), light: sample(index, 0.0005),
        } });
        assert.equal(result.vm.safe.vpd_valid, true);
        const expected = 0.6108 * Math.exp(17.27 * celsius / (celsius + 237.3)) * (1 - rh);
        const error = Math.abs(result.vm.safe.air_vpd_value / 1000 - expected);
        maximumError = Math.max(maximumError, error);
        assert.ok(error <= 0.001, `${id}, ${celsius}°C, ${rh}: error ${error} kPa`);
      }
    }
    let factorial = 1;
    for (let n = 2; n <= 15; n++) factorial *= n;
    // Independent Taylor remainder bound over x<=3.1, covering points between
    // grid samples. RH in [0,1] cannot increase the saturation-pressure error.
    const bound = 0.6108 * Math.exp(3.1) * 3.1 ** 15 / factorial;
    assert.ok(bound <= 0.001, `analytic approximation bound ${bound}`);
    t.diagnostic(`${id}: ${index} actual scans; max error ${maximumError} kPa; bound ${bound} kPa`);
  });
}

for (const [id, output, on, off, first, last] of [
  ['E19', 'humidify_demand', 1200, 1000, 1300, 900],
  ['E20', 'ventilate_demand', 400, 600, 300, 700],
  ['E21', 'irrigation_demand', 1000, 800, 1100, 700],
]) {
  test(`PIG ${id} strict policy boundaries retain either state at both equalities`, async t => {
    // Derived test candidate isolates the unchanged authored policy from the
    // numerical approximation. Expected boundary values are exact canonical Pa.
    const candidate = source(id).replace(/control (\w+) \{/, 'control $1 {\n  input test_vpd: VaporPressureDeficit;')
      .replace('ok(air_vpd(t, rh))', 'test_vpd');
    const runtime = await ControlRuntime.instantiateFramed(wasm(), compileSourceSync(candidate, { filename: `${id}-policy.ghost.md` }));
    t.after(() => runtime.dispose());
    const values = [[on, false], [off, false], [first, true], [on, true], [off, true], [last, false], [on, false], [off, false]];
    for (const [index, [value, expected]] of values.entries()) {
      const now = index + 1;
      const result = runtime.step({ nowMs: now, samples: {
        test_vpd: sample(now, value),
        air: sample(now, 298.15), humidity: sample(now, 0.5), light: sample(now, 0.0005),
      } });
      assert.equal(result.vm.safe[output], expected, `${id}: boundary ${value} with prior state`);
    }
  });
}
