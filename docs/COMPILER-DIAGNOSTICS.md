# Public compiler diagnostics

`compileSource` in the browser and Node toolchains returns `diagnosticEnvelope`.
Successful compilation has an empty `diagnostics` array. A located compilation
failure rejects with the same property on the thrown error. The existing error
class, message, and CLI text remain unchanged except for the actionable missing
Interaction Schema provenance diagnostic described below.

The envelope format is `GhostFlow/diagnostics-v1`:

```json
{
  "format": "GhostFlow/diagnostics-v1",
  "source": {
    "filename": "farm.ghost.md",
    "sha256": "<lowercase SHA-256 of the exact UTF-8 document>",
    "documentId": "<when interactionSourceIdentity was supplied>",
    "revisionId": "<when interactionSourceIdentity was supplied>"
  },
  "diagnostics": [{
    "code": "GF_PARSE",
    "severity": "error",
    "message": "expected expression, found ;",
    "span": {
      "file": "farm.ghost.md",
      "start": { "line": 6, "column": 11 },
      "end": { "line": 6, "column": 12 }
    }
  }]
}
```

Coordinates are one-based and refer to the original `.ghost.md` document,
including prose and fence lines. Columns follow the compiler's UTF-16 code-unit
coordinates. `end` is exclusive and appears only when the compiler has a mapped
end position. `hint`, `related`, and `reference` are
optional and are absent until the compiler has evidence for them. In particular,
the compiler does not guess a Reference section from message text.

Codes presently emitted are `GF_LITERATE` for document extraction,
`GF_PARSE` for syntax, `GF_TYPE` for output type mismatches, `GF_IMPORT` for
composition/import validation, and `GF_SEMANTIC` for other compiler checks.
The message is the human error detail without its filename and coordinate prefix.
An imported document diagnostic names and hashes that imported document in
`source`. It also carries the root compile request in `requestSource`, with the
root filename, SHA-256, and supplied document/revision IDs. The root identity is
never assigned to the child. `GF_IMPORT` is reserved for missing imports,
revision/digest mismatches, and import cycles; composition type and semantic
checks keep their own class. Input validation without
an authored position still throws its existing error without a diagnostic span.

The envelope is API metadata. It does not change GFB bytes, the persisted
source-map artifact, or runtime behavior. Source identity and executable
provenance remain governed by [SOURCE-MAP.md](SOURCE-MAP.md).

## Missing Interaction Schema intent provenance

When `interactionSourceIdentity` requests a schema, each authored state, timer,
and operator config needs an explicit literate anchor link. Missing links now
report `GF_INTENT_PROVENANCE` at the declaration's original Markdown span, with
the exact source hash and supplied document/revision IDs. The error explains
that an anchor identifies a paragraph or block quote outside code fences and a
link immediately precedes the declaration inside its `ghost` fence.

The `hint` contains valid anchor/link syntax and a collision-free example ID;
`reference` points to [the authored form](INTENT-ANCHOR-MAP.md#minimal-authored-form).
Prefer a link to an existing active anchor whose reason actually applies.
The alternative example is explicitly `kind=assumption status=unconfirmed
origin=ai` with `relation=assumes`. Author and review the actual reason before
adoption; compilation never confirms it. Confirmed intent must come from a
person and follow the existing reclassification contract. No source edit is
applied automatically. Missing, duplicate, orphan, incompatible and superseded
anchor/link rejection remains intact. The suggestion changes no executable
tokens or GFB bytes when authored into a new source revision.

## Bounded error collection

After parsing and declaration setup succeed, the compiler collects errors within
one validation phase: `let` bindings, next-state assignments, or ordinary output
connections. It stops after a failing phase. Failed `let` dependencies reuse their
original error, preventing misleading cyclic-definition cascades. Diagnostics are
sorted by filename, line and column; the thrown exception retains the first
encountered error's message. Markdown fences and imported documents retain their
authored locations. The envelope's source identity describes its first diagnostic
document; each diagnostic span identifies its own file.

The cap is **20 distinct errors**. Collection probes for a 21st error before
reporting `collection: { limit: 20, truncated: true }` in the API envelope and CLI
JSON/TOON result. This means more errors were found; it is not a total count.
Exactly 20 errors do not set overflow metadata. The CLI projects the same
diagnostics as the API. A failed compile never returns or writes an artifact.

Parser errors, declaration setup, function validation, adaptive strategies,
constraints and later lowering still stop at their first error. Recovery does not
cross these boundaries or attempt syntax repairs. Unexpected internal or
unlocated failures are rethrown immediately, including after earlier source
errors, so a compiler failure cannot be hidden by diagnostic collection.
Fixing the reported phase can reveal errors in later phases; an error report
does not claim to enumerate every mistake in a document.
