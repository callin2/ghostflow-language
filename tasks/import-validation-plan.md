# Pinned import validation

Ground truth: Language Reference §6.4–6.7. This document tracks implementation
progress and planning. It does not replace the language specification.

**How to read this document.** The first section describes the current state
(2026-09-23). The later sections are a log of earlier milestones, kept for
history. Statements in them such as "REF-06-010 remains RED", "the lowerer
rejects every parsed import", or "there is no public sourceClosure API" were true
at that milestone and are superseded by the current state.

## Current executable slice (2026-09-23)

**Status.** REF-06-010 now passes CLI check and artifact build. The older
unsupported-path notes below describe previous milestones.

**Source closure.** `compileSource` accepts an explicit
`sourceClosure: [{ filename, revision, text }]`.

- It verifies exact digests and revisions transitively, using browser-safe code.
- It does not acquire files or network resources.
- The CLI collects those canonical documents from the filesystem.

**Composition support.** AST composition supports:

- scalar input/output ports
- parameters
- state and let expressions
- nested instances
- required inputs
- exact port types
- one writer

Combinational cycles and cross-instance next-state feedback are rejected.
Documents and per-instance source nodes remain separate in the artifact map.

**Artifact restoration.** Restoration recompiles the full closure and compares
bytecode, manifest, trace and provenance before accepting the artifact.

**Closure bounds.**

| Bound | Limit |
| --- | --- |
| Documents | 128 |
| Total source | 8 MiB |
| Instances | 128 |
| Expression transformation visits | 65,536 |

**Tests.** `tests/composition-execution.test.mjs` covers Rust WASM state
isolation, transitive source resolution, invalid connections, missing inputs,
argument errors, unused-output type checking and artifact/provenance tampering.

**Sensor and pure-function composition** was added under
[#377](https://github.com/callin2/ghostflow-language/issues/377).

- Root raw packets fan out to independent per-instance conditioners.
- Public sensors stay in `manifest.sensors`. Private descriptors are in
  `manifest.sensorInstances`, with `sourceSensor`, `instance`, and `port`.
- Payload, optionality and the declared sampling interval must match.
- Function parameters and case bindings remain lexical.
- Focused coverage includes independent filtering, faults, recovery, staleness,
  scan rollback, private-packet rejection, source restoration, and a native/WASM
  comparison of the actual conditioned frames.
- The GFB/ABI/frame protocol is unchanged.

**Still unsupported:**

- composition of timer/schedule/config/enum/resource/constraint declarations
- imported intent-link expansion
- qualified public function/type exports

These fail explicitly rather than silently losing their instance semantics.
Imported revision labels are checked against the supplied closure identities; the
caller or catalog is responsible for their authenticity.

## Implemented parser slice

*Historical milestone.*

`ControlParser` accepts top-level pinned import headers and keeps them in a
separate `imports` AST list. Each entry preserves:

- alias
- relative `.ghost.md` locator
- revision
- digest
- source-node identity
- token locations for every pin field

It reports these errors at the authored token: missing revision/digest, invalid
digest syntax, empty/latest revision, noncanonical/absolute/network locator, and
duplicate aliases. The existing literate diagnostic remapping applies.

The lowerer rejected every parsed import before compilation with:
`import execution requires a verified source closure and composition lowering,
which are not yet supported`. Imports could not be silently ignored, including
unused imports. Parsing a nonempty revision string does not prove that the
resolver's revision is immutable.

TDD evidence:

- `build/import-header-red.log`: 14 tests, all failed at the old parser boundary.
- `build/import-header-green.log`: 272/272 focused and affected syntax tests
  pass, including all 14 new tests in `tests/import-header.test.mjs`.
- The new suite is explicitly registered in `tools/verify-language.mjs`.

At this milestone REF-06-010 still lacked accepted composition. Its acceptance
expectation and all other Reference expectations remained unchanged.

## Parameter and composition syntax slice

*Historical milestone.*

**Parameters.** `parameter` defaults compile as typed immutable values and are
recorded in `manifest.parameters`, independently of operator settings.

- Forward parameter references resolve without depending on declaration order.
- Cyclic defaults, type mismatches, and dependencies on input, state or mutable
  config are rejected.

**Composition syntax.** The parser preserves `instance` declarations, named
specialization arguments and `connect` endpoints with their original source
positions. Local composition validation rejects:

- unknown import aliases/instances
- duplicate instance declarations and arguments
- invalid root port directions
- competing suppliers, including a root output defined by both an expression and
  `connect`

**Limits at this milestone.** The public compiler still rejected valid imports
without a verified source closure. It did not claim imported argument
names/types, required ports, exact port and sensor contracts, instance isolation,
or executable composition.

**Evidence.**

- REF-06-010 remained RED.
- REF-06-103 now passes with the actual duplicate-supplier diagnostic.
- `tests/import-composition.test.mjs` has 21 focused passing tests.
- The combined import/header/digest/control/compiler run passes 42/42.

## Next minimum implementation boundary

*Historical plan.*

At the time, the environment-neutral `tools/compile-source.mjs` accepted one
canonical document and had no resolver/source-closure input. `tools/ghostc.mjs`
read only the root document. A complete next slice needed:

1. An explicit supplied-document closure contract carrying each canonical
   filename/locator, immutable revision identity, original text and verified
   UTF-8 digest. Use the same validator for browser and Node. The validator
   must not acquire files or network data implicitly.
2. Import-header extraction that is reusable without parsing the
   (then unsupported) instance bodies. Reuse the parser's token rules rather
   than a regex scanner.
3. Relative locator resolution against the importing document. Resolution is
   only into the provided closure; locator spelling is not source identity.
4. Diagnostics for missing dependencies, revision disagreement, digest mismatch,
   ambiguous locator binding and transitive import cycles, each retaining the
   importing source span. Validate transitive dependencies, not just root
   imports. Preserve the original full prose and identities in the verified
   result.
5. Public compiler integration that validates the closure but still rejects
   instance execution until composition lowering/provenance is implemented.
   CLI filesystem collection is a separate adapter into that same contract.

**Required tests.** Pair a valid two-level pinned closure with each isolated
corruption. Also cover diamond reuse, alias reuse in different definitions, path
normalization, cycles, and byte/document resource boundaries. Validation must
not alter a supplied closure.

The input contract was still a design decision for the main integrator; the
parser slice added no speculative public resolver API.

After that, REF-06-010 additionally required instance/parameter/connect parsing,
per-instance state isolation, exact port/quality checking, dependency ordering,
transitive next-state restrictions, one writer, and source/revision provenance.
Flattening source text and discarding original document identities is not an
acceptable shortcut.

## CLI direct digest preflight

*Historical milestone.*

This small slice lives in `tools/ghostc.mjs`. Before parsing the unsupported
instance bodies, the CLI:

1. reuses `parseControlImports` to inspect the import headers;
2. resolves each direct relative locator against the importing root filename;
3. compares the pinned SHA-256 with the original file bytes.

Imported prose, UTF-8 encoding and CRLF bytes participate unchanged. Invalid
UTF-8, oversized documents, unreadable files and digest mismatches are rejected
at the authored import token before an artifact is published.

At this milestone it was direct filesystem integrity validation only: there was
no public sourceClosure API, recursive resolver, revision-authenticity proof or
accepted composition. A matching dependency still reached the existing
unsupported compiler path. Browser compilation does not acquire files through
this CLI helper.

**Evidence.** `tests/import-cli-digest.test.mjs` runs the unchanged REF-06-102
fixture in both check and build modes. It covers exact UTF-8/CRLF matching,
imported-prose tampering, preservation of an existing artifact, missing files
and invalid UTF-8.

- `build/import-cli-digest-red.log` recorded four failures and one
  already-passing unsupported-path control.
- `build/import-cli-digest-green2.log` records 156/156 passing tests, including
  all five new cases, import parser coverage and the existing full CLI syntax
  diagnostic suite.
- No Reference expectation changed.
