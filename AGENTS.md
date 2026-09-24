# GhostFlow language ownership

Read [Language Reference](docs/LANGUAGE-REFERENCE.md) before language,
runtime, settings or Interaction IR work. Use it as the shared ground truth for
language philosophy, syntax, semantics, and feature rationale. Keep implementation
status and progress reports out of the reference. Update its relevant section
and rationale when changing language semantics.

Before judging GhostFlow control/output lifecycle, simulator behavior, or Device
output-failure policy, read [Reference §4.7](docs/reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
and the [physical sequence](docs/LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary).
Distinguish command-result lifecycle from requested, safe, applied and confirmed
output evidence. Check the actual `farm-device` firmware revision under review before
claiming a policy is absent or physical behavior is verified.

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
Keep runnable FAQ and programming samples in the focused
`tests/docs-runnable-examples.test.mjs` compiler check when changing them.
Keep source and artifact hashes in release records. Generated verification and
tutorial traces are execution evidence under ignored `build/`, separate from
source releases. Report host validation separately from Device, API and farmer-UX
validation.

Never overwrite a historical benchmark or its pinned digest merely because a
legitimate source change made CI report identity drift. Keep current provenance
derived from the checked-out files, historical snapshot integrity independently
pinned, and measured behavior comparisons separate. Diagnose that contract before
changing a hash. Capture an intentional new benchmark in a new dated artifact and
cover provenance changes and stored-record tampering with regression tests. See
[`docs/2026-09-24-authoring-baseline-provenance.md`](docs/2026-09-24-authoring-baseline-provenance.md).

## v1 clean break: canonical literate source only

- This pre-1.0 toolchain accepts canonical `.ghost.md` literate documents for
  product compilation. Once a replacement is accepted and verified, remove its
  superseded active source/API/fallback paths and their compatibility tests.
- Add compatibility only for an explicitly approved, concrete current user,
  data, or deployment need. Historical raw material may remain as clearly
  isolated evidence, never as an executable fallback.

The migration export preserves compiler/runtime semantics. Format or ABI changes
need an explicit compatibility decision and conformance tests; package version,
source-language profile, GFB1 format, manifest format and Device firmware version
are distinct identifiers. See `docs/IMPLEMENTATION.md` and `docs/VERIFICATION.md`.
