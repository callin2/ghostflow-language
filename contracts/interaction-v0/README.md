# Interaction Schema and Runtime Snapshot v0

This contract is a renderer-neutral **host software** boundary for
`GF-IR-1`/TASK-121.1. It defines static semantic descriptors separately from
one completed runtime observation. It neither emits compiler metadata nor
collects a runtime trace. Those producers are later implementation work.

`GhostFlow/interaction-schema-v0` and `GhostFlow/runtime-snapshot-v0` each
carry their own `version`. The version is a compatibility label, not an exact
schema-instance identity. A snapshot additionally carries the SHA-256 of the
canonical static schema JSON in `snapshot.schema.sha256`; consumers must join
that digest, format and version with the supplied static document.

## Static schema

The schema has pinned `module` (`id`, module-byte `sha256`) and source-document
(`format`, `kind`, repository-relative `path`, source `sha256`) identities.
Every descriptor has a public stable authored `id` and `name`, a semantic
`kind`, compiler/source semantic `sourceType`, explicit `access`, and
provenance. `sourceType` carries `builtin` `Bool`, `Number`, or `Duration`, or a
named `nominal` type and semantic unit. Runtime JSON spelling never selects the
type: `0` remains a `Number` or a `Duration` only because the static descriptor
says which it is.

Every descriptor also names its positive compiler source-map node ID and at
least one literate intent anchor. The descriptor ID/name and anchor IDs are
public and reject the reserved `__gf_` prefix; source-map node IDs are numeric
compiler provenance, never generated VM-slot names. The fixture test verifies
that each recorded node/kind and anchor link exists for this exact source
revision. Compiler emission of descriptors remains later work.

`timer.age` demonstrates `elapsed(watering)` as:

```json
{"kind":"elapsed_since_change","subjectId":"state.watering"}
```

It reports elapsed milliseconds since the authored `watering` state last
changed. It is not accumulated ON time. The schema deliberately retains the
Boolean `state.watering`, including `false`, for execution and explanation.

There are no widget, layout, visibility, color, coordinate, or renderer-policy
fields. A renderer may show timers and hide Boolean states by default, but that
policy is not part of this IR.

## Completed runtime snapshot and statuses

A snapshot is one completed scan or tick. `runId` is a host/runtime run epoch;
it is mandatory because the same source can restart at `scanId: 0`.
`completion` provides `completed-scan` or `completed-tick`, a non-negative
`scanId`, and logical milliseconds. A snapshot must have exactly one observation
for every descriptor, including an explicit `unavailable` observation when no
value exists; omission is invalid.

Per-observation payload statuses are intentionally minimal:

| Status | Where decided | Required field | Meaning |
| --- | --- | --- | --- |
| `ready` | trusted snapshot producer after completion | `value` | A value for the static descriptor's semantic type. `false` and `0` are values, not absence. |
| `unavailable` | trusted producer | `reason` | This completed observation has no value. |
| `error` | trusted producer | `error` | This descriptor could not be observed. |
| `stale` | validating consumer join | derived reasons | The structurally valid snapshot differs from the consumer's expected schema, module, source, or run identity. It is never accepted as a self-declared observation status. |

The validator reports `join.status: "stale"` with exact stale reasons only when
an optional expected identity is supplied. A schema/snapshot mismatch inside the
documents themselves is a validation `error`, not stale data. This distinction
prevents an untrusted payload from labeling itself stale to conceal an identity
failure.

## Fixtures and validation

`examples/five-minute-watering.ghost.md` is a literate five-minute watering
fixture. Its static and dynamic JSON examples contain real `false` and `0`
values and a `Percent` nominal type without adding an exact counter/`Int`
representation. `validate.mjs` performs strict unknown-field, public-identity,
provenance, semantic-type, exact schema digest, static identity, completion,
and descriptor-coverage checks. It validates records only; it makes no device,
physical, frontend, compiler-emission, or runtime-collection claim.

The v0 alternative rejected here is putting `stale` beside `ready` in an
untrusted observation. That would make a producer's assertion substitute for a
consumer's identity join. Deriving it in validation keeps the document small
while making restart and revision mismatches explicit.
