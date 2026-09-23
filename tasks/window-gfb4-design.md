# GFB4 window integration contract

Implementation plan, not a claim of completed language/runtime support.
Companion: [window evidence design](window-evidence-design.md).

## Host activation interface

Both low-level WASM adapters expose `activateTemporal(profile)` with the same
explicit profile: `{timeEpoch, rootDensity: [{sourceTag, maxObservations,
intervalMs}], budget: {maxRetainedSamples, maxBytes}}`. ControlRuntime receives
this as `options.temporal`, captures it before asynchronous work, and supplies
the fixed epoch on every scan. A new time epoch requires a new session.
No profile is inferred from sensor cadence or source window duration.

The bounded activation packet is little-endian `GFTA`, u16 version 1, u16 root
count, u64 epoch, u32 sample budget, u32 byte budget, then roots as u32 tag,
u32 maximum observations, u64 interval milliseconds. Exact size is 24+16N.
N is 1..31 (the existing 128-input bound minus two clocks, four inputs per root).
Epoch and intervals are exact JS-safe integers; intervals, density and budgets
are positive. Tags are positive, unique and ascending. The Rust decoder checks
all fields independently. Rejected activation preserves the configuring state.

Host manifest validation checks window descriptor domains, slots, source
bindings and format pairing. Canonical source/nominal descriptor equivalence is
the toolchain and signed-package verifier's responsibility; a matching bytecode
digest alone does not authenticate a caller-supplied manifest.

## Verified module layout

Use the existing GFB1 magic with format version 4 for modules containing a
window. Non-window modules keep their existing format selection. Existing
module (1 MiB), expression/query (4,096 bytes), stack (128), input (128),
strategy (32), and scalar state budgets stay unchanged. Each strategy's scalar
state count plus window count must not exceed 128.

After the existing scalar state table, encode:

- `u16 nowInput`, `u16 timeEpochInput`; these bind Number inputs named
  `__gf_now_ms` and `__gf_time_epoch` respectively.
- `u16 rootCount`, then each root: `u32 tag`, string name, four `u16` input
  indices for present (Bool), epoch, id and timestamp (Number).
- Roots have distinct names, strictly increasing positive tags and distinct
  input bindings, including separation from both clock inputs.

Each strategy keeps its existing name, priority and query, then adds `u16
windowCount` and the following descriptors before transitions and intents:

1. `u32 site`, string name (unique nonzero sites and unique names per strategy).
2. `u8 operation`: 0 average, 1 minimum, 2 maximum, 3 rate.
3. `u8 payloadType`: existing Number/Int machine type. Average and rate use
   Number; average explicitly converts Int source values to Number.
4. `u64 overMs`, `u64 maxAgeMs`, both 1..2^53-1 inclusive.
5. `u16 rootRefCount` and strictly increasing unique `u16` root table indices.
6. Six existing length-prefixed expression blobs, in order: ok (Bool), payload
   (payloadType), fault, origin, quality and sourceTag (all four Number).

A GFB4 module has at least one root and at least one window across strategies.
Source blobs cannot read next state. They may reference prior window slots;
transitions and intents may read all slots in their own strategy. Format 4
includes the existing format 3 expression operations.

Opcode 57 is `[57, u16 slot, u8 field]`: 0 ok (Bool), 1 value (payloadType),
2 fault, 3 origin, 4 admissionRevision, 5 newestTimestamp, 6 count and 7 quality
(Number). Successful aggregate quality is 3, not physical measured quality 1;
unavailable quality is 0. Formats 1–3 and device queries reject this opcode.

## Compiler-internal forms

These are internal encoding forms, not additional authored language syntax:

```text
(temporal-context __gf_now_ms __gf_time_epoch)
(temporal-root TAG NAME PRESENT_INPUT EPOCH_INPUT ID_INPUT TIMESTAMP_INPUT)
(strategy NAME PRIORITY
  (device QUERY)
  (window SITE NAME OPERATION PAYLOAD_TYPE OVER_MS MAX_AGE_MS
    (roots TAG ...)
    (source OK PAYLOAD FAULT ORIGIN QUALITY SOURCE_TAG))
  (next ...)
  (intent ...))
(window-read SLOT FIELD)
```

OPERATION is `average`, `min`, `max` or `rate`; PAYLOAD_TYPE is `number` or
`int`; FIELD is `ok`, `value`, `fault`, `origin`, `revision`, `timestamp`,
`count` or `quality`. Windows precede transitions/intents. Root declarations
and references are already in ascending tag order; reject noncanonical order.

## Execution and activation contract

### Source manifest and provenance

Use the existing manifest envelope. Window declarations are `signals` entries
with `kind: "window"`, `name`, `site`, zero-based `slot`, `operation`
(`average|min|max|rate`), `payloadType`, `errorType: "SensorFault"`,
`quality: "measured"`, `overMs`, `maxAgeMs`, `clockInput: "__gf_now_ms"`,
`timeEpochInput: "__gf_time_epoch"`, and `sources: [{name, tag}, ...]`.
Sources are the sorted physical roots used by the source expression. The Rate
payload spelling is `Rate<Q>` with Q from the Reference whitelist. Other
payload types use existing canonical type names. No density or target budget
is authored into the manifest. A window module uses `GhostFlow/control-v4`;
the host/package contracts must explicitly allow its GFB format 4 pairing.

Lowered aggregate Results carry a separate derived-evidence descriptor; do not
forge a physical sample ID in the existing physical `sample` structure.
Generated temporal inputs and prelude source expressions count in existing
compiler input, state and expression/stack limits. A successful source compile
alone does not prove activation, host validation or package acceptance.

### Runtime transaction

Loading verifies requirements without inventing a density, budget or time
epoch. Temporal modules require explicit activation with those facts. Normal
activation and hot swap reject them; hot-swap migration remains unfinished.

Prelude evaluation uses the old authored state. Evaluate source ok first. On
success, eagerly evaluate payload even for a duplicate observation, preserving
selected-expression faults. On source failure evaluate the fault/origin branch
and do not evaluate payload. Physical roots' density/continuity observations
are still processed when the selected source is faulted.

Activation supplies density facts, sample and byte budgets and one time epoch.
The existing runtime monotonic-clock contract stays in force. Changing the time
epoch requires an explicit new execution session; do not silently reset authored
state or reuse temporal history after a clock-domain replacement.

Window commit/rollback, independent TickRecord provenance, bounded checkpoint
history, rewind and replay must be integrated together. Account for both window
banks, J+1 retained checkpoints, record contributors and replay scratch memory.
No global allocation guarantee follows from the allocation-free window engine.

Nested aggregate sources need derived identity, contributor ownership and a
conservative accumulated-lookback capacity proof. The physical-root wire and
decoder alone do not establish that support. Preserve this as required work;
do not change Reference expectations to exclude it permanently.

## Accepted Runtime API design

- `Runtime::activate_with_temporal(&TemporalActivation)` takes
  `root_density: Vec<RootDensity>`, `budget: TargetBudget`, and `time_epoch: u64`.
  Density facts match the selected strategy's physical-root union exactly.
- `Runtime::temporal_memory_bytes()` reports the accounted temporal storage.
  `max_retained_samples` limits the sum of logical window capacities. The byte
  limit also counts duplicate storage in checkpoints and trace contributor lists.
- Allocate all engines, root/projection buffers and J+1 checkpoints before
  changing activation state. Bound independent trace evidence for J retained
  records plus one candidate/transient record. The window arena, history and
  trace arrays are included; allocator bookkeeping, existing scalar maps, JSON
  strings and caller-owned clones are not covered by this temporal-only limit.
- `Runtime::replay_with_temporal(module, caps, count, &activation,
  max_peak_temporal_bytes)` accounts for the retained live runtime and scratch
  execution together. Seed the scratch execution from the checkpoint immediately
  before the oldest retained input. Move returned records instead of deep cloning.
  Ordinary `replay` requires this explicit budget for temporal execution.
- Rust TickRecord owns window trace entries and their contributors. JSON includes
  `windowTrace` for temporal records; non-temporal JSON does not gain an empty
  field. The framed adapter's owned trace copy must also be included when
  validating that adapter's peak, not silently treated as a caller clone.
- Plain temporal hot swap remains rejected while migration is unfinished.
  Repeated activation cannot silently reset temporal history. This restriction
  is an implementation gap, not a narrowed final Reference requirement.

Each `windowTrace` entry carries `site`, machine `payloadType` (`number|int`),
`operation`, `value` (Number or null), `quality` (3 or 0), `count`,
`admissionRevision`, `timeEpoch`, `nowMs`, `first`, `last`, `contributors`, and
`upstreamFault`. Entries follow slot order. A contributor is
`{sourceTag, epoch, id, timestampMs, value}`; first/last are contributors or null.
An upstream fault is null or `{origin, faultCode}`, where faultCode is the
language ordinal (Disconnected=0, Stale=1, Invalid=2, NotReady=3), not a Rust enum
discriminant. The record remains independently readable after Runtime disposal.

## Integration acceptance

- Implemented: canonical source compiler and nominal Rate comparisons; all unchanged
  Reference window acceptance cases plus independent runtime oracles.
- Implemented: shared core activation, rollback, trace, journal rollover, rewind and replay.
- Implemented: legacy/framed WASM and the virtual native CLI carry explicit density/budget/epoch.
- Implemented: host manifest validation recognizes window signals and generated time epoch;
  no host computes aggregates or chooses admission.
- Implemented: source observation maps Rust window traces to exact source nodes/contributors.
  Canonical restore verifies generated window descriptors and dependencies.
- JS signed-package verification validates source/manifest/bytecode window
  bindings; rejection tests re-sign mutated payloads to reach the semantic guard.
  Native signed-package integration and the framed native CLI profile remain open.
- Durable migration, nested aggregate evidence and estimated-quality evidence
  retain separate acceptance work. None is certified by GFB4 loader tests.

Source-trace integration covers both observation and dependencies. The canonical
windowSites table binds parsed signal sites and descriptors. Dependencies include
source expressions, root identities, both clocks and downstream window reads.
Restore compares both window entries and consumer dependencies against fresh
lowering. Observation checks signed-i32 values, identity uniqueness and order,
open-left retention bounds and available-result evidence/freshness. It does not
recompute aggregates in JavaScript. See `window-evidence-design.md` for focused
test evidence and the limits of current integration.
