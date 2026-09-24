import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
const periodic = cases.find(entry => entry.id === 'REF-03-036');
const cron = cases.find(entry => entry.id === 'REF-03-038');
const code = fixture => extractLiterate(fixture.source, { filename: fixture.filename }).code;
const check = source => typeCheckControl(source).manifest.schedules[0];

test('Periodic retains its setting identity, exact anchor and phase policy', () => {
  const descriptor = check(code(periodic));
  assert.equal(descriptor.kind, 'periodic');
  assert.deepEqual(descriptor.every, { expression: '900000', initialMs: 900000, config: 'interval' });
  assert.deepEqual(descriptor.anchor, { kind: 'instant', instantMs: Date.UTC(2026, 9, 1) });
  assert.equal(descriptor.intervalChange, 'preserve_anchor');
  assert.deepEqual(descriptor.policy, { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 60000, recovery: 'baseline', fallback: 'skip' });
  assert.equal('dueInput' in descriptor, false);
});

test('Cron retains the five validated fields and civil policy', () => {
  const descriptor = check(code(cron));
  assert.equal(descriptor.kind, 'cron');
  assert.equal(descriptor.cron5, '0 6 * * 1-5');
  assert.deepEqual(descriptor.fields, [[0], [6], null, null, [1, 2, 3, 4, 5]]);
  assert.equal(descriptor.timezone, 'Asia/Seoul');
  assert.equal(descriptor.dstRepeated, 'first');
  assert.equal('dueInput' in descriptor, false);
});

test('Periodic civil anchors retain local date, millisecond time and mandatory DST policy', () => {
  const descriptor = check(code(periodic).replace('instant(datetime`2026-10-01T00:00:00Z`)',
    'civil(date`2026-10-01`, time`23:59:59.999`)').replace('basis = pulse;',
    'timezone = "America/New_York"; dst_missing = next_valid; dst_repeated = both; basis = pulse;'));
  assert.deepEqual(descriptor.anchor, { kind: 'civil', date: '2026-10-01', timeMs: 86399999 });
  assert.equal(descriptor.timezone, 'America/New_York');
  assert.equal(descriptor.dstMissing, 'next_valid');
  assert.equal(descriptor.dstRepeated, 'both');
});

test('Periodic persisted_epoch remains an activation requirement with no hidden boot anchor', () => {
  const descriptor = check(code(periodic).replace('instant(datetime`2026-10-01T00:00:00Z`)', 'persisted_epoch'));
  assert.deepEqual(descriptor.anchor, { kind: 'persisted-epoch' });
});

for (const fixture of [periodic, cron]) {
  test(`${fixture.id} emits executable GFB10 with source schedule identity`, async () => {
    const direct = compileControl(code(fixture));
    assert.equal(direct.manifest.format, 'GhostFlow/control-v9');
    const compiled = await compileSource(fixture.source, { filename: fixture.filename });
    assert.equal(compiled.manifest.format, 'GhostFlow/control-v9');
    assert.equal(compiled.manifest.schedules[0].site, direct.manifest.schedules[0].site);
    assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset, compiled.bytes.byteLength).getUint16(4, true), 10);
  });
  for (const field of ['basis', 'when', 'clock', 'gap', 'recovery', 'fallback']) {
    test(`${fixture.id} requires explicit ${field}`, () => {
      assert.throws(() => check(code(fixture).replace(new RegExp(`${field} = [^;]+;`), '')), new RegExp(`requires ${field}`));
    });
  }
}

test('Periodic retains all phase policies and exact Duration boundaries', () => {
  for (const policy of ['preserve_anchor', 'preserve_next', 'restart_after_change']) {
    for (const duration of [1, Number.MAX_SAFE_INTEGER]) {
      const descriptor = check(code(periodic).replace('every = interval', `every = ${duration}ms`).replace('preserve_anchor', policy));
      assert.equal(descriptor.every.initialMs, duration);
      assert.equal(descriptor.intervalChange, policy);
    }
  }
});

for (const [label, before, after, diagnostic] of [
  ['missing every', 'every = interval;', '', /requires every/],
  ['missing anchor', 'anchor = instant(datetime`2026-10-01T00:00:00Z`);', '', /requires anchor/],
  ['missing phase policy', 'interval_change = preserve_anchor;', '', /requires interval_change/],
  ['duplicate every', 'every = interval;', 'every = interval; every = 1s;', /duplicate Periodic option every/],
  ['zero interval', 'every = interval', 'every = 0ms', /positive Duration/],
  ['untyped interval', 'every = interval', 'every = 1', /positive Duration/],
  ['Bool interval', 'every = interval', 'every = true', /positive Duration/],
  ['Percent interval', 'every = interval', 'every = 50%', /positive Duration/],
  ['oversized interval', 'every = interval', 'every = 9007199254740992ms', /Duration literal exceeds the maximum/],
  ['bad interval policy', 'preserve_anchor', 'reset', /interval_change must be/],
  ['wrong instant type', 'datetime`2026-10-01T00:00:00Z`', 'date`2026-10-01`', /constant DateTime/],
  ['implicit boot anchor', 'instant(datetime`2026-10-01T00:00:00Z`)', 'boot', /anchor requires/],
  ['extra anchor argument', 'instant(datetime`2026-10-01T00:00:00Z`)', 'instant(datetime`2026-10-01T00:00:00Z`, 1s)', /anchor requires/],
  ['civil without timezone', 'instant(datetime`2026-10-01T00:00:00Z`)', 'civil(date`2026-10-01`, time`00:00`)', /requires timezone/],
  ['civil wrong date type', 'instant(datetime`2026-10-01T00:00:00Z`)', 'civil(1s, time`00:00`)', /constant Date and TimeOfDay/],
  ['ignored timezone', 'basis = pulse;', 'timezone = "UTC"; basis = pulse;', /require a civil anchor/],
]) test(`Periodic rejects ${label}`, () => assert.throws(() => check(code(periodic).replace(before, after)), diagnostic));

test('Cron supports lists, ranges and bounded steps without changing field meaning', () => {
  const descriptor = check(code(cron).replace('0 6 * * 1-5', '0,15,30,45 0-23/6 * 1,12 0-6/2'));
  assert.deepEqual(descriptor.fields, [[0, 15, 30, 45], [0, 6, 12, 18], null, [1, 12], [0, 2, 4, 6]]);
  assert.deepEqual(check(code(cron).replace('0 6 * * 1-5', '*/20 23 31 12 *')).fields,
    [[0, 20, 40], [23], [31], [12], null]);
});

for (const pattern of [
  '0 6 * *', '0 6 * * * *', '60 6 * * *', '0 24 * * *', '0 6 0 * *',
  '0 6 32 * *', '0 6 * 0 *', '0 6 * 13 *', '0 6 * * 7', '0 6 * * MON',
  '0 6 1 * 1', '*/0 6 * * *', '*/-1 6 * * *', '5-1 6 * * *', '1/2 6 * * *',
  '0, 6 * * *', '0 6 ? * *', '0 6 * * 1-7', '*/9007199254740992 6 * * *',
]) test(`Cron rejects invalid expression ${pattern}`, () => {
  assert.throws(() => check(code(cron).replace('0 6 * * 1-5', pattern)), /cron5/);
});

for (const field of ['at', 'timezone', 'dst_missing', 'dst_repeated']) {
  test(`Cron requires ${field}`, () => {
    assert.throws(() => check(code(cron).replace(new RegExp(`${field} = [^;]+;`), '')), new RegExp(`requires ${field}`));
  });
}

test('Cron rejects a non-tagged at and an unterminated literal with source diagnostics', () => {
  assert.throws(() => check(code(cron).replace('cron5`0 6 * * 1-5`', '"0 6 * * 1-5"')), /cron5 tagged literal/);
  assert.throws(() => check(code(cron).replace('cron5`0 6 * * 1-5`', 'cron5`0 6 * * 1-5')), /unterminated cron5 literal/);
});
