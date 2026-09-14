import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { compileSource } from '../tools/toolchain.mjs';

function solarControl(schedule, name = 'SolarFixture') {
  return [
    `control ${name} {`,
    schedule,
    '  output enabled: Bool;',
    '  enabled <- dawn.due;',
    '}',
  ].join('\n');
}

const dawn = [
  '  schedule dawn: Solar {',
  '    timezone = "Asia/Seoul";',
  '    latitude = 37.5665;',
  '    longitude = 126.9780;',
  '    at = sun`rise + 30min`;',
  '    fallback = skip;',
  '  }',
].join('\n');

function expectError(source, message, { line, column } = {}) {
  assert.throws(() => compileControl(source, { filename: 'solar-invalid.ghost' }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.match(error.message, message);
    if (line !== undefined) assert.equal(error.line, line);
    if (column !== undefined) assert.equal(error.column, column);
    return true;
  });
}

test('Solar lowers exact v3 descriptors and reuses generated Bool due inputs', () => {
  const source = solarControl(dawn);
  const result = compileControl(source, { filename: 'solar-fixture.ghost' });

  assert.equal(result.manifest.format, 'GhostFlow/control-v3');
  assert.deepEqual(result.manifest.schedules, [{
    kind: 'solar', name: 'dawn', timezone: 'Asia/Seoul', latitude: 37.5665,
    longitude: 126.978, event: 'rise', offsetMs: 1_800_000,
    fallback: 'skip', dueInput: '__gf_schedule_due_dawn',
  }]);
  assert.ok(result.manifest.inputs.every(input => input.name !== '__gf_schedule_due_dawn'));
  assert.ok(result.sourceMap.some(node => node.kind === 'schedule' && node.line === 2 && node.column === 3));
});

test('Solar accepts zero and negative offsets plus rise and set without offsets', () => {
  const source = [
    'control SolarOffsets {',
    '  schedule dawn: Solar { timezone = "UTC"; latitude = -90; longitude = 180; at = sun`rise + 0ms`; fallback = skip; }',
    '  schedule dusk: Solar { timezone = "UTC"; latitude = 90; longitude = -180; at = sun`set - 24h`; fallback = skip; }',
    '  schedule plain_rise: Solar { timezone = "UTC"; latitude = 0; longitude = 0; at = sun`rise`; fallback = skip; }',
    '  schedule plain_set: Solar { timezone = "UTC"; latitude = 0; longitude = 0; at = sun`set`; fallback = skip; }',
    '  output enabled: Bool;',
    '  enabled <- dawn.due || dusk.due || plain_rise.due || plain_set.due;',
    '}',
  ].join('\n');
  const result = compileControl(source, { filename: 'solar-offsets.ghost' });
  assert.deepEqual(result.manifest.schedules.map(({ event, offsetMs }) => ({ event, offsetMs })), [
    { event: 'rise', offsetMs: 0 }, { event: 'set', offsetMs: -86_400_000 },
    { event: 'rise', offsetMs: 0 }, { event: 'set', offsetMs: 0 },
  ]);
});

test('Solar and DailySlots can coexist without changing the DailySlots descriptor', () => {
  const source = [
    'control MixedSchedules {',
    '  schedule slots: DailySlots<15min> { timezone = "Asia/Seoul"; selected = [06:00]; }',
    dawn,
    '  output enabled: Bool;',
    '  enabled <- slots.due || dawn.due;',
    '}',
  ].join('\n');
  const result = compileControl(source, { filename: 'mixed-schedules.ghost' });
  assert.equal(result.manifest.format, 'GhostFlow/control-v3');
  assert.deepEqual(result.manifest.schedules[0], {
    name: 'slots', timezone: 'Asia/Seoul', slots: [360], dueInput: '__gf_schedule_due_slots',
  });
  assert.equal(Object.hasOwn(result.manifest.schedules[0], 'kind'), false);
  assert.equal(result.manifest.schedules[1].kind, 'solar');
});

test('Solar rejects missing, duplicate, unknown, nonliteral, and out-of-range fields at source locations', () => {
  expectError(solarControl(dawn.replace('    fallback = skip;\n', '')), /Solar schedule requires fallback/, { line: 2, column: 3 });
  expectError(solarControl(dawn.replace('    latitude = 37.5665;', '    latitude = 37.5665;\n    latitude = 37.5;')), /duplicate Solar schedule option latitude/, { line: 5, column: 5 });
  expectError(solarControl(dawn.replace('    fallback = skip;', '    unknown = 1;\n    fallback = skip;')), /unsupported Solar schedule option unknown/, { line: 7, column: 5 });
  expectError(solarControl(dawn.replace('latitude = 37.5665', 'latitude = 90.0001')), /Solar latitude must be between -90 and 90/, { line: 4, column: 16 });
  expectError(solarControl(dawn.replace('longitude = 126.9780', 'longitude = latitude')), /Solar longitude must be a signed finite numeric literal/, { line: 5, column: 17 });
  expectError(solarControl(dawn.replace('Asia/Seoul', 'Not/AZone')), /Solar timezone must be a supported IANA timezone/);
});

test('Solar restricts sun tags, exact offsets, fallback, and operating metadata', () => {
  expectError(solarControl(dawn.replace('sun`rise + 30min`', 'sun`noon + 30min`')), /Solar event must be rise or set/, { line: 6, column: 14 });
  expectError(solarControl(dawn.replace('30min', '30.5min')), /Solar offset must be an integer duration literal/, { line: 6, column: 21 });
  expectError(solarControl(dawn.replace('30min', '25h')), /Solar offset magnitude must not exceed 24h/, { line: 6, column: 21 });
  expectError(solarControl(dawn.replace('fallback = skip', 'fallback = queue')), /Solar fallback must be skip/, { line: 7, column: 16 });
  expectError([
    'control TaggedOutsideSolar {',
    '  let event = sun`rise`;',
    '  output enabled: Bool;',
    '  enabled <- false;',
    '}',
  ].join('\n'), /expected ; after let declaration/, { line: 2, column: 18 });
  expectError(solarControl(dawn.replace('  schedule dawn', '  config duration: Duration = 5min { min = 1min; max = 10min; step = 1min; access = operator; }\n  schedule dawn')), /Solar schedules cannot be combined with operating settings metadata yet/, { line: 2, column: 3 });
});

test('the existing DailySlots snapshot remains v1-compatible', () => {
  const source = fs.readFileSync(new URL('../examples/scheduled-watering.ghost', import.meta.url), 'utf8');
  const result = compileControl(source, { filename: 'examples/scheduled-watering.ghost' });
  assert.equal(result.manifest.format, 'GhostFlow/control-v1');
  assert.deepEqual(result.manifest.schedules, [{
    name: 'starts', timezone: 'Asia/Seoul', slots: [360, 375, 750, 1125], dueInput: '__gf_schedule_due_starts',
  }]);
});

test('the canonical Solar literate fixture preserves original schedule locations', async () => {
  const source = fs.readFileSync(new URL('../examples/solar-watering.ghost.md', import.meta.url), 'utf8');
  const result = await compileSource(source, { filename: 'examples/solar-watering.ghost.md' });
  assert.equal(result.manifest.format, 'GhostFlow/control-v3');
  assert.deepEqual(result.manifest.schedules.map(({ name, event, offsetMs, fallback }) => ({ name, event, offsetMs, fallback })), [
    { name: 'dawn', event: 'rise', offsetMs: 1_800_000, fallback: 'skip' },
    { name: 'dusk', event: 'set', offsetMs: -1_800_000, fallback: 'skip' },
  ]);
  const line = source.split('\n').findIndex(text => text.includes('schedule dawn:')) + 1;
  const dawnNode = result.sourceMap.find(node => node.kind === 'schedule' && node.line === line);
  assert.ok(dawnNode, 'the dawn schedule keeps its literate source location');
  assert.equal(dawnNode.extracted.line, 4);
});
