# Int operating config acceptance gap

Added Reference case `REF-05-108` to `tests/reference/cases/03-settings-boundaries.json`.

Source: `config count: Int = 1 { min = 0; max = 5; step = 1; access = operator; }`.
Expected result: `accept`, per Reference §5.1 and the Int config contract.

Focused command:

```text
node --test --test-name-pattern='REF-05-108' tests/reference-cli.test.mjs
```

Observed RED result: check and build both reject at `config-int-valid.ghost.md:5:23` with `operating config initial value must be a supported literal`. This records the compiler gap without changing the acceptance expectation.

Recorded evidence: `build/compiler-int-settings-red.log`, focused command exit 1.
The passing diagnostic regression excludes this expected-valid Reference case.

## Implementation contract

The correction covers authored Int defaults and operating metadata, source
candidate rewriting, execution of the compiled default in Rust, interaction
observations, and signed package validation. Values and min/max/step retain the
signed 32-bit domain. A positive step uses exact min-relative modulo for both
the default and maximum; the difference may span 4294967295 and must not narrow
to i32. A floating quotient tolerance is not valid for an integer grid.

- Sol owns compiler/candidate changes and independent integration tests.
- Astra owns native signed package validation and tamper tests.
- Luna performed the boundary inventory and catalog locator maintenance.
- Root owns host/interaction/JS package parity, specification clarification,
  integration review and final verification.

JS package verification must also compare the complete Int config descriptors
with canonical source replay. Signed but valid-range metadata is not proof that
it matches the source or the compiled constant. Native package verification has
no compiler replay and retains this explicitly unverified correspondence.

This correction does **not** complete §5.2 atomic live settings. The current
candidate API edits source and recompiles; runtime simulation executes compiled
defaults. Neither path is evidence of same-program, same-run settings events.
That runtime contract remains required by the full goal.

## Accepted correction and remaining scope

`REF-05-108` now passes unchanged through CLI check and build. The additional
tests found and corrected the floating-tolerance grid hole in the host and
interaction validator, unvalidated signed Int metadata in both package
verifiers, and missing JS source correspondence for Int config descriptors.

| Evidence | Result |
|---|---|
| `tests/int-operating-settings.test.mjs` | 21/21; compiler, candidate rewrite, CLI and boundary diagnostics |
| `tests/int-settings-artifacts.test.mjs` | 22/22; recompiled signed extrema in actual Rust WASM, trace-based snapshots, exact host/IR rejection |
| `tests/int-settings-package.test.mjs` | 28/28 including parent; 27 re-signed mutation cases |
| Native package Int tests | 2/2; 43 re-signed mutation cases, including UTF-16 label boundaries and no-settings defaults |

RED evidence is retained in `build/int-settings-package-red.log`,
`build/int-settings-artifacts-red.log`, and native signed/shape RED logs.
The artifact test correction intentionally uses fresh compilation for changed
defaults and actual runtime traces: editing only a manifest does not change the
compiled constant, and settings are not read from `stateAfter`.

Full batch10 gate: **1894 Node tests, 1700 pass, 30 fail, 164 TODO, 0 skip**.
All failures are other Reference cases. The Reference executable result is
**174 pass / 30 fail** across 204 cases. Cargo tests and native/WASM build gates
passed. The tutorial did not run after Node failure. Evidence:
`build/compiler-runtime-batch10-full.log`,
`build/compiler-runtime-batch10-reference-results.json`, and
`build/compiler-runtime-batch10-verification.json`.

The initial full-gate attempt stopped on formatting in the previously added
temporal oracle test. Only that file was formatted; the failure remains in
`build/compiler-runtime-batch10-format-red.log`. The final full gate includes the
Rust temporal foundation, but its compiler/GFB/ABI integration remains open.

No hardware deployment or atomic live setting behavior was certified. Native
settings shape/domain/grid checks do not establish canonical-source replay.
