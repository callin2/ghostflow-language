# Selective Language Reference query

`tools/reference-query.mjs` reads the canonical [Language Reference](LANGUAGE-REFERENCE.md)
index and its linked chapters at call time. It emits a deterministic catalog of numbered
`##` sections. It does not keep a second copy of language rules.

Section IDs use `ref-CC-SS`, where `CC` and `SS` are the numbered chapter and section
in the canonical heading. For example, `ref-02-08` is §2.8. Titles may change while
the ID stays the same. Moving a rule to a different numbered section changes its ID.
Each row includes the canonical source path, heading, GitHub heading citation,
classification, topic and symbol aliases, exact excerpt byte count and SHA-256 digest.
Classification is curated for reviewed sections. `unspecified` means the tool makes
no claim about whether every paragraph is normative; read the cited text itself.
`sourceDigest` hashes the index and every linked chapter's path and SHA-256 digest.
The catalog is regenerated on each call. Duplicate IDs and stale aliases fail.

## TOON request and result

The request is a strict TOON object. Fields are `operation` (`catalog` or `lookup`),
`budgetBytes` (integer 256–1,000,000), and, for lookup, exactly one of `sectionId`,
`topic`, or `symbol`. Selectors are nonempty strings. Unknown fields are rejected.
Topic lookup is case insensitive; symbol and section ID lookup are exact.
Known topic and symbol aliases are listed in the catalog. `no_match` and
`budget_exceeded` are explicit statuses. A successful TOON response, including
metadata and excerpt, fits within `budgetBytes`. The small error response reports
`requiredBytes` when a match exceeds the limit.

```toon
operation: lookup
sectionId: ref-02-08
budgetBytes: 20000
```

The `markdown` field decodes to the byte-exact section slice from the chapter,
including its heading and final newline. TOON string escaping is transport syntax;
the decoded field is the original Markdown. A section digest verifies it.

```sh
node tools/reference-query.mjs --toon-request request.toon
node tools/reference-query.mjs --toon-request - < request.toon
```

## Human CLI

```sh
node tools/reference-query.mjs catalog
node tools/reference-query.mjs lookup --section ref-02-08
node tools/reference-query.mjs lookup --topic timer --budget 20000
node tools/reference-query.mjs lookup --symbol ghostflow:anchor
```

The human lookup prints citation and digest before the original Markdown.
The default budget is 32,768 bytes. `--budget` changes it. Exit status is 1 for
no match and 2 for an invalid request or an exhausted budget.

This lookup does not infer grammar from topic names. Use the cited exact section
and its surrounding chapter when a rule depends on wider context.
