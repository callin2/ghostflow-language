# Bounded observation event history

`prepareObservationEventHistory` in `tools/observation-event-history.mjs` implements the adopted Reference §5.3 event-retention boundary in a source-bound reference host. It keeps explicit producer events separate from the latest completed snapshot. A snapshot never reconstructs an event that was not supplied by the producer.

This helper is a reference API, separate from Interaction snapshot v0 and the execution environment's final event, command-result and alarm serialization or transport. It adds no source keyword or command/alarm state machine. The trusted producer supplies explicit `{kind, payload}` event facts and an already-completed shared Rust core trace; the journal neither evaluates a control nor certifies a physical claim.

## Activation and publication

Activate with `{compilation, schema?, runId, capacity?, maxEventsPerScan?}`. The existing completed-snapshot owner copies and verifies the exact compiled literate source, emitted schema, module and source identities before activation. Capacity and batch limits are explicit integers from 1 to 4096, defaulting to 256. They are bounds of this reference host, not operating policy selected for every installation.

`publish({completion, trace, settingsState?, events})` first validates the complete explicit event batch and the completed trace. A publication must advance the completed scan ID and must not regress logical time. The producer's snapshot checks retain source/Program identity, declared observation types and settings Result semantics. Bad metadata, a foreign trace, sparse/noncanonical JSON, duplicate scans, oversized batches or payloads reject before any journal mutation. A valid retry can use the same completion after rejection.

Each accepted event receives a strictly increasing per-run sequence, the full schema/module/source/run identity and its actual completed-scan identity. Event identity is the combination of execution identity and sequence. Multiple explicit events may belong to one scan; a scan with no events still updates the latest snapshot without advancing event sequence. Public kind text is bounded, nonempty and excludes control characters and reserved private names. Payloads are owned canonical JSON with safe integer and sparse-array checks, bounded to 16 KiB UTF-8 per event. Returned records and snapshots are deeply frozen copies.

## Retention and cursors

`read({cursor?})` returns retained events after the cursor, explicit `gaps`, the latest `snapshot`, retained sequence bounds and a `nextCursor`. A cursor carries exact execution identity plus `afterSequence`; it cannot be reused across a new run or different source, Program or schema. Reading is repeatable until the consumer saves the returned cursor, so repeated records retain their original identities for duplicate detection.

If a consumer saved sequence 10 and retention now begins at 14, delivery is:

```text
gaps: [{from: 11, to: 13, reason: "retention"}]
events: [the original event with sequence 14]
snapshot: the latest completed observation, kept separately
```

The journal emits no synthetic events for 11–13. If 11–14 are still retained, it delivers all four and reports no gap. At the exact retention boundary, only genuinely unavailable sequences are reported. Empty history has a null snapshot and no gaps; subsequent scans without explicit events do not turn snapshot changes into events. A connection can resume using its saved cursor; records lost beyond retention are reported rather than reconstructed. A different run is an identity mismatch, not an ordinary sequence gap.

## Verification and limits

REF-05-022 executes one exact source in production native Rust and framed WASM, compares every outcome, and feeds both traces through the same actual host journal. Complete delivered batches, gaps, snapshots, identities and cursors agree on fresh replay. Negative tests preserve the journal and prove valid retry, cursor identity checks and caller-mutation isolation.

The journal is JavaScript reference-host retention, not a native Rust journal, durable network storage, a final product protocol, event authenticity service or Device deployment. Producer event payloads are explicit external facts; a completed core scan or a caller's `kind` cannot elevate output intent into applied or confirmed physical evidence. The independent requested/safe/applied/confirmed boundaries and final transport ownership remain as adopted.
