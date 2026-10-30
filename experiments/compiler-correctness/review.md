# Independent review of the partial constraint proof

The partial Lean-model result passes review. No P1 theorem, decoder, or bridge correctness issue was found. One P2 evidence-persistence issue was found and corrected in both runners, with independent failure and success reruns. No review finding remains open. This verdict does not establish compiler-wide correctness or a formal refinement from the Lean model to Rust. The separate Percent counterexample still disproves the universal current-compiler-correctness claim.

## Scope and theorem

`lean/ConstraintPreservation.lean:128-148` proves that, if its `check original compiled = true`, then every natural-number round budget and every initial abstract value/fault state produce equal final abstract values and fault membership under the original and compiled constraint lists. `check` accepts exact retention and adjacent exact duplicate deletion; the theorem does not assume a finite valuation sample. `check_collect` and `merge_duplicate` supply the substantive preservation argument. It is not merely equality of two calls given identical inputs.

The proof has no `sorry`, `native_decide`, custom axiom, or external solver oracle. My Lean 4.19.0 rerun printed only the standard `propext` and `Quot.sound` dependencies for `check_run`. The standalone verifier passed both positive checks and all four intended negative checks, including the OR-to-XOR mutation. Negative success requires the intended Lean diagnostic in the verifier's `expected_diagnostic` condition, so an arbitrary failing process is not sufficient.

`blockedNames`, `faultName`, set-like `merge`, and false-only `update` were compared with `crates/ghostflow-core/src/lib.rs:2629-2722`. The modeled requires, requires-any, mutex, fault spelling, shared snapshot per round, and blocked-name union agree on inspection. Rust's finite map representation, `values.len()+1` termination bound, fault-vector ordering, and trace records are not proved to implement the Lean functions. The theorem's arbitrary round budget can express the Rust budget, but no refinement lemma connects their representations. `Value.opaque` preserves non-Bool payloads abstractly; it does not formalize f64 arithmetic.

## Bridge and circularity assessment

`bridge.mjs:134-141` binds the certificate's original forms to a parsed source AST and its compiled forms to an independently framed GFB constraint decode. `decoder.mjs` correctly handles the used GFB1, GFB2, and GFB3 state widths, strategy framing, constraint kind/arity, and complete input consumption. Expressions remain opaque blobs. The source AST uses the production parser and literate extractor, which is an explicit trust boundary rather than an independent source-semantics oracle.

The generated certificate uses the actual source/emitted constraint lists. Lean checks `accepted` by `decide` and instantiates the universal model theorem. The runtime comparison reconstructs unoptimized constraint bytes and compares requested outputs, safe outputs, faults, and before/after state against optimized bytes. It does not compare or prove safetyTrace preservation, parser correctness, expression compilation, or Rust-model correspondence. Native and WASM share the same Rust implementation, so agreement between them is finite conformance evidence rather than independent semantic proof.

My isolated rerun reproduced six bridge fixtures, 343 input rows, five Lean-checked generated certificates, and 30 negative checks. It included profiles 1/2/3, eight-name eligibility, the nine-name unoptimized fallback, 128 constraints, and rejection of 129 constraints. Every subprocess returned the expected status. No failed exit was hidden in these successful runs.

## P2 evidence persistence finding

The first reviewed bridge and verifier left old successful JSON receipts intact after a failed rerun. I reproduced both in a temporary copy. A successful bridge run followed by an invalid `LEAN_BIN` returned exit 1 while its unchanged `summary.json` still said `lean.status = checked`. A successful `verify.py` run followed by `--lean /usr/bin/false` returned exit 1 while unchanged `verification.json` still reported all six checks passed. The relevant original write-only-at-success paths were `bridge.mjs:271-296` and `lean/verify.py:15-17,73-75`. CLI exits were correct; a reader of durable JSON could nevertheless mistake stale success for the latest result.

The bridge author corrected this in the existing file by recording running/failed/passed, actual UTC times, and nine source hashes. I independently confirmed that a missing Lean executable now produces exit 1 and `status = failed`, with no stale certificate list. The corrected bridge also reproduced all 343 rows and five generated certificates with exit 0 and `status = passed`.

The proof author corrected the standalone verifier with atomic running/failed/passed receipts, actual UTC timestamps, proof/verifier hashes, and captured process results. My isolated rerun confirmed that `/usr/bin/false` and a nonexistent executable each return exit 1 and replace the receipt with `status = failed`; neither retains old passing checks. A subsequent valid Lean run returned exit 0, `status = passed`, and all six intended check results. That independent run completed at `2026-10-27T13:40:22.731255Z`. The P2 finding is closed.

## Reviewed identities and independent execution

Source HEAD was `4861a78a72f0f1078cafe99bf26b93d541e1b82c`. The independent executions used temporary copies of the experiment files and symlinks to the actual compiler/runtime binaries, so this review did not overwrite the authors' evidence.

| File or executable | SHA-256 |
|---|---|
| ConstraintPreservation.lean | `f94db470d86c8d52f89c4b476baf82cf63dc7886d67b76ffab1d0d9c1862ad5f` |
| Initial verify.py | `b35dbc2df52e14be16365304e757ff868e4b2e99abb39242cbbeb5632a2d1e37` |
| Corrected verify.py | `4f99ef0c8f4b3169be05c1aca7a37233dc5d1223dde896a7fa4f9f26da65c3d5` |
| Initial bridge.mjs | `b7529acbecbd692afa7b0b32eae3c7c44f2e59659a79504e8fea2457ba7aa874` |
| Corrected bridge.mjs | `a1b5f64a5f3ed5b58cdf50a4a89b9c397d168d649c9678a76eb1b2f0c7813c86` |
| decoder.mjs | `96a2368eb6c1e5a0e35d3ae562fba441df825c9be8034a81f538c6686c02c836` |
| Lean 4.19.0 executable | `e06bfeeb39efd58c2c3b1dece023d212f10c249453a3e6f0742d02741afecf9c` |
| WASM executable | `f3347d44a8087033d293c167ca07b0a618475b7b5cc5c8d3ab806565b302eaca` |
| Native runner | `cccebe028384c5a6ecde63acc5ebb87ff7f7ce8b20adede345f92fde2ee30eea` |

This review owns only this report. No production file was changed by the reviewer.
