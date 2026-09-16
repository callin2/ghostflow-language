# Standalone language verification

The exporter copies source and overlays, not previous build results. No PASS is
inherited from the migration workspace. Main runs these commands in the newly
exported repository to establish its own result:

```sh
npm ci --ignore-scripts
rustup component add rustfmt
rustup target add wasm32-unknown-unknown
npm test
```

Requirements: Node.js 22+, npm, Rust/Cargo supporting lockfile v4, rustfmt, the
WASM target, and a macOS/Linux native linker. Setup can require network access;
the verification gates use offline/locked Cargo and no API, LLM, serial, network
service or physical driver. The retained tutorial's native executable path is
POSIX-specific. The initial export does not claim Windows support.

`tools/verify-language.mjs` runs these gates, failing at the first unsuccessful
command and preserving the failure report:

1. Read toolchain versions and check Rust formatting.
2. Compile the legacy fixture required by `include_bytes!` in Rust unit tests.
3. Run workspace Rust tests with the existing lockfile.
4. Build the legacy native runner, release framed `scan_tape` runner and release
   WASM from the same core.
5. Run the explicit language/integration-contract Node suite, including framed
   native/WASM tape parity (see [SCAN-TAPE-PARITY.md](SCAN-TAPE-PARITY.md)).
6. Execute the tutorial with freshly built runners and compare native/WASM traces.
7. Record the native resource report, both native runner digests, WASM digest
   and source hashes.

The Node suite covers compiler errors, literate extraction, artifact maps,
manifest-aware control execution, constraints/policy, schedules and occurrence
admission, signals/station ABI behavior, the reference file ledger, and pure
integration identity/evidence rejection checks using a fictional fixture. Some
adapter tests use injected ABI objects; real compiled WASM behavior is separately
exercised by control/station tests and tutorial parity. Tests are source-level
conformance coverage, not a proof of all runtime or device behavior.

`build/verification.json` is the latest full host result. Unique files in
`build/verification-runs/` retain previous results; `build/tutorial/` contains
the regenerated programs and traces. All are ignored execution evidence. The
partial `npm run test:node` requires existing WASM and both release native builds and writes
`build/verification-node.json`, leaving the latest full result intact.

API acceptance, genuine farmer-language evaluation, firmware compatibility,
board upload, GPIO, wiring, and physical operation require separately identified
consumer tests. Do not attach those claims to a successful host report here.

For revision-addressed GitHub Actions handoffs and their consumer verification
limits, see [WASM CI artifacts](WASM-CI-ARTIFACTS.md).
