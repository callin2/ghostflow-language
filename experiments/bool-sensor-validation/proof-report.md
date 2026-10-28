# Canonical Bool sensor recovery proof report

This bounded [#590 experiment](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6476360801) binds a real canonical `.ghost.md` compilation to full-module loading, typed raw-byte execution, and a Result trace interpretation. It covers one required Bool input, one Bool output, and `output_bit <- di |> recover(false)`. It has no state, filters, adaptation, constraints, or physical I/O.

## Admission and source identity

The production compiler generates three input rails: Bool value, Bool quality, and Number fault. The canonical SensorFault members are Disconnected, Stale, Invalid, and NotReady, encoded as 0 through 3. Healthy reads use fault 0. Fault reads may carry either stale Bool payload; recovery ignores that payload and produces false.

`bridge.mjs` checks the actual literate parser's exact three-declaration AST shape, required Bool input, Bool output, and a single `recover(false)` call. This restricted shape must have sensor node 1 and recover-call node 5. The bridge checks those identifiers, the actual source map kinds, the canonical manifest rail bindings and absent sensor configuration, and projects the actual Result-site metadata. It rejects another shape or identifier assignment. Site 5 and origin 1 are therefore explicit subset restrictions checked against source artifacts, rather than unconstrained caller parameters. This JavaScript source projection remains trusted.

`SensorProfile.load` receives only the complete raw byte list. It independently reads the format, module name, input names and types, state count, strategy fields, query blob, output declaration, expression blob, and footer. It requires full consumption, the exact typed rail declarations, and equality with the independently encoded canonical profile. The accepted code is the expression blob read from those raw bytes. No JavaScript offsets or decoded instructions enter Lean.

Reader limits are inherited from ModuleLoader: 128-byte names, 4096-byte blobs, and a 1048576-byte complete module. This profile has fixed counts of three inputs, zero states, one strategy, one output, zero transitions, and zero constraints. The canonical equality checks the capability query and every otherwise consumed field. These bounds guarantee terminating model operations, not a production timing bound. There is no general encode/load round-trip theorem; actual fixture and boundary load equalities are kernel checked.

## Execution and numeric contract

The separate typed subprofile preserves the previous zero-input Bool model and its 130 outcomes. Generalizing that model would change its stack types, admissions, and existing proof inputs for a requirement that needs only a small extension.

`SensorMachine.step` executes the actual program counter and bytes. It models typed Bool and Number stack values, input reads, Bool literals, branches with checked relative targets, Number constants, Number addition, and opcode 56. Opcode 56 consumes origin and choice and retains the Bool payload while appending a Result event. Checked `Steps` paths have 13 steps for healthy input and 12 for faults; `steps_execute` connects those paths to the executable fuel-bounded raw-PC interpreter. The proof does not replace execution with a fixed output table.

`NumberOps` makes numeric literal creation, addition, and integer extraction explicit. `SmallNumberLaws` requires exact extraction for literals 0 through 4 and exact addition of one for literals below 4. The generic recovery theorem quantifies over every implementation satisfying those laws, every admitted Reading, and both stale Bool payloads. A Nat implementation satisfies the laws in Lean. Production f64 correspondence to these operations and the surrounding Rust machine is still an unproved premise; finite native/WASM observations are reported separately.

| Contract | Proven conclusion |
| --- | --- |
| `load_sound`, `loaded_raw_code` | Accepted bytes equal the canonical profile and the executable blob came from a fully consumed raw parse. |
| `recovery`, `loaded_recovery` | Raw-PC execution returns the healthy Bool unchanged or false for every SensorFault, with the expected Result event. |
| `trace_meaning` | Bound metadata interprets each event as healthy or as the specific recovered fault. |
| `loaded_observation` | Loading, actual byte execution, and metadata interpretation compose to the expected observation. |
| Generated `actualLoaded`, `actualMetadataBound`, `actualObservedExecution` | The real complete compiler artifact and projected metadata satisfy those contracts. |

Healthy false has choice 0 and origin 0. Recovered false has choice 1 through 4 and origin 1. Neither model admission nor observation silently normalizes an invalid rail type, nonintegral number, invalid event, or metadata mismatch to healthy false.

## Verification evidence

Run the new experiment independently of the existing Bool suite:

```sh
node --test tests/bool-sensor-validation.test.mjs
node experiments/bool-sensor-validation/verify.mjs \
  --lean /Users/changjin/Documents/PlatformIO/Projects/esp32s3-new-project/.tools/lean589/lean-4.19.0-darwin/bin/lean \
  --evidence-dir build/bool-sensor-proof-590
```

The verifier records source hashes, Lean version and executable hash, actual process exit codes, expected diagnostics, generated inputs, logs, and timestamps. It rejects proof escapes and successful logs containing `sorryAx`. It replaces stale success evidence with running or failed status before doing new work. Reports and documentation indexes are excluded from its source identity; executable sources and the canonical fixture are included.

The frozen run finished at `2026-10-28T18:12:34.187Z`: all 44 actual Lean invocations met expectations, comprising 32 successful checks and 12 expected proof rejections. The source identity is `f5ba08fa475683f1a27927bc9c65c858ab86233bd3d52cefc6985efc5cbee6c6`. Four focused Node tests passed. Existing Bool files, test inputs, and recorded 130 outcomes were not changed; the parent integration run remains responsible for rerunning those outcomes on the integrated commit.

The new cases include 21 raw-byte admission mutations, eight metadata proof mutations, original-source mismatch for a valid changed module name, acceptance under that changed name, typed and numeric boundary checks, and three executable-machine proof mutations. Removing the trace, reversing the quality branch, or erasing the fault-choice increment must break the kernel proofs. A valid renamed module may load successfully while failing equality to the original source; validity and original identity are separate assertions.

The optional differential accepts explicit native/WASM paths and provenance. The observed run used frozen runtime copies from source `67545be0eb07320889b219c5b1971b64b9f56641`. That source's overall verification failed an unrelated replay-size assertion, and its build identity was removed. These copies are not represented as a passed identified build.

| Artifact | SHA-256 |
| --- | --- |
| Actual compiled module | `184fcffc874b0e0ce4106407a8559f64392d4aeed5c9186f4abc871716fa126e` |
| WASM copy | `1d0af12b5c6aa73ff7815027f0c8f8472f43f27d2b0d7af5ab04a2202a08c398` |
| Native copy | `9326f2216a64b551f0f6366d3a77dc7f5c2b946c9e846ee4135fdc5ff200f44b` |

At `2026-10-28T18:12:34.119Z`, all 30 raw-rail observations passed across native, plain WASM, and framed WASM: two healthy values and all four faults with both stale payloads per runner. Another 20 observations passed through canonical plain/framed host quality adapters. Seven raw boundary checks and 18 malformed quality/type checks passed. The raw VM accepts fault rails -1 and 4 but source trace observation rejects their inconsistent origin or out-of-domain choice; fractional .5 fails VM trace validation, and NaN/infinity fail the input setter. These are distinct validation layers.

## Remaining trust

The production literate parser, source projection, source map and manifest construction, canonical quality adapter, JavaScript certificate serialization, and interpretation of source intent are not proved. Lean checks the supplied raw bytes and projected metadata exactly; it does not prove that JavaScript supplied the intended source projection. The canonical format model and typed PC semantics are not proved equivalent to Rust loading/execution or f64. The Lean kernel and standard logical foundations remain trusted. There is no general compiler correctness, arbitrary numeric correctness, stateful sensor behavior, hardware behavior, deployment, or product acceptance claim.
