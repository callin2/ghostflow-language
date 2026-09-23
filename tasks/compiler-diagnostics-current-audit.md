# Current compiler diagnostics audit

Scope: current canonical-source compiler and CLI diagnostics. This is a locator
audit, not branch-coverage evidence. The historical `UNMAPPED` rows in
`compiler-diagnostics-inventory.md` remain discovery history and are not treated
as current verdicts.

## Current counts and registration

| Artifact | Count / status |
|---|---:|
| Diagnostic/boundary catalog | 687 independent leaf cases |
| Composition | 491 existing + 19 boundary + 136 CLI + 11 structural + 6 token-boundary + 10 window/rate + 4 parser-callsite + 2 window-byte-limit + 4 schedule-duplicate + 4 newline cases |
| Registered diagnostic suites | syntax, syntax-boundaries, syntax-structure, parser-callsites, schedule-duplicates, newline, token-limit, CLI, semantic, interaction, control-extra, window, window-byte-limit, debounce, hold-last |

`tools/verify-language.mjs` registers the suites above. There is no separate
`compiler-ingress-diagnostics-extra.test.mjs` entry; ingress cases are currently
in `compiler-syntax-diagnostics.test.mjs` and `compiler-cli-diagnostics.test.mjs`.

## Mapped source families

| Source family | Current evidence | Boundary |
|---|---|---|
| Lexer/parser/literate/CLI ingress | `tests/compiler-syntax-diagnostics.test.mjs`, `tests/compiler-cli-diagnostics.test.mjs`, 135-case syntax fixture | Exact cases are covered; this does not prove every parser callsite independently. |
| Token limit and string-token collision | `tests/compiler-token-limit-diagnostics.test.mjs` | Boundary cases cover valid string, identifier, number, symbol, and tagged literal at 8193. |
| Semantic/lowerer guards | `tests/compiler-semantic-diagnostics.test.mjs`, 257 semantic fixtures | Fixture families map behavior; helper/rethrow lines are not separate diagnostics. |
| Interaction schema and authored provenance | `tests/compiler-interaction-diagnostics.test.mjs`, `tasks/compiler-interaction-diagnostics-coverage.md` | Optional emission and provenance errors are covered; downstream artifact restore is separate. |
| Int operating settings | `tests/int-operating-settings.test.mjs`, `tests/int-settings-artifacts.test.mjs`, semantic config cases | Compiler, manifest, and candidate validation are distinct paths. Live application remains outside this audit. |
| Window lowering | `tests/window-control.test.mjs`; follow-up mapping in `compiler-window-diagnostics-coverage.md` | Additional window/rate guard coverage is recorded separately from the 663-case baseline. |

## Actionable gaps and exclusions

- Internal helper guards require the individual reachability classifications
  in `compiler-semantic-diagnostics-coverage.md`; a throw match alone is insufficient.
  The 256 KiB parser source guard is reachable
  and covered by the syntax test named `control parser source limit is below
  the product document limit`.
- Active parser `expect()`/`identifier()` callsites were reviewed against existing
  fixtures and four added grammar-state cases. Shared helpers and unreachable
  checks are classified in `compiler-parser-callsites-coverage.md`. This is a
  source review and case mapping, not instrumented branch-coverage evidence.
- `tools/toolchain.mjs` and `tools/compile-source.mjs` artifact replay/hash
  failures belong to toolchain/source-map/provenance tests, not syntax coverage.
- `tools/gfb1.mjs` direct malformed-IR and encoder misuse paths are excluded
  from canonical source diagnostics; public lowering cases are covered by the
  semantic suite.
- `tools/operating-settings.mjs` candidate validation and WASM manifest guards
  are runtime/package diagnostics, not compiler rejection paths.
- No evidence here establishes complete coverage of OS failures, arbitrary
  malformed artifact combinations, or every individual source callsite.

## Latest focused evidence

Batch16 subsequently ran every registered diagnostic suite without a diagnostic
failure. The full Node gate still failed: 2,139 total, 1,947 passed, 28 failed,
164 TODO, zero skipped. These were the same 27 Reference failures plus one stale
GFB unsupported-version fixture. That fixture now uses version 6; its 25-case
suite passes separately (`build/gfb5-version-regression.log`). The full gate was
not repeated after this test-only correction and the later Reference policy
edits. Evidence: `build/compiler-runtime-batch16-full.log` and the corresponding
verification/reference result snapshots. The catalog count is 687 named
diagnostic/boundary cases, not 687 distinct error kinds or full branch coverage.

- Astra's bounded review found a bare-CR CommonMark extraction mismatch. Valid
  documents were rejected and syntax errors reported `no executable ghost code`
  instead of their original parser location. Sol added four cases in
  `compiler-newline-diagnostics.test.mjs`: bare CR, mixed LF/CRLF/CR, terminal
  EOF mapping, and the exact 100,000-line limit. Valid neighbors check original
  text/SHA and verified artifact source-map round trips. The lesson checkpoint
  consumer has a separate regression, not included in the diagnostic count.
- The repair normalizes line endings for extraction/range counting only.
  Source-trace and lesson consumers use the same rule. Original document bytes
  remain unchanged. RED evidence: `build/compiler-newline-diagnostics-red.log`.
- Focused and affected suites pass 233/233, including the four new cases:
  `build/compiler-newline-affected.log`. Root reviewed exact diagnostic fields,
  valid source/artifact identity assertions, registration and lesson regression.
- Sol's additional schedule/delimiter callsite review found no concrete missing
  active rejection beyond existing fixtures. This remains a bounded source
  audit, not exhaustive branch coverage.

## Earlier DailySlots evidence

- `build/compiler-schedule-duplicates-red.log`: four duplicate DailySlots fields
  were incorrectly accepted before the parser fix. Same and different values
  are covered for both `timezone` and `selected`.
- `build/compiler-schedule-duplicates.log`: four exact class/message/location
  rejections and one adjacent valid control pass (5/5). The positive control is
  not an additional diagnostic case.
- `build/schedule-duplicates-regression.log`: existing compiler, syntax,
  boundary, parser-callsite and Solar compiler suites pass (231/231).
- These changes follow batch15. Its full-gate source hashes do not describe
  the changed parser or newly registered suite. No new full gate is claimed.

## Earlier focused evidence

- `build/compiler-parser-callsites.log`: 4/4 passed, exit 0.
- `build/compiler-window-byte-limit.log`: 2/2 passed, exit 0.
- The added window case reaches the distinct six-blob expression-size guard in
  `tools/gfb1.mjs`, through public canonical source compilation.
- Both new suites are registered in `tools/verify-language.mjs`. No production
  compiler/runtime behavior changed. Existing passing suites were not rerun.
