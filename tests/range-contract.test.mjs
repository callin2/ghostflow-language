import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { createOperatingSettingsCandidate } from '../tools/operating-settings.mjs';

const document = body => `# Planned watering range\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const diagnostics = error => (error.diagnosticEnvelope?.diagnostics ?? []).map(item => item.message).join('\n');

function dailySlots({ selected = '[08:00, 08:15]', duration = '15min', config = '' } = {}) {
  return document(`control PlannedWatering {
  ${config}
  schedule watering: DailySlots<15min> {
    timezone = "UTC";
    selected = ${selected};
    dst_missing = skip;
    dst_repeated = first;
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

test('range accepts adjacent DailySlots intervals and keeps the planned duration', async () => {
  const artifact = await compileSource(dailySlots(), { filename: 'range-adjacent.ghost.md' });
  const schedule = artifact.manifest.schedules[0];
  assert.deepEqual(schedule.slots, [480, 495]);
  assert.deepEqual(schedule.policy.basis, { kind: 'range', durationMs: 900_000 });
});

test('range rejects overlapping static DailySlots intervals at compile time', async () => {
  await assert.rejects(
    () => compileSource(dailySlots({ duration: '30min' }), { filename: 'range-overlap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
});

test('range rejects a zero duration, independently of overlap', async () => {
  await assert.rejects(
    () => compileSource(dailySlots({ selected: '[08:00]', duration: '0ms' }), { filename: 'range-zero.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /positive|zero|greater than 0/i.test(diagnostics(error)),
  );
});

test('range accepts a fixed-anchor Periodic interval that touches the next occurrence boundary', async () => {
  const artifact = await compileSource(periodic({ duration: '30min' }), { filename: 'periodic-range-adjacent.ghost.md' });
  const schedule = artifact.manifest.schedules[0];
  assert.equal(schedule.every.initialMs, 1_800_000);
  assert.deepEqual(schedule.policy.basis, { kind: 'range', durationMs: 1_800_000 });
});

test('range rejects a fixed-anchor Periodic interval that overlaps the next occurrence', async () => {
  await assert.rejects(
    () => compileSource(periodic({ duration: '40min' }), { filename: 'periodic-range-overlap.ghost.md' }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
});

test('overlapping live Duration candidate is rejected without changing the source', async () => {
  const source = dailySlots({
    duration: 'watering_duration',
    config: 'config watering_duration: Duration = 10min { min = 5min; max = 30min; step = 5min; access = operator; }',
  });
  const before = await compileSource(source, { filename: 'range-live-duration.ghost.md' });
  await assert.rejects(
    () => createOperatingSettingsCandidate({
      source, filename: 'range-live-duration.ghost.md', expectedSourceSha256: sha256(source),
      changes: { watering_duration: 20 * 60_000 },
    }),
    error => /range/i.test(diagnostics(error)) && /overlap|non.?overlap/i.test(diagnostics(error)),
  );
  assert.match(source, /watering_duration: Duration = 10min/);
  assert.equal(before.manifest.configs[0].value, 600_000);
});

test('live Duration candidate accepts a boundary-touching interval', async () => {
  const source = dailySlots({
    duration: 'watering_duration',
    config: 'config watering_duration: Duration = 10min { min = 5min; max = 30min; step = 5min; access = operator; }',
  });
  const candidate = await createOperatingSettingsCandidate({
    source, filename: 'range-live-adjacent.ghost.md', expectedSourceSha256: sha256(source),
    changes: { watering_duration: 15 * 60_000 },
  });
  assert.equal(candidate.manifest.configs[0].value, 900_000);
  assert.deepEqual(candidate.manifest.schedules[0].slots, [480, 495]);
});
