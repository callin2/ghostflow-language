# Language design notes

This page summarizes the language-level reasoning behind GhostFlow's design.

**The chosen surface.** A GhostFlow program is a named `control`. It contains:

- typed declarations;
- explicit next-state equations;
- output-intent connections.

Literate source places explanation next to the code. The executable semantics
and the mapped diagnostics stay the same. The compiler and the portable runtime
are versioned together. As a result, one program can be examined through
native and WASM traces and then consumed by a compatible Device host.

**Reproducible execution.** Four properties make execution reproducible:

- explicit state boundaries;
- bounded expression cost;
- constrained effects;
- explicit host inputs.

Optional sensors or installation metadata must not silently create assumptions
about physical equipment. Shared-station constraints are executable source or
profile contracts with explicit bindings.

**Where to read more.** The detailed [language contract](LANGUAGE.md),
[control surface](LANGUAGE-SURFACE.md), [literate rules](LITERATE.md) and
[constraints](CONSTRAINTS.md) documents separate chosen syntax from design
proposals. [Implementation boundaries](IMPLEMENTATION.md) describes the
executable subset that is retained.

Private conversations and migration task records are kept outside this
standalone source export. This page carries only language-level rationale.
