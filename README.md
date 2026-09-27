# ghostflow-language

GhostFlow's language compiler and portable execution platform. JavaScript owns
parsing, type checking and lowering; Rust owns verified bytecode execution,
signals and station arbitration. Native and WASM tests share that Rust core.

Start with the [Language Reference](docs/LANGUAGE-REFERENCE.md), the shared
ground truth for language philosophy, syntax, semantics, and the reasons behind
its features.

For task-oriented examples, see the [GhostFlow Coding FAQ](docs/language_faq.md).

```text
.ghost.md → compileSource → .gfb + manifest + source map
                                         ↓
                         native / WASM portable Rust core
```

`tools/browser-toolchain.mjs` is the public browser/Worker compiler entry. It
accepts the same complete canonical `.ghost.md` document and immutable source
identity as the Node entry, but has no Node I/O dependency. `tools/toolchain.mjs`
is the Node wrapper and artifact read/write boundary.

Product deployment wraps the `.ghost.md` result with
`tools/portable-package.mjs`: one signed package preserves the exact source, GFB,
manifest, source map and host-compatibility identity. Browser and Device
consumers use the same verifier contract before passing recovered GFB bytes to
their WASM or native loader. See [Portable GFB package v1](docs/PORTABLE-PACKAGE.md).

This repository contains `tools/` compiler/CLI/tutorial code,
`crates/ghostflow-core`, `runtimes/wasm`, the reference Node ledger adapter,
selected `tests/`, language `docs/`, and virtual `examples/`. Existing relative
imports and semantics are preserved by the migration export.

## Local verification

Use Node.js 22 or newer with npm, and a Rust toolchain supporting Cargo lockfile
v4 with `rustfmt` and `wasm32-unknown-unknown`. The retained tutorial expects a
POSIX native runner path; use macOS or Linux. Setup may download dependencies:

```sh
npm ci --ignore-scripts
rustup component add rustfmt
rustup target add wasm32-unknown-unknown
npm test
```

`npm test` runs host checks only and writes `build/verification.json` plus a unique
run record. It generates `build/irrigation.gfb` before Rust tests, because one
existing unit test embeds that fixture. Cargo gates use `--locked --offline` and
a local `target/`; both Rust crates currently have only workspace dependencies.

For a modern source example:

```sh
npm run compile:example
npm run tutorial
```

`npm run test:compiler` checks compiler/literate/constraints behavior without a
WASM build. `npm run test:node` runs the explicit language Node suite against an
already built WASM artifact and records a separate partial report; it does not
replace the full host gate. See [the tutorial](docs/TUTORIAL.md).

## Source, generated artifacts and consumers

Authoritative logic is GhostFlow source. GFB1 is generated binary code, and
`GhostFlow/control-v1` is the generated host manifest format. Standalone
`constraints` sources compile to `GhostFlow/constraints-v1`. JSON encoding alone
does not make deployment, site metadata or conversation records a control program.

The API project supplies installation facts to its LLM and invokes this compiler
on the resulting complete source. The Device project consumes a pinned core and
artifact bundle, validates its supported features, and owns I/O. The frontend
project presents the farmer experience. API and firmware are released separately;
host tests here do not establish farmer intent quality or GPIO behavior.

Release/bundle consumers must identify exact source/bytecode/manifest hashes,
compiler/core revision, and supported profile/ABI. `contracts/integration-v1` and
`tools/integration-contract.mjs` carry the integration team's pure identity/evidence
checks and fictional fixture; they do not execute a deployment or change compiler
formats. Run them alone with `npm run test:contract`. See
[implementation boundaries](docs/IMPLEMENTATION.md),
[verification](docs/VERIFICATION.md), and [ownership](AGENTS.md).

This project is licensed under the [MIT License](LICENSE).

No prior `build/` results, POC, firmware, live model connector, site installation,
or private chat archive is carried into this export. Run the host gate in this
checkout to produce its own evidence.
