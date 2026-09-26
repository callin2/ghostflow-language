// Astronomy is a host input. Output expressions, timers and constraints still
// execute in the portable VM. No network, machine clock or device I/O here.
import { getTimes } from 'suncalc';

const DAY_MS = 86_400_000;
const MAX_WALL_MS = 253402300799999;
export const SOLAR_CALCULATION = 'suncalc-2.0.2/sea-level';
const integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
};
const wall = value => {
  integer(value, 'wallMs');
  if (value > MAX_WALL_MS) throw new RangeError('wall time must be before year 10000');
  return value;
};

export function validateSolarDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Solar descriptor must be an object');
  if (value.kind !== 'solar') throw new TypeError('Solar kind must be solar');
  if (typeof value.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.name)) throw new TypeError('invalid Solar name');
  if (typeof value.timezone !== 'string' || !value.timezone.trim()) throw new TypeError('Solar timezone is required');
  new Intl.DateTimeFormat('en-US', { timeZone: value.timezone });
  for (const [key, bound] of [['latitude', 90], ['longitude', 180]]) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Math.abs(value[key]) > bound) throw new RangeError(`Solar ${key} is out of range`);
  }
  if (!['rise', 'set'].includes(value.event)) throw new TypeError('Solar event must be rise or set');
  if (!Number.isSafeInteger(value.offsetMs) || Math.abs(value.offsetMs) > DAY_MS) throw new RangeError('Solar offset must be integer milliseconds within 24 hours');
  if (!value.policy || value.policy.fallback !== 'skip') throw new TypeError('Solar requires explicit fallback skip');
  return Object.freeze({ kind: 'solar', name: value.name, timezone: value.timezone, latitude: value.latitude,
    longitude: value.longitude, event: value.event, offsetMs: value.offsetMs, policy: value.policy });
}

export class SolarSchedule {
  #descriptor;
  #formatter;
  #cache = new Map();
  #dateMinute = null;
  #dateValue = null;
  #lastNow = null;
  #wallHigh = null;
  #trusted = false;

  constructor(descriptor) {
    this.#descriptor = validateSolarDescriptor(descriptor);
    Object.defineProperty(this, 'name', { value: this.#descriptor.name, enumerable: true });
    this.#formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      timeZone: this.#descriptor.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  }

  #date(wallMs) {
    const minute = Math.floor(wallMs / 60_000);
    if (minute === this.#dateMinute) return this.#dateValue;
    const parts = Object.fromEntries(this.#formatter.formatToParts(wallMs).map(part => [part.type, part.value]));
    this.#dateMinute = minute;
    this.#dateValue = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
    return this.#dateValue;
  }

  // The date is the local date of the natural event, before applying its offset.
  // Adjacent UTC solar days cover extreme longitude/timezone and DST boundaries.
  #forDate(date) {
    if (this.#cache.has(date)) return this.#cache.get(date);
    const config = this.#descriptor;
    let eventWallMs = null;
    const year = Number(date.slice(0, 4));
    const supported = year >= 2000 && year <= 2100;
    if (supported) {
      const noon = Date.parse(`${date}T12:00:00Z`);
      for (const shift of [-1, 0, 1]) {
        const times = getTimes(new Date(noon + shift * DAY_MS), config.latitude, config.longitude, 0);
        const event = times[config.event === 'rise' ? 'sunrise' : 'sunset'];
        const instant = event?.getTime();
        if (Number.isSafeInteger(instant) && this.#date(instant) === date && (eventWallMs === null || instant < eventWallMs)) eventWallMs = instant;
      }
    }
    const result = Object.freeze({ date, eventWallMs,
      scheduledWallMs: eventWallMs === null ? null : eventWallMs + config.offsetMs,
      calculation: SOLAR_CALCULATION,
      ...(eventWallMs === null ? { reason: supported ? 'NoSolarEvent' : 'UnsupportedSolarDate' } : {}),
    });
    this.#cache.set(date, result);
    if (this.#cache.size > 8) this.#cache.delete(this.#cache.keys().next().value);
    return result;
  }

  preview(wallMs) { return this.#forDate(this.#date(wall(wallMs))); }

  poll({ nowMs, wallMs, trusted = true }) {
    integer(nowMs, 'nowMs'); wall(wallMs);
    if (typeof trusted !== 'boolean') throw new TypeError('trusted must be boolean');
    const previousNow = this.#lastNow;
    if (previousNow !== null && nowMs < previousNow) throw new Error('monotonic clock moved backwards');
    this.#lastNow = nowMs;
    if (!trusted) { this.#trusted = false; return { due: false, reason: 'UntrustedClock' }; }
    const recovered = !this.#trusted;
    this.#trusted = true;
    const previousWall = this.#wallHigh;
    this.#wallHigh = Math.max(previousWall ?? wallMs, wallMs);
    if (previousWall === null) return { due: false, reason: 'BootBaseline' };
    if (recovered) return { due: false, reason: 'ClockRecoveryBaseline' };
    if (wallMs <= previousWall) return { due: false, reason: 'AlreadyObserved' };
    // No catch-up after suspension/time correction. Accelerated playback still
    // supplies every logical scan, so it crosses the same event boundary.
    if (wallMs - previousWall > 60_000 || nowMs - previousNow > 60_000) return { due: false, reason: 'ClockGapSkipped' };
    const offset = this.#descriptor.offsetMs;
    const dates = new Set([this.#date(previousWall - offset), this.#date(wallMs - offset)]);
    let unavailable;
    for (const date of dates) {
      const occurrence = this.#forDate(date);
      if (occurrence.reason) unavailable = occurrence.reason;
      const at = occurrence.scheduledWallMs;
      if (at !== null && at > previousWall && at <= wallMs) return {
        ...occurrence, due: true, timezone: this.#descriptor.timezone,
        occurrence: `${this.name}/${date}/${this.#descriptor.event}/${at}`,
      };
    }
    return { due: false, reason: unavailable ?? 'OutsideSolarEvent' };
  }
}
