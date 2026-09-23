# Additional control diagnostic audit

Audit date: 2026-09-23.

## Scope and result

This incremental audit compared current `tools/control.mjs` authored-source
guards with the existing syntax, semantic, and debounce diagnostic maps. It
does not claim exhaustive malformed-input or branch coverage.

The current compiler adds no unmapped public diagnostic message family. Four
reachable debounce paths lacked independent public `compileSource` evidence:

| Case | Guard exercised |
|---|---|
| Result debounce numeric payload | `debounce source must be Bool or a named finite enum` after unwrapping `Result<T, E>` |
| Finite enum initial from another enum | `debounce initial must be a constant Mode` with nominal enum typing |
| Nineteen physical debouncers | generated common and per-root histories exceed the 128-state budget; eighteen use exactly 126 states |
| One physical debouncer plus 121 inputs | lazy sample identity allocation exceeds the 128-input budget; 120 authored inputs plus eight generated inputs use exactly 128 |

Each case in `tests/compiler-control-diagnostics-extra.test.mjs` compiles an
adjacent valid document first, then checks `ControlCompileError`, exact message,
filename, line, and column for the rejected document.

## Authored-source exclusions

The following current debounce guards are internal invariants and remain
unreachable through the public parser and lowerer:

- `missing signal declaration`: signal resolution starts only from declared
  signal symbols.
- `missing sensor` and `invalid debounce sample root`: sample roots originate
  from already declared sensor descriptors and immutable source tags.
- `missing allocated sample root`: every selected physical root is allocated
  before generated high-water transitions are constructed.

Existing suites already cover every distinct debounce source diagnostic,
signal dependency cycles, the raw five-state budget boundary, parser call
syntax, and the shared semantic diagnostic families. No production defect was
found in this bounded audit.
