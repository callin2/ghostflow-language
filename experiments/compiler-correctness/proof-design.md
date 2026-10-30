# Compiler correctness investigation report

Issue [#590](https://github.com/callin2/ghostflow-language/issues/590).
Inspected production revision `4861a78a72f0f1078cafe99bf26b93d541e1b82c`.
This is an investigation report and partial proof record. It does not establish whole-compiler correctness.

## Judgment

Use a proved translation validator to establish individual compiler transformations while retaining a separate end-to-end semantic-preservation obligation. The immediate proved unit is exact adjacent-constraint deletion under the portable core's safety-round algorithm. It applies to arbitrary initial values, initial faults and round counts in the Lean model. It does not prove the JavaScript compiler or the Rust implementation.

| Approach | What its theorem could establish | Main remaining work |
| --- | --- | --- |
| Prove the complete implementation | Every accepted source compiles to an artifact preserving the specified observations | Formalize source semantics and connect every production parser, lowering, encoder, decoder and execution path to it |
| Prove a translation validator | Every artifact accepted by the validator preserves the source semantics for its declared supported domain | Prove validator soundness, bind actual source and output bytes, reject unsupported cases, prove the runtime refinement |
| Compare generated and runtime examples | The observed examples agree at the pinned revision | This yields finite execution evidence and mutation sensitivity, not a universal theorem |

Proving a handwritten compiler would add a second implementation. Without an equivalence theorem or mandatory proved artifact validator, its correctness would not imply correctness of `compileSource`.

## Production boundaries inspected

`tools/compile-source.mjs:94` starts the public literate-source path. Its dispatch at lines 124–140 includes composition, resource-policy descriptors, shared-constraint descriptors, accounting, schedule descriptors, temporal descriptors and executable control. An end-to-end contract must state a result type distinguishing executable artifacts, checked descriptors and rejection.

`tools/control.mjs:1707` invokes `checkedAdjacentConstraints`. The selected constraint forms enter the module immediately afterward. `tools/gfb1.mjs:717` emits GFB, including strategy expressions, temporal extensions, constraints and objectives. Its format selection includes versions up to 21. `tools/core-ir.mjs` supplies expression lowering. All of these transformations are outside the current universal proof.

`tools/constraint-proof.mjs:37` validates a certificate with a bounded truth table. Its domain includes requires, requires-any and mutex. It rejects duplicate names, limits the source list to 128 constraints and uses at most eight names for an eliminated duplicate. Its hashes establish internal certificate identity. They do not prove that the lists describe the source or emitted bytes.

`crates/ghostflow-core/src/lib.rs:2629` computes the names blocked by one constraint. `apply_safety` at line 2646 reads one value snapshot per round, unions all blocked names and fault strings, changes blocked values to false, and repeats for at most the original map length plus one rounds. It stops when the blocked set is empty. This is the algorithm modeled by the partial Lean proof.

`eval_expression_with_witnesses` at line 3223 executes encoded expressions. Binary64 arithmetic, checked integer arithmetic, short-circuit branches, conversions, trace operations and prelude reads all need separate semantic obligations. Proving constraint elimination does not cover any expression opcode.

## Executed Lean theorem

The dependency-free `lean/ConstraintPreservation.lean` imports Lean's bundled `Std`. `Constraint` has `requires`, `requiresAny` and `mutex` constructors. `Values` maps names to optional values. A value is Bool or an opaque non-Bool payload. Non-Bool payloads and missing names remain unchanged by safety processing. Faults are represented by string membership, matching the set observable rather than its serialized ordering.

`blockedNames` includes the active-name count used by Rust mutex constraints. `faultName` preserves original ordered names and separators. `collect` evaluates every rule against the same snapshot and unions blocked names and faults. `run` applies the result, repeats under a supplied round bound, and stops when no rule blocks a name. The caller uses the original output count plus one to match the Rust loop budget.

The executable `check original compiled` accepts retaining rules and removing adjacent exact duplicates. It can retain some duplicates, so it supports production certificates that leave ineligible constraints unchanged. It accepts unchanged lists as a sound no-op. It does not implement the production certificate's JSON shape, digest checks or optimization budget. Those are separate admission conditions.

The central theorem is:

```lean
theorem check_run (original compiled : List Constraint)
    (accepted : check original compiled = true) (rounds : Nat) (initial : SafetyState) :
    run rounds original initial = run rounds compiled initial
```

The proof first establishes idempotence of set union for one duplicated effect. It proves whole-list effect equality from the validator result. Induction on the round budget then establishes equality of the complete resulting safety state for every initial valuation and initial fault set. `check_safe_values` and `check_faults` project the two observations.

The file contains no `sorry`, custom axioms or `native_decide`. Lean reports the standard logical axioms `propext` and `Quot.sound` for `check_run`. This is not a claim of an axiom-free foundational system.

Run the proof and mutation checks with:

```sh
python3 experiments/compiler-correctness/lean/verify.py --lean /absolute/path/to/lean
```

The executed Lean version was 4.19.0. `lean/evidence/verification.json` records six expected outcomes. The model and an accepted mixed certificate compile with exit 0. Changed dependency, nonadjacent deletion and removal of a distinct rule each fail `by decide`. Replacing blocked-name union with exclusive-or makes the universal proof fail with an unsolved goal. The verifier checks the expected diagnostic, so an unrelated tool failure does not count as successful rejection.

## Binding a real compilation to the theorem

The production evidence must retain these distinct checks:

1. Pin exact canonical source bytes, source closure, compile options, compiler files, dependencies and their hashes.
2. Invoke the real public `compileSource` and retain emitted bytes, manifest, certificate and source trace.
3. Independently decode the exact emitted GFB bytes and require decoded constraint forms to equal `certificate.compiled`. A decoder must reject unsupported format versions and trailing or malformed data.
4. Bind `certificate.original` to pre-optimization lowering and source identity. Re-running the same compiler can detect drift, but it does not prove lowering is correct.
5. Generate Lean constructor lists from the retained certificate. Prove `check original compiled = true` with kernel-checked computation and instantiate `check_run`. Unknown constructors must fail the bridge.
6. Execute the same bytes on pinned native and WASM runtimes and compare safe values and faults with the unoptimized artifact for enumerated test inputs.

Steps 3 and 6 are independent executable checks. Step 5 is the universal theorem for the supplied lists. They do not turn the unproved JavaScript decoder, literal serializer or Rust-model correspondence into a theorem. Record each status separately.

Safety trace records have per-constraint indices and cardinality. Duplicate removal changes these observations. The preservation theorem intentionally covers safe values and fault membership. The source-trace mapping has a separate obligation to retain both source origins and map each to the retained runtime constraint. Full `TickRecord` equality would be an incorrect claim.

## Full correctness statement and open obligations

The intended theorem should quantify over canonical source, source closure, compile options and all admissible input histories. Successful compilation to an executable artifact must preserve the specified traces, including faults, state transitions and observable outputs. A successful descriptor result must retain its declared non-executable meaning. Rejection must be explicit. Physical actuator confirmation is an external observation and cannot be inferred from a VM value.

A source-to-artifact theorem needs the following separate links:

- Literate extraction and parsing preserve the intended source text, scopes, names and source locations.
- Semantic elaboration preserves Result fault cases, units, value domains, state ordering, functions, composition and adaptation.
- Lowering preserves old-state reads, candidate-next reads, generated timer state and output intentions.
- GFB expression emission preserves stack behavior, branch targets, short circuiting, numerical values and error ordering.
- Encoding and Rust decoding agree for every supported format and reject invalid artifacts consistently.
- Runtime execution refines the specified VM semantics, including transactional tick rejection, strategies, temporal preludes, schedules, calendar data, settings, accounting, PID and resource policies.
- Source traces, provenance, manifests, descriptor admission and package identity remain bound to the actual artifact and source.

No blanket “supported” label may absorb these paths. The current Lean validator supports only the three constraint forms. Every other compiler transformation and runtime subsystem remains outside that theorem. A validated lower-level expression or constraint IR still leaves source-to-IR correctness open.

Numbers require binary64 and checked 32-bit semantics, not mathematical real or unbounded integer substitutions. Time requires explicit epoch, monotonicity and bounded arithmetic assumptions. Schedules require provider and calendar contracts. These choices must be in the theorem premises or specified fault behavior.

## Independent review of the Percent counterexample

The canonical reference defines `Percent` as a value from 0 to 100 in `docs/reference/02-types-expressions-state.en.md:21`. That statement appears in the value-kind table before the separate literal-spelling subsection. It is a type-wide domain promise.

The retained `adversarial/evidence/percent-runtime-domain.ghost.md` declares a Percent state of 90% and Percent outputs for adding 20% and subtracting 100%. Its retained execution trace reports requested and safe values 110 and -10, with no faults. This contradicts preservation of the specified Percent value domain. It establishes a compiler/runtime contract defect, tracked by [#591](https://github.com/callin2/ghostflow-language/issues/591).

The cited reference does not choose runtime rejection, saturation or a different arithmetic result type for this case. Do not claim that a particular fault response was already specified. The present investigation retains the failing evidence and leaves production unchanged.

## Trust and completion boundary

The proved result trusts Lean 4.19.0's kernel and its standard logical foundations. Its application additionally depends on the exact serialized theorem inputs. Correspondence between the handwritten safety model and Rust remains a reviewed assumption supported by executable comparison. Build provenance and host execution add compiler, operating-system and hardware assumptions.

The constraint theorem is complete for its declared model and admitted list relation. The whole-compiler theorem is not established. The Percent counterexample prevents a current claim that all accepted programs preserve every stated type domain.
