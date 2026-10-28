# Whole Bool module binding proof report

Work item [#590](https://github.com/callin2/ghostflow-language/issues/590) reduces the trusted JavaScript metadata boundary of the Bool translation experiment.
This report records a bounded verification experiment. It does not claim a proof of the production compiler or Rust VM.

## The removed premise

The earlier certificates read expression locations, lengths, state counts, and transition targets from `evidence.decoded`.
They bind expression bytes and prove their semantics, but do not bind every module metadata byte.
In `snapshot-branches`, changing the second transition target at byte offset 176 from 1 to 0 leaves the frozen expression witnesses unchanged.
The raw target list becomes `[0, 0, 2]`, while the old generated target list remains `[0, 1, 2]`.

The verifier runs the same changed artifact through three checks.

| Check | Expected result | Meaning |
| --- | --- | --- |
| JavaScript `validateArtifact` | Rejects `duplicate transition` | The existing JavaScript module validator detects the change. |
| Previous serializer certificate with frozen decoded evidence | Lean exits 0 | The old kernel certificate does not cover this metadata byte. |
| Whole module certificate from source projection and raw bytes | Lean exits 1 with a false-proposition diagnostic | The new certificate covers the changed target byte. |

This is a proof coverage gap. It is not evidence of a production validator vulnerability.

## The canonical module model

`ModuleEnvelope.lean` stores a typed module with a name, named initial states, phase-indexed transitions, and named output expressions.
It computes the transition targets with `List.range states.length`.
The model accepts this bounded profile.

- Names use ASCII identifiers of 1 through 128 bytes. State and output names are unique across both lists.
- There are at most 128 states and 128 outputs, with exactly one transition per state and zero external inputs.
- The version is 1. The single strategy is `control`, with priority 0 and no constraints.
- State and output types are Bool. State initial values are canonical 0 or 1.
- The capability query is derived from the output names. No outputs produces the unconditional `[5, 1]` query.
- Format 3 is selected when an expression contains a branch. Otherwise the format is 1.
- Expression references are checked against the phase and state count. Expressions and the capability query are limited to 4096 bytes. The whole module is limited to 1048576 bytes.

The encoder computes every section count, name, type, target, length prefix, query byte, expression byte, and final constraint count.
`encodeModule sourceModule = .ok artifactBytes` therefore binds the complete artifact, including the absence of trailing bytes.
The real compiler fixtures establish this equality with Lean's kernel-evaluated `decide`.

A canonical encoder reuses the existing expression serializer and gives an exact-byte contract for this profile.
A separate whole-module decoder would require another parsing and full-consumption proof.
This experiment does not introduce that decoder or claim its converse.

## Composition into execution

`section_partition` derives the exact header, transition records, output records, and footer from the whole-module equality.
`slices_records` proves that the expression slices computed from those record lengths equal the canonical expression bytes.
`source_partitions` connects those slices to the source expressions, including the complete declaration-order transition list.
No JavaScript offset, length, target, or count location is an argument to these theorems.

`recovered_module` applies the existing expression recovery proof to every derived raw slice.
`module_tick` runs those slices through `ByteMachine.execute` and proves equality with `sourceTick` for every environment.
Transitions read the same old snapshot. Outputs read the candidate state produced by all transitions.
The theorem is about modeled PC execution of the artifact slices, rather than only equality between two unrelated expression lists.

`module-bridge.mjs` reads only the typed source projection and raw artifact bytes.
Deleting `evidence.decoded`, replacing it, or changing decoded and projection-side offset, length, target, and count-location fields leaves the new generated certificate unchanged.
Changing raw artifact bytes changes the certificate and its kernel equality obligation.

## Validation and evidence

The focused Node test checks generator independence from decoded metadata, the existing admission checks, and stale-success replacement.
The Lean verifier preserves all previous expected outcomes and adds whole-module equality for the three existing real compiler fixtures.
Its new cases cover profile bounds and raw changes to state initial values, names, counts, types, strategy metadata, capability queries, transition targets, expression lengths, constraints, format, version, and trailing bytes.
The paired target oracle above also runs in Lean.

Run the focused checks from the repository root.

```sh
node --test tests/bool-translation-validation.test.mjs
node experiments/bool-translation-validation/verify.mjs \
  --lean /Users/changjin/Documents/PlatformIO/Projects/esp32s3-new-project/.tools/lean589/lean-4.19.0-darwin/bin/lean \
  --evidence-dir build/bool-module-envelope-590
```

`verification.json` records the Lean executable hash, dependency tree, source-file hashes, generated certificate hashes, logs, and expected result for each invocation.
The source identity includes all imported Lean proof files and the generator.
The result count is a count of expected outcomes, including intentional failures, rather than a count of universal theorems.

The run completed at `2026-10-28T16:37:39.520Z` with 92 of 92 expected outcomes. These consist of 81 actual Lean invocations (26 successes and 55 expected rejections) and 11 JavaScript admission assertions (all expected rejections).
The previous 64 outcomes remain in that run. The focused Node tests passed 8 of 8 cases.
The source identity SHA-256 is `ff5e81aaa3f9b1df352e1531035f0009d29821dc9bac37237401c616f290fe99`.
The verification report SHA-256 is `f0e6c9fdb9f36c4d649124c9fe52f6c34a72f8fd003a0d49e1fd21a7303336db`.

Successful whole-module equality certificates report no axioms.
The generic partition, recovery, and tick theorems use only Lean's standard `propext`, `Quot.sound`, and `Classical.choice` foundations.
The verifier rejects successful runs containing `sorryAx` and prohibits proof escapes in the model sources.
Intentionally rejected certificates can print `sorryAx` after their failed obligation. Their nonzero exit and expected diagnostic are the negative oracle, never a successful proof.

## Remaining boundaries

The production literate parser, typed source projection, and literal emission into the Lean input remain outside the kernel proof.
The complete artifact equality replaces reliance on the JavaScript module decoder for the new certificate.
It does not prove that the modeled canonical envelope and `ByteMachine` implement the production Rust decoder and runtime.
State initialization bytes are bound to the source declaration. Initialization of a production runtime environment is not proved here.
The theorem covers only this Bool profile, and does not imply other GFB formats, hardware effects, deployment, or product acceptance.
