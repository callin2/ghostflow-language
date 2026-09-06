# GhostFlow WASM runtime

This `cdylib` uses the exact `ghostflow-core` crate used by ESP-IDF. It has no
JavaScript or wasm-bindgen dependency. A browser allocates module bytes through
`gf_alloc`, copies a `.gfb` module into linear memory, and calls the exported C
ABI. Multiple handles can run actual and ghost timelines side by side.
`ghostflow-runtime.mjs` supplies a small dependency-free JavaScript wrapper for
the raw ABI.

New control sources should use `control-runtime.mjs` with both `.gfb` and its
trusted `.manifest.json`. This adapter installs **virtual** output capabilities,
connects the Rust sensor engine, validates input types and records quality alongside
the VM trace. It does not discover devices or issue GPIO commands.

`station.mjs` exposes the shared pump's mode/ownership/quota/durability boundary;
`policy.mjs` binds the standalone constraint templates to one station. The station
cannot verify that a JavaScript persistence callback really made bytes durable,
or that a Driver physically stopped. Those are host responsibilities.

Use `requestStop()` synchronously and apply its safe directive before awaiting
storage. `advance()` returns an actionable safe directive on lease/day expiry.
On any runtime error a physical host must fail safe, not reuse a stale intent.

See [the tutorial](../../docs/TUTORIAL.md),
[implementation boundaries](../../docs/IMPLEMENTATION.md), and
[verification evidence](../../docs/VERIFICATION.md). Run all software gates with
`npm test` from the repository root; `npm run tutorial` also builds the native/WASM
artifacts and executes the tutorial's assertions.

Build after adding the target:

```sh
rustup target add wasm32-unknown-unknown
cargo build -p ghostflow-wasm --target wasm32-unknown-unknown --release
```
