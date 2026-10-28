# Independent Bool module loading and initialized trace proof report

Work item [#590](https://github.com/callin2/ghostflow-language/issues/590) aims to make generated control artifacts mathematically auditable and to identify the remaining trusted components.
This experiment adds an independent Lean reader for the bounded Bool module profile.
It does not prove the production compiler or Rust runtime.

## Owned data and admission

`ModuleLoader.load` takes only a list of raw bytes.
It reads the header, named initial states, strategy metadata, expression lengths and bodies, named outputs, and footer.
The result owns a `Module` containing the names, initial Bool values, transition expressions, and output expressions.
Transition expressions prohibit candidate-state reads through their existing phase-indexed type.
The existing `Serialization.decode` reads each expression blob from the actual input.
No JavaScript offset, count, target, parsed expression, or source-module argument enters the loader.

The reader limits names to 128 bytes, state and output counts to 128, expression and query blobs to 4096 bytes, and the full module to 1048576 bytes.
It rejects truncated integer fields and lengths that exceed the remaining input.
`readMany` decreases a natural count on every recursive call, and only bounded counts reach it from the module reader.
Expression decoding uses the existing terminating decoder.
These are termination and admission bounds, not a real-time execution-cost proof.

Admission requires an empty remaining tail and `encodeModule parsedModule = .ok raw`.
The canonical equality checks every byte, including transition targets, capability queries, format, counts, names, types, initial values, priority, and constraints.
It also enforces scope, unique names, expression bounds, and the existing profile rules.
The reader consumes target and query fields without retaining them in `Module`; the final equality is what checks their required meaning.
`readModule` alone is a parser, not the admission interface.

The owned-module design reuses the existing typed expression model.
The considered alternative would retain separate raw expression lists and duplicate their consistency relation with the parsed expressions.
The chosen representation avoids that extra invariant.
The reader is split into header, strategy, output, and module stages because a single deeply nested reader caused Lean code generation to stall during development.

## Kernel contracts

| Theorem | Contract |
| --- | --- |
| `load_sound` | Every accepted module re-encodes to exactly the complete raw input. |
| `load_consumed` | Acceptance implies that the independent reader returned the owned module with no remaining bytes. |
| `load_of_read` | Exact reader output plus canonical encoding equality suffices for admission. |
| `loaded_tick` | For every environment, a loaded module's raw-byte tick equals its typed source tick. |
| `loaded_initial` | Initial state values come from the loaded state declarations in order. |
| `trace_refinement` | For every tick count and starting state list, byte execution equals the loaded module's source trace. |
| `initialized_trace` | For every tick count, loading and running from declared initial values produces the corresponding source trace. |

`byteTrace` calls `ModuleEnvelope.rawTick` on every tick and carries the resulting state values into the next tick.
`rawTick` executes slices of the original raw module through `ByteMachine.execute`.
Its layout now comes from the independently loaded module rather than a source argument supplied to the loader.
The existing section-partition and execution theorems justify those slices through `load_sound`.
The trace theorem therefore covers byte-machine execution of the raw artifact, including simultaneous old-state transitions and candidate-state output reads.

The profile has no external input slots.
Trace environments use the current state list for previous-state reads and false for unused input and initial candidate functions.
The output phase receives the candidate state computed by the transitions.
Out-of-scope references are rejected at admission.

For each real compiler fixture, `loader-bridge.mjs` generates a theorem that the raw bytes load to the expected source projection.
The proof expands the independent reader and the expression decoder's checked equations, then verifies exact canonical bytes.
This avoids relying on a compiled native decision procedure.
The resulting theorem is composed with generic initialization and all-natural-number trace theorems.

There is no generic theorem that every valid `encodeModule` output can be loaded.
Completeness is established by exact kernel proofs for the compiler fixtures and boundary examples in this experiment.
The generic soundness and execution theorems apply to every accepted raw module.

## Oracles and verification

The previous 81 Lean invocations and 11 JavaScript admission assertions remain in the verifier.
The new boundary cases cover empty modules, state initialization, a repeated simultaneous swap, zero ticks, malformed integers and lengths, truncated and trailing data, phase violations, out-of-range references, zero-input violations, and duplicate names.
All three existing real compiler fixtures receive exact-load, whole-byte, full-consumption, initial-state, all-environment tick, and all-tick-count trace certificates.

Metadata mutations are checked through the raw loader without JavaScript decoded witnesses.
Changes to an initial Bool, a valid module name, or a valid state name may represent a different valid program.
Those bytes must load successfully, while their equality to the original source module must fail.
Changed capability queries, targets, unsupported types or formats, malformed counts and lengths, and trailing bytes must fail admission.
This distinction prevents treating source identity and format validity as the same claim.

Proof mutations remove canonical admission, invert initial values, or retain the previous state instead of advancing between ticks.
The corresponding generic theorems must fail kernel checking.
Independent review also supplied a concrete semantic oracle for the canonical check.
`badTargets` contains two transition records both targeting slot 1.
The kernel proves that `readModule` consumes those bytes and returns the owned module, while `load` rejects them.
A parser-only admission function accepts the same bytes, and the public trace interface rejects them even for zero ticks.
This pair establishes an actual admission difference in addition to the structural proof failure caused by deleting the guard.
Successful invocations are rejected if their logs contain `sorryAx`; proof sources exclude `sorry`, `admit`, `axiom`, and `native_decide`.

Run the checks from the repository root.

```sh
node --test tests/bool-translation-validation.test.mjs
node experiments/bool-translation-validation/verify.mjs \
  --lean /Users/changjin/Documents/PlatformIO/Projects/esp32s3-new-project/.tools/lean589/lean-4.19.0-darwin/bin/lean \
  --evidence-dir build/bool-module-loader-590
```

The generated `verification.json` records individual actual Lean invocations, JavaScript assertions, process exit codes, expected diagnostics, timestamps, source identity, proof input hashes, and log hashes.
The frozen-source full run passed at `2026-10-28T17:29:51.150Z` with 130 expected outcomes.
These comprise 119 actual Lean invocations, 58 successes and 61 expected rejections, plus 11 JavaScript admission assertions.
All 92 previous outcomes retain their names, expectations, and Lean input hashes.
The frozen source identity is `f14eae533d798aba6240a0e0e05ff8a38a3536a59b4a80893503c7c01483a0ad`.
The full report SHA-256 is `928cb1527bcd9271d6462abdb4577881e18f5c2305d266cb6cd04bbcad3a4958`.

The concrete `badTargets` review oracle was added after that frozen run.
Its final boundary-file kernel result is recorded separately in `build/bool-module-loader-final-590/focused-verification.json`.
The full-run source hash therefore describes the pre-oracle tree, not the final tree.
The parent integration run is responsible for fresh complete verification of the final committed source.
The focused Node suite passed 9 cases before the oracle-only addition, and documentation validation passed.

## Remaining trust

The production literate parser, typed source projection, and JavaScript emission of source literals remain outside the kernel proof.
The loader itself receives only raw bytes, but the claim that its returned module represents the intended source still uses that source projection.
The canonical module format model and byte-machine semantics are not proved equivalent to the production Rust loader and runtime.
The new Lean loader and trace functions are not a production loader replacement.
The Lean kernel and its reported standard logical foundations remain trusted.
No Rust build, official build allocation, firmware upload, physical I/O, deployment, or product acceptance is established by this experiment.
