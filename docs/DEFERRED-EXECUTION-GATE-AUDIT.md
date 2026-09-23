# Deferred execution gate audit

The executable gates in `tools/control.mjs` remain necessary. A checked JSON
artifact is compiler acceptance, not executable GFB. Public `ControlRuntime`
activation and raw WASM module loading both reject these artifacts. This audit
compares the Reference with the current independently callable runtime primitives.

## after_event

Reference §4.4 requires a result for each event identity, independent overlapping
windows, and exclusion of the exact end boundary. The Rust engine and
[WASM ABI](AFTER-EVENT-WASM-ABI.md) implement those independent results.
The ABI's `instantiateSource` now obtains the selected site's window and source
tags from a complete canonical document. It retains source identity and returns
independent native results; it does not execute the document's control outputs.

The unresolved language contract is the conversion to the scalar signal used by
`confirmed <- opened |> recover(false)`. If A has expired while B is satisfied,
the Reference does not select A, B, any identity, or all identities. It also does
not specify scalar exposure of pending/completed results over subsequent scans
or consumption of those results. A host acknowledgement currently frees an
individual terminal result; it is not a language-defined scalar projection.

Before removing the gate:

- Specify identity selection/aggregation and the Result meaning of pending,
  expired, and satisfied, including simultaneous completions.
- Add source → compiler → ControlRuntime tests with overlapping starts producing
  different outcomes, exact-end observations, and multiple results in one tick.
- Bind source tags and native staging to the compiled control transaction; prove
  a later failing output expression rolls back event state and acknowledgements.

The existing independent ABI tests cannot establish that last transaction.

## tide_is / moon_is

Reference §3's “달과 조석” section already defines provider kinds, accepted classes,
`Result<Bool, TemporalContextFault>`, explicit case handling, and Schedule
Unknown/fallback. It requires classification criteria, location/timezone,
revision, coverage, expiry, and uncertainty in provider evidence.

No native natural-condition evaluator or provider-observation transport is bound
to these expressions. Current lowering retains inert Result projections solely
for type checking. Removing the gate would execute those placeholders.

This is mainly missing runtime/interface work, not a need to invent a new scalar
language construct. A classification's definition may come from the bound
provider; the compiler must not silently substitute its own lunar/tidal model.
The admission contract still needs precise clock trust, coverage/expiry boundary,
and uncertainty rules. Reference §3 does not provide a universal uncertainty
tolerance to insert as a hidden default.

Required tests cover mismatched provider/context/revision, missing and expired
observations, exact coverage/expiry edges, uncertain classification crossing a
boundary, unknown civil clock, all allowed classes, explicit fault case handling,
and Schedule fallback. They must compare native results with source-level
outputs and must not inject a precomputed Boolean as sufficient evidence.

## accounting

Reference §3.10 and §4.11 require stable physical resources, stage-specific
intervals, trusted local-day splitting, rolling partial overlap, persistent
Unknown state, conservative admission, and reservation/settlement. The
[ledger ABI](ACCOUNTING-LEDGER-ABI.md) performs caller-validated record storage,
deduplication, queries, snapshot acknowledgement, and restoration. It does not
perform resource/clock binding or control admission.
Its source-bound wrapper checks a named declaration against the canonical
document and a caller-supplied numeric ID. It does not certify that ID against
the physical installation or bind restored snapshots to the source identity.

One language projection remains unresolved: the Reference says an unknown date
makes `.count` Unknown, but supplies `let today_starts = normal_starts.count`
without a named Unknown-bearing result type or its propagation rules. Current
compiler typing assigns plain `Int`; the ledger returns `Known(u64)` or Unknown.
Unknown cannot be converted to zero or a successful Int. Known values also need
the ordinary checked i32 boundary; WASM's u64 result is not a language Int.

Further blockers are implementation contracts: stage/resource identity mapping,
reboot-comparable monotonic epochs, trusted immutable local-day facts, and atomic
ledger/reservation/control-tick integration. Requested/safe/confirmed stages and
restart policies cannot all be implemented by treating the applied-only ledger
as a complete binding. Resource-policy reservation alone is not ledger settlement.

Required integration tests include Unknown count propagation, missing/corrupt
snapshots, stale persistence acknowledgement, exact-limit blocking, physical
resource aliases and overlapping controls, 23/25-hour local days, rollback without
moving settled usage, reboot during an outstanding reservation, finite manual
lease/cutoff, and failed control ticks leaving admission and ledger unchanged.

## Verified guard coverage

`tests/deferred-runtime-gates.test.mjs` verifies all three categories against the
same canonical Reference fixtures: direct executable lowering rejects; descriptor
compilation declares non-execution; `ControlRuntime` rejects activation; raw WASM
loading rejects the descriptor and cannot activate a module afterward. It does
not replace the future execution tests listed above.
