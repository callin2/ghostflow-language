# TASK-61 focused conformance expansion

Scope: standalone `ghostflow-language` compiler, portable core and reference
host adapters. The portable core's product semantics were not changed. No Device,
API, frontend, FSD, physical I/O or external-service validation is claimed.

## Exact inventory

| Inventory | Before (3091041) | After this change |
| --- | ---: | ---: |
| Catalog requirements | 41 | 41 |
| Implemented / focused tested | 1 | 15 |
| Partial | 7 | 4 |
| Pending | 32 | 21 |
| Design-only | 1 | 1 |
| Catalog test records | 7 | 17 |
| Node test-runner tests | 103 | 118 |
| Rust unit tests | 42 | 42 |

The initial eight rows use the validator's inferred status when `status` is
omitted. Counts above use that same rule, not a separate reinterpretation.
Node counts include existing file-level test modules and are not counts of
assertions or exhaustive semantic combinations. Fourteen new executable tests
and one catalog-governance regression account for the Node increase.

## Native and WASM error differential

`tests/runtime-conformance.test.mjs` runs the same GFB bytes and explicit input
snapshots through optimized native and release WASM artifacts. The native
reference runner's opt-in `--outcomes` protocol reports exact `OK` traces or
`ERROR` phase/message/journal length and continues after a rejected tick.
Only this diagnostic protocol treats an empty CSV cell as omitted input; it
never converts an omission to false or zero. Ordinary native-runner behavior
remains fail-fast. CSV transport/type errors remain runner errors, outside the
VM differential protocol.

Compared failures include division by zero and overflow during transition and
intent evaluation, absent generated clock input, backwards monotonic time,
activation with no match or a winning-priority tie, every truncation of the
identified minimal artifact, invalid magic/version, and malformed query
opcodes/stack operations. Recovery checks lock down state, committed intent,
journal, and tick-sequence atomicity before and after a successful tick. An eager
IF case fixes the documented unselected-branch arithmetic failure behavior.
Query tests accept 128 stack entries and reject 129 on both release targets.
The eight-input/eight-output differential now exhausts all 256 Boolean input
vectors; the previous four representative vectors were not an exhaustive test.

Native/WASM agreement shares a Rust core and is not an independent language
implementation. Hand-written expected state, safe-intent and error assertions
provide a separate oracle for these finite cases. Unchanged Rust unit tests
still run in Cargo's test profile; the optimized native/WASM differential is a
distinct gate. The full verifier records native and WASM artifact hashes.

## Focused requirements

New evidence directly exercises old-state reads, explicit next-state output
reads, simultaneous state commit and untouched fields; same-snapshot false-only
safety rounds reaching a fixed point independently of constraint order;
arithmetic failure atomicity; missing generated input; plain/Literate byte and
execution equivalence; and activation priority failures. Requirement statements
and content-derived IDs were preserved, and changed test locators were rehashed.

`GF-REQ-d9f669f061279c41` remains pending because its MVP wording says all intent
expressions read committed next state. Current GFB and `docs/LANGUAGE.md`
section 7 use old state unless an explicit next-state reference is present.
The new snapshot test proves that current behavior; resolving the contradictory
normative wording requires a separate decision. Legacy `with` syntax, complete
query/expression verifier matrices and all loader name/count/blob/kind limits
also remain partially covered. No missing feature was added just to turn its
requirement green.

## Gates and limits

Reproduce with `npm test`, `npm run test:coverage`, and
`npm run test:mutation:output`. Reports live in ignored `build/verification.json`,
`build/coverage-language.json`, and `build/mutation-output-contract.json`.
The coverage command includes the new runtime tests in its explicit allowlist.
It remains a V8 function/line/block-range baseline, without a coverage threshold,
Rust coverage, syntactic branch coverage, or MC/DC claim.

Output mutation testing still measures four compiler guards only. All four
unmodified probes must pass first. A mutant is killed only by the probe's
explicit assertion-failure exit status; timeouts, signals and infrastructure
failures fail the gate and do not count as kills. This is not runtime mutation
coverage or SQLite-level assurance.
