import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { isExecutablePulseSchedule, parseControl } from '../tools/control.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const program = (selector = 'holiday', type = 'HolidayCalendar') => `control CalendarExecution {
  calendar calendar_days: ${type};
  schedule morning: Daily {
    timezone = "Asia/Seoul";
    at = time\`06:00\`;
    on = day\`${selector}\`;
    calendar = calendar_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output due: Bool;
  due <- morning.due;
}`;

test('Holiday Daily canonical compilation selects a distinct versioned execution profile', async () => {
  const result = await compileSource(program());
  assert.equal(result.bytes.readUInt16LE(4), 15);
  assert.equal(result.manifest.format, 'GhostFlow/control-v14');
  assert.deepEqual(result.manifest.calendars, [{ name: 'calendar_days', type: 'HolidayCalendar' }]);
  assert.deepEqual(result.manifest.schedules[0].day, { kind: 'holiday', calendar: 'calendar_days' });
  assert.equal(isExecutablePulseSchedule(parseControl(program()).body.find(item => item.kind === 'schedule')), true);
  for (const selector of ['workday', 'offday']) {
    const legacy = await compileSource(program(selector, 'WorkCalendar'));
    assert.equal(legacy.bytes.readUInt16LE(4), 11);
    assert.equal(legacy.manifest.format, 'GhostFlow/control-v10');
  }
});

test('Calendar selectors retain typed bindings and missing-reference diagnostics', async () => {
  for (const [source, diagnostic] of [
    [program('holiday', 'WorkCalendar'), /holiday requires HolidayCalendar/],
    [program('workday'), /workday requires WorkCalendar/],
    [program().replace('calendar = calendar_days;', 'calendar = absent;'), /unknown calendar absent/],
    [program().replace('calendar = calendar_days;', ''), /requires calendar/],
    [program('mon..fri'), /currently requires holiday, workday or offday/],
  ]) await assert.rejects(() => compileSource(source), diagnostic);
});

test('Holiday and farm working-day schedules share context execution, while At remains isolated', async () => {
  const workProgram = program('workday', 'WorkCalendar');
  const workSchedule = workProgram
    .slice(workProgram.indexOf('  schedule'), workProgram.indexOf('  output'))
    .replace('schedule morning:', 'schedule farm_start:').replace('calendar = calendar_days;', 'calendar = farm_days;');
  const source = program().replace('  output due:', `  calendar farm_days: WorkCalendar;\n${workSchedule}  output due:`);
  const mixed = await compileSource(source);
  assert.equal(mixed.bytes.readUInt16LE(4), 15);
  assert.deepEqual(mixed.manifest.schedules.map(item => item.day.kind), ['holiday', 'workday']);
  const atSchedule = `schedule one_shot: At {
    at = datetime\`2026-10-01T00:00:00Z\`;
    basis = pulse; when = true; clock = trusted_only;
    gap = skip_after(60s); recovery = baseline; fallback = skip;
  }`;
  await assert.rejects(() => compileSource(program().replace('  output due:', `${atSchedule}\n  output due:`)),
    /At pulse execution cannot mix/);
});

test('Holiday tag cannot masquerade as the existing WorkCalendar selector', () => {
  const source = `(module CalendarSelector (version 1)
    (input __gf_now_ms number) (input __gf_time_epoch number)
    (temporal-context __gf_now_ms __gf_time_epoch)
    (strategy control 0 (device true)
      (calendar-daily-pulse 1 morning 60000 Asia/Seoul 21600000 calendar_days holiday skip first true false)
      (intent due true)))`;
  assert.throws(() => compile(parse(tokenize(source))), /invalid WorkCalendar selector/);
});

test('Holiday context rejects unavailable legacy civil and Solar execution mixtures at compilation', async () => {
  const policy = `basis = pulse; when = true; clock = trusted_only;
    gap = skip_after(60s); recovery = baseline; fallback = skip;`;
  const civil = `timezone = "Asia/Seoul"; dst_missing = skip; dst_repeated = first;`;
  for (const legacy of [
    `schedule extra: Daily { ${civil} at = time\`07:00\`; ${policy} }`,
    `schedule extra: DailySlots<15min> { ${civil} selected = [07:00]; ${policy} }`,
    `schedule extra: Solar { timezone = "Asia/Seoul"; latitude = 37.5665;
      longitude = 126.9780; at = sun\`rise + 30min\`; ${policy} }`,
  ]) {
    await compileSource(`control Legacy { ${legacy} output due: Bool; due <- extra.due; }`);
    await assert.rejects(() => compileSource(program().replace('  output due:', `${legacy}\n  output due:`)),
      /Holiday Daily cannot mix with legacy Solar or non-calendar Daily\/DailySlots execution/);
  }
});

test('Host rejects Holiday manifest downgrade, wrong calendar types and missing bindings before WASM instantiation', async () => {
  const result = await compileSource(program());
  for (const mutate of [
    manifest => { manifest.format = 'GhostFlow/control-v10'; },
    manifest => { manifest.calendars[0].type = 'WorkCalendar'; },
    manifest => { manifest.calendars = []; },
    manifest => { manifest.schedules[0].day.kind = 'workday'; },
  ]) {
    const manifest = structuredClone(result.manifest);
    mutate(manifest);
    await assert.rejects(() => ControlRuntime.instantiate(new Uint8Array([0]), { ...result, manifest }),
      /matching GFB format|wrong-type Daily calendar|Holiday profile requires Holiday Daily/);
  }
});
