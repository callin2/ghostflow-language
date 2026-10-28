# Elapsed state epoch selection

This bounded unit belongs to [issue #590](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6482177317).
It proves the generated start-time and initialization transitions for the canonical SensorToggle program with `timer age = elapsed(held)`.
The Duration value is unused. The proof covers epoch selection and preserves the compiler's emitted duplicate recovery events.
Whole compiler correctness remains open.

## Exact source and artifact

`fixtures/elapsed-toggle.ghost.md` is the original canonical document.
Its SHA-256 is `abe723116bd950fbe029b838afb25348ed3c551ae6e4b5b7693358c89de8fdf9`.
The production compiler emits a 419-byte GFB3 module, SHA-256 `cb1a17b373a47bca6e598c6a4f3c7640e37b328100c9a2983aa5202d9df61c1a`.

| Field | Actual binding |
| --- | --- |
| Sensor rails | value 0, quality 1, fault 2 |
| Clock input | Number slot 3, `__gf_now_ms` |
| Old state slots | held 0, Number since 1, Bool initialized 2 |
| Held transition | raw offset 241, length 58 |
| Since transition | raw offset 305, length 87 |
| Initialized transition | raw offset 398, length 2, literal true |
| Output expression | raw offset 414, length 3, candidate state slot 0 |
| Source identities | sensor 1, recovery site 7, timer node 18 |

The generated since transition embeds the held transition again.
When initialized is false, the since expression selects the clock directly.
On later scans it compares the recomputed candidate Bool with the old held Bool.
Equal states retain the old since value. Changed states select the current clock.

## Formal boundary

`EpochSource` reuses the independent literate reader, lexer, node allocator, and SensorStateSource parsers.
It adds the bounded trailing timer declaration and checks that `elapsed` refers to the declared state.
The actual certificate independently reads the original document bytes, including the timer's source node allocation.
The JavaScript AST projection does not replace this formal source reader.
The document grammar remains bounded and does not prove the full production CommonMark parser.

`EpochModule` reuses ModuleLoader's Reader operations.
It reads the entire actual module, all four input fields, three states, transition targets, capability query, output, and final constraint count.
The Number initial state admits exactly the eight zero bytes emitted for Number 0.
The certificate checks complete consumption and binds all four expression slices to their formal code lists.
Source-derived metadata independently binds the sensor rails and recovery origin, timer name, tracked state, clock input, and both generated state bindings.
The original-source trace theorem requires that metadata equality.

`EpochMachine.step` handles only Bool equality opcode 13 locally.
Every other opcode delegates to the unchanged SensorStateRecovery implementation.
`step_conservative` requires that the opcode at the current execution PC is not 13.
The optional `steps_conservative` theorem has a stronger hypothesis over every State and PC.
That hypothesis also excludes a data byte equal to 13. It is not an assertion that an actual execution avoids equality.
The actual since proof uses explicit PC paths and the equality suffix, independently of that stronger theorem.

The `runValue` adapter executes a supplied finite step count through the shared State, PC, and stack representation.
It checks the count bound, final PC equal to code length, and a single Value on the final stack.
Explicit 13-step healthy and 12-step fault recovery paths compose with short guard, toggle, comparison, and selection paths.
The adapter sequences the three generated transitions against the same old state and reads the output from their candidate state.
It is a model of this adapter and selection sequence. It does not prove Rust VM refinement or the production atomic commit mechanism.

`all_histories` quantifies over every finite history of readings, stale Bool payloads, and Number parameters.
The Number implementation satisfies the existing explicit `SmallNumberLaws` for recovery literals and addition.
Clock and since values pass through without arithmetic or Number equality.
The theorem covers first initialization, retained state, changed state, every acquisition fault, and arbitrary stale payloads.
Separate theorems state first-scan clock selection, retention, reset, stale-payload independence, and event counts.

The modeled whole scan emits one recovery event while the old initialized flag is false.
It emits two identical source-site events while that flag is true because the since expression recomputes recovery.
The model uses trace bound two and preserves both events.
Duration subtraction, f64 correspondence, arbitrary timer expressions, physical three-second behavior, and complete compiler correctness remain open.

## Verification and retained attempts

`evidence-summary.json` records final receipt digests, input fingerprints, outcomes, exact negative theorem locations, and all raw module bytes.
The fresh Lean command exits with code 0 after 51 expected outcomes: 32 successful checks and 19 targeted rejections.
All five focused Node tests pass, including the receipt failure regression.
The verifier imports and fingerprints the shared `experiments/lean-outcome.mjs` admission helper.
Semantic mutants first pass full module parsing and then fail `targetedEquality` at its exact expected line.
Metadata and source mutants must fail their own binding theorem at its exact line.
Timeouts, signals, infrastructure diagnostics, and successful results containing `sorryAx` do not count as expected rejection.

The finite production observation covers all 100 two-reading histories and one three-scan history with repeated clock values.
Across native, WASM, framed WASM, canonical acquisition, and canonical framed acquisition, all 1,015 scans preserve old and new state, requested and safe output, and the full event list.
Framed adapters derive the reserved clock from logical scan time. They receive no explicit reserved clock input.
The first observation attempt preserved a rejection when an explicit reserved clock input was supplied.

The helper reuses exact build183 binaries and records `builtByThisRun: false`.
It checks all 100 Rust and Cargo source hashes against that receipt and fingerprints the JavaScript wrappers before execution.
The receipt SHA-256 is `1f1d03c4919cf4bd8b7be803069d8a158e46a327438bc4e7d1306f2177ca5d1f`.
The native binary SHA-256 is `28aa4823424e7ce3055f2ea1cb08f59ca93ba926bd6142b593870156a6cd4e90`.
The WASM binary SHA-256 is `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`.
No compiler build, firmware upload, or hardware test is part of this unit.

The runtime helper publishes an atomic running receipt before provenance reads, then a fresh passed or failed receipt.
A focused regression test starts with a passed receipt, supplies a missing runtime source, and checks replacement by failed with exit code 1.
Development logs retain the initial direct-unrolling timeouts and subsequent tactic failures.
The final proof composes known-PC paths instead of increasing the 180-second process limit.
Raw evidence remains under the ignored `build/elapsed-epoch-validation` directory and must be retained separately when archiving the worktree.

## Reproduction

The commands run from the repository root with the pinned Lean 4.19.0 executable in `LEAN`.

```sh
npm ci --offline --ignore-scripts
node --test tests/elapsed-epoch-validation.test.mjs
node experiments/elapsed-epoch-validation/verify.mjs --lean "$LEAN" --evidence-dir build/elapsed-epoch-validation/replay
node experiments/elapsed-epoch-validation/runtime.mjs ../ghostflow-int32-integration-590 build/elapsed-epoch-validation/runtime-replay
```

The runtime command requires the unchanged build183 receipt and binaries in the supplied sibling checkout.
