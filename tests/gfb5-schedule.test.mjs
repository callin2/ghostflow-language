import assert from 'node:assert/strict';
import test from 'node:test';
import { compile, CompileError, parse, tokenize } from '../tools/gfb1.mjs';

const encode = source => compile(parse(tokenize(source)));

const clockInputs = `
  (input __gf_now_ms number)
  (input __gf_time_epoch number)`;

const pulse = `(solar-pulse 201 dawn Asia/Seoul 37.5 127 rise -60000 pulse trusted_only 1000 baseline skip true)`;

const scheduleModule = ({ declarations = pulse, tail = '(intent due (schedule-read 0 due))', states = '' } = {}) => `(module ScheduleModule
  (version 9)${clockInputs}
  ${states}
  (temporal-context __gf_now_ms __gf_time_epoch)
  (strategy main 0
    (device true)
    ${declarations}
    ${tail}))`;

const rootInputs = `
  (input root_present bool)
  (input root_epoch number)
  (input root_id number)
  (input root_timestamp number)
  (input value number)
  (input fault number)
  (input origin number)
  (input quality number)
  (input tag number)`;

const windowFromSchedule = `(window 202 gated average number 1000 500
      (roots 11)
      (source (schedule-read 0 due) input.value input.fault input.origin input.quality input.tag))`;

const mixedModule = ({ declarations = `${pulse}\n    ${windowFromSchedule}\n    (solar-pulse 203 dusk Asia/Seoul -12.25 -179.5 set 86400000 pulse trusted_only 9007199254740991 baseline skip (window-read 0 ok))`, tail = '(intent due (schedule-read 1 due))' } = {}) => `(module Mixed
  (version 1)${clockInputs}${rootInputs}
  (temporal-context __gf_now_ms __gf_time_epoch)
  (temporal-root 11 root root_present root_epoch root_id root_timestamp)
  (strategy main 0
    (device true)
    ${declarations}
    ${tail}))`;

class Reader {
  constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.at = 0; }
  raw(size) { const out = this.bytes.slice(this.at, this.at + size); this.at += size; return out; }
  u8() { const value = this.view.getUint8(this.at); this.at += 1; return value; }
  u16() { const value = this.view.getUint16(this.at, true); this.at += 2; return value; }
  u32() { const value = this.view.getUint32(this.at, true); this.at += 4; return value; }
  i32() { const value = this.view.getInt32(this.at, true); this.at += 4; return value; }
  u64() { const value = this.view.getBigUint64(this.at, true); this.at += 8; return value; }
  i64() { const value = this.view.getBigInt64(this.at, true); this.at += 8; return value; }
  f64() { const value = this.view.getFloat64(this.at, true); this.at += 8; return value; }
  string() { return new TextDecoder().decode(this.raw(this.u16())); }
  blob() { return this.raw(this.u32()); }
}

function skipPrefix(r) {
  assert.equal(new TextDecoder().decode(r.raw(4)), 'GFB1');
  const format = r.u16(), moduleName = r.string(), moduleVersion = r.u32();
  const inputCount = r.u16();
  for (let index = 0; index < inputCount; index++) { r.string(); r.u8(); }
  const stateCount = r.u16();
  for (let index = 0; index < stateCount; index++) {
    r.string(); const type = r.u8(); type === 1 ? r.u8() : type === 3 ? r.i32() : r.raw(8);
  }
  const nowInput = r.u16(), epochInput = r.u16(), rootCount = r.u16();
  for (let index = 0; index < rootCount; index++) { r.u32(); r.string(); r.raw(8); }
  return { format, moduleName, moduleVersion, nowInput, epochInput, rootCount };
}

function readWindow(r) {
  const site = r.u32(), name = r.string(), operation = r.u8(), payloadType = r.u8();
  const overMs = r.u64(), maxAgeMs = r.u64(), rootCount = r.u16(), roots = [];
  for (let index = 0; index < rootCount; index++) roots.push(r.u16());
  const source = Array.from({ length: 6 }, () => r.blob());
  return { site, name, operation, payloadType, overMs, maxAgeMs, roots, source };
}

function readSolar(r) {
  return {
    site: r.u32(), name: r.string(), timezone: r.string(), latitude: r.f64(), longitude: r.f64(),
    event: r.u8(), offsetMs: r.i64(), basis: r.u8(), clockPolicy: r.u8(), recovery: r.u8(),
    fallback: r.u8(), gapMs: r.u64(), when: r.blob(),
  };
}

test('GFB5 encodes a schedule-only Solar pulse and due projection exactly', () => {
  const bytes = encode(scheduleModule());
  const r = new Reader(bytes);
  assert.deepEqual(skipPrefix(r), {
    format: 5, moduleName: 'ScheduleModule', moduleVersion: 9, nowInput: 0, epochInput: 1, rootCount: 0,
  });
  assert.equal(r.u16(), 1);
  assert.equal(r.string(), 'main'); assert.equal(r.i32(), 0); assert.deepEqual([...r.blob()], [5, 1]);
  assert.equal(r.u16(), 1); assert.equal(r.u8(), 1);
  assert.deepEqual(readSolar(r), {
    site: 201, name: 'dawn', timezone: 'Asia/Seoul', latitude: 37.5, longitude: 127,
    event: 0, offsetMs: -60000n, basis: 0, clockPolicy: 0, recovery: 0, fallback: 0,
    gapMs: 1000n, when: Uint8Array.from([1, 1]),
  });
  assert.equal(r.u16(), 0);
  assert.equal(r.u16(), 1); assert.equal(r.string(), 'due'); assert.equal(r.u8(), 1);
  assert.deepEqual([...r.blob()], [58, 0, 0, 0]);
  assert.equal(r.u16(), 0); assert.equal(r.at, bytes.length);
});

test('GFB5 interleaves tagged windows and schedules while keeping dense kind-local slots', () => {
  const bytes = encode(mixedModule());
  const r = new Reader(bytes);
  assert.equal(skipPrefix(r).format, 5);
  assert.equal(r.u16(), 1); r.string(); r.i32(); r.blob();
  assert.equal(r.u16(), 3);
  assert.equal(r.u8(), 1); assert.equal(readSolar(r).site, 201);
  assert.equal(r.u8(), 0);
  const window = readWindow(r);
  assert.equal(window.site, 202);
  assert.deepEqual([...window.source[0]], [58, 0, 0, 0]);
  assert.equal(r.u8(), 1);
  const dusk = readSolar(r);
  assert.deepEqual({ site: dusk.site, event: dusk.event, offset: dusk.offsetMs, gap: dusk.gapMs, when: [...dusk.when] },
    { site: 203, event: 1, offset: 86400000n, gap: 9007199254740991n, when: [57, 0, 0, 0] });
  assert.equal(r.u16(), 0);
  assert.equal(r.u16(), 1); r.string(); assert.equal(r.u8(), 1);
  assert.deepEqual([...r.blob()], [58, 1, 0, 0]);
});

test('GFB5 validates Solar descriptor arguments, domains, policies, and predicate type', () => {
  const replacements = [
    ['201 dawn', '0 dawn', 'invalid schedule site'],
    ['37.5 127', '90.0001 127', 'invalid Solar latitude'],
    ['37.5 127', '37.5 -180.0001', 'invalid Solar longitude'],
    ['rise -60000', 'noon -60000', 'invalid Solar event'],
    ['rise -60000', 'rise 1.5', 'invalid Solar offset'],
    ['rise -60000', 'rise -86400001', 'invalid Solar offset'],
    ['pulse trusted_only', 'window trusted_only', 'unsupported Solar basis'],
    ['pulse trusted_only', 'pulse held', 'unsupported Solar clock policy'],
    ['1000 baseline skip', '0 baseline skip', 'invalid schedule gap'],
    ['1000 baseline skip', '9007199254740992 baseline skip', 'invalid schedule gap'],
    ['1000 baseline skip', '1000 catchup skip', 'unsupported Solar recovery'],
    ['1000 baseline skip', '1000 baseline run', 'unsupported Solar fallback'],
    ['baseline skip true', 'baseline skip 1', 'schedule predicate must be bool'],
  ];
  for (const [from, to, message] of replacements) {
    assert.throws(() => encode(scheduleModule({ declarations: pulse.replace(from, to) })),
      error => error instanceof CompileError && error.message === message, message);
  }
  assert.throws(() => encode(scheduleModule({ declarations: '(solar-pulse 1 too few)' })),
    error => error instanceof CompileError && error.message === 'solar-pulse expects 13 arguments');
  for (const timezone of ['Z'.repeat(129), '\ud800']) {
    assert.throws(() => encode(scheduleModule({ declarations: pulse.replace('Asia/Seoul', timezone) })),
      error => error instanceof CompileError && error.message === 'invalid Solar timezone');
  }
});

test('GFB5 enforces one temporal context but permits zero physical roots only without windows', () => {
  assert.throws(() => encode(scheduleModule().replace('(temporal-context __gf_now_ms __gf_time_epoch)', '')),
    error => error instanceof CompileError && error.message === 'temporal module requires one temporal-context');
  assert.throws(() => encode(scheduleModule().replace('(temporal-context __gf_now_ms __gf_time_epoch)', '(temporal-context __gf_time_epoch __gf_now_ms)')),
    error => error instanceof CompileError && error.message === 'invalid temporal clock input');
  const withoutRoot = mixedModule().replace('  (temporal-root 11 root root_present root_epoch root_id root_timestamp)\n', '');
  assert.throws(() => encode(withoutRoot), error => error instanceof CompileError && error.message === 'invalid temporal root count');
});

test('GFB5 rejects duplicate prelude identity across kinds and declarations after executable forms', () => {
  const duplicateSite = windowFromSchedule.replace('202 gated', '201 gated');
  const duplicateName = windowFromSchedule.replace('202 gated', '202 dawn');
  for (const [window, message] of [[duplicateSite, 'duplicate prelude site'], [duplicateName, 'duplicate prelude name']]) {
    assert.throws(() => encode(mixedModule({ declarations: `${pulse}\n${window}` })),
      error => error instanceof CompileError && error.message === message);
  }
  assert.throws(() => encode(scheduleModule({ declarations: `(intent early true)\n${pulse}` })),
    error => error instanceof CompileError && error.message === 'stateful prelude declarations must precede transitions and intents');

  const repeatedAcrossStrategies = `(module SharedDeclaration${clockInputs}
    (temporal-context __gf_now_ms __gf_time_epoch)
    (strategy a 0 (device true) ${pulse} (intent due (schedule-read 0 due)))
    (strategy b 1 (device true) ${pulse} (intent due (schedule-read 0 due))))`;
  assert.doesNotThrow(() => encode(repeatedAcrossStrategies));
});

test('GFB5 expressions expose only prior entries and typed projection fields', () => {
  const scheduleForward = pulse.replace('skip true)', 'skip (window-read 0 ok))');
  const windowForward = windowFromSchedule.replace('(schedule-read 0 due)', '(schedule-read 1 due)');
  const cases = [
    [scheduleModule({ declarations: scheduleForward }), 'temporal projection index'],
    [mixedModule({ declarations: `${pulse}\n${windowForward}` }), 'schedule projection index'],
    [scheduleModule({ tail: '(intent due (schedule-read 0 value))' }), 'schedule projection field'],
    [scheduleModule({ tail: '(intent due (schedule-read 0))' }), 'schedule-read expects slot and field'],
    [scheduleModule({ tail: '(intent due (schedule-read 1 due))' }), 'schedule projection index'],
    ['(module Plain (strategy main 0 (device true) (intent due (schedule-read 0 due))))', 'schedule-read requires GFB format 5'],
  ];
  for (const [source, message] of cases) assert.throws(() => encode(source),
    error => error instanceof CompileError && error.message === message, message);
});

test('GFB5 rejects raw forward-reference cycles in either heterogeneous order', () => {
  const scheduleFirst = `${pulse.replace('skip true)', 'skip (window-read 0 ok))')}\n${windowFromSchedule}`;
  const windowFirst = `${windowFromSchedule}\n${pulse.replace('skip true)', 'skip (window-read 0 ok))')}`;
  assert.throws(() => encode(mixedModule({ declarations: scheduleFirst })),
    error => error instanceof CompileError && error.message === 'temporal projection index');
  assert.throws(() => encode(mixedModule({ declarations: windowFirst })),
    error => error instanceof CompileError && error.message === 'schedule projection index');
});

test('GFB5 counts scalar state and all heterogeneous prelude entries against 128', () => {
  const states = count => Array.from({ length: count }, (_, index) => `(state s${index} bool false)`).join('\n');
  assert.doesNotThrow(() => encode(scheduleModule({ states: states(127) })));
  assert.throws(() => encode(scheduleModule({ states: states(128) })),
    error => error instanceof CompileError && error.message === 'temporal state limit exceeded');
});
