# Durable rolling budget explanation

`AccountingRuntime.explainRolling({ nowMs, windowMs, limitMs, reserveMs })`
reads a source-bound durable `on_time` account. The checked canonical source
selects the single rolling window, limit and proposed reservation; mismatches
reject. Copied immutable bindings retain that policy even if a caller attempts
to edit public metadata. The result includes the canonical source SHA, artifact
SHA, account/target, explicit host resource ID, query time, used union duration,
outstanding reservation duration, limit, proposed reserve, `blocked`,
`blockReason: 'rolling-budget'` on denial, `nextReleaseMs` and `ledgerRevision`.

The Rust ledger computes the same applied-interval union and outstanding charges
used by actual `reserveRolling` admission. With intervals [0,20s] and [10s,30s],
a 60s window, 30s limit and 5s proposal at 40s uses 30s and blocks. The earliest
admissible time is 65s: 64.999s still rejects, while 65s can reserve. The query
does not mutate the ledger or grant a start. Other admission failures such as
capacity or duplicate identities remain separate from this budget explanation.

`nextReleaseMs` is conditional on no new evidence. Outstanding reservations
remain charged until identified settlement/cancellation, regardless of elapsed
time or an OFF animation. If those charges plus the proposal exceed the limit,
no time release is promised. Already admissible budgets also return null.
The bounded search performs at most 64 union queries; timestamps saturate at
u64 maximum and never wrap. Queries before any stored interval's end return
Unknown because future-dated evidence cannot establish a decreasing forecast.

Unknown returns null, including uninitialized/corrupt state or an unacknowledged
mutation. Only exact persisted revisions yield explanation evidence. Revision
numbers are local to a live owner; restore starts at revision zero. Recovery
replays the durable snapshot and canonical source, not a cross-restart revision
counter. The host supplies validated applied evidence, stable resource bindings
and a comparable trusted monotonic timeline. No fabricated clock/binding revision
or physical receipt authentication is provided.

REF-04-066 exercises real WASM ledger denial, exact release boundaries, pending
persist Unknown, snapshot restoration and control activation. A separate context
ledger restored from the same snapshot produces an actual completed OFF output
observation; it does not cause the rolling denial or reset its ledger. Animation
is absent from the accounting API. This is a reference accounting projection,
not frontend renderer verification, automatic compiled `on_time` start/cutoff
integration, API deployment, storage-medium certification or Device validation.
The additive WASM export requires rebuilding the WASM module; GFB and ledger
snapshot formats are unchanged.
