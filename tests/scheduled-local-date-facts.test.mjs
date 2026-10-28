import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeContextFacts } from '../runtimes/wasm/context-abi.mjs';
import { localEpochDay, scheduledLocalDateFact } from '../runtimes/wasm/civil-date.mjs';

const day = iso => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const packet = scheduledDates => ({
  clock: { monotonicMs: 0, bootEpoch: 1, wallMs: 1, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'rtc-r1' },
  natural: [], schedules: [], settings: null,
  ...(scheduledDates === undefined ? {} : { scheduledDates }),
});

test('host IANA date is based on the offset planned instant while provider source day is retained', () => {
  const source = Date.parse('2026-10-25T15:10:00Z'); // Monday 00:10 in Seoul.
  const planned = source - 30 * 60_000; // Sunday 23:40 in Seoul.
  const fact = scheduledLocalDateFact({ site: 41, sourceKey: 'tide:high-a',
    sourceDay: day('2026-10-26'), timezone: 'Asia/Seoul', plannedWallMs: planned,
    providerRevision: 'harbor-r7', contextRevision: 'station-r2', resolverRevision: 'iana-r1' });
  assert.equal(fact.sourceDay, day('2026-10-26'));
  assert.equal(fact.scheduledDay, day('2026-10-25'));
  const bytes = encodeContextFacts(packet([fact]));
  assert.deepEqual([...bytes.slice(0, 6)], [71, 70, 83, 70, 7, 0]);
  assert.deepEqual([...encodeContextFacts(packet()).slice(0, 6)], [71, 70, 83, 70, 5, 0]);
});

test('UTC and both sides of a DST boundary use the selected IANA timezone', () => {
  const before = Date.parse('2026-11-01T03:30:00Z');
  const after = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(localEpochDay(before, 'America/New_York'), day('2026-10-31'));
  assert.equal(localEpochDay(after, 'America/New_York'), day('2026-11-01'));
  assert.equal(localEpochDay(before, 'UTC'), day('2026-11-01'));
});

test('GFSF7 rejects a conflicting date, duplicate identity, and malformed unavailable result', () => {
  const fact = scheduledLocalDateFact({ site: 41, sourceKey: 'tide:high-a',
    sourceDay: day('2026-10-26'), timezone: 'Asia/Seoul',
    plannedWallMs: Date.parse('2026-10-25T14:40:00Z'),
    providerRevision: 'harbor-r7', contextRevision: 'station-r2', resolverRevision: 'iana-r1' });
  assert.throws(() => encodeContextFacts(packet([{ ...fact, scheduledDay: fact.sourceDay }])), /IANA conversion/);
  assert.throws(() => encodeContextFacts(packet([fact, fact])), /duplicate scheduled-date fact/);
  assert.throws(() => encodeContextFacts(packet([{ ...fact, scheduledDay: null }])), /CivilDateUnavailable/);
  const unavailable = { ...fact, scheduledDay: null, unavailableReason: 'CivilDateUnavailable' };
  assert.deepEqual([...encodeContextFacts(packet([unavailable])).slice(0, 6)], [71, 70, 83, 70, 7, 0]);
});
