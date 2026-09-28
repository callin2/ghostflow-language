<!-- translation-source: tasks/reference-compliance-plan.md -->

[Korean original](reference-compliance-plan.md)

# GhostFlow Reference compliance implementation plan

## Goal and completion criteria

### Latest user policy decisions

All three questions marked unresolved in the historical progress records below have been answered.
`true_for` recognizes only continuous intervals whose actual observations are guaranteed by the Driver;
it does not estimate between measurements. `after_event` tracks each start event independently
and distinguishes results. If multiple occurrences of the same schedule pass within one observation interval,
record all as missed and execute none. Proceed with TDD based on `temporal-policy-decisions.md`
and Reference §3.5/§4.4. Settled policies do not mean completed implementation.

The goal is for compiler and runtime to implement the entire Language Reference contract and leave observable evidence. The current baseline is the last full gate below. Preserve earlier execution history in `tests/reference/BASELINE.md`.

The user explicitly included runtime in completion scope. Verify actual Rust/native/WASM execution semantics together with repository host adapter contracts.

- Last batch16 gate: of 2,139 Node cases, 1,947 pass, 28 fail, 164 TODO, 0 skip; of 204 Reference executable cases, 177 pass and 27 fail, with the same failure IDs as batch15. Rust core 160, native package 28, and WASM ABI 10 passed, and native/WASM artifacts were regenerated. Tutorials did not run because the Node gate failed. Evidence: `build/compiler-runtime-batch16-reference-results.json`, `build/compiler-runtime-batch16-full.log`, `build/compiler-runtime-batch16-verification.json`. Source hashes matched at gate completion, but subsequent version fixture and Reference policy changes mean no claim of current hash correspondence. GFB5 structural slice evidence: core 160, native 12, encoder 8 + affected 44, browser 3, cross-language native 4, catalog 5; logs `build/schedule-core-green.log`, `build/gfb5-encoder-affected.log`, `build/gfb5-browser-green.log`, `build/gfb5-native-green.log`, `build/gfb5-catalog.log`. Current diagnostic catalog is 687 cases; canonical lowering, schedule execution, providers/resources and replay remain pending.

- Last batch15 gate: of 2,114 Node cases, 1,923 pass, 27 fail, 164 TODO, 0 skip; of 204 Reference executable cases, 177 pass and 27 fail. The 27 failure IDs match batch14; there are no new regressions. Rust core 142, native package 28, and WASM ABI 10 passed, and native/WASM artifacts were regenerated. Tutorials did not run because the Node gate failed. Evidence: `build/compiler-runtime-batch15-reference-results.json`, `build/compiler-runtime-batch15-full.log`, `build/compiler-runtime-batch15-verification.json`. After completion, all verification source hashes matched the then-current source.
- The 164 specified cases are not CLI execution tests. Some existing execution evidence is linked in `reference-evidence.md`; complete mapping and verification remain unfinished.
- Batch13 includes native package/framed CLI and measurement-based nested windows. It implements nested compiler/encoder support, original timestamps, independent aggregation weights, owned proofs, full upstream highwater, epoch invalidation, memory bounds, and Rust replay. Six absolute-value/expiry/delay/conversion provenance cases also passed on both WASM hosts. This evidence does not establish completion of all temporal operations or durable migration.
- Batch14 includes separate temporal ghost replay preserving originals and both WASM adapter APIs. It reproduces the current program's records, checkpoints, nested proofs, and frame IDs; 1,024 retained-record rollover and retry verification passed. Batch15 added static resource plans before activation and independent wasm32 oracle checks of C/C−1 and N/N−1 activation/replay boundaries. Native/WASM state/timer checks with long tick intervals also passed. Remaining schedule/control/composition contracts are next. `true_for` and `after_event` policies are settled in `temporal-policy-decisions.md`, but implementation evidence remains to be produced. Estimated evidence, durable migration, and full §6.8 branch identity/what-if also remain.
- Catalog location corrections added after batch13, and both WASM hosts' late-error/same-sample retry tests, were included in the subsequent batch14/15 full gates. Earlier focused evidence remains in `build/window-derived-catalog-fix.log` and `build/window-derived-host-retry.log`.
- Six additional diagnostic tests passed: four parser callsite cases and two nested-window byte-limit cases. The diagnostic/boundary catalog has 687 cases. [Temporal adapter replay](temporal-adapter-replay-design.md) was delivered through Astra core/ABI, Sol JS adapter/actual WASM tests, Luna documentation, and root integration/verification; focused checks and the batch14 gate passed.
- After batch15: fixed DailySlots accepting duplicate `timezone`/`selected`. Luna's four RED cases became five GREEN cases covering exact error kinds/messages/original locations and a valid control; root's 231 related regressions passed. The diagnostic catalog has 683 cases. Evidence: `build/compiler-schedule-duplicates-red.log`, `build/compiler-schedule-duplicates.log`, `build/schedule-duplicates-regression.log`. The full gate was not rerun; batch15 hashes are evidence for source before this change.
- The next implementation is Rust-owned Solar pulse admission. Sol/Astra audit found that current native/WASM parity only replays a JS-generated due bit and does not prove Rust schedule evaluation/rollback. Connect explicit clock/gap/recovery, compiled `when`, provider facts, owned observations, and replay to actual Runtime transactions. Multiple-occurrence policy is settled in `temporal-policy-decisions.md`; implementation evidence remains.
- Clock component: Sol's six trusted-only `ScheduleClockGate` focused cases and root's full 148-case core suite passed. Only catalog locators for the same core tests moved by Luna changed; five catalog cases also passed. Scope and evidence are in `tasks/schedule-clock-design.md`. It is not yet connected to source schedules, VM transactions, or WASM ABI, so do not count it as fewer Reference failures or completed schedules. Source SHA insertion in the wire draft conflicted with the contract that comment changes leave GFB unchanged and was removed. Retain source identity in verified external activation metadata.

Declare completion only when all three conditions are met.

1. Every executable case passes actual `ghostc --check` and build paths.
2. The 141 internally implemented specified cases link to independent execution tests in the compiler, core, WASM runtime, or repository host adapters.
3. The 23 external boundaries separate Driver, renderer, and deployment/provider responsibilities from language execution success, and audit input/output/identity/quality/revision evidence contracts.

Making only the remaining CLI failures green does not establish full Reference compliance. Compilation success does not prove runtime semantics, physical application, or UI presentation.

## Implementation principles

- Canonical sources are `docs/reference/*.md` and `tests/reference/cases/*.json`. Do not lower expectations to fit current implementation.
- Limit each slice to a vertical path of three to five files where possible. Complete parser/typecheck, manifest, runtime, and actual observation tests together.
- Reuse existing implementations first: `tools/control.mjs`, `tools/gfb1.mjs`, `tools/source-trace.mjs`, `runtimes/wasm/control-runtime.mjs`, and signal, scan, station, and solar modules in `crates/ghostflow-core`.
- Fault ticks must atomically preserve state, intent, timers, controller/resource state, and journal positions.
- Native/WASM parity giving the same wrong answer is insufficient. Compare each backend against Reference absolute expectations.
- Verify source document/revision, bytecode digest, and node/dependency provenance after optimization, lowering, and restore too.
- Refresh the baseline once after ongoing agents' changes merge. Do not use the old list of 44 as the unchanged work queue.

## Dependency structure

```text
Reference grammar and semantic types
    -> parser/type checker and bounded resource report
        -> manifest and source-trace contracts
            -> GFB verifier/lowering
                -> Rust core state machines
                    -> native/WASM adapters
                        -> host settings/provider/binding contracts
                            -> Driver/UI boundary evidence
```

Shared-file conflict rules:

- Only one agent edits each declaration family in `tools/control.mjs`.
- The GFB format owner serializes `tools/gfb1.mjs`, `crates/ghostflow-core/src/lib.rs`, and WASM artifact rebuilds. Coordinate scan changes together if needed.
- Change the `runtimes/wasm/control-runtime.mjs` manifest schema in the same slice as the compiler manifest producer.
- Regenerate native and WASM release artifacts only once after the core change batch.

## Current progress

| Slice | Status | Owner/difficulty | Conflict boundary |
|---|---|---|---|
| GFB short circuit and `MIN % -1` | Batch3 passed, including compact constant encoding and PC10 execution | Astra / high | Exclusive ownership of `tools/gfb1.mjs`, `lib.rs`, GFB format and artifact rebuilds |
| Duration boundaries and sensor recovery fault state | Batch3 passed | Luna / medium | Reuse Duration lexer/type blocks and `signals.rs` results |
| `moving_average` compiler→manifest→actual WASM | 14 host and two related Reference focused cases passed; batch3 evidence preserved | Luna / medium-low | EMA slice takes over completed sensor changes |
| EMA compiler→manifest→actual WASM | Batch3 Number/Percent and extreme-value regression evidence; Temperature connection belongs to quantity slice | Sol / medium | Sensor filters and host sensor validation |
| Dynamic Int conversions | Batch3 passed, including native/WASM conversions, faults, and rollback | Astra / high | GFB3 opcodes 48–53, stable faults and atomic rollback |
| Dynamic Duration arithmetic | Source/guard connection completed; batch3 passed | Astra core + Sol source | Connect source typed arithmetic and GFB3 guards together |
| Quantity catalog/type/runtime | Slice complete; batch3 evidence preserved | Sol / high; Astra numerical review | Correspondence of source/unit metadata across all public consumers |
| Tagged time literals | Compiler/runtime connected; batch4 passed | Sol source + Astra package + Luna helper tests | Separate from full Reference completion |
| Result values and transforms | Batch6/7 focused compiler/runtime/provenance evidence; native Rust package canonical replay caveat remains | Sol compiler/host + Astra core | [Execution record contract](result-provenance-design.md), source metadata and GFB3 opcode56 |
| Debounce Bool/finite enum/Result | Batch7 passed; per-sensor deduplication, actual native/WASM, replay and artifact verification | Sol compiler/host, Astra Rust/code size, Luna diagnostics, root provenance | [Contract and remaining boundaries](debounce-design.md), [scan transaction](sensor-atomicity-design.md); durable reboot and native package canonical source caveats remain |
| Measured hold_last | Batch9 compiler/native/both WASM, Held provenance, TTL, future/dedup/epoch/rollback/replay and signed artifact checks passed | Sol compiler/tests, Astra package/code size, Luna provenance, root integration | [Verification and remaining boundaries](hold-last-design.md); estimated quality and durable continuity restore remain |
| Int operating settings | Batch10 compiler/manifest/interaction descriptor and signed32 boundary evidence passed; atomic LIVE §5.2 unimplemented | Sol compiler/host + root integration | Native package source/default correspondence remains unproved |
| Temporal Rust foundation | Seven Rust unit and six oracle tests passed; compiler/GFB/WASM ABI integration remains unfinished | Astra core | [Window evidence design](window-evidence-design.md) |

## Feature groups for the 27 remaining CLI cases

| Group | Case counts and IDs | Required implementation | Existing reuse | Observable acceptance | Dependencies / difficulty |
|---|---|---|---|---|---|
| Schedule/provider/accounting syntax | 11: `REF-03-024`, `032`, `036`, `038`, `042`, `045`, `050`, `057`, `059`, `060`, `062` | Common schedule policies, DailySlots/Periodic/Cron/Solar/Tide, TimeSlots, WorkCalendar, resource/event/account syntax and typed conditions | Schedule/solar host adapters, station ledger, occurrence trace, source trace | Manifest preserves all mandatory policies and provider identities; actual crossing/gap/DST/provider vectors match absolute results | Date/time, settings, provider contracts / high |
| Bounded signals and temporal evidence | 2: `REF-04-025`, `026` | true-for/after-event; improve replay and bounded-state evidence for window aggregates/rates | Rust signals, continuous timer, source dependencies, ControlRuntime conditioner | Verify half-open boundaries, sparse/missed scans, fault reset, checkpoints and memory bounds in actual WASM | Duration/quantity/Result / medium–high |
| Capability/constraint/resource/control | 7: `REF-04-035`, `044`, `045`, `050`, `058`, `061`, `063` | Option capability match, constraint phases, finite-set aggregation, arbitration policies, objective/degraded/adaptation descriptors | Constraint fixpoint, station resource manager, operating settings, interaction schema | Requested/safe/applied separation, unique winner, atomic reservations, no global-constraint bypass, proposal-only adaptation | Quantity, Result, settings / high |
| Import/composition/macro | 7: `REF-06-010`, `023`, `101`, `102`, `103`, `105`, `106` | Pinned document closure, digest verification, instance/typed-port graphs, typed quote/splice expansion limits | Literate extractor, toolchain digest binding, portable package verifier | Digest/revision tamper rejection, duplicate provider rejection, ordinary checker after typed expansion, recursion/limit rejection | Source identity contract / high |

The total is 27 cases. `REF-04-020` passed in batch7, `REF-04-031` in batch9, and window `REF-04-027`/`028`/`029` by batch13, removing them from the CLI failure queue. Distinguish CLI passes from remaining runtime acceptance.

## Implementation-boundary audit for 164 specified cases

### Classification results

| Classification | Count | Treatment |
|---|---:|---|
| compiler/tooling | 22 | Produce execution evidence through compiler, source trace, package/restore tests |
| core/runtime | 93 | Produce execution evidence through Rust/native/WASM absolute results and state/journal observation |
| repository host adapter | 26 | Produce execution evidence through deterministic schedule/settings/capability/provider adapter contract tests |
| External Driver | 7 | Audit application/confirmation/wiring evidence contracts. Language runtime success cannot substitute |
| External renderer | 3 | Audit descriptor-based read/write permissions and identical validation semantics |
| design boundary | 7 | Architecture audit for unintended mixing of new keyword/graph/effect scopes |
| External host/deployment/provider | 6 | Audit OS, durable storage, provider coverage, and installation binding evidence |
| **Total** | **164** | 141 internal implementations, 23 external boundary audits |

The exact list of 23 external boundaries follows. The other 141 specified cases require repository-internal execution evidence.

- Driver 7: `REF-00-002`, `REF-04-010`, `REF-04-043`, `REF-04-053`, `REF-06-005`, `REF-06-006`, `REF-08-010`
- Renderer 3: `REF-00-009`, `REF-05-019`, `REF-05-020`
- Design 7: `REF-01-003`, `REF-01-055`, `REF-03-018`, `REF-06-001`, `REF-06-024`, `REF-08-001`, `REF-08-006`
- External host/deployment/provider 6: `REF-06-018`, `REF-08-003`, `REF-08-004`, `REF-08-008`, `REF-08-013`, `REF-08-016`

### Internal implementation feature groups

| Group | specified basis | Implementation location and acceptance | Difficulty |
|---|---|---|---|
| source/provenance/toolchain | `REF-00-001`; `REF-01-004,017,018`; `REF-04-067`; `REF-05-028`; tooling scope `REF-06-003,007,011,015,025`, `REF-07-001,002,006-010`, `REF-08-002,005,011,017` | Verify document/artifact digests, node identity, dependency reads and explanation links through tamper tests | Medium |
| Exact arithmetic and tick semantics | `REF-01-062-064,067,079,080,086,093,094,098,099,102-105`; `REF-07-003-005` | Native/WASM absolute values, short-circuiting, old snapshots, rejected-tick state/intent/tick/journal atomicity | High |
| Sensor Result and bounded filtering | `REF-00-007`; `REF-01-074,075,077`; `REF-04-003,005,011,012,016,019,023,024,030,032,065`; `REF-08-012` | Actual WASM sample identity, N-1/N, exact stale boundaries, recovery NotReady, quality provenance, instance isolation | Medium |
| Timer/rolling/schedule semantics | `REF-00-006`; `REF-03-009,013,014,016,017,019-023,026,027,029,030,035,039,040,048,049`; internal host `REF-03-010,025,028,031,037,041,047` | Observe monotonic snapshots, half-open occurrences, gap/rollback/DST, stable event IDs and ledger splitting/reservations through traces | High |
| Capabilities/constraints/resources/modes | `REF-00-008`; `REF-04-034,036,038,039,042,046-052,055-057,060,062`; internal host `REF-04-054,064,066` | Unique strategy, false-only fixpoint, single final writer, stop sequence, accounting stages, atomic settings/adaptation | High |
| Settings/observation | `REF-05-012-018,021-028,103-107`; `REF-08-009,014,015` | Revision/effective positions, atomic batches, overlay expiry, reboot/run boundaries, snapshot/event/alarm/explanation identity | Medium |
| Composition/replay/replacement | `REF-00-004,010`; `REF-06-002,004,008,009,012-017,019-022`; `REF-08-007` | Instance isolation, graph writer validation, same-core replay, no invented input, atomic hot swap and state migration | High |

Link each group's catalog IDs one-to-one with actual test names or evidence manifests. If existing tests already prove the semantics, add only the ID link rather than duplicate tests.

## Implementation phases

### Phase 0: Integrate ongoing work and rebaseline

**Description:** Recalculate actual remaining cases at the same revision containing merged short circuit/Int, Duration/sensor recovery, and moving average changes.

**Acceptance:**

- Separate Reference pass/fail IDs from non-Reference test failures.
- Do not promote focused results to full-gate results.
- Group new failures by root cause, separately from leaf failure counts.

**Verification:** One `npm test`. If changes follow failure analysis, run only affected focused tests and schedule the final integration gate.

### Phase 1: Scalar semantics and GFB execution foundations

**Description:** First establish short-circuiting, exact Int, Date/Time, quantity constants and Result value representation.

**Acceptance:**

- Native/WASM each satisfy Reference absolute values and faults.
- The verifier rejects invalid opcode/type/stack shapes before load.
- Lowering and restore preserve all source dependencies.

**Dependencies:** Phase 0. **Difficulty:** High. **Model:** Mainly Astra; Sol for bounded parser slices.

### Phase 2: Bounded signal vertical slices

**Description:** Connect moving average, EMA, debounce, Result transforms and temporal evidence individually through compiler→manifest→actual WASM.

**Acceptance:**

- Each stateful operation exposes its memory bound and private state ownership in manifest/resource reports.
- State transitions on faults, duplicate samples, repeated ticks and rejected ticks match the Reference.
- Compiler acceptance and runtime semantics are observed in the same test slice.

**Dependencies:** Phase 1 Duration/Result types. **Difficulty:** Medium–high. **Model:** Luna for existing-engine connections; Sol for debounce/Result integration.

### Phase 3: Schedules and accounting

**Description:** Establish common schedule policies as one descriptor contract, then extend through DailySlots, Periodic, Cron, Solar, calendars and tides.

**Acceptance:**

- All schedules produce stable schedule/occurrence/provider revision identities.
- Crossing, gap, rollback, DST, fallback and live-update results produce identical absolute traces on native/WASM/host.
- Resource/event/accounting do not confuse requested/safe/applied/confirmed stages.

**Dependencies:** Date/Time, settings events, ledger. **Difficulty:** High. **Model:** Astra.

### Phase 4: Constraints, resources and continuous control

**Description:** Connect capability match, constraint phases, arbitration, mode transitions and objective/fallback/adaptation to the existing station core and interaction schema.

**Acceptance:**

- Same-tick requests reserve from one snapshot; only a unique final writer commits safe targets.
- Controller/resource/settings state are all atomic on rejected ticks.
- Explanations separate request, clamp, arbitration and applied/confirmed evidence.

**Dependencies:** Quantity, Result, settings, accounting. **Difficulty:** High. **Model:** Astra.

### Phase 5: Imports, composition and macros

**Description:** Implement pinned closures and typed graphs first, then expand bounded quote/splice before the ordinary checker.

**Acceptance:**

- Reject exact revision/digest mismatches and duplicate writers/providers with deterministic diagnostics.
- Isolate state/timers/settings/bindings/provenance per instance.
- Macro expansion does not bypass type checking, recursion bounds or AST/resource bounds.

**Dependencies:** Stable type/manifest/source identity. **Difficulty:** High. **Model:** Astra.

### Phase 6: Settings, observation, replay and hot replacement

**Description:** Integrate existing operating settings, temporary overlays, interaction snapshots, replay and hot swap code with the Reference identity model.

**Acceptance:**

- Batch settings/expiry/revert are atomic revision events; stale expiry does not overwrite new values.
- Replay invents neither unrecorded values nor physical effects.
- Failed hot replacement retains the previous Program; successful replacement creates new artifact identity and run boundaries.

**Dependencies:** Descriptor stabilization across Phases 1–5. **Difficulty:** Medium–high. **Model:** Sol; Astra reviews migration core.

### Phase 7: External boundary audit

**Description:** Verify repository-required evidence schemas and responsibilities for the 23 external cases. Compiler success does not certify actual device operation or UI renderers.

**Acceptance:**

- Driver contracts separate requested, applied, confirmed, quality, stop proof and physical endpoint evidence.
- Renderer contracts neither change descriptor type/authority/validation nor create write permissions.
- Provider/deployment contracts specify revision, coverage, failure, durable identity and offline operability.

**Dependencies:** Stable internal manifests and observation schemas. **Difficulty:** Medium. **Model:** Sol audit; actual hardware acceptance belongs to the user's environment.

### Phase 8: Final acceptance

**Acceptance:**

- All executable cases pass.
- All 141 internal specified cases have execution test/evidence links.
- All 23 external cases have boundary audit results and reasons for nonexecution or actual environmental evidence.
- No missing/duplicate catalog IDs or stale locators.
- Native/WASM artifacts are regenerated from the same source revision and full `npm test` passes.

## First three bounded implementation scopes

### Slice A — Moving average vertical path (in progress)

**File ownership:**

- `tools/control.mjs`: sensor filter parser/type/range and manifest producer
- `runtimes/wasm/control-runtime.mjs`: manifest validator and conditioner config forwarding
- One existing sensor host test: actual ControlRuntime WASM N-1/N/N+1 and 0/even/out-of-range

**Acceptance:** `REF-04-021`, `REF-04-068`; check compiler accept/reject and actual WASM sliding averages together. Reuse Rust `Filter::MovingAverage` unchanged.

### Slice B — EMA vertical path (Sol candidate immediately after Slice A)

**File ownership:**

- `tools/control.mjs`: `ema(alpha:)` constant/range typing and manifest fields
- `runtimes/wasm/control-runtime.mjs`: EMA manifest validation and alpha forwarding
- One existing sensor host test: first-sample seed, alpha boundaries, NotReady before recovery

**Acceptance:** `REF-04-022`; verify rejection of alpha `0`, `>1`, and nonfinite values, and actual WASM recurrence against absolute values. Shared files with Slice A preclude parallel execution.

### Slice C — Debounce Bool/finite enum/Result (batch7 complete)

**File ownership:**

- `tools/control.mjs`: declaration typing, positive Duration, generated private state/clock descriptors
- Lower with existing GFB operations. Use five common states plus two states per physical root, without new opcodes or raising limits.
- Actual native/both WASM ABIs, legacy/framed hosts, provenance, signed packages and diagnostics were verified.

**Acceptance:** `REF-04-020` and debounce-specific tests passed in batch7. Evidence is `build/compiler-runtime-batch7-full.log`. Scan transaction evidence is documented in [sensor-atomicity-design.md](sensor-atomicity-design.md). Durable reboot and native package canonical source replay remain incomplete.

Retain batch6/7 evidence for Result integration. Remaining temporal and composition features follow the implementation queue above.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Baseline 44 becomes stale after subsequent focused changes | Duplicate implementation or incorrect completion counts | Regenerate full results at one revision in Phase 0 |
| Parser is green while runtime semantics remain unimplemented | False compliance | Require actual native/WASM trace acceptance for every stateful accept |
| Shared manifest expands separately for each feature | Validator/restore drift | Bundle producer, validator, source trace and tests in one vertical slice |
| Concurrent GFB format changes | Artifact/verifier mismatch | One format owner, one rebuild, byte header/version checks |
| Keep 164 specified cases only as a TODO count | Failure to meet the overall goal | Make ID→test/evidence index a mandatory final-gate artifact |
| Internal runtime claims external physical/UI requirements | Responsibility boundary violation | Audit the 23 external cases separately and retain physical confirmation as separate evidence |
