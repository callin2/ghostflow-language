# Language project separation verification

2026-09-06 / TASK-32 / GF-ADR-001.

The independent `ghostflow-language` checkout was exported from an explicit
allowlist, not a copy of the mixed POC directory. Its original 75-file source
snapshot is recorded in `SOURCE-PROVENANCE.json` with inventory SHA-256:

`b0d6a4c7b7e16e800ae759b7938bbd82a01f5c5df274091430e8c59a5ec82720`

The provenance records selected working-tree bytes, not an invented clean
commit of the original unversioned POC. The source inventory verified unchanged
after dependencies and the complete independent host suite ran.

## Actual checks

- `npm ci --ignore-scripts --no-audit --no-fund`: passed. An initial offline
  attempt found an uncached locked dependency; the normal locked install then
  completed. No lifecycle install scripts were enabled.
- `npm test`: passed, ten gates, 2026-09-06T08:50:31.694Z through
  2026-09-06T08:50:48.979Z.
- Rust: 41 tests passed. Host compiler: rustc 1.98.0, Cargo 1.98.0.
- Node: 77 tests passed, including 43 integration-contract checks.
- Native/WASM tutorial parity passed for the four generated control examples;
  shared-station and ghost-replay checks also ran with virtual outputs.
- Built WASM: 129,963 bytes;
  SHA-256 `3574f4d4d551e14f8a1b880219b25783f70747071e098f6b38c4e60e7df27d22`.
- `build/`, `target/` and `node_modules/` were ignored and excluded from source
  publication. No conversation records, API credentials or flash backups were
  exported.

The full local result is generated as `build/verification.json` and a timestamped
record under `build/verification-runs/`. These are local execution evidence, not
source files. This summary is added after validation and is not one of the 75
initial source snapshot files.

## What this does not prove

No LLM API, physical board, relay, contact or water-flow test was performed by
this suite. The separated Device firmware does not yet contain the GhostFlow
backend adapter. The known generic-GPIO POC firmware incident is not repaired
by this repository extraction. API/frontend migration and complete farmer POC
acceptance remain subsequent work.
