# Pinned import validation

Ground truth: Language Reference §6.4–6.7. This is implementation progress and
planning, not a replacement language specification.

## Current executable slice (2026-09-23)

REF-06-010 now passes CLI check and artifact build. The older unsupported-path
notes below describe previous milestones. `compileSource` accepts an explicit
`sourceClosure: [{ filename, revision, text }]`. It verifies transitive exact
digests/revisions using browser-safe code, without acquiring files or network
resources. The CLI collects those canonical documents from the filesystem.

AST composition supports scalar input/output ports, parameters, state and let
expressions, nested instances, required inputs, exact port types, and one writer.
Combinational cycles and cross-instance next-state feedback are rejected.
Documents and per-instance source nodes remain separate in the artifact map.
Artifact restoration recompiles the full closure and compares bytecode, manifest,
trace and provenance before accepting it. Closure bounds are 128 documents,
8 MiB total source, 128 instances and 65,536 expression transformation visits.

`tests/composition-execution.test.mjs` covers Rust WASM state isolation,
transitive source resolution, invalid connections, missing inputs, argument
errors, unused-output type checking and artifact/provenance tampering.

Sensor and pure-function composition was added under [#377](https://github.com/callin2/ghostflow-language/issues/377).
Root raw packets fan out to independent instance conditioners. Public sensors stay
in `manifest.sensors`; private descriptors are in `manifest.sensorInstances` with
`sourceSensor`, `instance`, and `port`. Payload, optionality and declared sampling
interval must match. Function parameters and case bindings remain lexical.
Focused coverage includes independent filtering, faults, recovery, staleness,
scan rollback, private-packet rejection, source restoration and native/WASM
comparison of actual conditioned frames. GFB/ABI/frame protocol is unchanged.

Still unsupported: composition of timer/schedule/config/
enum/resource/constraint declarations, imported intent-link expansion, and
qualified public function/type exports. These fail explicitly rather than
silently losing their instance semantics. Imported revision labels are checked
against supplied closure identities; a caller/catalog owns their authenticity.

## Implemented parser slice

`ControlParser` accepts top-level pinned import headers and retains a separate
`imports` AST list. Each entry preserves alias, relative `.ghost.md` locator,
revision, digest, source-node identity, and token locations for every pin field.
It diagnoses missing revision/digest, invalid digest syntax, empty/latest
revision, noncanonical/absolute/network locator, and duplicate aliases at the
authored token. Existing literate diagnostic remapping applies.

The lowerer rejects every parsed import before compilation with:
`import execution requires a verified source closure and composition lowering,
which are not yet supported`. Imports cannot be silently ignored, including
unused imports. Parsing a nonempty revision string does not prove that the
resolver's revision is immutable.

TDD evidence:

- `build/import-header-red.log`: 14 tests, all failed at the old parser boundary.
- `build/import-header-green.log`: 272/272 focused and affected syntax tests
  pass, including all 14 new tests in `tests/import-header.test.mjs`.
- The new suite is explicitly registered in `tools/verify-language.mjs`.

REF-06-010 still lacks accepted composition. Its acceptance expectation and all
other Reference expectations remain unchanged.

## Parameter and composition syntax slice

`parameter` defaults now compile as typed immutable values and are recorded in
`manifest.parameters`, independently of operator settings. Forward parameter
references resolve without declaration-order dependence. Cyclic defaults,
type mismatches and dependencies on input, state or mutable config are rejected.

The parser preserves `instance` declarations, named specialization arguments and
`connect` endpoints with original source positions. Local composition validation
rejects unknown import aliases/instances, duplicate instance declarations and
arguments, invalid root port directions and competing suppliers, including a
root output defined by both expression and `connect`.

The public compiler still rejects valid imports without a verified source
closure. Imported argument names/types, required ports, exact port and sensor
contracts, instance isolation and executable composition are not claimed.
REF-06-010 remains RED; REF-06-103 now passes with the actual duplicate-supplier
diagnostic. `tests/import-composition.test.mjs` has 21 focused passing tests;
the combined import/header/digest/control/compiler run passes 42/42.

## Next minimum implementation boundary

The current environment-neutral `tools/compile-source.mjs` accepts one canonical
document. It has no resolver/source-closure input. `tools/ghostc.mjs` reads only
the root document. A complete next slice needs:

1. An explicit supplied-document closure contract carrying each canonical
   filename/locator, immutable revision identity, original text and verified
   UTF-8 digest. Use the same validator for browser and Node. The validator
   must not acquire files or network data implicitly.
2. Import-header extraction reusable without parsing currently unsupported
   instance bodies; reuse the parser's token rules rather than a regex scanner.
3. Relative locator resolution against the importing document. Resolution is
   only into the provided closure; locator spelling is not source identity.
4. Missing dependency, revision disagreement, digest mismatch, ambiguous
   locator binding and transitive import-cycle diagnostics retaining the
   importing source span. Validate transitive dependencies, not just root
   imports. Preserve original full prose and identities in the verified result.
5. Public compiler integration that validates the closure but still rejects
   instance execution until composition lowering/provenance is implemented.
   CLI filesystem collection is a separate adapter into that same contract.

Tests must pair a valid two-level pinned closure with each isolated corruption,
plus diamond reuse, alias reuse in different definitions, path normalization,
cycle and byte/document resource boundaries. A supplied closure must not be
altered by validation. The input contract is still a design decision for the
main integrator; this parser slice adds no speculative public resolver API.

REF-06-010 then additionally requires instance/parameter/connect parsing,
per-instance state isolation, exact port/quality checking, dependency ordering,
transitive next-state restrictions, one writer, and source/revision provenance.
Flattening source text and discarding original document identities is not an
acceptable shortcut.

## CLI direct digest preflight

The next small slice now exists in `tools/ghostc.mjs`. The CLI reuses
`parseControlImports` to inspect headers before unsupported instance parsing,
resolves each direct relative locator against the importing root filename,
and compares the pinned SHA-256 with the original file bytes. Imported prose,
UTF-8 encoding and CRLF bytes participate unchanged. Invalid UTF-8, oversized
documents, unreadable files and digest mismatches are rejected at the authored
import token before artifact publication.

This is direct filesystem integrity validation only. There is no public
sourceClosure API, recursive resolver, revision-authenticity proof or accepted
composition. A matching dependency still reaches the existing unsupported
compiler path. Browser compilation does not acquire files through this CLI
helper.

`tests/import-cli-digest.test.mjs` exercises the unchanged REF-06-102 fixture in
both check/build modes, exact UTF-8/CRLF matching, imported-prose tampering,
existing artifact preservation, missing files and invalid UTF-8.
`build/import-cli-digest-red.log` recorded four failures and one already-passing
unsupported-path control. `build/import-cli-digest-green2.log` records 156/156
passing tests, including all five new cases, import parser coverage and the
existing full CLI syntax diagnostic suite. No Reference expectation changed.
