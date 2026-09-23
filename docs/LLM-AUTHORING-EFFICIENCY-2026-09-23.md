# Offline LLM authoring baseline — 2026-09-23

This baseline measures the language workflow, not an LLM. The corpus covers a valid control, typo, type mismatch, undeclared setting, unsupported syntax, an unconfirmed operating assumption, and a virtual timer. It makes no claim about model comprehension or real device safety.

The machine-readable baseline records each section digest, source revision identity/digest, per-case bytes and rounds, and tokenizer comparisons in [LLM-AUTHORING-EFFICIENCY-BASELINE-2026-09-23.json](LLM-AUTHORING-EFFICIENCY-BASELINE-2026-09-23.json).

## Repeat the measurements

The registered test uses the checked-in `tiktoken==0.12.0` token baseline and needs no Python package. It reruns Reference retrieval, compile/correction rounds, and virtual simulation without network or model API:

```sh
node --test tests/authoring-efficiency.test.mjs
GF_AUTHORING_REPORT=1 node --test --test-reporter=spec tests/authoring-efficiency.test.mjs
```

To recompute the token comparison, install `tiktoken==0.12.0` once and rerun with `GF_AUTHORING_RECOMPUTE_TOKENS=1`. The recount uses the pinned `cl100k_base` encoding. The test compares the result with the checked-in baseline, so an encoding or payload change requires an intentional rebaseline.

If the native scenario runner is not already built, prepare it once with the repository's offline toolchain:

```sh
cargo build --locked --offline --release -p ghostflow-core --example scenario_scan
```

The second test command prints one `AUTHORING_EFFICIENCY_REPORT=` JSON record. The test asserts selected Reference sections, diagnostic source identity, correction revision identity, compiler outcomes, virtual safe intents, byte totals, tokenizer version, and token counts. An unrelated retrieved Reference section or changed baseline requires an intentional corpus review.

## Corpus and outcomes

Reference bytes are measured per case, so a section retrieved by two cases counts twice. `content bytes` count the selected section text. `response bytes` count the complete TOON lookup response including its line terminator. `diagnostic bytes` count structured TOON compiler responses. Simulator bytes count the complete TOON result including its line terminator.

| Case | Retrieved Reference sections | Content / response bytes | Compile / correction / simulation rounds | Diagnostics / simulator bytes | Outcome |
|---|---|---:|---:|---:|---|
| Valid control | 1.5, 2.6 | 3,961 / 5,014 | 2 / 0 / 0 | 0 / 0 | Compiled |
| Typo correction | 1.5, 2.6 | 3,961 / 5,014 | 3 / 1 / 0 | 499 / 0 | Compiled after correction |
| Type correction | 2.1, 2.6 | 4,081 / 5,119 | 3 / 1 / 0 | 494 / 0 | Compiled after correction |
| Missing setting | 3.2, 5.1 | 6,759 / 7,925 | 3 / 1 / 0 | 531 / 0 | Compiled after correction |
| Unsupported syntax | 1.4, 1.6, 3.2 | 6,303 / 7,976 | 1 / 0 / 0 | 520 / 0 | Unresolved; no syntax invented |
| Unconfirmed assumption | 1.2, 5.4 | 4,191 / 5,346 | 2 / 0 / 0 | 0 / 0 | Confirmed intent compiled; open value remains unanswered |
| Virtual timer | 2.8, 3.2 | 3,929 / 5,071 | 2 / 0 / 1 | 0 / 1,811 | Completed virtual scenario |
| **Total** | **15 case-section retrievals** | **33,185 / 41,465** | **16 / 3 / 1** | **2,044 / 1,811** | |

Correction attempts keep the same `documentId`, use a new `revisionId`, and produce a different full-document SHA-256. Every diagnostic is checked against the original document identity and path. The timer scenario checks the expected safe `pump` intents at 0 ms, 1,999 ms, and 2,000 ms: `true, true, false`. These checks measure compiler and simulator conformance. They do not measure an LLM's ability to derive or explain those results.

## TOON and compact JSON comparison

Token counts use `tiktoken 0.12.0`, encoding `cl100k_base`. JSON is compact `JSON.stringify` output. Format byte counts exclude the CLI line terminator. This is a small sample, not a claim that either format is always smaller.

| Payload | TOON bytes / tokens | Compact JSON bytes / tokens |
|---|---:|---:|
| Typo diagnostic result | 498 / 176 | 547 / 174 |
| Virtual timer result | 1,810 / 581 | 1,630 / 506 |

TOON is 49 bytes smaller for the diagnostic but uses 2 more tokenizer tokens. The timer result is 180 bytes and 75 tokens larger as TOON. Keep the format comparison visible; do not infer token savings from byte savings.

## Pinned inputs

The corpus manifest names every source and toolchain file used by the run. The baseline records their SHA-256 values, the package lock, the Rust core source tree, the native scenario runner, and the retrieved Reference source digest. The aggregate toolchain/retrieval identity is `3da5e81c5d10f74c3d46807be2aa20b8dd9cded68070b871c547852e221ea9fe`; the Reference source digest is `sha256:8d3321241fd3bc7c731ed3ebf9d65f58dfe47427bb81137a41210d804624eea4`.

The encoder is pinned to `@toon-format/toon@4.1.1`. The tokenizer is pinned to `tiktoken==0.12.0` / `cl100k_base`. Source documents, revision IDs, and their digests appear in the generated report. Rebuild or rebaseline only after reviewing the changed source, encoder, tokenizer, or runtime evidence.

The test is offline after dependencies and the native runner are available. It calls no model provider. Compiler acceptance does not imply that an operating assumption is confirmed, that a runtime scenario is representative of a farm, or that any physical Driver/relay is safe.
