# `after_event` design record

Status: **product behavior selected; bounded Rust prerequisite implemented**.
This records Reference §4.4 and REF-04-026. It does not claim compiler
implementation acceptance.

## Required meaning

`after_event(event, predicate, window: d, quality: measured)` evaluates the
predicate from the identified event timestamp `e` over the half-open interval
`[e, e + d)`. The exact end boundary is excluded. The result is tracked per
distinct event identity. It must not be reduced to one global timer unless that
is explicitly selected as the product contract.

The compiler now parses `event started: Event;` and type checks the direct
`after_event(started, valve_open, window: 10s, quality: measured)` form. It
records the identified Event, directly declared Bool sensor, measured quality,
and positive constant Duration in a non-executable manifest descriptor. The
public `compileSource` path rejects at the `after_event` operator until the
Event delivery and per-identity result ABI are available. RED/GREEN evidence:
`node --test tests/after-event-contract.test.mjs` (0/7 before, 7/7 after).
REF-04-026's acceptance fixture does not yet prove executable semantics.

The Rust prerequisite is `crates/ghostflow-core::after_event::AfterEvent<N>`.
It uses fixed `[Option<EventResult>; N]` storage, tracks each `EventKey`
independently, applies measured predicates only in `[e,e+d)`, expires at the
exclusive boundary, and stages terminal acknowledgement transactionally. The
focused proof is `cargo test -p ghostflow-core --test after_event` (10/10).
`stage_batch` atomically stages a tick: expiry, acknowledgement of terminal
results, starts in source identity order, then the predicate observation. A
predicate at the start timestamp can satisfy all simultaneous starts; one at
an older event's exact end cannot satisfy that older event. A capacity or
observation error discards every staged mutation, including acknowledgements,
expiry, source identity high-water, and clock advancement. Explicit rollback
has the same isolation. This is a native API prerequisite, not a public Event
binding or scalar signal projection contract.
GFB/WASM encoding, event binding, per-identity projection, checkpoint/replay,
and provenance integration remain open.

## Required evidence and state

- Each physical predicate sample carries sample timestamp, epoch, id, quality,
  and value. The event occurrence carries its own timestamp and distinct
  identity.
- Event identity must remain opaque and collision-safe under the binding
  contract. A short hash shortcut is not an approved identity scheme.
- The implementation must define generated Event-present, Event-epoch,
  Event-id, and Event-timestamp inputs or an equivalent explicit ABI. Their
  retention and source binding must be inspectable.
- Accepted, rejected, faulted, and boundary evaluations must use the same
  transaction/checkpoint/proof rules as other temporal evidence. A rejected
  tick cannot partially advance event state or predicate evidence.
- Replay/checkpoint data must preserve event identity, source timestamp, epoch,
  and the evidence needed to distinguish a new event from a duplicate.

## Selected overlapping-event behavior

Maintain independent results for every distinct event identity. Overlapping
events remain distinguishable. A new event does not replace an older pending or
completed result. This fixes language behavior but does not yet choose the
bounded projection, retention, replay encoding, or resource geometry.

## Other unresolved contracts

- Scalar projection and retention of multiple active event results. For example,
  if event A has expired and overlapping event B is satisfied, the Reference
  form `opened |> recover(false)` does not say which identity supplies the
  scalar Bool. Encoding a GFB projection now would silently choose `latest`,
  `oldest`, or `any`, none of which preserves the selected per-identity result
  contract by itself. The artifact needs an explicit identity-indexed result
  view (or an explicit projection rule) and a bound on retained results.
- Meaning of pending and negative results.
- Lateness and delivery bounds for events and predicate samples.
- Event fault domain and quality transitions.
- Monotonic clock domain and epoch reset behavior.
- Resource limits for overlapping events and checkpoint proofs.

## Next GFB artifact contract

A new versioned prelude can carry site/name, Event source tag/name, Bool sensor
source tag/name, positive window, measured quality, and fixed input bindings
for Event presence/source epoch/id/timestamp and predicate sample identity,
timestamp, value, and quality. The loader must verify field types, distinct
bindings, source identity, and resource bounds before activation. Its per-event
result projection must include the Event key and Pending/Satisfied/Expired
status. Runtime tick processing can now use `AfterEvent<N>::stage_batch` for
starts and a predicate observation at the same timestamp, with one commit or
rollback. The host still needs an explicit delivery binding and resource
geometry. Identity-indexed projection and its scalar consumer meaning remain
unresolved before a public GFB descriptor can claim executable support. The
compiler's current located diagnostic remains the acceptance boundary.

The technical candidate of generated Event-present/epoch/id/timestamp inputs is
an implementation direction only. It is not an approved ABI or language
extension. Installed-program evidence, durable §6.8 identities, hardware event
delivery, and physical I/O remain outside this design record.
