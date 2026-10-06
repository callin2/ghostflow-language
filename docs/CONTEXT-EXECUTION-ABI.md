# Context execution ABI

GFB10 (`control-v9`) executes Periodic, Cron, WorkCalendar Daily, Tide Run,
config-backed DailySlots and natural/accounting Results in the portable Rust VM.
The public source remains one complete `.ghost.md` document. These binary and
internal lowering forms are transport contracts, not alternative product source.

## Ownership and commit boundary

The host supplies clock snapshots, provider observations, calendar snapshots,
resolved civil occurrence rows and explicit settings events. Rust validates
bindings and decides occurrence identity, due/missed/active, natural Result,
settings acceptance, terminal state and Run duration. Host-provided projections
are forbidden. Natural inputs use protected `__gf_natural_SITE_ok/value/fault`;
accounting uses `__gf_accounting_SITE_ok/value/fault`.

A context tick clones the context engines and stages provider validation,
settings changes, protected Results, schedule predicates and transitions.
Only a successful VM tick commits the staged context and trace. Rejected
packets or VM errors consume neither settings events nor occurrence identities.
Accounting observations already durably committed to the separate Rust ledger
remain committed if a subsequent scan fails. The accounting ABI constructs
Result values from that ledger; GFSF4 cannot carry accounting projections.

Provider bindings pin logical provider, kind, namespace, station, binding
revision, location, timezone, classification criteria and uncertainty threshold.
All views of one provider in one tick must share the same revision, coverage,
expiry, uncertainty and fault. Classification labels and occurrence rows are
separate payloads. Empty labels on an occurrence-side observation omit that
payload; empty labels on a natural observation certify an empty set. If both
views supply labels, their sets must agree. The envelope provider revision identifies the complete
snapshot; each Tide row provider revision identifies that event prediction and
may differ. Row context revision identifies its resolving context. An admitted
Run retains its original planned time and row revisions through completion. Coverage is `[start,end)`; expiry is invalid at `now >= expiry`.
Uncertainty is a certification threshold, not arithmetic on admission intervals.
A missing observation produces typed Unknown rather than fabricated evidence.

## Executable descriptors

### GFB18 calendar boundaries

`GhostFlow/control-v18` uses GFB18 for ordinary calendar Results and immutable
UTC Daily work/off-day ranges. Its new prelude tags are:

| Tag | Body |
| --- | --- |
| 17 Calendar Range | u32 site, string name, u64 gapMs, string timezone (`UTC`), u64 durationMs, u16 startCount followed by u64 startsMs, string calendar, u8 selector, Bool expression blobs when/cancel |
| 18 Calendar Result | u32 site, string name/calendar, u8 selector, string timezone (`UTC`), u16 ok/value/fault protected input indices |

Range selectors are workday 0 or offday 1; Result additionally permits holiday 2.
The source Range slice is immutable UTC Daily. Its half-open interval must end
at or before midnight; a work interval crossing midnight is rejected and must
be represented by separate explicit declarations. Ordinary UTC Range keeps its
existing semantics. Calendar eligibility is checked before new admission;
an admitted Range retains its monotonic deadline.

Both descriptors consume existing GFSF5 `schedule` facts keyed by site, carrying
the optional calendar snapshot. Result and Range require no provider observation
or civil occurrence rows. Rust derives the UTC date from trusted clock evidence
and evaluates the calendar, preserving missing, out-of-coverage and expired
faults. The Result projection is Bool/Bool/Number, with a finite CalendarFault
code. These inputs are protected; the host cannot supply eligibility projections.
Activation requires an explicit matching UTC calendar binding. Snapshot equality,
revision history, bounded retention and rejected-scan atomicity apply across
Result, Range and Daily pulse consumers sharing a binding. Existing facts and
checkpoint formats stay unchanged; older loaders reject the new GFB header.

GFB10 retains the GFB temporal header and tagged strategy preludes. Existing
tags 0–4 retain their layouts. Tags 5–9 begin with `u32 site, string name,
u64 gapMs`, and end with the Bool expression blobs `when, cancel`.

| Tag | Body between common prefix and expressions |
| --- | --- |
| 5 Periodic | string epochId, u64 anchorMs, string setting, u8 operatorEditable, u64 initialMs/minMs/maxMs/stepMs |
| 6 Cron | string timezone, u8 dstMissing/dstRepeated, five lists of u8 count followed by u8 field values |
| 7 Calendar Daily | string timezone, u64 atMs, string calendar, u8 offday/dstMissing/dstRepeated |
| 8 Tide Run | string timezone/provider, u8 high, i64 offsetMs, u64 runMs/withinMs |
| 9 Config DailySlots | string timezone/setting, u8 operatorEditable, u64 gridMs, u16 capacity, u16 initialCount, u16 minutes, u8 dstMissing/dstRepeated |
| 10 Natural Result | u32 site, string name, u8 kind, string provider/classification, u16 ok/value/fault input indices |
| 11 Accounting Result | u32 site, string name/account/event/timezone, u16 ok/value/fault input indices |

Natural projection types are Bool/Bool/Number; accounting types are
Bool/Int/Number. Fault Numbers carry finite enum codes. Opcode 58 fields 0/1/2
read due/missed/active. Settings retain their source identities even when
operator edits are disabled. An omitted access grant does not authorize edits.

All integers are little endian. Strings use u16 byte length and UTF-8;
expression blobs use u32 byte length. Provider identity strings are nonempty
and at most 128 bytes. Exact numerical transport values are at most
9007199254740991; Program fingerprints carry all 64 bits.

## Activation and facts

`gf_activate_context(handle, ptr, len)` consumes GFCA1:

```text
"GFCA", u16 1, u64 bootEpoch, u32 terminalCapacity,
u16 bindingCount, binding[]
binding := u8 kind, string provider/namespace/station/bindingRevision/
           location/timezone/criteria, u64 maxUncertaintyMs
```

Kinds are Tide 0, Moon 1, Calendar 2. Terminal capacity is 1–4096;
activation bindings are bounded by 128. Unused, duplicate or mismatched bindings
reject activation. Settings capacity and packet row capacity are separate from
the terminal ledger capacity.

`gf_tick_context(handle, ptr, len)` consumes GFSF4:

```text
"GFSF", u16 4,
u64 monotonicMs/bootEpoch, optional wallMs/uncertaintyMs,
u8 trusted, string reason/sourceRevision,
u16 naturalCount, observation[], u16 scheduleCount, schedule[],
u8 settingsPresent, [settings]

observation := binding, string providerRevision,
               u64 coverageStartMs/coverageEndMs/expiresAtMs/uncertaintyMs,
               u8 fault, u8 classificationCount, string classifications[]
schedule := u32 site, u64 coverageStartMs/coverageEndMs,
            u8 providerPresent, [observation], u8 calendarPresent, [calendar],
            u16 rowCount, row[]
row := u32 sourceDay, u64 slotKey, u16 minuteOfDay, u8 fold,
       string eventId, u8 eventKind, optional instantMs, u8 withdrawn,
       string providerRevision/contextRevision
calendar := string id/revision/timezone, u32 fromDate/toDateExclusive,
            u64 expiresAtMs, u8 weeklyWorkMask/holidayWork,
            u16 holidayCount, u32 holidays[],
            u16 exceptionCount, (u32 date, u8 work) exceptions[]
settings := u64 programFingerprint, string eventId,
            u64 baseRevision/position, u16 changeCount, change[]
change := u32 site, u8 kind,
          (u64 durationMs | u16 slotCount, (u64 key, u16 minuteOfDay) slots[])
```

Optional times contain `u8 present, u64 value` with zero for absent. Event kinds
are civil 0, high 1, low 2. Provider fault 255 means absent; codes 0–5 map to the
finite natural fault enum. Settings kind 0 is Duration; 1 is TimeSlots. Slot key
zero requests allocation; nonzero keys must already belong to the setting.
The complete keyed value replaces the old value. Event position is the next
successful scan number, and base revision must equal the current settings
revision. Settings and their scan commit atomically.

Activation/fact packets are bounded by 65536 bytes, section counts by 128 and
occurrence rows by 4096. Decoders reject trailing bytes and malformed tags.
Native entry points also validate payload bounds and descriptor compatibility.

## Durable context

`gf_context_checkpoint` captures bytes and effective settings JSON, exposed by
`gf_context_checkpoint_ptr/len` and `gf_context_state_ptr/len`.
`gf_restore_context_checkpoint(handle, ptr, len)` is permitted only before the
first scan of an activated run. The host owns durable storage and acknowledgement.

GFCX3 contains magic/version, the exact Program fingerprint, canonical binding
bytes, settings revision, accepted event identities, site-keyed engine snapshots,
and CRC32. It also persists full accepted calendar contents keyed by ID/revision,
bounded to `min(terminalCapacity, 128)` snapshots and 8192 holiday/exception date
cells; restore rejects changed revision contents or bound violations. GFCX1 and
GFCX2 are rejected explicitly. The wrapper is bounded by 4 MiB, each engine snapshot by 1 MiB.
Identity mismatch, corruption, invalid restored settings or capacity overflow
reject the whole restore. CRC32 detects accidental corruption; it is not an
authentication mechanism.

Effective Periodic phase/interval, keyed slots/allocator and terminal occurrence
identities survive restart. Clock observations and active Runs do not. Restored
runs establish a fresh baseline and cannot replay past occurrences. This is a
context checkpoint; it is not an accounting ledger or a general VM-state image.

## Shared Solar context extension

The layouts above describe the original context profile. Typed settings use the
GFSF5 envelope in [configuration streams](OPERATOR-SETTINGS-STREAM.md); calendar
Holiday Daily adds GFB15 tag15. Solar with shared config uses GFB16/control-v15
and the existing GFCA1 activation, retaining the GFB11 shared config descriptors.
Tag16 has the common `u32 site, string name, u64 gapMs` prefix, followed by:

```text
string timezone, f64 latitude, f64 longitude, u8 event,
i64 offsetMs, u64 fallbackAtMs,
u16 configDependencyCount, u32 configIds[],
expression when, expression cancel, u64 holdMs
```

Event is rise0/set1; fallbackAtMs 86400000 means absent, holdMs 0 means absent.
Config IDs are sorted and unique. Rust verifies exact dependencies from protected
`when` reads; any referenced current fault prevents admission. Binding fields
are immutable and must match the facts exactly.

GFSF6 retains GFSF5 through its optional settings section, then appends:

```text
u16 solarCount, solar[]
solar := u32 site, string timezone, f64 latitude, f64 longitude,
         u8 event, i64 offsetMs, u64 coverageStartMs/coverageEndMs,
         u16 rowCount, solarRow[]
solarRow := u32 sourceDay, u8 availability,
            optional scheduledWallMs, optional fallbackWallMs,
            u8 unavailableReason, string providerRevision/contextRevision
```

Availability is available0/unavailable1; reason255 means absent, 0–5 are typed
natural fault codes. Optional times retain `u8 present, u64 value` with absent
zero. Solar rows do not accept civil slot/fold fields; Rust fixes their identity
components to zero. `solarContextEvidence(descriptor, providerSchedule)` in
`runtimes/wasm/context-abi.mjs` projects provider facts into this packet; it
does not compute admission. A Solar context requires GFSF6; existing non-Solar
profiles retain GFSF5 by explicit compatibility decision.

Solar, the shared config vector and VM commit together. Failed evaluations
consume neither events nor occurrences. Successful recovery establishes a
baseline, with no past catch-up. GFCX3 embeds GFES subtype3 Solar engine state,
preserving source-day terminal identities and current config Results under the
exact Program/bindings while discarding clock observations for a fresh baseline.
Older GFB loaders reject format16. The standalone Solar consumers keep their
existing profile, not an implicit fallback. See the
[execution guide](SOLAR-CONFIG-EXECUTION.md) for scope and reproduction.

## Evidence

The test-only native `context_tape` profile `context-tide-v1` accepts bounded
Tide bindings and finite provider observations with explicit high/low event IDs.
Other profile guards remain separate; this profile accepts neither Moon/calendar
bindings nor natural-provider rails. The shared core owns admission. Native
records expose complete outcomes, source/settings state and context checkpoints,
including retained journal/checkpoint evidence after rejected facts for retry.

REF-03-029 compares the same compiled two-site Tide source in native and framed
WASM. Event E admits at 1000ms. Correcting provider/context revisions and moving
its planned time to 2000ms retains the actual admitted occurrence ID, original
revisions and 1000ms planned time while the existing monotonic Run is Active;
neither schedule emits another Due. After that Run ends, a corrected E scan at
2500ms leaves both run counters at one. The current core omits terminal Tide
IDs from later context observations; this evidence does not invent a literal
`AlreadyAdmitted` or `AlreadyTerminal` disposition. Fresh E2 at 3000ms admits
independently at both distinct source schedule sites. Full outcome/state and
checkpoint parity, matching-program checkpoint replay, forged binding rejection
and valid retry are checked. Context restoration does not restore general VM
state or active Runs. Provider facts are caller supplied; no provider authenticity,
physical output, production transport or new generic Run policy is claimed.

`context_runtime_tests` exercises protected inputs, shared-provider consistency,
VM-failure rollback, settings retry and identity-fenced durable restore.
`context_abi` tests cover packet rejection. Kind-specific boundary tests live in
`context_schedule`, `natural_context`, `work_calendar` and `cron_schedule`.
End-to-end Reference fixtures exercise canonical compilation and the same WASM
runtime rather than a host-side scheduling implementation.

## Temporary settings return origin

GFSF5/GFSF6 typed settings origin tag 2 is `temporaryReturn`. It retains operator-editable target checks and typed range/grid/capacity checks, and permits previously allocated TimeSlots row keys below the stream allocator bound for a Host-validated recorded return. Ordinary origin 0 and producer origin 1 retain their existing rules. Older runtimes reject the additional origin; it is not an authentication token. See [temporary settings host](TEMPORARY-SETTINGS-HOST.md) for the source-bound provenance and trusted Host inputs.
