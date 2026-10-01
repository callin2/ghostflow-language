# Changelog

## Unreleased

### 2026-10-01 — one-shot At pulse ([#154](https://github.com/callin2/ghostflow-language/issues/154))

`schedule appointment: At { at = datetime\`2026-01-01T08:00:00Z\`; ... }`
now compiles and executes an absolute singleton pulse in the shared Rust core,
WASM host and ghostsim. The six common policies remain required; this bounded
profile accepts pulse/trusted-only/baseline/skip and rejects other bases and
timezone/DST/cancellation fields. Trusted crossing admits once; false, gap and
past boot/recovery baseline consume a terminal miss. Rejected scans do not
consume, and matching restored checkpoints preserve deduplication after reboot.
GFB14/control-v13 make older loaders fail closed; scan transport is unchanged.
Signed portable packaging remains unsupported. See [Reference §3.5](docs/reference/03-time-and-schedules.en.md#35-common-schedule-semantics).
Compiler and native/WASM/ghostsim boundary, recovery, rollback and checkpoint
regressions cover this addition; logical admission makes no physical claim.

### 2026-10-01 — portable adaptive strategy metadata

Portable packages now accept compiler-produced paired adaptation descriptors.
Canonical source replay and native decoded strategy/query bindings reject
re-signed descriptor or bytecode changes. Optional Bool feedback preserves the
absent baseline and explicit present strategy in native/WASM execution. GFB,
wire formats, ABI and signature policy are unchanged. See
[Portable package](docs/PORTABLE-PACKAGE.md#adaptive-strategy-descriptors).


### 2026-09-30 ? checked duplicate constraint replacement ([#31](https://github.com/callin2/ghostflow-language/issues/31))

Compilation can merge adjacent identical ordered Bool output constraints after
independent bounded effect verification. For example, two consecutive
`require pump => valve;` declarations retain one executable check and both source
origins. The transformed source map and joined observations use host v2 formats;
the removed check has certified derived replacement evidence and is never reported
as executed. Existing lowering remains unproven. Programs outside this bounded
slice keep their original path. GFB instructions, native/WASM ABI and source
grammar remain unchanged; older host metadata consumers reject v2, and affected
packages must be rebuilt from canonical source rather than bypassing replay.
See [the replacement contract](docs/CHECKED-CONSTRAINT-REPLACEMENTS.md) and its
compiler, proof-tampering, source recovery and native/WASM parity regressions.

### 2026-10-01 — explicit native development signature policy

The native portable-package verifier offers an explicit development opt-out for
publisher authentication. The existing API remains enforcing. Unsigned or
untrusted packages still pass the same integrity, compatibility and loader
checks; bypass results explicitly report `DevelopmentBypass` and no accepted
keys. This does not enable a Device profile or change DSL/VM semantics. Native
package regressions cover strict rejection, development admission, malformed
signature metadata and retained payload/source/bytecode/binding rejection.

### 2026-10-01 — bounded natural-event fallback ([#29](https://github.com/callin2/ghostflow-language/issues/29))

Reference §3.4 now permits Solar/Tide `clock = hold_trusted(5min, terminal: skip)` and Solar `fallback = fixed_time(time`06:00`, terminal: skip)`; previously only trusted-only clock and skip fallback were accepted. Hold expires at the strict duration boundary; absent anchors/uncertainty fail closed. A fallback consumes the same source-date Solar identity through recovery and checkpoints. Facts providers resolve IANA civil time; ambiguous/nonexistent times skip. Extended policies select GFB13/control-v12 and Solar GFSF6; legacy bytes remain unchanged and older pinned runtimes reject GFB13. The signed portable-package GFB11 profile remains narrow. Regression coverage: `natural-fallback-compiler.test.mjs`, `natural-fallback-runtime.test.mjs`, core `solar_tape`; execution results are reported separately, with no physical Device claim.

### 2026-10-01 — paused Solar observation ([#402](https://github.com/callin2/ghostflow-language/issues/402))

Explicit paused observations now retain Solar terminal identities without running
the authored program or creating a scan. For example, an occurrence observed
while paused remains consumed after resume/reboot. Previously skipping the native
observation could fire that occurrence on resume. Program-logical time may freeze;
actual wall/trust remain supplied. Malformed observations reject atomically.
`schedule_module` and the pinned Device adapter regression cover the boundary.
No syntax, GFB/WASM ABI or generic lifecycle interface is added.

### 2026-10-01 — durable framed Solar admission ([#400](https://github.com/callin2/ghostflow-language/issues/400))

The Rust owner API now frames GFB5 Solar scans and exports/restores bounded
terminal occurrence identities for the exact program. Previously a Device
consumer could not preserve native Solar duplicate suppression across restart.
For example, restoring `solar_checkpoint()` before the first scan retains a
consumed occurrence while the new boot establishes a fresh clock baseline.
Malformed, mismatched or over-capacity checkpoints reject atomically. Hosts must
persist admission before publishing ON. `schedule_module` tests cover restore,
framed rollback and retry. Source syntax, GFB and WASM ABI are unchanged; this
does not claim physical actuation or supply the remaining civil checkpoint API.

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
