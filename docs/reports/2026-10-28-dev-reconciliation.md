# Remaining language dev reconciliation

Tracking: [System integration #246](https://github.com/callin2/farm_studio_system/issues/246). Owner work: [local constraints #558](https://github.com/callin2/ghostflow-language/issues/558), [type discoverability #537](https://github.com/callin2/ghostflow-language/issues/537) and [readonly snapshots #580](https://github.com/callin2/ghostflow-language/issues/580).

Base: dev `0f9b541fa0014951860913f573d593f276ac2149`. The integration preserves PR583, PR582 and main in merge history. Celsius diagnostic guidance and local constraint metadata validation were still absent from dev. Main also contained the readonly interaction snapshot repair from PR581, which is now included. No historical artifact, compiler pin, ABI or product service is changed.

The only runtime merge conflict admitted both `requiredRuntimeFeatures` and `localConstraints`, retaining each validator. Bilingual changelog conflicts preserve both histories; reviewed hashes were refreshed only for the changed pair. The intact main snapshot repair changes the public snapshot version based on actual public setting descriptors while retaining private Rust state validation.

Author verification: 26 focused tests passed for Celsius diagnostics/CLI, local constraint legacy/framed execution, settings snapshot provenance and requirement catalog. Documentation index and translation checks pass. Rust sources/Cargo inputs match verified `d096ed2986e048381668edbe4d139f8b29eaea5d`; the tests reuse its existing WASM/native binaries, not a newly identified source release. Independent final combined-tree verification remains required before dev merge.

This completes only source reconciliation. The broader #537 discoverability and customer lifecycle remain open; no Device, live API, deployment or hardware acceptance is claimed.
