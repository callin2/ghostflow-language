# Contributing to GhostFlow

English · [한국어](CONTRIBUTING.ko.md)

This guide is for coding agents and the people reviewing their work. It is an
entry point to the repository rules, not a replacement for them. Read
[`AGENTS.md`](AGENTS.md) for ownership and language constraints, and
[`docs/DEVELOPMENT-WORKFLOW.md`](docs/DEVELOPMENT-WORKFLOW.md) for task sizing,
handoffs and evidence reuse.

## Start from the current development branch

Begin new work from `dev`. Confirm the repository root and branch, record the
exact base SHA with `git rev-parse HEAD`, and inspect `git status` before editing.
Preserve unrelated changes. Do not infer the contents of a temporary checkout
from its name.

Search the document index before reading design or implementation files:

```sh
npm run docs:find -- --limit 8 QUERY
```

The index searches paths and titles, not full text. Use `rg` or open the matched
documents when you need to search content. If the index is stale or missing,
report that during read-only discovery. For authorized documentation work,
refresh it after the edit batch.

## Define one bounded task

Write down the intended outcome, owned files or boundaries, acceptance criteria,
prerequisites and focused verification command. Keep completed, blocked and
independent work distinct. Do not add feature scope or cleanup that the request
does not need.

For a bug, capture a failing reproduction before changing code. Add a meaningful
regression check that would fail without the fix. Keep the existing test oracle
and repository gates intact. For language behavior, preserve the canonical
`.ghost.md` source and the ownership boundaries described in `AGENTS.md`.
Record language-rule changes and bug fixes that change observable language
behavior in both root changelog files as described in the
[development workflow](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog).

## Change and document together

Make the smallest complete change. Update implementation, regression coverage,
and relevant English and Korean documentation in the same task. Keep executable
examples identical across translations. Update reviewed hashes and catalog
metadata as required by [`docs/DOCUMENTATION-LANGUAGES.md`](docs/DOCUMENTATION-LANGUAGES.md).

Use [`docs/REFERENCE-FEATURE-STATUS.md`](docs/REFERENCE-FEATURE-STATUS.md) to
check the current supported scope and evidence. Use
[`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the actual host gates and
their limits. Run relevant focused checks and required repository CI. Do not
weaken or skip a check to get a pass.

CI routes ordinary README, contribution, catalog, index and README illustration-only
changes through `docs:check` and path-routing regressions. Code, executable
examples, specifications, contracts, verification policy, mixed changes and
unknown paths require full current/frontend-pin verification and coverage. See
the [development workflow](docs/DEVELOPMENT-WORKFLOW.md) for the exact allowlist.
Docs-only CI emits no verified WASM artifact; manually run the full workflow with
the exact `source_sha` if one is needed. This routing does not skip relevant local
checks. Require the final `Verification result` to be green before merging.

## Report evidence clearly

Open pull requests against `dev`. Explain the user-visible change and why it is
needed. Include the issue link, verification commands with exit status and
results, and remaining limits. State what was not verified; do not imply host
tests prove Device, physical or farmer acceptance. Report exact blockers when a
check could not run. When creating an issue, apply at least one applicable module
label, such as `module:ghostflow-toolchain`. Ask a maintainer to apply the label
if you cannot.

Maintainers promote verified changes from `dev` to `main`.

Use this compact handoff for a task or pull request:

```text
Outcome:
Scope and owned files:
Completed / blocked / independent:
Acceptance criteria:
Prerequisites and constraints:
Focused verification command:
Return: changed files, commands and results, remaining risks or blockers.
```

For documentation batches, run `npm run docs:index` once, then
`npm run docs:check`. See the workflow and verification documents for other
applicable checks.
