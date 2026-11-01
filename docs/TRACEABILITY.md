# Language implementation and checks

This page maps each language contract to the code that implements it and to
the tests that check it.

It only tells you **where** the retained tests live. It does not tell you
whether they passed. To see which checks ran and passed, read the current
checkout's [verification report](VERIFICATION.md). This table also does not
carry forward any completion or hardware claims from the source workspace.

| Contract | Implementation | Verification |
|---|---|---|
| Modern control syntax, types, lowering | `tools/control.mjs`, `tools/gfb1.mjs` | `tests/control.test.mjs`, `tests/compiler.test.mjs` |
| Literate extraction and original positions | `tools/literate.mjs`, `tools/toolchain.mjs` | `tests/literate.test.mjs`, `tests/toolchain.test.mjs` |
| Verified VM/state/intent semantics | `crates/ghostflow-core/src/lib.rs` | Rust unit tests, native/WASM tutorial parity |
| Typed host input and manifest/hash checks | `runtimes/wasm/control-runtime.mjs` | `tests/control-host.test.mjs` |
| Sensor conditioning and signals | core `signals.rs`, WASM signals ABI/adapter | Rust tests, `tests/signals-wasm.test.mjs`, moisture tutorial |
| Standalone constraints and binding | `tools/constraints.mjs`, `runtimes/wasm/policy.mjs` | `tests/constraints.test.mjs`, `tests/policy.test.mjs` |
| Schedule occurrences and fixed IDs | WASM schedule/admission adapters | `tests/schedule.test.mjs`, `tests/scheduled-admission.test.mjs` |
| Station ownership, quotas and persistence | core `station.rs`, WASM station ABI, Node ledger | Rust tests, `tests/station-wasm.test.mjs`, `tests/ledger.test.mjs`, station demo |
| Same generated input trace on native/WASM | `tools/tutorial.mjs`, core native runner | Tutorial assertions and generated traces |
| Release identity versus execution evidence | `tools/integration-contract.mjs`, `contracts/integration-v1` | `tests/integration-contract.test.mjs` (fictional fixture) |

Two kinds of checks live outside this repository:

- Cross-project release provenance, and Device/API/frontend checks, belong to
  the integration and consumer projects.
- The original task and conversation history stay in the private migration
  workspace.
