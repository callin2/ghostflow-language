# Contributing to GhostFlow

English · [한국어](CONTRIBUTING.ko.md)

This guide is for coding agents and the people who review their work. It is an
entry point to the repository rules, not a replacement for them. For the full
rules, read:

- [`AGENTS.md`](AGENTS.md) for ownership and language constraints.
- [`docs/DEVELOPMENT-WORKFLOW.md`](docs/DEVELOPMENT-WORKFLOW.md) for task sizing,
  handoffs and evidence reuse.

In short, a contribution has four steps: start from `dev`, define one bounded
task, change code and documentation together, and report the evidence clearly.

## Start from the current development branch

Begin new work from `dev`. Before you edit anything:

1. Confirm the repository root and the branch.
2. Record the exact base SHA with `git rev-parse HEAD`.
3. Inspect `git status`.

Preserve unrelated changes. Do not guess what a temporary checkout contains from
its name.

Search the document index before you read design or implementation files:

```sh
npm run docs:find -- --limit 8 QUERY
```

The index searches paths and titles only, not full text. To search content, use
`rg` or open the matched documents. If the index is stale or missing:

- During read-only discovery, report it.
- During authorized documentation work, refresh it after the edit batch.

## Define one bounded task

Some tasks have a field-derived oracle (expected results derived from a real field
case and specified independently of the implementation) and bounded mutation evidence. For such a
concrete task, use the [AI contribution package](docs/AI-CONTRIBUTION-PACKAGE.md).
The issue and PR templates capture its minimum identities, scope and independent
evidence.

Before you start, write down:

- the intended outcome;
- the owned files or boundaries;
- the acceptance criteria;
- the prerequisites;
- the focused verification command.

Keep completed, blocked and independent work distinct. Do not add feature scope
or cleanup that the request does not need.

**Fixing a bug:**

1. Capture a failing reproduction before you change code.
2. Add a meaningful regression check that would fail without the fix.
3. Keep the existing test oracle and repository gates intact.

For language behavior, preserve the canonical `.ghost.md` source and the
ownership boundaries described in `AGENTS.md`. Record language-rule changes and
bug fixes that change observable language behavior in both root changelog files,
as described in the
[development workflow](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog).

## Change and document together

Make the smallest complete change. In the same task, update:

- the implementation;
- the regression coverage;
- the relevant English and Korean documentation.

Keep executable examples identical across translations. Update reviewed hashes
and catalog metadata as required by
[`docs/DOCUMENTATION-LANGUAGES.md`](docs/DOCUMENTATION-LANGUAGES.md).

To check the current supported scope and its evidence, use
[`docs/REFERENCE-FEATURE-STATUS.md`](docs/REFERENCE-FEATURE-STATUS.md). For the
actual host gates and their limits, use
[`docs/VERIFICATION.md`](docs/VERIFICATION.md). Run the relevant focused checks
and the required repository CI. Do not weaken or skip a check to get a pass.

CI chooses its verification path from the changed files:

| Change | CI runs |
| --- | --- |
| Only ordinary README, contribution, catalog, index or README illustration files | `docs:check` and path-routing regressions |
| Code, executable examples, specifications, contracts, verification policy, mixed changes or unknown paths | Full current/frontend-pin verification and coverage |

See the [development workflow](docs/DEVELOPMENT-WORKFLOW.md) for the exact
allowlist. Docs-only CI emits no verified WASM artifact. If you need one, run the
full workflow manually with the exact `source_sha`. This routing does not let you
skip relevant local checks. Before merging, the final `Verification result` must
be green.

## Report evidence clearly

Open pull requests against `dev`. Explain the user-visible change and why it is
needed. Include:

- the issue link;
- the verification commands, with exit status and results;
- the remaining limits.

State what was not verified. Do not imply that host tests prove Device, physical
or farmer acceptance. If a check could not run, report the exact blocker.

When you create an issue, apply at least one applicable module label, such as
`module:ghostflow-toolchain`. If you cannot apply the label, ask a maintainer to
do it.

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
`npm run docs:check`. For other applicable checks, see the workflow and
verification documents.
