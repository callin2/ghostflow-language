// Reference host: finite calendar composition and explicit civil evidence.
// Day classification, crossing, dedupe and checkpoint recovery run in Rust.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileSource } from '../compile-source.mjs';
import { ControlRuntime } from '../../runtimes/wasm/control-runtime.mjs';
import { calendarEpochDay, createKoreanHolidayCalendar, createWorkCalendar,
  composeCalendar } from '../../runtimes/node/calendar.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const profile = { context: { bootEpoch: 7, terminalCapacity: 16, bindings: [
  calendarBinding('public_days'), calendarBinding('farm_days'),
] } };

function calendarBinding(provider) {
  return { kind: 'calendar', provider, namespace: 'calendar-example', station: 'virtual-farm',
    bindingRevision: 'calendar-example-v1', location: 'virtual-farm', timezone: 'Asia/Seoul',
    criteria: 'calendar', maxUncertaintyMs: 0 };
}

export function exampleCalendars(nowMs = Date.parse('2026-10-01T00:00:00Z')) {
  const publicDays = createKoreanHolidayCalendar({ calendarId: 'public_days', nowMs });
  const farmBase = createWorkCalendar({ calendarId: 'farm_base', base: publicDays,
    weeklyWorkMask: 0b0111110, holidayPolicy: 'off', nowMs });
  const farmDays = composeCalendar(farmBase, { calendarId: 'farm_days', timezone: 'Asia/Seoul', nowMs,
    workdayOverrides: [
      { date: '2026-10-09', class: 'work', reason: 'Harvest crew works on Hangeul Day.' },
      { date: '2026-10-12', class: 'off', reason: 'Farm rest after the harvest.' },
    ] });
  return { publicDays, farmBase, farmDays };
}

export async function exampleArtifact() {
  const filename = resolve(root, 'examples/korean-calendar.ghost.md');
  return compileSource(readFileSync(filename, 'utf8'), { filename });
}

// Korea has no civil DST transition in the pinned years. This supplies the
// explicit 06:00 +09:00 instant; it never decides which schedule is due.
export function calendarPacket(compiled, calendars, date, monotonicMs, offsetMs = 0) {
  const planned = Date.parse(`${date}T06:00:00+09:00`);
  const snapshots = { public_days: calendars.publicDays?.snapshot ?? null,
    farm_days: calendars.farmDays?.snapshot ?? null };
  return { nowMs: monotonicMs, contextFacts: {
    clock: { monotonicMs, bootEpoch: 7, wallMs: planned + offsetMs, uncertaintyMs: 0,
      trusted: true, unknownReason: null, sourceRevision: 'calendar-example-clock-v1' },
    natural: [], settings: null,
    schedules: compiled.manifest.schedules.map(schedule => ({
      site: schedule.site, coverageStartMs: planned - 2, coverageEndMs: planned + 2,
      provider: null, calendar: snapshots[schedule.day.calendar],
      rows: [{ sourceDay: calendarEpochDay(date), slotKey: 0, minuteOfDay: 360, fold: 0,
        eventId: '', eventKind: 'civil', instantMs: planned, withdrawn: false,
        providerRevision: 'calendar-example-civil-v1', contextRevision: 'calendar-example-timezone-v1' }],
    })),
  } };
}

async function main() {
  const compiled = await exampleArtifact();
  const wasmBytes = readFileSync(resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  const calendars = exampleCalendars();
  for (const date of ['2026-10-09', '2026-10-12']) {
    const runtime = await ControlRuntime.instantiate(wasmBytes, compiled, profile);
    try {
      runtime.step(calendarPacket(compiled, calendars, date, 0, -1));
      const crossing = runtime.step(calendarPacket(compiled, calendars, date, 1)).vm.safe;
      const repeated = runtime.step(calendarPacket(compiled, calendars, date, 2)).vm.safe;
      console.log(JSON.stringify({ date, crossing, repeated }));
    } finally { runtime.dispose(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
