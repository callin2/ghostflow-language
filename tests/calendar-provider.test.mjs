import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarEpochDay, CalendarUnavailableError, createHolidayCalendar,
  createKoreanHolidayCalendar, createWorkCalendar, composeCalendar } from '../runtimes/node/calendar.mjs';
import { encodeContextFacts } from '../runtimes/wasm/context-abi.mjs';

const nowMs = Date.UTC(2026, 9, 1);
const korean = () => createKoreanHolidayCalendar({ calendarId: 'kr-public', nowMs });
const holiday = (base, date) => base.snapshot.holidays.includes(calendarEpochDay(date));
const farm = base => createWorkCalendar({ calendarId: 'farm-work', base,
  weeklyWorkMask: 0b0111110, holidayPolicy: 'off', nowMs });
const overlay = (base, options = {}) => composeCalendar(base, { calendarId: 'farm-exceptions',
  timezone: 'Asia/Seoul', nowMs, ...options });
const temporarySource = 'https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&category=&cntId=4008&mode=view&pageIdx=1';

test('reviewed Korean facts include amended holidays, actual substitutes, elections and Sunday rule', () => {
  const base = korean();
  for (const date of ['2026-03-02', '2026-05-01', '2026-05-25', '2026-06-03', '2026-07-17',
    '2026-08-17', '2026-10-05', '2027-02-09', '2027-05-03', '2027-05-13',
    '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']) {
    assert.equal(holiday(base, date), true, date);
  }
  assert.equal(holiday(base, '2026-09-27'), true, 'Sunday is an official public holiday');
  for (const date of ['2026-09-28', '2027-06-07', '2026-01-03']) {
    assert.equal(holiday(base, date), false, `no invented substitute or Saturday holiday: ${date}`);
  }
  const labor = base.provenance.facts.find(entry => entry.date === '2026-05-01');
  assert.equal(labor.source, 'mpm-2026-amendment');
  assert.equal(base.provenance.sources.find(entry => entry.id === labor.source).publishedOn, '2026-04-29');
  assert.equal(base.snapshot.timezone, 'Asia/Seoul');
  assert.equal(base.snapshot.coveredToDateExclusive, calendarEpochDay('2028-01-01'));
  assert.equal(base.snapshot.expiresAtMs, Date.parse('2028-01-01T00:00:00+09:00'));
});

test('public facts, explicit farm policy and work overrides remain separate and immutable', () => {
  const base = korean(); const before = JSON.stringify(base);
  const work = farm(base);
  const derived = overlay(work, { workdayOverrides: [
    { date: '2026-10-05', class: 'work', reason: 'Harvest crew scheduled on a public holiday' },
    { date: '2026-10-06', class: 'off', reason: 'Farm maintenance closure' },
  ] });
  assert.equal(holiday(derived, '2026-10-05'), true, 'work exception does not erase holiday fact');
  assert.equal(holiday(derived, '2026-10-06'), false, 'farm closure is not a public holiday');
  assert.deepEqual(derived.snapshot.exceptions, [
    { date: calendarEpochDay('2026-10-05'), class: 'work' },
    { date: calendarEpochDay('2026-10-06'), class: 'off' },
  ]);
  assert.equal(JSON.stringify(base), before);
  assert.equal(base.snapshot.weeklyWorkMask, 127, 'public fact carrier has no inferred farm weekly pattern');
  assert.equal(work.snapshot.weeklyWorkMask, 0b0111110);
  assert.equal(derived.snapshot.expiresAtMs, base.snapshot.expiresAtMs);
  assert.equal(derived.snapshot.coveredFromDate, base.snapshot.coveredFromDate);
  assert.deepEqual(derived.provenance.lineage.map(entry => entry.calendarId), ['kr-public', 'farm-work']);
  assert.ok(Object.isFrozen(derived.snapshot.exceptions[0]));
  assert.ok(Object.isFrozen(derived.provenance.overlays[0].workdayOverrides));
  assert.throws(() => derived.snapshot.holidays.push(0), TypeError);
  assert.throws(() => { derived.provenance.sources[0].url = 'https://tampered.invalid'; }, TypeError);
});

test('real 2025 temporary-holiday overlay is sourced, finite and preserves base', () => {
  const base = createHolidayCalendar({ calendarId: 'kr-january-2025', timezone: 'Asia/Seoul',
    coveredFromDate: '2025-01-01', coveredToDateExclusive: '2025-02-01',
    expiresAtMs: Date.UTC(2025, 1, 1), nowMs: Date.UTC(2025, 0, 15),
    datasetVersion: 'temporary-holiday-regression', holidays: [],
    sources: [{ id: 'mpm-temporary', url: temporarySource, publishedOn: '2025-01-14', reviewedOn: '2026-10-01' }] });
  const changed = composeCalendar(base, { calendarId: 'kr-january-2025-updated', timezone: 'Asia/Seoul',
    nowMs: Date.UTC(2025, 0, 15), holidayOverrides: [{ date: '2025-01-27', holiday: true,
      reason: 'Government-designated temporary holiday; MPM announcement 2025-01-14', source: temporarySource }] });
  assert.equal(holiday(base, '2025-01-27'), false);
  assert.equal(holiday(changed, '2025-01-27'), true);
  assert.equal(changed.snapshot.expiresAtMs, base.snapshot.expiresAtMs);
  assert.equal(changed.provenance.overlays[0].holidayOverrides[0].source, temporarySource);
});

test('revision addresses normalized content, provenance and lineage independently of input order or now', () => {
  const base = farm(korean());
  const overrides = [{ date: '2026-10-06', class: 'off', reason: 'Maintenance' },
    { date: '2026-10-05', class: 'work', reason: 'Harvest' }];
  const first = overlay(base, { workdayOverrides: overrides });
  const reordered = overlay(base, { workdayOverrides: overrides.toReversed(), nowMs: nowMs + 1 });
  assert.equal(first.snapshot.revision, reordered.snapshot.revision);
  assert.match(first.snapshot.revision, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(first.snapshot.revision, overlay(base, { workdayOverrides: [
    { ...overrides[0], reason: 'Different maintenance evidence' }, overrides[1],
  ] }).snapshot.revision);
  const parsed = JSON.parse(JSON.stringify(base));
  assert.equal(overlay(parsed, { workdayOverrides: overrides }).snapshot.revision, first.snapshot.revision);
  parsed.snapshot.holidays.pop();
  assert.throws(() => overlay(parsed), /revision\/content mismatch/u);
  const next = composeCalendar(first, { calendarId: 'farm-revised', timezone: 'Asia/Seoul', nowMs,
    workdayOverrides: [{ date: '2026-10-05', class: 'off', reason: 'Harvest cancelled' }] });
  assert.equal(next.snapshot.exceptions.find(entry => entry.date === calendarEpochDay('2026-10-05')).class, 'off');
  assert.equal(first.snapshot.exceptions.find(entry => entry.date === calendarEpochDay('2026-10-05')).class, 'work');
});

test('invalid composition rejects duplicate conflicts, timezone mismatch, malformed dates and identity reuse', () => {
  const base = farm(korean());
  assert.throws(() => overlay(base, { timezone: 'UTC' }), /timezone mismatch/u);
  assert.throws(() => overlay(base, { calendarId: 'farm-work' }), /distinct calendarId/u);
  assert.throws(() => overlay(base, { calendarId: 'kr-public' }), /distinct calendarId/u);
  assert.throws(() => overlay(base, { calendarId: '가'.repeat(43) }), /calendarId/u);
  for (const date of ['2026-02-30', '2026-2-01', '1969-12-31', '2028-01-01', '2026-10-05T00:00Z']) {
    assert.throws(() => overlay(base, { workdayOverrides: [{ date, class: 'work', reason: 'invalid date' }] }), RangeError);
  }
  for (const classes of [['work', 'off'], ['work', 'work']]) {
    assert.throws(() => overlay(base, { workdayOverrides: classes.map(cls =>
      ({ date: '2026-10-05', class: cls, reason: 'duplicate' })) }), /duplicate/u);
  }
  assert.throws(() => overlay(base, { holidayOverrides: [true, false].map(holiday =>
    ({ date: '2026-10-05', holiday, reason: 'conflict', source: temporarySource })) }), /duplicate/u);
  assert.throws(() => overlay(base, { workdayOverrides: [{ date: '2026-10-05', class: 'work', reason: '' }] }), /reason/u);
  assert.throws(() => overlay(base, { holidayOverrides: [{ date: '2026-10-05', holiday: true,
    reason: 'unsourced', source: 'file:///unverified' }] }), /source URL/u);
  assert.throws(() => overlay(base, { expiresAtMs: base.snapshot.expiresAtMs + 1 }), /unexpected/u);
  assert.throws(() => overlay(base, { workdayOverrides: Array.from({ length: 4097 }, () => ({})) }), /workdayOverrides/u);
  assert.throws(() => createWorkCalendar({ calendarId: 'implicit-work', base, nowMs }), /weeklyWorkMask/u);
});

test('missing/stale bases fail closed even with overrides; installation can only shorten Korean expiry', () => {
  assert.throws(() => overlay(null), error => error instanceof CalendarUnavailableError && error.code === 'missing-base');
  const base = korean();
  assert.throws(() => overlay(base, { nowMs: base.snapshot.expiresAtMs,
    workdayOverrides: [{ date: '2026-10-05', class: 'work', reason: 'Cannot revive stale base' }] }),
  error => error instanceof CalendarUnavailableError && error.code === 'stale-base');
  const shortened = createKoreanHolidayCalendar({ calendarId: 'kr-freshness-policy', nowMs,
    expiresAtMs: nowMs + 60_000 });
  assert.equal(shortened.snapshot.expiresAtMs, nowMs + 60_000);
  assert.throws(() => createKoreanHolidayCalendar({ calendarId: 'kr-widen', nowMs,
    expiresAtMs: base.snapshot.expiresAtMs + 1 }), /expiresAtMs/u);
  assert.throws(() => createKoreanHolidayCalendar({ calendarId: 'kr-clock-required' }), /nowMs/u);
});

test('calendar snapshots pass the exact existing context wire schema without provenance fields', () => {
  const base = overlay(farm(korean()));
  const facts = { clock: { monotonicMs: 1, bootEpoch: 1, wallMs: nowMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'test-clock' }, natural: [], settings: null,
  schedules: [{ site: 1, coverageStartMs: nowMs, coverageEndMs: nowMs + 1,
    provider: null, calendar: base.snapshot, rows: [] }] };
  assert.ok(encodeContextFacts(facts).length > 0);
  assert.throws(() => encodeContextFacts({ ...facts, schedules: [{ ...facts.schedules[0], calendar: base }] }), /unexpected/u);
});

test('generic factual calendar validates source identities and does not retain mutable caller data', () => {
  const options = { calendarId: 'generic', timezone: 'Asia/Seoul',
    coveredFromDate: '2026-01-01', coveredToDateExclusive: '2027-01-01',
    expiresAtMs: Date.UTC(2027, 0, 1), nowMs, datasetVersion: 'verified-facts-v1',
    sources: [{ id: 'source', url: temporarySource, publishedOn: '2025-01-14', reviewedOn: '2026-10-01' }],
    holidays: [{ date: '2026-01-01', name: 'New Year', source: 'source' }] };
  const original = createHolidayCalendar(options);
  options.sources[0].reviewedOn = '2026-10-02';
  assert.equal(original.provenance.sources[0].reviewedOn, '2026-10-01');
  assert.notEqual(createHolidayCalendar(options).snapshot.revision, original.snapshot.revision);
  assert.throws(() => createHolidayCalendar({ ...options, holidays: [
    { ...options.holidays[0], source: 'missing-source' },
  ] }), /unknown holiday source/u);
  assert.throws(() => createHolidayCalendar({ ...options, sources: [...options.sources, options.sources[0]] }), /duplicate source/u);
  assert.throws(() => createHolidayCalendar({ ...options, holidays: [...options.holidays, options.holidays[0]] }), /duplicate holiday date/u);
  assert.throws(() => createHolidayCalendar({ ...options, sources: [{ ...options.sources[0], reviewedOn: '2024-12-31' }] }), /review precedes publication/u);
  assert.throws(() => createHolidayCalendar({ ...options, sources: [] }), /requires sources/u);
});
