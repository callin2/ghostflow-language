# Model independent authoring workflow

See the [toolchain architecture](LLM-TOOLCHAIN-ARCHITECTURE.md) for the artifact,
scenario, runtime, console, and device boundaries behind this example.

This offline example starts with a fictional user request: “Start requests the pump. Stop cancels it. If permission is absent, block the pump.” The user has not supplied a maximum run duration or a restart rule. The author records that open question as an **unconfirmed assumption** and asks the user before adding any timer or duration policy. The confirmed request can be checked and simulated independently. No model provider or device driver participates.

The only editable program in this run is `build/authoring/pump.ghost.md`. The two files under `examples/authoring/` are immutable historical revisions of that one complete literate document. Both carry prose and intent anchors. There is no separate raw-code program.

## Retrieve the exact rules

From the repository root, use TOON requests to retrieve [§1.2, source and intent links](reference/01-source-and-syntax.md#12-원문-위치와-의도-연결), [§1.5, declaration skeleton](reference/01-source-and-syntax.md#15-대표-선언-골격), and [§4.7, requested and safe intent](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed). The returned `citation` and `digest` identify the exact Reference excerpt used in the decision.

```sh
node tools/reference-query.mjs --toon-request examples/authoring/intent-reference-request.toon
node tools/reference-query.mjs --toon-request examples/authoring/syntax-reference-request.toon
node tools/reference-query.mjs --toon-request examples/authoring/reference-request.toon
```

## Check, correct, and compile one document

```sh
mkdir -p build/authoring
cp examples/authoring/pump-rev-1.ghost.md build/authoring/pump.ghost.md
node tools/ghostc.mjs --request examples/authoring/check-rev-1.toon
```

The first check exits nonzero. Decode the TOON result and use `diagnostics[0].span` to locate the incomplete `pump <- start && ;` expression in the original `.ghost.md`. Its `source.sha256`, `documentId: GF-EXAMPLE-PUMP`, and `revisionId: rev-1` identify the failed revision. [§1.5, declaration skeleton](reference/01-source-and-syntax.md#15-대표-선언-골격) and the diagnostic support correcting that expression to `pump <- start && !stop;`. The author edits the **same** `build/authoring/pump.ghost.md`; the following copy command reproduces that edit from the reviewed revision 2 fixture.

```sh
cp examples/authoring/pump-rev-2.ghost.md build/authoring/pump.ghost.md
node tools/ghostc.mjs --request examples/authoring/check-rev-2.toon
node tools/ghostc.mjs --request examples/authoring/compile-rev-2.toon
```

The successful check reports the same document ID, revision `rev-2`, and the new SHA-256 of the full Markdown document. Compilation writes GFB plus the verified source map. The source map preserves the exact prose, anchors, document/revision IDs, and GFB digest. The failed revision remains historical evidence, while revision 2 is the candidate artifact.

## Inspect virtual output

```sh
cargo build --locked --offline --release -p ghostflow-core --example scenario_scan
node tools/ghostsim.mjs build/authoring/pump.gfb examples/authoring/pump-scenario.toon --format toon
```

The scenario scans at 0, 1, and 2 ms. At 0 ms, `pump` is requested but `permit` is false, so the safe pump intent is false. At 1 ms, permission becomes true and the safe pump intent is true. At 2 ms, stop becomes true and both intents are false. These are virtual intents, not applied or confirmed relay states. The result identifies the exact compiled source revision.

The optional ASCII console for the same artifact is `node tools/ghostsim-console.mjs build/authoring/pump.gfb --bind DI1=start --bind DI2=stop --bind DI3=permit_ok --bind RO1=pump --bind RO2=permit`. With no profile, the console uses virtual Waveshare 8DI/8RO labels. Explicit bindings connect those labels to this document's logical ports; they make no claim about physical pins.

## Open question for the user

> Should the pump stop after a maximum run duration? If yes, what duration and restart rule should apply?

Until answered, the author leaves that behavior unresolved. No timer, guessed default, or invented syntax is added to the document. The host retains this question and the document identity when asking the user; the language package does not make model calls or record conversations.

Run the complete offline fixture check with `node --test tests/authoring-workflow.test.mjs` after building `scenario_scan`. It uses the public Reference, compiler, and simulator CLIs and checks the same-document revision change, diagnostic location, artifact provenance, and virtual intents.
