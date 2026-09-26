# Native Solar admission integration

Ground truth: Reference §3.4–3.8 and the existing GFB5 Solar pulse contract.
This is an implementation record; it does not change the language contract.

## Implemented

`Runtime::activate_with_solar` accepts a schedule-only GFB5 module and an
explicit boot epoch and terminal identity capacity. `tick_with_solar` takes a
ClockSnapshot and complete provider occurrence facts in descriptor order, bound
by declaration site. The provider must derive the facts from the installed
Solar descriptor (timezone, latitude, longitude, event, offset and revisions).
The provider supplies facts, never a precomputed `due` bit.

The native VM stages Rust SolarPulseEngine admission, evaluates the bytecode
`when` predicate only at an eligible crossing, supports reads of preceding
schedule projections, and runs scalar transitions/intents against those
projections. Clock, terminal ledger, scalar state, output and journal commit
together. Any failure discards staged schedule changes. Rejected ticks remain
retryable. `TickRecord.schedule_trace` and its JSON encoding retain decisions
and per-occurrence provider/context revision evidence.

A caller selects 1–4096 terminal identities per schedule. The batch is bounded
by that capacity. Revision text is limited to 128 UTF-8 bytes per field before
staging/retaining evidence. Exhaustion rejects the tick rather than evicting
identity history. These are explicit storage bounds, not a certified byte budget
or ESP32 deployment result.

## Evidence

`cargo test -p ghostflow-core --test schedule_module`: 21 tests pass, including
9 execution tests covering:

- baseline, exact crossing, duplicate suppression and JSON trace;
- false predicate terminalization rather than delayed execution;
- downstream arithmetic failure rollback, with successful retry;
- exact gap boundary, over-gap skip and all-missed multiple crossings;
- unknown clock, recovery baseline and wall-clock rollback;
- prior schedule projection dependencies;
- mismatched site/epoch, revision bounds and terminal capacity;
- explicit rejection of unbound ticks, rewind and mixed temporal preludes.

The first native execution test failed before implementing the new APIs and
passed after native binding. `cargo test -p ghostflow-core` and
`cargo check --workspace` pass.

## WASM provider-fact transport

`GhostFlowRuntime.activateSolar({ bootEpoch, terminalCapacity })` binds the same
native schedule-only engine through `gf_activate_solar`. After setting all scalar
inputs, including the matching `__gf_now_ms`/`__gf_time_epoch`, the host calls
`tickSolar({ clock, schedules })`. A successful tick consumes those scalar inputs,
as with other native ticks. `trace.scheduleTrace` retains native decisions.

The clock carries `monotonicMs`, `bootEpoch`, optional `wallMs`/`uncertaintyMs`,
`trusted`, `unknownReason` when untrusted, and optional `sourceRevision`.
Each ordered schedule entry carries `site`, `coverageFromWallMs`,
`coverageToWallMs`, and `rows`. Each row carries `sourceDay`, `available`, optional
`scheduledWallMs` (present exactly when available), `providerRevision`, and
`contextRevision`. The host cannot provide a due bit. These are provider facts;
this low-level transport does not independently verify an astronomical prediction.

The `GFSF` binary packet is version 1, little endian, capped at 65,536 bytes.
The header carries a u16 version and u16 schedule count (1–128). Clock fields are
u64 monotonic time, u64 boot epoch, optional wall time, optional uncertainty,
Bool trusted, reason string and revision string. Optional integers are a one-byte
presence flag followed by a u64 (zero when absent). A string is a u16 UTF-8 byte
length followed by at most 128 bytes. Each schedule contains u32 site, u64 coverage
start/end, u16 row count (0–4096), then rows of u32 source day, Bool availability,
optional scheduled time, provider string and context string. Booleans accept
only 0/1; all u64 values must fit the JS exact-integer range. Duplicate sites,
truncation, invalid UTF-8, trailing bytes and contradictory option flags reject
before runtime dispatch. Native admission validates occurrence coverage and
clock/site binding. Failed execution leaves admission and scalar state retryable.

`tests/solar-provider-wasm.test.mjs` verifies actual WASM admission, rollback,
duplicate suppression, provider trace evidence, unknown-clock recovery and all
packet truncations. Together with GFB5 encoding tests, 12 tests pass.

## Still required

No Reference acceptance ID is newly green from this native slice. Public Solar
compilation still rejects the canonical policy until the compiler emits its
GFB5 prelude and public ControlRuntime validates the policy manifest and transports
descriptor-bound provider facts through the new WASM API. ControlRuntime currently
expects `dueInput` on Solar descriptors; it does not yet bind this GFB5 path.
Existing host `due` inputs are not evidence of the native admission contract.

Mixed window/true_for preludes, durable checkpoint/restore/replay, calibrated
byte budgets, a descriptor-verified natural-event provider integration, and the
civil/Tide occurrence formats remain incomplete. Native plain activation,
unsupported mixed activation and rewind stay fail-closed. None of those missing
contracts is replaced by a host-computed pulse or a weakened Reference fixture.
