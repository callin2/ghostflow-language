# Offline authoring measurement — 2026-09-24

[The dated machine-readable report](LLM-AUTHORING-EFFICIENCY-MEASUREMENT-2026-09-24.json)
records the current source, toolchain and Reference digests for the issue #90
settings-stream change. The same seven corpus cases completed 16 compilation
rounds, three correction rounds and one virtual simulation. All recorded
compiler outcomes and virtual safe intents matched the
[2026-09-23 baseline](LLM-AUTHORING-EFFICIENCY-BASELINE-2026-09-23.json).
Reference retrieval grew to 34,319 content bytes and 42,611 response bytes
after the Reference edits. The token comparison was recounted with
`tiktoken==0.12.0`; the virtual simulation response measured 1,846 TOON bytes
and 587 tokens versus 1,666 compact JSON bytes and 511 tokens.

The 2026-09-23 baseline is immutable historical evidence. Future source or
Reference changes may change fresh digests and byte measurements without
changing that file or its expected hash. Record a new dated measurement for an
intentional comparison. The authoring test checks the historical file's raw
SHA-256 independently, then verifies current compilation, source identity,
simulation behavior and stable corpus outcomes. It rejects tampering with
either historical metrics or provenance.
