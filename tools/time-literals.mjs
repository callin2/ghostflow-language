const DAY_MS = 86_400_000;
const MAX_YEAR = 9999;

export const TIME_TYPES = Object.freeze(['Date', 'TimeOfDay', 'DateTime']);
export const TIME_BOUNDS = Object.freeze({
  Date: Object.freeze({ min: 0, max: 2_932_896 }),
  TimeOfDay: Object.freeze({ min: 0, max: DAY_MS - 1 }),
  DateTime: Object.freeze({ min: 0, max: 253_402_300_799_999 }),
});

export function isTimeType(type) { return TIME_TYPES.includes(type); }

export function validateTimeValue(type, value, label = type) {
  const bounds = TIME_BOUNDS[type];
  if (!bounds) fail(`unknown time type ${String(type)}`);
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    fail(`${label} must be an integer in [${bounds.min}, ${bounds.max}]`);
  }
  return value;
}

function fail(message) { throw new Error(message); }
function leap(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function validDate(year, month, day) {
  if (year < 1970 || year > MAX_YEAR || month < 1 || month > 12) return false;
  const days = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}
function dateMs(year, month, day) {
  // Years are >= 1970, so Date.UTC has no legacy 0..99 remapping to avoid.
  return Date.UTC(year, month - 1, day);
}
function dateParts(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?![\s\S])/.exec(text);
  if (!match) fail('invalid date literal');
  const parts = match.slice(1).map(Number);
  if (!validDate(...parts)) fail('date literal is out of range');
  return parts;
}
function fractionMs(value) { return value ? Number(value.slice(1).padEnd(3, '0')) : 0; }

export function parseTimeLiteral(tag, text) {
  if (typeof tag !== 'string' || typeof text !== 'string') fail('time literal tag and text must be strings');
  if (tag === 'date') {
    const [year, month, day] = dateParts(text);
    return { type: 'Date', value: Math.floor(dateMs(year, month, day) / DAY_MS) };
  }
  if (tag === 'time') {
    const match = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(?![\s\S])/.exec(text);
    if (!match) fail('invalid time literal');
    const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) fail('time literal is out of range');
    return { type: 'TimeOfDay', value: ((hour * 3600 + minute * 60 + second) * 1000) + fractionMs(match[4]) };
  }
  if (tag === 'datetime') {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})(?![\s\S])/.exec(text);
    if (!match) fail('invalid datetime literal');
    const [year, month, day] = dateParts(match[1]);
    const hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4]);
    if (hour > 23 || minute > 59 || second > 59) fail('datetime literal is out of range');
    const offset = match[6];
    let offsetMinutes = 0;
    if (offset !== 'Z') {
      if (offset === '-00:00') fail('negative zero offset is ambiguous');
      const sign = offset[0] === '+' ? 1 : -1;
      const oh = Number(offset.slice(1, 3)), om = Number(offset.slice(4));
      if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) fail('datetime offset is out of range');
      offsetMinutes = sign * (oh * 60 + om);
    }
    const value = dateMs(year, month, day) + ((hour * 60 + minute) * 60 + second) * 1000 + fractionMs(match[5]) - offsetMinutes * 60_000;
    const max = dateMs(9999, 12, 31) + DAY_MS - 1;
    if (value < 0 || value > max) fail('datetime instant is out of range');
    return { type: 'DateTime', value };
  }
  fail('unknown time literal tag');
}

function pad(value, width) { return String(value).padStart(width, '0'); }

export function formatTimeLiteral(type, value) {
  validateTimeValue(type, value, type);
  if (type === 'Date') {
    const date = new Date(value * DAY_MS);
    return `date\`${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}\``;
  }
  if (type === 'TimeOfDay') {
    const hour = Math.floor(value / 3_600_000);
    const minute = Math.floor(value % 3_600_000 / 60_000);
    const second = Math.floor(value % 60_000 / 1000);
    return `time\`${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(value % 1000, 3)}\``;
  }
  return `datetime\`${new Date(value).toISOString()}\``;
}
