# Interaction Schema and Runtime Snapshot v0

This contract is a renderer-neutral **host software** boundary for
`GF-IR-1`/TASK-121.1. It defines static semantic descriptors separately from
one completed runtime observation. Compiler emission is implemented by #71;
#72 projects only already-completed native or WASM traces through
`tools/interaction-runtime-snapshot.mjs`. That adapter never evaluates a scan,
performs I/O, or changes requested/safe outputs.

`GhostFlow/interaction-schema-v0` and `GhostFlow/runtime-snapshot-v0` each
carry their own `version`. The version is a compatibility label, not an exact
schema-instance identity. A snapshot additionally carries the SHA-256 of the
canonical static schema JSON in `snapshot.schema.sha256`; consumers must join
that digest, format, and version with the supplied static document.

The schema digest is SHA-256 of UTF-8 bytes produced by this repository's
`canonicalJson(schema, {rejectSparseArrays: true, rejectUnsafeIntegers: true})`.
It is precisely: recursively sort each plain-object's keys by ECMAScript UTF-16
code-unit ordering; keep array element order; encode strings with ECMAScript
`JSON.stringify` after rejecting malformed Unicode; encode booleans and null as
their JSON literals; encode finite IEEE-754 numbers with ECMAScript
`JSON.stringify` spelling (including `-0` as `0`), rejecting unsafe integers;
emit no whitespace; reject sparse arrays, non-plain objects, non-finite numbers,
and nesting deeper than 64. Consumers compare the supplied digest. A
cross-language producer must reproduce those exact bytes before it can issue a
matching snapshot; a format-version match alone is insufficient.

## Static schema

The schema has pinned `module` (`id`, compiler trace `moduleFingerprint`, and
manifest `bytecodeSha256`) and source-document (`documentId`, `revisionId`,
`format`, `kind`, source `sha256`) identities. `module.id` is the public control
module identity; `moduleFingerprint` is the compiler's stable 16-hex trace
fingerprint of the compiled module; `bytecodeSha256` is the lowercase SHA-256 of
the emitted manifest bytecode. The fingerprint and artifact digest are distinct
and both are required. `source.documentId` is an opaque public identity stable
across revisions of one authored document; `source.revisionId` is an opaque,
immutable identity for one stored canonical revision; `source.sha256` is the
lowercase SHA-256 of that revision's UTF-8 source bytes. Neither source identity
is a path, so they support documents held in conversation or revision storage.
The fixture's repository path belongs only to its test harness.

`source.kind` is exactly `literate`. GhostFlow's canonical authored, reviewed,
and versioned source is the literate document. Product/compiler input is
canonical `.ghost.md` only: plain code is rejected and cannot be a supported
authoring, import, artifact, or Interaction Schema fallback.

Every descriptor has a public stable authored `id` and `name`, a semantic
`kind`, compiler/source semantic `sourceType`, explicit `access`, and
provenance. v0 permits only `state` and `timer`, each with access exactly
`["read"]`: both are observation-only internal values. Settings, commands,
inputs, events, alarms, and explanations are later work owned by #70. This
contract does not grant `write` or `execute` access before those designs exist.
`sourceType`
carries `builtin` `Bool`, `Number`, or `Duration`, or a named `nominal` type and
semantic unit. Runtime JSON spelling never selects the type: `0` remains a
`Number` or a `Duration` only because the static descriptor says which it is.

Every descriptor also names its positive compiler source-map node ID and at
least one literate intent anchor. The descriptor ID/name and anchor IDs are
public and reject the reserved `__gf_` prefix; source-map node IDs are numeric
compiler provenance, never generated VM-slot names. The fixture test verifies
that each recorded node/kind and anchor link exists for this exact source
revision. Compiler emission of descriptors is implemented by #71. Runtime
projection reconstructs and verifies that exact schema from the compiled
canonical literate artifact before it emits a public snapshot.

`timer.age` demonstrates `elapsed(watering)` as:

```json
{"kind":"elapsed_since_change","subjectId":"state.watering"}
```

It reports elapsed milliseconds since the authored `watering` state last
changed. It is not accumulated ON time. The validator requires its subject to
resolve to an authored `state` descriptor with builtin `Bool`. The schema
deliberately retains Boolean `state.watering`, including `false`, for execution
and explanation.

There are no widget, layout, visibility, color, coordinate, or renderer-policy
fields. A renderer may show timers and hide Boolean states by default, but that
policy is not part of this IR.

## Completed runtime snapshot and statuses

A snapshot is one `completed-scan`. `runId` is an opaque public epoch owned by
the host/runtime instance; it must change on reset or a new run because the same
source can restart at `scanId: 0`. `completion` provides a non-negative
`scanId` and logical milliseconds. A snapshot must have exactly one observation
for every descriptor, including an explicit `unavailable` observation when no
value exists; omission is invalid. v0 does not define a distinct tick identity.

Per-observation payload statuses are intentionally minimal:

| Status | Where decided | Required field | Meaning |
| --- | --- | --- | --- |
| `ready` | trusted snapshot producer after completion | `value` | A value for the static descriptor's semantic type. `false` and `0` are values, not absence. |
| `unavailable` | trusted producer | `reason` | This completed observation has no value. |
| `error` | trusted producer | `error` | This descriptor could not be observed. |
| `stale` | validating consumer join | derived reasons | The structurally valid snapshot differs from the consumer's expected schema, module, source, or run identity. It is never accepted as a self-declared observation status. |

The validator reports `join.status: "stale"` with exact stale reasons only when
an optional expected identity is supplied. The expected join can compare schema
format, version, and digest; module ID, fingerprint, and bytecode SHA; source
document ID, revision ID, and SHA; and run ID. `scanId` is deliberately absent:
it is only an ordering coordinate within one run.
A schema/snapshot mismatch inside the documents themselves is a validation
`error`, not stale data. This distinction prevents an untrusted payload from
labeling itself stale to conceal an identity failure.

## Fixtures and validation

`examples/five-minute-watering.ghost.md` is a literate five-minute watering
fixture. Its static and dynamic JSON examples contain real `false` and `0`
values, with Number and `Percent` represented by authored state descriptors,
without adding an exact counter/`Int` representation. `validate.mjs` performs
strict unknown-field, public-identity, provenance, semantic-type, exact schema
digest, static identity, completion, and descriptor-coverage checks. It
validates records only; it makes no device, physical, frontend,
compiler-emission, or runtime-collection claim.

## Shared conformance corpus

`examples/corpus.json` pins the canonical source revision and compiled module
identity for each test case. The unchanged five-minute literate source is the
first case. `examples/multiple-values.ghost.md` is the second canonical
program: it has two authored Bool states and elapsed timers, one Number state,
and one nominal `Percent` state. Both use syntax accepted by the current
compiler; no new descriptor kind is implied.

Each `.scan-tape.json` beside the corpus is versioned, renderer-neutral test
stimulus. Every frame records a completed scan, logical time, and every named
declared input in compiled manifest order. Runs have distinct `runId` values
and use contiguous `scanId` values starting at zero. The tape digest is SHA-256
over strict canonical JSON for the complete tape object with the `digest`
member omitted, using this repository's `canonicalJson` with sparse arrays and
unsafe integers rejected. This input tape is maintained test data, not another
GhostFlow control source.

`observationExpectations` may describe a validator-only `unavailable` case. It
does not claim a runtime observation and is not copied into the checked-in
snapshot. The corpus verifier compiles the exact `.ghost.md` bytes, checks
source/module/artifact identities, validates complete inputs, contiguous
run-local scan IDs and nondecreasing logical time, and checks existing
schema/snapshot projections. Run it with
`node contracts/interaction-v0/verify-corpus.mjs` or
`node --test tests/interaction-corpus.test.mjs`. The checked-in schema and
snapshot for five-minute watering, and any later schema,
snapshot, or GFB files, are derived projections; the literate document remains
the only canonical control source. The second program intentionally has no
hand-maintained plain `.ghost` counterpart or fabricated runtime snapshot.

`tests/interaction-runtime-snapshot.test.mjs` replays each exact corpus source
and tape through the release native framed runner and the actual framed WASM
ABI. It projects both completed traces and requires byte-for-byte equal public
snapshots, including timer logical-clock values. It also compares disabled,
read-every-scan, and delayed-consumer runs: observation may not alter committed
state, requested outputs, or safe outputs. This is host-side native/WASM
evidence only; it does not claim browser acceptance, firmware execution, or
physical-device behavior.

The v0 alternative rejected here is putting `stale` beside `ready` in an
untrusted observation. That would make a producer's assertion substitute for a
consumer's identity join. Deriving it in validation keeps the document small
while making restart and revision mismatches explicit.
