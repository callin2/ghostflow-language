# GhostFlow Documentation Review — Findings Report

| | |
|---|---|
| **Repo / branch / commit** | `callin2/ghostflow-language` · `dev` @ `f809b4d` |
| **Date** | 2026-09-24 |
| **Reviewer** | OpenCode — 6 focused passes (A1 reference, A2 language-family/root, A3 technical/ABI, A4 research/tasks/tests-ref, A5 examples, + Windows feasibility probe) |
| **Host** | Windows (native, **no WSL**) — see §3 |
| **Ground truth** | Implementation source (`tools/*.mjs`, `crates/ghostflow-core/`, `runtimes/wasm/*`) + conformance tests. Canonical reference = `docs/LANGUAGE-REFERENCE.md` + `docs/reference/01-08` (Korean). |
| **Method** | Read-only. Doc claims cross-checked against implementation; runnable samples compile-checked with `node tools/ghostc.mjs --check`. **No files modified.** |

---

## 1. Scope

Reviewed **everything** in scope: `docs/LANGUAGE-REFERENCE.md`, `docs/reference/01-08` (canonical reference, Korean), the language-family and root docs (`LANGUAGE.md`, `language_faq.md`, `ProgrammingInGhostflow.md`, `TUTORIAL.md`, `LITERATE.md`, `README.md`, `AGENTS.md`, `PLAN.md`), the technical/ABI docs (`BYTECODE.md`, `EXACT-INTEGER-CONTRACT.md`, `IMPLEMENTATION.md`, `COMPILER-DIAGNOSTICS.md`, `LLM-TOOLCHAIN-ARCHITECTURE.md`, `SCAN-TAPE-PARITY.md`, `SCAN-FRAME-WASM.md`, `FRAMED-CONTROL-HOST.md`, `DESIGN-NOTES.md`, `LANGUAGE-SURFACE.md`, `LANGUAGE-MVP-0.1.md`, `TRACEABILITY.md`, `CONSTRAINTS.md`), `docs/research/GF-COMPOSE-R1..R9`, `tasks/*`, `tests/reference/*`, and every literate/plain example under `examples/` and `contracts/`.

**Focuses:** accuracy (claims vs implementation), consistency (across docs and within a doc), structure/navigation, completeness, clarity/style.

---

## 2. Executive summary

**51 findings: 7 Critical · 13 High · 21 Medium · 10 Low.**

| Category | Count |
|---|---|
| accuracy | 38 |
| structure-nav | 5 |
| consistency | 4 |
| completeness | 3 |
| clarity-style | 1 |
| **total** | **51** |

By area: A1 canonical reference **23** · A2 language-family/root **10** · A3 technical/ABI **8** · A4 research/tasks/tests-ref **8** · A5 examples+cross-cutting **2**.

### Two dominant root themes

**RC-1 — The reference leads the implementation.** The canonical reference documents trigger types, schedule bases, and rule forms the compiler does not yet accept. Concentrated in ch03 (schedules) and ch04 (constraints/strategy):
- ch03: `At` listed as a public trigger but **rejected** by the compiler (A1-001); `window(...)`/`range(...)`/`run(_, on_time)` bases documented but civil basis is `pulse`-only (A1-004); `cancel_when` shown on Daily but is Tide-only (A1-002); `.missed` shown on Daily but is Solar-only (A1-003); `hold_trusted`/`fixed_time` fallbacks not implemented (A1-005).
- ch04: `where` metadata predicate and presence-only strategy match documented but rejected (A1-017, A1-018); `monitor` target does not exist (A1-015); `allow enter` only accepts one fixed template (A1-016); PID `fault = degraded` / `restart … checkpoint` / `otherwise <branch>` not accepted (A1-019, A1-020, A1-021); `after_event` yields a non-executable descriptor (A1-023).

**RC-2 — Named-`constraints` syntax is split across three surfaces with no single authoritative grammar.** The reference §4.8 "for/at/set" form, the standalone `ghostrules` form (`CONSTRAINTS.md`, `examples/station-rules.ghost.md`), and the nested-in-control form (test cases) all differ; `exclusive` is shown two ways inside the reference itself; `warn` is accepted by no parser (A1-013, A1-014, A1-022, A3-05, A4-004).

### Positive results (verified clean)

- **Example corpus is clean.** All 30 "should-compile" examples compile; the 13 that fail do so for documented/intentional reasons (see §6). No genuine example bug found.
- **Reference ch02 (types/Int), ch05 (settings/observation), ch06 (composition/replay), ch08 (runtime/driver boundaries)** verified accurate against the implementation.
- **`BYTECODE.md`** opcodes 1–57 / type tags / envelope layout, **`COMPILER-DIAGNOSTICS.md`**, **`SCAN-TAPE-PARITY.md`**, **`LLM-TOOLCHAIN-ARCHITECTURE.md`** verified accurate (path/limit claims all match code).
- **`README.md`/`AGENTS.md`** links resolve; `TUTORIAL.md`, `LITERATE.md`, `LANGUAGE.md` samples all compile.

---

## 3. Windows host-gate feasibility (no WSL) — VERIFIED

The user specifically required confirming the **no-WSL native-Windows fallback** works. It does, with one caveat.

**The caveat (guard):** `tools/verify-language.mjs:330` hard-fails on Windows:
```js
if (process.platform === 'win32') throw new Error('retained native tutorial paths require a POSIX host (macOS/Linux)');
```
So the **orchestrated** `npm test` / `test:node` cannot run on Windows. This guard is orchestrator-only — the underlying gates run fine directly.

**Verified directly on native Windows (no WSL):**

| Gate | Command | Result |
|---|---|---|
| Reference query catalog | `node tools/reference-query.mjs catalog` | PASS |
| WASM build | `npm run build:wasm` | PASS (`ghostflow_wasm.wasm` sha256 `8ab366ade2…a118d`, 368617 B) |
| Product compiler | `node tools/ghostc.mjs <file> <out.gfb>` | PASS (fixture 234 B) |
| Native examples | debug + release | PASS |
| Rust workspace | `cargo test --locked --offline --workspace --jobs 1` | PASS |
| Node conformance (LF, release built) | `node --test` | **2222 pass / 57 fail / 175 todo** (2454 total) |

**CRLF note:** with `core.autocrlf=true` the clone was CRLF and 22 golden-hash tests failed; normalizing to LF (`git config core.autocrlf false; git rm -r --cached .; git reset --hard`) fixed them. The **57** remaining failures are (A) a Windows `C:\C:\…` doubled-drive path bug in a few suites, and (B) genuine `dev`-branch failures: `range-contract` (`cancel_when` rejected, `tools/control.mjs:49`), `reference-cli` REF-06-010 + `import-cli-digest` (`missing imported document ./relay.ghost.md in sourceClosure`), `ghostc-toon` (import-diagnostics), `reference-simulator` REF-03-024 (schedule-descriptor vs executable artifact).

**Conclusion:** the no-WSL fallback works for every individual gate. The only Windows-blocked path is the `verify-language` orchestrator (win32 guard), and there is **no documented no-WSL procedure** for running the full verification gate (see D-002).

---

## 4. Findings by area

Severity: Critical > High > Medium > Low. Category: `accuracy` / `consistency` / `structure-nav` / `completeness` / `clarity-style`. Evidence quotes the exact reference text and the exact implementation text/error that contradicts it.

### 4.1 A1 — Canonical reference (`docs/LANGUAGE-REFERENCE.md` + `reference/01-08`) — 23 findings

| ID | Sev | Cat | Location | Issue | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| A1-001 | Critical | accuracy | ref/03:246 | `At` listed as public trigger type | "공개 trigger 타입은 `At`, `Daily`, …" vs `control.mjs:853` `only Daily, DailySlots<15min>, Periodic, Cron, Solar and Tide … supported` (verified `schedule once: At{…}` rejected) | Remove `At` from the trigger list |
| A1-002 | Critical | accuracy | ref/03:274,394 | `cancel_when` shown as run/range-required; Daily example sets it | "cancel_when := Bool // run과 range에 필수"; civil option list has no `cancel_when` (`control.mjs:2149`); Tide-only (935, 2258–62); Daily rejects `unsupported schedule option cancel_when` | Mark `cancel_when` Tide-only; drop from Daily example |
| A1-003 | Critical | accuracy | ref/03:346,355 | `schedule_name.missed` shown as general Bool projection (Daily `morning.missed`) | "…`.missed`는 `Bool` 투영이다"; `.missed` exposed only on Solar (`control.mjs:2201`); Daily rejects `schedule morning does not expose .missed` | Restrict `.missed` to Solar or implement for civil |
| A1-004 | High | accuracy | ref/03:262-66,318,381-84,392 | basis grammar adds `window(...)`, `run(_,on_time)`, `range(...)`; example `range(10min)`; Window `.open` | civil basis is `pulse` only (`control.mjs:2162`); Tide allows only `run(_,within(_))` (2239–50); no `.open` handled (2926–58) | Align grammar/table with implemented forms |
| A1-005 | High | accuracy | ref/03:269,273 | `hold_trusted(d,terminal:skip)` clock & `fixed_time(…,terminal:skip)` Solar fallback documented | `control.mjs:2163` `choice('clock',['trusted_only'])`; `:2165` `choice('fallback',['skip'])`; Solar fallback must be `skip` (909–13) | Document only `trusted_only`/`skip` until implemented |
| A1-006 | High | accuracy | ref/01:164-69 | `limit`,`adapt`,`constraints`,`check`,`quote`,`instance`,`connect` called context words, "전역 예약하지 않는다" | all in KEYWORDS (`control.mjs:29–35`); `rejectName` (:1239) rejects them at every decl; `input limit: Bool;` → `input name limit is reserved` | List them as globally reserved, or relax the compiler |
| A1-007 | High | accuracy | ref/03:206-13 | example `let used = used(pump_applied, rolling(60s));` treats `used` as ordinary expression | resource-first file requires `constraints`/`resource_policy` (`control.mjs:343–45,384`); `used`/`rolling` exist only in constraints `limit` rules (796–822,1644–48); expression form → `unknown function used` (3272) | Rewrite as `constraints` `limit` rule per §3.10 (846–58) |
| A1-008 | Medium | accuracy | ref/01:140-44 | `parameter`,`resource`,`account`,`import` listed as reserved user-name words | not in KEYWORDS (`control.mjs:29–35`); act only as decl introducers, remain usable as names | Remove from reserved list or classify as context words |
| A1-009 | Medium | accuracy | ref/01:257 | timer grammar only `'timer' Id '=' 'elapsed' '(' Id ')' ';'` | `control.mjs:2714–15` `timer requires elapsed(state) or continuous_true(Bool)`; ch03:160 documents `continuous_true` | Add `continuous_true(Bool)` alternative |
| A1-010 | Medium | accuracy | ref/03:246 | `DailySlots<G>` implies arbitrary slot interval | `control.mjs:2065,900000 ms` `only DailySlots<15min> is supported` | State the 15-minute slot restriction |
| A1-011 | Low | accuracy | ref/01:258-60 | `require` grammar omits negated form; `mutex` shows bare name_list form | `control.mjs:1006` also accepts `require !expr;`; `:1015` requires parentheses for mutex | Add `!` alternative; keep only parenthesized mutex |
| A1-012 | Low | accuracy | ref/01:242 | `input_decl ::= 'input' name_list ':' type ';'` has no initializer | `control.mjs:621–22` parses optional `= expr` but silently ignores it for inputs (1676–79) | Document or reject the accepted-but-ignored initializer |
| A1-013 | Critical | accuracy | ref/04:479-89 vs control.mjs:473, constraints.mjs:137-41,162 | §4.8 block mixes two mutually exclusive grammars; neither parser accepts the whole block; `warn` accepted by none | named parser rejects `allow` (`unsupported named constraint allow`); standalone rejects `for` (`unexpected character ':'`) and `warn` (`unsupported constraint expression warn`); set-form `count_on({…})` rejected there | Split into named (for/at/set, control.mjs:450-78) vs standalone (CONSTRAINTS.md) forms; drop/gate `warn` |
| A1-014 | High | consistency | ref/04:480 vs 04:496 | reference shows two different `exclusive` notations as one rule | line 480 `exclusive at admission { automatic, manual, configuring };` vs table 496 `exclusive(a, b, ...)`; brace+stage at control.mjs:460-62, parens-only at constraints.mjs:179-83 | One notation per context; label which parser each belongs to |
| A1-015 | High | accuracy | ref/04:504 vs control.mjs:462,469 | "허용 target은 admission, safe_output, monitor" — `monitor` does not exist | `control.mjs:462` `exclusive stage must be admission`; `:469` `finite-set require stage must be safe_output`; no `monitor` in tools/ | List targets per rule kind; delete `monitor` |
| A1-016 | Medium | accuracy | ref/04:497 vs constraints.mjs:194-98 | `allow enter(M…) only when p` shown with general Bool premise; compiler accepts one fixed template | `constraints.mjs:194–98` requires exactly `only when mode == Stopped && stopped(station)` (`unsupported allow enter condition`); `allow` exists only in standalone parser | Document the fixed template, or extend the parser |
| A1-017 | Medium | accuracy | ref/04:397,419 vs control.mjs:1802 | `where` documented as selected strategy syntax with full semantics; compiler rejects it | `control.mjs:1802` `strategy where metadata predicates are not yet supported`; example 397 `where moisture.type == Percent` | Mark `where` deferred/not-yet-supported |
| A1-018 | Medium | accuracy | ref/04:418 vs control.mjs:1808 | "(moisture:sensor)처럼 type을 생략하면 존재만 검사한다" — presence-only match rejected | `control.mjs:1808` `presence-only strategy match … is not yet supported` | Document presence-only as deferred, or require the type |
| A1-019 | Medium | accuracy | ref/04:689,760 vs control.mjs:1949 | PID `fault` claimed to allow "degraded Name"; compiler allows only `disable` | `control.mjs:1949` `fault: choice(fields.fault, ['disable'], 'PID fault')`; example 689 `fault = degraded TemperatureFallback;` | State `fault = disable` only; reference §4.13 `degraded … for objective` |
| A1-020 | Low | accuracy | ref/04:762 vs control.mjs:1930-32 | `restart` "checkpoint" alternative not accepted | `control.mjs:1931` `PID restart requires reset(output: Percent)`; reference `reset(output: value) 또는 … checkpoint` | Drop `checkpoint` or implement it |
| A1-021 | Low | accuracy | ref/04:810 vs control.mjs:1074 | `otherwise` "disable 또는 완전한 branch" — parser accepts only `disable` | `control.mjs:1074` `otherwise must be disable or a complete branch`; a branch after `otherwise` is unparsable | State `otherwise disable` only, or parse the branch |
| A1-022 | Medium | accuracy | ref/07:104 vs constraints.mjs:162 | index row lists `warn` as a documented construct → ch4; no parser accepts it | `constraints.mjs:162` `unsupported constraint expression warn`; control.mjs:473 named form has no `warn`; ch04:488,502 document it | Remove `warn` from the index (and §4.8) or mark non-implementable |
| A1-023 | Medium | accuracy | ref/04:211 vs control.mjs:3654-74, ghostc.mjs:188-89 | `after_event` presented as selected public syntax; compiler emits only a non-executable temporal descriptor | `ghostc.mjs:188–89` `checked temporal descriptor artifact (not executable control)`; `control.mjs:2338–39` `The public compiler rejects this signal before bytecode emission` | Note the descriptor-only execution limitation in §4.4 |

**A1-CLEAN:** ch02 (types, Int/Number arithmetic & conversions, fault enums, physical quantities, precedence, window_rate) · ch03 Duration/date-time/cron5 literals, Periodic anchors, Tide `run(within)`+`cancel_when`, §3.10 constraints-`limit` form · ch01 fence extraction, intent anchors/links, removed-alias rejections, `next'` state form · ch05 settings/observation (config min/max/step/access/label, apply rejected, Int i32, Temperature/Date/Time step types, TimeSlots, displayUnit) · ch06 composition/replay (import/instance/connect grammar, cycle + duplicate-supplier rejection) · ch04 sensor contract §4.1-4.3/4.5 (median 1..31 odd, ema(0,1], hysteresis, debounce, window/hold_last, optional-sensor scope 04:380) · ch08 runtime/driver boundaries (sample epoch/id/timestamp/quality, report_applied).

### 4.2 A2 — Language-family + root docs — 10 findings

| ID | Sev | Cat | Location | Issue | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| A2-01 | Critical | accuracy | language_faq.md:456-61 (q11) | sample declares `let event`; `event` is reserved, so q11 does not compile | line 461 `let event = detected && !previous;`. Compiler exit 1: `let name event is reserved` (`event` in KEYWORDS control.mjs:29-35; check :1239) | Rename local, e.g. `rising`/`detected_rising` |
| A2-02 | Critical | accuracy | language_faq.md:523-35 (q13) | sample declares `input fault, reset`; `fault` is reserved, so q13 does not compile | line 525 `input fault, reset: Bool;`. exit 1: `input name fault is reserved` | Rename input, e.g. `input active, reset: Bool;` |
| A2-03 | High | accuracy | language_faq.md:864-73 (q22) | sample declares `config limit`; `limit` is reserved (constraint construct) | line 869 `config limit: Duration = 1h;`. exit 1: `config name limit is reserved` | Rename, e.g. `config max_use: Duration = 1h;`; update `used < limit` |
| A2-04 | High | accuracy | ProgrammingInGhostflow.md:727-37 (E14) | E14 reads an optional sensor directly in an output expression; optional sensors only readable inside a matching strategy | 730-36 `sensor moisture?: Percent; … request <- case moisture { ok(value)=>…; fault(_)=>false; }`. exit 1: `optional sensor moisture may only be read inside a strategy that matches it` (ref/04:380) | Wrap read in `adapt`/`strategy`, or mark as non-runnable fragment |
| A2-05 | High | accuracy | language_faq.md:1779-95 (q41) | documented LLM TOON `--request` command fails on its own example doc; plain `--check`/compile passes | 1782-85 `source: path: examples/scheduled-watering.ghost.md, …`. exit 1: `GF_SOURCE: state.phase has no literate intent-anchor provenance` (interaction-schema.mjs:121); file declares `state phase` (scheduled-watering.ghost.md:60) with no `<!-- ghostflow:anchor … -->` | Point TOON example at an anchored doc, add intent anchors, or note the anchor requirement |
| A2-06 | Medium | accuracy | language_faq.md:281-304 (q07) | q07 carries a full DailySlots policy and compiles to a **non-executable** schedule descriptor, though presented as a normal program | 285-96 `schedule starts: DailySlots<15min> { … fallback = skip; }`. exit 0: `checked schedule descriptor artifact (not executable control)`; control.mjs:3607 `compileScheduleDescriptorArtifact` → `{executable:false}` (Solar excluded) | Note full civil-schedule policies yield non-executable descriptors, while Solar yields executable control |
| A2-07 | Medium | accuracy | ProgrammingInGhostflow.md:616-46 (E09) | E09 (ScheduledPulse) has a full DailySlots policy → non-executable descriptor, yet shown as a runnable program with tick tables | 619-30 `schedule starts: DailySlots<15min> { … fallback = skip; }`. Compiler: `checked schedule descriptor artifact (not executable control)` (routing compile-source.mjs:103 → control.mjs:3607) | Same note as q07: type-checked schedule contract, not loadable bytecode |
| A2-08 | Medium | accuracy | language_faq.md:830-32 (q21) | snippet `on = day\`mon..fri\`;` does not compile; compiler accepts only holiday/workday/offday. Doc matches the reference, which leads the implementation | line 831 `on = day\`mon..fri\`;`. exit 1: `Daily day rule currently requires holiday, workday or offday`. Reference specifies the syntax (ref/03:691-92) | Keep syntax (reference authoritative); mark snippet pending compiler support |
| A2-09 | Low | structure-nav | language_faq.md:1288 | dead anchor: fragment `#pulse-window-run` does not exist; actual slug is `#pulse-window-run-range` | line 1288 `[Reference §3.5 Pulse, Window, Run](…#pulse-window-run)`; actual heading ref/03:376 `### Pulse, Window, Run, Range` | Change fragment to `#pulse-window-run-range` |
| A2-10 | Low | consistency | PLAN.md:5-6,57-61,74 | NOW/handoff section stale: claims branch `fix/mcu-deployment-blockers` @ `ce995c6` (PR #112); checkout is `dev` @ `f809b4d` (PR #130); win32 guard cited at :235, now :330 | line 5 `Branch: fix/mcu-deployment-blockers … ce995c6`. Actual `git branch` → `dev`; `git log -1` → `f809b4d Merge pull request #130`; guard at verify-language.mjs:330 | Refresh NOW section to current dev tip or move to a dated history entry |

**A2-CLEAN:** `LANGUAGE.md` (all samples compile, §13 limits match impl) · `LITERATE.md` (literate-irrigation compiles) · `TUTORIAL.md` (all four referenced samples compile; claims match `tutorial.mjs:30`, `verify-language.mjs:174-76`) · `language_faq.md` remaining samples (q01-q10, q12, q14-q20, q23-q33, q37-q40 all compile) · `ProgrammingInGhostflow.md` E01-E10, E12, E13 (compile; Appendix B error examples fail with exactly the documented diagnostics) · `README.md`, `AGENTS.md` (all relative links resolve).

### 4.3 A3 — Technical / ABI docs — 8 findings

| ID | Sev | Cat | Location | Issue | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| A3-01 | Critical | accuracy | EXACT-INTEGER-CONTRACT.md:6,17,22 vs gfb1.mjs:44-47, core lib.rs:59 | doc says Int is unimplemented; implementation fully supports Int i32 (formats 2–7) | doc "The current implementation has only `Bool` and `Number`" / "no integer type, integer conversion or remainder opcode" vs gfb1.mjs:44 `const TYPE = { bool: 1, number: 2, int: 3 }`, :47 `'int':23 … 'int-rem':29`; lib.rs:59 `Int(i32)` | Mark Int implemented; rewrite "current boundary" section |
| A3-02 | High | accuracy | EXACT-INTEGER-CONTRACT.md:184 vs gfb1.mjs:48-49 | N4 table allocates conversion opcodes 30–35; implementation uses 48–53 (30/31 are branch opcodes) | doc "30 INT_TO_NUMBER, 31 NUMBER_TO_INT_EXACT, 32 …FLOOR …" vs gfb1.mjs:48-49 `branchFalse:30, jump:31, 'int-to-number':48, 'int-exact':49, 'int-floor':50 … 'int-nearest-even':53` | Align table to implemented opcodes 48–53 |
| A3-03 | High | accuracy | EXACT-INTEGER-CONTRACT.md:186-88 vs ghostflow-package lib.rs:2415-16, portable-package.mjs:11 | doc claims v2 identities; code ships/pins v1, and v2 strings are rejected as unsupported | doc "`GhostFlow/runtime-semantics-v2`" / "`…framed-scan-abi-v2`" / "`…portable-package-v2`" vs lib.rs:2415-16 `…-v1`; portable-package.mjs:11 `PACKAGE_FORMAT = 'GhostFlow/portable-package-v1'` | Use v1 identities or note v2 as proposed, not implemented |
| A3-04 | High | accuracy | SCAN-FRAME-WASM.md:34 vs runtimes/wasm/framed_abi.rs:153-67 | scan-payload type list omits Int type tag 3 | doc "u8 type (1 Bool,2 Number), then u8 Bool … or f64 Number" vs framed_abi.rs:166-67 `3 => Value::Int(reader.i32()?)`, "input type must be bool (1), number (2), or Int (3)" | Add "3 Int (four-byte little-endian i32)" |
| A3-05 | High | consistency | CONSTRAINTS.md:46,117,237,289,298,334,632 vs control.mjs:450-78 | doc/examples use OLD standalone form; product compiler requires NEW `for` form (reference §4.8); forms split across tools | doc `constraints StationRules { exclusive(automatic, manual, configuring);` vs control.mjs:452 `this.expect('for', 'constraints requires for resource')`; verified `ghostc --check` rejects old form, `ghostrules --check` accepts it (1 group, 8 rules) | State which compiler accepts which form; align examples with §4.8 or label old form ghostrules-only |
| A3-06 | Medium | completeness | BYTECODE.md:21-26,46-68 vs gfb1.mjs:429,50 | format table stops at 4; opcode table omits 58/59 though producer/loader implement formats 5–7 | doc rows only "1…4", opcodes end at "57" vs gfb1.mjs:429 `objectives.length?7:hasTrueFors?6:hasSchedules?5:…`, :50 `'schedule-read':58, 'true-for-read':59`; lib.rs:174 `1\|2\|3\|4\|5\|6\|7` | Add formats 5 (solar), 6 (true_for), 7 (PID) and opcodes 58/59 |
| A3-07 | Medium | accuracy | IMPLEMENTATION.md:50-51 vs gfb1.mjs:429-30, control.mjs:1480,1744,2195 | artifact table claims current executable is "GFB1 envelope version 1" / `control-v1`; compiler now emits formats 1–7 and manifests v1–v4 | doc "`.gfb`, GFB1 envelope version 1" / "`GhostFlow/control-v1`" vs gfb1.mjs:430 `w.u16(format)`; control.mjs:1480 `format = 'GhostFlow/control-v4'`, :1744 v2, :2195 v3 | Describe feature-based format/manifest version selection |
| A3-08 | Medium | accuracy | FRAMED-CONTROL-HOST.md:13 vs runtimes/wasm/control-runtime.mjs:205-11 | doc claims `acceptSolar` opts into manifest v3; no such option exists — solar (v3) accepted unconditionally | doc "`acceptSettings` and `acceptSolar` opt into v2 and v3" vs control-runtime.mjs:205 `{ acceptSettings = false, … }`, :211 `manifest.format !== SOLAR_FORMAT` (no opt-in gate) | State v2 requires `acceptSettings`; v3/v4 always accepted |

**A3-CLEAN:** `BYTECODE.md` opcodes 1–57, type tags, envelope layout, blob/record limits, constraint records, query opcodes (match gfb1.mjs:44-50,430-38 and core lib.rs:29-34,2100-353, except A3-06) · `COMPILER-DIAGNOSTICS.md`/`SCAN-TAPE-PARITY.md`/`LLM-TOOLCHAIN-ARCHITECTURE.md` (envelope codes, 20-error cap, file paths, journal capacity, runner limits all match) · `SCAN-FRAME-WASM.md` (except line 34; lifecycle exports, budgets, outcome JSON match) · `TRACEABILITY.md`/`DESIGN-NOTES.md`/`LANGUAGE-MVP-0.1.md`/`LANGUAGE-SURFACE.md` (impl paths exist; both LANGUAGE-SURFACE examples pass `ghostc --check`).

### 4.4 A4 — Research (R1–R9) + tasks/ + tests/reference — 8 findings

| ID | Sev | Cat | Location | Issue | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| A4-001 | Medium | structure-nav | tests/reference/BASELINE.md:46-47,102-03,132-58 | all linked `build/` evidence artifacts are missing from the repo, so cited run evidence is unverifiable | `[reference-tests-baseline.json](../../build/reference-tests-baseline.json)`; all 28 referenced `build/*` files absent | Commit artifacts or mark links local-only, non-normative |
| A4-002 | Low | structure-nav | tests/reference/EDGE-CASES.md:80-82,148-50 | same dead `build/` links for edge-boundary and test-principles runs | `[전체 로그](../../build/edge-boundaries-full.log)` — file absent | same as A4-001 |
| A4-003 | Low | consistency | tests/reference/BASELINE.md:14-16,200-10 | path convention mixed: bare `build/…` spans vs `../../build/…` links; bare form resolves wrongly from tests/reference/ | `` `build/compiler-runtime-batch11-full.log` `` vs `[전체 로그](../../build/…)` | Unify to `../../build/` |
| A4-004 | Medium | accuracy | tests/reference/cases/02-time-control.json:646,785 | `constraints` block nested inside `control`; canonical examples show document-level placement | `control VolatileProtectiveLimit { … constraints InvalidBudget { limit used(…) } }` vs ref §3.10 `constraints PumpBudgets {` (03:852), §4.8 (04:479) | Align fixtures to reference examples or document placement rule |
| A4-005 | Medium | accuracy | docs/research/GF-COMPOSE-R5-CONTRACTS.md:24-26 | R5 lists `allow(enter/apply)` as currently accepted, but reference supersedes the `allow apply` form with no note in R5 | R5 "accepts … `allow(enter/apply)`"; ref 04:612-14 "이전 계약의 `allow apply(settings) … 대체된다" | Mark `allow apply` as superseded legacy in R5 |
| A4-006 | Low | completeness | tests/reference/cases/02-time-control.json (ch03 cases) | no case exercises documented `At` trigger, `window(…)` basis, or `.missed` projection | ref 03:246 "공개 trigger 타입은 `At`"; 03:263 `window(positive Duration)`; 03:346 `schedule_name.missed` — 0 matching cases | add At/window/missed boundary cases |
| A4-007 | Low | clarity-style | tests/reference/DECISIONS.md:8 | link text shows a relative path that doesn't resolve; only the URL is correct | `[../LANGUAGE-REFERENCE.md](<../../docs/LANGUAGE-REFERENCE.md#10-…>)` | use `docs/LANGUAGE-REFERENCE.md §10` as text |
| A4-008 | Low | structure-nav | docs/research/GF-COMPOSE-R3:57, R5:19 | sibling R-notes reference each other by bare name only; only the index links all nine files | R3 "R2 fixes the source/instance distinction"; index BEHAVIOR-COMPOSITION-RESEARCH.md:105-13 is sole cross-link | add markdown links between R-notes and to index |

**A4-CLEAN:** tests/reference chapter 04–08 case coverage (README:56-60 mapping satisfied — the 4 case files hold REF-03×75/04×72/05×36/06×32/07×10/08×17; runner `reference-cli.test.mjs:14-17` reads exactly these four) · research notes old-form `constraints` / undocumented schedule-trigger accuracy (no function-call `exclusive(…)`, no dotted `count_on(pump.valves)`, no undocumented `At(…)` trigger; `cancel_when` only on `run` basis as ref 03:274 allows; all R2/R3/R5 tool/contract/doc link targets exist).

### 4.5 A5 — Literate examples + cross-cutting — 2 findings

The example corpus itself is **clean** — see §6. The two cross-cutting findings:

| ID | Sev | Cat | Location | Issue | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| D-001 | Low | structure-nav | examples/*.ghost (7 files) vs examples/*.ghost.md | repo ships 7 plain `.ghost` files that `ghostc` refuses; they sit beside compilable `.ghost.md` twins, with no doc stating which is the canonical compilable source | `ghostc` on each `.ghost`: `GhostFlow product compilation requires a canonical .ghost.md literate source`; `examples/station-rules.ghost:1` `// HISTORICAL NON-EXECUTABLE EVIDENCE. Canonical source: station-rules.ghost.md.` | Mark `.ghost` as historical/derived, or state in AGENTS/README that `.ghost.md` is the compilable source |
| D-002 | Medium | completeness | tools/verify-language.mjs:330 (+ AGENTS/README) | no documented Windows (no-WSL) procedure to run the full verification gate; the win32 guard blocks `npm test`/`test:node` | `if (process.platform === 'win32') throw new Error('retained native tutorial paths require a POSIX host (macOS/Linux)')`; direct gate invocation verified to work (2222/2454 node pass, `cargo --jobs 1` pass, WASM builds) | Document the no-WSL gate path, or relax/scope the guard |

---

## 5. Cross-cutting root issues (consolidated)

- **RC-1 Reference-ahead-of-compiler** — A1-001, A1-002, A1-003, A1-004, A1-005, A1-015, A1-016, A1-017, A1-018, A1-019, A1-020, A1-021, A1-023, A2-08. *Recommendation: add a "status" marker to reference entries (implemented / design / deferred), or gate the reference to the implemented subset, so the reference and the compiler never silently disagree.*
- **RC-2 Named-`constraints` syntax split** — A1-013, A1-014, A1-022, A3-05, A4-004. Three grammars (reference §4.8 "for/at/set", standalone `ghostrules`, nested-in-control) with no single authoritative source; `exclusive` shown two ways; `warn` accepted by no parser. *Recommendation: pick the reference §4.8 form as canonical, make `CONSTRAINTS.md`/`station-rules.ghost.md`/test cases match it (or explicitly label the standalone form), remove `warn` or implement it, and document which lowerer accepts which form.*
- **RC-3 Reserved-identifier documentation contradictions** — A1-006, A1-008, A2-01, A2-02, A2-03. The reference under-states the reserved set (`limit/adapt/constraints/check/…` are actually globally reserved) and over-states it (`parameter/resource/account/import` are not reserved), while three FAQ samples use `event`/`fault`/`limit` and fail to compile. *Recommendation: publish the exact reserved set in ch01 and fix the three FAQ samples.*
- **RC-4 Stale version / format / identity claims** — A3-01, A3-02, A3-03, A3-06, A3-07, A3-08. Int support, opcode numbers, v1-vs-v2 identities, and format/manifest version selection are all out of date relative to `tools/gfb1.mjs` and the runtime. *Recommendation: regenerate the technical docs from the implementation (or add a "generated from code" note + a drift test).*
- **RC-5 Non-executable descriptor artifacts presented as runnable** — A2-06, A2-07, A1-023. Full civil-schedule policies and `after_event` compile to type-checked descriptors, not loadable bytecode, yet are shown as running programs. *Recommendation: state the descriptor-vs-bytecode distinction where such examples appear.*

---

## 6. Literate example corpus — compile-check result (positive)

All 43 `.ghost`/`.ghost.md` files under `examples/` and `contracts/` were compile-checked with `node tools/ghostc.mjs --check`. **30 pass; 13 fail, all for documented/intentional reasons — no genuine example bug.**

| Group | Files | Reason for failure (by design) |
|---|---|---|
| Intentional broken "before" fixtures | `authoring/corpus/{setting,type,typo}-initial`, `unsupported-syntax` (4) | deliberate error corpus; their `-corrected`/`valid-control` twins pass |
| Plain `.ghost` (non-literate) | `irrigation`, `scheduled-watering`, `station-rules`, `tutorial/01-04` (7) | `ghostc` requires a canonical `.ghost.md` literate source; the `.ghost.md` twins pass |
| Intentional broken revision | `authoring/pump-rev-1` (1) | `pump <- start && ;` — incomplete expression; `pump-rev-2` is the fix |
| Standalone `ghostrules` doc | `station-rules.ghost.md` (1) | OLD standalone `constraints` form (no `for`); compiled by `ghostrules`/`compileConstraints`, not `ghostc` (see A3-05) |

All 6 `contracts/interaction-v0/examples/*.ghost.md` and all 10 `curriculum/*.ghost.md` compile. The 30 that should compile **all** compile.

---

## 7. Priority fixes (top 10)

1. **A1-001 / A1-002 / A1-003 / A1-004** — fix ch03 schedule claims (`At`, `cancel_when`, `.missed`, `window`/`range`/`on_time` bases) to match `tools/control.mjs`, or mark them design-only. *(Critical/High, canonical reference)*
2. **A1-013 / A1-014 / A3-05** — resolve the named-`constraints` grammar split; make §4.8, `CONSTRAINTS.md`, `station-rules.ghost.md`, and test cases one consistent form; drop or implement `warn`. *(Critical/High)*
3. **A2-01 / A2-02 / A2-03** — fix the three FAQ samples that fail to compile on reserved names (`event`, `fault`, `limit`). *(Critical/High, user-facing)*
4. **A3-01 / A3-02 / A3-03** — rewrite `EXACT-INTEGER-CONTRACT.md` (Int is implemented; conversion opcodes are 48–53; identities are v1). *(Critical/High)*
5. **A1-006 / A1-008** — publish the exact reserved-identifier set in ch01. *(High)*
6. **A1-015 / A1-017 / A1-018 / A1-019 / A1-020 / A1-021** — align ch04 constraint/strategy/PID forms with the compiler (remove `monitor`; mark `where`/presence-only/PID-alternatives deferred). *(High/Medium)*
7. **A2-04 / A2-05** — fix E14 optional-sensor read scope and the TOON `--request` anchor-provenance example. *(High)*
8. **A3-04 / A3-06 / A3-07 / A3-08** — update `SCAN-FRAME-WASM.md` (Int tag), `BYTECODE.md` (formats 5–7, opcodes 58/59), `IMPLEMENTATION.md` (manifest v1–v4), `FRAMED-CONTROL-HOST.md` (v3/v4 acceptance). *(High/Medium)*
9. **A2-06 / A2-07 / A1-023** — state the non-executable-descriptor distinction for full civil schedules and `after_event`. *(Medium)*
10. **A4-001 / A4-002 / D-002** — restore or mark the missing `build/` evidence links, and document the no-WSL Windows gate path. *(Medium/Low)*

---

## Appendix — Method & ground-truth provenance

- **Clone:** `gh repo clone` `dev` (depth 1) @ `f809b4d`; `npm ci --ignore-scripts`.
- **Line endings:** normalized to LF (`core.autocrlf=false`) to match the committed golden hashes; CRLF caused 22 spurious golden-hash failures.
- **WASM ground truth:** `ghostflow_wasm.wasm` sha256 `8ab366ade2ceceb779f8e55aceab860995409007a83177e3c1d5a8b0c25a118d` (368617 B).
- **Node conformance (Windows, LF, release built):** 2454 total → 2222 pass / 57 fail / 175 todo / 17 files. Failure log: `build/node-test-all3.log`.
- **Headline claims independently re-verified by direct source read:** `tools/control.mjs:853` (supported schedule kinds, no `At`), `tools/gfb1.mjs:44-50` (`int:3`, Int opcodes 23–29 & 48–53, opcodes 58/59), `tools/control.mjs:452` (`constraints requires for resource`).
- **No files were created or modified** except this report (`DOCS-REVIEW-REPORT.md`).
