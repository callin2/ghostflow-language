# Trusted-only schedule clock gate

Status: native clock component implemented and accepted; VM/ABI integration pending.

This is the clock component of [Solar pulse admission](schedule-pulse-design.md),
grounded in Reference §3.1 and §3.5. It does not yet connect source schedules to
the VM or implement occurrence admission.

## Contract

- The caller supplies one immutable snapshot. The gate never reads a machine
  clock and has no implicit observation cadence or gap default.
- Construction requires a positive exact Duration gap and an explicit run epoch.
  Monotonic time and epoch are exact safe integers. Wall time is bounded by the
  Reference DateTime domain. Optional uncertainty is an exact nonnegative value.
- Validate range, run epoch and monotonic progression before state mutation.
  A different epoch requires a new run; it cannot silently reset this gate.
- Missing or untrusted wall time returns `ClockUnknown`. Preserve the original
  reason and opaque source revision. Missing uncertainty remains absent and does
  not itself invalidate a trusted wall instant.
- First trusted observation establishes `BootBaseline`. Trusted recovery after
  Unknown establishes `RecoveryBaseline`. Neither is an admission pulse.
- With consecutive trusted observations, compare monotonic delta and positive
  wall delta with the explicit gap. Equality is allowed; greater is
  `ObservationGap`. Wall rollback is accepted.
- Keep the previous effective wall instant separate from the trusted high-water
  mark. After wall values 1000, 900, 1050, the final positive delta is 150, not 50.
  A gap of 100 must therefore report `ObservationGap`.
- Expose both prior and updated trusted high-water marks to the downstream
  admission engine. An updated mark alone cannot classify a newly crossed event.
- Runtime integration stages a clone and commits it only with the successful
  whole tick. The component itself also preserves state on validation failure.

The live state contains fixed scalar fields. Snapshot/observation revision and
reason strings are borrowed, not retained in the gate. This makes no claim about
future owned fact/journal storage; that needs the explicit integrated resource
plan in [the wire proposal](schedule-wire-design.md).

## Acceptance boundary

Focused tests must cover exact gap and gap+1 for each clock, rollback followed by
a forward gap, Unknown/recovery, unchanged timestamps, optional uncertainty,
opaque revision/reason preservation, exact numeric bounds, epoch mismatch,
monotonic regression and discard/retry of a staged candidate.

Native component acceptance is not compiler, WASM ABI, occurrence deduplication,
held-clock policy, durable restore or complete schedule acceptance. The pending
multiple-crossing product decision does not affect this clock component.

## Evidence

- Sol implemented `crates/ghostflow-core/src/schedule_clock.rs`; root reviewed
  state mutation, prior versus updated high-water, and endpoint assertions.
- `build/schedule-clock-red.log`: the initial public clock API test failed to
  compile because the new types did not yet exist. This is not a runtime RED
  result for every later boundary vector.
- `build/schedule-clock-first-green.log`: initial clock path passed.
- `build/schedule-clock-final-green.log`: six focused tests pass, including
  accepted numeric endpoints, exact gap/gap+1, unchanged timestamps, provenance,
  exact rejection messages, unchanged state and discarded-stage retry equality.
- `build/schedule-clock-core-regression.log`: all 148 core tests pass, exit 0.
- `build/schedule-clock-catalog.log`: five catalog tests pass after Luna moved
  the unchanged core atomicity test locator by one line. Its digest is unchanged.
- `cargo fmt --all -- --check` and `git diff --check` pass.

No new full host gate or WASM build was run. The Rust API takes integer fields;
future fact-packet decoding must separately reject fractional host numbers.
