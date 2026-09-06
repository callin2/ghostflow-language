import test from 'node:test';
import assert from 'node:assert/strict';
import { DailySlots } from '../runtimes/wasm/schedule.mjs';
const config = { name: 'starts', timezone: 'Asia/Seoul', slots: [360, 375, 750, 1125] };
const six = Date.parse('2026-09-05T06:00:00+09:00');

test('15-minute slots issue one civil occurrence; repeated minute and rollback do not duplicate', () => {
  const s = new DailySlots(config);
  assert.equal(s.poll({ nowMs: 0, wallMs: six - 1_000 }).due, false);
  assert.equal(s.poll({ nowMs: 1_000, wallMs: six }).occurrence, 'starts/2026-09-05/0360');
  assert.equal(s.poll({ nowMs: 2_000, wallMs: six + 1_000 }).due, false);
  assert.equal(s.poll({ nowMs: 3_000, wallMs: six - 1_000 }).due, false);
  assert.equal(s.poll({ nowMs: 4_000, wallMs: six }).due, false);
  assert.throws(() => s.poll({ nowMs: 1, wallMs: six + 1_000 }), /backwards/);
});

test('boot, unavailable clock and large forward corrections skip catch-up', () => {
  const s = new DailySlots(config);
  assert.equal(s.poll({ nowMs: 0, wallMs: six }).reason, 'BootBaseline');
  assert.equal(s.poll({ nowMs: 1, wallMs: six + 900_000, trusted: false }).reason, 'UntrustedClock');
  assert.equal(s.poll({ nowMs: 2, wallMs: six + 900_000 }).reason, 'ClockGapSkipped');
  assert.equal(new DailySlots(config, s.snapshot()).poll({ nowMs: 0, wallMs: six }).due, false);
  assert.throws(() => new DailySlots({ ...config, slots: [361] }));
  assert.throws(() => new DailySlots({ ...config, timezone: 'Not/AZone' }));
  assert.throws(() => new DailySlots({ ...config, name: 'other' }, s.snapshot()), /identity/);
});

test('DST repeated local slot has the same identity and is not re-issued', () => {
  const s = new DailySlots({ name: 'fall', timezone: 'America/New_York', slots: [90] });
  s.poll({ nowMs: 0, wallMs: Date.parse('2026-11-01T01:29:59-04:00') });
  assert.equal(s.poll({ nowMs: 1000, wallMs: Date.parse('2026-11-01T01:30:00-04:00') }).due, true);
  assert.equal(s.poll({ nowMs: 3_600_000, wallMs: Date.parse('2026-11-01T01:29:59-05:00') }).due, false);
  assert.equal(s.poll({ nowMs: 3_601_000, wallMs: Date.parse('2026-11-01T01:30:00-05:00') }).due, false);
});
