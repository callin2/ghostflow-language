# GhostFlow language ownership

This repository owns GhostFlow syntax, parsing, typing, lowering, GFB1 encoding,
the portable Rust VM/signal/station engines, their WASM ABI, and the reference
host adapters and conformance tests. Keep compiler and runtime changes together
when they change execution semantics.

## Boundaries

- The API host owns LLM requests, installation context, conversation history,
  source revision storage, and deployment orchestration. An LLM authors a complete
  GhostFlow candidate; this compiler validates it without an LLM or an API service.
- The Device repository owns firmware, board profiles, pin mappings, drivers,
  watchdogs, clocks, and physical I/O. Consume the portable core at an explicit
  revision; changes here do not imply a Device release or hardware verification.
- The frontend owns farmer interaction and visualization. Installation labels,
  capabilities and bindings are external context. Executable rules belong in
  versioned GhostFlow source and its compiled artifacts, not a second JSON program.
- `runtimes/wasm` and `runtimes/node/ledger.mjs` are reference adapters. They may
  validate and supply generated inputs, schedule occurrences and persistence;
  expression/state/intent execution stays in the shared Rust core.

## Working here

Use `apply_patch` for source edits and preserve unrelated work. Do not add product
servers, POC UI, credentials, model connectors, board firmware, device calls, or
imported conversation records to this repository. Keep tests explicitly listed
in `tools/verify-language.mjs`; never discover sibling product tests by wildcard.

Run `npm test` for host verification after dependencies and the WASM Rust target
are installed. It compiles the fixture required by Rust tests before invoking
Cargo, builds the WASM/native runners, and executes the language tests/tutorial.
Keep source and artifact hashes in release records. Generated verification and
tutorial traces are execution evidence under ignored `build/`, separate from
source releases. Report host validation separately from Device, API and farmer-UX
validation.

The migration export preserves compiler/runtime semantics. Format or ABI changes
need an explicit compatibility decision and conformance tests; package version,
source-language profile, GFB1 format, manifest format and Device firmware version
are distinct identifiers. See `docs/IMPLEMENTATION.md` and `docs/VERIFICATION.md`.
