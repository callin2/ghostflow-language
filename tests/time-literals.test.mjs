import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTimeLiteral, parseTimeLiteral } from '../tools/time-literals.mjs';

const formatCases = [
  ['Date', 0, 'date`1970-01-01`'],
  ['Date', 2_932_896, 'date`9999-12-31`'],
  ['TimeOfDay', 0, 'time`00:00:00.000`'],
  ['TimeOfDay', 86_399_999, 'time`23:59:59.999`'],
  ['DateTime', 0, 'datetime`1970-01-01T00:00:00.000Z`'],
  ['DateTime', 253_402_300_799_999, 'datetime`9999-12-31T23:59:59.999Z`'],
];
for (const [type, value, expected] of formatCases) {
  test(`time literal format ${type}:${value}`, () => assert.equal(formatTimeLiteral(type, value), expected));
}

const invalidFormatCases = [
  ['Date', -1], ['Date', 2_932_897], ['Date', 1.5], ['Date', Infinity],
  ['TimeOfDay', -1], ['TimeOfDay', 86_400_000], ['TimeOfDay', 1.5], ['TimeOfDay', NaN],
  ['DateTime', -1], ['DateTime', 253_402_300_800_000], ['DateTime', 1.5], ['DateTime', Infinity],
];
for (const [type, value] of invalidFormatCases) {
  test(`time literal format rejects ${type}:${String(value)}`, () => assert.throws(() => formatTimeLiteral(type, value), Error));
}

const validLiterals = [
  ['date', '1970-01-01', { type: 'Date', value: 0 }],
  ['date', '9999-12-31', { type: 'Date', value: 2_932_896 }],
  ['date', '2000-02-29', { type: 'Date', value: 11_016 }],
  ['date', '2026-09-22', { type: 'Date', value: 20_718 }],
  ['time', '00:00', { type: 'TimeOfDay', value: 0 }],
  ['time', '06:30', { type: 'TimeOfDay', value: 23_400_000 }],
  ['time', '23:59:59.9', { type: 'TimeOfDay', value: 86_399_900 }],
  ['time', '23:59:59.99', { type: 'TimeOfDay', value: 86_399_990 }],
  ['time', '23:59:59.999', { type: 'TimeOfDay', value: 86_399_999 }],
  ['datetime', '1970-01-01T00:00:00.001Z', { type: 'DateTime', value: 1 }],
  ['datetime', '9999-12-31T23:59:59.999Z', { type: 'DateTime', value: 253_402_300_799_999 }],
  ['datetime', '2026-09-22T06:30:00+09:00', { type: 'DateTime', value: 1_790_026_200_000 }],
  ['datetime', '2026-09-22T06:30:00.12Z', { type: 'DateTime', value: 1_790_058_600_120 }],
  ['datetime', '2026-09-22T06:30:00.123Z', { type: 'DateTime', value: 1_790_058_600_123 }],
  ['datetime', '9999-12-31T23:59:59.999+14:00', { type: 'DateTime', value: 253_402_250_399_999 }],
  ['datetime', '1970-01-01T14:00:00+14:00', { type: 'DateTime', value: 0 }],
  ['datetime', '1970-01-01T00:00:00-14:00', { type: 'DateTime', value: 50_400_000 }],
  ['datetime', '1970-01-01T00:00:00+00:00', { type: 'DateTime', value: 0 }],
];
for (const [tag, value, expected] of validLiterals) {
  test(`time literal valid ${tag}:${value}`, () => assert.deepEqual(parseTimeLiteral(tag, value), expected));
}

const invalidLiterals = [
    ['date', '1969-12-31'], ['date', '10000-01-01'], ['date', '1900-02-29'], ['date', '2100-02-29'], ['date', '2026-1-02'],
    ['time', '24:00'], ['time', '12:00:60'], ['time', '12:00:00.1234'],
    ['datetime', '2026-09-22T06:30:00'], ['datetime', '2026-09-22T06:30:00-00:00'],
    ['datetime', '2026-09-22T06:30:00+14:01'], ['datetime', '2026-09-22T06:30:60Z'],
    ['datetime', '9999-12-31T23:59:59.999-14:00'],
    ['datetime', '1970-01-01T00:00:00+00:01'],
    ['date', '1970-01-01\n'], ['time', '00:00\r\n'], ['datetime', '1970-01-01T00:00:00Z '],
    ['date', ''], ['time', ''], ['datetime', ''],
];
for (const [tag, value] of invalidLiterals) {
  test(`time literal invalid ${tag}:${JSON.stringify(value)}`, () => {
    assert.throws(() => parseTimeLiteral(tag, value), Error);
  });
}
