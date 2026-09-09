# Requirement catalog

`catalog.json` is a small relational, SQLite-inspired traceability slice. The
`requirements` table stores content-addressed normative statements; the `tests`
table stores source-backed verification rows. `testIds` is the relation between
the two tables. A requirement without a test row is allowed only when it has a
non-empty `pendingReason`; this keeps missing coverage visible instead of
silently treating design prose as execution evidence.

Requirement IDs are `GF-REQ-` followed by the first 16 hexadecimal characters of
the SHA-256 digest of the exact `statement` string. Source locators are required
to name a repository-relative file, heading and inclusive line range. The
catalog validator checks IDs, duplicate rows, locators, and both sides of the
requirement/test relation. It does not claim that a referenced test proves more
than its selector describes, and pending host/Driver or physical behavior stays
outside this language export.
