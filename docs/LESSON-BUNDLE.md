# Lesson bundle v1

Tracking: https://github.com/callin2/ghostflow-language/issues/7 (TASK-58.4).
This is the portable artifact/compile slice, not player or execution acceptance.

## Ownership and API

`tools/lesson.mjs` validates bounded JSON input before extracting authoritative
CommonMark GhostFlow fences and calling the existing control compiler. It owns no
interpreter, device connection, storage, or lesson clock. Browser consumers must
provide Web Crypto in a secure context. External media is not supported in v1.
The compile adapter rejects extraction warnings, including ignored nested GhostFlow
fences, rather than presenting such code as part of the executed lesson. Compiler
diagnostics are mapped back only when an original source location is available.

The document carries `format: ghostflow-lesson-v1`, lessonId, revision, title,
locale, source, playback, scenarios, toolchain and bundleSha256. Unknown fields
are rejected so unsupported instructions cannot silently acquire meaning.

- Source contains raw text, SHA-256 and the media type
  `text/markdown; profile=ghostflow-literate`.
- Playback contains durationMs and ordered checkpoints. A checkpoint contains
  atMs, inclusive 1-based sourceSpan startLine/endLine, plain-text narration and
  scenarioId. Spans refer to the original Markdown; they may explain prose.
- Scenarios have unique id, title and ordered frames. Each frame contains atMs
  and a map of input names to Boolean or finite numeric values.
  There must be at least one scenario, frame and checkpoint; times in each array
  are strictly increasing. Each frame permits at most 128 identifier-named inputs;
  prototype-related names are rejected.
- Toolchain records compilerId/compilerRevision/runtimeId/runtimeRevision and
  ABI version 1. Identifiers are declarations, not proof of loaded artifacts.

Narration time and scenario scan time remain separate domains even though both
use integer milliseconds. Rerunning a scenario starts from a fresh runtime;
a narration checkpoint is never a VM snapshot. The execution consumer must
verify loaded compiler/runtime identities and input binding compatibility before
claiming a valid comparison. A declared identity is not that verification.

## Integrity and limits

Source SHA-256 hashes exact UTF-8 bytes, without newline or Unicode normalization.
Bundle SHA-256 hashes canonical JSON with the top-level bundleSha256 omitted:
object keys sorted, array order retained. This detects inconsistent contents,
not malicious authorship: anyone can recompute an unsigned digest.
The exported canonicalization helper serializes the value supplied; bundle
authors must omit the top-level bundleSha256 before calling it for that digest.

Hard limits are 1 MiB JSON, 64 KiB source, 600,000 ms narration/scenario time,
256 checkpoints, 16 scenarios, 1,024 frames per scenario, 4,096 frames total and
4,096 characters per narration. Bundles cannot increase these limits. Source
positions, times, ordering and scenario references are checked before compilation.
Compiler resource checks remain in force. Worker execution deadlines are owned
by the frontend, not claimed by this artifact validator.

## Evidence boundary

Validation proves only the supported artifact contract and integrity. Compilation
proves acceptance by the existing compiler. Neither establishes a matching trace,
successful browser playback, physical load operation or deployment readiness.
Expected trace identity will be produced and checked by the subsequent first
example/consumer task rather than fabricated by this validator.
