# Accounting ledger primitive ABI

This ABI exposes the Rust accounting ledger to a host through WebAssembly. It
does not make accounting declarations executable in a GhostFlow control.
`compileControl` remains fail-closed until compiler lowering binds account
expressions and constraint admission to this ledger.

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
This API does not perform control admission or settle reservations.

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
