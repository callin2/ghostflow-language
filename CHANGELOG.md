# Changelog

## Unreleased

### 2026-10-01 — bounded estimate-basis evidence API ([#398](https://github.com/callin2/ghostflow-language/issues/398))

The portable core admits explicit requested or acknowledged-write histories under
an immutable reference and finite capacity. Native/WASM retain exact execution
origin, original receipt time, declared coverage and known/unknown uncertainty.
Malformed inputs reject atomically; gaps, changed context and failed/uncertain
writes invalidate continuity with their cause. This adds an evidence API only:
no source syntax, Result/Quality status, numerical model or temporal permission.
Existing sensor arithmetic and measured-only admission remain unchanged. Parent
#385 still owns executable estimate declarations and calibrated-duration examples.

### 2026-09-30 — execute immutable UTC Range ([#152](https://github.com/callin2/ghostflow-language/issues/152))

UTC Daily and static nonempty DailySlots `range(duration)` controls now execute as GFB12. Admission uses the remaining half-open planned interval; cancellation consumes the occurrence, and ongoing completion uses monotonic time through wall corrections or clock-trust loss. Checkpoint recovery retains deduplication without resuming an active timer. Other accepted Range variants remain descriptors. Compiler, native/WASM/ghostsim parity and failure-boundary tests cover the bounded slice; no physical device verification is claimed. Older bytecode consumers reject the new format explicitly.

### 2026-09-30 — reject ignored input initializers ([#151](https://github.com/callin2/ghostflow-language/issues/151))

Bug fix, Reference §1.6: `input x: Bool = false;` previously parsed but silently
discarded its initializer. It now fails at `=` in the original source, including
canonical literate documents. Migrate to `input x: Bool;` and supply the value from
the host; no implicit default or fallback is introduced. State initialization and
type-only output declarations are unchanged. `tests/compiler.test.mjs` covers
rejected initializers, source locations, and valid host inputs with state/output
declarations. `tests/control-host.test.mjs` verifies missing-input rejection and
explicit true/false values through real WASM. No GFB/ABI change is required.

### 2026-09-30 — native scenario Percent input bug fix

The native scenario runner now accepts finite `Percent` inputs in the inclusive
0..100 range, preserving their numeric values for both initial inputs and input
actions. Previously the public simulator validated these inputs but its native
transport rejected them as an invalid type, including programming example E32.
For example, `input level: Percent;` with a host value of `33.5` retains `33.5`.
Invalid values and nominal type mismatches remain rejected. This restores the
existing Percent contract (Reference §2.1); no source migration or GFB/ABI change
is needed. Coverage: native `scenario_scan` unit tests, `tests/ghostsim.test.mjs`,
`tests/ghostsim-input-validation.test.mjs`, and E32 in
`tests/programming-book-simulation.test.mjs`. Prerequisite for
[#151](https://github.com/callin2/ghostflow-language/issues/151).

### 2026-09-29 — pinned sensor and function composition ([#377](https://github.com/callin2/ghostflow-language/issues/377))

Reference §6.4 sensor connections and imported pure functions now execute, instead
of being rejected as unsupported composition. For example, `connect high.air <- air;`
feeds the root raw sample into `high`'s own unchanged sensor conditioning. Payload,
optionality and sample interval must match. Function/local names remain isolated.
Public root sensors stay in `manifest.sensors`; consumers activating these programs
must support `manifest.sensorInstances` routing. Existing standalone programs and
GFB/WASM/frame interfaces are unchanged. `tests/composition-execution.test.mjs`
checks filtering, faults, recovery, staleness, rollback, invalid wiring, provenance
and native/WASM conditioned-frame parity.

### 2026-09-29 — explicit relative-humidity ratio ([#371](https://github.com/callin2/ghostflow-language/issues/371))

Reference §2.9 now permits `RelativeHumidity / RelativeHumidity -> Number`,
previously rejected. For example, `60%RH / 100%RH` produces `0.6` for an authored
air-VPD calculation. All other RH arithmetic, cross-quantity division and implicit
numeric conversion remain forbidden. Constant/dynamic zero division retains the
existing diagnostic/tick rejection. The compiler uses existing division bytecode;
no GFB/ABI change or source migration is required. Regression coverage:
`tests/relative-humidity-ratio.test.mjs` (constants, nominal rejections and native/WASM outcomes).

### 2026-09-28 — framed civil schedule bug fix ([#366](https://github.com/callin2/ghostflow-language/issues/366))

Before this fix, framed civil schedules were rejected. They now use the same
Rust core for `Daily` and `DailySlots`. Activation accepts
`{bootEpoch, terminalCapacity}`. The provider supplies GFSF v2/v3 schedule facts
separately at scan time. Matching WASM exports are required. Rust admits
occurrences and owns their ledger; the host validates the complete input set
and schedule-fact packet, and does not derive runtime `due`, `ok` or `fault` values. A known rejection
rolls back for same-frame retry; a post-commit failure preserves the committed
result. Framed Solar remains unsupported.

Regression coverage is in `tests/framed-control-host.test.mjs` and
`crates/ghostflow-core/tests/schedule_module.rs`. See
[Framed ControlRuntime](docs/FRAMED-CONTROL-HOST.md).
