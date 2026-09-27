# Reference execution and support audit — 2026-09-24

Issue: [ghostflow-language #132](https://github.com/callin2/ghostflow-language/issues/132)

## Result

The audited language revision is `f809b4d327f8222acc4f00fa1277e02e8a8688df`,
the fetched `origin/dev` head at execution time. The current Reference simulator
result is **70 passed, 10 failed, 3 noncontrol** across all 83 accepted executable
catalog entries. The earlier 69/11/3 result is historical: `REF-04-058` now has
an executable PID control artifact and passes its simulator case.

The suite remains RED because ten complete control sources intentionally compile
to checked, non-executable descriptor artifacts. This audit changes no compiler
or runtime behavior.

## Exact execution evidence

| Check | Command | Exit | Result | Retained evidence |
| --- | --- | ---: | --- | --- |
| Dependencies | `npm ci` | 0 | lockfile install complete | `build/review-132/npm-ci.log` (`00098a783c6217bdd482418848510a384d55dd9a6c14eab7daf4c4f3eb76d3a0`) |
| Required native runtime | `cargo build --locked --offline -p ghostflow-core --example scenario_scan --release` | 0 | built | `build/review-132/runtime-build.log` (`dc6e0640e2ba707895465eb15e0dbd32a2ecb198dd399b6fb58377dfb0c80c35`) |
| Required WASM runtime | `cargo build --locked --offline -p ghostflow-wasm --target wasm32-unknown-unknown --release` | 0 | built; one pre-existing unused-function warning | same log |
| Reference + requirements | `node --test tests/reference-simulator.test.mjs tests/requirement-catalog.test.mjs` | 1 | Reference 70/10/3; requirement catalog 5/5 | `build/review-132/reference-requirements-built.log` (`6d1ae75c748b10ba6036e8998c0b7ec43fbaa873dd558aeb58027ba9f7702a16`), `build/reference-simulator-tests.json` (`bf32f48f61db0489f1c5ddb94fb4f391621cc2a720ff45a40afa9d54d4ef9e2b`) |
| Descriptor/objective focus | `node --test tests/schedule-descriptor-artifact.test.mjs tests/accounting-syntax.test.mjs tests/accounting-wasm.test.mjs tests/temporal-descriptor-artifact.test.mjs tests/ghostsim-closed-loop.test.mjs` | 0 | 16/16 | `build/review-132/descriptor-objective-focused.log` (`08776d8f38fee3b2fc923c62356bee34cc520554bfc9fdec516b1b77bf273e59`) |

The first attempt was infrastructure-blocked by the fresh worktree's missing npm
dependency. A second attempt after `npm ci` was infrastructure-blocked by missing
native/WASM build products. Both are preserved separately and are not counted as
product failures. The table records the completed run after the two required
artifacts were built. No test was skipped or aborted; `notRunIds` is empty.

The tracked
[`2026-09-24-reference-simulator-evidence.json`](2026-09-24-reference-simulator-evidence.json)
is the compact per-item mapping for all 83 cases. It records the exact source SHA,
commands, Reference ID, outcome, artifact format and failure reason. The original
generated artifact remains under ignored `build/`; its full SHA-256 above binds
this report and the compact export to that local result.

## Full host CI cross-check

The docs-only [PR #138](https://github.com/callin2/ghostflow-language/pull/138)
run reports the same full host-gate result as the audited `f809b4d` baseline:
17 failures, comprising seven `range-contract.test.mjs` cases and the ten
Reference descriptor RED cases above. The range fixtures fail on unsupported
`cancel_when`; the Reference cases emit the documented schedule, accounting and
temporal descriptors without simulator execution. Current run:
[WASM current job 107491461721](https://github.com/callin2/ghostflow-language/actions/runs/35955043922/job/107491461721).
Baseline run:
[f809b4d WASM current job 107424821836](https://github.com/callin2/ghostflow-language/actions/runs/35933373257/job/107424821836).
The frontend-pin job passed in the PR run:
[job 107491461612](https://github.com/callin2/ghostflow-language/actions/runs/35955043922/job/107491461612).

The full-host failure count is not the targeted Reference simulator count: this
audit's focused command remains **70 passed, 10 failed, 3 noncontrol**. PR #138
changes reports only; the compared job has no new regression or infrastructure
failure.

## Reference to requirement and execution evidence

| Reference slice | Requirement/status evidence | Test evidence | Native/WASM/simulator status |
| --- | --- | --- | --- |
| 70 executable controls, including temporal windows, Solar and `REF-04-058` | accepted executable rows in `tests/reference/cases/*.json`; catalog integrity 5/5 | `tests/reference-simulator.test.mjs`; focused closed-loop PID | PASS in simulator using the built native runner; sensor/temporal/PID paths also load the built WASM runtime |
| Schedule policy descriptors: `REF-03-024`, `032`, `036`, `038`, `057`, `059`, `060` | complete controls, emitted as `GhostFlow/schedule-descriptor-v1` | schedule descriptor artifact test PASS | FAIL in simulator: descriptor is explicitly non-executable; execution owner [#135](https://github.com/callin2/ghostflow-language/issues/135); semantic owner [#90](https://github.com/callin2/ghostflow-language/issues/90) |
| Accounting descriptor: `REF-03-050` | complete control, emitted as `GhostFlow/accounting-v1` | accounting syntax/WASM focused tests PASS | FAIL in simulator: checked ledger ABI exists but the control descriptor has no simulator execution binding; execution owner [#136](https://github.com/callin2/ghostflow-language/issues/136) |
| Temporal descriptors: `REF-03-062`, `REF-04-026` | complete controls, emitted as `GhostFlow/temporal-descriptor-v1` | temporal descriptor artifact tests PASS | FAIL in simulator by explicit non-executable contract; execution owner [#137](https://github.com/callin2/ghostflow-language/issues/137); semantic owner [#95](https://github.com/callin2/ghostflow-language/issues/95) |
| Standalone resources: `REF-04-044`, `045`, `050` | accepted declarations with no control | artifact format checked by simulator suite | NONCONTROL, applicable neither to a scan nor to native/WASM execution |
| Continuous objective: `REF-04-058` | executable Reference row; broader semantics remain tracked in [#94](https://github.com/callin2/ghostflow-language/issues/94) | Reference simulator PASS plus closed-loop focused tests 3/3 | PASS: native PID loop is deterministic; WASM artifact rejects malformed activation metadata. This does not complete all #94 acceptance criteria |

The requirements catalog itself is valid and its validator passes 5/5. Inventory
at this SHA is 41 requirements and 18 test rows: 14 `implemented`, 3 `partial`,
21 `pending`, 1 `design-only`, and 2 legacy rows without a `status` field. Pending
rows retain `pendingReason`; the validator does not promote them to PASS.

## Minimal reproduction of current failures

From this exact revision after building the two runtime artifacts:

```sh
node --test tests/reference-simulator.test.mjs
```

The command exits 1. A representative schedule failure is:

```text
REF-03-024: accepted control source compiled to
GhostFlow/schedule-descriptor-v1; ghostsim requires an executable control artifact
```

`REF-03-050` reports the same boundary with `GhostFlow/accounting-v1`.
`REF-03-062` and `REF-04-026` report it with
`GhostFlow/temporal-descriptor-v1`. The other seven failures differ only by
Reference ID. The six other schedule failures have the same artifact boundary.
Focused artifact tests prove these are intentional checked
descriptor outputs, not compiler crashes or corrupt artifacts.

The smallest next implementation family is schedule descriptor execution because
seven of ten failures share it; #135 owns execution integration and #90 defines
the official evaluator semantics. Keep #136 accounting and #137 temporal
execution separate because their runtime state, persistence and observation
contracts differ.

## Device support combinations

| Combination | Status and boundary |
| --- | --- |
| Fixed Device baseline | Current `farm-device` `dev` pins language `968db691433d5e15700437df89e5e1b1c6a24b5b` in both Cargo dependencies and `LANGUAGE_REV`. Board profile is `waveshare-esp32-s3-eth-8di-8ro-r8n16`. This is a pinned regression identity, not evidence for `f809b4d…`. |
| PR 42 candidate | Accepted feature HIL used language `fa0a005e43bd98ce0cb22e49b263d89ee796cd30`, Device base `9b2c48bb40aca2f57d2ba702c076572bcdbf981b`, and generated/device-reported firmware `c6105c0712335093e42707f3a75d81364cd0c9b8` on the same board profile. Case `numeric-threshold-virtual-ro1` passed four comparisons. The command's total CLI duration was 77,162 ms. Physical DI and relay contacts were not measured; applied and latch masks remained zero. |
| Current language `dev` | `f809b4d…` is newer and distinct from both `968db691…` and `fa0a005…`. It has the host Reference evidence in this report. It has no cited Device HIL run, firmware identity, or physical I/O acceptance. |

The PR 42 result therefore proves only its exact `fa0a005…` compiler/core,
generated firmware, board profile and numeric virtual-output case. It cannot be
used as current-`dev` Device evidence.

## Acceptance disposition

Issue #132's measurement criteria are satisfied: the exact SHA, commands, exit
codes, interruption state, complete result artifact, current failures, owners,
requirement status, and Device support boundaries are recorded. The ten RED
cases remain product gaps owned by #135, #136 and #137; they are not a reason to
keep this evidence-refresh issue open. Issue #132 can close after this report is
merged.
