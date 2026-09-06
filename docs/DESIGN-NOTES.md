# Language design notes

The selected surface is a named `control` with typed declarations, explicit
next-state equations and output-intent connections. Literate source adds nearby
explanation while retaining the same executable semantics and mapped diagnostics.
The compiler and portable runtime are versioned together so one program can be
examined through native/WASM traces and consumed by a compatible Device host.

State boundaries, bounded expression cost, constrained effects and explicit host
inputs make execution reproducible. Optional sensors or installation metadata
must not silently create assumptions about physical equipment. Shared-station
constraints are executable source or profile contracts with explicit bindings.

The detailed [language contract](LANGUAGE.md), [control surface](LANGUAGE-SURFACE.md),
[literate rules](LITERATE.md), and [constraints](CONSTRAINTS.md) distinguish chosen
syntax and design proposals. [Implementation boundaries](IMPLEMENTATION.md)
describe the retained executable subset.

Private conversations and migration task records are retained outside this
standalone source export. This page carries only language-level rationale.
