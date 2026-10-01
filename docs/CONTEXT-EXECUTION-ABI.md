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

## Evidence

`context_runtime_tests` exercises protected inputs, shared-provider consistency,
VM-failure rollback, settings retry and identity-fenced durable restore.
`context_abi` tests cover packet rejection. Kind-specific boundary tests live in
`context_schedule`, `natural_context`, `work_calendar` and `cron_schedule`.
End-to-end Reference fixtures exercise canonical compilation and the same WASM
runtime rather than a host-side scheduling implementation.
