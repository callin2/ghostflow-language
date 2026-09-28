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

The canonical `examples/vfd-speed.ghost.md` regression compiles a mixed Bool/Number
control and checks eight sequential `vm.safe` frames in the release WASM. It
also checks the emitted input/output types. The original failure occurred with
WASM SHA-256 `3a8450b3001e04f52fe6a3a2e7d4cde0c16316171e69f345483ecde2d319ef36`:
that binary rejected the 232-byte GFB before the first scan with `unknown expression opcode`.
Rebuilding WASM from language revision `fa0a005e43bd98ce0cb22e49b263d89ee796cd30`
produced SHA-256 `b4495901b3399c57ed0a0b204b4d226b03819bcc251c368d9dcfa82b147c32b3`
and passed all eight frames. The earlier binary's build revision is unknown;
these observations establish an incompatible reused binary, not a source
compiler/loader defect. The full `npm test` rebuilds WASM before this regression;
it fails if that fresh compiler/runtime pair is incompatible. The partial
`npm run test:node` fails when reusing an incompatible WASM binary.
After a verified build, `node --test tests/vfd-speed.test.mjs` is the focused
headless invocation. Each successful run writes a new file under
`build/vfd-speed-runs/` with the expected scenario separate from observed VM
traces, source and scenario hashes, compiler revision and source-tree hash,
bytecode hash, and WASM hash. The test also rejects missing inputs, wrong Bool
and Number types, NaN, and infinity before any scan. These are virtual control
outputs; the trace does not measure motor speed or physical voltage.

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

Under [issue #357](https://github.com/callin2/ghostflow-language/issues/357), the
always-triggered Verified WASM workflow selects either documentation checks or
the existing full `Verify WASM (current)` / `Verify WASM (frontend-pin)` jobs.
The conservative ordinary-document allowlist and exact-diff rules are recorded
in [Development workflow](DEVELOPMENT-WORKFLOW.md). All other changes and manual
dispatches run full verification. Use manual dispatch with `source_sha` when an
exact revision needs a verified WASM handoff; documentation-only success does
not build WASM or establish compiler/runtime behavior.

The final `Verification result` check runs even when a lane is skipped or fails.
It fails for failed, cancelled or skipped classification, a missing/unknown mode,
or an unsuccessful selected lane. Only the nonselected lane may be skipped;
unexpected failure, cancellation or a missing result in that lane also fails.
This result must be green before merge; existing branch protections are unchanged.
Routing and result propagation are regression-tested by
`tests/ci-verification-routing.test.mjs`, also listed in the full language suite.
