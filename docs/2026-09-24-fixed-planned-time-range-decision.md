# Fixed planned-time range decision — 2026-09-24

Status: approved language meaning; implementation remains separate. The normative
syntax and behavior are in [Language Reference §3.5](reference/03-time-and-schedules.md#35-schedule의-공통-의미).

## Intent and selected surface

An operator may plan an output for a fixed interval, such as 08:00–08:10.
If the first trusted observation arrives at 08:04, the output has six minutes
remaining. The interval must not slide to 08:04–08:14. The selected schedule
basis is `range(duration)` with a positive Duration. Trigger fields determine
the occurrence's planned start. Its half-open interval is `[planned start,
planned start + effective duration)`.

`run(duration, within(grace))` remains distinct: it permits late admission but
measures the full run duration from admission. `window(duration)` remains an
admission window rather than an active planned-time interval. `pulse` admits at
the observed crossing only.

## Admission and progression

- A Range admits a current occurrence when `when` is true and the trusted
  current time lies inside its interval. The first observation may be after
  boot, trust recovery or an observation gap. Earlier expired occurrences are
  not replayed. At or after the end, record `LateStartExpired` and do not run.
- An observation gap while a Range interval remains open is nonterminal
  evidence. It does not create a terminal missed record to revive later. The
  occurrence can still admit for its remaining time. Once its planned end has
  passed, `LateStartExpired` is terminal.
- An untrusted clock cannot newly admit the Range. The explicit
  `hold_trusted(...)` clock policy may supply a bounded trusted extrapolation,
  retaining its uncertainty and provenance.
- The late-admission exception cannot revive an occurrence already terminally
  missed or withdrawn. A Tide event marked `CorrectionPastHighWater` or
  `EventWithdrawn` remains terminal even if its revised interval covers now.
- Admission records the stable occurrence ID and planned start. It converts
  the remaining time to a monotonic deadline. RTC/NTP wall corrections during
  that occurrence are held pending for its end calculation; they cannot shorten
  or extend the active interval. Apply the corrected wall time to subsequent
  occurrence decisions after this Range settles. A wall rollback cannot admit
  the same occurrence twice.
- An admitted active Range continues to its monotonic deadline if wall trust
  or an explicit clock hold expires. The terminal `skip` applies to new
  admission decisions, not to that active deadline. A Range paused by a start
  edit into the future cannot reenter while clock quality is Unknown. Recovery
  permits reentry only if the same interval is still open.
- A global safety constraint blocks safe output immediately. The Range clock
  continues. If the constraint clears before its scheduled end, output can
  resume for the remaining time. The blocked interval is never added at the
  end. `cancel_when` terminates the occurrence without rearming it.
- Requested, safe, applied and confirmed output evidence remain distinct.
  Range `.active` records the schedule's interval, not physical operation.

For a planned start of 08:00 and `range(10min)`, admission at 08:04 leaves six
minutes. Admission at 08:10 leaves no interval. If safety blocks from 08:06 to
08:08, output may resume only until 08:10. A wall correction at 08:07 does not
change that active deadline.

## Live start and duration changes

A validated atomic live setting event may change a scalar planned start or
Duration for the current occurrence from its event position. Recompute the interval
from the new start plus effective Duration, evaluated against the stable clock
progression established at admission. A late admission time never replaces
the planned start. With a start of 08:00, admission at 08:04 and a change at
08:07 from ten to twelve minutes, the occurrence ends at 08:12. A change to
five minutes makes the new end 08:05, so the same accepted decision ends the
active Range. A start edit to 08:02 with ten minutes of Duration moves the end
to 08:12. Neither setting event creates a new occurrence or resets its
identity or admission ledger. Editing a `DailySlots` `TimeSlots` set follows
[§3.6](reference/03-time-and-schedules.md#36-선택된-dailyslots): removed slots
remove future plans, and added slots establish their own baseline. A set edit
does not retime an admitted occurrence through this scalar start rule.
The live start retiming rule is scoped to a scalar start setting; it does not
define a general retiming rule for a set of slots.

The order of setting events and scans follows the atomic live event contract in
[§5.2](reference/05-settings-and-observation.md#52-소스-변경과-운영-설정-변경): the
effective value at the completed decision position determines that decision.

## Boundary

This decision gives Range a specific exception to the existing observation-gap
and boot baseline policy. Pulse, Window and Run keep their existing skip and
admission rules. Range never catches up after its planned end.

If a live start edit moves an admitted occurrence's new start into the future,
the accepted decision at the event position sets `.active = false` immediately.
At and after the new start, reevaluate membership in the changed half-open
interval for that **same** occurrence. If `when` is true, requested output can
resume only until its current planned end. Safe output resumes only when the
safety constraints permit it. This is not a
second admission: `.due` does not pulse again, and the occurrence ID and ledger
do not change. If the changed end is already at or before the stable current
time, end the occurrence immediately; do not resume it later.

## Nonoverlap validation

Two occurrences of the same schedule may not have overlapping half-open Range
intervals. Adjacent intervals are valid. For example, `DailySlots` with
`selected = [08:00, 08:15]` and `basis = range(30min)` is a compile error:
08:00–08:30 overlaps 08:15–08:45. There is no runtime arbitration between
those two occurrences.

The compiler accepts `range` only for triggers whose occurrence spacing can be
proved from the definition and effective settings. If a dynamic recurrence or
provider cannot supply a provable spacing, compilation rejects the `range`
declaration with a diagnostic. Static default values are checked at compile
time. Restored effective settings are checked before activation; overlap
rejects activation. A live setting event that would create overlap is rejected
atomically, including overlap with the current admitted interval. This also
applies to `DailySlots` set edits without changing their slot identity and
removal/addition rules.
