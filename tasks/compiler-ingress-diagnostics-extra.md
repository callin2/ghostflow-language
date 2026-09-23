# Compiler ingress diagnostic gap audit

No additional test was added. The reachable ingress families inspected are already covered by existing focused tests:

- `tools/compile-source.mjs` source/options/filename/size guards: `tests/compiler-syntax-diagnostics.test.mjs`, `literate and compile-source ingress diagnostics stay categorized`.
- `tools/literate.mjs` non-string, byte/line limits, front matter, fence, executable-code, anchor, and link diagnostics: `tests/compiler-syntax-diagnostics.test.mjs`, `canonical literate diagnostics preserve CRLF, Unicode, and multiple-fence positions`; `intent link ingress reports duplicate, unknown, and orphan authorship at the directive`.
- `tools/ghostc.mjs` `--check` arity, strict UTF-8, BOM identity, missing input, and artifact behavior: `tests/compiler-syntax-diagnostics.test.mjs`, the CLI ingress test block and its independently named nested subtests.
- Public compiler diagnostic location and exact class/message contracts: `tests/compiler-syntax-diagnostics.test.mjs` and `tests/compiler-semantic-diagnostics.test.mjs` fixture-driven cases.

The audit excludes artifact restore/verification and runtime diagnostics. No confirmed public ingress gap remained within this bounded review.
