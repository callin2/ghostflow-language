// Reference installation adapter: assemble calendar facts; Rust classifies days.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DAY_MS = 86_400_000;
const MAX_DAY = 2_932_896;
const MAX_ITEMS = 4096;
const SNAPSHOT_KEYS = ['calendarId', 'revision', 'timezone', 'coveredFromDate',
  'coveredToDateExclusive', 'expiresAtMs', 'weeklyWorkMask', 'holidayPolicy', 'holidays', 'exceptions'];

export class CalendarUnavailableError extends Error {
  constructor(code) {
    super(`calendar unavailable: ${code}`);
    this.name = 'CalendarUnavailableError';
    this.code = code;
  }
}

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key) || !('value' in Object.getOwnPropertyDescriptor(value, key))) {
      throw new TypeError(`unexpected ${label} field`);
    }
  }
  return value;
}
function string(value, label, limit = 128) {
  if (typeof value !== 'string' || !value.isWellFormed() || !value.trim()
      || Buffer.byteLength(value, 'utf8') > limit) throw new TypeError(`invalid ${label}`);
  return value;
}
function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`invalid ${label}`);
  return value;
}
function items(value, label) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new RangeError(`invalid ${label}`);
  return value;
}
function timezone(value) {
  string(value, 'timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: value }); }
  catch { throw new RangeError('invalid timezone'); }
  return value;
}
function policy(value) {
  if (!['off', 'work'].includes(value)) throw new TypeError('invalid holidayPolicy');
  return value;
}
// Civil dates are not instants. Epoch days match the portable context ABI.
export function calendarEpochDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new RangeError('invalid calendar date');
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) throw new RangeError('invalid calendar date');
  return integer(instant / DAY_MS, 'calendar date', MAX_DAY);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    object(value, Object.keys(value), 'revision content');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
      || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  throw new TypeError('invalid revision content');
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function revision(snapshot, provenance) {
  const { revision: ignored, ...contents } = snapshot;
  return `sha256:${createHash('sha256').update(stable({ snapshot: contents, provenance })).digest('hex')}`;
}
function finish(snapshot, provenance) {
  snapshot.revision = revision(snapshot, provenance);
  return freeze({ snapshot, provenance });
}
function dayInCoverage(date, snapshot) {
  const day = calendarEpochDay(date);
  if (day < snapshot.coveredFromDate || day >= snapshot.coveredToDateExclusive) throw new RangeError('date outside calendar coverage');
  return day;
}
function sourceUrl(value) {
  string(value, 'source URL', 2048);
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('invalid source URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError('invalid source URL');
  return value;
}
function sourced(value) {
  return items(value, 'sources').map(source => {
    object(source, ['id', 'url', 'publishedOn', 'reviewedOn'], 'source');
    string(source.id, 'source id'); sourceUrl(source.url);
    const published = source.publishedOn === null ? null : calendarEpochDay(source.publishedOn);
    const reviewed = calendarEpochDay(source.reviewedOn);
    if (published !== null && published > reviewed) throw new RangeError('source review precedes publication');
    return { id: source.id, url: source.url, publishedOn: source.publishedOn, reviewedOn: source.reviewedOn };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function unique(entries, key, label) {
  if (new Set(entries.map(entry => entry[key])).size !== entries.length) throw new RangeError(`duplicate ${label}`);
}
function baseEnvelope(base, nowMs) {
  integer(nowMs, 'nowMs');
  if (base == null) throw new CalendarUnavailableError('missing-base');
  object(base, ['snapshot', 'provenance'], 'calendar envelope');
  const s = object(base.snapshot, SNAPSHOT_KEYS, 'calendar snapshot');
  for (const key of SNAPSHOT_KEYS) if (!Object.hasOwn(s, key)) throw new TypeError(`missing calendar snapshot.${key}`);
  string(s.calendarId, 'calendarId'); string(s.revision, 'revision'); timezone(s.timezone);
  integer(s.coveredFromDate, 'coveredFromDate', MAX_DAY);
  integer(s.coveredToDateExclusive, 'coveredToDateExclusive', MAX_DAY + 1);
  if (s.coveredFromDate >= s.coveredToDateExclusive) throw new RangeError('invalid calendar coverage');
  integer(s.expiresAtMs, 'expiresAtMs'); integer(s.weeklyWorkMask, 'weeklyWorkMask', 127); policy(s.holidayPolicy);
  let previous = -1;
  for (const day of items(s.holidays, 'holidays')) {
    integer(day, 'holiday', MAX_DAY);
    if (day <= previous || day < s.coveredFromDate || day >= s.coveredToDateExclusive) throw new RangeError('invalid holiday order or coverage');
    previous = day;
  }
  previous = -1;
  for (const entry of items(s.exceptions, 'exceptions')) {
    object(entry, ['date', 'class'], 'exception'); integer(entry.date, 'exception date', MAX_DAY); policy(entry.class);
    if (entry.date <= previous || entry.date < s.coveredFromDate || entry.date >= s.coveredToDateExclusive) throw new RangeError('invalid exception order or coverage');
    previous = entry.date;
  }
  if (!base.provenance || typeof base.provenance !== 'object' || Array.isArray(base.provenance)
      || revision(s, base.provenance) !== s.revision) throw new TypeError('calendar revision/content mismatch');
  if (nowMs >= s.expiresAtMs) throw new CalendarUnavailableError('stale-base');
  return JSON.parse(stable(base));
}
function derivedId(value, base) {
  string(value, 'calendarId');
  if (value === base.snapshot.calendarId || base.provenance.lineage?.some(entry => entry.calendarId === value)) {
    throw new RangeError('derived calendar requires a distinct calendarId');
  }
  return value;
}
function lineage(base) {
  return [...(base.provenance.lineage ?? []), { calendarId: base.snapshot.calendarId, revision: base.snapshot.revision }];
}

export function createHolidayCalendar(options) {
  const o = object(options, ['calendarId', 'timezone', 'coveredFromDate', 'coveredToDateExclusive',
    'expiresAtMs', 'holidays', 'sources', 'datasetVersion', 'nowMs'], 'holiday calendar');
  string(o.calendarId, 'calendarId'); timezone(o.timezone); string(o.datasetVersion, 'datasetVersion');
  integer(o.nowMs, 'nowMs'); integer(o.expiresAtMs, 'expiresAtMs');
  if (o.nowMs >= o.expiresAtMs) throw new CalendarUnavailableError('stale-base');
  const from = calendarEpochDay(o.coveredFromDate), to = calendarEpochDay(o.coveredToDateExclusive);
  if (from >= to) throw new RangeError('invalid calendar coverage');
  const snapshot = { calendarId: o.calendarId, timezone: o.timezone, coveredFromDate: from,
    coveredToDateExclusive: to, expiresAtMs: o.expiresAtMs, weeklyWorkMask: 127,
    holidayPolicy: 'off', holidays: [], exceptions: [] };
  const sources = sourced(o.sources); unique(sources, 'id', 'source');
  if (!sources.length) throw new TypeError('holiday calendar requires sources');
  const facts = items(o.holidays, 'holidays').map(entry => {
    object(entry, ['date', 'name', 'source'], 'holiday fact');
    const day = dayInCoverage(entry.date, snapshot);
    string(entry.name, 'holiday name', 256); string(entry.source, 'holiday source');
    if (!sources.some(source => source.id === entry.source)) throw new TypeError('unknown holiday source');
    return { date: entry.date, day, name: entry.name, source: entry.source };
  }).sort((a, b) => a.day - b.day);
  unique(facts, 'day', 'holiday date');
  snapshot.holidays = facts.map(entry => entry.day);
  return finish(snapshot, { schema: 'GhostFlow/calendar-provenance-v1', kind: 'public-holiday',
    datasetVersion: o.datasetVersion, sources, facts, lineage: [] });
}

export function createKoreanHolidayCalendar(options) {
  const o = object(options, ['calendarId', 'nowMs', 'expiresAtMs'], 'Korean holiday calendar');
  const data = JSON.parse(readFileSync(new URL('../../data/calendars/kr-public-2026-2027.json', import.meta.url), 'utf8'));
  const expiresAtMs = o.expiresAtMs ?? data.expiresAtMs;
  integer(expiresAtMs, 'expiresAtMs', data.expiresAtMs);
  const holidays = data.holidays.map(entry => ({ ...entry }));
  const existing = new Set(holidays.map(entry => entry.date));
  // Explicit finite fact expansion of MPM's Sunday rule, not a farm work rule.
  const from = calendarEpochDay(data.coveredFromDate), to = calendarEpochDay(data.coveredToDateExclusive);
  for (let day = from; day < to; day++) {
    if (new Date(day * DAY_MS).getUTCDay() !== 0) continue;
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    if (!existing.has(date)) holidays.push({ date, name: 'Sunday', source: 'mpm-rules' });
  }
  return createHolidayCalendar({ calendarId: o.calendarId, nowMs: o.nowMs, timezone: data.timezone,
    coveredFromDate: data.coveredFromDate, coveredToDateExclusive: data.coveredToDateExclusive,
    expiresAtMs, datasetVersion: data.datasetVersion, sources: data.sources, holidays });
}

export function createWorkCalendar(options) {
  const o = object(options, ['calendarId', 'base', 'weeklyWorkMask', 'holidayPolicy', 'nowMs'], 'work calendar');
  const base = baseEnvelope(o.base, o.nowMs);
  derivedId(o.calendarId, base); integer(o.weeklyWorkMask, 'weeklyWorkMask', 127); policy(o.holidayPolicy);
  const snapshot = { ...base.snapshot, calendarId: o.calendarId,
    weeklyWorkMask: o.weeklyWorkMask, holidayPolicy: o.holidayPolicy };
  return finish(snapshot, { ...base.provenance, kind: 'farm-work', lineage: lineage(base),
    workPolicy: { weeklyWorkMask: o.weeklyWorkMask, holidayPolicy: o.holidayPolicy } });
}

export function composeCalendar(baseValue, options) {
  const o = object(options, ['calendarId', 'timezone', 'holidayOverrides', 'workdayOverrides', 'nowMs'], 'calendar composition');
  const base = baseEnvelope(baseValue, o.nowMs);
  derivedId(o.calendarId, base); timezone(o.timezone);
  if (o.timezone !== base.snapshot.timezone) throw new RangeError('calendar timezone mismatch');
  const holidayOverrides = items(o.holidayOverrides ?? [], 'holidayOverrides').map(entry => {
    object(entry, ['date', 'holiday', 'reason', 'source'], 'holiday override');
    dayInCoverage(entry.date, base.snapshot);
    if (typeof entry.holiday !== 'boolean') throw new TypeError('holiday override must be Bool');
    string(entry.reason, 'holiday override reason', 1024); sourceUrl(entry.source);
    return { date: entry.date, holiday: entry.holiday, reason: entry.reason, source: entry.source };
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const workdayOverrides = items(o.workdayOverrides ?? [], 'workdayOverrides').map(entry => {
    object(entry, ['date', 'class', 'reason'], 'workday override');
    dayInCoverage(entry.date, base.snapshot); policy(entry.class); string(entry.reason, 'workday override reason', 1024);
    return { date: entry.date, class: entry.class, reason: entry.reason };
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  unique(holidayOverrides, 'date', 'holiday override date'); unique(workdayOverrides, 'date', 'workday override date');
  const holidays = new Set(base.snapshot.holidays);
  for (const entry of holidayOverrides) {
    const day = calendarEpochDay(entry.date);
    if (entry.holiday) holidays.add(day); else holidays.delete(day);
  }
  const exceptions = new Map(base.snapshot.exceptions.map(entry => [entry.date, entry.class]));
  for (const entry of workdayOverrides) exceptions.set(calendarEpochDay(entry.date), entry.class);
  const snapshot = { ...base.snapshot, calendarId: o.calendarId,
    holidays: [...holidays].sort((a, b) => a - b),
    exceptions: [...exceptions].sort((a, b) => a[0] - b[0]).map(([date, cls]) => ({ date, class: cls })) };
  items(snapshot.holidays, 'derived holidays'); items(snapshot.exceptions, 'derived exceptions');
  return finish(snapshot, { ...base.provenance, lineage: lineage(base),
    overlays: [...(base.provenance.overlays ?? []), { holidayOverrides, workdayOverrides }] });
}
