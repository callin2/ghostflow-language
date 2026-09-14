# Literate intent anchor map

Status: Main implementation contract for LS-1c, 2026-09-15. Tracking:
language issue #60 / integration issue #17 / local TASK-112.

This is a deliberately small, additive source-provenance layer. It does not add
an executable GhostFlow construct, change GFB1 bytes, change the strict control
manifest, or make metadata affect runtime output. The authored `.ghost.md`
document remains the only canonical product source. A generated map is never an
editable second source.

## Why this exists

The exact literate document and compiler node locations are already preserved.
That answers “where is this output calculated?” but not “which stated intent or
premise led to this calculation?” LS-1c adds an explicit link. The compiler only
validates what the author supplied; it does not infer intent, discover tacit
knowledge, or approve an AI assumption.

## Minimal authored form

An anchor is a standalone top-level Markdown HTML comment immediately followed
by one top-level paragraph or block quote:

```markdown
<!-- ghostflow:anchor id=GF-INT-PUMP-001 kind=intent status=confirmed origin=user -->
> 급수 요청 스위치를 켜면 펌프를 켜 주세요.
```

The comment is non-rendering metadata. The following block is the anchored
original text. A blank line between the comment and the block is allowed because
CommonMark separates both as top-level blocks. A heading, list, nested block,
code fence, another anchor, or end of document is not an anchor body. One block
keeps source ranges and review units unambiguous; longer explanations use
multiple anchors or ordinary unanchored prose.

The fields and their order are exact in v1:

- `id`: `[A-Za-z][A-Za-z0-9._:-]{0,127}`; unique in one document and stable
  across wording revisions when the same intent remains.
- `kind`: `intent`, `premise`, or `assumption`.
- `status`: `confirmed`, `unconfirmed`, or `superseded`.
- `origin`: `user`, `operator`, `engineer`, `ai`, or `imported`.

`assumption` may be `unconfirmed` or `superseded`, but never `confirmed`. Once a person confirms it, the
canonical source reclassifies it as `intent` or `premise`; the old assumption
may remain as `superseded` prose without a current executable link. A
`superseded` anchor cannot link to a current node. These checks prevent an AI
guess from silently becoming confirmed intent. They do not define a product
approval workflow.

A link is an exact whole-line comment inside an executable `ghost` fence:

```ghost
// ghostflow:link id=GF-INT-PUMP-001 relation=implements
pump <- request;
```

The fields and their order are exact. `relation` is one of:

- `implements`: this node implements stated behavior.
- `constrains`: this node restricts behavior for an intent or premise.
- `fallback`: this node implements an explicit degraded-time/data policy.
- `assumes`: this candidate node currently relies on an unconfirmed assumption.

One or more consecutive link lines may target the same statement. The target is
the immediately following traceable top-level declaration or statement. A blank
line, ordinary comment, nested expression, control header, or end of fence makes
the link orphaned and is an error. The supported v1 target kinds are the parser's
top-level declarations and statements: `input`, `output`, `state`, `config`,
`let`, `enum`, `function`, `sensor`, `signal`, `schedule`, `timer`, `require`,
`mutex`, `next`, and `connection`.

Relation/classification checks are intentionally narrow:

- `assumes` must reference an `assumption` with `status=unconfirmed`.
- Other relations cannot reference an `assumption`.
- No relation can reference a `superseded` anchor.

Whether an unconfirmed candidate may be simulated, reviewed, approved, or
deployed is a host/product policy. The language artifact preserves the fact; it
does not silently allow or deny a release.

## Derived metadata

For a literate source containing anchors or links, the existing
`GhostFlow/source-trace-v1` companion gains two optional arrays. Sources without
this feature keep the existing shape and behavior.

`intentAnchors[]` contains:

- `id`, `kind`, `status`, and `origin` exactly as authored;
- `directiveSource`: original Markdown location of the anchor directive;
- `source`: original Markdown range of the following paragraph or block quote.

`intentLinks[]` contains:

- `anchorId` and `relation` exactly as authored;
- `nodeId` and `nodeKind` from the authoritative compiler AST;
- `directiveSource`: original Markdown location of the link comment;
- `source`: the authoritative target node location;
- `extractedDirectiveSource` and `extractedSource` only for literate compilation,
  retaining the code-fence coordinate system as the existing trace does.

The arrays never copy or normalize the anchored prose. A consumer obtains exact
text by slicing the already verified `sourceDocument.text` at the recorded
range. This avoids creating a second maintained text copy.

The companion continues to carry `sourceDocumentSha256` and `bytecodeSha256`.
Strict recovery validates both revision identities, every anchor and link shape,
unique IDs, relation/classification compatibility, target node ID/kind/location,
and directive/source locations inside the selected document. It rejects unknown
fields or enum values, duplicate anchors or duplicate identical links, missing
anchors, orphan links, a metadata node/location that disagrees with the supplied
source map, mixed revisions, and out-of-range locations. No verifier reconstructs
or guesses a missing link.

This local recovery API proves internal consistency, not authenticity. An attacker
who can replace the whole source map can replace both a node and its matching
metadata. Authenticity requires either the existing portable package verifier,
whose signed payload covers the source-map digest, or a trusted deterministic
compiler replay from the verified source document. LS-1c must not claim that an
unsigned standalone map detects coordinated replacement.

## Extraction and compatibility

- CommonMark determines top-level Markdown blocks. Text-looking directives in
  fenced code, inline code, multi-line or enclosing HTML blocks, nested blocks,
  or front matter are not Markdown anchors.
- Only top-level `ghost` fences execute, exactly as before. Link comments remain
  ordinary `//` comments to the GhostFlow lexer and produce no opcode.
- Plain `.ghost` remains a low-level compatibility/import path. It has no
  Markdown anchor namespace; a `ghostflow:link` directive there is rejected as a
  broken reference rather than accepted with invented intent.
- Documents without anchor/link directives produce the same code, GFB bytes,
  node IDs, diagnostics, manifest, and runtime behavior as before.
- Prose/comment-only changes alter `sourceDocument.sha256`. When executable token
  structure is unchanged, GFB bytes and compiler node IDs remain unchanged;
  original document locations may move and are revision-bound.

## Diagnostics and acceptance vectors

Diagnostics identify the original filename, line, and column and cover:

1. valid confirmed intent to output, premise to constraint, fallback to schedule,
   and unconfirmed assumption to candidate-node links;
2. malformed/unknown fields, duplicate IDs, missing or invalid body blocks;
3. unknown, superseded, or classification-incompatible anchor references;
4. orphaned directives, nested targets, and duplicate identical links;
5. persisted source/bytecode revision mismatch, metadata/node inconsistency,
   source-range tampering, and signed-package source-map replacement;
6. prose/comment-only revision changes with identical GFB bytes and node IDs;
7. unchanged existing literate, plain-source, source-map, package, native, and
   WASM behavior.

Acceptance is compiler/source-map evidence only. It is not frontend navigation,
firmware integration, GPIO output, relay movement, or physical load evidence.

## Deliberate non-goals

- Natural-language interpretation, tacit-premise discovery, confirmation UI,
  authorization, and deployment approval.
- Per-expression execution-path causality or a claim that every static read
  caused an output.
- SMT/BDD optimization or proof generation. Issue #42 may later attach
  compiler-produced origin/proof records to the same stable anchor and node
  identities, but it must not rewrite authored intent or mark an unverified
  relation as proved.
- A general annotation language, arbitrary key/value extensions, multi-file
  imports, or a new source format.
