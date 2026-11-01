# Authoring baseline provenance

This record explains why the authoring efficiency test broke on ordinary Rust
core edits, and the permanent contract that replaced it. "Provenance" here means
the identity of the source files (tools, lockfile, Reference, Rust core) that a
benchmark was measured against.

## Failure

The authoring efficiency test mixed two different kinds of record:

1. measurements from a reviewed, dated benchmark; and
2. hashes computed from the compiler and Rust core that are currently checked
   out.

The test then required the whole live report to equal the historical JSON. It
also pinned the live aggregate hash in test code. As a result, any legitimate
Rust core edit failed CI, even when every compilation, correction, diagnostic,
retrieval bound, simulation result, and token measurement stayed the same.
Replacing the old hash with the new one made CI pass once, but kept the faulty
contract in place.

## Permanent contract

The fix separates the frozen historical snapshot from live provenance:

| Record | Source | Compared how |
| --- | --- | --- |
| Historical source identity in the dated JSON | Reviewed at `c7233b1` | Must reproduce its stored digest and match an independently pinned digest |
| Live provenance | Derived from checked-out files on each run | Reported only; need not equal the snapshot |
| Benchmark evidence (everything outside `sourceRevision`) | Dated JSON | Exact comparison |

The rules in detail:

- The legacy dated JSON retains the reviewed source identity from `c7233b1`,
  whose aggregate digest is
  `45f4efc0e2a8c7d227d04622ed4dc61ee63430646fd0751dd4e332fd35f5323f`.
- Its stored source identity must reproduce its stored digest. It must also
  match that independently pinned reviewed digest. Editing an identity field
  and then recomputing the stored digest is rejected.
- Each test run derives the current tool, lockfile, scenario runner, Reference,
  and Rust core identities from the checked-out files. This live provenance is
  reported, but it is not required to equal the historical snapshot.
- All benchmark evidence outside `sourceRevision` is still compared exactly:
  cases, source identities, section digests and byte bounds, diagnostics,
  correction and simulation rounds, safe virtual intents, totals, and token
  data.
- A deliberate new benchmark is a new dated artifact. Routine source work never
  rewrites an existing historical benchmark.

The focused regression test uses a real temporary source tree. It:

- pins the expected tree and aggregate digests;
- proves that changing the core identity or the whole-Reference identity
  changes live provenance without changing the benchmark;
- rejects missing declared files;
- rejects tampering with the stored identity, even when its digest is
  recomputed; and
- rejects changed benchmark measurements.

The exact digests and byte counts of every Reference section the benchmark
consulted remain part of the comparison.
