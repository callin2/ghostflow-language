# Source and safety observation contract

Tracking: language issue #8 / TASK-58.8. Diagnostic-only addition; no GFB1,
execution ABI, output semantics, constraint priority or device release change.

## Compiler companion

`compileControl().traceMetadata` has format `GhostFlow/source-trace-v1`, a module
fingerprint, bindings and constraint mappings. Bindings identify authoritative AST
node IDs, logical names and observed fields: inputs, stateBefore/stateAfter,
requested/safe. Constraint indexes follow the actual lowered GFB constraint order,
not a UI's inferred order. Literate adapters retain extracted coordinates and map
original locations only when a real mapping exists.

The FNV module fingerprint is the existing core diagnostic identifier, not a
cryptographic integrity proof. Consumers must keep source/compiler/runtime and
SHA-256 identities from the same compilation/run. Two different commented sources
can generate identical bytecode; matching fingerprints alone do not select source.

## Runtime observations

`TickRecord.to_json()` adds `safetyTrace` with format `GhostFlow/safety-trace-v1`.
Each entry records index, kind, names, firstViolation and final. Observations are
captured inside the existing fixed-point safety loop, before that round's updates.

- `firstViolation` is null or `{round, values, blocked}`. It records only the first
  violating evaluation of that rule, with the member values actually read and the
  outputs that rule blocked. Round zero evaluates the requested output snapshot.
- `final` is `{round, values, satisfied}` from the terminating no-block round.
  A satisfied implication with a false target is not permission to energize it.
- `values` contains only that rule's members. At most two snapshots per constraint
  are retained, bounded by the existing 128-constraint/32-member limits. This is
  not an unbounded round history and does not assert a unique causal root.

The prior requested/safe maps and fault strings retain their exact semantics.
The snapshots observe the algorithm; they must not affect any output decision.

## Joining and evidence

The official `observeSourceTrace` helper requires matching module and safety
formats plus ordered constraint index/kind/names. Missing fields are unobserved,
never fabricated zero/false values. It joins actual fields; it does not interpret
expressions again or infer electrical/mechanical operation. Frontend binding and
physical feedback remain distinct later gates.

Acceptance requires explicit first-pass and cascading violations, mutex and
satisfied cases, source locations and exact native/WASM equality. A passing source
map unit test alone cannot establish runtime observation correctness.
