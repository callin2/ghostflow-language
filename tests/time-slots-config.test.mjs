import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from '../tools/toolchain.mjs';

const source = (config, selected = 'watering_slots', grid = '15min', policy = false) => `# editable times

\`\`\`ghost
control TimeSlotsTest {
  config watering_slots: ${config.type} = ${config.value} { access = operator; label = "Start times"; }
  schedule starts: DailySlots<${grid}> {
    timezone = "Asia/Seoul"; selected = ${selected};${policy ? ` dst_missing = skip; dst_repeated = first;
    basis = pulse; when = true; clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;` : ''}
  }
  output due: Bool; due <- starts.due;
}
\`\`\``;

test('TimeSlots config compiles and attaches to DailySlots with a matching grid', async () => {
  const result = await compileSource(source({ type: 'TimeSlots<15min, 8>', value: '[time`06:00`, time`18:45`]' }, 'watering_slots', '15min', false), { filename: 'timeslots.ghost.md' });
  assert.deepEqual(result.manifest.configs[0].value, [21_600_000, 67_500_000]);
  assert.equal(result.manifest.configs[0].type, 'TimeSlots<900000ms,8>');
  assert.equal(result.manifest.schedules[0].selectedConfig, 'watering_slots');
  assert.deepEqual(result.manifest.schedules[0].slots, [360, 1125]);
});

test('TimeSlots permits an empty set', async () => {
  const result = await compileSource(source({ type: 'TimeSlots<15min, 8>', value: '[]' }), { filename: 'timeslots-empty.ghost.md' });
  assert.deepEqual(result.manifest.configs[0].value, []);
  assert.deepEqual(result.manifest.schedules[0].slots, []);
});

for (const [name, config, selected, grid, pattern] of [
  ['grid mismatch', { type: 'TimeSlots<30min, 8>', value: '[time`06:00`]' }, 'watering_slots', '15min', /TimeSlots.*DailySlots|grid/i],
  ['duplicate values', { type: 'TimeSlots<15min, 8>', value: '[time`06:00`, time`06:00`]' }, 'watering_slots', '15min', /unique|duplicate/i],
  ['off-grid value', { type: 'TimeSlots<15min, 8>', value: '[time`06:10`]' }, 'watering_slots', '15min', /grid|15-minute/i],
  ['capacity overflow', { type: 'TimeSlots<15min, 1>', value: '[time`06:00`, time`06:15`]' }, 'watering_slots', '15min', /maximum|capacity|1/],
  ['grid that does not divide a day', { type: 'TimeSlots<7min, 8>', value: '[]' }, 'watering_slots', '7min', /grid|24 hours/i],
  ['zero maximum capacity', { type: 'TimeSlots<15min, 0>', value: '[]' }, 'watering_slots', '15min', /positive|maximum/i],
]) test(`TimeSlots rejects ${name}`, async () => {
  await assert.rejects(compileSource(source(config, selected, grid), { filename: 'timeslots-invalid.ghost.md' }), pattern);
});
