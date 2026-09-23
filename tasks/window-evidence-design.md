# Timestamped window aggregation: integration handoff

Current status: measured physical and nested window compiler/GFB/core/host/proof
integration is included in batch13. See `window-derived-design.md` for actual
evidence and remaining adapter replay/durability boundaries. The initial engine
handoff below is historical context; it is not the current completion status.

## Evidence and finite storage

The source sensor `sample` option describes expected cadence. It does not bound
bursts or prohibit distinct observations at the same timestamp. Activation must
receive each physical root's explicit `{maxObservations, intervalMs}` density
guarantee plus a target sample/memory budget. No installation values are invented.

For a window `overMs`, retained capacity is the checked sum over physical roots:

`maxObservations * ceil(overMs / intervalMs)`.

Use the full `overMs`, not `min(overMs, maxAgeMs)`: a new fresh point can make
older retained contributions usable again. Density histories also require bounded
storage, including observations ineligible for aggregation. Both committed and
candidate banks count against memory. Capacity/density violations reject the
stage atomically; they do not evict still-admissible samples. Allocation occurs
at activation, not per scan.

## Current engine

`crates/ghostflow-core/src/temporal.rs` exposes `Window::new`, `stage`, `commit`,
`rollback`, committed/staged contributors and outcomes. `RootDensity`,
`TargetBudget`, and `TimeContext { epoch, now_ms }` are explicit inputs.

- Membership is `(now-over, now]`; freshness requires latest age `< max_age`.
- Identity includes source tag, source epoch, ID and original timestamp.
- Duplicate observations do not create contributions. Timestamp ties are ordered
  by `(timestamp, source_tag, epoch, id)`; rate needs distinct timestamps.
- Average/min/max and per-second rate use actual finite measurements. Numeric
  overflow rejects the stage rather than producing an infinite successful value.
- An ordinary upstream fault retains admissible history and is recorded in the
  outcome. A root epoch change invalidates only that root's contributions.
- Same-time-epoch backwards time rejects. A replacement time epoch clears window
  and density history, retains source ID highwaters, and clears old-domain
  timestamp ordering. A cached observation cannot seed the new time epoch.
- Outcome revision advances only for a newly admitted observation. A derived
  aggregate has contributor/revision evidence, not an invented physical sample ID.

The fault-retention and derived-evidence rules need an explicit §4.4 reference
clarification before product integration. They must not accidentally inherit the
raw sensor filter's separate fault-clears-history rule.

Foundation evidence: `build/temporal-foundation-unit.log` (7 unit tests),
`build/temporal-conformance.log` (6 independent public-engine oracle tests).
The unit suite includes an allocation-count check across 200 staged operations.
These focused results are supplemented by the next complete host gate.

### Subsequent accepted foundations

- Opaque `WindowCheckpoint` captures committed history, density queues,
  identities, fault provenance, revision and time. Copy/restore reuse allocated
  buffers and require matching geometry/configuration, not identical budget
  ceilings. Focused evidence: `temporal-checkpoint-final.log` (10 unit tests),
  `temporal-checkpoint-conformance.log` (6 oracle tests), under `build/`.
- GFB4 requirements/decoder/verifier: twelve public loader cases pass, including
  malformed blobs, exact clock bindings, projection typing, dependency order,
  truncation and existing limits. The complete core run passed 108 tests:
  `build/temporal-module-core-green.log`. This proves loading and verification,
  not execution. Runtime integration proceeds under
  [the explicit wire and activation contract](window-gfb4-design.md).
- `tests/window-control.test.mjs` is registered in the host gate. Its source
  acceptance cases stay RED until real lowering is implemented. The batch10
  full-gate report predates these changes and does not certify this revision.

## Required integration

1. Introduce a real bounded stateful-operation facility in GFB/Rust execution.
   Scalar state unrolling and a JavaScript aggregation engine do not meet the
   requirement. Preserve existing budgets until a concrete profile change is
   justified.
2. Lower arbitrary supported Result expressions into a dependency-ordered,
   once-per-tick prelude. Produce typed transient Result projections. Source-only
   compilation records activation requirements without assuming device facts.
3. Include window arenas in the same scan commit/rollback and replay/checkpoint
   boundary as core state and physical conditioners. Durable restore requires
   source/time continuity evidence.
4. Add source descriptors, both WASM/native adapters, target activation contracts,
   contributor provenance and package validation together.
5. Preserve unchanged CLI accept expectations REF-04-027/028/029 and add absolute
   runtime oracle checks on all execution backends. Rate permits Temperature and
   the Reference's linear physical quantities, not every numeric type.

Estimated-quality evidence and the user-dependent `true_for` continuity choice
remain separate unresolved contracts. This design does not supply their defaults.

## GFB4 and native execution checkpoint (2026-09-23)

The earlier source RED status above is superseded. GFB4 encoding, compiler
lowering, Rust decoding and explicit temporal activation now execute physical
root windows. The core's final focused suite passed 124 tests
(`build/temporal-runtime-core-final.log`). The source/encoder suite passed 32,
and signed JS package regressions passed 56. Browser encoding also passed.

Batch11 rebuilt native and WASM artifacts. REF-04-027/028/029 now pass actual CLI
check/build. After correcting a test's error-message expectation to the existing
`division by zero` contract, the native source-to-Rust suite passed all three
tests (`build/window-native-green.log`): activation requirements, capacity
rejection, exact averages/minima/maxima/rates, contributor traces, and atomic
retry after a late expression fault. No runtime behavior was changed for that
fixture correction.

This did not finish the feature. At batch11, WASM/host temporal activation and
source-trace dependencies were still open; the next checkpoint below supersedes
that status. Native signed-package integration, derived window sources and
durable continuity/hot-swap migration remain unfinished. The virtual CLI adapter
requires explicit epoch/density/budgets; it supplies no device defaults.

## WASM, host and source-trace checkpoint (2026-09-23)

- Shared GFTA activation is independently validated by JavaScript and Rust.
  Both WASM adapters execute the existing core with explicit density/budget/epoch.
  `build/window-wasm-green.log`: 30/30; Rust ABI tests: 5/5.
- `build/window-host-green.log`: 16/16, actual legacy/framed host execution,
  exact four-operation results, expiry, dynamic fault and same-sample retry,
  immutable epoch, malformed profile and descriptor rejection.
- `build/window-provenance-available-green.log`: 6/6. Canonical replay pins
  windowSites and dependencies, including consumers. Re-signed substitutions
  fail before loading. Real native records project Derived quality and separate
  upstream faults; malformed identities, Int domains, future/expired samples,
  empty/stale success evidence and underdetermined successful rates reject.
- `build/window-provenance-green.log`: 63 relevant prior regressions passed
  before the final observer domain additions. Whole-gate evidence is recorded
  separately in `plan.md`; these focused counts do not imply full Reference compliance.

Root corrected initial host test assumptions about public observation fields,
sensor source tags and rate-fault selection. Those fixture corrections are not
production defects. Astra reviewed host profile/epoch handling and the final
observer identity/domain corrections. Native framed CLI/package integration,
nested derived evidence, estimated evidence and durable migration remain open.

Batch12 whole gate included these changes: Node 2,014 = 1,822 pass, 28 fail,
164 TODO, 0 skip. The 27 Reference failures remain; the sole other failure was
an existing allocation-guard test mock missing the new required activation
export. Its no-op mock was corrected without changing its rejection/allocation
assertions, and the focused test passed 1/1. Rust/native/WASM presteps passed;
tutorial did not run. The full report is preserved as failed. Source-hash review
confirmed that only that test fixture changed after the gate, not production
code. See `build/compiler-runtime-batch12-verification.json` and
`build/scan-frame-wrapper-focused.log`.
