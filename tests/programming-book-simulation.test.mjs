import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { DailySlots } from '../runtimes/wasm/schedule.mjs';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';
import { bindStationPolicy } from '../runtimes/wasm/policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const book = fs.readFileSync(path.join(root, 'docs/ProgrammingInGhostflow.md'), 'utf8');
const bookRuntimeIds = new Set();
function bookTest(id, title, body) {
  assert.ok(!bookRuntimeIds.has(id), `duplicate runtime example ${id}`);
  bookRuntimeIds.add(id);
  test(`Programming ${id} ${title}`, body);
}

const replay = JSON.parse(fs.readFileSync(path.join(root, 'examples/curriculum/replay-scenarios.json'), 'utf8'));

function bookSource(id) {
  const start = book.indexOf(`### ${id} —`);
  assert.ok(start >= 0, `missing book example ${id}`);
  const section = book.slice(start, book.indexOf('\n### ', start + 1) < 0 ? undefined : book.indexOf('\n### ', start + 1));
  if (id === 'E15') {
    const match = section.match(/````markdown\n([\s\S]*?)\n````/);
    assert.ok(match, 'missing complete E15 literate document');
    return match[1];
  }
  const match = section.match(/```ghost\n([\s\S]*?)\n```/);
  assert.ok(match, `missing executable fence ${id}`);
  return `# ${id}\n\n\`\`\`ghost\n${match[1]}\n\`\`\`\n`;
}

async function simulate(id, source, frames, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-book-sim-'));
  try {
    const artifact = path.join(directory, `${id}.gfb`);
    const compilation = await compileSource(source, { filename: `${id}.ghost.md` });
    writeArtifact(compilation, artifact);
    const fields = compilation.manifest.inputs;
    const scenario = {
      format: 'GhostFlow/scenario-v1', id,
      initialInputs: fields.map(field => ({ name: field.name, type: field.type, value: frames[0].inputs[field.name] })),
      keyBindings: [],
      actions: frames.flatMap((frame, index) => [
        ...fields.map(field => ({ kind: 'input', name: field.name, type: field.type, value: frame.inputs[field.name] })),
        // Retained healthy scenario observations, not clock-generated production samples.
        // The new illustrative revision names producer channels observed_*;
        // retained healthy datasets keep their original logical field names.
        ...compilation.manifest.sensors.filter(sensor => Object.hasOwn(frame.inputs, sensor.name.replace(/^observed_/, ''))).map(sensor => ({
          kind: 'sample', name: sensor.name, epoch: 1, id: index + 1,
          timestampMs: frame.atMs, value: frame.inputs[sensor.name.replace(/^observed_/, '')], quality: 'Good',
        })),
        ...(frame.actions ?? []),
        { kind: 'scan', atMs: frame.atMs, ...(frame.facts ?? {}) },
      ]),
      ...extra,
    };
    const scenarioPath = path.join(directory, 'scenario.toon');
    fs.writeFileSync(scenarioPath, `${encode(scenario)}\n`);
    const child = spawnSync(process.execPath, [path.join(root, 'tools/ghostsim.mjs'), artifact, scenarioPath, '--format', 'json'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(child.status, 0, `${id}: ${child.stdout}\n${child.stderr}`);
    const result = JSON.parse(child.stdout);
    assert.equal(result.outcome, 'completed', `${id}: simulator must complete real scans`);
    assert.equal(result.scans.length, frames.length);
    assert.deepEqual(result.scans.map(scan => scan.logicalTimeMs), frames.map(frame => frame.atMs));
    for (const [index, frame] of frames.entries()) {
      for (const [name, value] of Object.entries(frame.requested ?? frame.safe ?? {})) {
        assert.equal(result.scans[index].requestedVirtualIntent[name], value, `${id} scan ${index} requested ${name}`);
      }
      for (const [name, value] of Object.entries(frame.safe ?? {})) {
        assert.equal(result.scans[index].safeVirtualIntent[name], value, `${id} scan ${index} safe ${name}`);
      }
      for (const [name, value] of Object.entries(frame.state ?? {})) {
        assert.equal(result.scans[index].stateAfter[name], value, `${id} scan ${index} committed ${name}`);
      }
    }
    return result;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const frame = (atMs, inputs, safe, state, requested) => ({ atMs, inputs, safe, state, requested });

test('Programming quality revisions retain displays, block unknown starts and honor known protection', async () => {
  const fault = (name, id, atMs) => ({
    kind: 'sample', name: `observed_${name}`, epoch: 1, id,
    timestampMs: atMs, value: name === 'a' ? 123 : true, quality: 'Disconnected',
  });
  await simulate('E12-display-quality', bookSource('E12'), [
    frame(0, { a: 6, b: 2 }, { sum: 8, product: 12, negative: -6 }),
    { ...frame(1, { b: 4 }, { sum: 8, product: 12, negative: -6 }), actions: [fault('a', 2, 1)] },
    frame(2, { a: 0, b: 4 }, { sum: 4, product: 0, negative: 0 }),
  ]);
  await simulate('E07-producer-quality', bookSource('E07'), [
    { ...frame(0, { stop: false, enabled: true }, { pump: false }, { running: false }), actions: [fault('start', 1, 0)] },
    frame(1, { start: true, stop: false, enabled: true }, { pump: true }, { running: true }),
    { ...frame(2, { stop: false, enabled: true }, { pump: true }, { running: true }), actions: [fault('start', 3, 2)] },
    { ...frame(3, { stop: true, enabled: true }, { pump: false }, { running: false }), actions: [fault('start', 4, 3)] },
  ]);
  await simulate('E23-protection-quality', bookSource('E23'), [
    frame(0, { start: false, stop: false, jam_clear: true, reset: false },
      { conveyor: false, fault_lamp: false }, { fault_latched: false, start_armed: true }),
    { ...frame(1, { start: true, stop: false, reset: false },
      { conveyor: false, fault_lamp: false }, { fault_latched: false }), actions: [fault('jam_clear', 2, 1)] },
    { ...frame(2, { stop: false, jam_clear: false, reset: false },
      { conveyor: false, fault_lamp: true }, { fault_latched: true, start_armed: false }), actions: [fault('start', 3, 2)] },
  ]);
});

test('FAQ quality revisions enforce existing deadlines while request acquisition is unknown', async () => {
  const faq = fs.readFileSync(path.join(root, 'docs/language_faq.md'), 'utf8');
  const source = name => {
    const code = [...faq.matchAll(/```ghost\n([\s\S]*?)```/g)]
      .find(match => match[1].includes(`control ${name} {`))?.[1];
    assert.ok(code, `missing ${name} complete source`);
    return `# ${name}\n\n\`\`\`ghost\n${code}\`\`\`\n`;
  };
  const disconnected = (name, id, atMs) => ({
    kind: 'sample', name: `observed_${name}`, epoch: 1, id,
    timestampMs: atMs, value: true, quality: 'Disconnected',
  });
  const facts = row => ({ ...row, facts: { contextFacts: contextFacts(row.atMs) } });
  await simulate('FAQ-five-minute-quality', source('FiveMinuteRun'), [
    frame(0, { start: false, stop: false, low_water: false }, { pump: false }),
    frame(1, { start: true, stop: false, low_water: false }, { pump: true }),
    { ...frame(300002, { stop: false, low_water: false }, { pump: false }, { running: false }),
      actions: [disconnected('start', 3, 300002)] },
  ].map(facts), { context });
  await simulate('FAQ-off-delay-quality', source('OffDelay'), [
    frame(0, { request: true, stop: false }, { enabled: true }),
    frame(1, { request: false, stop: false }, { enabled: true }),
    { ...frame(3002, { stop: false }, { enabled: false }, { phase: 0 }),
      actions: [disconnected('request', 3, 3002)] },
  ].map(facts), { context });
  await simulate('FAQ-two-zone-quality', source('TwoZones'), [
    frame(0, { start: false }, { pump: false }),
    frame(1, { start: true }, { pump: false }, { phase: 1 }),
    { ...frame(2001, {}, { pump: true }, { phase: 2 }), actions: [disconnected('start', 3, 2001)] },
    { ...frame(302001, {}, { pump: false }, { phase: 3 }), actions: [disconnected('start', 4, 302001)] },
  ].map(facts), { context });
});
const plainCases = [
  ['E01', [frame(0, { switch_on: false }, { lamp: false }), frame(1, { switch_on: true }, { lamp: true }), frame(2, { switch_on: false }, { lamp: false })]],
  ['E03', [
    frame(0, { start: false, stop: false }, { valve: false, pump: false }, { running: false }),
    frame(1, { start: true, stop: false }, { valve: true, pump: true }, { running: true }),
    frame(2, { start: false, stop: false }, { valve: true, pump: true }, { running: true }),
    frame(3, { start: true, stop: true }, { valve: false, pump: false }, { running: false }),
  ]],
  ['E04', [frame(0, {}, { out_a: false, out_b: true }, { a: false, b: true }), frame(1, {}, { out_a: true, out_b: false }, { a: true, b: false })]],
  ['E05', [
    frame(0, { request: false, valve_ready: false }, { pump: false, valve: false }),
    frame(1, { request: true, valve_ready: true }, { pump: true, valve: true }),
    frame(2, { request: true, valve_ready: false }, { pump: false, valve: false }, undefined, { pump: true, valve: false }),
  ]],
  ['E06', [
    frame(0, { forward_button: true, reverse_button: false }, { forward: true, reverse: false }),
    frame(1, { forward_button: true, reverse_button: true }, { forward: false, reverse: false }, undefined, { forward: true, reverse: true }),
  ]],
  ['E07', [
    frame(0, { start: true, stop: false, enabled: true }, { pump: true }, { running: true }),
    frame(1, { start: false, stop: false, enabled: false }, { pump: false }, { running: false }),
    frame(2, { start: false, stop: false, enabled: true }, { pump: false }, { running: false }),
  ]],
  ['E12', [frame(0, { a: 6, b: 2 }, { sum: 8, difference: 4, product: 12, quotient: 3, negative: -6, equal: false, different: true, less: false, at_most: false, greater: true, at_least: true })]],
  ['E13', [frame(0, { a: 6, b: 2 }, { result: 3 }), frame(1, { a: 6, b: 0 }, { result: 0 })]],
  ['E15', [frame(0, { switch_on: false }, { lamp: false }), frame(1, { switch_on: true }, { lamp: true })]],
  ['E23', [
    frame(0, { start: false, stop: false, jam_clear: true, reset: false }, { conveyor: false, fault_lamp: false }, { running: false, fault_latched: false, start_armed: true }),
    frame(1, { start: true, stop: false, jam_clear: true, reset: false }, { conveyor: true, fault_lamp: false }, { running: true, fault_latched: false, start_armed: false }),
    frame(2, { start: false, stop: false, jam_clear: true, reset: false }, { conveyor: true, fault_lamp: false }, { running: true, fault_latched: false, start_armed: true }),
    frame(3, { start: false, stop: false, jam_clear: false, reset: false }, { conveyor: false, fault_lamp: true }, { running: false, fault_latched: true, start_armed: false }),
    frame(4, { start: false, stop: false, jam_clear: true, reset: false }, { conveyor: false, fault_lamp: true }, { running: false, fault_latched: true, start_armed: false }),
    frame(5, { start: false, stop: false, jam_clear: true, reset: true }, { conveyor: false, fault_lamp: false }, { running: false, fault_latched: false, start_armed: true }),
    frame(6, { start: true, stop: false, jam_clear: true, reset: false }, { conveyor: true, fault_lamp: false }, { running: true, fault_latched: false, start_armed: false }),
  ]],
  ['E24', [
    frame(0, { open_request: true, close_request: false, stop: false, open_limit: false }, { open_command: true, close_command: false, moving_open: true, open_confirmed: false }, { target_open: true }),
    frame(1, { open_request: false, close_request: false, stop: false, open_limit: true }, { open_command: true, close_command: false, moving_open: false, open_confirmed: true }, { target_open: true }),
    frame(2, { open_request: false, close_request: true, stop: false, open_limit: true }, { open_command: false, close_command: true, moving_open: false, open_confirmed: true }, { target_open: false }),
    frame(3, { open_request: false, close_request: false, stop: true, open_limit: false }, { open_command: false, close_command: false, moving_open: false, open_confirmed: false }, { target_open: false }),
  ]],
  ['E25', [
    frame(0, { stop_ok: true, forward_request: true, reverse_request: false }, { forward_command: true, reverse_command: false, conflict: false }),
    frame(1, { stop_ok: true, forward_request: true, reverse_request: true }, { forward_command: false, reverse_command: false, conflict: true }),
    frame(2, { stop_ok: false, forward_request: false, reverse_request: true }, { forward_command: false, reverse_command: false, conflict: false }),
  ]],
  ['E26', [frame(0, { watering_window: true, soil_needs_water: true, source_ready: true }, { pump_request: true }), frame(1, { watering_window: true, soil_needs_water: false, source_ready: true }, { pump_request: false })]],
  ['E27', [frame(0, { enabled: true, light_schedule: true, ventilation_request: false, drain_request: true, drain_path_ready: false }, { grow_light: true, circulation_fan: false, drain_pump: false, warning: true })]],
  ['E28', [
    frame(0, { fill_request: true, stop_ok: true, valve_open_limit: false, source_full: false }, { valve_open_command: true, pump_command: false }, { filling: true }),
    frame(1, { fill_request: false, stop_ok: true, valve_open_limit: true, source_full: false }, { valve_open_command: true, pump_command: true }, { filling: true }),
    frame(2, { fill_request: false, stop_ok: true, valve_open_limit: true, source_full: true }, { valve_open_command: false, pump_command: false }, { filling: false }),
  ]],
  ['E29', [
    frame(0, { fill_request: true, stop_ok: true, valve_open_limit: false }, { valve_open_command: true, pump_command: false, waiting_for_valve: true }),
    frame(1, { fill_request: true, stop_ok: true, valve_open_limit: true }, { valve_open_command: true, pump_command: true, waiting_for_valve: false }),
    frame(2, { fill_request: true, stop_ok: false, valve_open_limit: false }, { valve_open_command: false, pump_command: false, waiting_for_valve: false }),
  ]],
  ['E30', [
    frame(0, { enabled: true, watering_window: true, soil_needs_water: true, source_ready: false }, { pump_request: false, source_attention: true }),
    frame(1, { enabled: true, watering_window: true, soil_needs_water: true, source_ready: true }, { pump_request: true, source_attention: false }),
    frame(2, { enabled: true, watering_window: false, soil_needs_water: true, source_ready: true }, { pump_request: false, source_attention: false }),
  ]],
  ['E32', [
    frame(0, { soil_moisture: 20, threshold: 35 }, { pump_request: true }),
    frame(1, { soil_moisture: 40, threshold: 35 }, { pump_request: false }),
  ]],
];

for (const [id, frames] of plainCases) {
  bookTest(id, 'compiles and executes its teaching oracle through ghostsim', async () => {
    await simulate(id, bookSource(id), frames);
  });
}

for (const lesson of replay.scenarios) {
  test(`Programming ${lesson.id} executes preserved curriculum checkpoints through public ghostsim`, async () => {
    const frames = lesson.frames.map((record, index) => {
      const checkpoint = lesson.checkpoints.find(entry => entry.frame === index);
      return { ...record, requested: checkpoint?.requested, safe: checkpoint?.safe };
    });
    await simulate(lesson.id, fs.readFileSync(path.join(root, lesson.source.executablePath), 'utf8'), frames);
  });
}

const direction = (forward_start = false, reverse_start = false, stop_ok = true) => ({ forward_start, reverse_start, stop_ok, overload_ok: true });
const directionOutput = (forward_contactor = false, reverse_contactor = false) => ({ forward_contactor, reverse_contactor });
const timers = (on_delay_request = true, off_delay_request = true, limited_request = true, stop_ok = true) => ({ on_delay_request, off_delay_request, limited_request, stop_ok });
const timerOutput = (on_delayed, off_delayed, limited_run) => ({ on_delayed, off_delayed, limited_run });
const water = changes => ({ start_request: false, reset_request: false, stop_ok: true, emergency_stop_ok: true,
  overload_ok: true, source_water_ok: true, valve_drive_ok: true, open_limit: false, close_limit: true, ...changes });
const waterOutput = (valve_open_contactor = false, valve_close_contactor = false, pump_contactor = false, alarm = false) => ({ valve_open_contactor, valve_close_contactor, pump_contactor, alarm });
const additionalLessons = [
  ['PC-04', 'examples/curriculum/pc-04-direction-interlock.ghost.md', [
    frame(0, direction(), directionOutput(), { phase: 0 }),
    frame(1, direction(true), directionOutput(true), { phase: 1 }),
    frame(2, direction(), directionOutput(true), { phase: 1 }),
    frame(3, direction(false, true), directionOutput(), { phase: 4 }),
    frame(2002, direction(), directionOutput(), { phase: 4 }),
    frame(2003, direction(), directionOutput(false, true), { phase: 2 }),
    frame(2004, direction(true, true), directionOutput(), { phase: 0 }),
  ]],
  ['PC-06', 'examples/curriculum/pc-06-timer-patterns.ghost.md', [
    frame(0, timers(false, false, false), timerOutput(false, false, false)),
    frame(1, timers(), timerOutput(false, true, true)),
    frame(2000, timers(), timerOutput(false, true, true)),
    frame(2001, timers(), timerOutput(true, true, true)),
    frame(2002, timers(true, false), timerOutput(true, true, true)),
    frame(5001, timers(true, false), timerOutput(true, true, true)),
    frame(5002, timers(true, false), timerOutput(true, false, true)),
    frame(10000, timers(true, false), timerOutput(true, false, true)),
    frame(10001, timers(true, false), timerOutput(true, false, false), { limit_phase: 2 }),
    frame(10002, timers(true, false), timerOutput(true, false, false)),
    frame(10003, timers(true, false, false), timerOutput(true, false, false)),
    frame(10004, timers(true, false), timerOutput(true, false, true)),
    frame(10005, timers(true, false, true, false), timerOutput(false, false, false)),
  ]],
  ['PC-07', 'examples/curriculum/pc-07-tank-hysteresis.ghost.md', [
    frame(0, { low_level_reached: true, high_level_reached: false }, { fill_pump: false }, { phase: 0 }),
    frame(1, { low_level_reached: false, high_level_reached: false }, { fill_pump: true }, { phase: 1 }),
    frame(2, { low_level_reached: true, high_level_reached: false }, { fill_pump: true }, { phase: 1 }),
    frame(3, { low_level_reached: true, high_level_reached: true }, { fill_pump: false }, { phase: 0 }),
    frame(4, { low_level_reached: false, high_level_reached: true }, { fill_pump: false }, { phase: 2 }),
    frame(5, { low_level_reached: false, high_level_reached: false }, { fill_pump: false }, { phase: 0 }),
    frame(6, { low_level_reached: false, high_level_reached: false }, { fill_pump: true }, { phase: 1 }),
  ]],
  ['PC-10', 'examples/curriculum/pc-10-fault-alarm-reset.ghost.md', [
    frame(0, water({}), waterOutput(), { phase: 0, fault_cause: 0 }),
    frame(1, water({ start_request: true }), waterOutput(true), { phase: 1 }),
    frame(2, water({ open_limit: true, close_limit: false }), waterOutput(), { phase: 2 }),
    frame(2002, water({ open_limit: true, close_limit: false }), waterOutput(false, false, true), { phase: 3 }),
    frame(2003, water({ source_water_ok: false, open_limit: true, close_limit: false }), waterOutput(false, false, false, true), { phase: 6, fault_cause: 3 }),
    frame(2004, water({ source_water_ok: false, open_limit: true, close_limit: false }), waterOutput(false, true, false, true), { phase: 7, fault_cause: 3 }),
    frame(2005, water({ source_water_ok: false }), waterOutput(false, false, false, true), { phase: 8, fault_cause: 3 }),
    frame(2006, water({}), waterOutput(false, false, false, true), { phase: 8 }),
    frame(2007, water({ reset_request: true, start_request: true }), waterOutput(), { phase: 0, fault_cause: 0 }),
    frame(2008, water({ start_request: true }), waterOutput(), { phase: 0 }),
  ]],
];

for (const [id, sourcePath, frames] of additionalLessons) {
  test(`Programming ${id} compiles and simulates timing, conflict or recovery behavior`, async () => {
    await simulate(id, fs.readFileSync(path.join(root, sourcePath), 'utf8'), frames);
  });
}

const measured = (name, id, atMs, value, quality = 'Good') => ({ kind: 'sample', name, epoch: 1, id, timestampMs: atMs, value, quality });

for (const id of ['E16', 'E17', 'E18']) {
  bookTest(id, 'runs equivalent heater thresholds, negative temperature, faults and recovery through ghostsim', async () => {
    // Exact canonical golden values avoid a second, rounded host affine
    // conversion: -40 + 273.15 is one ulp below literal 233.15 in JS.
    const readings = [[291.15, false], [290.15, true], [291.15, true], [295.15, true], [296.15, false], [295.15, false],
      [233.15, true], [293.15, false, 'Disconnected'], [293.15, false], [290.15, true]];
    const frames = [frame(0, {}, { heater: false })];
    for (const [index, [kelvin, expected, quality = 'Good']] of readings.entries()) {
      const now = index + 1;
      frames.push({ ...frame(now, {}, { heater: expected }),
        actions: [measured('air', now, now, kelvin, quality)] });
    }
    frames.push(frame(3010, {}, { heater: false })); // exact last-sample age 3s
    frames.push({ ...frame(3011, {}, { heater: true }), actions: [measured('air', 11, 3011, 290.15)] });
    await simulate(id, bookSource(id), frames);
  });
}

for (const [id, output, rhOn, rhBand, rhOff, gate] of [
  ['E19', 'humidify_demand', 0.5, 0.65, 0.7, 0.0002],
  ['E20', 'ventilate_demand', 0.9, 0.85, 0.8, 0.0002],
  ['E21', 'irrigation_demand', 0.5, 0.72, 0.76, 0.0003],
]) {
  bookTest(id, 'runs actual climate demand, light gating, fault inhibition and recovery through ghostsim', async () => {
    const frames = [frame(0, {}, { [output]: false, vpd_valid: false, air_vpd_value: 0 })];
    const add = (now, rh, expected, { light = 0.0005, air = 298.15, lightQuality = 'Good',
      humidityQuality = 'Good', airQuality = 'Good', valid = true } = {}) => {
      frames.push({ ...frame(now, {}, { [output]: expected, vpd_valid: valid, ...(valid ? {} : { air_vpd_value: 0 }) }),
        actions: [measured('air', now, now, air, airQuality), measured('humidity', now, now, rh, humidityQuality),
          measured('light', now, now, light, lightQuality)] });
    };
    add(1, rhOn, true);
    add(2, rhBand, true);
    add(3, rhOff, false);
    add(4, rhBand, false);
    add(5, rhOn, true, { light: gate }); // light equality is inclusive
    add(6, rhOn, false, { light: 0.0001 });
    add(7, rhOn, false, { lightQuality: 'Invalid' });
    add(8, rhOn, true);
    add(9, rhOn, false, { humidityQuality: 'Disconnected', valid: false });
    add(10, rhBand, false); // fault cleared retained climate demand
    add(11, rhOn, true);
    add(12, rhOn, false, { airQuality: 'Invalid', valid: false });
    add(13, rhOn, true);
    add(14, 1.1, false, { valid: false }); // outside RH sensor domain
    add(15, rhOn, true);
    add(16, rhOn, false, { air: 324.15, valid: false }); // outside approximation domain
    add(17, 1, id === 'E20', { air: 273.15 }); // true zero VPD, still valid
    add(18, rhOn, true);
    frames.push(frame(3018, {}, { [output]: false, vpd_valid: false, air_vpd_value: 0 }));
    add(3020, rhOn, true);
    const result = await simulate(id, bookSource(id), frames);
    const lightOnly = [5, 6, 7, 8].map(index => result.scans[index].safeVirtualIntent.air_vpd_value);
    assert.ok(lightOnly.every(value => value === lightOnly[0]), `${id}: light never changes fixed T/RH VPD`);
    assert.equal(result.scans[7].safeVirtualIntent.vpd_valid, true, 'light fault does not invalidate good T/RH');
    assert.equal(result.scans[17].safeVirtualIntent.air_vpd_value, 0);
    assert.equal(result.scans[17].safeVirtualIntent.vpd_valid, true, 'measured zero differs from fault placeholder');
  });
}

// Independent physical checkpoints exercise changing decisions; a constant
// valid input cannot substitute for a requested daily environment simulation.
const dailyClimate = [
  [0, 291.15, 0.90, 0, false, false, false, false],
  [3, 290.15, 0.92, 0, true, false, false, false],
  [6, 289.15, 0.94, 0, true, false, false, false],
  [9, 295.15, 0.85, 0.0005, true, false, true, false],
  [12, 301.15, 0.60, 0.001, false, true, false, true],
  [15, 304.15, 0.45, 0.00065, false, true, false, true],
  [18, 304.15, 0.60, 0, false, false, false, false],
  [21, 296.15, 0.80, 0, false, false, false, false],
  [24, 291.15, 0.90, 0, false, false, false, false],
  [27, 290.15, 0.92, 0, true, false, false, false],
];
for (const [id, output, expectedIndex] of [
  ['E16', 'heater', 4], ['E17', 'heater', 4], ['E18', 'heater', 4],
  ['E19', 'humidify_demand', 5], ['E20', 'ventilate_demand', 6], ['E21', 'irrigation_demand', 7],
]) {
  test(`Programming ${id} daily environment changes real control decisions and repeats`, async () => {
    // Sparse checkpoint scans intentionally omit the heater's 09 equality:
    // a multi-hour sample gap resets hysteresis on Stale. Continuous reader
    // sampling retains ON there; the separate boundary test proves equality.
    const checkpoints = expectedIndex === 4 ? dailyClimate.filter(([hour]) => hour !== 9) : dailyClimate;
    const frames = checkpoints.map((checkpoint, index) => {
      const [hour, air, humidity, light] = checkpoint;
      const now = hour * 3_600_000;
      return { ...frame(now, {}, { [output]: checkpoint[expectedIndex], ...(expectedIndex > 4 ? { vpd_valid: true } : {}) }),
        actions: [measured('air', index + 1, now, air), ...(expectedIndex > 4
          ? [measured('humidity', index + 1, now, humidity), measured('light', index + 1, now, light)] : [])] };
    });
    assert.equal(new Set(frames.map(item => item.safe[output])).size, 2, 'daily oracle must include ON and OFF');
    const result = await simulate(`${id}-daily`, bookSource(id), frames);
    if (expectedIndex > 4) {
      for (const [index, [, kelvin, rh]] of dailyClimate.entries()) {
        const t = kelvin - 273.15;
        const expectedPa = 610.8 * Math.exp(17.27 * t / (t + 237.3)) * (1 - rh);
        assert.ok(Math.abs(result.scans[index].safeVirtualIntent.air_vpd_value - expectedPa) <= 1,
          `${id} daily checkpoint ${index}: independent air-VPD oracle`);
      }
    }
  });
}

bookTest('E10', 'simulates median readiness, retained thresholds and exact stale boundary', async () => {
  const values = [29, 90, 28, 30, 30, 30, 36, 36];
  const expected = [false, false, true, true, true, true, true, false];
  const frames = values.map((value, index) => ({
    ...frame(index * 1000, { enabled: true }, { pump: expected[index] }),
    actions: [measured('moisture', index + 1, index * 1000, value)],
  }));
  frames.push(frame(9999, { enabled: true }, { pump: false }), frame(10000, { enabled: true }, { pump: false }));
  const result = await simulate('E10', bookSource('E10'), frames);
  assert.equal(result.scans[0].inputs.__gf_sensor_ok_moisture, false);
  assert.equal(result.scans[2].inputs.__gf_sensor_value_moisture, 29);
  assert.equal(result.scans.at(-2).inputs.__gf_sensor_ok_moisture, true);
  assert.equal(result.scans.at(-1).inputs.__gf_sensor_ok_moisture, false);
});

bookTest('E14', 'simulates installed, faulted and absent optional sensor capabilities', async () => {
  await simulate('E14-absent', bookSource('E14'), [frame(0, {}, { request: false })], { capabilities: [] });
  const present = [
    frame(0, {}, { request: false }),
    { ...frame(1, {}, { request: true }), actions: [measured('moisture', 1, 1, 20)] },
    { ...frame(2, {}, { request: false }), actions: [measured('moisture', 2, 2, 40)] },
    { ...frame(3, {}, { request: false }), actions: [measured('moisture', 3, 3, 20, 'Disconnected')] },
  ];
  await simulate('E14-installed', bookSource('E14'), present, { capabilities: [{ kind: 'sensor', name: 'moisture', type: 'Percent' }] });
});

test('Programming advanced tutorial03 simulates filter readiness, latch and stop priority', async () => {
  const frames = Array.from({ length: 5 }, (_, index) => ({
    ...frame(index * 1000, { start: true, stop: false }, { pump: index === 4, valve: index === 4 }, { watering: index === 4 }),
    actions: [measured('moisture', index + 1, index * 1000, 20)],
  }));
  frames.push(frame(4001, { start: false, stop: false }, { pump: true, valve: true }, { watering: true }));
  frames.push(frame(4002, { start: true, stop: true }, { pump: false, valve: false }, { watering: false }));
  await simulate('tutorial03', fs.readFileSync(path.join(root, 'examples/tutorial/03-moisture.ghost.md'), 'utf8'), frames);
});

bookTest('E09', 'simulates admitted DailySlots and the five-minute boundary', async () => {
  const source = bookSource('E09');
  const compiled = await compileSource(source, { filename: 'E09.ghost.md' });
  const site = compiled.manifest.schedules[0].site;
  const startWallMs = Date.UTC(2026, 8, 24, 21); // 2026-09-25 06:00 Asia/Seoul
  const scheduleFacts = atMs => ({
    clock: { monotonicMs: atMs, bootEpoch: 7, wallMs: startWallMs - 1 + atMs,
      trusted: true, uncertaintyMs: 0, sourceRevision: 'book-clock-v1' },
    schedules: [{ kind: 'daily-slots', site, coverageFromWallMs: startWallMs - 1, coverageToWallMs: startWallMs + 300_001,
      rows: [{ sourceDay: 20_721, slotKey: 361, minuteOfDay: 360, fold: 0, scheduledWallMs: startWallMs,
        available: true, providerRevision: 'book-civil-v1', contextRevision: 'book-tzdb-v1' }] }],
  });
  const frames = [[0, false, 0], [1, true, 1], [2, true, 1], [300000, true, 1], [300001, false, 0]]
    .map(([atMs, on, phase]) => ({ ...frame(atMs, {}, { pump: on, valve: on }, { phase }), facts: { scheduleFacts: scheduleFacts(atMs) } }));
  await simulate('E09', source, frames, { schedule: { bootEpoch: 7, terminalCapacity: 8 } });
});

const context = { bootEpoch: 7, terminalCapacity: 8, bindings: [] };
const contextFacts = (atMs, settings = null) => ({ clock: {
  monotonicMs: atMs, bootEpoch: 7, wallMs: 1_790_812_800_000 + atMs, uncertaintyMs: 0,
  trusted: true, unknownReason: null, sourceRevision: 'book-settings-clock-v1',
}, natural: [], schedules: [], settings });
// Settings position is the one-based accepted scan ordinal, not logical milliseconds.
const settingsEmission = (fingerprint, configId, scanPosition, baseRevision, result) => ({
  programFingerprint: fingerprint, eventId: `book-settings-${scanPosition}`, baseRevision, position: scanPosition,
  origin: 'producerObservation', changes: [{ configId, result }],
});

bookTest('E02', 'simulates healthy config, explicit fault fallback and recovery', async () => {
  const source = bookSource('E02');
  const probe = await simulate('E02', source, [{ ...frame(0, { level: 29 }, { pump: true }), facts: { contextFacts: contextFacts(0) } }], { context });
  const fingerprint = probe.scans[0].settingsState.programFingerprint;
  const compiled = await compileSource(source, { filename: 'E02.ghost.md' });
  const id = compiled.manifest.configs.find(item => item.name === 'threshold').id;
  const frames = [frame(0, { level: 29 }, { pump: true }), frame(1, { level: 30 }, { pump: false }),
    frame(2, { level: 31 }, { pump: false }), frame(3, { level: 29 }, { pump: false }), frame(4, { level: 29 }, { pump: true })];
  for (const [index, entry] of frames.entries()) entry.facts = { contextFacts: contextFacts(entry.atMs,
    entry.atMs === 3 ? settingsEmission(fingerprint, id, index + 1, 0, { ok: false, fault: 'SettingsUnavailable' })
      : entry.atMs === 4 ? settingsEmission(fingerprint, id, index + 1, 1, { ok: true, type: 'Percent', value: 30 }) : null) };
  await simulate('E02', source, frames, { context });
});

bookTest('E08', 'simulates timer boundaries and cancellation on config fault', async () => {
  const source = bookSource('E08');
  const probe = await simulate('E08', source, [{ ...frame(0, { start: false }, { motor: false }), facts: { contextFacts: contextFacts(0) } }], { context });
  const fingerprint = probe.scans[0].settingsState.programFingerprint;
  const compiled = await compileSource(source, { filename: 'E08.ghost.md' });
  const id = compiled.manifest.configs.find(item => item.name === 'delay').id;
  const frames = [[0, false, 0], [1000, true, 1], [2999, true, 1], [3000, true, 2], [4000, false, 0],
    [5000, true, 1], [6000, true, 0], [6001, true, 1], [8000, true, 1], [8001, true, 2]]
    .map(([atMs, start, phase], index) => ({ ...frame(atMs, { start }, { motor: phase === 2 }, { phase }), facts: {
      contextFacts: contextFacts(atMs,
        atMs === 6000 ? settingsEmission(fingerprint, id, index + 1, 0, { ok: false, fault: 'SettingsUnavailable' })
          : atMs === 6001 ? settingsEmission(fingerprint, id, index + 1, 1, { ok: true, type: 'Duration', value: 2000 }) : null),
    } }));
  await simulate('E08', source, frames, { context });
});

test('Programming advanced tutorial04 compiles and simulates its existing public WASM schedule host', async () => {
  const sourcePath = 'examples/tutorial/04-extra-valves.ghost.md';
  const compiled = await compileSource(fs.readFileSync(path.join(root, sourcePath), 'utf8'), { filename: sourcePath });
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    const scheduler = new DailySlots(compiled.manifest.schedules[0]);
    const scheduled = Date.parse('2026-09-25T19:15:00+09:00');
    assert.equal(scheduler.poll({ nowMs: 0, wallMs: scheduled - 1000 }).due, false);
    const event = scheduler.poll({ nowMs: 1000, wallMs: scheduled });
    assert.equal(event.due, true);
    const times = [0, 1000, 2999, 3000, 303000, 305000, 307000, 309000, 609000, 611000];
    const phases = [0, 1, 1, 2, 3, 4, 5, 6, 7, 0];
    for (const [index, nowMs] of times.entries()) {
      const row = runtime.step({ nowMs, due: { extra_starts: nowMs === 1000 && event.due } });
      const phase = phases[index];
      const expected = { pump: [2, 6].includes(phase), valve3: [1, 2, 3].includes(phase), valve4: [5, 6, 7].includes(phase) };
      assert.equal(row.vm.stateAfter.phase, phase, `tutorial04 phase at ${nowMs}`);
      assert.deepEqual(row.vm.requested, expected, `tutorial04 requested at ${nowMs}`);
      assert.deepEqual(row.vm.safe, expected, `tutorial04 safe at ${nowMs}`);
    }
  } finally { runtime.dispose(); }
});

test('Programming advanced station policy compiles through ghostrules and authorizes/stops in actual WASM', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-book-station-'));
  let station;
  try {
    const output = path.join(directory, 'station-rules.json');
    const cli = spawnSync(process.execPath, [path.join(root, 'tools/ghostrules.mjs'),
      path.join(root, 'examples/station-rules.ghost.md'), output], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    const artifact = JSON.parse(fs.readFileSync(output, 'utf8'));
    const policy = bindStationPolicy(artifact, {
      station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 3_600_000, maxStartBudgetMs: 1000 } },
      pump: { id: 'pump1' }, settings: { id: 'settings' }, schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
      modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
      activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
    });
    assert.equal(policy.stationConfig.maxOpenValves, 2);
    station = await GhostFlowStation.instantiate(fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')), policy.stationConfig);
    station.synchronizeDay({ day: 20_721, nowMs: 0n, nextDayDeadlineMs: 10_000n });
    station.enter({ requestId: 1n, ...station.claim, mode: 'Auto' });
    await station.start({ requestId: 2n, ...station.claim, sessionId: 77n, ownerId: 88n,
      mode: 'Auto', valves: 1n, budgetMs: 100n, occurrenceId: 501n, nowMs: 10n }, async () => true);
    assert.equal(station.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 10n }).pumpOn, true);
    assert.throws(() => station.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 0n, nowMs: 10n }), /valve|pump/i);
    const stopped = station.requestStop({ requestId: 3n, ...station.claim });
    assert.deepEqual(stopped, { forceSafeOutputs: true, reason: 'StopRequested' });
    assert.throws(() => station.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 11n }), /stop/i);
    assert.throws(() => station.enter({ requestId: 4n, ...station.claim, mode: 'Manual' }), /not stopped/i);
  } finally {
    station?.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const errorExamples = [
  ['E90', /expected ; after input declaration/], ['E91', /requires matching ordered types/],
  ['E92', /next state references are allowed only in output expressions/], ['E93', /unexpected trailing token control/],
  ['E94', /Int literal is outside/], ['E95', /case for Mode must be exhaustive/],
  ['E96', /duplicate output connection lamp/], ['E97', /cannot use Result directly/],
  ['E98', /does not implicitly mix Int and Number/], ['E99', /invalid datetime literal/],
  ['E100', /Solar schedule requires fallback/], ['E101', /fallback must be skip/],
  ['E102', /requires one argument and terminal: skip/],
];
for (const [id, diagnostic] of errorExamples) {
  test(`Programming ${id} is rejected by public compiler diagnostics before simulation`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-book-invalid-'));
    try {
      const section = book.slice(book.indexOf(`### ${id} —`));
      const code = section.match(/```ghost-error\n([\s\S]*?)\n```/);
      assert.ok(code, `missing ${id} error fence`);
      const filename = path.join(directory, `${id}.ghost.md`);
      fs.writeFileSync(filename, `# ${id}\n\n\`\`\`ghost\n${code[1]}\n\`\`\`\n`);
      const cli = spawnSync(process.execPath, [path.join(root, 'tools/ghostc.mjs'), '--check', filename], { encoding: 'utf8' });
      assert.equal(cli.status, 1);
      assert.match(cli.stderr + cli.stdout, diagnostic);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}

test('Programming source experiments simulate changed priorities and explicit old-state reads', async () => {
  await simulate('E01-invert', bookSource('E01').replace('lamp <- switch_on |> recover(false)', 'lamp <- case switch_on { ok(value) => !value; fault(_) => false; }'), [
    frame(0, { switch_on: false }, { lamp: true }), frame(1, { switch_on: true }, { lamp: false }),
    { ...frame(2, {}, { lamp: false }), actions: [{ kind: 'sample', name: 'switch_on',
      epoch: 1, id: 3, timestampMs: 2, value: true, quality: 'Disconnected' }] },
  ]);
  await simulate('E02-inclusive', bookSource('E02').replace('level < value', 'level <= value'),
    [29, 30, 31].map((level, atMs) => ({ ...frame(atMs, { level }, { pump: level <= 30 }), facts: { contextFacts: contextFacts(atMs) } })), { context });
  await simulate('E03-old-state-output', bookSource('E03').replace("pump <- running'", 'pump <- running'), [
    frame(0, { start: true, stop: false }, { valve: true, pump: false }, { running: true }),
    frame(1, { start: false, stop: false }, { valve: true, pump: true }, { running: true }),
    frame(2, { start: false, stop: true }, { valve: false, pump: false }, { running: false }, { valve: false, pump: true }),
  ]);
  await simulate('E06-request-experiment', bookSource('E03').replace("pump <- running'", 'pump <- start_requested'), [
    frame(0, { start: true, stop: false }, { valve: true, pump: true }, { running: true }),
    frame(1, { start: false, stop: false }, { valve: true, pump: false }, { running: true }),
  ]);
  await simulate('chapter10-priority-B', bookSource('E03').replace('!stop_requested && (running || (start_requested && !restart_blocked))', 'start_requested || (!stop_requested && running)'), [
    frame(0, { start: true, stop: true }, { valve: true, pump: true }, { running: true }),
  ]);
  await simulate('E08-late-observation', bookSource('E08'), [[0, false, false], [1000, true, false], [2999, true, false], [3500, true, true]]
    .map(([atMs, start, motor]) => ({ ...frame(atMs, { start }, { motor }), facts: { contextFacts: contextFacts(atMs) } })), { context });
});

test('Programming E10 equal-threshold experiment produces the real compiler diagnostic', async () => {
  await assert.rejects(compileSource(bookSource('E10').replace('off_above: 35%', 'off_above: 30%'),
    { filename: 'E10-equal-thresholds.ghost.md' }), /hysteresis on_below must be less than off_above/);
});

test('Programming inventory assigns every fence and numbered example to executable, diagnostic or explanatory coverage', () => {
  const compileOnlyExamples = ['E22', 'E31', 'E33'];
  // These examples execute in the separately listed native/WASM test suite.
  // Derive its registrations instead of declaring runtime coverage by hand.
  const naturalTests = fs.readFileSync(path.join(root, 'tests/programming-natural-examples.test.mjs'), 'utf8');
  const naturalRuntimeIds = [...naturalTests.matchAll(/test\('Programming (E\d+) /g)].map(match => match[1]);
  assert.ok(naturalRuntimeIds.length > 0, 'natural-time examples have runtime test registrations');
  const runtimeIds = [...bookRuntimeIds, ...naturalRuntimeIds];
  assert.equal(new Set(runtimeIds).size, runtimeIds.length, 'runtime example registrations are unique');
  const numbered = [...book.matchAll(/^### (E\d+) —/gm)].map(match => match[1]).sort();
  assert.deepEqual(numbered, [...runtimeIds, ...compileOnlyExamples, ...errorExamples.map(([id]) => id), 'E11'].sort());
  const fences = [...book.matchAll(/^`{3,4}([^`\n]+)$/gm)].map(match => match[1]);
  const counts = Object.fromEntries([...new Set(fences)].map(kind => [kind, fences.filter(item => item === kind).length]));
  assert.deepEqual(counts, { ghost: runtimeIds.length + compileOnlyExamples.length + 1, text: 3, markdown: 1, sh: 1, 'ghost-error': errorExamples.length });
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'examples/curriculum/catalog.json'), 'utf8'));
  assert.deepEqual(catalog.lessons.map(lesson => lesson.id).sort(), [...replay.scenarios.map(lesson => lesson.id), ...additionalLessons.map(([id]) => id)].sort());
  const links = [...book.matchAll(/\]\(\.\.\/(examples\/[^)#]+\.ghost\.md)(?:#[^)]*)?\)/g)].map(match => match[1]);
  const checkedLinks = [...replay.scenarios.filter(lesson => lesson.id !== 'PC-01').map(lesson => lesson.source.executablePath),
    ...additionalLessons.map(([, sourcePath]) => sourcePath), 'examples/station-rules.ghost.md',
    'examples/tutorial/03-moisture.ghost.md', 'examples/tutorial/04-extra-valves.ghost.md'];
  assert.deepEqual([...new Set(links)].sort(), checkedLinks.sort());
});
