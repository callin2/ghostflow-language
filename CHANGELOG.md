# Changelog

## Unreleased

### 2026-10-02 — block unacknowledged accounting admission ([#269](https://github.com/callin2/ghostflow-language/issues/269))

Bug fix restoring Reference §3.10 `on_unknown = block`: rolling reservation
admission now rejects a ledger whose current revision lacks durable
acknowledgement before any reservation, revision or persistence mutation.
Previously `initializeEmpty` with a failed write produced Unknown reads but a
5s reservation could still be inserted. Missing/corrupt ledgers remain blocked;
pending exact retries also block until explicit `persistPending` recovery, then
known duplicates remain idempotent. REF-03-080 compares the same canonical
count-fault-to-false program and source-derived protective policy over actual
native/WASM ABI traces, complete ledgers and admission outcomes. This is
source-bound reference-host admission, not automatic VM/resource or physical
binding. No source grammar or serialized ABI format changes.

### 2026-10-02 — live Range Duration setting retimes active occurrence ([#265](https://github.com/callin2/ghostflow-language/issues/265))

Reference §3.5 `range(duration)` now accepts a `Duration` config for executable UTC Daily/DailySlots GFB12 Range without a work calendar. A successful atomic live settings event recomputes the active occurrence from the frozen planned start: 08:00 admitted at 08:04 with 10min, then edited at 08:07 to 12min, remains the same occurrence and ends at 08:12; editing to 5min ends it at the event position. No new due pulse or occurrence ID is emitted, and the accepted duration is persisted in the GFRGv2 checkpoint so the next occurrence uses the live value after restore. Invalid typed values become the existing settings-fault decision without changing the accepted duration. REF-03-076 covers native/WASM trace and checkpoint parity. The GFB12 encoding uses a zero duration sentinel followed by the existing config id; older GFB12 consumers reject this new encoded form.

Live Range configs require a positive minimum Duration at compilation, matching
the runtime loader. Unsupported calendar binding and overlap-changing live
proposals reject explicitly; rejected envelopes leave the settings revision and
complete context checkpoint unchanged. Retime also works while clock trust is
unknown or wall correction crosses a date, using the admitted frozen origin.

### 2026-10-02 — incomplete durable event counts ([#268](https://github.com/callin2/ghostflow-language/issues/268))

The WASM accounting adapter now returns `LedgerIncomplete` when a known ledger's
latest revision lacks durable acknowledgement. Previously it retained
`LedgerMissing` from initialization after an event's persistence failed. Missing
and corrupt ledgers retain their distinct faults; successful acknowledgement
recovers the exact count. REF-03-079 compares actual native/WASM control traces
and serialized ledgers. A private production conversion boundary test checks
`CountOverflow` without allocating billions of event records.

### 2026-10-02 — durable rolling budget explanation ([#260](https://github.com/callin2/ghostflow-language/issues/260))

Reference §4.15 now has a source-bound reference host query over the real Rust
ledger, including durable revision, budget denial and earliest conditional
release. Overlapping [0,20s]/[10s,30s] intervals with a 60s window, 30s limit and
5s proposal reject at 64.999s and admit at 65s, independently of OFF animation.
REF-04-066 checks restore/activation and unacknowledged persistence. Bindings
copy and freeze source limits, fixing a bug that violated checked-source policy:
previously changing the public limit to 99s admitted an unauthorized reservation;
now that mutation throws and a mismatched reservation rejects. The before/after
probe and immutable-binding regressions verify the restored contract.
Rebuild WASM for the additive query export; GFB/snapshot formats are unchanged.
See [the host contract](docs/ROLLING-BUDGET-EXPLANATION.md) for trusted evidence,
local revision and integration limits.

### 2026-10-02 — bounded adaptation admission bug fix ([#258](https://github.com/callin2/ghostflow-language/issues/258))

Reference §4.14 policy bounds were omitted from compiled descriptors and no
reference host enforced proposal rates. Compilation now checks and carries
typed bounds; the fresh `AdaptationSettingsHost` validates trusted actor authority
and all proposed properties before one existing atomic Rust settings event.
After 20%→30% consumes a 10% hourly budget, a two-property proposal including
30%→25% rejects both without changing values or revision. REF-04-064 checks actual
WASM activation and snapshots, absolute rolling budgets, exact Int/Duration grids
and bounded identity/history admission. GFB/WASM ABI is unchanged; regenerate old
adaptation manifests because bounds are now required. This reference profile
does not provide settings checkpoint recovery or API/Device integration.

### 2026-10-02 — Station atomic mode-entry binding bug fix ([#250](https://github.com/callin2/ghostflow-language/issues/250))

Reference §4.10 rejects every conflicting same-tick mode entry. The WASM adapter
previously exposed only `enter()`: sequential Manual then Configure could select
Manual from Stopped. `enterBatch([{requestId: 5n, ...claim, mode: 'Manual'},
{requestId: 6n, ...claim, mode: 'Configure'}])` now reaches the existing atomic
Rust contract and rejects both without mutation or deferred entry. Hosts still
dispatch an observed Stop before entry/new work. Existing single-entry exports,
source profiles and GFB/GFS formats are unchanged; batch callers require the
additive `gf_station_enter_batch` export. REF-04-052 covers native/WASM parity,
Stop cleanup and explicit retry, with malformed batch and stale-claim guards.

### 2026-10-02 — composed EMA signal execution ([#237](https://github.com/callin2/ghostflow-language/issues/237))

Reference §4.3's named numeric EMA stage now compiles to bounded shared Rust VM
state. Previously `signal smooth = ema(moisture, alpha: 0.5);` was rejected,
preventing the documented sensor median → EMA composition. The EMA consumes the
upstream Result and original physical sample identity: duplicates and clock-only
ticks leave its recurrence unchanged; faults clear memory and retain their
provenance. Upstream readiness/recovery and freshness remain authoritative.
Each single-source EMA uses three scalar slots plus two source-identity slots;
source epoch changes reseed. No bytecode/ABI format changes or implicit recovery
policy are introduced. The supported stage requires numeric SensorFault Result
with one physical source. REF-04-024 native VM/plain/framed WASM traces and
atomic rollback/invalid-contract regressions cover this restored behavior.

### 2026-10-01 — executable work-calendar boundaries ([#225](https://github.com/callin2/ghostflow-language/issues/225))

Reference §3.8's `calendar_is` Result expression and immutable UTC Daily
work/off-day ranges now use the shared Rust context engine through GFB18 and
`GhostFlow/control-v18`. Previously these adopted forms lacked executable
lowering. The host supplies identified calendar snapshots; Rust preserves
missing, out-of-coverage and expired faults. A Result cannot be negated into
permission without explicit fault handling. Work ranges crossing midnight are
rejected; split `23:45` plus `range(15min)` and `00:00` plus `range(15min)` into
separate declarations. Ranges ending at midnight are valid. Ordinary UTC ranges
retain their existing behavior. The bounded profile requires explicit UTC
bindings; it adds no shift ownership, non-UTC Range policy or Run overlap rule.
Older loaders reject GFB18. Regression evidence is the exact REF-03-041 oracle
in `tests/reference-calendar-boundary.test.mjs` and shared-core/native/WASM checks.

### 2026-10-02 — signed current Periodic package admission

The package verifier previously rejected the current compiler's
`config interval: Duration = 15min` plus `schedule cycle: Periodic` result
because GFB11 was limited to config-only preludes. Signed GFB11/control-v10
packages now admit that bounded Periodic form when its scalar config, instant
anchor, generated ports and schedule descriptor match the bytecode. Other
schedule kinds and unsupported preludes remain rejected. Existing source and
signature verification, config bounds and Device admission stay required.
Regression: signed REF-03-036 reaches the native target loader; re-signed
descriptor substitutions fail before it. This restores the intended package
path for [Device issue #74](https://github.com/callin2/farm-device/issues/74).

### 2026-10-01 — bound authored-state provenance bug fix ([#158](https://github.com/callin2/ghostflow-language/issues/158))

An intent-linked authored Bool state in the finite bound-resource profile now
compiles through the browser API and produces its completed-scan observation.
Previously, attaching an intent anchor to the nonexecutable descriptor crashed
literate source remapping because executable trace arrays were absent. The
descriptor now supplies an explicit empty provenance shell; binding retains the
actual lowered program's runtime bindings and adds only the descriptor's intent
anchors and links. No executable metadata is inferred from missing fields.
`tests/bound-resource-control.test.mjs` verifies canonical state/anchor positions
and actual WASM `remembered` observations changing from `true` to `false`.

### 2026-10-01 — browser bound-resource modules ([#158](https://github.com/callin2/ghostflow-language/issues/158))

The public browser compiler now exports bound-resource compilation, verification,
and trace observation. The runtime is portable at
`runtimes/wasm/bound-resource-control.mjs`; the current Node import reexports the
same implementation and writer registry. The finite GFB17 policy and Rust
execution semantics are unchanged. Writer reservations include asynchronous
creation within one realm. Cross-Worker installations require a shared host
registry and this API provides no physical guarantee.

Checked resource descriptors can now emit an interaction schema with an explicit
document/revision identity. Binding regenerates its module identity against the
executable bytes; verification rejects forged schema metadata. The existing
canonical mapping, runtime parity and mismatch checks remain, with browser graph,
pending-writer and disposal/reinstantiation tests in
`tests/browser-toolchain.test.mjs` and `tests/bound-resource-control.test.mjs`.

### 2026-10-01 — bound finite resource enforcement ([#158](https://github.com/callin2/ghostflow-language/issues/158))

Reference §4.8 now distinguishes source checking from executable resource binding.
Previously, `constraints Shared for station { ... }` produced only a checked
nonexecutable descriptor. `compileBoundResourceControl(checked, binding)` now
builds a guarded GFB17 profile for a Bool GFB1 v1/v3 request control. The binding
pins the canonical source/descriptor, installation revision, stable resource IDs,
and complete finite mode/output mappings. Each group supports one exclusive activity
set or requirement-only execution; multiple exclusive statements are rejected rather
than flattened. Every output needs explicit protection;
missing bindings and unsupported profiles fail closed. No implicit output or
physical safety sequence is supplied.

The portable Rust guard owns admission and the final logical output projection.
Conflicting new activity cannot displace an incumbent or enter a hidden queue.
Predicted prestart violations deny admission without new output actuation. Ongoing
violations use the authored safe vector, including true values, and require neutral
then fresh requests before recovery. Overlapping mandatory groups combine as AND;
inconsistent safe values reject. Existing local requirements remain mandatory.
One host-owned registry covers every supported writer; duplicate ownership rejects.
Explicit activation and matching binding identity on every scan prevent ordinary
tick/scan bypass. Failed evaluations roll back guard, VM and decision evidence.

Unbound compilation stays nonexecutable; clients opt in with the exact binding
and guarded APIs. Accounting, imports, Station advisory checks and fixed Station
leases retain their existing contracts. This finite logical profile does not
implement contextual/continuous/PID execution, cooperative multi-control arbitration,
physical Driver adoption or hardware confirmation. Complete bilingual example:
`examples/bound-resource-execution.ghost.md`. Regression evidence covers actual
native/plain/framed WASM and reference simulation, binding forgery, admission,
non-OFF violation response, recovery and writer/bypass rejection.

The decision trace increases the current wasm32 framed replay header from 192
to 200 bytes per frame (24 additional bytes for three frames). The planner counts
the actual compiler layout; existing temporal budgets and historical reports stay
unchanged, so callers must allow this header overhead in their peak replay budget.

### 2026-10-01 — canonical control-owned constraint groups ([#157](https://github.com/callin2/ghostflow-language/issues/157))

Reference §4.8 distinguishes local output, shared-resource and accounting scope.
One control can now group existing Bool output rules as
`constraints Local { require at safe_output pump => valve; }`;
the previous compiler accepted those rules only ungrouped. Grouping preserves
the existing native/WASM output projection, including fixed-point denial and
recovery, and keeps source-linked rule observations.

The existing targeted syntax `constraints Shared for resource { ... }` can
be checked inside the same control. Its explicit `safe { alias = false; ... }`
vector must cover its finite Bool resources and satisfy its mandatory predicates;
false is not inferred as a universal safe state. Shared contracts produce only
an explicitly nonexecutable descriptor pending #158 binding and enforcement;
they cannot be silently stripped into runnable bytecode. Existing import,
instance and connect semantics and accounting limit syntax are preserved.
The standalone `ghostrules` profile remains solely for concrete Station demo
and Station WASM consumers, with its restricted contract documented separately.
No physical output ABI or safe sequence is introduced. Recompile grouped
sources with the new compiler; existing ungrouped sources remain valid.
The reference logical mapping validator pins canonical source and artifact hashes,
stable resource identities and finite Bool input/output ports, rejecting missing,
mismatched or disguised bindings without granting execution. Its complete
software-only example is `examples/shared-constraint-contract.ghost.md`.
Regression evidence: complete `examples/constraint-envelope.ghost.md`, grammar
and invalid safe-vector checks, actual native/plain/framed-WASM parity, missing
references, unsupported advisory stages and execution-without-binding rejection.

### 2026-10-01 — accounting-only artifact profile ([#210](https://github.com/callin2/ghostflow-language/issues/210))

An executable accounting source now selects `GhostFlow/control-v10` even when
it contains only `on_time` accounts and no context-producing expressions.
Previously, `account used = on_time(pump, stage: applied, persistence: durable);`
could retain control-v1, so the canonical source-bound WASM ledger rejected its
existing accounting metadata. This fixes the documented binding contract without
changing syntax, GFB bytes or the ledger ABI; recompilation corrects the profile.
Reference §3.4 is unchanged. REF-03-020 compares actual native/WASM historical
rolling calculation for regular and irregular partitions, including partial
overlap and snapshot replay. Control admission, live cutoff and physical receipt
validation remain outside this fix.

### 2026-10-01 — shared Solar/config execution ([#145](https://github.com/callin2/ghostflow-language/issues/145))

Solar and live typed configuration now execute in one staged Rust context;
the compiler previously rejected their composition. For example,
`when = case enabled { ok(v) => v; fault(_) => false; };` reads the same
current Result as ordinary control. Any config fault referenced by `when`
preserves `Unknown(SettingsFault)` even if its fault branch returns true;
unrelated faults do not suppress Solar. Recovery establishes a baseline without
catch-up. Failed evaluations consume neither events nor occurrences. This
prevents stale success from authorizing an occurrence. See
[Reference §3.5](docs/reference/03-time-and-schedules.en.md#35-common-schedule-semantics)
and the [execution guide](docs/SOLAR-CONFIG-EXECUTION.md).
GFB16/tag16 selects control-v15 and GFSF6 Solar facts with immutable compiled
binding checks. GFCX3 retains its wrapper and adds GFES subtype3 Solar state.
The explicit compatibility decision retains concrete standalone Solar #28/#29
consumers and GFSF5 non-Solar profiles, including calendars; neither is a fallback
for rejected shared source. Older loaders reject GFB16. Compiler and native/
WASM/ghostsim regressions cover dependency tampering, current fault/recovery,
rollback and durable deduplication. Literal DailySlots mixing and #153 Window/
Run overlap remain outside this change; no Device adoption or physical operation
is claimed.

### 2026-10-01 — explicit public-holiday execution and immutable calendar composition

Daily `on = day\`holiday\`; calendar = public_days;` now executes membership in
a typed HolidayCalendar using the shared Rust core, alongside work/off-day
schedules. Holiday membership remains independent of work exceptions. The Node
reference adapter supplies pinned Korean 2026–2027 facts
and explicit base/overrides with new IDs, content revisions and provenance;
farm weekly/holiday policy remains explicit. Missing, expired or uncovered data
preserves Unknown. Shared bindings require identical snapshots; revision contents
remain immutable across ticks and durable restore. See [Reference §3.8](docs/reference/03-time-and-schedules.en.md#38-dst-midnight-and-work-calendars)
and the [provider guide](docs/CALENDAR-PROVIDERS.md).
Holiday execution selects GFB15/control-v14; GFSF5 stays unchanged. GFCXv3
persists bounded calendar history and rejects v1/v2 checkpoints. Older loaders
reject the new header. Weekday grammar [#155](https://github.com/callin2/ghostflow-language/issues/155)
remains separate. Provider, compiler, native/WASM/ghostsim and checkpoint
regressions validate host execution; no Device or physical operation is claimed.

### 2026-10-01 — one-shot At pulse ([#154](https://github.com/callin2/ghostflow-language/issues/154))

`schedule appointment: At { at = datetime\`2026-01-01T08:00:00Z\`; ... }`
now compiles and executes an absolute singleton pulse in the shared Rust core,
WASM host and ghostsim. The six common policies remain required; this bounded
profile accepts pulse/trusted-only/baseline/skip and rejects other bases and
timezone/DST/cancellation fields. Trusted crossing admits once; false, gap and
past boot/recovery baseline consume a terminal miss. Rejected scans do not
consume, and matching restored checkpoints preserve deduplication after reboot.
GFB14/control-v13 make older loaders fail closed; scan transport is unchanged.
Signed portable packaging remains unsupported. See [Reference §3.5](docs/reference/03-time-and-schedules.en.md#35-common-schedule-semantics).
Compiler and native/WASM/ghostsim boundary, recovery, rollback and checkpoint
regressions cover this addition; logical admission makes no physical claim.

### 2026-10-01 — portable adaptive strategy metadata

Portable packages now accept compiler-produced paired adaptation descriptors.
Canonical source replay and native decoded strategy/query bindings reject
re-signed descriptor or bytecode changes. Optional Bool feedback preserves the
absent baseline and explicit present strategy in native/WASM execution. GFB,
wire formats, ABI and signature policy are unchanged. See
[Portable package](docs/PORTABLE-PACKAGE.md#adaptive-strategy-descriptors).


### 2026-09-30 ? checked duplicate constraint replacement ([#31](https://github.com/callin2/ghostflow-language/issues/31))

Compilation can merge adjacent identical ordered Bool output constraints after
independent bounded effect verification. For example, two consecutive
`require pump => valve;` declarations retain one executable check and both source
origins. The transformed source map and joined observations use host v2 formats;
the removed check has certified derived replacement evidence and is never reported
as executed. Existing lowering remains unproven. Programs outside this bounded
slice keep their original path. GFB instructions, native/WASM ABI and source
grammar remain unchanged; older host metadata consumers reject v2, and affected
packages must be rebuilt from canonical source rather than bypassing replay.
See [the replacement contract](docs/CHECKED-CONSTRAINT-REPLACEMENTS.md) and its
compiler, proof-tampering, source recovery and native/WASM parity regressions.

### 2026-10-01 — explicit native development signature policy

The native portable-package verifier offers an explicit development opt-out for
publisher authentication. The existing API remains enforcing. Unsigned or
untrusted packages still pass the same integrity, compatibility and loader
checks; bypass results explicitly report `DevelopmentBypass` and no accepted
keys. This does not enable a Device profile or change DSL/VM semantics. Native
package regressions cover strict rejection, development admission, malformed
signature metadata and retained payload/source/bytecode/binding rejection.

### 2026-10-01 — bounded natural-event fallback ([#29](https://github.com/callin2/ghostflow-language/issues/29))

Reference §3.4 now permits Solar/Tide `clock = hold_trusted(5min, terminal: skip)` and Solar `fallback = fixed_time(time`06:00`, terminal: skip)`; previously only trusted-only clock and skip fallback were accepted. Hold expires at the strict duration boundary; absent anchors/uncertainty fail closed. A fallback consumes the same source-date Solar identity through recovery and checkpoints. Facts providers resolve IANA civil time; ambiguous/nonexistent times skip. Extended policies select GFB13/control-v12 and Solar GFSF6; legacy bytes remain unchanged and older pinned runtimes reject GFB13. The signed portable-package GFB11 profile remains narrow. Regression coverage: `natural-fallback-compiler.test.mjs`, `natural-fallback-runtime.test.mjs`, core `solar_tape`; execution results are reported separately, with no physical Device claim.

### 2026-10-01 — paused Solar observation ([#402](https://github.com/callin2/ghostflow-language/issues/402))

Explicit paused observations now retain Solar terminal identities without running
the authored program or creating a scan. For example, an occurrence observed
while paused remains consumed after resume/reboot. Previously skipping the native
observation could fire that occurrence on resume. Program-logical time may freeze;
actual wall/trust remain supplied. Malformed observations reject atomically.
`schedule_module` and the pinned Device adapter regression cover the boundary.
No syntax, GFB/WASM ABI or generic lifecycle interface is added.

### 2026-10-01 — durable framed Solar admission ([#400](https://github.com/callin2/ghostflow-language/issues/400))

The Rust owner API now frames GFB5 Solar scans and exports/restores bounded
terminal occurrence identities for the exact program. Previously a Device
consumer could not preserve native Solar duplicate suppression across restart.
For example, restoring `solar_checkpoint()` before the first scan retains a
consumed occurrence while the new boot establishes a fresh clock baseline.
Malformed, mismatched or over-capacity checkpoints reject atomically. Hosts must
persist admission before publishing ON. `schedule_module` tests cover restore,
framed rollback and retry. Source syntax, GFB and WASM ABI are unchanged; this
does not claim physical actuation or supply the remaining civil checkpoint API.

### 2026-10-01 — bounded estimate-basis evidence API ([#398](https://github.com/callin2/ghostflow-language/issues/398))

The portable core admits explicit requested or acknowledged-write histories under
an immutable reference and finite capacity. Native/WASM retain exact execution
origin, original receipt time, declared coverage and known/unknown uncertainty.
Malformed inputs reject atomically; gaps, changed context and failed/uncertain
writes invalidate continuity with their cause. This adds an evidence API only:
no source syntax, Result/Quality status, numerical model or temporal permission.
Existing sensor arithmetic and measured-only admission remain unchanged. Parent
#385 still owns executable estimate declarations and calibrated-duration examples.

### 2026-09-30 — execute immutable UTC Range ([#152](https://github.com/callin2/ghostflow-language/issues/152))

UTC Daily and static nonempty DailySlots `range(duration)` controls now execute as GFB12. Admission uses the remaining half-open planned interval; cancellation consumes the occurrence, and ongoing completion uses monotonic time through wall corrections or clock-trust loss. Checkpoint recovery retains deduplication without resuming an active timer. Other accepted Range variants remain descriptors. Compiler, native/WASM/ghostsim parity and failure-boundary tests cover the bounded slice; no physical device verification is claimed. Older bytecode consumers reject the new format explicitly.

### 2026-09-30 — reject ignored input initializers ([#151](https://github.com/callin2/ghostflow-language/issues/151))

Bug fix, Reference §1.6: `input x: Bool = false;` previously parsed but silently
discarded its initializer. It now fails at `=` in the original source, including
canonical literate documents. Migrate to `input x: Bool;` and supply the value from
the host; no implicit default or fallback is introduced. State initialization and
type-only output declarations are unchanged. `tests/compiler.test.mjs` covers
rejected initializers, source locations, and valid host inputs with state/output
declarations. `tests/control-host.test.mjs` verifies missing-input rejection and
explicit true/false values through real WASM. No GFB/ABI change is required.

### 2026-09-30 — native scenario Percent input bug fix

The native scenario runner now accepts finite `Percent` inputs in the inclusive
0..100 range, preserving their numeric values for both initial inputs and input
actions. Previously the public simulator validated these inputs but its native
transport rejected them as an invalid type, including programming example E32.
For example, `input level: Percent;` with a host value of `33.5` retains `33.5`.
Invalid values and nominal type mismatches remain rejected. This restores the
existing Percent contract (Reference §2.1); no source migration or GFB/ABI change
is needed. Coverage: native `scenario_scan` unit tests, `tests/ghostsim.test.mjs`,
`tests/ghostsim-input-validation.test.mjs`, and E32 in
`tests/programming-book-simulation.test.mjs`. Prerequisite for
[#151](https://github.com/callin2/ghostflow-language/issues/151).

### 2026-09-29 — pinned sensor and function composition ([#377](https://github.com/callin2/ghostflow-language/issues/377))

Reference §6.4 sensor connections and imported pure functions now execute, instead
of being rejected as unsupported composition. For example, `connect high.air <- air;`
feeds the root raw sample into `high`'s own unchanged sensor conditioning. Payload,
optionality and sample interval must match. Function/local names remain isolated.
Public root sensors stay in `manifest.sensors`; consumers activating these programs
must support `manifest.sensorInstances` routing. Existing standalone programs and
GFB/WASM/frame interfaces are unchanged. `tests/composition-execution.test.mjs`
checks filtering, faults, recovery, staleness, rollback, invalid wiring, provenance
and native/WASM conditioned-frame parity.

### 2026-09-29 — explicit relative-humidity ratio ([#371](https://github.com/callin2/ghostflow-language/issues/371))

Reference §2.9 now permits `RelativeHumidity / RelativeHumidity -> Number`,
previously rejected. For example, `60%RH / 100%RH` produces `0.6` for an authored
air-VPD calculation. All other RH arithmetic, cross-quantity division and implicit
numeric conversion remain forbidden. Constant/dynamic zero division retains the
existing diagnostic/tick rejection. The compiler uses existing division bytecode;
no GFB/ABI change or source migration is required. Regression coverage:
`tests/relative-humidity-ratio.test.mjs` (constants, nominal rejections and native/WASM outcomes).

### 2026-09-28 — framed civil schedule bug fix ([#366](https://github.com/callin2/ghostflow-language/issues/366))

Before this fix, framed civil schedules were rejected. They now use the same
Rust core for `Daily` and `DailySlots`. Activation accepts
`{bootEpoch, terminalCapacity}`. The provider supplies GFSF v2/v3 schedule facts
separately at scan time. Matching WASM exports are required. Rust admits
occurrences and owns their ledger; the host validates the complete input set
and schedule-fact packet, and does not derive runtime `due`, `ok` or `fault` values. A known rejection
rolls back for same-frame retry; a post-commit failure preserves the committed
result. Framed Solar remains unsupported.

Regression coverage is in `tests/framed-control-host.test.mjs` and
`crates/ghostflow-core/tests/schedule_module.rs`. See
[Framed ControlRuntime](docs/FRAMED-CONTROL-HOST.md).
