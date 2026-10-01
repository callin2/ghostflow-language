# Korean public holidays and farm work calendars

[한국어](CALENDAR-PROVIDERS.ko.md) | English · [Reference §3.8](reference/03-time-and-schedules.en.md#38-dst-midnight-and-work-calendars)

This guide describes the offline reference adapter in `runtimes/node/calendar.mjs`
and calendar decisions in the shared Rust core. Verification covers compiler
checks, native Rust unit tests, WASM execution and ghostsim; the same calendar
tape has not been executed through a native runner. It establishes no Device
deployment, human presence or physical operation.

## Decision and rationale

A public holiday is a public date fact; a farm day off is a work policy. A farm
may work on a holiday or close on a weekday for maintenance. Therefore
`HolidayCalendar`'s `holiday` reads membership in the holiday list alone.
`WorkCalendar`'s `workday`/`offday` follows date-specific work exceptions, holiday
work policy, then weekly pattern. A `work` exception on a holiday retains the
public holiday fact.

Editing a shared base would change other schedules and historical replay.
Instead, explicit base and overrides produce a new calendar ID and content-based
revision. Neither the base ID nor a lineage ID may be reused; the original stays
unchanged. Timezone must exactly match the base. Duplicate dates within one
overlay layer are rejected even when their contents agree. A subsequent layer
explicitly replaces the previous layer's decision for that date. Holiday and
work overrides are distinct layers and may apply to the same date.

## Reviewed Korean default data

`createKoreanHolidayCalendar` reads the repository's
[`kr-public-2026-2027.json`](../data/calendars/kr-public-2026-2027.json).
This finite dataset covers only `Asia/Seoul`, `[2026-01-01, 2028-01-01)`, reviewed
on 2026-10-01. Default expiry is 2028-01-01 00:00 KST. Callers may shorten it,
but cannot extend it. This does not guarantee unchanged law until that date.
When a temporary holiday, election or amendment is announced, operators review
official sources and install a new dataset/revision or sourced override.
There is no automatic synchronization.

Principal sources follow. Each JSON date identifies its source ID.

- [Ministry of Personnel Management holiday rules](https://www.mpm.go.kr/mpm/info/infoService/BizService02/): Sundays, holidays and limited substitution rules.
- [MPM amendment explanation, 2026-04-29](https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&category=&cntId=4250&mode=view&pageIdx=1): Labor Day, May 1, and Constitution Day, July 17, apply from 2026.
- [Korea Astronomy and Space Science Institute's 2026 calendar explanation](https://www.kasi.re.kr/kor/post/newsMaterial/32031): lunar holidays and existing substitute dates; this predates the amendment and is used with the amendment source.
- [Korea AeroSpace Administration's 2027 calendar explanation](https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431): 2027 holidays and substitute dates.
- [Ministry of the Interior and Safety local-election record, 2026-06-03](https://www.mois.go.kr/video/bbs/type019/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000255&nttId=126698&searchCode1=): the term-expiry local election date.

Sundays expand as public holiday facts only inside coverage. Saturday itself is
not a public holiday. For example, no substitute holiday is invented for
2026-09-28 or 2027-06-07. Official substitute dates including 2027-05-03 and
2027-07-19 are pinned facts. Future lunar, substitute or temporary dates are not
predicted.

Only date facts and citations are stored; government documents, PDF, HWPX,
images and explanatory prose are not copied. The KASA explanatory release
identifies KOGL Type 1 attribution. Separately licensed notice attachments are
not redistributed.

## Procedure for base and farm overrides

Run this Node example from the repository root. Bit 0 of `weeklyWorkMask` is
Sunday and bit 6 is Saturday, so `0b0111110` means Monday–Friday. The adapter
does not choose the farm's weekly pattern or holiday work policy.

```js
import {
  createKoreanHolidayCalendar, createWorkCalendar, composeCalendar,
} from './runtimes/node/calendar.mjs';

const nowMs = Date.parse('2026-10-01T00:00:00Z');
const publicBase = createKoreanHolidayCalendar({ calendarId: 'kr-public', nowMs });
const farmBase = createWorkCalendar({
  calendarId: 'farm-weekdays', base: publicBase,
  weeklyWorkMask: 0b0111110, holidayPolicy: 'off', nowMs,
});
const farm = composeCalendar(farmBase, {
  calendarId: 'farm-harvest', timezone: 'Asia/Seoul', nowMs,
  holidayOverrides: [],
  workdayOverrides: [
    { date: '2026-10-09', class: 'work', reason: 'Approved harvest shift' },
    { date: '2026-10-12', class: 'off', reason: 'Scheduled maintenance' },
  ],
});
console.log(publicBase.snapshot.calendarId, farm.snapshot.calendarId);
console.log(farm.provenance.lineage, farm.snapshot.revision);
```

To add/remove a public holiday, explicitly supply `{ date, holiday, reason,
source }` in `holidayOverrides`. `source` is a credential-free HTTPS evidence
URL. Use `holiday: true` for a newly announced government temporary holiday;
installers do not manufacture an unannounced date as a public fact. A work
exception requires its own reason. For another country or period,
`createHolidayCalendar` requires explicit timezone, coverage, expiry, date names
and source IDs, source URLs/publication/review dates, and datasetVersion.

The returned `{ snapshot, provenance }` and descendants are frozen. Revision is
SHA-256 over normalized snapshot contents, sources and lineage, independent of
input order. Coverage, expiry and provenance carry forward; composition cannot
widen coverage or refresh expired data. Handle `CalendarUnavailableError` codes
`missing-base` and `stale-base` separately. Invalid dates, timezones, conflicts,
sources and revisions are rejected.

## Installation binding and execution

Declare typed logical calendars in source and select them with Daily schedule
`on` and `calendar`. All common policies and DST choices remain explicit. Use the
[canonical executable example](../examples/korean-calendar.ghost.md), its
[English reading projection](../examples/korean-calendar.ghost.en.md), and
[host tape tool](../tools/examples/korean-calendar.mjs). The command below runs
the virtual host example without physical I/O.

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

A fresh checkout needs Rust/Cargo, Node.js and the WASM target. Cargo may fetch
locked dependencies during the build; add `--offline` only when they are cached.

```ghost
calendar public_days: HolidayCalendar;
calendar farm_days: WorkCalendar;

// Daily schedule fields; complete common policies are still required.
on = day`holiday`;
calendar = public_days;
```

1. Create the public base, apply explicit farm policy, then compose overrides.
2. Match installation provider bindings to each snapshot's calendar ID and timezone.
3. Supply an immutable clock, coverage, resolved civil occurrence rows and
   `envelope.snapshot` as context facts for the same tick. Retain provenance for installation/replay.
4. Rust executes day filtering, admission, gap/recovery and deduplication. The
   Node adapter is not a second engine deciding execution dates or due pulses.

Holiday Daily pulse is identified by `holiday-daily-pulse`, GFB15 and
`GhostFlow/control-v14`. Existing work/off-day tag/byte layout and GFSF5 facts
wire stay unchanged. Older loaders reject the new GFB header. These identifiers
are separate from package and Device firmware versions. This adapter does not
expand weekday-literal or general `calendar_is` expression implementation.
Issue #155's weekday grammar remains separate.

## Consistency, absence and storage bounds

Schedules sharing a provider binding use the same calendar snapshot in one
tick. Partial absence or different revisions/contents rejects the whole tick
without committing partial state. Reusing one calendar ID/revision with changed
contents is also rejected. New revisions are allowed, but previous contents
remain recorded after subsequent revisions. The core compares full snapshots
rather than trusting a SHA string.

GFCXv3 checkpoints preserve that history. The new core rejects v2; old
checkpoints are not implicitly migrated. At most `min(terminalCapacity, 128)`
accepted calendar snapshots and 8192 combined holiday/exception date cells are
retained. A new record or restore exceeding these bounds fails closed. Stored
payload is bounded to approximately 144 KiB excluding structures, allocations
and transaction clones. Hosts manage activation and durable-checkpoint lifetimes
within this finite retention bound.

Missing snapshots give `CalendarMissing`; outside coverage or at expiry they
give `CalendarOutOfRange`. `holiday`, `workday` and `offday` preserve Unknown
and `fallback = skip` creates no new admission. Unknown is not assumed to be a
nonholiday, workday or offday Boolean. Restored supply follows baseline recovery
without automatically replaying past occurrences.
