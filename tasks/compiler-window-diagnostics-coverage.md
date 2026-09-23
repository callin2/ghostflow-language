# Window compiler diagnostic additions

Public `compileSource` coverage added in `tests/compiler-window-diagnostics.test.mjs`:

- duplicate window named argument;
- zero constant window duration;
- wrong Result error enum and missing physical sample lineage;
- rate constructor missing contextual `Rate<Q>` type, duplicate/missing arguments,
  wrong dynamic time type, and non-Temperature nominal delta mismatch;
- the exact 127-state-plus-one-window accepted boundary and the 128-state-plus-one-window
  `temporal state limit exceeded` rejection.

Existing `tests/window-control.test.mjs` remains the evidence for missing window fields,
dynamic durations, unsupported quality and payloads, excluded Rate quantities, zero Rate
time, non-finite constants, nominal Rate comparison, and expression-only Rate binding.
Derived windows are accepted; their former implementation-gap rejection is no longer an
active diagnostic. Acceptance is covered by `tests/window-derived-control.test.mjs`.
Generic input allocation limits are
covered by `tests/compiler-control-diagnostics-extra.test.mjs`.
