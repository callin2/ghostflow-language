# PLAN - ghostflow-language (session relay)

## NOW — relay header (updated 2026-09-20, session close)
- Last action: **Windows-compat fix set implemented (option a)** — every gate of the oracle now runs natively on Windows; full node suite 308/45 → **377/377 GREEN**, tutorial PASS
- Oracle at handoff (2026-09-20, this Windows host, all re-run this session):
  - `cargo test --locked --offline --workspace`: **71/71 PASS** (59 core + 12 package)
  - `cargo fmt --all -- --check`: PASS · fixture compile: PASS · release builds (wasm, run, scan_tape, scan_adapter): OK · `resource_report` example: PASS
  - node 40-file LANGUAGE_TESTS suite (`node --test <explicit list>`): **377 pass / 0 fail**
  - tutorial (`node tools/tutorial.mjs`, self-builds debug example, native+WASM parity, writes build/ evidence): **PASS exit 0**
  - FULL oracle `npm test`: still blocked on Windows ONLY by the deliberate win32 guard at `tools/verify-language.mjs:235` (contract, left untouched per user decision) + the report assembly behind it. Every individual gate it runs has now passed on this host.
- Fix set (this session's commit): (1) 11 test files: `path.resolve(new URL(...).pathname)` → `fileURLToPath(new URL(...))` (the `C:\C:\` double-drive bug); (2) 9 sites: native example paths + win32 `.exe` suffix (incl. the scan_adapter site the first sweep missed — its filename contained 'wasm' and got filtered out of the grep); (3) `runtimes/node/ledger.mjs`: parent-directory fsync skipped on win32 (POSIX idiom; dir-fd fsync is EPERM on Windows), doc updated; (4) `contracts/requirements/catalog.json`: 12 test locators re-anchored (+1 line shift from the import insertion, digests recomputed via the repo's OWN `normalizeExcerpt` to guarantee algorithmic identity)
- Env: Node 26 (>=22 ok) · rustfmt + wasm32-unknown-unknown present · cargo cache warmed via `cargo fetch` (the repo's `--offline` gates assume a warm cache; first run fails cold)
- Next single action: user decides — (a) relax the line-235 guard so `npm test` runs end-to-end on Windows and writes verification.json (one-line contract change, now evidence-backed since tutorial+suite pass), or (b) WSL for byte-identical POSIX evidence, or (c) push this fix set (local commit only so far)
- Human-only residue: none
- Open vetoes: guard relaxation is the repo's verification CONTRACT — deliberately not touched. `.gitattributes` (durable CRLF pin) still not added — repo decision. Fix-set commit is local, NOT pushed.

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
Full (POSIX, or Windows once the line-235 guard is relaxed): `npm ci
--ignore-scripts && npm test` — writes `build/verification.json` (host
evidence, gitignored).

Windows breakdown (this box — all gates individually verified green):
1. `cargo fetch` (once; warms the `--offline` cache)
2. `cargo fmt --all -- --check`
3. `node tools/ghostc.mjs examples/irrigation.ghost.md build/irrigation.gfb`
   (fixture the Rust tests embed)
4. `cargo test --locked --offline --workspace`
5. release builds: `-p ghostflow-wasm --target wasm32-unknown-unknown` +
   `-p ghostflow-core --example run` + `--example scan_tape` +
   `--example scan_adapter` (all `--locked --offline --release`)
6. `node --test <the 40 files listed in LANGUAGE_TESTS>` — baseline GREEN
   (377/377); judge regressions against green, not against a failure class
7. `node tools/tutorial.mjs` (self-builds the debug example; PASS = the
   last non-guarded full-oracle piece)

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
  failures). Fixed locally: `core.autocrlf=false` + tree rewrite.
  Durable fix is a `.gitattributes` (`* text=auto eol=lf`) — REPO DECISION,
  not made unilaterally. (Note: catalog digests normalize line endings, so
  CRLF never broke the requirement catalog; only PC-01-style raw-source
  hashes did.)
- Path bugs FIXED this session (were the 45-failure class): double-drive
  `path.resolve(url.pathname)` in 11 test files; missing `.exe` on 9 native
  example sites; directory-fd fsync (EPERM) in the reference ledger on win32.
  Residual: `gfb1-browser.test.mjs:23` uses `modulePath.pathname` as a VM
  error-label filename (cosmetic only, left as-is).
- Full verifier remains POSIX-only by explicit design (line 235) — contract,
  untouched. All gates behind it now pass on Windows, so relaxing the guard
  is an evidence-backed one-line option if the user wants `npm test` here.

## Maintenance notes (learned this session)
- `contracts/requirements/catalog.json` has MIXED formatting (compact +
  expanded entries) — never re-serialize it whole; edit surgically. Locators
  pin absolute line ranges + digests of the normalized excerpt; editing a
  test file above a pinned range requires re-anchoring (shift + digest via
  the repo's exported `normalizeExcerpt`).
- When grepping for test-file sites, do NOT filter lines on 'wasm' — several
  failing-adjacent filenames contain 'wasm' (solar-scanframe-native-wasm) and
  the first sweep missed the scan_adapter site because of it.

## Backlog (unranked — user picks the task)
- Guard relaxation (line 235) for end-to-end `npm test` on Windows — one-line
  contract change, now evidence-backed
- WSL Ubuntu install → byte-identical POSIX `verification.json` evidence
- `.gitattributes` PR (repo-level CRLF pin) — unblocks clean Windows checkouts
  for everyone, not just this session
- Push the Windows-compat fix set (local commit only so far)
- First real task: TBD by user
