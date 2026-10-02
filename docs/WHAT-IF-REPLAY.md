# Bounded what-if replay

`prepareWhatIfReplay` in `runtimes/wasm/what-if-replay.mjs` implements the missing-input
boundary of Reference §6.8 and REF-06-019 using the actual portable core. This is
a Node reference host API with virtual actuator capabilities and no physical sink.

The host supplies a canonical compilation, WASM bytes, explicit timeline,
instance, run, immutable source revision and virtual binding revision identities,
and recorded `prefix`/`future` frames. Frames contain `nowMs`, complete external
`inputs`, and sensor `samples` with recorded identity, timestamp, value and quality.
The adapter validates the artifact source map, recompiles the immutable source
closure, and checks exact bytecode and manifest. The profile accepts plain controls
without settings, schedules, contexts, controllers, objectives or after-event
adapters; its settings revision is zero. Sensor conditioning uses the existing
reference host. Expressions, state and requested/safe outputs execute in Rust.

The baseline checkpoint is explicitly `GhostFlow/replay-prefix-checkpoint-v1`:
canonical initial state plus a complete bounded recorded prefix, its digest,
the digest of its actually executed outcomes, exact Program/source-closure
digests and origin identities. A branch reconstructs this prefix on a fresh
runtime and verifies its outcome digest. This event-sourced checkpoint does not
import foreign VM memory. Replaying the same samples preserves conditioner
history. Requests accept at most 256 total frames and 1 MiB of input records;
logical times increase strictly. Caller-owned data is captured before preparation
suspends, so later mutation cannot become recorded evidence.

`branch({ branchId, runId, synthetic })` requires identities separate from the
origin. Before executing future frames it checks every required input and sensor
sample at every frame. Missing records return `status: 'missing-input'`, missing
names and logical times, and no executed branch frames. An earlier sample, default
or environmental prediction cannot fill the gap.

Explicit virtual values contain `offset`, `kind` (`inputs` or `samples`), `name`,
`value` and `provenance: 'synthetic'`. They supply missing values or replace recorded
ones and still satisfy the reference input/sensor contract. Duplicate targets,
unknown names and malformed values reject. Completed receipts label every input
`recorded` or `synthetic`; virtual samples never become recorded physical evidence.
Candidate results include actual frames, VM state, requested/safe outputs and
sensor faults. Complete original future recordings produce actual original
outcomes at matched logical times; otherwise `original` is null, never invented.

Each request uses disposable runtimes and private copies. Returned receipts cannot
mutate the baseline. Rejected and completed branches preserve original records,
identities and separately running live instances. The API accepts no live runtime,
ledger, installed schedule or physical callback. It compares the same Program;
source replacement, foreign checkpoints, production binding/run identity issuance,
Device lifecycle, durable branch storage and environmental models remain separate.

`tests/what-if-replay.test.mjs` checks missing records, synthetic success and fault
samples, matched logical ticks, immutable originals, live continuation, caller
mutation and artifact tampering. Native and WASM execute the same bytecode and
reference-conditioned sensor fields with complete VM trace comparison. This proves
portable execution parity, not a native production sensor driver or hardware.
