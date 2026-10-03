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

Elapsed timers have two compiler-generated runtime states. Each is an ordinary
binding to `stateBefore` and `stateAfter`, but remains visibly generated:
`generated: {declaration, role}` uses the authored timer name and one of the exact
roles `since` or `initialized`. Both entries point to the authoritative `timer`
declaration node. They are not synthetic authored assignments and do not claim
that the declaration alone dynamically caused a later output.

The FNV module fingerprint is the existing core diagnostic identifier, not a
cryptographic integrity proof. Consumers must keep source/compiler/runtime and
SHA-256 identities from the same compilation/run. Two different commented sources
can generate identical bytecode; matching fingerprints alone do not select source.

## Static dependency companion

Language issue #11 / TASK-58.12.1 adds `dependencies` to the compiler companion.
Each entry has `target: {field, name}` and deduplicated `reads: [{field, name}]`.
Transition targets use `stateAfter`, intent targets use `requested`; reads retain
`inputs`, `stateBefore` and `stateAfter` phases. These come from the compiler's
already-lowered expressions, including expanded functions and implicit holds.
They are possible static reads, including both conditional branches, **not** an
executed-branch trace or a claim that every read caused the selected output.

Consumers resolve source locations through existing bindings. The two generated
timer states resolve to their timer declaration; other generated fields without
bindings, such as the injected monotonic clock input, remain explicitly unmapped
and never receive an invented source location. Previous-state edges end at the
previous scan boundary; following them as same-scan transitions would falsely
create feedback causality. Global safety constraints remain a separate relation
with their actual round observations. This companion does not change GFB bytes or
runtime output semantics.

## Artifact persistence and strict recovery

`compileSource` results persist the existing trace companion as
`traceMetadata` in the `GhostFlow/source-map-v1` envelope. The GFB and strict
control manifest do not change. The persisted companion carries
`sourceDocumentSha256` and `bytecodeSha256`. The internal `compileControl`
lowerer remains source-container independent; it is
not a product compiler API. Product callers use literate-only `compileSource`.
`restoreArtifactSourceMap` first validates the exact source-document SHA-256 and
GFB SHA-256 against those companion identities, then the runtime module
fingerprint, binding/node positions, generated timer pair, dependency targets and
complete constraint-node coverage. Only then does it return the source, maps and
trace metadata as one revision-bound result.

Strict recovery rejects a traceable control map with missing trace metadata and
rejects duplicate, missing or mismatched generated timer bindings. The older
`verifyArtifactSourceMap` source-only API remains compatible with v1 maps that
predate trace persistence, but validates trace metadata whenever the field is
present. A consumer that promises output-to-source navigation must use strict
recovery rather than treating source-only verification as trace acceptance.

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

## Window evidence

`windowSites` binds each aggregate declaration to its operation, nominal payload,
durations, physical sources and optional prior `upstreamWindows`. Canonical
source replay checks these bindings and the source/consumer dependencies.

Rust `windowTrace` records contain immediate contributors, not a flattened set of
sensor samples. Physical contributors retain `{sourceTag, epoch, id, timestampMs,
value}`. Derived contributors retain `{kind: "derived", site, timeEpoch,
admissionRevision, timestampMs, evaluatedAtMs, value, proofRoot}`. Their identities
are local to the verified module, selected strategy and execution session. A time
epoch alone is not a globally unique session identity.

A record with derived contributors owns a `proof` array. Each `proofRoot` points
to an aggregate tree in this flat preorder arena. Every node carries `childCount`
and `subtreeSize`; physical leaves have zero children and size one. A derived node
preserves its aggregate operation, original aggregate `value`, evaluation time and
observation identity. `suppliedValue` is the payload supplied to its parent after
any pure transform. A physical leaf's `value` is already the admitted transformed
observation payload, so its `suppliedValue` is the same value; it does not claim to
retain a separate raw driver reading.

`observeSourceTrace` validates tree boundaries, prior-window identities, physical
root membership, scalar domains, observation/evaluation times and complete proof
coverage. It exposes the owned proof in `windowEvents` without recomputing aggregate
arithmetic. A nested average counts immediate aggregate contributors once each,
even when their proof trees share physical sample identities. Persisted or foreign
trace data still requires the verified artifact/source envelope before these local
site identities can be interpreted.

## Public runtime values

`observeRuntimeValues(metadata, trace)` projects completed-scan values from the
same compiler-owned bindings. Its `GhostFlow/runtime-values-v1` result currently
contains authored `state` values and authored `timer` values. Timer values use
the source declaration name, `Duration`, and exact non-negative integer
milliseconds; generated `__gf_` storage names never appear in the result.

The helper calculates an elapsed timer only when the trace contains its clock,
initialized flag, and start time. Missing fields remain absent instead of being
fabricated as zero. It requires an exact module fingerprint match and does not
infer counters from arbitrary numeric states. A future `Int`/counter language
surface must extend this contract explicitly rather than relying on UI naming
conventions.

## Joining and evidence

The official `observeSourceTrace` helper requires matching module and safety
formats plus ordered constraint index/kind/names. Missing fields are unobserved,
never fabricated zero/false values. It joins actual fields; it does not interpret
expressions again or infer electrical/mechanical operation. Frontend binding and
physical feedback remain distinct later gates. When the companion came from
`compileSource`, the source observation retains its `sourceDocumentSha256` and
`bytecodeSha256` so downstream navigation cannot silently drop the selected
revision identity.

Acceptance requires explicit first-pass and cascading violations, mutex and
satisfied cases, source locations and exact native/WASM equality. A passing source
map unit test alone cannot establish runtime observation correctness.

## Interaction v0 completed snapshots

`tools/interaction-runtime-snapshot.mjs` is the narrow #72 adapter from an
already-completed runtime trace to `GhostFlow/runtime-snapshot-v0`. It rebuilds
the schema from the exact canonical literate compilation, joins schema/module/
source/run identities, and emits values only by authored Interaction descriptor
ID. It may resolve generated timer storage internally through
`observeRuntimeValues`, but generated slot names never leave this boundary.
Missing values become explicit `unavailable`; malformed observable state becomes
explicit `error`; `stale` remains a consumer-only expected-identity join result.

The adapter does not call `tick`, mutate a runtime, send commands, or apply
outputs. Its native/WASM corpus test compares disabled, eager, and delayed
observation runs so this property is executable rather than documentary.
