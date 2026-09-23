import test from 'node:test';
import assert from 'node:assert/strict';
import { SolarSchedule } from '../runtimes/wasm/schedule.mjs';

const DAY = 86_400_000;
const noon = Date.parse('2026-09-14T12:00:00+09:00');
const config = { kind: 'solar', name: 'dawn', timezone: 'Asia/Seoul', latitude: 37.5665,
  longitude: 126.978, event: 'rise', offsetMs: 1_800_000,
  policy: { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 60_000, recovery: 'baseline', fallback: 'skip' } };
const at = (host, date = noon) => host.preview(date).scheduledWallMs;
const pulse = (host, instant) => {
  host.poll({ nowMs: 0, wallMs: instant - 100 });
  return host.poll({ nowMs: 100, wallMs: instant });
};

test('Seoul rise/set agree with an independent USNO minute-resolution reference', () => {
  // USNO API v4.0.1, retrieved 2026-09-14, public test coordinates, UTC+9:
  // https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-14&coords=37.5665%2C126.978&tz=9
  // sundata: Rise 06:13; Set 18:42. 90s tolerance accommodates minute rounding
  // and the providers' astronomical models; not a self-comparison oracle.
  for (const [event, time] of [['rise', '06:13'], ['set', '18:42']]) {
    const preview = new SolarSchedule({ ...config, event }).preview(noon);
    assert.equal(preview.date, '2026-09-14');
    assert.ok(Math.abs(preview.eventWallMs - Date.parse(`2026-09-14T${time}:00+09:00`)) < 90_000);
    assert.equal(preview.scheduledWallMs - preview.eventWallMs, config.offsetMs);
    assert.equal(preview.calculation, 'suncalc-2.0.2/sea-level');
  }
});

test('location and date determine events, while fractional-slot offsets remain exact', () => {
  const host = new SolarSchedule({ ...config, offsetMs: 1 });
  const before = host.preview(noon), next = host.preview(noon + DAY);
  assert.notEqual(next.eventWallMs - before.eventWallMs, DAY);
  assert.equal(before.scheduledWallMs - before.eventWallMs, 1);
  assert.notEqual(new SolarSchedule({ ...config, longitude: 129 }).preview(noon).eventWallMs, before.eventWallMs);
  const input = { ...config };
  const copied = new SolarSchedule(input);
  input.longitude = 0;
  assert.equal(copied.preview(noon).eventWallMs, before.eventWallMs);
  assert.ok(Object.isFrozen(before));
});

test('positive and negative offsets cross midnight using the original event date', () => {
  for (const offsetMs of [-DAY, -12 * 3600000, 0, 12 * 3600000, DAY]) {
    const host = new SolarSchedule({ ...config, offsetMs });
    const instant = at(host);
    const result = pulse(host, instant);
    assert.equal(result.due, true, String(offsetMs));
    assert.equal(result.date, '2026-09-14');
    assert.match(result.occurrence, /dawn\/2026-09-14\/rise\//);
    assert.equal(host.poll({ nowMs: 200, wallMs: instant + 100 }).due, false);
  }
});

test('trusted crossings emit once, rollback and preview do not duplicate or consume events', () => {
  const host = new SolarSchedule(config), instant = at(host);
  assert.equal(pulse(host, instant).due, true);
  host.preview(noon + DAY);
  assert.equal(host.poll({ nowMs: 200, wallMs: instant - 100 }).due, false);
  assert.equal(host.poll({ nowMs: 300, wallMs: instant }).due, false);
  assert.equal(host.poll({ nowMs: 400, wallMs: instant + 100 }).due, false);
  assert.throws(() => host.poll({ nowMs: 399, wallMs: instant + 200 }), /backwards/);
});

test('boot, untrusted clocks, recovery and large wall or monotonic gaps skip catch-up', () => {
  const instant = at(new SolarSchedule(config));
  assert.equal(new SolarSchedule(config).poll({ nowMs: 0, wallMs: instant }).reason, 'BootBaseline');
  const host = new SolarSchedule(config);
  host.poll({ nowMs: 0, wallMs: instant - 100 });
  assert.equal(host.poll({ nowMs: 100, wallMs: instant, trusted: false }).reason, 'UntrustedClock');
  assert.equal(host.poll({ nowMs: 200, wallMs: instant + 100 }).reason, 'ClockRecoveryBaseline');
  assert.equal(host.poll({ nowMs: 300, wallMs: instant + 200 }).due, false);
  for (const [wallDelta, nowDelta] of [[61000, 100], [100, 61000]]) {
    const gap = new SolarSchedule(config);
    gap.poll({ nowMs: 0, wallMs: instant - 100 });
    assert.equal(gap.poll({ nowMs: nowDelta, wallMs: instant - 100 + wallDelta }).reason, 'ClockGapSkipped');
  }
});

test('polar day/night and unsupported dates report unavailable without inventing an event', () => {
  for (const event of ['rise', 'set']) {
    const host = new SolarSchedule({ ...config, latitude: 69.6492, longitude: 18.9553, timezone: 'Europe/Oslo', event });
    for (const date of ['2026-06-21', '2026-12-21']) {
      const value = host.preview(Date.parse(`${date}T12:00:00Z`));
      assert.equal(value.reason, 'NoSolarEvent');
      assert.equal(value.scheduledWallMs, null);
    }
  }
  const host = new SolarSchedule(config);
  for (const year of [1999, 2101]) assert.equal(host.preview(Date.parse(`${year}-09-14T12:00:00Z`)).reason, 'UnsupportedSolarDate');
});

test('local solar dates survive date-line zones and DST changes', () => {
  for (const [timezone, latitude, longitude, stamp, date] of [
    ['Pacific/Kiritimati', 1.8721, -157.4278, '2026-09-14T12:00:00+14:00', '2026-09-14'],
    ['Pacific/Pago_Pago', -14.2756, -170.7020, '2026-09-14T12:00:00-11:00', '2026-09-14'],
    ['America/New_York', 40.7128, -74.0060, '2026-11-01T12:00:00-05:00', '2026-11-01'],
  ]) {
    const host = new SolarSchedule({ ...config, timezone, latitude, longitude });
    const preview = host.preview(Date.parse(stamp));
    assert.equal(preview.date, date);
    assert.ok(Number.isSafeInteger(preview.eventWallMs));
    assert.equal(pulse(host, preview.scheduledWallMs).due, true);
  }
});

test('Solar descriptor and clock fields reject malformed values', () => {
  for (const change of [{ kind: 'unknown' }, { name: 'bad name' }, { timezone: 'Not/AZone' },
    { latitude: 91 }, { longitude: Infinity }, { latitude: '37' }, { event: 'moonrise' },
    { policy: undefined }, { policy: { ...config.policy, fallback: 'catchup' } }, { offsetMs: DAY + 1 }, { offsetMs: 0.5 }]) {
    assert.throws(() => new SolarSchedule({ ...config, ...change }), JSON.stringify(change));
  }
  for (const change of [{ nowMs: -1 }, { wallMs: NaN }, { wallMs: 253402300800000 }, { trusted: 'yes' }]) {
    assert.throws(() => new SolarSchedule(config).poll({ nowMs: 0, wallMs: noon, ...change }));
  }
});
