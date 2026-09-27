# Authoring baseline provenance

## Failure

The authoring efficiency test combined two different records:

1. measurements from a reviewed, dated benchmark; and
2. hashes derived from the currently checked-out compiler and Rust core.

It then required the whole live report to equal the historical JSON and pinned
the live aggregate hash in test code. Any legitimate Rust core edit therefore
failed CI even when every compilation, correction, diagnostic, retrieval bound,
simulation result, and token measurement remained unchanged. Replacing the old
hash with the new hash made CI pass once and preserved the faulty contract.

## Permanent contract

- The legacy dated JSON retains the reviewed source identity from `c7233b1`,
  whose aggregate digest is
  `45f4efc0e2a8c7d227d04622ed4dc61ee63430646fd0751dd4e332fd35f5323f`.
- Its stored source identity must reproduce its stored digest and must match that
  independently pinned reviewed digest. Editing an identity field and recomputing
  the stored digest is rejected.
- Each test run derives current tool, lockfile, scenario runner, Reference, and
  Rust core identities from the checked-out files. That live provenance is
  reported but is not required to equal the historical snapshot.
- All benchmark evidence outside `sourceRevision` remains an exact comparison:
  cases, source identities, section digests and byte bounds, diagnostics,
  correction and simulation rounds, safe virtual intents, totals, and token data.
- A deliberate new benchmark is a new dated artifact. Routine source work never
  rewrites an existing historical benchmark.

The focused regression uses a real temporary source tree. It pins the expected
tree and aggregate digests, proves core and whole-Reference identity changes
alter live provenance without changing the benchmark, rejects missing declared
files, rejects stored identity tampering even when its digest is recomputed, and
rejects changed benchmark measurements. Exact digests and byte counts for every
Reference section consulted by the benchmark remain part of the comparison.
