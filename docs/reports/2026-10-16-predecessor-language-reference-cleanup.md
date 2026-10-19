# GhostFlow predecessor-language reference cleanup — 2026-10-16

Removed the abandoned predecessor-language clause from the English and Korean scan-tape parity documents. Both retain the independent rule that old device evidence does not count as GhostFlow acceptance. No compiler, runtime, test semantics, or device behavior changed.

Tracked under [GhostFlow System #235](https://github.com/callin2/farm_studio_system/issues/235) and [GhostFlow language #551](https://github.com/callin2/ghostflow-language/issues/551).

Verification: `npm run docs:index` and `npm run docs:check` passed in a temporary canonical-LF clone (154 translation pairs, 80 exclusions; 206 documents under `docs/`, 388 total). The direct Windows `docs:find` check reported doc-index provenance mismatch because the checkout has CRLF line endings; no provenance data was changed. No compiler/runtime tests were run because this edit changes documentation only.