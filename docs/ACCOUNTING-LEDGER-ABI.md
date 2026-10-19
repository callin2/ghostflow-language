# Accounting ledger primitive ABI

This ABI exposes the Rust accounting ledger to a host through WebAssembly.
GFB10 count Results execute inside the portable control VM using the paired
ledger. Source-bound rolling reservation admission is an explicit reference-host
operation; the ABI does not automatically bind control outputs to resources.

`AccountingRuntime.instantiateSource(wasmBytes, document, options)` compiles an
exact canonical `.ghost.md` document and selects one declared account by name.
It accepts durable `on_time` at the `applied` stage with a caller-supplied
`resourceId`, or durable `count_events` over `local_day` with a caller-supplied
`eventType`. The instance rejects record and query calls for other IDs and
operations. Its `source` record preserves the complete source document, source
SHA-256, selected account and target names, stage, and artifact SHA-256.
The supplied numeric ID still requires a trusted host binding to the physical
resource or Event. A restored ledger snapshot has no embedded source identity,
so the host must also verify that its durable storage belongs to that binding.
The source-bound reference host can explicitly prepare, settle and cancel rolling
reservations through this primitive. It does not automatically connect VM output
decisions to resource admission or certify physical application evidence.

Accounting-only sources select the accounting control-v10 profile even without
context-producing expressions. REF-03-020 executes the same checked source
binding against native Rust and WASM ledgers: identical ON/OFF boundaries are
partitioned by 1-second and repeating 7/13/9-second observations, and exact
60-second rolling overlaps agree at common logical times, including after
snapshot restoration and fresh replay. The native test runner loads the compiled
module and a host-verified manifest; it does not independently compile source.
These are historical calculations over caller-validated applied intervals, not
control admission, live maximum-ON cutoff or physical receipt certification.

## Evidence supplied by the caller

- Applied ON records are already validated and merged by the caller per stable
  physical resource. Each segment has a nonzero receipt ID and a positive
  monotonic interval. Receipt IDs are unique within a resource.
- The caller splits an interval at trusted local-day boundaries and supplies an
  immutable integer day key for each segment. The ledger does not resolve time
  zones or civil dates.
- Event records carry an opaque 16-byte ID and a typed event ID. Duplicate IDs
  within one Event type are idempotent. Reuse with different evidence is an
  error.
- The configured interval and event capacities are hard bounds. A rejected
  mutation must be treated as Unknown by the caller. The WASM ABI poisons its
  current ledger after record errors.

## Persistence sequence

Create starts Unknown. On first installation, the host explicitly initializes
an empty ledger. It then obtains a snapshot, writes it durably, and acknowledges
that exact revision. After each inserted record, reads return Unknown until the
host snapshots the new revision, persists it, and acknowledges it. A write
acknowledgement for a stale revision is rejected. Restored valid snapshots are
already acknowledged; missing or invalid snapshots remain Unknown.

Rolling reservation admission uses that same durable view. A known in-memory
ledger with an unacknowledged revision rejects admission before creating a
reservation, advancing the revision or invoking host persistence. This includes
an empty initialization whose write failed and an exact retry of a pending
reservation. Missing/corrupt ledgers also fail closed. Recover explicitly with
`persistPending` after a successful durable write; only then may an exact retry
return `Duplicate`. A failed reservation write retains its pending reservation
and Unknown reads rather than fabricating a grant or rolling it back. This
restores protective `on_unknown = block`; evaluating a count fault through
`case ... fault(_) => false` records no event and grants no start authority.

The native `accounting_admission_tape` example links the same production C ABI
through its Rust module/rlib for bounded conformance transport. A trusted test
host supplies the checked source manifest and explicit write acknowledgements;
counts/faults/admission decisions still originate inside the Rust ABI. It is not
a new caller-projected decision ABI or an automatic VM/resource binding.

The ledger snapshot is a versioned binary format with a CRC-32 corruption check.
The host owns storage and must preserve the bytes exactly. The primitive does
not itself certify the storage medium or atomicity of the host write.

## Current limits

The caller must provide monotonic timestamps comparable with stored intervals.
Bridging that timeline across reboot is not part of this ABI. The caller must
also supply trusted local-day keys and split segments at midnight. No bounded
event-ID retention or pruning policy is defined; exhausting configured event
capacity fails closed. These choices prevent this primitive from serving as a
complete `durable` compiler runtime binding yet.

## Native rolling overlap conformance

The test-only core `accounting_tape` transport accepts an optional `admission`
on a historical frame: a nonzero integer `reservationId`, `limitMs`, `reserveMs`
and Boolean `retry`. It validates the window, bound, reserve and `on_unknown =
block` against the selected account's checked source manifest before calling
the actual `AccountingLedger::reserve_rolling`. Results retain the native
decision, unchanged-snapshot evidence, optional exact duplicate retry, applied
usage and outstanding reservation usage. Existing observation-only tapes retain
their previous output shape.

REF-03-019 uses applied intervals `(0,20]` and `(30,40]`, a 60-second window,
30-second limit and 5-second reserve. At 40 seconds, usage is 30 seconds and
admission rejects without mutation. At 65 seconds, the window is `(5,65]`:
15 seconds from the first interval plus 10 seconds from the second give **25
seconds**, leaving exactly 5 seconds for admission. The original case's
15-second total at that time was an arithmetic error, corrected in the current
case while retaining its ID, backlink and pinned historical original.

The same compiled source and finite records produce native/WASM calculation
and known-admission parity. The native core transport explicitly serializes and
restores the ledger; the WASM reference adapter additionally proves that an
unacknowledged reservation stays Unknown and blocks retries until explicit
acknowledgement. Native core serialization is not that adapter's persistence
acknowledgement or physical storage certification. Neither test transport binds
VM outputs to physical resources or authenticates applied receipts.

## Selected reboot budget profile (REF-03-022)

REF-03-022 selects the existing durable applied profile with `on_unknown = block`.
After 28 seconds of applied usage, reboot without its durable checkpoint creates
an Unknown owner; the host must not use first-install `initializeEmpty` to erase
that history. Missing or corrupt history blocks a 5-second reservation without
revision, snapshot or persistence-call mutation. A valid checkpoint restores
28 seconds and still blocks that reservation under a 30-second limit. At
comparable monotonic time 63 seconds, the 60-second window retains 25 seconds
from `(0,28]`, so the 5-second reserve fits exactly. The native
`accounting_reboot_tape` production C ABI transport and source-bound WASM adapter
agree on these complete snapshots and admission outcomes. The caller owns the
comparable monotonic timeline across reboot. This selected profile does not
adopt automatic reset after window expiry or a non-durable profile.

## Local-day conformance transport (REF-03-048)

The bounded test host resolves Seoul midnight through installed Intl timezone
data, splits final applied intervals, and binds independent Automatic/Manual
logical pump requests to one supplied resource identity. Requests do not prove
physical application. The ledger unions overlapping applied intervals once:
23:50–00:10 contributes ten minutes to each local day and twenty minutes to a
separate rolling 24-hour query.

The test-only `accounting_tape` supports explicit segment day tags, bounded day
queries and optional complete record checkpoints. The test-only
`accounting_local_day_tape` links the production C ABI and compares full status,
checkpoint bytes, revisions and known/Unknown queries against WASM. Exact receipt
redelivery leaves usage and checkpoints unchanged. An invalid applied interval
does not mutate the primitive ledger, but the production C ABI conservatively
marks its history Unknown and advances its revision. Retry requires explicit
restoration of the saved trusted checkpoint; it does not silently reset usage.
These transports supply no production clock/binding provider, receipt
authentication or physical storage/application certification.

## Stop-delay reservation acceptance

REF-03-049 uses the authored finite expression `reserve = worst_case_on + stop_delay`, with 5min maximum ON and 2min stop delay. A 7min reservation cannot fit in 6min remaining. The native `stop_delay_reservation_tape` test transport links this production C ABI and matches source-bound WASM statuses, revisions, complete checkpoint bytes and rolling explanations through fresh replay. A restored outstanding reservation remains charged even after old applied intervals leave the window. Missing or corrupt durable evidence is Unknown; no elapsed-time refund or evidence-free settlement occurs. Only a separately supplied correlated applied receipt and explicit durable acknowledgement can settle the reservation. Resource identity, monotonic-time comparability, storage acknowledgement and receipt validation are trusted test-host inputs; this fixture does not establish physical cutoff, storage durability or automatic output admission.
