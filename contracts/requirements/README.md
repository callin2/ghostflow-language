# Requirement catalog

`catalog.json` is a small relational, SQLite-inspired traceability slice. The
`requirements` table stores content-addressed normative statements; the `tests`
table stores source-backed verification rows. `testIds` is the relation between
the two tables. A requirement without a test row is allowed only when it has a
non-empty `pendingReason`; this keeps missing coverage visible instead of
silently treating design prose as execution evidence.

Requirement IDs are `GF-REQ-` followed by the first 16 hexadecimal characters of
the SHA-256 digest of the exact `statement` string. Source and test locators are
required to name a repository-relative file, a heading/source anchor, an
inclusive line range, and a SHA-256 digest of that range's normalized excerpt
(line endings and whitespace are normalized). Markdown headings must exist and
precede their ranges; source anchors must occur before the ranges. The catalog
validator checks IDs, duplicate rows, locators, excerpt digests, and both sides
of the requirement/test relation. It does not claim that a referenced test
proves more than its selector describes, and pending host/Driver or physical
behavior stays outside this language export.

## Current inventory

The catalog currently contains 42 atomic rows across the requested execution
specification slice. They keep direct evidence links small and leave uncovered
behavior as `pending` rather than upgrading documentation to an acceptance
claim. The rows overlap the named documents; they do not independently catalog
every prose sentence.

The current catalog has 16 `implemented`, 4 `partial`, 21 `pending`, and 1
`design-only` statuses, linked to 18 source-backed test records. Here
`implemented` means the exact statement has focused automated
evidence in this catalog; it is not exhaustive language, platform, or physical
assurance. The validator rejects `implemented` rows with unresolved pending
reasons or without tests. `GF-REQ-d9f669f061279c41` retains the superseded MVP
wording, ID, and excerpt hash as historical evidence; `GF-REQ-fe719c3299fc1258`
links the accepted old-state/explicit-next rule to current tests. See
`docs/TASK-61-CONFORMANCE.md` for the dated TASK-61 baseline.

The catalog does not row explanatory prose, historical alternatives, repeated
examples, or consumer-owned physical/API behavior. Remaining language details
outside these finite slices are intentionally excluded with no coverage claim;
when cataloged, design-only sketches and unavailable evidence must remain
explicitly marked `pending` or `design-only` with a reason.
