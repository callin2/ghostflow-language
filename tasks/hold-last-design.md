# Bounded hold implementation

Reference: §4.4, REF-04-031. The original compile-accept case is unchanged.
Initial RED: `build/hold-last-reference-red.log`, CLI check and build both reject
the unsupported signal. This work is independent of the pending `true_for`
continuous-observation policy question.

## Execution contract

Use existing Rust VM state expressions and atomic tick/journal semantics.
No new opcode, JS expression evaluator, or increased resource limits.
The current slice accepts measured physical `Result<T, SensorFault>` evidence.
Estimated evidence and uncertainty contracts remain an explicit overall gap.

Descriptor kind is `hold-last`; source AST mode is `hold_last`. Fields:
`name`, `payloadType`, `errorType: SensorFault`, `quality: measured`,
`forAtMostMs`, `clockInput: __gf_now_ms`, `sourceMode: sample`, `sources`,
`states`, and finite-enum `members` when applicable.

Common state roles (11): `available`, `value`, `heldSourceTag`, `heldEpoch`,
`heldId`, `heldTimestamp`, `held`, `age`, `maskedFaultPresent`,
`maskedFaultCode`, `maskedFaultOrigin`.
`available` means a cached admissible record exists. `held` is the current
strict age-bound eligibility decision. The former may survive expiry; the
latter must not. Per physical root retain `lastEpoch` and `lastId` highwaters,
including roots currently unselected. Cost: 11 + 2 × root count states.
All states and next values are computed atomically by Rust.

Names: `__gf_hold_last_<snake_role>_<signal>`; source history uses
`__gf_hold_last_source_epoch_<signal>_<tag>` and `source_id` respectively.
Booleans default false; scalar payload has its type's default; numbers default
zero except `heldId`/source `lastId` = -1 and `maskedFaultCode` = 3 (NotReady).

Fresh admissible samples replace the cache with their original timestamp.
Duplicates do not refresh age. Faults and selection changes preserve the cache;
its own source epoch replacement invalidates it even while that root is
unselected. A result is Held even at age zero. Missing/expired evidence returns
NotReady. Result sample quality is 0 unsourced, 1 measured, 2 Held; transformations
cannot promote Held to measured. Cold restart starts unavailable. Durable
checkpoint restoration requires separately proven source/time continuity.

## Trace and artifact boundaries

Rust `TickRecord.stateAfter` records all facts, including computed age and any
masked fault. Verified generated source bindings project these into
`observeSourceTrace(...).heldEvents`. The decoder maps recorded fields only;
it does not calculate age or eligibility. Canonical JS replay and native package
descriptor/type/default checks cover generated states and sample input bindings.
The existing native package canonical-source replay limitation remains separate.

## Ownership and acceptance

- Sol: compiler, diagnostics, actual native/WASM execution tests.
- Astra: native signed package descriptor and bytecode binding checks.
- Luna: source envelope/provenance tests.
- Root: JS host, source trace, JS package replay, integration and review.

Required checks: fresh/delayed samples, exact expiry, missed scans, duplicate and
rejected sample identity, ordinary faults, A→B fault, unselected cached-root epoch
replacement, nested Held non-promotion, bounded resources, failed-scan rollback,
replay, source identity preservation, and signed descriptor tampering.
## Verified measured slice (2026-09-23)

- `build/hold-last-focused-final.log`: compiler 2, diagnostics/boundaries 10,
  execution 10; 22/22 pass. Execution covers actual native and both WASM ABIs,
  plus both public hosts for conditioner rollback, rejected sample identity,
  delayed delivery, cold restart and deterministic replay.
- `build/hold-last-provenance-focused.log`: 14/14 pass (including one parent
  group), source envelope, generated binding tampering, actual Held observer,
  and malformed host descriptors.
- `build/hold-last-signed-js.log`: signed JS acceptance and six re-signed
  descriptor/provenance mutations, all rejected before target bytecode loading.
- `build/hold-last-package-final.log`: Rust package suite 23/23, including 42
  signed hold mutation scenarios and actual GFB state type/default validation.
  The missing default check was first observed RED in
  `build/hold-last-package-binding-red.log`.
- `build/hold-last-factoring-green.log`: a hold→debounce→hold chain previously
  emitted a 5,415-byte intent. Successful-domain quality propagation and pure
  expression factoring reduced it to 420 bytes; the largest chain expression is
  3,151 bytes, within the unchanged 4,096 limit. Selector-fault evaluation and
  rollback have an explicit regression test.

Full gate: `build/compiler-runtime-batch9-full.log`, exit 1. All Rust/native/WASM
presteps pass. Node: 1,662 tests, 1,468 pass, 30 fail, 164 TODO, zero skip. All
failures are existing other Reference cases; REF-04-031 passes unchanged through
both CLI check and build. Executable Reference: 173/203 pass. Tutorial verification
does not run after the Node failure. Reports are preserved in
`build/compiler-runtime-batch9-reference-results.json` and
`build/compiler-runtime-batch9-verification.json`.

The measured hold slice is verified. Estimated evidence/uncertainty, durable
restore with explicit continuity proof, the native package's canonical source
replay limitation, and the overall Reference completion goal remain open.
