# Two independent Bool recovery expressions

This unit extends the bounded recovery proof under [issue #590](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6481722734).
It proves two independent expression evaluations over the same six input rails.
The complete compiler correctness obligation remains open.

## Artifact and source identities

The canonical source is `fixtures/two-recover.ghost.md`.
Each output reads its own input and applies `recover(false)`.
The production compiler emits a 373-byte GFB3 module with this layout.

| Output | Input slots: value, quality, fault | Recovery site | Fault origin | Raw byte slice, zero based |
| --- | --- | --- | --- | --- |
| `left_out` | 0, 1, 2 | 7 | 1, sensor `left`, source node 1 | start 265, length 45 |
| `right_out` | 3, 4, 5 | 12 | 2, sensor `right`, source node 2 | start 326, length 45 |

The original document SHA-256 is `40d1d8fe313ba2520683bfed498e0c2d3f6e92d9553f4ba5321cba64b4737f6c`.
The complete module SHA-256 is `8138ca3df95eed927064beb1a3f0481b91b2a95885bcfca48b8217a6a67cab08`.
The verifier preserves the original document, complete bytes, source projection, manifest, and trace metadata in its evidence directory.

## Theorem boundary

`SensorPairMachine.lean` imports the existing `SensorMachine` without changing it.
Its two layouts use the same `step`, `Steps`, `steps_execute`, and fuel-bounded raw-PC interpreter.
Healthy paths have 13 steps. Fault paths have 12 steps.
Each path reads the actual slots, executes the actual branches and Number addition, and emits opcode 56's actual site and origin.

`paired_recovery` quantifies over both `Reading` values and both stale Bool payloads independently.
Each reading can be healthy true, healthy false, or any of the four sensor faults.
The left evaluation returns the left reading's expected value and event. The right evaluation returns the right reading's expected value and event.
Consequently, the other input's healthy value, fault, and stale payload cannot change that expression's result.
`false_distinguished` also separates healthy false from every recovered fault by its event.

The number implementation remains an explicit parameter.
`SmallNumberLaws` requires integer extraction for literals 0 through 4 and exact addition of one below 4.
No theorem proves that all production f64 operations satisfy these laws.

`PairModule.readRaw` reuses the existing `ModuleLoader` Reader operations.
The exact artifact certificate proves complete module consumption, the six named and typed inputs, both named Bool outputs, and the two expected code slices.
`actualPairedExecution` then connects the parsed output code to the universal paired theorem.
The expected trace metadata comes from the original AST projection and fixed source identities, independently of the compiler's returned metadata.
The certificate checks the actual sensor rails, recovery sites, origin tags, source nodes, kinds, and names against that expectation.
The capability query is preserved as an exact parsed byte field. Its general source-to-query correctness is outside this unit.

The formal evaluation starts each output expression with its own empty trace.
The existing trace capacity stays at one. This theorem does not describe a whole scan's trace collector.
The production observations below separately check two collected events per actual scan.

## Source trust and remaining obligations

The JavaScript bridge checks the original canonical document through the production literate extractor and AST parser.
It admits exactly two Bool inputs, two Bool outputs, and their own `recover(false)` connections.
The original source bytes are retained in the Lean certificate and checked against the pinned original bytes.
The JavaScript AST projection, production source-node assignment, byte locator, and transport into Lean remain trusted.
The existing single-sensor formal source reader is unchanged and does not verify this two-sensor document.

The full CommonMark reader, production parser and compiler refinement, general input layouts, Rust VM refinement, f64 correspondence, and universal scan trace collection remain open.
Natural-language anchor intent correspondence also remains open.
This unit changes no production compiler or runtime behavior and claims no hardware execution.

## Verification evidence

The final verification receipt and focused test log are recorded in `evidence-summary.json`.
The final run exits with code 0 after 40 expected Lean outcomes: 23 successful checks and 17 targeted rejections.
It checks fresh Lean dependencies, the universal theorem, the exact artifact certificate, and targeted negative certificates.
The focused Node test command exits with code 0 after seven tests pass.
Every semantic byte or source-swap mutant first passes complete structural parsing.
Its expected rejection must occur on `targetedEquality` itself, with the expected false-proposition diagnostic.
Metadata and original-source mutants must fail on `metadataBinding` or `originalBytesBound`, respectively.
Infrastructure errors, timeouts, signals, and successful proofs containing `sorryAx` never count as expected rejection.
The verifier imports and fingerprints the shared `experiments/lean-outcome.mjs` admission helper.

The finite runtime check covers 100 input combinations across five paths: native, WASM, framed WASM, canonical acquisition, and canonical framed acquisition.
All 500 scans match both requested values, both safe values, both Result events, and their decoded sensor and fault identities.
The input choices include both healthy Bool values and every sensor fault with both stale payloads, independently for each sensor.

These observations reuse the exact native and WASM binaries from build183, source identity `8c4b407a46f596cffb950ea4a310adeb4accaf51`.
All 100 Rust and Cargo source hashes match the receipt and this checkout before execution.
The runtime script also fingerprints its JavaScript wrappers and records that it did not build these binaries.
The reused receipt SHA-256 is `1f1d03c4919cf4bd8b7be803069d8a158e46a327438bc4e7d1306f2177ca5d1f`.
The native binary SHA-256 is `28aa4823424e7ce3055f2ea1cb08f59ca93ba926bd6142b593870156a6cd4e90`.
The WASM binary SHA-256 is `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`.

The earlier attempts remain under `build/two-sensor-provenance/attempt1` through `attempt5`.
Attempt1 exceeded its initial 60-second proof process limit.
Attempts2 and 3 retained Lean elaboration and final-PC tactic errors.
Attempt4 checked the generic theorem but exceeded the 180-second limit while compiling a single long Reader declaration.
Splitting that Reader into header, strategy, and body definitions reduced its profiled compilation to four seconds.
Attempt5 checked the full artifact execution theorem but rejected an ambiguous generated metadata identifier.
The corrected standalone certificate then passed with no axioms for the raw read and metadata equalities.
Its execution theorem depends on `propext` and `Quot.sound`.

The raw evidence directories are ignored build outputs and must be retained separately when moving or archiving this worktree.
The committed summary retains their receipt and log digests plus the complete module bytes.

## Reproduction commands

The commands run from the repository root. `LEAN` denotes the pinned Lean 4.19.0 executable.

```sh
npm ci --offline --ignore-scripts
node --test tests/two-sensor-provenance.test.mjs
node experiments/two-sensor-provenance/verify.mjs --lean "$LEAN" --evidence-dir build/two-sensor-provenance/replay
node experiments/two-sensor-provenance/runtime.mjs ../ghostflow-int32-integration-590 build/two-sensor-provenance/runtime-replay
```

The runtime command requires the unchanged build183 receipt and binaries in the supplied sibling checkout.
It verifies the receipt, source files, and binary hashes before executing the observations.
