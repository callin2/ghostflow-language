# Time and Schedule contract proposal

Tracking: language issue #23 / integration `TASK-85.2` / reviews R15–R17.

This is the minimum coherent design handoff for DateTime, monotonic elapsed
time, recurring schedules, solar/tidal events, work calendars and explicit
fallback. It is not a general temporal framework and does not claim that every
surface form below is implemented. `Duration`, elapsed timers, `DailySlots` and
the bounded Solar host already exist; the remaining types and policies are
proposals for T2–T4 and joint review.

## Confirmed product meaning

- Control values and outputs form time-varying signals, but source stays readable
  as names, expressions, explicit old/next state and output connections. Users do
  not write subscription/operator plumbing.
- A `Schedule` is continuously evaluated. It is not a delayed function call or
  a background thread. A missed decision is not silently queued for later.
- Calendar time and monotonic elapsed time are different clock domains. Wall-clock
  correction never rewinds or extends an already admitted elapsed timer.
- Solar and lunar/tidal control requires current time plus installation context.
  Missing, untrusted or stale context is `Unknown`, not `false`.
- A natural-time rule has an explicit fallback. No NTP-disconnection grace,
  catch-up, late start, pause, retry or restart policy is inferred.
- A confirmed common premise may become explicit source/policy, but discovering
  and confirming tacit knowledge belongs to authoring/review workflow rather than
  language execution semantics.

## Current implementation boundary

- `Duration` syntax is a non-negative whole number of milliseconds expressed
  with `ms`, `s`, `min` or `h`. The current control literal path does not yet
  enforce the safe-integer maximum, while the standalone constraints dialect
  uses a positive `i32` bound. Those are implementation gaps, not two base
  Duration types.
- `timer x = elapsed(flag)` uses generated monotonic `__gf_now_ms` input and
  commits timer state together with the successful control tick.
- `DailySlots<15min>` and `Solar` are host-owned occurrence providers exposed to
  source as one-scan `.due` Boolean inputs. They do not operate outputs.
- Solar requires timezone, literal coordinates, rise/set plus an exact offset,
  and `fallback = skip`. The current native provider supports a bounded timezone
  and year profile; unsupported context fails closed.
- Existing providers establish a baseline after boot/recovery, suppress duplicate
  events across wall-clock rollback and skip large forward wall gaps. Solar also
  checks the monotonic scan gap; `DailySlots` v1 does not. Their current 60-second
  bounds are compatibility behavior, not a universal hidden default for the new
  Schedule contract.
- Browser Solar accepts the platform's IANA zones while the current portable Rust
  provider supports only `Asia/Seoul`, `UTC` and `Etc/UTC`. A package may claim
  only their explicitly shared profile until both consumers pass the same zone
  vectors; compiler acceptance alone is not cross-host support.

See [SOLAR-SCHEDULE.md](SOLAR-SCHEDULE.md) for implemented behavior. This proposal
preserves those artifacts and requires explicit versioning for later semantics.

## Value and clock domains

| Domain | Minimum contract | Notes |
| --- | --- | --- |
| `Duration` | exact non-negative integer milliseconds, `0..2^53-1` | relative length; checked arithmetic; no month/year unit |
| `Date` | Gregorian date, years `1970..9999` | no time or timezone |
| `TimeOfDay` | `00:00:00.000..23:59:59.999` | no date, offset or recurrence |
| `DateTime` | exact UTC instant at millisecond resolution, Unix epoch through `9999-12-31T23:59:59.999Z` | literal requires `Z` or numeric UTC offset; the value carries no IANA zone |
| monotonic instant | host-only exact non-negative milliseconds plus boot/run epoch | never formatted as civil time or authored as a wall-clock literal |

The common exact transport bound is JavaScript's safe integer range. `DateTime`
instants in the declared civil range fit it. Leap-second `:60`, `24:00`, an
offset-free DateTime literal and nonexistent dates are diagnostics. An IANA
timezone belongs to a recurring Schedule/context, not to a DateTime instant.
Constructs that semantically require a positive delay may reject zero without
changing the base `Duration` range. T2 must apply the exact range consistently
to control literals, constraints, manifest values and native/WASM exchange.

Minimum arithmetic is deliberately small:

- `DateTime ± Duration -> DateTime`, with checked range.
- `Duration + Duration` and non-negative checked subtraction.
- DateTime and TimeOfDay comparisons require matching types.
- `TimeOfDay + Duration` does not wrap at midnight; resolve it with a Date and
  timezone in a Schedule.
- `DateTime - DateTime` is not in the minimum profile because `Duration` is
  non-negative. Compare instants or use monotonic `elapsed`; add a signed delta
  type only when a demonstrated control case needs it.
- Calendar days/months/years are not fixed millisecond Durations.

The recommended source-literal boundary remains the tagged-template candidate:
`date\`2026-09-15\``, `time\`06:30\`` and
`datetime\`2026-09-15T06:30:00+09:00\``. R15 reviews these spellings; they are
not runtime string parsing.

## Clock snapshot and responsibility

One accepted scan receives one immutable host snapshot:

```text
ClockSnapshot {
  monotonicMs
  bootEpoch
  wallMs?              // exact DateTime instant
  wallQuality          // Trusted | Unknown(reason)
  uncertaintyMs?
  sourceRevision?
}
```

The Driver obtains NTP/RTC/platform time and determines trust. The compiler/VM
does not open a network connection or read a machine clock. `wallMs` without a
trusted quality is not usable calendar time. Monotonic regression rejects the
scan. Wall-clock forward/backward correction is accepted as a new observation,
but occurrence high-water and identity prevent duplicates.

Any permission to keep using the last trusted wall time is an explicit policy,
conceptually `hold_last for Duration then <fallback>`, measured by monotonic time.
It is not enabled by this document. R17 decides whether to expose it; `skip`
remains the only required minimum fallback.

## Schedule is a typed reactive value

The compact conceptual shape is:

```text
Schedule = {
  trigger: TriggerRule,
  day: DayRule?,
  when: BoolPredicate?,
  basis: Pulse | Window(Duration) | Run(Duration, LateStartPolicy),
  timezone: IanaZone,
  context: installation bindings,
  fallback: Fallback,
  dst: DstPolicy,
  gap: ObservationGapPolicy
}
```

This is a product type with one duration-basis variant, not
`Cron | Window | Run` as three equivalent kinds. Trigger rules include one
DateTime, daily TimeOfDay, named five-field Cron, and each solar/tidal event.
The stored value describes a stream; reading it does not start equipment.
`when` is a statically compiled dependency expression over declared inputs/state,
not a runtime closure or callback. Global output constraints remain a later,
separate stage and can still block an admitted Run's requested output.

At every scan, resolution yields `True`, `False` or `Unknown(reason)` plus the
rule/context revisions. Fallback resolves `Unknown`; negation never turns it
into operating permission. Public projections remain ordinary control values:

- `.due` is true for one accepted scan when one occurrence is admitted.
- a Window may expose a level that is true only while the half-open window and
  all current predicates are true.
- a Run's execution state and `.active` are lowered to explicit state/timers;
  they are not a hidden asynchronous task.

The minimum executable boundary carries one atomic sidecar observation with the
generated `.due` input:

```text
ScheduleObservation {
  format: GhostFlow/schedule-observation-v1
  scheduleId             // stable declaration/source-map identity
  definitionRevision     // exact loaded code/package revision
  decision: False | Due | Unknown(reason)
  disposition?           // Before | PredicateFalse | AlreadyAdmitted | Missed(reason)
  occurrence? { id, sourceKey, plannedWallMs, sourceDate?, scheduledLocalDate }
  providerRevision?
  contextRevisions
}
```

Initial Unknown reasons are `ClockUnknown`, `LocationUnknown`,
`EventUnavailable`, `PredictionMissing`, `PredictionStale`, `CalendarMissing`,
`CalendarOutOfRange` and `ZoneUnsupported`. Initial missed reasons are
`ConditionsFalseAtPulse`, `ObservationGap`, `LateStartExpired`,
`CorrectionPastHighWater` and `EventWithdrawn`. An Unknown reason is not reused
for an ordinary false `when` predicate or a known missed occurrence.

`fallback = skip` resolves an Unknown admission to `.due = false` for the VM but
does not erase `decision = Unknown(reason)` from the same accepted scan's trace.
Source-level branching on unresolved quality is outside the minimum profile;
adding it later requires a typed Result/Decision rather than another unchecked
Bool. Thus current `.due` compatibility is retained without pretending its Bool
alone carries provenance.

Each planned occurrence has a stable identity. The canonical key is the stable
`scheduleId` plus a source occurrence key: fixed DateTime; daily/Cron local slot
plus DST fold when applicable; solar event kind plus source Date; or the tidal
provider's stable station/event key. The loaded definition revision, provider
revision and corrected planned time are metadata, not identity. Consequently a
hot-swap or provider correction before admission moves or reinterprets the same
occurrence rather than creating a second one. A deliberately new schedule gets a
new `scheduleId`; replaying an already admitted occurrence requires a separate,
explicit operator action rather than an incidental source edit. The key is
SHA-256 hashed for the public occurrence ID and persisted in the
high-water/admission ledger. It can be admitted at most once. Sustained truth
therefore does not create a run every scan. A condition that becomes true later
can admit an occurrence only inside an explicit Window or late-start interval.
Turning false and true again inside the same occurrence does not rearm it;
repeated attempts require an explicit repeating trigger/rearm policy.

`Pulse` has no late interval: if all conditions are not true at its crossing,
it is missed. `Window(5min)` permits first admission in `[planned,
planned + 5min)`. `Run(5min, on_time)` admits only at the observed crossing.
`Run(5min, within(10min))` permits the first admission in `[planned,
planned + 10min)`; the positive grace is not the run length. Missing that
half-open interval yields `LateStartExpired`, not a queued call. These are the
only minimum `LateStartPolicy` variants. Every Run manifest carries exactly one
tagged value: `{ kind: on_time }` or
`{ kind: within, withinMs: <exact positive Duration> }`.

An admitted Run measures its duration from actual admission using monotonic
time. Run elapsed time is continuous from admission and is not paused by a
false requested output or a global constraint blocking final output.
Requested-ON, safe-ON accumulated time and continuous-safe-ON time are separate
explicit timer expressions, not hidden Run modes. None proves physical motion.

## Recurrence, Cron, DST and midnight

The minimum Cron spelling is named `cron5` to avoid dialect guessing: minute,
hour, day-of-month, month and day-of-week, no seconds. To avoid traditional Cron's
surprising OR rule, the first profile rejects a rule that constrains both
day-of-month and day-of-week. Timezone is mandatory.

Civil-time recurrence requires explicit DST handling even when the installation
zone currently has no transition:

- nonexistent local time: `skip` or `next_valid`;
- repeated local time: `first`, `second`, `both` or `skip`.

No option is silently selected. A fixed-offset DateTime literal has no DST
ambiguity. Windows are half-open. When a solar/tidal offset crosses midnight,
the day filter uses the resolved scheduled start's local Date; trace also keeps
the natural event's source date. A day change never stops an already admitted
Run unless a separate continuation/constraint rule says so.

The new Schedule manifest requires `dstMissing` (`skip | next_valid`) and
`dstRepeated` (`first | second | both | skip`) plus `gapPolicy = skip` and an
exact positive `maxObservationGapMs`. The source spelling remains R16-reviewable,
but missing values are T3 diagnostics. Existing `DailySlots` v1 is a legacy
descriptor whose observed compatibility behavior is nonexistent=`skip`,
repeated=`first`, gap=`skip after 60000ms`; it is not silently relabeled as the
new profile. Migration emits the explicit fields and a new manifest/runtime
identity.

The new profile computes observation continuity from both fields of consecutive
accepted `ClockSnapshot`s. A gap exists when either the monotonic delta exceeds
`maxObservationGapMs` or the positive wall-clock delta exceeds it. Wall rollback
alone is handled by the high-water rule, but it cannot hide an excessive
monotonic delta. This check is independent of host polling speed and NTP
correction source.

The minimum `gapPolicy = skip` takes precedence over Pulse, Window and Run late
admission. Every not-yet-admitted occurrence whose admission interval intersects
that gap is marked missed with `ObservationGap`. The current or a later scan
cannot revive it merely because a Window or `within(...)` interval is still
open. Initial boot and trust recovery establish a baseline in the same
fail-closed manner. A future replay/catch-up policy must be separately named.

The same manifest names an exact `timezoneProfile` revision. A signed package
binds it as a required host capability; Browser and native hosts reject a
profile or zone they do not support before runtime activation. Accepting an IANA
string in the compiler is not evidence that every consumer implements it.

## Work-calendar day rules

Weekday, public-holiday and planned-work rules are different:

- `day\`mon..fri\`` uses only the resolved local Date.
- `day\`holiday\`` uses a named holiday calendar snapshot.
- `day\`workday\`` / `day\`offday\`` use a named site/crew work calendar.
- workday means planned work, not observed worker presence.

A work-calendar snapshot binds calendar ID, revision, timezone and coverage
range. Its precedence is explicit date exception, then declared holiday policy,
then weekly pattern. Conflicting same-date exceptions are invalid. Missing or
out-of-coverage data is `Unknown`; workday and offday are both Unknown. A
Schedule's day rule limits admission eligibility, not an already active Run.

The provisional surface uses `on = day\`...\`` and `calendar = workers`; R16
reviews spelling. The first profile defines day tags only for calendar dates and
does not infer an overnight shift's business date. A calendar definition that
attempts a cross-midnight work interval is rejected; authors may split explicit
time windows at midnight. A later shift type can add business-date attribution
without changing these day tags.

## Natural event context and fallback

Solar event context binds timezone, location revision, event kind and provider
calculation revision. Tidal event context additionally binds station/model,
prediction revision, coverage and expiry. A tidal provider profile is accepted
only if it supplies an opaque event ID that is stable across prediction
revisions and unique for multiple same-kind events at one station. The source
occurrence key is provider namespace + station ID + that event ID; time or
same-day ordinal is never used as a correction identity. A provider without
this capability may supply an immutable snapshot but cannot claim correction
support. High/low tides are occurrence events; spring/neap is a classified
condition and cannot be offset as if it were a DateTime. The language assumes
neither a fixed number of tides per day nor that a prediction proves physical
water level.

Provider corrections keep the stable event identity defined above. Before
admission, the newest valid prediction may move its planned instant. If that
instant moves at or behind the observation high-water, the occurrence is missed
with `CorrectionPastHighWater`; it is not caught up. Explicit provider withdrawal
is missed with `EventWithdrawn`. Reordering cannot change stable IDs. After
admission, a revision or withdrawal does not create a duplicate or cancel the
admitted Run. Missing location, untrusted clock, unsupported/polar event,
missing or stale prediction and unavailable calendar remain distinguishable
reasons in trace.

Every new-profile rule depending on natural/time/calendar context requires `fallback`.
The minimum supported value is `skip`: issue no new occurrence and preserve the
reason. It does not turn off an already admitted Run or erase monotonic timers.
A fixed-TimeOfDay alternative is meaningful only while the civil clock and
timezone remain trusted and therefore needs a terminal fallback such as `skip`.
Recovery establishes a new baseline; no missed occurrence is replayed unless an
explicit catch-up policy is later added.

`DailySlots` v1 remains readable under its declared old runtime identity without
a fallback field. T3 migration must produce an explicit fallback and must never
treat that legacy acceptance as permission to omit fallback in new source.

## T2–T4 acceptance vectors

These IDs are stable semantic vectors. R15–R17 may change provisional spelling
before they become source fixtures.

| ID | Scenario | Expected result | Owner |
| --- | --- | --- | --- |
| T1-TYPE-01 | valid/invalid Date, TimeOfDay and offset DateTime boundaries | exact normalized values / compile diagnostics | T2 |
| T1-TYPE-02 | wall clock moves backward while monotonic time advances | elapsed timer advances; no duplicate occurrence | T2/T4 |
| T1-TYPE-03 | DateTime plus Duration crosses UTC/local midnight | exact instant; no modulo-day wrap | T2 |
| T1-DURATION-01 | `0ms`, safe maximum, maximum+1 through control/constraints/ABI | first two exact where construct permits zero; overflow rejected consistently | T2 |
| T1-PULSE-01 | 08:00 Pulse, start predicate false at crossing then true at 08:10 | missed, not queued | T4 |
| T1-WINDOW-01 | 08:00–09:00 Window; predicate first true 08:10, later toggles | one 08:10 admission; no same-window rearm | T4 |
| T1-RUN-01 | planned 08:00, `Run(5min, within(10min))` admitted 08:02 | target 08:07 monotonic; wall correction does not change it | T2/T4 |
| T1-RUN-02 | Run active while requested/safe output is blocked for one minute | Run still completes from admission; separate requested/safe timers record their own values | T4 |
| T1-RUN-03 | `Run(5min, on_time)` predicate becomes true after crossing, or `within(10min)` reaches 08:10 | missed with the exact reason; never queued | T3/T4 |
| T1-FALLBACK-01 | natural rule omits fallback | compile diagnostic | T3 |
| T1-FALLBACK-02 | clock/location/event/prediction unavailable with `skip` | no due; exact Unknown reason retained | T4 |
| T1-RECOVERY-01 | trust recovers after a missed event | baseline only; no catch-up and no duplicate | T4 |
| T1-REVISION-01 | prediction moves before/after occurrence admission | newest pre-admission time / no post-admission duplicate | T4 |
| T1-REVISION-02 | unrelated source hot-swap retains one schedule declaration ID | same occurrence ID; no duplicate admission | T3/T4 |
| T1-DST-01 | nonexistent and repeated local TimeOfDay | selected explicit DST policy; absent policy rejected | T3/T4 |
| T1-DST-02 | repeated local TimeOfDay with `both` | two occurrence keys distinguished by DST fold | T3/T4 |
| T1-ZONE-01 | package requests an IANA zone outside one host's declared profile | reject before activation; do not fall back to a guessed offset | T3/T4 |
| T1-CRON-01 | `cron5` constrains both day-of-month and day-of-week | compile diagnostic, not OR/AND guess | T3 |
| T1-CALENDAR-01 | normal weekday / weekday holiday / weekend special work / temporary offday | workday, offday, workday, offday | T4 |
| T1-CALENDAR-02 | holiday special work / missing or expired snapshot | workday / Unknown for both workday and offday | T4 |
| T1-MIDNIGHT-01 | natural-event offset crosses midnight with a day filter | filter resolved start Date; source event Date retained | T4 |
| T1-MIDNIGHT-02 | work calendar attempts an overnight interval without shift attribution | configuration/compile diagnostic; no prior-date guess | T3 |
| T1-ACTIVE-01 | workday changes or context fails after a Run is admitted | admission filter alone does not stop it | T4 |
| T1-TIDE-01 | high/low prediction valid; spring/neap used as offset event | occurrence resolves / compile type diagnostic | T3/T4 |
| T1-TIDE-02 | two same-kind events reorder or one moves behind high-water/is withdrawn | stable IDs preserve matching; moved/withdrawn event is missed, never replayed | T4 |
| T1-GAP-01 | monotonic delta or positive wall delta exceeds the signed rule/profile bound | `ObservationGap`, no inferred replay; wall rollback cannot mask a monotonic gap | T4 |
| T1-GAP-02 | excessive gap overlaps an otherwise-open Window or `within(...)` interval | gap wins; occurrence is missed with `ObservationGap` and cannot be admitted later | T4 |

T2 must preserve DateTime and monotonic identities across native/WASM exchange.
T3 owns syntax and mandatory-field diagnostics. T4 owns provider resolution,
quality/fallback, occurrence identity, duplicate suppression and recovery. Driver
tests separately establish NTP/RTC/location/tidal data on the target device.

## Joint-review boundary

- R15: tagged Date/TimeOfDay/DateTime, `Schedule`/Pulse/Window/Run and `cron5`
  spelling; no reopening of calendar-vs-monotonic separation.
- R16: day/calendar spelling, workday/offday semantics, DST and midnight examples.
- R17: fallback spelling and whether explicit bounded `hold_last` is allowed.

Installation-specific location, tide station, calendar contents, equipment delay
and acceptable uncertainty are not language defaults. The review selects ways to
state them; implementation and physical acceptance remain downstream work.
