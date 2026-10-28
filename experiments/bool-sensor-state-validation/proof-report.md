# Bool sensor state input-history proof report

This [#590 unit](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6478702192) connects original canonical source bytes to raw-module execution for every finite input history. The bounded source has one required Bool sensor, one Bool state with either literal initial value, one Bool output, and this transition and connection:

```ghost
held' = if (trigger |> recover(false)) then !held else held;
relay <- held';
```

Names are parameters. Each healthy true reading toggles the stored state. Healthy false and all four SensorFault values preserve it, regardless of stale payload. The output requests the candidate state. Result events retain the healthy/fault distinction and exact fault code. This is a separate profile; previous zero-input Bool and stateless sensor proofs are unchanged.

## Source and module admission

`SensorStateSource.readSource` reads the original UTF-8 byte list using the previous bounded Markdown envelope and token reader. It accepts the declaration order and expression above, comments and whitespace, and an optional bounded intent anchor. It rejects extra declarations, extra expressions, candidate reads inside the transition, old-state output reads, name collisions, other initial expressions, and recovery defaults other than false. It inherits limits of 65536 source bytes, ASCII identifiers, LF endings, one unindented ghost fence, restricted prose, and one optional anchor with one quoted paragraph. This is not a complete CommonMark or GhostFlow parser.

The reader allocates nodes while parsing. Input declaration is node 1; the state initializer and declaration consume nodes 2 and 3; output declaration consumes 4; the input reference, fallback literal, and recover call consume 5, 6, and 7. The accepted site 7 therefore comes from the parser allocator, with an explicit profile guard. The theorem does not assume a JavaScript-reported site without checking original source bytes.

`SensorStateProfile.load` independently parses the complete raw module. It checks module header, three typed input rails, one Bool state and initializer, control strategy, transition target and blob, output name/type/blob, and footer. Full consumption and exact canonical encoding bind the query and every consumed field. Names are bounded at 128 bytes, blobs at 4096 bytes, and modules at 1048576 bytes. The loader's executable blobs are the values read from raw bytes. It does not consume JavaScript offsets, decoded instructions, or a rewritten artifact.

The generated certificate checks the actual compiled byte list, original source byte list, and projected actual sensor/Result metadata with Lean `decide`. Metadata binds rail order, types, site/node, recovery kind, SensorFault error domain, origin tag/node, and sensor name. State transition explanation bindings, full source locations, source-map fidelity, and natural-language intent interpretation remain outside the theorem.

## Execution and composition

`SensorStateRecovery` reuses the typed Bool/Number values, Reading domain, byte readers, and numeric contract from the stateless profile. Its raw-PC step model adds actual opcodes 4, 5, and 10 for old state, candidate state, and negation. Opcode 56 checks a supplied trace bound and appends the event. The module executes with the derived one-event bound; the contextual recovery theorem permits arbitrary existing traces below a supplied bound and arbitrary stack tails with room for three values.

`recovery_context` proves that the recovery prefix preserves the entire stack tail and prior trace, adds the recovered Bool, and appends exactly the expected event. It quantifies over every healthy Bool, every SensorFault, both stale payloads, and arbitrary old/candidate environments. `transition_execution` composes this prefix with the state branch over actual bytes. `output_execution` proves that opcode 5 reads the calculated candidate. The transition and output share the same input snapshot and old-state snapshot; only the output receives the candidate.

`scan_refinement` combines these expression results into state, requested output, and events. `input_trace` uses induction over `List ScanInput` to establish the result for every finite input history and either initial Bool. `original_source_input_trace` connects that result to original source reading, raw loading, and actual metadata binding. It requires explicit `SmallNumberLaws`, sourceRead, rawLoad, and metadataBound premises. It does not replace raw execution with an expected-output table.

The numeric contract requires exact integer extraction for literals 0 through 4 and exact addition of one to literals below 4. Nat satisfies this contract in Lean. Production f64 and Rust/model correspondence remain unproved.

## Reproduce

Run the focused bridge tests and kernel verifier independently of the production build:

```sh
node --test tests/bool-sensor-state-validation.test.mjs
node experiments/bool-sensor-state-validation/verify.mjs \
  --lean /absolute/path/to/lean-4.19.0/bin/lean \
  --evidence-dir build/sensor-state-proof-590
```

The verifier records source hashes, generated inputs, executable/version identity, actual exit codes, diagnostics, logs, and UTC timestamps. It rejects proof escapes and any successful check whose axioms contain `sorryAx`. It replaces old success evidence before a new run. Successful admission and expected proof failures are counted separately. Counterchecks cover source changes, initializer changes, wrong state/candidate references, site/origin changes, metadata, projection, raw byte tampering, parser allocation, and machine behavior.

The supportive differential has a separate entry point:

```sh
node experiments/bool-sensor-state-validation/differential.mjs \
  /absolute/frozen/runtime/worktree \
  /absolute/passed/verification.json \
  build/sensor-state-differential-590
```

It copies runtime files into its evidence directory, checks them against the passed receipt, and matches all recorded Rust/Cargo source hashes to the current worktree before running. It does not build or write the shared runtime target directory.

## Observed checks

The focused bridge run passed 20 Node tests, including the existing Bool and stateless sensor bridge regressions. At `2026-10-28T19:46:05.483Z`, 168 native/plain-WASM/framed-WASM scan observations passed for both initial values. The histories include repeated true inputs, healthy false, every SensorFault, and both stale payloads. Each check compares old state, committed candidate state, requested/safe output, Result event, and fault interpretation.

The runtime files came from the passed build 169 record at source `cf1844700ca8835e08a69d13bf60fadc8a22d493`. All 100 recorded Rust/Cargo source entries matched. The copied WASM SHA-256 is `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`; the copied native SHA-256 is `d2d15f7c9e86cad4df70f8ba15d710a2933f6a4a02a878bc09560cadba3dee16`. These are reused runtime artifacts, not a fresh build of this proof change.

The generic theorems and actual original-source certificate passed Lean 4.19.0. The checked declarations use only `propext` and `Quot.sound`, or no axioms. No proof escape was accepted. The full countercheck run is recorded separately in the verifier's `verification.json`. The parent integration run owns the complete prior-proof regressions, production gates, and independent review on the integrated commit.

## Limits

The Lean kernel and standard logical foundations, source/artifact transport into Lean literals, the bounded grammar specification, and numeric laws remain explicit trust boundaries. The independent model is not proved equivalent to the production parser, full compiler, Rust loader, Rust VM, or host quality adapters. Finite runtime observations support this profile but do not prove general correspondence. The experiment proves no hardware behavior, physical output, deployment, or product acceptance.
