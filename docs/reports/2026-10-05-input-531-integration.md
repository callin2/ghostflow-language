# Issue 531 integration checkpoint and consumer handoff

This is owner integration evidence for draft [PR 532](https://github.com/callin2/ghostflow-language/pull/532),
not a release, downstream adoption or physical verification claim. The preceding
published candidate is `c8a5d37ac09230a9011291a3ae3b053d1bc22773`.
The older [consumer audit](2026-10-05-input-531-consumer-gates.md) retains the
results and unresolved items observed at that earlier phase; it is historical
evidence, not the status of this migration batch.

## Contract implemented

- Canonical external `input` retains typed acquisition Result, optionality,
  conditioning and explicit source fault handling. Healthy false/zero is distinct
  from an unavailable observation. Boolean values do not diagnose physical faults.
- Software producers supply actual observations. Clock-only scans do not create
  Good samples. No target switch rewrites approved source or adds START controls.
- An explicitly connected internal scalar output is lifted through the existing
  typed `ok` constructor, without acquisition observations or provenance. The
  receiving source still handles Results. Committed-state feedback, private
  instance state and combinational/next-state rejection remain.
- Existing `map` and `and_then` lift pure and Result-returning named functions.
  Fault branches do not evaluate their transforms or invent a normal value.
- Existing `recover_after = N samples` now applies at startup/reset/epoch change.
  The Nth distinct valid new observation is usable when the filter is also ready.
  Duplicates and clock-only reads do not count; interruption restarts preparation.
  This fixes the former threshold bypass without adding duration syntax or ABI.
  Discarding the first N observations means an N+1 threshold within the existing
  1..31 limit; it is not the meaning of `recover_after = N samples`.
- Existing `map + debounce(stable_for: 2min) + Result case` also expresses timed
  preparation. Its interval begins with the first conditioned Good observation,
  uses observation timestamps and requires a fresh Good observation at/after the
  deadline. Clock-only scans and duplicates cannot complete it. Faults, stale
  reception and epoch changes restart it. This is a verified authored pattern,
  not a new time-based acquisition annotation.
- Bound resource modes use actual generated Bool value and OK rails. Unavailable
  observations cannot serve as mandatory Bool permissions: admission rejects
  atomically, retaining the existing outcome and allowing a corrected same-scan
  retry. No unknown value becomes false, OFF or a new trip/restart rule.
- Canonical source replay binds complete signed acquisition/instance descriptors.
  Historical GFB10 rejects unsupported instance metadata before bytecode loading.

## Preserved evidence and compatibility

Historical programs, imported closures, source/schema/replay identities, golden
artifacts and dated benchmark digests remain intact. Changed current examples
and test fixtures have explicit new revisions and independently pinned originals.
Changed requirement proof excerpts retain their original IDs/digests as historical
rows, with separate current executable proof rows. Unchanged excerpts only move.

GFB formats, GFRB/GFRS layouts, package versions and WASM ABI are unchanged.
The shared Rust conditioner and executable policy implement the preparation and
admission semantics; reference adapters do not introduce another evaluator.

## Verification evidence

The final full registered audit ran 255 files: 3455 tests, 3414 passed,
2 failed and 39 todo, with no skipped or cancelled tests. Both failures are
unchanged document-index file-symlink fixtures: the restricted Windows account
reports EPERM when creating links. The tests remain enabled for Linux CI.
The four former recovery-count failures now pass while retaining their EMA
recurrence, atomicity, session-restart and duplicate-recovery oracles; original
expectations are independently pinned in a historical archive.
Exact local diagnostics are retained in ignored
`build/issue531-failures-final.json` and the full TAP transcript in
`build/issue531-all-node-final.tap`.

The complete Rust workspace passes 425 tests. Rust formatting passes and all
release native examples build. Portable-package tests pass 17 plus 7 catalog
checks; the integration contract passes 43 tests. Documentation passes 153
bilingual pairs and 78 exclusions, with both indexes fresh. Independent frozen
production review passes 71 tests without actionable findings. Focused
composition/canonical-input tests pass 61; the composition owner's execution
and integration suites pass 12 and 29 respectively; preparation/ROP related
native/WASM checks pass 109. Counts overlap and must not be summed.

The former scalar module-linking blocker is resolved: computed internal scalar
outputs use the existing typed `ok` lowering path, without a synthetic external
sample or acquisition descriptor. Existing `map` and `and_then` support scalar
and Result-returning named functions. Actual execution tests cover committed
state feedback, private instance state, independent instances, and preserved
combinational/next-state rejection. Optional or conditioned acquisition ports
cannot be substituted by computed scalar links; this remains an explicit
boundary rather than invented acquisition history.

Duration preparation uses the existing `map + debounce + Result case` pattern,
verified through plain, framed and native execution. This avoids a second timer
contract or ABI change while preserving timestamp, fault and reset semantics.
A new acquisition duration annotation is not implemented or promised.

Exact-head Linux CI results are reported in the draft PR and final handoff.
Local Windows results do not establish full verification on their own.

## Consumer owner gates

| Owner | Candidate contract and remaining adoption gate |
| --- | --- |
| Simulator | Actual sample production, clock-only omission and typed-quality replay; reference owner tests run here. Product consumer must pin the verified candidate. |
| Authoring | Emit explicit new canonical source revisions and Result handling; preserve approved originals and older request intent. Existing Authoring 9 is a separate owner change. |
| API | Persist immutable revision/source/schema histories; do not rewrite old sensor-syntax records. API 172 adoption and candidate pin are separate gates. |
| Device | Bind actual typed producer facts and capabilities; consume the shared core at the verified revision. No firmware release, pin change, flash or physical operation was performed. |
| SDK/package | Consume verified source/artifact/metadata contracts at an explicit candidate revision. Driver 9 remains another owner's implementation. |

Installed downstream regression and deployment were not run by this owner draft.
The earlier frontend-pin CI lane validates its existing compiler pin, not adoption
of this candidate. Merge, deploy, release and hardware gates remain separate.
