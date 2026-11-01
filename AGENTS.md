# GhostFlow language ownership

These are the rules for AI coding agents and other contributors working in this
repository. Read the first section before any task.

**Find and maintain documents**

- Use the [development workflow](docs/DEVELOPMENT-WORKFLOW.md) for bounded
  search, delegated execution and evidence reuse.
- Find document paths and titles with `npm run docs:find -- --limit 8 QUERY`.
- After one documentation edit batch, run `npm run docs:index`, then
  `npm run docs:check`.

**Use the Language Reference as ground truth**

- Read the [Language Reference](docs/LANGUAGE-REFERENCE.md) before any language,
  runtime, settings or Interaction IR work.
- It is the shared ground truth for language philosophy, syntax, semantics and
  feature rationale.
- Keep implementation status and progress reports out of the reference.
- When you change language semantics, update the relevant section of the
  reference and its rationale.

**Record language changes in the changelog**

- Record every language-rule change, and every bug fix that changes observable
  language behavior, in root `CHANGELOG.md` and `CHANGELOG.ko.md` in the same PR.
- Follow the
  [language-rule changelog procedure](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog).

**Check the output lifecycle before judging it**

- Before you judge GhostFlow control/output lifecycle, simulator behavior, or
  Device output-failure policy, read
  [Reference §4.7](docs/reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
  and the [physical sequence](docs/LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary).
- Distinguish the command-result lifecycle from requested, safe, applied and
  confirmed output evidence.
- Before you claim that a policy is absent or that physical behavior is verified,
  check the actual `farm-device` firmware revision under review.

**What this repository owns**

This repository owns GhostFlow syntax, parsing, typing, lowering, GFB1 encoding,
the portable Rust VM/signal/station engines, their WASM ABI, and the reference
host adapters and conformance tests. When a change alters execution semantics,
keep the compiler and runtime changes together.

## Boundaries

Other repositories and modules own everything else. Respect these boundaries:

- **API host.** The API host owns LLM requests, installation context,
  conversation history, source revision storage, and deployment orchestration.
  An LLM authors a complete GhostFlow candidate; this compiler validates it
  without an LLM or an API service.
- **Device repository.** The Device repository owns firmware, board profiles,
  pin mappings, driver/renderer integration, watchdogs, clocks, and physical I/O.
  - Consume the portable core at an explicit revision. Changes here do not imply
    a Device release or hardware verification.
  - Input driver and output renderer source belongs in `farm-device-drivers`.
    Renderers apply logical outputs to relays, motors, lamps or screens; cabinet
    UI is `@ghostflow/cabinet-view`. Device owns host/board integration.
- **Frontend.** The frontend owns farmer interaction and visualization.
  Installation labels, capabilities and bindings are external context.
  Executable rules belong in versioned GhostFlow source and its compiled
  artifacts, not in a second JSON program.
- **Reference adapters.** `runtimes/wasm` and `runtimes/node/ledger.mjs` are
  reference adapters. They may validate manifests and supply generated inputs,
  schedule occurrences and persistence. Expression/state/intent execution stays
  in the shared Rust core.

## Working here

**Keep documentation bilingual**

- Maintain complete English and Korean versions of authored documentation. This
  includes philosophy, architecture, specifications, toolchain guides, design
  plans and educational examples. Reports and execution evidence may remain in
  one language.
- Keep existing source paths and add a sibling `.en.md` or `.ko.md` translation.
  Translated examples are reading projections, never new canonical compile inputs.
- Update both versions and their reviewed hashes in `docs/translations.json` in
  the same change. Record each report, generated artifact or test-data exclusion
  there with its reason.
- Run `npm run docs:check`. Hashes establish freshness, not semantic translation
  quality.
- See `docs/DOCUMENTATION-LANGUAGES.md` for the full policy and
  `docs/DOCUMENTATION.md` for the English/Korean document catalog.

**Edit safely and stay in scope**

- Use `apply_patch` for source edits and preserve unrelated work.
- Do not add product servers, POC UI, credentials, model connectors, board
  firmware, device calls, or imported conversation records to this repository.
- Keep tests explicitly listed in `tools/verify-language.mjs`; never discover
  sibling product tests by wildcard.

**Verify**

- Run `npm test` for host verification after dependencies and the WASM Rust
  target are installed. It compiles the fixture required by Rust tests before
  invoking Cargo, builds the WASM/native runners, and executes the language
  tests/tutorial.
- When you change runnable FAQ and programming samples, keep them in the focused
  `tests/docs-runnable-examples.test.mjs` compiler check.
- After editing any file referenced by `contracts/requirements/catalog.json`,
  run `node --test tests/requirement-catalog.test.mjs`. When lines move,
  relocate unchanged excerpt ranges and preserve their expected hashes.
- Use `npm run test:portable-package` for focused package checks. It runs the
  fast catalog preflight before package regressions.

**Keep evidence separate**

- Keep source and artifact hashes in release records.
- Generated verification and tutorial traces are execution evidence under the
  ignored `build/` directory, separate from source releases.
- Report host validation separately from Device, API and farmer-UX validation.

**Protect historical benchmarks**

- Never overwrite a historical benchmark or its pinned digest merely because a
  legitimate source change made CI report identity drift.
- Keep three things separate: current provenance derived from the checked-out
  files, independently pinned historical snapshot integrity, and measured
  behavior comparisons.
- Diagnose that contract before changing a hash. Capture an intentional new
  benchmark in a new dated artifact. Cover provenance changes and stored-record
  tampering with regression tests.
- See [`docs/2026-09-24-authoring-baseline-provenance.md`](docs/2026-09-24-authoring-baseline-provenance.md).

**Regenerate PC-01 digests when the programming book changes**

- When the programming book changes, run `npm run generate:pc01` before
  verification.
- The generator updates only PC-01 current source digests in the curriculum
  catalog and replay manifest.
- Keep replay frames, checkpoints, other lessons, and dated benchmark evidence
  fixed. Diagnose any remaining mismatch rather than rewriting it.

## v1 clean break: canonical literate source only

- This pre-1.0 toolchain accepts canonical `.ghost.md` literate documents for
  product compilation. Once a replacement is accepted and verified, remove its
  superseded active source/API/fallback paths and their compatibility tests.
- Add compatibility only for an explicitly approved, concrete current user,
  data, or deployment need. Historical raw material may remain as clearly
  isolated evidence, never as an executable fallback.

## Automatic build identity — System #199

Official builds receive a build number from a shared online allocator.

**Allocation**

- `npm run build:wasm`, `make wasm`, `npm test` and direct verifier commands
  allocate a build number online through the exact-byte System tool pinned in
  `scripts/vendor/BUILD-IDENTITY.json`.
- Every Cargo crate currently has base version 0.1.0. The build hook checks that
  agreement before allocation. A future divergence requires an explicit
  artifact base-version contract.
- Do not manually choose numbers or bypass the internal guard.
- Raw Cargo is dependency/developer compilation, not an official identified
  handoff.

**Identity records**

- Generated `build/build-identity.json` binds the issued full human build
  version to the actual output SHA-256.
- Full verification includes native/framed output hashes and copies the
  identity into its report.
- CI packaging verifies the actual WASM SHA/source and puts that same identity
  in the handoff manifest.
- Runtime ABI/exports remain unchanged. Historical pinned source without these
  hooks has no retrofitted ID.

**Failures**

- Failed rebuilds invalidate the prior identity before compilation and burn
  their number.
- Keep the metadata-only remote `build-counter` branch out of cleanup.
- Offline/read-only authority fails before compilation; never guess/reset a
  counter.

**Testing and ownership**

- `npm run test:build-identity` uses a local bare authority and a synthetic
  compiler to test identity propagation, failure burning and internal guards.
  It does not prove real WASM compilation; the existing full CI
  compiler/packaging gates do that.
- The shared canonical allocator is owned by
  [System #199](https://github.com/callin2/farm_studio_system/issues/199).
  Preserve its vendored bytes/checksum.
- Source SHA describes committed HEAD only.

**Compatibility and identifiers**

The migration export preserves compiler/runtime semantics. Format or ABI changes
need an explicit compatibility decision and conformance tests. Package version,
source-language profile, GFB1 format, manifest format and Device firmware version
are distinct identifiers. See `docs/IMPLEMENTATION.md` and `docs/VERIFICATION.md`.
