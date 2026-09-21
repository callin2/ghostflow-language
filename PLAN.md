# PLAN - ghostflow-language (session relay)

## NOW — relay header (updated 2026-09-20, post-merge pull)
- Last action: **pulled the repo; #110's doc work is MERGED** — PR #112 → `dev` as merge commit `ce995c6`. The doc was reconciled with **PR #111** (a parallel `docs/live-property-contract-alignment` effort on the same #110 subject, merged first as `c6f5528`): dev was merged into the #112 branch (`84e0aa3`) to reconcile the overlapping edits, then #112 merged cleanly. Final section = "Runtime-adjustable 속성과 구조적 변경" (normative, from #111) + "예제: 모드 전환과 stopped 설정 적용" (implemented form + my target live-event contract, `ghost-draft` fence, 미구현 marking, research links, sharpened conflict list). Read the merged section after the pull — coherent, no duplication/contradiction.
- Oracle at handoff (re-run on merged dev tip `ce995c6`, this Windows host):
  - node 40-file LANGUAGE_TESTS suite: **378/378 PASS, exit 0**
  - `cargo test --locked --offline --workspace`: **71/71 PASS**
  - prior state (still true): tutorial PASS exit 0 · fmt clean · release builds OK · resource_report PASS · full `npm test` still gated by the deliberate win32 guard at verify-language.mjs:235 (every gate behind it individually passes on this host)
- Merged on `dev` this session: **#109** win32 host compat (`9a09c76`; suite 308/45 → 378/378) · **#111** live-property contract alignment · **#112** the #110 doc correction (→ `ce995c6`). Note: earlier notes said "377/377" — that was a grep-counting artifact (`grep -c '^✔'` undercounts by 1); node's own tally says tests=378 pass=378. Read counts from the tool's summary lines, not progress lines.
- Issue work: sub-issue #110 created under #89 this session and its doc work is merged — but **issue #110 itself is still `open`** (the `Fixes #110` link did not trip the auto-closer on the reconciled merge path). Closing it is the immediate pending action (user's call).
- Env: Node 26 · rustfmt + wasm32 target present · cargo cache warm (`cargo fetch` first run) · gh authed as callin2 (PATH: `C:/Program Files/GitHub CLI`)
- Next single action: close issue #110 (work is done and merged); then backlog picks
- Human-only residue: none functional; the merged Korean doc prose is machine-written (two parallel efforts, one merge) — user read of the CONSTRAINTS.md settings section is the residual human check (it is a normative spec doc)
- Open vetoes / decisions: close #110 · delete remote branch win32-host-compat (and optionally issue-110-live-settings-doc) · win32 guard relaxation (one-liner, evidence-backed) · `.gitattributes` CRLF pin (repo decision) · DSL grammar change for a live `configureOnly` successor = new milestone (flagged as conflict #1 in the doc, NOT done)

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
   (378/378 per node's own tally `ℹ tests 378 / ℹ pass 378`); judge regressions against green, not against a failure class
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

## M-110: correct the outdated stopped/new-run settings requirements (DONE, merged as PR #112 → dev `ce995c6`)
- **Reconciliation note (verify-join seam, read after pull)**: PR #111 (parallel, merged first) edited the same section; the merged result renames/restructures it into "Runtime-adjustable 속성과 구조적 변경" (normative: property vs structural-change classification, single logical event, identity preservation, no restart/recompile) + "예제: 모드 전환과 stopped 설정 적용" (my implemented-form-first + `ghost-draft` target contract). Conflict list sharpened by #111 (e.g. `acceptSettings` clarified as a manifest-format acceptance flag, NOT a lifecycle/stopped-enforcement API). Suite still 378/378 after the merge — re-run on the merged tip, not asserted.
- Contract (doc-only, no code): in `docs/CONSTRAINTS.md` replace the
  stopped/new-run settings framing with the #89 atomic live-property event
  contract: ONE atomic event carrying a (name,value) batch of declared
  config fields; whole-batch pre-validation (known name, type,
  min/max/step, source identity); valid -> whole batch committed to the
  active snapshot in one commit; invalid -> NOTHING changes (no partial
  application, rejection reason recorded). Program identity preserved
  (same canonical source digest + same compiled program/bytecode digest,
  snapshot is an overlay, no recompile). Run identity preserved (no stop,
  no new run; committed snapshot visible at the next step boundary after
  commit, never mid-evaluation). Clearly marked NOT IMPLEMENTED (current:
  manifest `apply = stopped` + source-edit candidate workflow). Link the
  corrected research (#89 + farm_studio_system#54). Identify remaining
  spec conflicts (manifest attribute / acceptSettings path, the
  source-edit tool as the only implemented path, physical stop semantics
  still valid for mode transitions).
- 4 edit sites: line-19 user-decision bullet (revised WITH a dated note —
  it is a recorded user decision), the StationRules sketch, the dedicated
  section at 179-204 (restructured: implemented form + target contract),
  line 258 (require-promotion sentence).
- **KEY FINDING (oracle caught it, 3 red tests on first pass)**:
  `tests/constraints.test.mjs` (a) carries an inline copy of the
  StationRules sketch and (b) extracts EVERY ` ```ghost|text ` block starting
  with `constraints` from docs/CONSTRAINTS.md and compiles it with the real
  lowerer. `tools/constraints.mjs` HARD-CODES the apply condition: `allow
  apply(settings)` must be exactly `only when mode == Configure &&
  stopped(station)` (rule kind `configureOnly`, constraints-v1; the parser
  error message says so verbatim). So the doc must keep the compilable
  form in ghost/text fences, and the live form is shown in a `ghost-draft`
  fence (outside the extractor's `ghost|text` alternation) labeled a
  future design example — the doc's own header convention. Changing the
  DSL = compiler change = out of scope for this doc issue (AGENTS.md:
  compiler+runtime change together; new milestone if wanted).
- Verified preconditions: the requirement catalog pins NO CONSTRAINTS.md
  locators (no re-anchoring needed); the config attribute syntax shown in
  the example is compiler-accepted (tests/operating-settings.test.mjs
  compiles exactly that form); the doc header already labels future design
  examples as such.
- Oracle (re-run, never assert): full 40-file node suite (expect 378/378;
  incl. the catalog validator) + `cargo test --locked --offline
  --workspace` (71/71; doc-only change but re-run per discipline).
- Delivery: branch `issue-110-live-settings-doc` -> PR to **dev** (NOT
  main — established this session), body references #110. MERGED (ce995c6); issue #110 still open (auto-close didn't trip) — pending user action.

## Backlog (unranked — user picks the task)
- Guard relaxation (line 235) for end-to-end `npm test` on Windows — one-line
  contract change, now evidence-backed
- WSL Ubuntu install → byte-identical POSIX `verification.json` evidence
- `.gitattributes` PR (repo-level CRLF pin) — unblocks clean Windows checkouts
  for everyone, not just this session
- Close issue #110 (work merged; auto-closer didn't trip on the reconciled merge)
- Delete now-merged remote branches: win32-host-compat, issue-110-live-settings-doc
- First real task: TBD by user
