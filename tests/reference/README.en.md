<!-- translation-source: tests/reference/README.md -->

[Korean original](README.md)

# Individual Language Reference acceptance tests

Fix the Reference's expected behavior first. Compiler changes are separate work.
Do not change valid source expectations to `reject` merely because the current compiler rejects it.

Record initial execution results and failures retained unchanged in [BASELINE.md](BASELINE.md).
Record where the original 49 pending decisions were settled and how they are verified in [DECISIONS.md](DECISIONS.md).
Record edge-case/boundary improvements and newly exposed defects in [EDGE-CASES.md](EDGE-CASES.md).

## Running

Run from the `ghostflow-language` repository root with Node.js 22 or later.

```sh
npm run test:reference

# 특정 계약만 실행
node --test --test-name-pattern=REF-01-001 tests/reference-cli.test.mjs
```

The runner invokes the actual `tools/ghostc.mjs` in a separate process.
For each executable case, check both `--check` and the artifact generation path.
Run artifact generation even when check mode fails, and record failures and diagnostics for both modes.
Valid source requires exit code 0 and nonempty artifacts.
Also check that successful artifacts' public source maps bind the canonical original to source/bytecode digests.
Invalid source requires exit code 1. CLI usage errors (2), crashes, and timeouts do not qualify as valid rejection.
Create every fixture in its own temporary directory. Supply canonical `.ghost.md` documents;
only negative cases checking incorrect extensions and similar conditions intentionally violate that contract.
Import cases include complete dependency `.ghost.md` originals in `files`. The root document's
import pins the exact SHA-256 of that original. Write dependencies in the same temporary directory.

Save detailed results in `build/reference-tests.json`. `results` and `summary` record only
compilation cases actually executed. `externallyCoveredCatalog` displays exact active test
selectors linked in the [`feature-status` catalog](../../contracts/feature-status/catalog.json).
It does not mean this CLI executed external oracles. Passing the full language gate
is execution evidence. `pendingCatalog` retains only `specified`/`decision` cases without external oracles.
`catalogCounts` and frozen core counts are links in the complete catalog, independent of filters, rather than execution results.
Do not use name-filtered results as complete acceptance results.
If filtering excludes catalog validation itself, `catalogValidation` is `not-run`.

## Case status

| Status | Meaning | Execution reporting |
|---|---|---|
| `executable` | Compilation acceptance/rejection cases for settled syntax | Actual CLI calls; failures when results differ from expectations |
| `specified` | Runtime/environment/Driver/UI/tool contracts with inputs, behavior, and expected results | `externally-covered` with an active external oracle link; otherwise TODO. Neither counts as a CLI execution pass |
| `decision` | Cases with expected meaning or a decision boundary that need settled syntax/policy | Record required decisions in reason; TODO, not support evidence |

Compilation success alone cannot verify every language item. Actual timer elapsed time,
output application/feedback, restart restoration, and UI behavior require execution observation at each boundary.
This work writes those cases' conditions and expected results. Runtime/Driver adapters are separate.
First reflect the 2026-09-22 syntax policy decisions in the Reference, then pin compilation acceptance/rejection expectations.
Actual operating-policy values are author-specified arguments, not globally pending language decisions.

Keep settled compilation requirements failing if they currently fail.
Do not move them to `specified` or `decision`, or hide them with skips/expected failures.

## Organization and traceability

- `cases/00-principles.json`: the Reference's ten design principles.
- `cases/01-source-types.json`: Reference Chapters 1–2.
- `cases/02-time-control.json`: Reference Chapters 3–4.
- `cases/03-settings-boundaries.json`: Reference Chapters 5–8.
- `../reference-cli.test.mjs`: runner reading only explicitly listed case files, and catalog validation.

Each case has a stable ID, specific rule, Reference section link, and responsible layer.
Executable cases have independent source and `accept`/`reject` expectations.
Nonexecutable cases also specify `given`, `when`, `then`, and `reason` individually.
Record a full individual GitHub issue URL in `issue` for each unverified nonexecutable case.
The issue body links to the original case JSON, and the case retains a backlink to the issue.
Keep links after verification. Issue links alone are not execution evidence; a case leaves pending classification
only when an actual oracle is connected and verified.
Every numbered Reference section must be traced by at least one case.
A case citing a nested section also links to its parent section.

The presence of section links checks document traceability. It does not mean all behavior in that section was verified.
Review individual valid, error, and boundary cases together with nonexecutable contracts.
The existence of compiler artifacts alone does not establish execution semantics or actual device acceptance.

## Criteria for changing expectations

Base changes on explicit Reference rules. For ambiguous rules, record the needed decision.
Correct syntax mistakes in test fixtures, but do not copy the compiler's current result as the correct answer.
Do not modify compiler/runtime source as part of this test-authoring work.
