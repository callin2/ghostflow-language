# PLAN - ghostflow-language (session relay)

## NOW — relay header (updated 2026-09-20, session close)
- Last action: fresh checkout (shallow clone @ 18559d4, latest = PR #98 verified-wasm-artifacts); env set up; oracle baseline established; checkout made LF-faithful (see Windows caveats)
- Oracle at handoff (2026-09-20, this Windows host, all re-run this session):
  - `cargo test --locked --offline --workspace`: **71/71 PASS** (59 core + 12 package)
  - `cargo fmt --all -- --check`: PASS · fixture `node tools/ghostc.mjs examples/irrigation.ghost.md build/irrigation.gfb`: PASS
  - release artifacts (wasm + examples/run + examples/scan_tape): BUILD OK
  - node 40-file LANGUAGE_TESTS suite (`node --test <explicit list>`): **308 pass / 45 fail** — every remaining failure is a Windows-host artifact (native loader path without `.exe`; `C:\C:\` double-drive path construction in test helpers; EPERM fsync). NOT code defects.
  - FULL oracle `npm test`: **cannot run on win32** — verifier throws unconditionally (`tools/verify-language.mjs:235`), no flag bypasses it. Needs a POSIX host: WSL (no distro installed) or Mac/Linux.
- Env: Node 26 (>=22 ok) · rustfmt + wasm32-unknown-unknown present · cargo cache warmed via `cargo fetch` (the repo's `--offline` gates assume a warm cache; first run fails cold)
- Next single action: user picks — (a) install WSL Ubuntu to get the full `npm test` oracle, or (b) designate the first task on this repo
- Human-only residue: none
- Open vetoes: PLAN.md is a local agent artifact — committed locally only, NOT pushed. Repo-level `.gitattributes` (the durable CRLF fix) deliberately NOT added — that's a repo/CI decision, see below.

## What this repo is
The GhostFlow language platform, a migration export: `.ghost.md` literate source
→ JS toolchain (parse/type-check/lower, `tools/`) → **GFB1 bytecode** + manifest
+ source map → Rust core (`crates/ghostflow-core`) executes it — signals,
stations, exact-integer contracts — shared by native and WASM
(`runtimes/wasm`, `crates/ghostflow-package` = signed portable package).
Docs are authoritative and in-repo: `docs/LANGUAGE.md`, `BYTECODE.md`,
`EXACT-INTEGER-CONTRACT.md`, `PORTABLE-PACKAGE.md`, `IMPLEMENTATION.md`,
`VERIFICATION.md`. `SOURCE-PROVENANCE.json` records the migration origin.

## Oracle (how to verify state here)
Full (POSIX only): `npm ci --ignore-scripts && npm test` — writes
`build/verification.json` (host evidence, gitignored).

Windows breakdown (this box — the verifier itself refuses to run):
1. `cargo fetch` (once; warms the `--offline` cache)
2. `cargo fmt --all -- --check`
3. `node tools/ghostc.mjs examples/irrigation.ghost.md build/irrigation.gfb`
   (fixture the Rust tests embed)
4. `cargo test --locked --offline --workspace`
5. release builds: `-p ghostflow-wasm --target wasm32-unknown-unknown` +
   `-p ghostflow-core --example run` + `--example scan_tape` (all `--locked --offline --release`)
6. `node --test <the 40 files listed in LANGUAGE_TESTS>` — expect the
   Windows-host failure class (native loader `.exe` paths); judge regressions
   against the 308/45 baseline, not against green.

## Boundaries (AGENTS.md — do not cross)
- This repo = syntax, parsing, typing, lowering, GFB1 encoding, Rust
  VM/signal/station engines, WASM ABI, reference adapters, conformance tests.
  Compiler + runtime change together when execution semantics change.
- NOT here: LLM requests, conversation history, deployment orchestration
  (API host); firmware/pins/drivers (Device repo); farmer UX (frontend).
- No product servers, POC UI, credentials, model connectors, firmware, or
  imported conversation records in this repo.
- Tests are the explicit list in `tools/verify-language.mjs` — never
  discover sibling tests by wildcard.
- v1 clean break: canonical `.ghost.md` literate source only; superseded
  paths get removed once a replacement is verified; compatibility only for an
  explicitly approved concrete need.

## Windows host caveats (measured, not assumed)
- **CRLF corruption**: repo has NO `.gitattributes` and git default
  `core.autocrlf=true` → Windows checkout converts sources to CRLF, changing
  SHA-256 of canonical sources (PC-01 projection mismatch class: 5 test
  failures). Fixed locally: `core.autocrlf=false` + tree rewrite → 308/45.
  Durable fix is a `.gitattributes` (`* text=auto eol=lf`) — REPO DECISION,
  not made unilaterally.
- Test helpers build Windows paths with a double drive letter (`C:\C:\...`)
  and reference native loader `target/release/examples/run` without `.exe` —
  both POSIX-shaped; the 45 remaining failures trace to these + EPERM fsync.
- Full verifier is POSIX-only by explicit design (line 235), including the
  retained tutorial.

## Backlog (unranked — user picks the task)
- WSL Ubuntu install → full `npm test` oracle on this machine
- `.gitattributes` PR (repo-level CRLF pin) — unblocks clean Windows checkouts
  for everyone, not just this session
- First real task: TBD by user
