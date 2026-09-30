# Optimizer pass contract

[한국어](OPTIMIZER-PASS-CONTRACT.ko.md)

Status: **design only**, issue [#42](https://github.com/callin2/ghostflow-language/issues/42).
This records the 2026-09-13 selection: compile-time typed SMT constraint and
equivalence checks, and generation/compile-time BDD simplification of eligible
typed Boolean IR. Neither engine runs on ESP32. DBM is not selected. No library,
compiler implementation, performance gain, public flag or manifest extension is
accepted by this document. Library choice is intentionally deferred, not a
prerequisite for this contract. This is a local design, not published research.

## Semantic authority and scope

Read [Reference 02](reference/02-types-expressions-state.en.md),
[Reference 4.7](reference/04-sensors-constraints-control.en.md#47-requested-safe-applied-confirmed),
the [physical boundary](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary)
and [intent anchor map](INTENT-ANCHOR-MAP.md) together. Canonical `.ghost.md`
source, including prose and comments, remains authoritative. Optimization must
retain its exact bytes and revision identity even if optional IR debug material
is stripped. It cannot rewrite intent or turn an unconfirmed AI assumption into
a formal axiom. Confirmed prose alone is not a typed machine premise either.

#31 basic anchor mapping and #342/current require-lowering provenance are already
implemented. `tools/source-trace.mjs` emits `GhostFlow/source-trace-v1` derivations
with `relation: lowered-as`, `status: compiler-derived` and
`semanticVerification: not-proven`. Deterministic replay validates consistency;
it does not prove semantic equivalence, evaluation or physical application.
Eliminated-check/replacement and merged-node proof work belongs to future #42
implementation; this design does not close #31's remaining acceptance.

In particular, current `require !(a && b && c)` lowering is `mutex(a,b,c)`.
At `a=true, b=true, c=false`, Boolean not-all is true while at-most-one is false.
The current derivation remains unproven. This design neither changes nor defines
three-output source semantics and does not repair upstream require lowering.
An optimizer compares the **semantically resolved current executable IR**, with
typed constraint-effect semantics, against its candidate, never just raw Boolean
ASTs. For two outputs the truth tables coincide, but that alone still does not
prove final safe-output, error and evidence behavior.

## Proposed pass boundary and order

Today's Parser/Lowerer integrates typing, resolution and emission; it does not
already expose the following optimizer boundary. Future implementation must make
it explicit after parsing, type checking and name/enum/next-state resolution,
before final bytecode emission, without bypassing existing mandatory checks:

1. Produce immutable typed semantic IR, source mapping, constraint effects and
   current validation results; keep the original executable as the fallback.
2. Optionally run typed SMT property checks with explicit domains and assumptions.
3. Generate a BDD candidate only for eligible pure, total Boolean regions.
4. Independently check candidate equivalence and any submitted certificate.
5. Emit final bytecode, check resource bounds and validate provenance relations.

Input includes exact source/compiler/profile revisions, typed operators and
domains, state and output bindings, evaluation order, effect and fault sites,
constraint stages, timer/schedule/accounting dependencies, source node IDs and
anchor links. Unsupported encoding or missing purity/totality evidence excludes
a region. Result branches, schedules, timers, error-producing expressions and
short-circuit operands are not automatically pure total Boolean atoms.
`Number` is finite binary64, not SMT Real; rounding and nonfinite-operation faults
must be modeled. `Int` is checked i32, not unbounded integer or silent wraparound.
Duration, enum, Result tags, units and valid input domains remain distinct.

Output is either the unchanged original with a bounded skip reason, or a checked
candidate plus exact transformation/proof relations. No transformation becomes
deployable merely because a solver or BDD generator produced it. BDD identity
can support a modeled Boolean region; it is not proof of whole-program behavior.

## Equivalence obligation

For every admitted input, prior state and environment history, under the same
program/profile, run identity, clock epochs and declared typed assumptions,
compare the original and candidate transition, not only the returned Bool.
Multi-tick equivalence requires the preserved transition relation and matching
initial/checkpoint states; testing a finite trace does not establish that proof.

| Observable | Required preservation |
| --- | --- |
| State | Previous-state reads, resolved next-state dependencies, parallel commit and atomic rollback on failure |
| Outputs | Requested intent, final safe intent, fixed-point blocking and blocker identities; constraints never manufacture true outputs |
| Errors | Short-circuit and branch selection, first observable fault/error and its order/origin, rejected inputs and failed-transition rollback |
| Time and lifecycle | Run/time continuity, timer initialization/reset/elapsed state, schedule occurrence/admission identity and boundaries |
| Accounting | Declared requested/safe/applied basis, usage/admission records, limits and their rollback |
| Evidence | Actual evaluation events and source identities, derived satisfaction, final blocking and retained Result/sensor provenance |

Applied commands and confirmed physical feedback remain separate Device facts.
This pass establishes neither. It may remove internal instructions or merge
eligible computations only within a proved region. Bytecode size and instruction
count may differ within the accepted resource profile; observable resource-limit
faults, timing/admission rules and evidence may not silently change. Any proposed
relaxation of a public cost/trace observation requires a separate contract.
Removed nodes must never be reported as executed. A reconstructed logical value
or derived satisfaction is labeled derived, with its replacement evidence; it
is distinct from an evaluated source check and a final output block. If current
trace consumers cannot express that distinction, skip the transformation.

## Failure and proof acceptance

| Check outcome | Contract |
| --- | --- |
| UNSAT | Accept only when the typed mismatch/property encoding, assumption scope and independently validated certificate establish the stated obligation |
| SAT | Validate the counterexample against original/candidate semantics; a real mismatch rejects the candidate and retains the original |
| Unknown, timeout, solver/checker error, unsupported theory, node/memory/time budget exceeded | Skip optional optimization, retain original and bounded diagnostic; never mark proved or reject valid source for this reason |
| Invalid certificate, unverifiable counterexample or inconsistent mapping | Reject candidate, retain original; record validation failure without asserting source invalidity |

Existing mandatory language, artifact and resource errors remain errors. An
optional optimizer failure is not a new source-language rejection. Solver status
alone is not proof. Certificate/encoding/checker versions, assumptions and scope
must be recorded and revalidated; independence excludes trusting the candidate
generator's own unchecked equivalence assertion. Budget behavior is deterministic
for artifact selection or explicitly recorded; it does not affect source meaning.

## Proposed provenance and artifact adoption

These are requirements for future relation records, **not accepted schema fields**:

- Input/candidate IR and bytecode hashes; exact source document, compiler, language
  profile and mapping revisions; transform identity and ordered composition.
- Every origin anchor and original node ID/range, including removed/merged nodes;
  replacement node IDs, relation, replacement guard and semantic scope. Preserve
  many-to-many origins and authored classification without inventing source links.
- Typed obligation/encoding digest, explicit assumptions, checker/certificate
  identity and version, validation status, reason and certificate/content digest.
- Distinct unverified/generated and independently verified replacement states;
  never upgrade existing `compiler-derived`/`not-proven` lowering records by replay.

Each transform and its composition must pass exact revision, complete-origin,
replacement coverage and semantic-evidence validation. Preserve source locations
in both Markdown and extracted coordinates where present. Eliminated constraints
need an independently checked guarantee covering their original blocking effect,
not just a convenient assertion that another Bool implies them.

Current strict replay/package validation must continue rejecting optimized
bytecode or new relation claims it cannot derive and validate. Adoption requires
a separately specified proof-aware validator and compatibility/version decision
for source maps, packages, replay and consumers. Do not disable canonical replay
or reuse its consistency result as a semantic proof.

## Executable conformance plan and implementation slices

The following are planned vectors, not implemented optimizer passes or reported
passing results. Assign stable proposed IDs below, compile canonical literate
fixtures, run original/candidate in native and WASM, and compare complete transition
and evidence records. Existing tests supply seeds, not new proof certificates.

| Proposed ID / seed | Required vectors and oracle |
| --- | --- |
| OPT-STATE / Reference 02 | Parallel updates, previous/next-state dependencies, branch changes and multi-tick checkpoint continuation; equal commit and fault rollback |
| OPT-TIMER / `examples/optional-feedback-timer.ghost.md`, `tests/continuous-timer-compatibility.test.mjs` | Threshold minus 1ms/exact/plus 1ms, initialization/reset, unavailable feedback, run/clock epoch discontinuity and rejected support; equal timer state and failures |
| OPT-SCHEDULE / `examples/scheduled-watering.ghost.md`, `tests/schedule-missed-reaction.test.mjs` | Occurrence boundaries, duplicates, missed reaction, backward wall-clock correction and accounting limits; equal admission identities and usage rollback |
| OPT-INT / `tests/int-compiler.test.mjs`, `tests/int-division-identity.test.mjs` | MIN/MAX, checked overflow, zero division, MIN div -1, short-circuited fault; equal fault origin/order |
| OPT-NUMBER / Reference 02 | Binary64 rounding/cancellation, signed zero where observable, finite/nonfinite boundaries and typed unit distinctions; no Real-based rewrite |
| OPT-RESULT / `tests/result-control.test.mjs`, `tests/result-provenance.test.mjs` | Enum state, ok/fault branches, left-to-right short circuit, retained provenance and failed-decision rollback; equal selected evidence |
| OPT-CONSTRAINT / `tests/constraints.test.mjs` | Exhaustive two/three-output truth tables including true,true,false; compare current lowered effects, reorder constraints, require chains and final blockers; never certify raw three-output not-all as mutex |
| OPT-PROVENANCE / `tests/intent-anchor-map.test.mjs`, `tests/portable-package.test.mjs` | Removed/merged origins, prose-only revisions, changed hashes, certificate/mapping tampering, derived versus executed events; reject false proof and mixed revisions |
| OPT-FALLBACK / all fixtures | Force unknown/timeout/checker failure and every budget boundary; original artifact retained, existing mandatory errors unchanged |

Implement in bounded slices: first typed IR/effect boundary with baseline replay;
then typed property encodings and independently checked negative vectors; then
pure/total Bool eligibility and bounded BDD candidate generation; then equivalence,
certificate checking and composition; finally proof-aware provenance/package
adoption with native/WASM differential conformance. Each slice preserves the
original path until its own acceptance is verified. Library evaluation follows
the encoding/certificate requirements; no engine or ABI is chosen here.
