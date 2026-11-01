# Durable rolling budget explanation

A **rolling budget** limits how long a resource may be ON within a sliding time
window (for example, "at most 30s of ON time in any 60s"). When a start is
denied by that budget, an operator or tool needs to know *why* and *when* it
could be allowed. `explainRolling` answers both questions without changing
anything.

**The call.** `AccountingRuntime.explainRolling({ nowMs, windowMs, limitMs, reserveMs })`
reads a durable `on_time` account that is bound to checked source:

- The checked canonical source selects the single rolling window, the limit and
  the proposed reservation. If the arguments do not match the source, the call
  is rejected.
- Copied immutable bindings keep that policy, even if a caller tries to edit
  public metadata.

**The result** includes:

- the canonical source SHA and the artifact SHA;
- the account/target and the explicit host resource ID;
- the query time;
- the used duration (the union of applied intervals) and the outstanding
  reservation duration;
- the limit and the proposed reserve;
- `blocked`, and `blockReason: 'rolling-budget'` when the request is denied;
- `nextReleaseMs` and `ledgerRevision`.

**Same arithmetic as admission.** The Rust ledger computes the same
applied-interval union and outstanding charges that real `reserveRolling`
admission uses, so the budget part of the explanation matches that admission
decision.

**Worked example.** Take applied intervals [0,20s] and [10s,30s], a 60s window,
a 30s limit and a 5s proposal:

- At 40s, the window is [-20s, 40s]. The union of the intervals is 30s, so 30s
  is used. 30s + 5s exceeds the 30s limit, so the request is blocked.
- The earliest admissible time is 65s. Then the window is [5s, 65s], 25s is
  used, and 25s + 5s fits the limit.
- At 64.999s the request is still rejected; at 65s it can reserve.

The timing diagram below shows the two applied intervals and the two windows.

![Applied intervals [0,20s] and [10s,30s] with 60s windows queried at 40s (blocked) and 65s (admissible)](diagrams/rolling-budget-explanation/release-example.svg)

The query does not mutate the ledger and does not grant a start. Other admission
failures, such as capacity or duplicate identities, stay separate from this
budget explanation.

**What `nextReleaseMs` promises.** `nextReleaseMs` assumes that no new evidence
arrives. Other rules:

- Outstanding reservations stay charged until they are explicitly settled or
  cancelled by identity. Elapsed time or an OFF animation does not release them.
- If those charges plus the proposal already exceed the limit, no time-based
  release is promised.
- If the budget is already admissible, `nextReleaseMs` is also null.
- The bounded search performs at most 64 union queries.
- Timestamps saturate at the u64 maximum and never wrap.
- A query earlier than the end of any stored interval returns Unknown, because
  future-dated evidence cannot establish a decreasing forecast.

**Unknown.** Unknown returns null. This includes uninitialized or corrupt state
and an unacknowledged mutation (a change not yet confirmed as persisted).

- Only exact persisted revisions yield explanation evidence.
- Revision numbers are local to a live owner. After restore, they start again at
  revision zero.
- Recovery replays the durable snapshot and the canonical source. It does not
  rely on a revision counter that survives restarts.

**Host responsibilities.** The host supplies validated applied evidence, stable
resource bindings and a comparable, trusted monotonic timeline. This API does
not fabricate a clock or binding revision, and it does not authenticate physical
receipts.

**Conformance (REF-04-066).** REF-04-066 exercises real WASM ledger denial,
exact release boundaries, Unknown while a persist is pending, snapshot
restoration and control activation. A separate context ledger, restored from the
same snapshot, produces an actual completed OFF output observation. That
observation does not cause the rolling denial and does not reset its ledger.
Animation is not an input to the accounting API.

**Scope.** This is a reference accounting projection. It is **not**:

- frontend cabinet-view verification;
- automatic integration with compiled `on_time` start/cutoff;
- API deployment;
- storage-medium certification;
- Device validation.

The added WASM export requires rebuilding the WASM module. The GFB and ledger
snapshot formats are unchanged.
