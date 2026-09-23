# Temporal replay through the WASM adapters

Status: implemented; focused Rust and actual WASM replay acceptance passed.
Batch14 includes these tests and has no new regressions. Its 27 unrelated
Reference failures and 164 TODO cases still prevent overall goal completion.

Ground truth: Reference §6.8 requires a separate ghost instance, original input
and logical-time replay, and preservation of the live timeline and effect sinks.
The measured nested-window acceptance also requires replay after journal rollover
through both WASM adapters. Mutating a live runtime with `rewind` does not satisfy
that contract.

## API and ownership

- `Runtime::replay_current_with_temporal(count, activation, max_peak_temporal_bytes)`
  forks the installed module and capabilities. The caller supplies the temporal
  activation profile and combined original-plus-ghost temporal peak budget.
- `ScanDriver` records the first underlying runtime tick at its creation. Only
  journal records from that framed run are eligible. A retained record's scan ID
  is `tick - first_scan_tick`; logical time comes from its recorded clock input.
  Wrapping a runtime that has already executed ticks must still start scan ID 0.
- Count is positive and cannot exceed eligible retained records. Replay selects
  their oldest prefix. It starts at the checkpoint immediately before that prefix.
  No silent count clamping or invented missing inputs is allowed.
- WASM exports `gf_replay_temporal` and `gf_frame_replay_temporal` receive the
  unchanged GFTA activation packet, count, temporal peak budget and JSON budget.
  Separate `gf_replay_ptr/len` and `gf_frame_replay_ptr/len` expose the last
  successful replay. They never overwrite the live trace or framed outcome.
- Both JavaScript adapters expose
  `replayTemporal({ count, profile, maxPeakTemporalBytes, maxJsonBytes })`.
  Count and budgets must be positive u32 integers; the existing profile encoder
  validates profile fields. The method returns parsed replay JSON.

Envelope:

```text
{ format: "GhostFlow/temporal-replay-v1",
  mode: "legacy" | "framed",
  checkpointTick,
  records: [TickRecord | { format: "GhostFlow/scan-outcome-v1",
                          scanId, logicalTimeMs, trace: TickRecord }] }
```

## Atomicity and memory

The ghost owns its state and evidence. It never dispatches an actuator effect or
changes live pending inputs, state, journal, intents, frame sequence, clock or
last outcome. Successful replay replaces only its separate result buffer. A
rejected request preserves both the prior replay and live execution; its error
diagnostic may change.

`maxPeakTemporalBytes` retains the core's explicit temporal arena/checkpoint/proof
and trace accounting. Scalar/module clones and allocator metadata are outside
that temporal budget. They must not be described as a total process memory bound.

`maxJsonBytes` separately bounds the previous retained replay buffer plus the
candidate buffer. Serialization must stream borrowed records without creating
an unbounded intermediate record string. Count escaped UTF-8 bytes before
allocation, then write the candidate without geometric growth. JavaScript's
copied text and parsed objects are caller-owned allocations outside this bound.

## Required tests

1. Nested measured replay preserves aggregate values, owned proof identities and
   original logical ticks in both adapters, including journal rollover.
2. A framed driver created after legacy ticks reports the correct scan IDs.
3. Rejected late evaluation and retry do not create duplicate admissions.
4. Replay leaves live pending inputs, trace/outcome, state, intents, frame IDs
   and clocks unchanged; a subsequent live step follows the original timeline.
5. Invalid counts, profiles, temporal budgets and JSON budgets preserve both
   prior replay and live state. Size boundaries are tested independently.
6. Actual rebuilt WASM executes the JavaScript cases; mocks alone are insufficient.

## Remaining Reference scope

This installed-program adapter operation supplies execution evidence. It does
not by itself complete §6.8's durable Program/source-closure/settings/binding/run
and branch identities, candidate-program what-if replay, foreign checkpoint
restore or environment simulation. These remain explicit work in the full goal.
No language expectation or existing Reference test is weakened by this slice.

## Focused evidence

- `build/temporal-replay-rust-final.log`: core 139 and WASM ABI 8 tests pass.
- `build/temporal-replay-wasm-build.log`: release WASM build succeeds.
- `build/temporal-replay-wasm.log`: 27/27 pass, including exact live/replayed
  record equality, nested 20/3, failed tick retry, preserved pending inputs,
  preserved last successful replay, and 1024-record rollover in both adapters.
- `build/scan-frame-wasm-temporal-replay.log`: existing framed suite 17/17 pass.
- `build/temporal-replay-catalog.log`: 5/5 pass after relocating the unchanged
  Rust output-atomicity test body; its recorded digest is unchanged.

One borrowed core JSON writer is shared by ordinary traces and replay. Escaped
UTF-8, rejected sink writes, exact JSON N/N-1 bounds and retained-buffer capacity
are tested. Framed result conversion charges its output vector before creating
the ghost, including overlap with the core's returned trace storage.

Full-gate evidence: `build/compiler-runtime-batch14-full.log` and
`build/compiler-runtime-batch14-verification.json`. Node: 1900 pass, 27 existing
Reference failures, 164 TODO. Verification source hashes matched at gate end.
Exact total temporal-byte N/N-1 accounting is proved by the native core tests;
the two actual WASM paths currently reject insufficient peak budgets and verify
rollover, but do not independently measure their exact total-byte threshold.
That target-specific resource report and boundary evidence are resolved by the
focused temporal-plan evidence; durable foreign restore, hot-swap and full
§6.8 identity remain open.
