import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { createHolidayCalendar, composeCalendar, createWorkCalendar } from '../runtimes/node/calendar.mjs';
import { calendarPacket, exampleArtifact, exampleCalendars, profile, root } from '../tools/examples/korean-calendar.mjs';

execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm',
  '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
const wasm = readFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const compiled = await exampleArtifact();
const calendars = exampleCalendars();
const outputs = value => ({ public_holiday: value.public_holiday, farm_work: value.farm_work, farm_rest: value.farm_rest });
const none = { public_holiday: false, farm_work: false, farm_rest: false };

test('Rust HolidayDaily and farm classes execute independently from the same public facts', async t => {
  for (const [date, expected] of [
    ['2026-10-09', { public_holiday: true, farm_work: true, farm_rest: false }],
    ['2026-10-12', { public_holiday: false, farm_work: false, farm_rest: true }],
    ['2026-10-13', { public_holiday: false, farm_work: true, farm_rest: false }],
    ['2026-10-11', { public_holiday: true, farm_work: false, farm_rest: true }],
  ]) {
    const runtime = await ControlRuntime.instantiate(wasm, compiled, profile);
    t.after(() => runtime.dispose());
    assert.deepEqual(outputs(runtime.step(calendarPacket(compiled, calendars, date, 0, -1)).vm.safe), none);
    assert.deepEqual(outputs(runtime.step(calendarPacket(compiled, calendars, date, 1)).vm.safe), expected, date);
    assert.deepEqual(outputs(runtime.step(calendarPacket(compiled, calendars, date, 2)).vm.safe), none, 'same occurrence is terminal');
  }
});

test('an officially announced temporary holiday overlay executes without rewriting its base', async t => {
  const nowMs = Date.parse('2025-01-20T00:00:00Z');
  const source = 'https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&category=&cntId=4008&mode=view&pageIdx=1';
  // A narrow before-amendment fixture, not a complete 2025 public calendar.
  const base = createHolidayCalendar({ calendarId: 'before_announcement', timezone: 'Asia/Seoul',
    coveredFromDate: '2025-01-26', coveredToDateExclusive: '2025-01-29',
    expiresAtMs: Date.parse('2025-01-29T00:00:00+09:00'), holidays: [],
    sources: [{ id: 'mpm-temporary', url: source, publishedOn: '2025-01-14', reviewedOn: '2026-10-01' }],
    datasetVersion: 'temporary-holiday-fixture', nowMs });
  const publicDays = composeCalendar(base, { calendarId: 'public_days', timezone: 'Asia/Seoul', nowMs,
    holidayOverrides: [{ date: '2025-01-27', holiday: true,
      reason: 'MPM announcement designating January 27 as a temporary public holiday.', source }] });
  const farmDays = createWorkCalendar({ calendarId: 'farm_days', base: publicDays,
    weeklyWorkMask: 127, holidayPolicy: 'off', nowMs });
  const runtime = await ControlRuntime.instantiate(wasm, compiled, profile);
  t.after(() => runtime.dispose());
  const derived = { publicDays, farmDays };
  runtime.step(calendarPacket(compiled, derived, '2025-01-27', 0, -1));
  assert.deepEqual(outputs(runtime.step(calendarPacket(compiled, derived, '2025-01-27', 1)).vm.safe),
    { public_holiday: true, farm_work: false, farm_rest: true });
  assert.deepEqual(base.snapshot.holidays, []);
  assert.notEqual(publicDays.snapshot.revision, base.snapshot.revision);
});

test('missing and expired calendars skip with conservative evidence instead of farm guesses', async t => {
  for (const invalid of [
    { publicDays: null, farmDays: null },
    Object.fromEntries(['publicDays', 'farmDays'].map(key => [key, { snapshot: {
      ...calendars[key].snapshot, expiresAtMs: Date.parse('2026-10-08T21:00:00Z'),
    } }])),
  ]) {
    const runtime = await ControlRuntime.instantiate(wasm, compiled, profile);
    t.after(() => runtime.dispose());
    runtime.step(calendarPacket(compiled, invalid, '2026-10-09', 0, -1));
    const result = runtime.step(calendarPacket(compiled, invalid, '2026-10-09', 1));
    assert.deepEqual(outputs(result.vm.safe), none);
    // Rust preserves a terminal diagnostic rather than fabricating false facts.
    const expectedFault = invalid.publicDays === null ? 'CalendarMissing' : 'CalendarOutOfRange';
    assert.deepEqual(result.vm.contextTrace.map(row => ({ site: row.site, decision: row.decision })),
      compiled.manifest.schedules.map(schedule => ({ site: schedule.site, decision: `Unknown(${expectedFault})` })));
  }
});

test('calendar checkpoint restores dedupe and rejects rewritten snapshot contents', async t => {
  const original = await ControlRuntime.instantiate(wasm, compiled, profile);
  const restored = await ControlRuntime.instantiate(wasm, compiled, profile);
  t.after(() => { original.dispose(); restored.dispose(); });
  original.step(calendarPacket(compiled, calendars, '2026-10-09', 0, -1));
  assert.deepEqual(outputs(original.step(calendarPacket(compiled, calendars, '2026-10-09', 1)).vm.safe),
    { public_holiday: true, farm_work: true, farm_rest: false });
  const saved = original.contextSnapshot().bytes;
  assert.equal(saved[4], 3, 'GFCX v3 persists calendar revision history');
  restored.restoreContextCheckpoint(saved);
  restored.step(calendarPacket(compiled, calendars, '2026-10-09', 0, -1));
  assert.deepEqual(outputs(restored.step(calendarPacket(compiled, calendars, '2026-10-09', 1)).vm.safe), none);
  const changed = { ...calendars, publicDays: { snapshot: { ...calendars.publicDays.snapshot, holidays: [] } } };
  assert.throws(() => restored.step(calendarPacket(compiled, changed, '2026-10-09', 2)), /calendar|context|invalid/i);
  const old = saved.slice(); old[4] = 2;
  assert.throws(() => restored.restoreContextCheckpoint(old), /checkpoint|restore|invalid/i);
});

test('Rust loader rejects Holiday tag downgrade and featureless GFB15 headers', async t => {
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  const downgraded = Buffer.from(compiled.bytes); downgraded.writeUInt16LE(11, 4);
  assert.throws(() => runtime.load(downgraded), /load|format|invalid/i);
  const old = await compileSource('control Old { output value: Bool; value <- true; }');
  const claimed = Buffer.from(old.bytes); claimed.writeUInt16LE(15, 4);
  assert.throws(() => runtime.load(claimed), /load|format|invalid/i);
});

test('ghostsim CLI replays explicit calendar facts with the same virtual intent oracle', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'ghostflow-calendar-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifact = resolve(directory, 'calendar.gfb');
  const scenario = resolve(directory, 'calendar.toon');
  writeArtifact(compiled, artifact);
  writeFileSync(scenario, encode({ format: 'GhostFlow/scenario-v1', id: 'korean-calendar',
    initialInputs: [], keyBindings: [], context: profile.context,
    actions: [-1, 0, 0].map((offset, index) => ({ kind: 'scan', atMs: index,
      contextFacts: calendarPacket(compiled, calendars, '2026-10-09', index, offset).contextFacts })),
  }));
  const result = JSON.parse(execFileSync(process.execPath,
    [resolve(root, 'tools/ghostsim.mjs'), artifact, scenario, '--format', 'json'],
    { cwd: root, encoding: 'utf8' }));
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.scans.map(scan => outputs(scan.safeVirtualIntent)),
    [none, { public_holiday: true, farm_work: true, farm_rest: false }, none]);
  assert.equal(result.artifact.bytecodeSha256, compiled.manifest.bytecodeSha256);
});
