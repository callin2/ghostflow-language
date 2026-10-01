# Solar schedules: compiler and simulation host

This guide describes the older standalone Solar profile. For Solar sharing live
typed config Results and Rust-owned context admission, use
[Solar/config execution](SOLAR-CONFIG-EXECUTION.md). The current Reference's
explicit common policies and bounded hold/fixed-time fallback rules supersede
the original v3 slice described below; see [Reference §3.5](reference/03-time-and-schedules.en.md#35-common-schedule-semantics).
The standalone profile remains for concrete existing consumers; it is not a
fallback for the shared-context profile.

`Solar` is a host-supplied occurrence descriptor.  The compiler only emits its
typed `.due` Boolean input; it does not calculate an astronomical event or
operate an output.

The complete canonical source is
[solar-watering.ghost.md](../examples/solar-watering.ghost.md): intent, explicit
test location, rise+30min/set−30min and two five-minute valve groups in one document.
The `at` field reads, for example, `` at = sun`rise + 30min`; ``.

Every Solar schedule requires exactly one `timezone`, `latitude`, `longitude`,
`at`, and `fallback` field. `timezone` is a supported IANA timezone string. Coordinates are
finite signed numeric literals within latitude `-90..90` and longitude
`-180..180`; expressions and configuration references are not accepted.

`at` is confined to Solar declarations and has only these forms:

- `` sun`rise` `` or `` sun`set` ``
- Either event with `+` or `-`, e.g. `` sun`rise + 30min` `` or `` sun`set - 30min` ``.

`Nunit` is a whole-number `ms`, `s`, `min`, or `h` literal. Its signed offset
is exact, may be zero, and has magnitude at most 24 hours. Tagged literals,
interpolation, and arbitrary expressions are not part of the general GhostFlow
expression grammar.

`fallback = skip` is required and is presently the only fallback policy. When
the host does not trust or does not have the requested solar event, it supplies
no new `.due` occurrence. Existing relative timers continue independently.

Any control containing Solar has manifest format `GhostFlow/control-v3`. Its
descriptor is `{ kind: "solar", name, timezone, latitude, longitude, event,
offsetMs, fallback: "skip", dueInput }`. Existing `DailySlots` descriptors
remain unchanged, including in a mixed v3 manifest. This original compiler slice
rejected Solar and operating-setting metadata together; the newer GFB16 shared
context profile supports that composition without folding settings to constants. Controls
without Solar retain their v1/v2 manifest behavior.

## Simulation host

`SolarSchedule` in `runtimes/wasm/schedule.mjs` implements the same
`poll({nowMs, wallMs, trusted}) → {due, reason?, occurrence?}` host boundary as
DailySlots. `preview(wallMs)` reports the event's local date, `eventWallMs`,
`scheduledWallMs`, and calculation identity. Preview never consumes an event.

`ghostflow_core::solar` provides the matching bounded portable native provider
for a device worker: `ClockSnapshot`, `SolarDescriptor`, and `SolarSchedule`.
It accepts only `Asia/Seoul`, `UTC`, and `Etc/UTC` today; other IANA zones are
explicitly rejected rather than given an invented DST rule. A missing `wall_ms`
is always untrusted and cannot create a synthetic current-time sample. Its
polling reasons retain the baseline, recovery, rollback, and gap behavior
described below; an admitted occurrence is returned in `SolarPoll.occurrence`.
The calculation port and its retained upstream license are documented in
[SUNCALC-ATTRIBUTION.md](SUNCALC-ATTRIBUTION.md).

The pinned [SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2)
provider calculates sea-level sunrise/sunset (upper limb, standard refraction).
Supported event dates are 2000–2100. Adjacent UTC solar days are resolved to the
explicit IANA local date before applying the exact offset. If an unusual civil
date contains more than one matching event, the first is selected. Terrain,
observer elevation and observed weather are not inputs in this version.

An occurrence crosses `(previousWall, currentWall]`, is emitted at the first
logical scan after the crossing, and is not queued. A high-water mark suppresses
duplicates after wall-clock rollback. The first trusted sample at boot/recovery
establishes a baseline, with no catch-up. A wall or monotonic gap greater than
60 seconds skips missed starts. Acceleration must preserve logical scans; it
does not jump across them. Starting playback just before an event exercises the
same path. Re-creating the host establishes a new baseline, not a persistent
pending event queue.

`fallback = skip` means no new admission for untrusted time, unsupported dates,
or polar day/night without the requested event. It does not stop an already
admitted run: the example's five-minute elapsed timers use the monotonic clock.
No network or machine-clock reads occur in the host. Real-time clock trust and
time synchronization are the device driver's responsibility.

Consumers opt into v3 with `ControlRuntime.instantiateFramed(wasm, artifact,
{acceptSolar: true})`. The existing strict default rejects v3. The Rust VM,
GFB ABI, DI/RO inputs/outputs, elapsed timers and final constraints are unchanged.
Solar due inputs have source-observation bindings to their literate declaration;
the canonical document revision also identifies the coordinates/offset, which
are manifest data and can change without changing GFB bytecode.

## Verification

`npm test` includes compiler/source-location cases, host fallback/DST/date-line
tests and actual framed WASM five-minute output traces. The independent
[USNO reference](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-14&coords=37.5665%2C126.978&tz=9)
for Seoul test coordinates on 2026-09-14 reports rise 06:13, set 18:42 (UTC+9,
minute resolution). Tests allow 90 seconds for provider/rounding differences.
This implements the browser/host driver. The ESP32 solar-time driver remains
separate work; no device operations are performed by these tests.

The broader [time and Schedule contract proposal](TIME-AND-SCHEDULE-CONTRACT.md)
records the next-version DateTime, work-calendar, tidal and fallback boundaries.
Its proposed general timezone/DST profile is not implemented by this bounded
native provider. The 60-second gap above is missed-occurrence suppression, not
permission to operate from stale civil time after synchronization is lost.
