# Bool byte-PC refinement execution report

Issue [#590](https://github.com/callin2/ghostflow-language/issues/590).
This follow-up builds on commit `4b02f9ce974ca4a8c7a9e9c86301449438d7a0f6` without changing production code or the admitted source profile.

The later [serializer and raw-decoder extension](serializer-report.md) adds
canonical encoding and universal recovery. The 41-outcome evidence below remains
the PC refinement milestone; the expanded runner and axiom set are recorded there.

## Result and proof boundary

`ByteMachine.lean` adds a deterministic instruction decoder and program-counter machine over raw bytes. The universal `accepted_steps` theorem shows that every accepted, scoped Bool expression reaches the expected end PC and stack through that machine. This closes the structured-expression-to-PC-model obligation for the admitted subset. Correspondence between the new model and the production Rust implementation remains a separate obligation.

The theorem quantifies over typed expressions, accepted wire witnesses, arbitrary input/old/candidate Bool valuations, finite slot counts, candidate availability, any byte prefix and suffix, and any initial stack with fewer than 128 entries. It starts at the prefix length and reaches prefix length plus expression byte length. The resulting stack contains exactly the expression value followed by the unchanged initial stack. The number of executed instructions is at most the expression's byte length.

`demand_one` derives a peak extra stack demand of one by induction over the admitted witness structure. Literals and reads push one cell. Negation preserves that peak. A conditional pops its condition before running either arm, so the maximum of its subexpression demands remains one. `accepted_refinement` states the bound as initial stack length plus `demand wire` at most 128, then establishes both the earlier structured execution relation and the concrete PC-step path to the same value.

`accepted_execute` proves that starting with an empty stack, byte length plus one units of model fuel returns the expression value. The additional unit observes the terminal state. This is a universal proof, not an enumeration of input valuations. The kernel reports only standard `propext` and `Quot.sound`; the accepted proof contains no custom axioms, `sorry` or `native_decide`.

The earlier bare `Executes` relation alone is deliberately not a sufficient premise. Its branch rule can describe an arbitrary unchosen byte list, including an empty false arm with a zero-length jump. Rust rejects a zero jump. The refinement theorem requires checker acceptance. Accepted wire subtrees have positive byte lengths and checked skip lengths, which excludes that counterexample.

## Instruction and error semantics

The model reads the instruction at `code.drop pc`, decodes little-endian operands and maintains a Bool stack. The modeled instructions are fixed to the admitted subset.

| Opcode | Modeled operation |
| --- | --- |
| 1 | Read one byte and push whether it is nonzero. The validator admits only canonical zero/one literals, while the PC model retains Rust's nonzero behavior. |
| 3 | Decode a u16 input index, check it against the supplied finite input count, then push the input valuation. |
| 4 | Decode a u16 state index, check the state count, then push the previous-state valuation. |
| 5 | Decode a u16 state index, require candidate availability and an in-range index, then push the candidate valuation. |
| 10 | Pop one Bool, negate it and push it back. |
| 30 | Decode and validate a positive relative jump target first, then pop the Bool condition. Jump when false; otherwise advance past the instruction. |
| 31 | Decode and validate a positive relative target and jump unconditionally. |

Both jump targets use PC after the three-byte instruction as their base. The target must not exceed the complete expression's byte length. In opcode 30, even a true condition does not bypass invalid-target checks. This matches the inspected order in Rust's `Reader::jump_target` and `eval_expression_with_witnesses`.

Pushes check the 128-cell capacity. Reads check range before attempting the push. Negation pops before its push. Termination requires PC equal to code length and exactly one result cell. Unsupported opcodes, truncated operands, out-of-range slots, missing candidate state, stack underflow/overflow, zero jumps, out-of-range targets and wrong result counts have explicit failure constructors. Starting beyond the code length fails as truncated input. Fuel exhaustion is a model-only failure; accepted-expression execution proves the supplied bound sufficient. The raw-list representation additionally rejects operand values beyond one byte, which cannot occur in Rust's u8 byte array.

The modeled stack contains only Bool values. Non-Bool runtime type faults are outside this admitted profile. The model uses natural-number PC arithmetic. The bridge admits expressions of at most 4096 bytes, while proving Rust's `usize` implementation and checked arithmetic refinement remains outside this unit.

## Actual compiled-byte application

`pc-bridge.mjs` extends the original generated theorem input. It retains the exact complete GFB byte list and slice-equality lemmas, then adds kernel-checked input/state-count byte bindings, phase-specific slot descriptors, scope-check lemmas and an all-environment PC execution theorem for every transition and output expression.

The transition descriptor has no candidate state. The output descriptor has candidate state available and the same finite counts. Every referenced index must pass the Lean scope predicate. The existing bridge requires complete, unique declaration-order transition targets, so the supplied candidate mapping covers all declared states. The JavaScript outer header decoder still supplies the count-byte offsets; the kernel checks the supplied bytes and counts, not the decoder implementation.

The two retained canonical fixtures are unchanged. They exercise GFB formats 1 and 3, nested branches, old/candidate reads, a simultaneous state swap, default retention and literal values. No new source form or GFB profile is admitted.

## Verification

Use the same focused commands as the initial proof unit.

```sh
node --test tests/bool-translation-validation.test.mjs
node experiments/bool-translation-validation/verify.mjs --lean /absolute/path/to/lean-4.19.0/bin/lean --evidence-dir build/bool-pc-validation
```

The runner now checks the PC model, per-artifact PC theorems, explicit runtime-error examples, missing candidate and out-of-range scope certificates, and a changed header-count certificate. It mutates the jump base, branch polarity, condition pop, candidate lookup, stack limit, zero-jump handling and outside-target handling. Proof mutations require the expected Lean diagnostic. The stack-limit and jump-error mutations must also falsify their concrete error examples, because relaxing those rejection checks need not falsify preservation of already-valid programs.

The focused Node suite passed six tests. The extended Lean/admission run passed all 41 expected outcomes with Lean 4.19.0. The runner retains exact generated inputs, compiler artifacts, logs, hashes and exit statuses in its selected evidence directory. Its existing running/failed/passed report protocol prevents an unsuccessful rerun from leaving a current success claim. Source identity includes the new Lean and JavaScript files and the focused test. The root integration owner retains responsibility for repository-wide registration, independent review and official verification.

The path-filtered `.github/workflows/lean-proof.yml` reruns the focused Node test and the Lean runner for proof, compiler-tool, and core-source changes. It checks the SHA-256 of the official elan v4.1.2 Linux archive before installing exact Lean 4.19.0. The workflow uploads available setup logs and, when the verifier runs, its JSON, generated proof inputs, logs and compiled fixture bytes even if a check fails. This workflow has read-only repository permission. A local Darwin run verifies the same proof commands; GitHub-hosted execution must be observed separately before claiming that CI passed.

## Remaining trusted links

The source parser/projection, outer GFB header decoding, literal serialization, host tools and Lean kernel remain in the application boundary described in the initial report. The new PC theorem removes dependence on treating structured expression evaluation itself as instruction stepping. It does not mechanically prove the Rust source, its array representation, witness/trace collection, the selected-strategy scheduler, unsupported numerical/error paths or physical device behavior. Those claims require their own refinement or execution evidence.
