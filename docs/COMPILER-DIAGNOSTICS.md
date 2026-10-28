# Public compiler diagnostics

`compileSource` in the browser and Node toolchains returns `diagnosticEnvelope`.
Successful compilation may include warnings in `diagnostics`; a clean successful
compile has an empty array. A located compilation
failure rejects with the same property on the thrown error. The existing error
class, message, and CLI text remain unchanged except for the actionable missing
Interaction Schema provenance and undeclared Celsius guidance described below.

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

The compiler, CLI, and package creation report intent-link coverage warnings
on successful compilation: `GF_INTENT_LINK_MISSING` for supported but unlinked
statements, and `GF_INTENT_LINK_COVERAGE_UNSUPPORTED` when a behavioral owner
has no supported link target. See
[default behavior coverage warnings](INTENT-ANCHOR-MAP.md#default-behavior-coverage-warnings)
for the covered statement kinds, limits, imports, and interpretation boundaries.
For a successful warning in an imported document, the diagnostic envelope's
`source` remains the root compilation document, while the warning's `span.file`
identifies the imported source location. The `sourceClosure` retains the child
document identity. This differs from an imported-document error, whose
diagnostic `source` identifies and hashes the child and whose `requestSource`
identifies the root request.
The CLI human-readable output includes each warning's location, code, and hint;
JSON and TOON output carry the same records. The compilation result retains
`warnings`, containing extraction warning strings and the structured
intent-link warning records; the envelope's `diagnostics` contains those
structured records. This is additive API metadata and does not change
executable output.

`buildPortablePackage` also replays the source after provenance validation and
reports fresh replay warnings. Pass `onDiagnostic` to handle each warning;
without a callback the package builder uses `console.warn`. The callback runs
only after replay succeeds and its exceptions propagate. Verification remains
silent, and warnings do not enter or change the signed payload.

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

## Undeclared Celsius type

An undeclared `Celsius` still rejects with `GF_SEMANTIC`, message
`unknown type Celsius`, and the original type span. Its `hint` explains that a
Celsius measurement uses `input temperature: Temperature;` and a value such as
`30°C`. The `reference` links to the book's existing
[quantity-to-type lookup](ProgrammingInGhostflow.md#quantity-type-lookup).
The human CLI includes the same guidance; JSON/TOON carry the structured hint.
No source is rewritten and no type alias is added. A user-defined enum named
`Celsius` still resolves normally, and unrelated unknown types keep their
existing diagnostics. Valid programs retain the same executable bytes.

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
