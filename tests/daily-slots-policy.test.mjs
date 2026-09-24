import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)))
  .cases.find(entry => entry.id === 'REF-03-032');
const code = extractLiterate(fixture.source, { filename: fixture.filename }).code;
const check = source => typeCheckControl(source, { filename: fixture.filename });
const dailyFixture = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)))
  .cases.find(entry => entry.id === 'REF-03-024');
const dailyCode = extractLiterate(dailyFixture.source, { filename: dailyFixture.filename }).code;

test('Daily type checking preserves exact local time and common pulse policy', () => {
  const checked = typeCheckControl(dailyCode, { filename: dailyFixture.filename });
  const site = checked.sourceMap.find(node => node.kind === 'schedule').id;
  assert.deepEqual(checked.manifest.schedules, [{
    kind: 'daily', site, name: 'morning', timezone: 'Asia/Seoul', atMs: 23_400_000,
    dstMissing: 'skip', dstRepeated: 'first',
    policy: { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 60_000, recovery: 'baseline', fallback: 'skip' },
  }]);
});

test('Daily emits executable GFB8 without changing its descriptor contract', async () => {
  const control = compileControl(dailyCode);
  assert.equal(control.manifest.format, 'GhostFlow/control-v7');
  assert.equal(new DataView(control.bytes.buffer, control.bytes.byteOffset, control.bytes.byteLength).getUint16(4, true), 8);
  const compiled = await compileSource(dailyFixture.source, { filename: dailyFixture.filename });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v7');
  assert.deepEqual(compiled.manifest.schedules, typeCheckControl(dailyCode).manifest.schedules);
});

test('Daily retains midnight and the last millisecond without applying a slot grid', () => {
  for (const [literal, atMs] of [['00:00', 0], ['23:59:59.999', 86_399_999]]) {
    const checked = typeCheckControl(dailyCode.replace('time`06:30`', `time\`${literal}\``));
    assert.equal(checked.manifest.schedules[0].atMs, atMs);
  }
});

for (const [label, before, after, diagnostic] of [
  ['missing at', 'at = time`06:30`;', '', /requires at/],
  ['missing timezone', 'timezone = "Asia/Seoul";', '', /requires timezone/],
  ['missing basis', 'basis = pulse;', '', /requires basis/],
  ['duplicate at', 'at = time`06:30`;', 'at = time`06:30`; at = time`07:00`;', /duplicate Daily option at/],
  ['duplicate policy', 'when = true;', 'when = true; when = false;', /duplicate Daily option when/],
  ['Duration at', 'time`06:30`', '30min', /constant TimeOfDay/],
  ['DateTime at', 'time`06:30`', 'datetime`2026-09-23T06:30:00Z`', /constant TimeOfDay/],
  ['invalid time', 'time`06:30`', 'time`24:00`', /out of range/],
  ['non-Bool condition', 'when = true', 'when = 1', /when must be Bool/],
  ['invalid timezone', 'Asia/Seoul', 'Invalid/Zone', /IANA timezone/],
]) test(`Daily policy rejects ${label}`, () => assert.throws(() => typeCheckControl(dailyCode.replace(before, after)), diagnostic));

test('DailySlots type checking preserves explicit pulse policy and its declaration identity', () => {
  const checked = check(code);
  const site = checked.sourceMap.find(node => node.kind === 'schedule').id;
  assert.deepEqual(checked.manifest.schedules, [{
    kind: 'daily-slots', site, name: 'starts', timezone: 'Asia/Seoul',
    gridMs: 900_000, slots: [0, 375, 1425],
    dstMissing: 'skip', dstRepeated: 'first',
    policy: { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 60_000, recovery: 'baseline', fallback: 'skip' },
  }]);
});

test('literal DailySlots emits GFB9 and config-selected slots emit GFB11', async t => {
  const control = compileControl(code);
  assert.equal(control.manifest.format, 'GhostFlow/control-v8');
  assert.equal(new DataView(control.bytes.buffer, control.bytes.byteOffset, control.bytes.byteLength).getUint16(4, true), 9);
  const compiled = await compileSource(fixture.source, { filename: fixture.filename });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v8');

  const configurable = code.replace('selected = [00:00, 06:15, 23:45];', 'selected = watering_slots;')
    .replace('control DailySlotsValid {', 'control DailySlotsValid { config watering_slots: TimeSlots<15min, 8> = [time`06:15`];');
  const configured = compileControl(configurable);
  assert.equal(configured.manifest.format, 'GhostFlow/control-v10');
  assert.equal(configured.manifest.schedules[0].selectedConfig, 'watering_slots');
  assert.equal(new DataView(configured.bytes.buffer, configured.bytes.byteOffset, configured.bytes.byteLength).getUint16(4, true), 11);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(configured.bytes);
  for (const output of configured.manifest.outputs) {
    runtime.addCapability('actuator', output.name,
      output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
  }
  runtime.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [] });

  const mixed = code.replace('output due: Bool;', `schedule morning: Daily {
    timezone = "Asia/Seoul"; at = time\`06:30\`; dst_missing = skip; dst_repeated = first;
    basis = pulse; when = true; clock = trusted_only; gap = skip_after(60s);
    recovery = baseline; fallback = skip;
  } output due: Bool;`);
  assert.throws(() => compileControl(mixed), /mixed DailySlots schedule kinds are not executable/);
});

test('DailySlots retains the authored predicate, DST choices and exact gap boundary', () => {
  const checked = check(code.replace('control DailySlotsValid {', 'control DailySlotsValid { input allow: Bool;')
    .replace('when = true;', 'when = allow;').replace('60s', '9007199254740991ms')
    .replace('dst_missing = skip;', 'dst_missing = next_valid;').replace('dst_repeated = first;', 'dst_repeated = both;')
    .replace('[00:00, 06:15, 23:45]', '[23:45, 00:00, 06:15]'));
  const schedule = checked.manifest.schedules[0];
  assert.equal(schedule.policy.when, 'input.allow');
  assert.equal(schedule.policy.gapMs, Number.MAX_SAFE_INTEGER);
  assert.equal(schedule.dstMissing, 'next_valid');
  assert.equal(schedule.dstRepeated, 'both');
  assert.deepEqual(schedule.slots, [0, 375, 1425]);
  assert.equal('dueInput' in schedule, false);
});

for (const field of ['dst_missing', 'dst_repeated', 'basis', 'when', 'clock', 'gap', 'recovery', 'fallback']) {
  test(`DailySlots requires explicit ${field} in a policy declaration`, () => {
    assert.throws(() => check(code.replace(new RegExp(`\\s+${field} = [^;]+;`), '')), new RegExp(`requires ${field}`));
  });
  test(`DailySlots rejects a duplicate ${field} at the second field`, () => {
    const declaration = code.match(new RegExp(`${field} = [^;]+;`))[0];
    assert.throws(() => check(code.replace(declaration, `${declaration}\n${declaration}`)), new RegExp(`duplicate DailySlots option ${field}`));
  });
}

for (const [label, before, after, diagnostic] of [
  ['invalid IANA zone', 'Asia/Seoul', 'Unknown/Zone', /IANA timezone/],
  ['duplicate slot', '06:15', '00:00', /duplicate schedule slot/],
  ['off-grid slot', '06:15', '06:14', /15-minute/],
  ['day boundary', '23:45', '24:00', /15-minute/],
  ['non-Bool predicate', 'when = true', 'when = 1', /when must be Bool/],
  ['unknown predicate', 'when = true', 'when = missing', /unknown/],
  ['zero gap', '60s', '0ms', /positive constant Duration/],
  ['untyped gap', '60s', '60', /positive constant Duration/],
  ['extra gap argument', 'skip_after(60s)', 'skip_after(60s, 1s)', /skip_after/],
  ['wrong gap call', 'skip_after(60s)', 'retry(60s)', /skip_after/],
  ['DST omission policy', 'dst_missing = skip', 'dst_missing = first', /dst_missing must be/],
  ['DST repetition policy', 'dst_repeated = first', 'dst_repeated = next_valid', /dst_repeated must be/],
  ['implicit recovery catchup', 'recovery = baseline', 'recovery = catchup', /recovery must be baseline/],
  ['fixed fallback on DailySlots', 'fallback = skip', 'fallback = fixed_time(time`06:00`, terminal: skip)', /fallback must be skip/],
]) test(`DailySlots policy rejects ${label}`, () => assert.throws(() => check(code.replace(before, after)), diagnostic));
