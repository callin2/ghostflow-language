# Instance trace projection reference adapter

Each projected record preserves the activated `sourceDocumentSha256` and `bytecodeSha256`, so persisted or independently joined observations retain their exact compilation revision.

The `tools/instance-trace-projection.mjs` adapter is a small production reference owner for REF-06-003 instance display and trace projection. It does not change the GhostFlow source grammar or evaluate expressions. It validates an already compiled artifact and projects observations that the compiled runtime emitted through `observeSourceTrace()`.

Activation verifies the complete source-bound identity before accepting display metadata:

- the canonical root `sourceDocument` text and SHA-256;
- every imported source-closure document text, immutable revision and SHA-256;
- bytecode SHA-256 against the control manifest and trace metadata;
- recompilation of the exact root source and imported closure, with bytecode, manifest, source closure, source map and trace metadata matching the supplied artifact;
- explicit labels for exactly the compiled instance IDs.

Display labels and the presentation revision are adapter metadata. They are not source revisions, do not rename instances, and do not affect semantic trace keys. A caller may move files, change declaration order or change presentation labels while keeping the same authored instance IDs; the projection remains keyed by emitted instance identity and authored symbols derived from source/source-map metadata. If the authored instance IDs change, the old trace identity is not aliased.

`projectTrace(trace)` rejects traces whose module fingerprint does not match the activated artifact, then joins the actual source trace observations. It returns entries with the compiled instance ID, display label, source node, authored symbol, and observed trace fields. The compiler's original parsed declarations are joined through each source-map `definitionNodeId`; multiple declarations on one line or across lines retain their own symbols. Private VM slot names and numeric node order are not public semantic keys. Keys plus observation kind identify the state and next-state views, while node IDs and locations retain exact artifact provenance.

Activation owns both compilation and presentation inputs before asynchronous verification. Projection returns deeply frozen copies and does not freeze or mutate the caller's runtime trace. The only projection entry point accepts an actual source trace with the activated module fingerprint; no unchecked observation input, custom verification callback or test-only ownership option is exposed. `presentationRevision` is required and cannot be supplied as a source revision. Labels are bounded nonempty well-formed text without control characters; bounds belong to this reference adapter, not to source-language policy.
