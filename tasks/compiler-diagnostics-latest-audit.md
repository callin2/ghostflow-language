# Latest compiler diagnostics audit

Scope is canonical `.ghost.md` lexer, literate ingress, `compileSource`, and
`ghostc` diagnostics. The catalog now reports **687 independent cases** after
four parser-callsite, two window-byte-limit, and four schedule-duplicate cases
were added. The latest four cover a fixed duplicate-field acceptance bug;
see `compiler-diagnostics-current-audit.md` for focused evidence.
This is an evidence map, not a claim of branch-complete coverage.

Four additional public-source cases cover bare carriage-return newline
positions and diagnostics. The focused affected suite passed **233/233**;
RED evidence is retained in `build/compiler-newline-diagnostics-red.log` and
GREEN evidence is in `build/compiler-newline-affected.log`. No full gate result
is claimed.

## Covered current paths

| Source path | Existing evidence |
|---|---|
| `tools/control.mjs:148-227` lexer, source limit, token limit, tagged/string literals | `tests/compiler-syntax-diagnostics.test.mjs` fixture/resource cases and `tests/compiler-token-limit-diagnostics.test.mjs`; the string token catch collision is covered. |
| `tools/control.mjs:246-630` parser `expect`/`identifier` and declaration/expression syntax guards | `tests/compiler-syntax-diagnostics.test.mjs` plus the 135-case syntax fixture; cases are family mapped, not one test per callsite. |
| `tools/literate.mjs:29-100` type, byte/line limits, fences, links, anchors | `tests/compiler-syntax-diagnostics.test.mjs` literate cases and ingress boundary tests. |
| `tools/compile-source.mjs:13-90` source/options/filename/size guards | `tests/compiler-syntax-diagnostics.test.mjs` ingress cases; interaction identity paths are in `tests/compiler-interaction-diagnostics.test.mjs`. |
| `tools/ghostc.mjs:11-31` argument count, strict UTF-8, check/build artifact behavior | `tests/compiler-syntax-diagnostics.test.mjs` and `tests/compiler-cli-diagnostics.test.mjs`; CLI cases assert status, diagnostics, and artifact preservation. |
| `tools/control.mjs:1099-1210` window operation/type/argument and derived-window guards | `tests/window-control.test.mjs`, `tests/compiler-window-diagnostics.test.mjs`, `tests/window-derived-control.test.mjs`, and `tests/window-derived-provenance.test.mjs`; the nested-window review added `tests/compiler-window-byte-limit.test.mjs` for the reachable encoder byte-limit guard. |

## Concrete remaining gaps

- No missing lexer or literate ingress family was found in this bounded review.
- The parser follow-up maps active helper callsites, shared paths and unreachable
  guards in `compiler-parser-callsites-coverage.md`. Four newly identified grammar
  states have exact public diagnostic tests; this is not measured branch coverage.
- `tools/control.mjs:68,857,862` finite-number/lowering-internal guards remain
  internal failure paths without a canonical authored-source case. They are
  excluded from syntax acceptance claims.
- Portable package replay/hash failures are in `tools/portable-package.mjs`
  (`buildPortablePackage` and `verifyPortablePackage`), not
  `tools/compile-source.mjs`. They are artifact-integrity paths. `tools/gfb1.mjs`
  malformed raw-IR/encoder misuse is likewise an internal API path; both are
  covered by package/toolchain tests where applicable and excluded from
  authored-source syntax coverage.
- Window runtime descriptor validation and native/WASM execution are separate
  host/runtime evidence. This audit does not promote them to compiler diagnostic
  coverage.
