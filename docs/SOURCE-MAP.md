# Source-preserving artifact map — first slice

Status: Main implementation contract, 2026-09-13. Implements part of LS-1;
intent-anchor syntax, per-expression traces and optimizer provenance are later slices.
GFB1 bytes, execution semantics and the existing sourceMap node array stay unchanged.

## Why

The authored source is a literate document containing intent, code, comments and
explanation. The user's explicit rule is to preserve comments after compilation
and transpilation. A coordinate map without the original text cannot do this.

## Additive contract

`compileSource` additionally returns `sourceDocument` with these fields:

| Field | Meaning |
|---|---|
| format | `GhostFlow/source-document-v1` |
| kind | `literate` for `.ghost.md`, otherwise `plain` for existing low-level inputs |
| filename | original input name, used only as metadata, never as an output destination |
| text | exact accepted input string; preserve comments, prose, CRLF, Unicode and trailing newline |
| sha256 | lowercase SHA-256 of the UTF-8 input text before extraction or normalization |

Input must be a well-formed Unicode string, representable in UTF-8 without loss,
within the existing 1 MiB source limit. The existing parser/extractor limits still
apply. Recording a plain test/import input does not make it a second canonical
product source format. No new source grammar is introduced.

The existing `.gfb.map.json` gains `format: GhostFlow/source-map-v1`,
`bytecodeSha256` and `sourceDocument`. Its `nodes` and `lines` fields remain as
before. Keep the control manifest unchanged: the current WASM host rejects
unknown manifest fields. The source digest lives in sourceDocument; product
release records can carry it using their existing source-identity contract.
Old readers may use their existing nodes/lines; readers promising source recovery
must require the new envelope and validate it, rather than reconstructing prose.

`compileSource.sourceMap` remains an array. Direct low-level `compileControl`
callers and legacy `writeArtifact` results without sourceDocument retain their
previous behavior; they do not claim source-preserving output. New compileSource
results, including low-level legacy inputs, carry the original text and write a
source-preserving map even when there is no control manifest.
An explicitly present but invalid sourceDocument (including null or undefined)
is an error, not a request to silently fall back to the legacy map.

## Verification boundary

Export `verifyArtifactSourceMap(map, bytes, { expectedSourceSha256 } = {})` from
the toolchain. It returns the verified sourceDocument and rejects unsupported
formats, missing/invalid source fields, invalid kind/name, over-limit or non-UTF-8
text, invalid digest spelling, text digest mismatch and bytecode digest mismatch.
It checks the basic map container shape (nodes array; lines array or null).
An expected source digest, when supplied, must be valid and match the document.

Without the expected digest the verifier establishes internal integrity, not
which document revision the caller intended. In particular, two comment-only
revisions can have identical GFB bytes. Product callers must supply the revision
they expect, for example the release record's sourceSha256. This function
does not authenticate artifacts or prove node mappings/intent semantics; existing
trusted-compiler and deployment identity rules still apply.

`writeArtifact` validates new envelopes and the existing manifest bytecode digest,
then prepares JSON before any file writes. It does not replace existing files
when these checks or serialization fail.
This slice does not make the existing multi-file writer an atomic transaction;
consumers must reject mixed revisions. Package-level transactional publication
remains a host responsibility. Never write to sourceDocument.filename.

## Acceptance examples

- Full-line and trailing comments, unlinked prose and nonexecuting Markdown blocks
  survive JSON serialization and recovery byte-for-byte as accepted UTF-8 text.
- CRLF, Korean, emoji and trailing newline are preserved in the original even
  when extraction normalizes line endings for compilation.
- Prose/comment-only revisions change sourceSha256; identical code structure
  preserves GFB bytes and source node IDs. Locations may move with the document.
- Modified text, mismatched bytes, missing source, invalid digest/kind and an
  incorrect expected document revision fail verification before recovery.
- Low-level plain and legacy fixtures keep their executable behavior. Existing
  nodes/lines consumers continue to read the map.

The portable runtime and physical output path are unchanged. Application code
must render source text as text, never execute embedded HTML or paths. The map
contains the original comments/prose, so access controls follow the original
source document, not a publicly shareable debug-file default.
