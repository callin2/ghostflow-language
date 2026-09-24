import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

const document = body => `# Planned watering range\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const diagnostics = error => (error.diagnosticEnvelope?.diagnostics ?? []).map(item => item.message).join('\n');

function dailySlots({ selected = '[08:00, 08:15]', duration = '15min', config = '', timezone = 'UTC', dstMissing = 'skip', dstRepeated = 'first' } = {}) {
  return document(`control PlannedWatering {
  ${config}
  schedule watering: DailySlots<15min> {
    timezone = "${timezone}";
    selected = ${selected};
    dst_missing = ${dstMissing};
    dst_repeated = ${dstRepeated};
    basis = range(${duration});
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- watering.active;
}`);
}

function periodic({ duration }) {
  return document(`control PlannedPeriodicWatering {
  schedule watering: Periodic {
    every = 30min;
    anchor = instant(datetime\`2026-10-01T00:00:00Z\`);
    interval_change = preserve_anchor;
    basis = range(${duration});
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- watering.active;
}`);
}

function daily({ duration = '24h', timezone = 'America/New_York', dstMissing = 'skip', dstRepeated = 'first' } = {}) {
  return document(`control PlannedDailyWatering {
  schedule watering: Daily {
    timezone = "${timezone}";
    at = time\`08:00\`;
    dst_missing = ${dstMissing};
    dst_repeated = ${dstRepeated};
    basis = range(${duration});
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output pump: Bool;
  pump <- watering.active;
}`);
}

test('range accepts adjacent DailySlots intervals and keeps the planned duration', async () => {
  const artifact = await compileSource(dailySlots(), { filename: 'range-adjacent.ghost.md' });
  const schedule = artifact.manifest.control.schedules[0];
  assert.deepEqual(schedule.slots, [480, 495]);
  assert.deepEqual(schedule.policy.basis, { kind: 'range', durationMs: 900_000 });
  assert.equal(schedule.policy.cancelWhen, 'false');
  const midnight = await compileSource(dailySlots({ selected: '[23:45, 00:00]' }), { filename: 'range-midnight-adjacent.ghost.md' });
  assert.deepEqual(midnight.manifest.control.schedules[0].slots, [0, 1425]);
  const conditional = await compileSource(dailySlots().replace('control PlannedWatering {', 'control PlannedWatering { input stop: Bool;')
    .replace('cancel_when = false', 'cancel_when = stop'), { filename: 'range-cancel-condition.ghost.md' });
  assert.equal(conditional.manifest.control.schedules[0].policy.cancelWhen, 'input.stop');
});

test('range rejects overlapping static DailySlots intervals at compile time', async () => {
  await assert.rejects(
    () => compileSource(dailySlots({ duration: '30min' }), { filename: 'range-overlap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
  await assert.rejects(
    () => compileSource(dailySlots({ selected: '[23:45, 00:00]', duration: '30min' }), { filename: 'range-midnight-overlap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
  await assert.rejects(
    () => compileSource(dailySlots({ selected: '[01:30]', duration: '90min', timezone: 'America/New_York', dstRepeated: 'both' }), { filename: 'range-dst-fold.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /non.?overlap.*cannot be proved/i.test(diagnostics(error)),
  );
  await assert.rejects(
    () => compileSource(daily(), { filename: 'range-dst-day.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /non.?overlap.*cannot be proved/i.test(diagnostics(error)),
  );
  await assert.rejects(
    () => compileSource(dailySlots({ selected: '[02:30]', duration: '15min', timezone: 'America/New_York', dstMissing: 'next_valid' }), { filename: 'range-dst-gap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /non.?overlap.*cannot be proved/i.test(diagnostics(error)),
  );
});

test('range rejects a zero duration, independently of overlap', async () => {
  await assert.rejects(
    () => compileSource(dailySlots({ selected: '[08:00]', duration: '0ms' }), { filename: 'range-zero.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /positive|zero|greater than 0/i.test(diagnostics(error)),
  );
  await assert.rejects(
    () => compileSource(dailySlots().replace('cancel_when = false', 'cancel_when = 1'), { filename: 'range-cancel-type.ghost.md' }),
    error => /cancel_when must be Bool/i.test(diagnostics(error)),
  );
  await assert.rejects(
    () => compileSource(dailySlots().replace('    cancel_when = false;\n', ''), { filename: 'range-cancel-missing.ghost.md' }),
    error => /range basis requires cancel_when/i.test(diagnostics(error)),
  );
});

test('range accepts a fixed-anchor Periodic interval that touches the next occurrence boundary', async () => {
  const artifact = await compileSource(periodic({ duration: '30min' }), { filename: 'periodic-range-adjacent.ghost.md' });
  const schedule = artifact.manifest.control.schedules[0];
  assert.equal(schedule.every.initialMs, 1_800_000);
  assert.deepEqual(schedule.policy.basis, { kind: 'range', durationMs: 1_800_000 });
});

test('range rejects a fixed-anchor Periodic interval that overlaps the next occurrence', async () => {
  await assert.rejects(
    () => compileSource(periodic({ duration: '40min' }), { filename: 'periodic-range-overlap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
  const civil = periodic({ duration: '30min' })
    .replace('anchor = instant(datetime`2026-10-01T00:00:00Z`);', 'anchor = civil(date`2026-10-01`, time`01:30`);\n    timezone = "America/New_York";\n    dst_missing = skip;\n    dst_repeated = both;');
  await assert.rejects(
    () => compileSource(civil, { filename: 'periodic-civil-range.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /non.?overlap.*cannot be proved/i.test(diagnostics(error)),
  );
});

test('overlapping fixed Duration is rejected', async () => {
  const source = dailySlots({ duration: 'watering_duration', config: 'let watering_duration = 20min;' });
  await assert.rejects(
    () => compileSource(source, { filename: 'range-fixed-overlap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
});

test('fixed Duration accepts a boundary-touching interval', async () => {
  const source = dailySlots({ duration: 'watering_duration', config: 'let watering_duration = 15min;' });
  const candidate = await compileSource(source, { filename: 'range-fixed-adjacent.ghost.md' });
  assert.equal(candidate.manifest.format, 'GhostFlow/schedule-descriptor-v1');
  assert.deepEqual(candidate.manifest.control.schedules[0].slots, [480, 495]);
});

test('Result-backed range duration fails closed instead of folding an initial config value', async () => {
  const source = dailySlots({
    duration: 'case watering_duration { ok(value) => value; fault(_) => 5min; }',
    config: 'config watering_duration: Duration = 10min { min = 5min; max = 15min; step = 5min; access = operator; }',
  });
  await assert.rejects(
    () => compileSource(source, { filename: 'range-result-duration.ghost.md' }),
    error => /range requires a positive Duration/i.test(diagnostics(error)),
  );
});
