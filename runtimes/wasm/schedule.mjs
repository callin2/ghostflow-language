// Wall-clock eligibility only. A station's durable admission ledger, not this
// helper, owns once-per-occurrence execution and pump-time accounting.
export { SolarSchedule } from './solar-schedule.mjs';
const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative safe integer`);
  return value;
};

export class DailySlots {
  constructor({ name, timezone, slots }, restored = null) {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new TypeError('invalid schedule name');
    if (typeof timezone !== 'string' || !timezone) throw new TypeError('timezone is required');
    if (!Array.isArray(slots) || slots.length > 96 || slots.some(slot => !Number.isInteger(slot) || slot < 0 || slot >= 1440 || slot % 15) || new Set(slots).size !== slots.length) {
      throw new TypeError('slots must contain at most 96 unique 15-minute minute-of-day values');
    }
    this.name = name; this.timezone = timezone; this.slots = [...slots].sort((a, b) => a - b);
    this.formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    this.identity = JSON.stringify([name, timezone, this.slots]);
    this.lastNow = null; this.wallHigh = null; this.civilHigh = null;
    if (restored !== null) {
      if (restored.format !== 'GhostFlow/schedule-v1' || restored.identity !== this.identity) throw new Error('schedule snapshot identity mismatch');
      if (restored.wallHigh !== null) integer(restored.wallHigh, 'snapshot.wallHigh');
      if (restored.civilHigh !== null && !/^\d{4}-\d{2}-\d{2}\/\d{4}$/.test(restored.civilHigh)) throw new Error('invalid civil watermark');
      this.wallHigh = restored.wallHigh; this.civilHigh = restored.civilHigh;
    }
  }

  // No boot catch-up, no burst catch-up, and no event on untrusted time.
  // Poll at least once per minute. A gap >60s skips its occurrences. Clock
  // rollback holds the high-water marks until trusted time catches up.
  poll({ nowMs, wallMs, trusted = true }) {
    integer(nowMs, 'nowMs'); integer(wallMs, 'wallMs');
    if (typeof trusted !== 'boolean') throw new TypeError('trusted must be boolean');
    if (wallMs > 253402300799999) throw new RangeError('wall time must be before year 10000');
    if (this.lastNow !== null && nowMs < this.lastNow) throw new Error('monotonic clock moved backwards');
    const first = this.lastNow === null;
    this.lastNow = nowMs;
    if (!trusted) return { due: false, reason: 'UntrustedClock' };
    const parts = Object.fromEntries(this.formatter.formatToParts(wallMs).map(p => [p.type, p.value]));
    const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const civil = `${date}/${String(minute).padStart(4, '0')}`;
    const previousWall = this.wallHigh, previousCivil = this.civilHigh;
    this.wallHigh = Math.max(previousWall ?? wallMs, wallMs);
    this.civilHigh = previousCivil === null || civil > previousCivil ? civil : previousCivil;
    if (first || previousWall === null) return { due: false, reason: 'BootBaseline' };
    if (wallMs <= previousWall || civil <= previousCivil) return { due: false, reason: 'AlreadyObserved' };
    if (wallMs - previousWall > 60_000) return { due: false, reason: 'ClockGapSkipped' };
    if (!this.slots.includes(minute)) return { due: false, reason: 'UnselectedSlot' };
    return { due: true, occurrence: `${this.name}/${civil}`, date, minute, timezone: this.timezone };
  }

  snapshot() { return { format: 'GhostFlow/schedule-v1', identity: this.identity, wallHigh: this.wallHigh, civilHigh: this.civilHigh }; }
}
