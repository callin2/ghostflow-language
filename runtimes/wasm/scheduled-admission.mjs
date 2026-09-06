/**
 * Stable, deployment-owned occurrence IDs for schedules admitted to one station.
 * This does not drive output; it only derives the ID and delegates to
 * GhostFlowStation.start, whose durable ledger owns the actual admission.
 */

const SCHEDULE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const OCCURRENCE = /^([A-Za-z_][A-Za-z0-9_]{0,127})\/(\d{4}-\d{2}-\d{2})\/(\d{4})$/;
const MAX_SCHEDULES = 128;

export class ScheduledAdmissionError extends Error {
  constructor(message) { super(message); this.name = 'ScheduledAdmissionError'; }
}

function fail(message) { throw new ScheduledAdmissionError(message); }
function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function exactKeys(value, keys, name) {
  object(value, name);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`unsupported ${name} field ${key}`);
}
function timezone(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) fail(`${name} must be a non-empty timezone string`);
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); }
  catch { fail(`${name} has invalid IANA timezone ${JSON.stringify(value)}`); }
  return value;
}
function scheduleName(value, name) {
  if (typeof value !== 'string' || !SCHEDULE_NAME.test(value)) fail(`${name} must be a schedule identifier`);
  return value;
}
function minute(value, name) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440 || value % 15 !== 0) fail(`${name} must be a selected 15-minute minute-of-day`);
  return value;
}
function numericId(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff) fail(`${name} must be a non-zero u16`);
  return value;
}
function leap(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function monthDays(year, month) {
  return [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// A proleptic-Gregorian ordinal, deliberately calculated without Date so an
// invalid civil date can never be silently normalized (for example Feb 30).
function civilDayOrdinal(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) fail('event date must be canonical YYYY-MM-DD');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) {
    fail('event date must be a valid Gregorian date from 1970 through 9999');
  }
  let ordinal = 0;
  for (let current = 1970; current < year; current++) ordinal += leap(current) ? 366 : 365;
  for (let current = 1; current < month; current++) ordinal += monthDays(year, current);
  return ordinal + day - 1;
}

function policySchedules(policy) {
  object(policy, 'policy');
  if (!Array.isArray(policy.onceSchedules)) fail('policy onceSchedules must be an array');
  if (policy.onceSchedules.length > MAX_SCHEDULES) fail(`policy onceSchedules exceeds ${MAX_SCHEDULES}`);
  const schedules = new Map();
  for (const item of policy.onceSchedules) {
    exactKeys(item, new Set(['id', 'timezone']), 'policy onceSchedule');
    const id = scheduleName(item.id, 'policy onceSchedule id');
    if (schedules.has(id)) fail(`duplicate policy onceSchedule ${id}`);
    schedules.set(id, timezone(item.timezone, `policy onceSchedule ${id}`));
  }
  return schedules;
}

function descriptors(policy, input) {
  object(input, 'schedule descriptors');
  if (Object.keys(input).length > MAX_SCHEDULES) fail(`schedule descriptors exceeds ${MAX_SCHEDULES}`);
  const expected = policySchedules(policy);
  const mapped = new Map();
  const numericIds = new Set();
  for (const [name, descriptor] of Object.entries(input)) {
    scheduleName(name, 'schedule descriptor name');
    const expectedTimezone = expected.get(name);
    if (!expectedTimezone) fail(`schedule descriptor ${name} is not a bound onceSchedule`);
    exactKeys(descriptor, new Set(['numericId', 'timezone', 'slots']), `schedule descriptor ${name}`);
    if (!own(descriptor, 'numericId') || !own(descriptor, 'timezone') || !own(descriptor, 'slots')) {
      fail(`schedule descriptor ${name} requires numericId, timezone, and slots`);
    }
    const id = numericId(descriptor.numericId, `schedule descriptor ${name} numericId`);
    if (numericIds.has(id)) fail(`duplicate schedule numericId ${id}`);
    numericIds.add(id);
    const zone = timezone(descriptor.timezone, `schedule descriptor ${name}`);
    if (zone !== expectedTimezone) fail(`schedule descriptor ${name} timezone does not match bound policy`);
    if (!Array.isArray(descriptor.slots) || descriptor.slots.length > 96) {
      fail(`schedule descriptor ${name} slots must contain 0 to 96 entries`);
    }
    const slots = descriptor.slots.map(value => minute(value, `schedule descriptor ${name} slot`));
    if (new Set(slots).size !== slots.length) fail(`schedule descriptor ${name} slots must be unique`);
    mapped.set(name, Object.freeze({ numericId: id, timezone: zone, slots: Object.freeze([...slots].sort((a, b) => a - b)) }));
  }
  for (const name of expected.keys()) if (!mapped.has(name)) fail(`missing schedule descriptor for bound onceSchedule ${name}`);
  return mapped;
}

function parseEvent(event, schedules) {
  object(event, 'schedule event');
  if (event.due !== true) fail('schedule event must be due');
  if (typeof event.occurrence !== 'string') fail('schedule event requires occurrence');
  const match = OCCURRENCE.exec(event.occurrence);
  if (!match) fail('schedule event occurrence must be NAME/YYYY-MM-DD/MMMM');
  const [, name, date, minuteText] = match;
  const descriptor = schedules.get(name);
  if (!descriptor) fail(`schedule event ${name} is not a bound onceSchedule`);
  const parsedMinute = Number(minuteText);
  minute(parsedMinute, 'schedule event occurrence minute');
  if (event.date !== date || event.minute !== parsedMinute || event.timezone !== descriptor.timezone) {
    fail('schedule event fields do not match its canonical occurrence');
  }
  if (!descriptor.slots.includes(parsedMinute)) fail(`schedule event minute is not selected for ${name}`);
  const ordinal = civilDayOrdinal(date);
  return { descriptor, ordinal, minute: parsedMinute };
}

export class ScheduledAdmission {
  #schedules;

  constructor(policy, scheduleDescriptors) {
    this.#schedules = descriptors(policy, scheduleDescriptors);
    // The private map contains deep-copied, frozen records; later caller
    // mutations cannot change deployment identity or scheduled admission.
    Object.freeze(this);
  }

  occurrenceId(event) {
    const { descriptor, ordinal, minute: occurrenceMinute } = parseEvent(event, this.#schedules);
    return (BigInt(descriptor.numericId) << 48n) | (BigInt(ordinal) << 16n) | BigInt(occurrenceMinute);
  }

  start(station, event, request, persist) {
    if (!station || typeof station.start !== 'function') fail('station must provide start(request, persist)');
    object(request, 'scheduled start request');
    if ('occurrenceId' in request) fail('scheduled start request must not provide occurrenceId');
    if (request.mode !== 'Auto') fail('scheduled admission requires mode Auto');
    return station.start({ ...request, occurrenceId: this.occurrenceId(event) }, persist);
  }
}
