import test from 'node:test';
import assert from 'node:assert/strict';
import { compileControl } from '../tools/control.mjs';
import { compile, lowerCoreModule, emitGfb } from '../tools/gfb1.mjs';
const format = compiled => Buffer.from(compiled.bytes).readUInt16LE(4);

const solar = (clock = 'trusted_only', fallback = 'skip', declarations = '') => `control Natural {
  ${declarations}
  schedule dawn: Solar {
    timezone = "UTC"; latitude = 37; longitude = 127; at = sun\`rise + 1ms\`;
    basis = pulse; when = true; clock = ${clock}; gap = skip_after(60s);
    recovery = baseline; fallback = ${fallback};
  }
  output start: Bool; start <- dawn.due;
}`;

test('natural policy objects select GFB13 while legacy Solar stays GFB5', () => {
  const legacy = compileControl(solar());
  assert.equal(format(legacy), 5);
  const compiled = compileControl(solar('hold_trusted(2min, terminal: skip)', 'fixed_time(time`06:30`, terminal: skip)'));
  assert.equal(format(compiled), 13);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v12');
  const schedule = compiled.manifest.schedules[0];
  assert.equal(schedule.offsetMs, 1);
  assert.deepEqual(schedule.policy.clock, { kind: 'hold_trusted', durationMs: 120000, terminal: 'skip' });
  assert.deepEqual(schedule.policy.fallback, { kind: 'fixed_time', atMs: 23400000, terminal: 'skip' });
});

test('hold_trusted requires a positive constant Duration and terminal skip', () => {
  for (const clock of ['hold_trusted(0ms, terminal: skip)', 'hold_trusted(1, terminal: skip)',
    'hold_trusted(1s)', 'hold_trusted(1s, terminal: baseline)', 'hold_trusted(delay, terminal: skip)']) {
    assert.throws(() => compileControl(solar(clock, 'skip', 'input delay: Duration;')));
  }
  assert.throws(() => compileControl(solar('hold_trusted(a, terminal: skip)', 'skip', 'let a = b; let b = a;')), /cyclic/);
});

test('fixed_time requires a valid TimeOfDay literal and explicit terminal skip', () => {
  for (const fallback of ['fixed_time(time`24:00`, terminal: skip)', 'fixed_time(6h, terminal: skip)',
    'fixed_time(time`06:30`)', 'fixed_time(time`06:30`, terminal: baseline)', 'fixed_time(at, terminal: skip)']) {
    assert.throws(() => compileControl(solar('trusted_only', fallback, 'let at = time`06:30`;')));
  }
  assert.equal(format(compileControl(solar('trusted_only', 'fixed_time(time`00:00`, terminal: skip)'))), 13);
});

test('Tide hold is GFB13 and fixed_time remains Solar only', () => {
  const tide = (clock, fallback = 'skip') => `control TideHold {
    provider predictions: TidePredictions;
    schedule high: Tide { source = predictions; timezone = "UTC"; at = tide\`high - 1ms\`;
      basis = run(1min, within(2min)); when = true; cancel_when = false;
      clock = ${clock}; gap = skip_after(60s); recovery = baseline; fallback = ${fallback}; }
    output active: Bool; active <- high.active;
  }`;
  assert.equal(format(compileControl(tide('trusted_only'))), 11);
  const compiled = compileControl(tide('hold_trusted(1min, terminal: skip)'));
  assert.equal(format(compiled), 13);
  assert.equal(compiled.manifest.schedules[0].offsetMs, -1);
  assert.throws(() => compileControl(tide('trusted_only', 'fixed_time(time`06:30`, terminal: skip)')), /fallback must be skip/);
});

test('civil Daily explicitly rejects hold_trusted in the initial natural-only slice', () => {
  assert.throws(() => compileControl(`control CivilHold {
    schedule morning: Daily { timezone = "UTC"; at = time\`06:30\`;
      dst_missing = skip; dst_repeated = first; basis = pulse; when = true;
      clock = hold_trusted(1min, terminal: skip); gap = skip_after(60s);
      recovery = baseline; fallback = skip; }
    output start: Bool; start <- morning.due;
  }`), /clock must be trusted_only/);
});

test('extended Solar rejects unavailable mixed adapter contracts without changing legacy mixtures', () => {
  const daily = `schedule morning: Daily { timezone = "UTC"; at = time\`06:30\`;
    dst_missing = skip; dst_repeated = first; basis = pulse; when = true;
    clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip; }`;
  assert.equal(format(compileControl(solar('trusted_only', 'skip', daily))), 8);
  for (const declarations of [daily, 'provider tides: TidePredictions;']) {
    assert.throws(() => compileControl(solar('hold_trusted(1min, terminal: skip)', 'skip', declarations)),
      /extended Solar policy execution requires Solar-only schedules/);
  }
});

test('extended Solar retains Int state and scalar quantity support', () => {
  const source = solar('hold_trusted(1min, terminal: skip)', 'skip',
    'state count: Int = 0; let threshold: Temperature = 293K;')
    .replace('output start: Bool;', "count' = if dawn.due then count + 1 else count; output start: Bool;");
  assert.equal(format(compileControl(source)), 13);
});

test('extended Solar S-expression preserves semantic IR roundtrip and rejects empty extension', () => {
  const module = ['module', 'Roundtrip', ['version', '1'], ['input', '__gf_now_ms', 'number'],
    ['input', '__gf_time_epoch', 'number'], ['temporal-context', '__gf_now_ms', '__gf_time_epoch'],
    ['strategy', 'control', '0', ['device', 'true'],
      ['solar-pulse', '1', 'dawn', 'UTC', '37', '127', 'rise', '1', 'pulse', 'trusted_only', '60000', 'baseline', 'skip', 'true', '60000', '23400000'],
      ['intent', 'active', 'true']]];
  assert.deepEqual(emitGfb(lowerCoreModule(module)), compile(module));
  assert.equal(Buffer.from(compile(module)).readUInt16LE(4), 13);
  module.at(-1)[4].splice(-2, 2, '0', '86400000');
  assert.throws(() => compile(module), /requires hold or fixed_time/);
});
