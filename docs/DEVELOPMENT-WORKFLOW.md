# Efficient development workflow

This procedure covers feature work, bug fixes, documentation additions and
documentation updates in the GhostFlow language repository. It keeps the task
contract and verification focused. It does not replace repository policy in
`AGENTS.md` or [`VERIFICATION.md`](VERIFICATION.md).

Related work: [#348](https://github.com/callin2/ghostflow-language/issues/348)
and the shared [doc-index skill](https://github.com/callin2/doc-index/issues/2).

## 1. Establish the working context

Start new GhostFlow work from `dev`. Confirm the actual repository root and
branch, record the exact Git base SHA, and check the worktree for existing
changes. Never infer branch contents from a named temporary checkout. Read the
local `AGENTS.md` and search the document index before reading relevant design,
documentation or source files, for every task type:

```sh
npm run docs:find -- --limit 8 QUERY
```

This searches indexed Markdown/HTML paths, titles and types. It is not full-text
search. Use `rg` or open the identified files when prose or source content must
be searched. Do not repeat the index search or source investigation during
handoffs unless new evidence requires it.

## 2. Set one task contract

State the requested outcome, scope, remaining acceptance criteria, hard
prerequisites, and the focused verification command. Separate work that is
complete, blocked by a real prerequisite, and independently actionable. Keep
unrequested cleanup out of scope.

| Work | Entry and required result | Focused verification |
| --- | --- | --- |
| Feature | Confirm the owning module and relevant contract. Implement the requested behavior and its meaningful coverage. | Run the narrow test for the changed behavior, then required repository CI. |
| Bug fix | Capture a failing reproduction first. Preserve the existing test oracle and add the smallest regression check. | Show the reproduction fails before the fix and passes after it; run required repository CI. |
| Documentation addition | Confirm audience and canonical location. Add matching English/Korean documents, translation links and source markers, and manifest/catalog entries. | `npm run docs:check`; run any focused example or requirement-catalog check that applies. |
| Documentation update | Edit both language versions and update affected manifest/catalog metadata. Keep the canonical original authoritative, match executable examples across translations and preserve historical records. For authorized source or semantic changes, edit the canonical original first, then regenerate affected derived outputs and run appropriate checks. Translation-only work leaves program code unchanged. | `npm run docs:check`; run focused example or requirement-catalog checks when affected. |

### Language-rule changelog

Any change to accepted syntax, types, evaluation, state, time, output or
constraint meaning or semantic-error behavior; or a bug fix that changes observable
language behavior must add an entry to root `CHANGELOG.md` and `CHANGELOG.ko.md`
in the same PR. Create this pair with an `Unreleased` / `미출시` section on the
first such change; do not invent historical changes or release versions. Record the
date, affected rule/reference section, concise before→after behavior and reason,
compatibility or migration impact when applicable, a minimal example and
regression evidence, and the issue/PR link. Label a fix restoring documented
behavior as a bug fix, not a new specification decision. Update affected
Reference sections, examples, English/Korean docs and tests together, and
preserve prior entries. Language-rule/profile, GFB/ABI and package versions are
distinct. Typo, translation or layout edits alone need no semantic entry. When
the pair is created, follow the normal documentation index/check policy.

## 3. Assign a complete bounded handoff

Use the cheapest capable worker: Luna for mechanical work, Sol for substantive
implementation, and Astra for exceptionally difficult or unresolved work.
Independent, non-overlapping units may run in parallel. Give one worker each
complete bounded unit, including implementation, tests and documentation where
needed. Avoid serial investigation, implementation and testing handoffs. The
main agent owns design, priority, integration and final review.

```text
Outcome:
Scope and owned files:
Completed / blocked / independent:
Acceptance criteria:
Prerequisites and constraints:
Focused verification command:
Return: changed files, commands and results, remaining risks or blockers.
```

## 4. Verify once, at the right depth

Run static checks first, then focused tests, then required full CI. Do not weaken
tests or gates to obtain a pass. Reuse previous evidence only when source,
dependencies, toolchain, configuration and relevant environment inputs match.
Report each command, exit status, useful counts and any remaining limit.

The verifier validates requirement-catalog excerpts before native compilation or
replay. If source lines move, relocate the unchanged excerpt and retain its hash;
never refresh a historical evidence hash to hide drift. Await successful static
and focused results before starting full verification. Freeze input files during
each run; a run started before a correction does not validate the final tree.

Before reusing a Node dependency directory, run
`~/.codex/bin/test-compact -- npm ls --depth=0` from the verified package root.
A matching lockfile or one successful import does not establish that all pinned
dependencies are installed. If validation fails, use a worktree-local
`~/.codex/bin/test-compact -- npm ci --ignore-scripts` before testing. Do not
repair another worktree's dependency directory implicitly.

For documentation batches, regenerate the index once after the batch, then
check translations and index freshness:

```sh
npm run docs:index
npm run docs:check
```

The always-triggered Verified WASM workflow routes exact diffs under
[issue #357](https://github.com/callin2/ghostflow-language/issues/357). Only the
README, CONTRIBUTING and `docs/DOCUMENTATION` English/Korean pairs, `INDEX.md`,
`docs/INDEX.md` and the four `docs/assets/readme-{hero,intent,replay,trace}.svg`
files qualify for the lightweight documentation lane. `docs/translations.json`
also qualifies when only those ordinary document pairs are added, removed or
have their hashes updated; all other pairs and policy metadata must stay identical.
Unknown paths, mixed changes, `.ghost.md`, specifications, contracts, verification
policy and unsafe file modes require full verification. Empty or unresolved diffs
also require full verification. PRs compare the merge-base with the head; pushes
compare the exact previous commit with the current commit.

The documentation lane installs Node dependencies without scripts, runs the whole
`docs:check` gate, doc-index contract regressions and focused routing tests, and produces no WASM artifact. Manual
workflow dispatch always runs full verification; use it when an exact-SHA artifact
is needed. The final `Verification result` check requires successful classification
and the selected lane. Require it green before merging. Branch protection settings
are unchanged; this check does not create a platform-enforced required-check rule.

Before broadening the lightweight allowlist, inspect existing tests that read the
proposed paths and retain their applicable assertions in that lane.

`docs:check` is the check-only CI gate. If changing a checker, run its focused
tests:

```sh
node --test tests/doc-translations.test.mjs tests/doc-index.test.mjs
```

Reports are exempt from translation but remain indexed. A body-only edit may
leave indexed metadata unchanged; inspect the source when confirming content.
Agent maintenance and CI checks are not a filesystem watcher.

## 5. Close the task and improve repeatability

Report the exact change, evidence and commands, exit status, relevant counts,
limits, and linked issue or pull request. Do not repeat a full review when
automated results pass and no semantic, design or safety question remains.
Measure bottlenecks before proposing a CI cadence change. Check disk space before
heavy builds. Batch external writes and update only affected fields.

Before closing, identify repeated review steps that an existing static check can
replace. Then consider the smallest justified automation for any remaining
repeated operation. Add it within the authorized scope; keep dynamic tests or
hardware evidence where static checks cannot establish behavior. Routine work
does not require a separate approval request.
