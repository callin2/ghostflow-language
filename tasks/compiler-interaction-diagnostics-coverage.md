# Interaction schema diagnostic coverage

Focused evidence: `build/compiler-interaction-diagnostics.log` — **14/14 pass**.

## Public `compileSource` coverage

`tests/compiler-interaction-diagnostics.test.mjs` covers the `sourceIdentity()` fail paths with these exact tests:

- `interaction identity diagnostic: missing identity`
- `interaction identity diagnostic: extra identity field`
- `interaction identity diagnostic: array identity`
- `interaction identity diagnostic: missing documentId`
- `interaction identity diagnostic: missing revisionId`
- `interaction identity diagnostic: empty documentId`
- `interaction identity diagnostic: reserved documentId`
- `interaction identity diagnostic: malformed revisionId`
- `interaction identity diagnostic: empty revisionId`

The same file also covers source reachable provenance and descriptor validation:

- `valid public identity remains an accepted neighbor` — valid identity and schema emission.
- `interaction schema diagnostic: authored state without intent link` — state provenance failure plus linked valid state neighbor.
- `interaction schema diagnostic: authored timer without intent link` — timer provenance failure plus linked valid timer neighbor.
- `interaction schema diagnostic: authored config without intent link` — config provenance failure plus linked valid config neighbor.
- `interaction schema diagnostic: counter meaning on Bool state` — counter type failure plus linked `Int` counter neighbor.

## Remaining guards

The following `interaction-schema.mjs` guards are construction or downstream verification paths, rather than ordinary source diagnostics from `compileSource`:

- `canonicalDocument`, missing manifest/trace, bytecode hash, source-node, and continuous-subject checks require a malformed compiler result or manually altered metadata. No public source construction reaches them after the toolchain compile succeeds.
- `verifyInteractionSchema` object-shape and reconstructed-equality failures are persisted-schema verification paths. Existing downstream assertion: `tests/interaction-runtime-snapshot.test.mjs` test `GF-TEST-interaction-runtime-snapshot-fail-closed: producer rejects schema or trace identity drift without exposing generated storage` (line 430 assertion).
- `restoreInteractionSchema` replay bytecode mismatch is a restore-integrity path. It requires altered persisted bytes or source envelope and is not inferred as source coverage here.
- Invalid elapsed timer subject is rejected by compiler semantic validation before interaction schema emission; this schema guard is a compiler construction invariant.

These classifications do not exclude the four source-provenance and counter paths above.
