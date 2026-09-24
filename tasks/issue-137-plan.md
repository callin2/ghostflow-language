# Issue 137: executable `after_event` slice

Date: 2026-09-24

Scope: make Reference case `REF-04-026` execute through the existing Rust
`AfterEvent<32>` engine. Keep `REF-03-062` deferred because the natural provider
observation ABI and classification validity policy remain unspecified.

## Contract

- Keep every start event identity independent.
- Preserve explicit `after_event_any` and `after_event_all` aggregation.
- Accept only explicit measured predicate observations. Do not interpolate
  between samples or treat scan cadence as observation evidence.
- Keep generated Result channels private to the runtime host.
- Stage the tracker before the VM scan. Commit tracker state only after the VM
  scan commits; roll it back when the scan is rejected.
- Retain the existing finite capacity, half-open boundary, acknowledgement, and
  fault behavior from the Rust engine.

## TDD increments

1. Add RED compiler/runtime tests proving the exact Reference source lowers to
   an executable control and generated projection channels cannot be supplied as
   ordinary inputs.
2. Add RED runtime tests for overlapping A/B identities, exact end boundary,
   missing predicate observation (`NotReady`), and rollback after a rejected VM
   scan.
3. Lower used `any`/`all` projections to generated Result inputs and validate the
   descriptor in `ControlRuntime`.
4. Bind each descriptor to the existing WASM `AfterEventRuntime`; stage explicit
   event facts and predicate observations, project Rust-owned results, then
   commit or roll back with the VM transaction.
5. Extend the scenario transport and `REF-04-026` oracle without changing its
   source, expectation, or status.
6. Update the deferred-boundary documentation and gate test. Run focused tests,
   native/WASM checks, the Reference simulator, then the repository verifier.

## Expected files

- `tools/control.mjs`
- `runtimes/wasm/control-runtime.mjs`
- `tools/ghostsim.mjs`
- `tools/scenario-sensors.mjs`
- `tests/after-event-contract.test.mjs`
- `tests/after-event-control.test.mjs`
- `tests/reference-simulator.test.mjs`
- `tests/deferred-runtime-gates.test.mjs`
- `tools/verify-language.mjs`
- `docs/AFTER-EVENT-WASM-ABI.md`
- `docs/TEMPORAL-DESCRIPTOR-ARTIFACT.md`

## Deferred owner decision

`REF-03-062` needs a typed provider observation contract covering provider and
site binding, classification criteria, clock trust, coverage, expiry,
uncertainty, revisions, and `TemporalContextFault` mapping. No positive
`tide_is`/`moon_is` execution will be invented in this slice.
