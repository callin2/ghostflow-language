# TASK-62 coverage evidence

Date: 2026-09-10

This report covers the independently built `ghostflow-language` compiler/toolchain
package and its browser-facing JavaScript/WASM runtime wrappers. It is host evidence,
not ESP32 execution or physical relay evidence.

## JavaScript and WASM wrapper gate

Run:

```sh
npm run test:coverage
```

The gate runs 225 tests from an explicit allowlist. The requirement-catalog test is
kept as a separate governance gate and is declared in the JSON report rather than
silently omitted. Node 24.6.0 reported:

| Metric | Previous measured baseline (`b0acf2a`) | TASK-62 | Enforced floor |
| --- | ---: | ---: | ---: |
| Functions | 96.02% (169/176) | 100% (175/175) | 100% |
| Lines | 82.05% (1225/1493) | 88.61% (1322/1492) | 88% |
| V8 block ranges | 70.01% (691/987) | 78.36% (927/1183) | 77% |

V8 block ranges are engine coverage ranges, not Istanbul syntactic branch coverage.
The total range count can change when new execution paths cause V8 to expose nested
ranges, so the report retains both hit/total counts and the precise Node version.
The generated machine-readable report is `build/coverage-language.json`.

The additional tests exercise compiler declaration forms, malformed Control and
GFB1 inputs, CommonMark source mapping and diagnostic remapping, bytecode lifecycle
operations (`load`, `activate`, `tick`, `rewind`, `hotSwap`), typed state reads, and
wrapper validation/failure behavior. One unused parser method was removed; no product
semantics or error acceptance rule was relaxed to raise the percentage.

## Rust core

Rust statement/line coverage is not claimed on this host. The reproducible probe is:

```text
$ cargo llvm-cov --version
error: no such command: `llvm-cov`

$ rustup component list --installed | rg 'llvm-tools|rust-src'
rust-src
```

Installing `cargo-llvm-cov` would require an external toolchain mutation and was not
performed as part of this task. The available Rust verification remains:

```sh
cargo test --workspace --locked --offline
```

It passes 42 `ghostflow-core` unit tests; `ghostflow-wasm` and doc-test targets contain
no additional Rust tests. This is a test-count result, not a Rust coverage percentage.

## Completion gates

```text
npm test                         PASS (230 JavaScript tests, 42 Rust tests)
npm run test:coverage            PASS (225 coverage-allowlisted JavaScript tests)
npm run test:mutation:output     PASS (4/4 mutants killed, 0 survivors)
cargo test --workspace --locked --offline
                                 PASS (42 Rust tests)
```
