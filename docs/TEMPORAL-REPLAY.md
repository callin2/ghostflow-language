# Temporal replay through the WASM adapters

Static temporal resource planning is specified in
[TEMPORAL-RESOURCES.md](TEMPORAL-RESOURCES.md).

`GhostFlowRuntime` and `FramedGhostFlowRuntime` expose the low-level adapter
operation synchronously:

```js
const replay = runtime.replayTemporal({
  count,
  profile,
  maxPeakTemporalBytes,
  maxJsonBytes,
});
const lastSuccessfulReplay = runtime.replay;
```

The profile and both budgets are explicit caller inputs. The adapter validates
positive safe u32 count and budget values. The replay envelope preserves the
recorded inputs, logical ticks, sample identities, and temporal epoch. The
initial replay getter is `null`.

The envelope has this shape:

```text
{ format: "GhostFlow/temporal-replay-v1",
  mode: "legacy" | "framed",
  checkpointTick,
  records: [TickRecord | { format: "GhostFlow/scan-outcome-v1",
                          scanId, logicalTimeMs, trace: TickRecord }] }
```

The legacy adapter uses the runtime's recorded tick history. The framed adapter
uses records from the `ScanDriver` run that created it. Its first recorded tick
is scan ID zero, even when the wrapped runtime had already executed ticks. Each
later record uses `scanId = tick - firstScanTick`; logical time comes from the
recorded clock input. Replay selects the oldest eligible prefix and starts at
the checkpoint immediately before that prefix. Counts are not clamped.

Replay runs in a separate ghost instance. It does not dispatch effects or alter
live pending inputs, state, journal, intents, trace/outcome, frame sequence,
clock, or last outcome. A rejected request preserves the previous replay and
live execution. Successful replay replaces only the separate replay result.

`maxPeakTemporalBytes` covers the core temporal arena, checkpoint, proof, and
trace accounting. Scalar/module clones and allocator metadata are outside that
temporal budget. `maxJsonBytes` covers the retained replay plus candidate JSON
buffers. The adapter must count escaped UTF-8 bytes before allocation and avoid
unbounded intermediate strings. JavaScript parsed objects and copied text remain
caller-owned allocations.

The low-level WASM exports are `gf_replay_temporal` and
`gf_frame_replay_temporal`. Their successful results are exposed through
`gf_replay_ptr/len` and `gf_frame_replay_ptr/len`; they do not overwrite live
trace or framed outcome data.

This operation supplies installed-program execution evidence. It does not by
itself establish Reference §6.8 durable Program/source-closure/settings/binding/
run identities, candidate-program what-if replay, foreign checkpoint restore,
environment simulation, or durable continuity. Full durable and what-if replay
remain outside this API. Hardware and physical I/O evidence are also outside
this document.
