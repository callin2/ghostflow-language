# Documentation languages

The [development workflow](DEVELOPMENT-WORKFLOW.md) unifies discovery and verification. `npm run docs:find -- --limit 8 QUERY` checks freshness without writes and searches repository Markdown/HTML paths and titles. After each completed edit batch, `npm run docs:index` regenerates `docs/INDEX.md` then root `INDEX.md`. `npm run docs:check` combines translation validation, pinned index-tool provenance and both index freshness checks before heavy builds.

This policy records the user's 2026-09-28 request for English and Korean
versions of every document except reports. Tracking: [#344](https://github.com/callin2/ghostflow-language/issues/344).

Authored documentation must be available in English and Korean. Reports and
historical execution/measurement evidence may remain in their original language.
Classify every tracked or nonignored untracked Markdown file in
`docs/translations.json`; exclusions require an exact path and a concrete reason.
Do not exempt a whole directory. Generated metadata, test fixtures and canonical
source documents require explicit classification too. Non-Markdown source,
generated metadata and tests are outside this Markdown gate.

Keep the original path. An English `NAME.md` uses `NAME.ko.md`; a Korean
`NAME.md` uses `NAME.en.md`. A literate `NAME.ghost.md` uses
`NAME.ghost.ko.md` or `NAME.ghost.en.md`. The counterpart is a documentation
projection, never a second canonical compilable source. Preserve original
canonical source, line references and historical hashes. Keep executable code
blocks identical. Translate explanatory prose, labels and comments in `text`,
`mermaid` and `plantuml` blocks. Preserve code statements, identifiers, formulas
and verbatim license quotations exactly.
Preserve the heading-level sequence and explicit HTML anchor IDs. Heading text
may be translated; implicit heading slugs are not compared.

Each translation includes `<!-- translation-source: SOURCE_PATH -->` and an
ordinary Markdown link to its original, using a relative or repository-root path.
In translated examples, claims about the canonical source refer explicitly to
the linked original.
For this policy, see the [Korean version](DOCUMENTATION-LANGUAGES.ko.md).
The manifest format is `GhostFlow/document-translations-v1`; each document records
`source`, `sourceLanguage` (`en` or `ko`), `translation`, `sourceSha256` and
`translationSha256`. Each exclusion records `path` and `reason`.

Update both languages and their manifest digests in the same change. Run
`npm run docs:check` and `node --test tests/doc-translations.test.mjs`.
Resolve source comparisons with `git rev-parse` and `git show` in the target
worktree; a named temporary checkout is not evidence of a branch's contents.
The verifier runs this gate before host builds. There is no automatic digest
restamping option. The gate checks coverage, paths, links, freshness, headings,
explicit anchors and code preservation. Digests do not prove translation meaning; reviewers must check
that both languages convey the same intent and constraints.
