import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DailySlots } from '../runtimes/wasm/schedule.mjs';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';
import { ScheduledAdmission, ScheduledAdmissionError } from '../runtimes/wasm/scheduled-admission.mjs';

const policy = { onceSchedules: [
  { id: 'starts', timezone: 'Asia/Seoul' },
  { id: 'extra_starts', timezone: 'Asia/Seoul' },
] };
const descriptors = {
  starts: { numericId: 1, timezone: 'Asia/Seoul', slots: [360, 375] },
  extra_starts: { numericId: 2, timezone: 'Asia/Seoul', slots: [1155] },
};
const admission = new ScheduledAdmission(policy, descriptors);
assert.doesNotThrow(() => new ScheduledAdmission({ ...policy, stationConfig: { valveCount: 4 } }, {
  starts: { numericId: 1, timezone: 'Asia/Seoul', slots: [360] },
  extra_starts: { numericId: 2, timezone: 'Asia/Seoul', slots: [1155] },
}));
const disabled = new ScheduledAdmission({ onceSchedules: [{ id: 'disabled', timezone: 'Asia/Seoul' }] }, {
  disabled: { numericId: 3, timezone: 'Asia/Seoul', slots: [] },
});

function due(scheduler, wallMs) {
  scheduler.poll({ nowMs: 0, wallMs: wallMs - 1000 });
  const event = scheduler.poll({ nowMs: 1000, wallMs });
  assert.equal(event.due, true);
  return event;
}

const six = Date.parse('2026-09-05T06:00:00+09:00');
const startsEvent = due(new DailySlots({ name: 'starts', timezone: 'Asia/Seoul', slots: [360, 375] }), six);
const ordinal = Math.floor(Date.UTC(2026, 8, 5) / 86_400_000);
assert.equal(admission.occurrenceId(startsEvent), (1n << 48n) | (BigInt(ordinal) << 16n) | 360n);

// Constructor records are copied and frozen: mutable caller objects cannot
// change a deployment's stable schedule numeric IDs after construction.
descriptors.starts.numericId = 99;
descriptors.starts.slots[0] = 0;
assert.equal(admission.occurrenceId(startsEvent), (1n << 48n) | (BigInt(ordinal) << 16n) | 360n);

function expectError(callback, text) {
  assert.throws(callback, error => error instanceof ScheduledAdmissionError && error.message.includes(text));
}

expectError(() => new ScheduledAdmission(policy, {
  starts: { numericId: 1, timezone: 'Asia/Seoul', slots: [360] },
  extra_starts: { numericId: 1, timezone: 'Asia/Seoul', slots: [1155] },
}), 'duplicate schedule numericId 1');
expectError(() => new ScheduledAdmission(policy, {
  starts: { numericId: 1, timezone: 'UTC', slots: [360] },
  extra_starts: { numericId: 2, timezone: 'Asia/Seoul', slots: [1155] },
}), 'timezone does not match bound policy');
expectError(() => admission.occurrenceId({ ...startsEvent, occurrence: 'starts/2026-02-30/0360', date: '2026-02-30' }), 'valid Gregorian date');
expectError(() => admission.occurrenceId({ ...startsEvent, occurrence: 'starts/2026-09-05/0361', minute: 361 }), '15-minute minute-of-day');
expectError(() => admission.occurrenceId({ ...startsEvent, timezone: 'UTC' }), 'fields do not match');
expectError(() => admission.occurrenceId({ ...startsEvent, occurrence: 'unknown/2026-09-05/0360' }), 'not a bound onceSchedule');
expectError(() => disabled.occurrenceId({ ...startsEvent, occurrence: 'disabled/2026-09-05/0360' }), 'not selected for disabled');
expectError(() => new ScheduledAdmission({ onceSchedules: Array.from({ length: 129 }, (_, index) => ({ id: `s${index}`, timezone: 'Asia/Seoul' })) }, {}), 'onceSchedules exceeds 128');
expectError(() => new ScheduledAdmission({ onceSchedules: [] }, Object.fromEntries(
  Array.from({ length: 129 }, (_, index) => [`s${index}`, { numericId: index + 1, timezone: 'Asia/Seoul', slots: [] }]),
)), 'schedule descriptors exceeds 128');

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const stationConfig = { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1_000, maxStartBudgetMs: 800, requireCapacityPass: false };
const station = await GhostFlowStation.instantiate(wasm, stationConfig);
station.synchronizeDay({ day: ordinal, nowMs: 0, nextDayDeadlineMs: 10_000 });
station.enter({ requestId: 1n, ...station.claim, mode: 'Auto' });
const request = { requestId: 2n, ...station.claim, sessionId: 77n, ownerId: 88n, mode: 'Auto', valves: 0b11n, budgetMs: 100n, nowMs: 10n };
let durableBytes;
const grant = await admission.start(station, startsEvent, request, async bytes => { durableBytes = bytes.slice(); return true; });
assert.equal(grant.capacity, 'Unknown');
assert.ok(durableBytes instanceof Uint8Array && durableBytes.length > 0);
assert.throws(() => admission.start(station, startsEvent, { ...request, requestId: 3n, occurrenceId: 999n }, async () => true), /must not provide occurrenceId/);
assert.throws(() => admission.start(station, startsEvent, { ...request, requestId: 3n, mode: 'Manual' }, async () => true), /requires mode Auto/);

// The durable station ledger, restored from actual WASM bytes, rejects the
// same computed schedule identity even after the original process is gone.
const restored = await GhostFlowStation.instantiate(wasm, stationConfig);
restored.restore(durableBytes);
restored.synchronizeDay({ day: ordinal, nowMs: 0, nextDayDeadlineMs: 10_000 });
restored.acknowledgeRecoverySafeOutput({ nowMs: 1 });
restored.enter({ requestId: 3n, ...restored.claim, mode: 'Auto' });
await assert.rejects(admission.start(restored, startsEvent, {
  requestId: 4n, ...restored.claim, sessionId: 78n, ownerId: 89n, mode: 'Auto', valves: 0b11n, budgetMs: 100n, nowMs: 10n,
}, async () => true), /occurrence id was already accepted/);

station.dispose();
restored.dispose();
console.log('scheduled admission tests passed (stable occurrence IDs survive durable restore)');
