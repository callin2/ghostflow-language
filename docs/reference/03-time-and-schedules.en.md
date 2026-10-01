<!-- translation-source: docs/reference/03-time-and-schedules.md -->
[Korean original](03-time-and-schedules.md)

# 3. Time and schedules

[Full contents](../LANGUAGE-REFERENCE.en.md) · [Previous: 2. Types, expressions and state](02-types-expressions-state.en.md) ·
[Next: 4. Sensors, constraints and control](04-sensors-constraints-control.en.md)

GhostFlow does not treat time as a single number. The five minutes in “turn on for five minutes” are monotonic elapsed time; 6 a.m. in “start at 6 a.m.” is a calendar time with a timezone. Wall-clock correction must not rewind or extend an operation already in progress, and a reboot must not arbitrarily change the reference point of a schedule. This chapter uses that distinction to define time values, timers, recurring schedules, work calendars and natural events.

The `ghost` code and grammar blocks in this chapter are the selected public language contract. Where the current compiler validates or executes a narrower scope, the relevant section says so. Structures marked `text`, such as ClockSnapshot, manifests and provider records, are execution-environment contracts, not GhostFlow source. Actual clock, calendar and prediction data for schedules may come from a local device or an optional gateway. Neither a network nor a particular gateway is a language requirement.

The basis is the [time and schedule contract](../TIME-AND-SCHEDULE-CONTRACT.md),
[continuous Bool timer contract](../CONTINUOUS-BOOL-TIMER-CONTRACT.md),
[Solar schedule contract](../SOLAR-SCHEDULE.md), [selected syntax](../LANGUAGE-SURFACE.md),
[Programming in GhostFlow chapters 6–7](../ProgrammingInGhostflow.md),
[2026-09-24 fixed planned time range decision](../2026-09-24-fixed-planned-time-range-decision.md),
[#23](https://github.com/callin2/ghostflow-language/issues/23),
[#46](https://github.com/callin2/ghostflow-language/issues/46),
[#90](https://github.com/callin2/ghostflow-language/issues/90) and
[#96](https://github.com/callin2/ghostflow-language/issues/96).

## 3.1 Time values and clock domains

### Duration

`Duration` is a length of time, not a calendar date. The selected literals combine a nonnegative integer with `ms`, `s`, `min` or `h`.

```ghost
config open_delay: Duration = 2s;
config watering_time: Duration = 5min;
```

Its basic meaning is exact integer milliseconds in `0..2^53-1`. Arithmetic is checked within this range. Negative Duration, fractional milliseconds, NaN, Infinity and out-of-range results are forbidden. Every intermediate result of dynamic arithmetic must also satisfy these conditions. A violation rejects the current tick with `duration-out-of-range`; new state and intents are not partially committed. An operation requiring a “positive delay” may reject `0ms` for that argument, but that restriction does not remove zero from the `Duration` type itself.

`Duration + Duration` returns a checked sum. Subtraction returns `Duration` only when the result is nonnegative. Months, years and calendar dates are not Duration units because their lengths are not fixed milliseconds. “One month later” needs separate calendar-operation semantics.

### Date, TimeOfDay, DateTime

Public literals of time types use tagged forms.

| Type | Value domain | Rule |
|---|---|---|
| `Date` | Gregorian `1970-01-01..9999-12-31` | Contains no time or timezone. |
| `TimeOfDay` | `00:00:00.000..23:59:59.999` | Has no date, UTC offset or recurrence rule. |
| `DateTime` | Exact UTC instant from the Unix epoch through `9999-12-31T23:59:59.999Z` | A literal requires `Z` or a numeric UTC offset. The value does not retain an IANA zone. |

```ghost
date`2026-09-22`
time`06:30`
datetime`2026-09-22T06:30:00+09:00`
```

The exact spellings are:

```text
Date       := date`YYYY-MM-DD`
TimeOfDay  := time`HH:MM[:SS[.f|.ff|.fff]]`
DateTime   := datetime`YYYY-MM-DDTHH:MM:SS[.f|.ff|.fff](Z|+HH:MM|-HH:MM)`
```

All fields are zero-padded ASCII decimal digits. Fractional seconds have one to three digits, padded on the right with zeroes to normalize to exact milliseconds. Four or more digits produce a diagnostic rather than rounding. Numeric offsets are `00:00..14:00`; at hour 14, only `14:00` is allowed. `+00:00` normalizes to the same instant as `Z`; `-00:00`, which means an unknown UTC offset, is rejected.

Nonexistent dates, `24:00`, leap-second `:60` and DateTime without an offset produce diagnostics. An IANA timezone is context for interpreting recurring schedules in civil time; it is not part of an already resolved DateTime instant. Original literal spelling and offset remain in source metadata, but the DateTime value is an exact UTC millisecond instant. There are no implicit conversions between strings and time types, or between Date, TimeOfDay and DateTime.

Minimum time arithmetic has these semantics:

- `DateTime ± Duration -> DateTime`: a range-checked instant shift.
- Compare DateTime or TimeOfDay values of the same type.
- `TimeOfDay + Duration` does not wrap automatically at midnight. Interpret it in a Schedule context with a Date and timezone.
- `DateTime - DateTime` is not a basic `Duration` operation because it may need a negative result. Compare instants or use monotonic `elapsed`.

### Calendar clock and monotonic clock

One tick uses one immutable clock snapshot. The calendar clock interprets schedules, dates, timezones and natural events. The monotonic clock measures operation durations and continuous conditions.

```text
// Structure illustrating the contract
ClockSnapshot {
  monotonicMs
  bootEpoch
  wallMs?
  wallQuality: Trusted | Unknown(reason)
  uncertaintyMs?
  sourceRevision?
}
```

`monotonicMs` cannot decrease within the same run. A snapshot that decreases or fails integer/range requirements is rejected before state changes. Even if `wallMs` exists, it cannot be used for schedule decisions unless `wallQuality` is trusted. Ongoing timers continue on the monotonic clock even when the wall clock is corrected forward or backward.

The host judges the source and trust of NTP, RTC and platform time. Control expressions do not read the network or machine clock directly. A policy that temporarily holds the last trusted time must specify its allowed duration and terminal fallback. There is no hidden grace period.

**Why:** Mixing wall time and elapsed time under the same word “time” lets clock correction, timezone changes, DST and reboot change operation length too.

## 3.2 Elapsed time after a state change

The selected notation `elapsed(state)` returns monotonic elapsed time since the referenced state last **committed a change**.

```ghost
type Phase = Idle | Watering;
state phase: Phase = Idle;
timer age = elapsed(phase);

phase' = case phase {
  Idle => if start then Watering else Idle;
  Watering => if stop || age >= watering_time then Idle else Watering;
};
```

The exact rules are:

- The initial value is `0ms`.
- A new interval starts in the tick that commits a state change, with value zero.
- Later accepted ticks read the monotonic time difference.
- Both false→true and true→false are changes of Bool state. Thus `elapsed(running)` means “how long the current value has been held,” not cumulative ON time.
- Multiple stages do not advance successively within one tick. One transition occurs on the first tick satisfying the condition, so the actual delay is at least the requested Duration and normally has tick-resolution error.
- A rejected tick does not change timer state.

A timer is not `sleep` or a background task. Every tick still evaluates stop, sensor faults and global constraints while waiting.

## 3.3 Time for which a Bool is continuously true

“Temperature remained above the threshold for five minutes” differs from the last change time of a state value. A continuous-true timer measures only an uninterrupted interval in which the condition is true and immediately returns `0ms` on a false tick.

```ghost
timer hot_for = continuous_true(temperature_high);
```

For condition `c`, `wasTrue` from the previous accepted tick, interval start `since` and current monotonic time `now`, the semantics are:

```text
value    = if c && wasTrue then now - since else 0ms
wasTrue' = c
since'   = if !c then now
           else if !wasTrue then now
           else since
```

Thus the first true tick is zero, repeated ticks with the same timestamp are also zero, and the difference is returned from the next timestamp. False immediately gives zero, and the next true starts a new interval. Multiple timers do not share internal state.

`continuous_true` takes exactly one Bool expression. It does not implicitly convert `Result<Bool, SensorFault>` to Bool. To conservatively choose false on a fault, the author makes this explicit with `case`.

```ghost
let safe_high = case high_temperature {
  ok(value) => value;
  fault(_)  => false;
};
```

Continuous true is neither pause/resume accumulation nor accumulation of separate ON segments. Those are separate time operations.

## 3.4 Cumulative time and rolling budget

Distinguish these meanings:

| Question | Required time semantics |
|---|---|
| How long has the current stage been held? | `elapsed(state)` |
| How long has the condition been true without interruption? | continuous-true |
| How many total ON minutes were used in this job? | Cumulative ON time scoped to the job |
| How many total ON seconds occurred in the last 60 seconds? | Sliding-window ON integration |
| How many total minutes was the physical pump on today? | Equipment accounting by calendar date |

Rolling accounting first declares a ledger with a stable physical resource and stage, then queries that ledger on a time basis.

```ghost
resource pump1: BoolActuator;
account pump_applied = on_time(pump1,
  stage: applied,
  persistence: durable);
constraints PumpBudget {
  limit used(pump_applied, rolling(60s)) <= 30s {
    reserve = 1s;
    on_unknown = block;
  }
}
```

This code is a fragment of an accounting declaration inside a control. The current compiler validates valid `limit used(...)` and creates an accounting descriptor. Execution requires separate resource binding and ledger enforcement.

```text
used(t) = ON duration of x over (t - 60s, t]
```

When `used + reserve` reaches 30 seconds, further ON is forbidden. As part of an old ON interval leaves the window, that amount of budget immediately returns. Do not replace this with fixed minute buckets or measurement of only the current continuous interval. Sum partial overlaps of multiple intervals; the same logical-time trace must produce the same results even with irregular scans.

The accounting target must be explicit.

- requested: ON time requested by control.
- admitted/safe: logical ON time that passed constraints.
- applied: command time the Driver reports as applied.
- confirmed: physical operation time verified by feedback.

Even if `manual_request` is true, a low-water constraint making safe output false consumes no admitted/safe budget. Conversely, without feedback, safe ON time must not be represented as actual flow. The window and maximum ON must be finite, and a state-memory upper bound must be calculable. Reboot must not implicitly reset a protective budget. Select a contract of checkpoint restoration, conservative blocking for the window length, or an explicit non-durable policy.

**Why:** “30 seconds at a time” and “30 seconds total in the last minute” are different safety rules. Presenting them as the same timer permits bypassing the limit through many short activations.

## 3.5 Common Schedule semantics

A Schedule is a continuously evaluated typed reactive value, not a delayed call or background thread. It evaluates trigger, day rule, predicate and context at the current time to decide whether to admit an occurrence. An unsatisfied pulse is not automatically queued.

The selected trigger types are `At`, `Daily`, `DailySlots<G>`, `Periodic`, `Cron`, `Solar` and `Tide`. The current compiler accepts one-shot `At` pulse and only `DailySlots<15min>`. Each type has its own trigger fields and these common policy fields.

```ghost
schedule name: TriggerType {
  // trigger별 field
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

```text
basis       := pulse
             | window(positive Duration)
             | run(positive Duration, on_time)
             | run(positive Duration, within(positive Duration))
             | range(positive Duration)
when        := Bool
clock       := trusted_only
             | hold_trusted(positive Duration, terminal: skip)
gap         := skip_after(positive Duration)
recovery    := baseline
fallback    := skip
             | fixed_time(TimeOfDay, terminal: skip)  // Solar only
cancel_when := Bool                                   // Required for current civil range; optional for Tide run
```

All common fields are required. Unconditional admission can specify `when = true`; a Run or Range without language-level cancellation can specify `cancel_when = false`. In the current compiler, `cancel_when` is allowed for `Tide` Run and civil `range`, and is required for `range`. It is forbidden for `pulse`. `hold_trusted(d, terminal: skip)` adds monotonic elapsed time to the last trusted wall instant and uses it for at most d. Uncertainty adds the same monotonic elapsed time to the last uncertainty, recording `HeldClock` provenance. At the boundary, after `ClockUnknown`, terminal skip applies to new admission decisions. An already admitted Range keeps its monotonic end time. High-water does not change.

The current compiler accepts `clock = hold_trusted(positive constant Duration, terminal: skip)` for Solar and Tide and `fallback = fixed_time(TimeOfDay literal, terminal: skip)` for Solar. Tide permits only `fallback = skip`; other triggers retain trusted-only clock and skip fallback. `window` and `run(_, on_time)` remain outside current support. Civil `range` requires provable static non-overlap in UTC; immutable UTC Daily and nonempty static DailySlots ranges execute as GFB12, while other accepted Range recurrences remain descriptors. Tide `run(_, within(_))` is supported.

Bounded natural-policy admission uses held time only while monotonic elapsed time is strictly less than the duration. Missing trusted anchors or uncertainty and checked-addition overflow fail closed. Held wall time and uncertainty are the last trusted values plus elapsed time, with `HeldClock` provenance. Expiry terminal-skips new admission, preserves high-water and does not extend an active Run. Recovery establishes a baseline; restart begins with a new clock. The facts provider owns IANA conversion and supplies a known source local date and fallback instant matching the authored time and timezone on that date. Ambiguous or nonexistent civil times terminal-skip without inventing a fold. The core owns admission and generated due inputs. A fallback and recovered Solar event on the same source local date share a consumed identity and terminal checkpoint. These bounds prevent unavailable predictions or uncertain clocks from silently creating occurrences.

`fixed_time` is available only for Solar. When a fallback occurrence for that source local date is admitted, the same occurrence ledger consumes that date's Solar event, avoiding duplication even if the provider recovers. Tide allows only `fallback = skip` because without predictions the number and identity of events are unknown.

One-shot `At` uses a constant typed DateTime and has no timezone or DST fields:

```ghost
schedule appointment: At {
  at = datetime`2026-01-01T08:00:00Z`;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

The absolute instant is normalized from its explicit offset. Equivalent offset spellings plan the same instant. This bounded profile accepts only `pulse`, trusted-only clock, baseline recovery and skip fallback, with a positive constant gap. Missing fields, non-DateTime/nonconstant `at`, timezone/DST/cancellation fields and other bases are diagnostics. It exposes `.due` and `.missed`; it cannot mix with provider, config, sensor, resource, objective or other schedule profiles. GFB14 and control-v13 identify this execution profile; the framed clock/scan transport is unchanged. Older loaders reject GFB14. Signed portable packages do not yet accept this profile.

The Rust core computes one occurrence from the compiled schedule site and instant, without host-supplied occurrence rows. Admission requires `previous < planned <= current` on an accepted trusted scan with no observation gap and `when = true`. False at crossing and an overlapping gap consume a terminal miss. A boot/recovery baseline at or after the instant consumes a `BaselinePastMissed` occurrence without catch-up. Reobserving, wall rollback and recrossing do not create another pulse. Clock source/boot revision does not create a new identity. Rejected scans commit neither the clock baseline, terminal identity nor projections.

Cross-restart deduplication requires restoring the matching program's terminal checkpoint. A consumed or missed identity stays consumed even if the new boot's wall clock is before the instant; a pre-occurrence checkpoint may admit a future crossing. Fresh activation has no durable history. A crash after admission but before durable checkpoint publication is outside the VM's once-only guarantee; host persistence and dispatch must handle that boundary. Admission is logical evidence and does not prove physical execution or acknowledgement.

`Daily`, one time each day, requires `timezone`, ``at = time`...`;``, `dst_missing` and `dst_repeated`. For example:

```ghost
schedule morning: Daily {
  timezone = "Asia/Seoul";
  at = time`06:30`;
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

Trigger and duration basis are different axes. Do not list Cron, Window, Run and Range as alternatives of the same kind. Cron specifies when to plan an occurrence; Window/Run/Range describe admission and duration around the planned instant. Reading a Schedule does not turn on a device.

A Schedule decision produces `True`, `False` or `Unknown(reason)` and the revision used. `fallback = skip` resolves Unknown to a new `.due = false` but does not erase its reason. Negating Unknown must not turn it into permission.

The public projections mean:

- `.due`: a pulse true only on the accepted tick admitting one occurrence.
- Window `.open`: a level where the current predicate is also true within `[planned, planned + length)`.
- Run `.active`: an operation interval expressed with explicit state and a monotonic timer after admission.
- Range `.active`: the remaining interval of the current occurrence tied to the planned start. After admission, its end is judged with monotonic time; the interval continues even if safety constraints block output.

Run duration is measured in monotonic time from actual admission. On an accepted tick where `cancel_when` is true, Run and Range end `.active` without rearming the occurrence. They do not secretly pause when requested output is false or a global constraint blocks safe output. Measure requested ON, safe ON or continuous safe ON time with separate explicit operations when needed.

Each decision leaves a schedule observation separate from its Bool projection. This evidence includes stable schedule ID, definition revision, `False | Due | Unknown(reason)` decision, disposition, occurrence ID and planned wall instant, source/scheduled local date, and provider/context revisions. Typical dispositions are `Before`, `PredicateFalse`, `AlreadyAdmitted` and these missed reasons:

- `ConditionsFalseAtPulse`: conditions were false at pulse crossing.
- `ObservationGap`: an untrustworthy observation gap overlapped the admission interval. For Range this is nonterminal observation evidence for an open interval, subject to the recovery rules below.
- `LateStartExpired`: the late interval ended.
- `CorrectionPastHighWater`: the corrected event time moved behind already passed high-water.
- `EventWithdrawn`: the provider withdrew an event not yet admitted.

Because `.due = false` alone cannot distinguish ordinary false, Unknown fallback, an already admitted event and a missed event, bind this evidence to the same accepted scan.

### Source response to missed occurrences

`schedule_name.missed` is a `Bool` projection. The current compiler provides it for At pulse, Solar and executable `pulse` civil schedules. It is not yet an execution projection for Range, including executable UTC Range controls. It is true only when one or more occurrences of that schedule become **terminal missed** in this accepted scan. Even if two or more are missed in one scan, the value is true once; it is false in the next accepted scan if there is no new terminal miss. A control action evaluates this value exactly once in that accepted scan's immutable snapshot. Simply reobserving an occurrence already recorded as terminal missed or restoring a checkpoint does not make it true again. Rejected scans commit neither this pulse nor state transitions.

```ghost
state missed_scans: Int = 0;
missed_scans' = if morning.missed then missed_scans + 1 else missed_scans;
output missed_alarm: Bool;
missed_alarm <- morning.missed;
```

Because `.missed` is an ordinary `Bool` expression, the author declares responses in `if`, `case`, state transitions and output expressions. Do not add callbacks, per-occurrence handlers or automatic replay to schedule declarations. To respond once per scan to misses from multiple schedules, evaluate `morning.missed || evening.missed` as one expression.

A Bool pulse contains neither count nor reason. The same accepted scan's **ordered schedule observations** leave a separate record for every terminal missed occurrence. Each record preserves stable schedule ID, occurrence ID, planned instant, terminal miss reason (the applicable one of `ConditionsFalseAtPulse`, `ObservationGap`, `LateStartExpired`, `CorrectionPastHighWater`, `EventWithdrawn`) and definition/context/provider revisions. Even when multiple records commit in a single scan, do not merge them or summarize them with one reason. A terminal ledger restored after reboot does not create duplicate records or pulses. `Unknown` and nonterminal `ObservationGap` for a still-open Range do not make `.missed` true. Missed occurrences are not automatically admitted or executed when conditions later become true.

### Pulse, Window, Run, Range

| basis | Admission semantics |
|---|---|
| `pulse` | Admit only if all conditions are true on the crossing tick. Becoming true later still means missed. |
| `window(5min)` (design) | Admit once at the first true condition within `[planned, planned+5min)`. Repeated false→true changes in the same occurrence do not rearm it. |
| `run(5min, on_time)` (design) | Admit only at observed crossing and run for five minutes from admission. |
| `run(5min, within(10min))` (Tide) | Allow first admission within `[planned, planned+10min)`. Ten minutes are grace; run length is five minutes. |
| `range(10min)` (civil contract) | If trusted current time is within `[planned, planned+10min)` and `when` is true, admit once even after late first observation, boot or recovery. End is planned start + ten minutes. Immutable UTC Daily/DailySlots execution uses GFB12. |

```ghost
schedule morning_watering: Daily {
  timezone = "UTC";
  at = time`08:00`;
  dst_missing = skip;
  dst_repeated = first;
  basis = range(10min);
  when = true;
  cancel_when = false;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

This immutable UTC `range` example is executable GFB12 control bytecode. The bounded execution slice supports Daily without a work calendar and nonempty static DailySlots, with `trusted_only`, `baseline` and `skip`. Live start/duration settings, Periodic Range and other accepted variants remain descriptors. Non-UTC and unprovable overlap remain rejected; no timezone or DST policy is inferred.

Range context checkpoints retain consumed occurrence identities, not an active monotonic timer. Restoring into a fresh boot does not resume or readmit an already consumed occurrence. An unconsumed still-open interval may admit only its remaining time. Terminal-capacity exhaustion rejects the scan atomically; identities are never silently pruned.

The late interval is half-open. No new admission occurs at its end boundary. For a planned time of 08:00, `run(5min, within(10min))` admitted at 08:02 is a monotonic run through 08:07.

`range(duration)` is a fixed planned time interval. For example, first observing an 08:00-planned `range(10min)` at trusted 08:04 requests only the six minutes remaining until 08:10. First observation at or after 08:10 does not start it and records `LateStartExpired`. If `when` becomes true late but before the end, it requests only remaining time. The same applies at startup, reboot, recovery of clock trust and observation gaps. This is explicit partial-interval admission applying only to Range. It does not change `gap = skip_after(...)` and `recovery = baseline` for other bases. Without trusted current time, the result is `Unknown(ClockUnknown)`; estimated time does not admit a new Range. Explicit `clock = hold_trusted(...)` uses time and uncertainty held under that contract. An ongoing Range continues until its existing monotonic end even if wall trust or hold subsequently expires. However, reentry of the same occurrence waiting for a start moved into the future, like new admission, requires trusted time. Even after trust recovers, there is no reentry if the current interval has ended.

Different Range occurrences of the same schedule must not overlap. A nonempty intersection of two half-open intervals is an error. Exactly touching boundaries are allowed. For example, `DailySlots` with `selected = [08:00, 08:15]` and `basis = range(30min)` is a compile error because 08:00–08:30 and 08:15–08:45 overlap. The compiler accepts only Ranges for which trigger definitions and effective settings prove non-overlap of occurrence spacing. If provider or dynamic recurrence spacing cannot be proved, reject that `range` declaration with a compile diagnostic rather than guessing or selecting one. Check static defaults at compile time and effective values, including restored settings, before activation. Overlapping effective values reject activation. A live settings change causing overlap rejects the whole event atomically. Both checks also apply to the currently admitted interval and newly planned intervals.

At Range admission, fix the planned end using the occurrence's planned start and the effective Duration at that point. Convert the already elapsed portion into remaining time on the monotonic clock. RTC/NTP wall-clock correction after admission neither advances nor delays the ongoing end. Apply the corrected wall clock to subsequent occurrence decisions after the current occurrence ends. Preserve trusted time, planned start and monotonic elapsed reference together for the same occurrence, avoiding recalculation of the end during correction.

If the scalar start-time setting of a trigger with a single planned start, or its Duration, is an operational setting, apply an accepted atomic live event to the current occurrence too, from its application position. Recalculate the current interval and end with the changed start and Duration. Keep occurrence ID and already admitted ledger across settings revision changes. After admission, advance the stable pre-correction time reference by monotonic elapsed time to determine current position and remaining time. For example, an 08:00-planned `range(10min)` admitted at 08:04 ends at 08:12 if Duration changes to 12 minutes at 08:07. Shortening it to five minutes ends it at the decision applying that event because the new 08:05 end has passed. Changing start to 08:02 while keeping ten minutes sets end to 08:12. Do not use late admission time as the new planned start. If a settings event and scan coincide at one position, first establish §5.2 event application order, then decide using effective settings at that position.

When global safety constraints block output, safe output immediately becomes false, but the Range occurrence and monotonic end remain. If the constraint clears before the end, only the then-remaining interval may be requested. Blocked time is not appended at the end. `cancel_when = true` terminates the occurrence; renewed permission does not restart it. `.active` and requested/safe/applied/confirmed output are different observations.

If a start-time change places current position before the new planned start, stop with `.active = false` in that decision. On the accepted tick reaching the new start, reassess whether the same occurrence is inside its changed interval. If `when` is true, resume requests only until the current planned end; produce safe output only when safety constraints allow. This is not new admission, so `.due` is not emitted again and occurrence ID and ledger remain. If the changed end is at or before current position, terminate the occurrence immediately without resuming or readmitting. `DailySlots` `TimeSlots` changes distinguish retime from removal/addition using §3.6 stable slot keys. Apply these Range recalculation rules to retime preserving a key, and the new-item baseline rule to removal/addition.

### Occurrence identity and duplicate suppression

Each planned occurrence is identified by the schedule's stable declaration ID and source occurrence key. Local daily/Cron slots include DST fold, solar includes event kind and source date, and tide includes station/event IDs guaranteed by the provider. Definition revision and corrected planned time are metadata and do not turn the same event into a new event.

An occurrence is admitted at most once. Sustained true does not create a new run every tick, and changing provider revision of an already admitted occurrence does not create a duplicate run. A different intended schedule requires a new schedule ID.

### Observation gaps and recovery

Schedules check monotonic delta and positive wall delta between consecutive accepted snapshots. Exceeding d in explicit `gap = skip_after(d)` is an `ObservationGap`. This policy terminates Pulse, Window and Run occurrences as missed when that gap overlaps their admission interval. Do not revive them later even if Window or `within(...)` remains open. For Range, `ObservationGap` during the interval is evidence of the gap, not a terminal missed record for that occurrence. If trusted current time is still inside the planned interval, first admission may request only remaining time. Reaching the end boundary records terminal missed with `LateStartExpired` without execution. An occurrence already terminated as terminal missed or withdrawn is not revived merely because time is inside the interval. In particular, Tide `CorrectionPastHighWater` and `EventWithdrawn` are terminal for Range too.

`recovery = baseline` establishes only a baseline at initial boot and clock-trust recovery; it does not execute past occurrences in a batch. Range may admit only the remaining time of a still-open current interval. Wall rollback is deduplicated with high-water and the admission ledger. There is no catch-up, retry or replay syntax.

If two or more occurrences of the same schedule are crossed between consecutive accepted scans, record all new Pulse, Window and Run occurrences as missed and admit or execute none. Range does not execute occurrences already ended or recorded terminal missed/withdrawn; it admits the current occurrence whose interval is open at trusted current time for its remaining duration. Two simultaneously open Range intervals of the same schedule are forbidden and rejected in compile/live settings validation. If exactly one occurrence is crossed, apply ordinary admission rules for each basis.

## 3.6 Selected DailySlots

Extended Solar policies execute only in the bounded Solar profile; combining them with non-Solar schedules, provider/config execution or unsupported features is rejected. Legacy Solar combinations retain their existing profile.

`DailySlots<15min>` selects times on a 15-minute grid of the local date.

```ghost
schedule starts: DailySlots<15min> {
  timezone = "Asia/Seoul";
  selected = [06:00, 18:45];
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

- `timezone` is the IANA zone used to interpret the schedule.
- `selected` contains 15-minute grid times within a day's `00:00..23:45`.
- Duplicate slots and off-grid times are forbidden.
- `starts.due` is true once on the first tick observing a slot crossing.
- Preboot slots, slots missed in an observation gap and occurrences before recovery are not implicitly caught up.
- The same local date/slot is not executed again after wall rollback.

Use a finite settings type to let an operator change the slot set within the same Program/run.

```ghost
config watering_slots: TimeSlots<15min, 8> = [
  time`06:00`, time`18:45`
] {
  access = operator;
  label = "관수 시작 시각";
}
```

`TimeSlots<G,N>` is a nominal finite set of TimeOfDay. G is a positive Duration grid dividing 24 hours exactly; N is the compile-time maximum item count. An empty set is a valid value with no occurrences. Values must be unique and on the grid relative to local midnight, and are sorted after validation. They do not implicitly convert to a Duration list. When connected by `selected = watering_slots`, the schedule and setting must have exactly the same G. Literal `selected` uses the existing concise `HH:MM`; settings values use ordinary `time` literals.

`selected = watering_slots` consumes §5.2's `Result<TimeSlots<G,N>, SettingsFault>` stream. A fault in the current observation leaves `Unknown` with the same cause and admits no new occurrence. Do not substitute a previous successful list or an empty list. Apply the next `ok` emission with the identity, retime and baseline rules below. A fault itself does not cancel an already admitted Run or replace a separately specified cancellation rule.

An accepted live edit has these semantics:

- Atomically validate the whole event for type, grid, duplicates, N, permissions and Program identity.
- Approved runtime settings state preserves an opaque `slot key` per item, independent of displayed time. This key is not GhostFlow source syntax and is not author-selected. A settings event has unique event identity and a base settings revision; retime identifies both existing `slot key` and new `TimeOfDay`. UI and storage must not substitute ordering or displayed time for item identity.
- Retime changes only the displayed time of the same item. Preserve `(schedule ID, local date, slot key, DST fold)` occurrence identity and admission/terminal ledger. The changed `TimeOfDay` is planned-time metadata. Moving an already admitted Range into the future immediately stops it with `.active = false`; when trusted time reaches the new start, reevaluate the same occurrence in its changed half-open interval. Do not emit `.due` again or create a second admission.
- For example, in `TimeSlots<1min,N>`, after admitting an 08:00 `range(10min)` occurrence at 08:04, retiming its item to 08:07 stops it at the event application position. The accepted 08:07 decision reevaluates the same occurrence and requests through 08:17 if `when` is true. Occurrence ID, slot key and ledger remain. If the event applies at the 08:07 decision position, §5.2 order first applies the new value and immediately evaluates the same occurrence.
- A newly added item receives a new `slot key` and establishes a baseline at the effective event position. Do not emit same-day slots at or before that position; plan only future slots.
- Removal deletes only future plans for that `slot key`. Removing and adding the same displayed time creates a new key and occurrence; it is not retime. Removal does not cancel an admitted Run. To retime an admitted Range, use a retime event specifying its existing key, not removal/addition.
- Settings events and schedule scans follow the total order of effective positions. An item is not due at the exact position where it is first added.
- Restart may restore approved settings values but does not create a pending queue. Occurrence ledger lifetime is separate from ordinary config. Restored state must include slot keys as well as displayed times.

Validate a retime result as a complete `TimeSlots<G,N>` value for grid, duplicates, N and Range non-overlap in the same schedule. If the new time overlaps another item's Range, reject the whole event and retain existing values, slot keys, settings revision, active occurrence and ledger.

This type does not mean “every 15 minutes.” It represents specific local clock slots such as `[06:00, 18:45]`. It differs from Periodic, whose period changes through a setting.

## 3.7 Periodic and Cron

### Periodic

Periodic is an occurrence stream with a repeat interval and deterministic anchor/phase.

```ghost
schedule watering: Periodic {
  every = irrigation_interval;
  anchor = instant(datetime`2026-10-01T00:00:00Z`);
  interval_change = preserve_anchor;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

The successful payload of `every` must be a positive `Duration`. A config reference must also declare Duration as its payload type; Bool, Percent and unitless Number are type errors. Do not use runtime boot time as a hidden anchor. The anchor is one of:

- `instant(DateTime)`: add n*every to an exact UTC instant.
- `civil(Date, TimeOfDay)`: add n*every on the local civil timeline, then interpret each local timestamp with the required timezone and DST policy. This does not add general TimeOfDay arithmetic.
- `persisted_epoch`: activation requires an activation record providing an exact epoch instant and stable epoch ID. Preserve it after reboot; do not substitute boot time.

Operator interval changes follow the latest decisions in #105/#110. One settings action is an atomic stream emission within the same program and run. Success/fault rails and batch validation of settings streams follow §5.2. `every = irrigation_interval` is dedicated syntax consuming that config's `Result<Duration, SettingsFault>`. With `ok(interval)`, use the new interval under the phase policy below. With `fault(reason)`, preserve `Unknown(reason)` and admit no new occurrence. Do not keep running on the last successful interval or revert to an initial value. Recovery to `ok` applies the phase policy from that effective position, without catching up past occurrences during the fault. Do not retroactively change identity or execution of already admitted occurrences. Settings revision and effective event position identify both successful and fault observations. Do not rewrite source/bytecode or create a new run. Always specify `interval_change` when `every` is a setting.

- `preserve_anchor`: create a new phase revision from the same anchor and plan only instants after the effective position.
- `preserve_next`: retain the one next occurrence already planned by the previous phase, then start the new interval after it is admitted or missed.
- `restart_after_change`: use the effective position as the new anchor and create the first occurrence after the new every. The settings event itself is not due.

Each accepted successful change creates a durable phase revision. Withdraw previous future occurrences and retain already admitted ones. The source occurrence key is `(periodic epoch ID, phase revision, ordinal)`; do not catch up past occurrences.

After an actual device restart, settings values persist but run identity is new. Do not generalize these live-settings rules to program replacement, physical binding changes or Auto↔Manual mode switching.

### cron5

Cron uses this public syntax:

```ghost
schedule weekday_morning: Cron {
  timezone = "Asia/Seoul";
  at = cron5`0 6 * * 1-5`;
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

`cron5` field order is minute, hour, day-of-month, month, day-of-week; there are no seconds. Each field accepts `*`, integers, comma lists/ranges, `*/step` and `range/step`. Ranges are respectively `0..59`, `0..23`, `1..31`, `1..12`, `0..6`; day-of-week 0 is Sunday. Names and Sunday alias 7 are rejected. A rule restricting both day-of-month and day-of-week beyond `*` produces a diagnostic instead of selecting traditional Cron's hidden OR/AND. A nonexistent civil date produces no occurrence rather than shifting it.

Cron defines only occurrence time. It does not determine run length, retry, late admission or output. Combine those semantics through Window/Run, fallback and control state.

## 3.8 DST, midnight and work calendars

Civil recurrence specifies policies even if the current installation region has no DST.

- `dst_missing = skip | next_valid`.
- `dst_repeated = first | second | both | skip`.
- `both` identifies the two folds with different occurrence keys.

These two fields are required for `Daily`, `DailySlots`, `Cron` and civil `Periodic`. A fixed DateTime in `At` or a provider-supplied instant has no DST ambiguity.

When a natural-event offset crosses midnight, apply the day filter to the calculated **scheduled start local Date**. Also retain the original natural event's source date in the trace. Do not stop an already admitted Run merely because the day changed.

Weekdays, holidays and site workdays are different rules. Declare calendars as logical providers bound to actual data by the installation profile.

```ghost
calendar holidays: HolidayCalendar;
calendar workers: WorkCalendar;

// schedule 내부의 예
on = day`mon..fri`;
on = day`mon,wed,fri`;
on = day`holiday`;
calendar = holidays;
on = day`workday`;
calendar = workers;
on = day`offday`;
calendar = workers;
```

A weekday tag needs no calendar. `holiday` requires HolidayCalendar; `workday` and `offday` require WorkCalendar. An incompatible kind or missing binding is an activation error. Calendar snapshot timezone must equal schedule timezone.

A work-calendar snapshot has calendar ID, revision, timezone and coverage range. Decision precedence is explicit exceptions for that date, declared holiday policy, then weekly pattern. Conflicting exceptions for one date are invalid. A workday is a planned working day, not confirmation of actual human presence. Without a snapshot or outside coverage, both workday and offday are Unknown. `!workday` must not turn Unknown into offday permission.

This day tag does not decide which business date owns an overnight shift. Until there is a separate shift contract, reject work intervals crossing midnight and divide them into explicit intervals.

To use the same typed decisions in ordinary control expressions, handle Result explicitly.

```ghost
let weekday = local_day_is(day`mon..fri`, timezone: "Asia/Seoul");
let working = calendar_is(workers, day`workday`);
let can_start = case working { ok(value) => value; fault(_) => false; };
```

`local_day_is` returns `Result<Bool, ClockFault>`; `calendar_is` returns `Result<Bool, CalendarFault>`. Schedule `on` preserves the same fault as Unknown and sends it to explicit fallback, but ordinary expressions do not convert it to Bool without `case`. Calendar and timezone profiles may come from local device storage, removable storage or an optional gateway. The language requires data ID, revision, coverage and expiry, not the internet.

## 3.9 Solar, moon and tides

### Selected Solar notation

Solar schedules interpret rise/set occurrences using location and timezone.

```ghost
schedule morning: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise + 30min`;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

Each declaration requires exactly one of each trigger field and §3.5 common policy field. Latitude is a finite literal in `-90..90`, longitude in `-180..180`. Solar `at` has only these forms:

- ``sun`rise` `` or ``sun`set` ``.
- An exact whole-number Duration offset combining the event above with `+` or `-`.
- Offset magnitude is at most 24 hours; zero is allowed.

This tagged form is exclusive to Solar `at`. It is not interpolation or an arbitrary expression. Missing/invalid location, an untrusted clock, no event for the date/region or an unsupported provider yields no new occurrence and preserves the reason. `fallback = skip` does not turn off already admitted runs or monotonic timers.

Solar rise/set are sea-level astronomical events. Terrain, altitude and observed weather do not become automatic inputs. An installation needing such corrections must explicitly provide separate provider context and provenance.

### Moon and tides

High and low tides are predicted `DateTime` occurrences. Duration offsets before or after them can create start points. Spring/neap tides are classification states/periods of tidal range, not particular instants, so they cannot be event-offset operands. Lunar phase is also not the same as site tide prediction. Do not infer high-tide time or daily event count from lunar phase alone.

Declare a tide provider as a logical capability bound to a station/model by the installation profile.

```ghost
provider harbor_tides: TidePredictions;

schedule pre_high_tide: Tide {
  source = harbor_tides;
  timezone = "Asia/Seoul";
  at = tide`high - 30min`;
  basis = run(10min, within(5min));
  when = true;
  cancel_when = stop || unsafe_level;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

Tide `at` accepts only ``tide`high` `` or ``tide`low` `` with an exact whole-number Duration offset of at most 24 hours. `spring`, `neap` and lunar phases are not event operands.

Tide context includes provider namespace, stable station ID, station/model, prediction revision, coverage and expiry. A provider must supply opaque event IDs that remain unique and stable within the station across correction revisions. The source occurrence key is provider namespace, station ID and opaque event ID. Do not use time or ordinals such as “today's second high tide” as identity. Before correction, an event not yet admitted may move to a new time. If the new time precedes observation high-water, mark it missed with `CorrectionPastHighWater`. Provider withdrawal is `EventWithdrawn`. Revisions or withdrawals after admission do not create duplicate runs or hidden cancellation.

A provider unable to guarantee stable IDs may bind only as an immutable snapshot and cannot publish corrections to existing events. Provider revision, model/binding revision and corrected planned instant are metadata, not identity.

Spring/neap tides and lunar phases are quality-aware conditions.

```ghost
provider moon: LunarEphemeris;
let neap = tide_is(harbor_tides, tide`neap`);
let full = moon_is(moon, moon`full`);
let use_short_run = case neap { ok(value) => value; fault(_) => false; };
```

`tide_is` accepts `spring | neap`; `moon_is` accepts `new | waxing_crescent | first_quarter | waxing_gibbous | full | waning_gibbous | last_quarter | waning_crescent`; both return `Result<Bool, TemporalContextFault>`. Ordinary expressions require explicit `case`. Schedule `when` accepts these quality-aware predicates, preserves faults as Unknown and sends them to fallback. The provider supplies classification criteria, region/timezone, revision, coverage, expiry and uncertainty. Lunar phase does not predict site tides, and tidal classification does not prove actual water level.

### Fallback and recovery for natural references

New natural/calendar schedules require fallback. The minimum fallback is `skip`. Unknown reasons are distinguished, for example, as `ClockUnknown`, `LocationUnknown`, `EventUnavailable`, `PredictionMissing`, `PredictionStale`, `CalendarMissing`, `CalendarOutOfRange` and `ZoneUnsupported`.

Solar may explicitly specify ``fixed_time(time`06:00`, terminal: skip)`` when a trusted civil clock exists. Do not admit a recovered Solar event again on a source local date whose fallback occurrence was admitted. Tide allows only `skip` because without predictions the event count and identity are unknown. Network disconnection and loss of clock trust are different. Explicitly specify `clock = hold_trusted(d, terminal: skip)` for bounded clock hold.

On recovery, establish a baseline without replaying missed events. High-water and the occurrence ledger prevent duplicates. Fallback does not bypass sensor validation, modes, resource arbitration or output safety constraints.

## 3.10 Time-based usage constraints

Fixed local-day budgets differ from rolling-window budgets.

```ghost
resource pump1: BoolActuator;
account pump_applied = on_time(pump1,
  stage: applied,
  persistence: durable);

constraints PumpBudgets {
  limit used(pump_applied, local_day("Asia/Seoul")) <= 1h {
    reserve = worst_case_on + stop_delay;
    on_unknown = block;
  }
}
```

`stage` is one of `requested | safe | applied | confirmed`. Confirmed requires a compatible feedback binding and quality contract. After choosing the stage, merge aliases of the same physical resource and overlapping control requests into one interval.

Choose exactly one ledger persistence policy:

- `durable`.
- `block_after_restart(d)` for a rolling basis. d must be at least the protective window.
- `block_until_day_boundary` for a local-day basis.
- `volatile`. Observation only; rejected in `limit`.

If durable state is missing or corrupt, `used` is Unknown. Observation may display Unknown, but a protective limit explicitly specifies `on_unknown = block`.

A day budget counts final applied ON intervals of the same physical equipment only once across automatic/manual operation and multiple controls. Split midnight-crossing intervals at trusted local-date boundaries. Wall-clock correction does not move already committed usage to another date or reset it to zero. A rolling 24h limit is a separate rule requiring recent interval history.

Time boundaries are fixed as follows:

- Requested/safe values selected at accepted scan t_i apply to `[t_i,t_(i+1))`.
- Applied/confirmed use `[start,end)` of monotonic event timestamps validated by the Driver.
- At t, `rolling(d)` integrates interval overlap with `(t-d,t]`. A new value selected at t has not yet consumed usage time at t.
- When used equals the limit exactly, further ON is blocked. Old partial intervals leave exactly according to logical time; do not use fixed buckets.
- `local_day(zone)` is `[start,next)` between resolved local midnights, which may last 23 or 25 hours under DST. Split intervals crossing the boundary.
- Intervals committed to a date using a trusted profile are not moved or deleted by wall correction. An untrustworthy boundary is Unknown.

Before starting a job, reserve budget including its full ON upper bound and stop delay. Manual operation with no end time may have a finite lease and cutoff within remaining budget. After interruption/completion, settle against actual applied intervals. Handle uncertain usage conservatively. Reboot, program revision, a new schedule ID and clock rollback do not reset the equipment ledger.

`reserve` is a bounded Duration expression required for start-admission limits. For manual operation, the author specifies a finite lease/cutoff and includes its maximum in reserve. After use, settle against observed intervals at the declared stage. Do not release a reservation whose outcome is unknown after power loss without the selected persistence policy.

A daily limit is not occurrence deduplication. Running the same five-minute job twice may still be below one hour. `once ... per occurrence` and a stable occurrence ledger are separately necessary.

Do not substitute a time ledger for daily counts. Separately aggregate typed Events with stable identities.

```ghost
event normal_run_started: Event;
account normal_starts = count_events(normal_run_started,
  over: local_day("Asia/Seoul"),
  persistence: durable);
let under_daily_start_limit = case normal_starts.count {
  ok(count) => count < 4;
  fault(_) => false;
};
```

Which requested/admitted/applied/confirmed start or completion events to produce, whether to include cleaning events, whether to clean once a day or every N operations, cleaning order and restart are user program/policy decisions. `.count` has type `Result<Int, AccountingFault>`. Redelivery of the same event ID counts once. An untrustworthy local-day boundary gives `ClockUnknown`; a missing or corrupt ledger gives `LedgerMissing` or `LedgerCorrupt`, respectively; an incomplete ledger whose exact count is unknown gives `LedgerIncomplete`. An internal u64 count exceeding the maximum `Int` gives `CountOverflow`. Do not substitute zero or wrap within the integer range. The `case` above explicitly separates a successful count from faults to produce a control `Bool`. **Why:** Treating an unknown count as zero can exceed the daily job limit. Unknown usage in a protective `limit` blocks execution through `on_unknown = block`.

## 3.11 Established time syntax and boundaries

The public notations established in this chapter are:

- `date`, `time`, `datetime` tagged literals and `continuous_true`.
- Common schedule policies, `pulse/window/run/range`, `At`, `Daily`, `DailySlots`, `Periodic`, `Cron`, `Solar`, `Tide`.
- `TimeSlots<G,N>` live settings, Periodic phase changes, `cron5`, day/calendar/DST.
- Bounded `hold_trusted`, terminal fallback and stable natural-event provider identity.
- `on_time`, `used`, `rolling`, `local_day`, limit reservation and persistence.

This list is the selected language contract. Current compiler support and executable bytecode scope follow the distinctions in §3.5 and §3.6.

Authors specify schedule start predicate, basis and duration, Run cancellation, DST choices, Periodic anchor/change policy, natural fallback, accounting stage/resource/reservation, manual lease and cleaning policy. The language adds no hidden catch-up, retry, cancel, restart or gateway requirement. Compiler acceptance is not evidence of clock/provider data or Driver/physical operation.

[Full contents](../LANGUAGE-REFERENCE.md) · [Previous chapter](02-types-expressions-state.md) ·
[Next chapter](04-sensors-constraints-control.md)
