# Changelog

## Unreleased

### 2026-09-29 — explicit relative-humidity ratio ([#371](https://github.com/callin2/ghostflow-language/issues/371))

Reference §2.9 now permits `RelativeHumidity / RelativeHumidity -> Number`,
previously rejected. For example, `60%RH / 100%RH` produces `0.6` for an authored
air-VPD calculation. All other RH arithmetic, cross-quantity division and implicit
numeric conversion remain forbidden. Constant/dynamic zero division retains the
existing diagnostic/tick rejection. The compiler uses existing division bytecode;
no GFB/ABI change or source migration is required. Regression coverage:
`tests/relative-humidity-ratio.test.mjs` (constants, nominal rejections and native/WASM outcomes).

### 2026-09-28 — framed civil schedule bug fix ([#366](https://github.com/callin2/ghostflow-language/issues/366))

Before this fix, framed civil schedules were rejected. They now use the same
Rust core for `Daily` and `DailySlots`. Activation accepts
`{bootEpoch, terminalCapacity}`. The provider supplies GFSF v2/v3 schedule facts
separately at scan time. Matching WASM exports are required. Rust admits
occurrences and owns their ledger; the host validates the complete input set
and schedule-fact packet, and does not derive runtime `due`, `ok` or `fault` values. A known rejection
rolls back for same-frame retry; a post-commit failure preserves the committed
result. Framed Solar remains unsupported.

Regression coverage is in `tests/framed-control-host.test.mjs` and
`crates/ghostflow-core/tests/schedule_module.rs`. See
[Framed ControlRuntime](docs/FRAMED-CONTROL-HOST.md).
