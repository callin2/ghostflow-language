import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const book = fs.readFileSync(path.join(root, 'docs/ProgrammingInGhostflow.md'), 'utf8');
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
      actions: frames.flatMap(frame => [
        ...fields.map(field => ({ kind: 'input', name: field.name, type: field.type, value: frame.inputs[field.name] })),
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
];

for (const [id, frames] of plainCases) {
  test(`Programming ${id} compiles and executes its teaching oracle through ghostsim`, async () => {
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

test('Programming E10 simulates median readiness, retained thresholds and exact stale boundary', async () => {
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

test('Programming E14 simulates installed, faulted and absent optional sensor capabilities', async () => {
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

test('Programming E09 simulates admitted DailySlots and the five-minute boundary', async () => {
  const source = bookSource('E09');
  const compiled = await compileSource(source, { filename: 'E09.ghost.md' });
  const site = compiled.manifest.schedules[0].site;
  const startWallMs = Date.UTC(2026, 8, 24, 21); // 2026-09-25 06:00 Asia/Seoul
  const scheduleFacts = atMs => ({
    clock: { monotonicMs: atMs, bootEpoch: 7, wallMs: startWallMs - 1 + atMs,
      trusted: true, uncertaintyMs: 0, sourceRevision: 'book-clock-v1' },
    schedules: [{ kind: 'daily-slots', site, coverageFromWallMs: startWallMs - 1, coverageToWallMs: startWallMs + 300_001,
      rows: [{ sourceDay: 20_721, slotKey: 360, minuteOfDay: 360, fold: 0, scheduledWallMs: startWallMs,
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
const settingsEmission = (fingerprint, configId, atMs, baseRevision, result) => ({
  programFingerprint: fingerprint, eventId: `book-settings-${atMs}`, baseRevision, position: atMs,
  origin: 'producerObservation', changes: [{ configId, result }],
});

test('Programming E02 simulates healthy config, explicit fault fallback and recovery', async () => {
  const source = bookSource('E02');
  const probe = await simulate('E02', source, [{ ...frame(0, { level: 29 }, { pump: true }), facts: { contextFacts: contextFacts(0) } }], { context });
  const fingerprint = probe.scans[0].settingsState.programFingerprint;
  const compiled = await compileSource(source, { filename: 'E02.ghost.md' });
  const id = compiled.manifest.configs.find(item => item.name === 'threshold').id;
  const frames = [frame(0, { level: 29 }, { pump: true }), frame(1, { level: 30 }, { pump: false }),
    frame(2, { level: 31 }, { pump: false }), frame(3, { level: 29 }, { pump: false }), frame(4, { level: 29 }, { pump: true })];
  for (const entry of frames) entry.facts = { contextFacts: contextFacts(entry.atMs,
    entry.atMs === 3 ? settingsEmission(fingerprint, id, 3, 0, { ok: false, fault: 'SettingsUnavailable' })
      : entry.atMs === 4 ? settingsEmission(fingerprint, id, 4, 1, { ok: true, type: 'Percent', value: 30 }) : null) };
  await simulate('E02', source, frames, { context });
});

test('Programming E08 simulates timer boundaries and cancellation on config fault', async () => {
  const source = bookSource('E08');
  const probe = await simulate('E08', source, [{ ...frame(0, { start: false }, { motor: false }), facts: { contextFacts: contextFacts(0) } }], { context });
  const fingerprint = probe.scans[0].settingsState.programFingerprint;
  const compiled = await compileSource(source, { filename: 'E08.ghost.md' });
  const id = compiled.manifest.configs.find(item => item.name === 'delay').id;
  const frames = [[0, false, 0], [1000, true, 1], [2999, true, 1], [3000, true, 2], [4000, false, 0],
    [5000, true, 1], [6000, true, 0], [6001, true, 1], [8000, true, 1], [8001, true, 2]]
    .map(([atMs, start, phase]) => ({ ...frame(atMs, { start }, { motor: phase === 2 }, { phase }), facts: {
      contextFacts: contextFacts(atMs,
        atMs === 6000 ? settingsEmission(fingerprint, id, atMs, 0, { ok: false, fault: 'SettingsUnavailable' })
          : atMs === 6001 ? settingsEmission(fingerprint, id, atMs, 1, { ok: true, type: 'Duration', value: 2000 }) : null),
    } }));
  await simulate('E08', source, frames, { context });
});
