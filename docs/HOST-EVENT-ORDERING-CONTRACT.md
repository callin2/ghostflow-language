# Host event ordering contract

[한국어](HOST-EVENT-ORDERING-CONTRACT.ko.md)

Status: contract and executable conformance **model**, for [#115](https://github.com/callin2/ghostflow-language/issues/115).
The ingress queue and boundary rules below require future host adoption. This
change adds no production event engine, source grammar, descriptor binding,
firmware policy, transport schema or ABI. It does not depend on command/alarm
descriptor implementation or a particular frontend.

## Authority and current implementation

[Reference 2.8](reference/02-types-expressions-state.en.md#28-tick-and-state-snapshot)
defines a tick's immutable input snapshot and atomic logical state/output commit.
[Reference 4.7](reference/04-sensors-constraints-control.en.md#47-requested-safe-applied-confirmed)
separates requested, safe, applied and confirmed evidence.
[Reference 5.3](reference/05-settings-and-observation.en.md#53-renderer-independent-observation-model)
and the [interaction stream design](INTERACTION-STREAM-CONTRACT.md) distinguish
completed snapshots from ordered events and command results. This document
orders host receipt and scan boundaries; it does not redefine those lifecycles.

Current `runtimes/wasm/framed-runtime.mjs` captures a complete typed frame before
synchronous dispatch. `crates/ghostflow-core/src/scan.rs` validates scan identity
and time; failed scans do not advance successful scan identity/time.
`crates/ghostflow-core/src/lib.rs` computes candidate state and intent before
committing successful logical results. `runtimes/wasm/control-runtime.mjs`
distinguishes preparation/precommit rollback from postcommit adapter failure.
These interfaces do **not** implement a shared external receipt queue, batch
latch, or event tie-breaker. Their existing tests are core/adapter evidence,
not evidence that this new ingress contract is already deployed.

The [physical sequence](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary)
documents halting on Device output failure without rolling back logical commit.
No Device firmware revision was inspected here. This contract neither replaces
that policy nor claims physical behavior has been verified.

## Run-local receipt and batch boundary

One host serialization point assigns each accepted receipt a contiguous,
non-reused run-local `receiptSequence`. The sequence is assigned when the host
accepts ownership, before observers run. Equal wall-clock or monotonic timestamps
remain separate receipts; sequence breaks their ties. Producer event time,
producer sequence and source epoch retain their own evidence. An earlier producer
timestamp arriving later never moves a receipt into an already closed batch.
Independent producers have no implied global causal order beyond host receipt.

At a scan boundary the host atomically latches the largest contiguous accepted
prefix since the previous latch, including an empty prefix when appropriate.
It records a distinct attempt/boundary identity, exact source/module/binding/run
identity, receipt range and scan/time candidate, then closes an immutable batch.
No receipt can straddle batches. Receipt arriving after latch, during evaluation,
logical commit, effect dispatch or observation hooks belongs to a later batch.
Reentrant callbacks use the same serialization point; they cannot mutate the
current batch or trigger overlapping evaluation of the same instance.

This is receipt order, not a universal reducer. Each declared input/event binding
defines validation, duplicate handling, protocol order and snapshot projection.
Do not infer last-value-wins, command priority, alarm meaning or a physical ACK
from names or Bool values. A source's ordered event protocol remains authoritative
within its binding; conflicting or missing evidence is diagnosed explicitly.
Storage and payload bounds are finite and selected by the host profile. Overflow
rejects admission before accepting a receipt; it never drops or renumbers an
accepted receipt. A loss after acceptance requires explicit gap/fault evidence.

## Required order

| Order | Boundary | Required result |
| --- | --- | --- |
| 1 | Accept receipts | Serialize identities and preserve original evidence; do not evaluate against an open queue |
| 2 | Latch and close batch | Freeze a contiguous receipt prefix and complete typed frame, clock and prior-state context |
| 3 | Validate and evaluate | Core-owned next state, requested intent and constrained safe intent from that single snapshot |
| 4 | Logical outcome | Success commits logical state/results together; failure records the failed attempt without a completed snapshot or new effects |
| 5 | Capture committed evidence | Bind completion/output intent to the actual committed scan before invoking hooks or physical dispatch |
| 6 | Dispatch external effects | Dispatch the committed safe intent under the existing Driver/profile policy; partial physical application remains possible |
| 7 | Accept effect results | Record separate correlated receipts for actual success/failure/uncertainty; admit them only at a future permitted boundary |
| 8 | Next permitted decision | Explicit typed binding may use new receipts; no retrospective mutation of the originating decision |

Steps 1 and 7 can occur asynchronously between the serialized boundaries.
Capture of committed evidence precedes hooks; network export need not precede
physical dispatch. Export errors must not undo a commit or invent an unobserved
effect. Batch membership and event sequence are distinct from completed scan
identity and the interaction stream's independently assigned occurrence sequence.

## Failure, correlation and safety

An evaluation/validation failure preserves previously committed logical state
and emits no new effect from the failed candidate. Retain the failed batch,
receipt membership, attempt identity and reason as failure evidence; receipt
membership is not successful command handling or a completed scan. The host
explicitly finalizes a failed batch or retries that same immutable batch under
its retry policy. Neither silently replay nonidempotent requests nor append
new arrivals to a retry. Later receipts remain queued. Current core support for
retrying a scan ID/time does not itself authorize request retries.

An effect result identifies its originating committed scan, run, exact source/
module/binding and effect/attempt identity. Multiple effects and retries need
distinct identities; a retry cannot fabricate a second original commit.
A Driver acceptance record proves only the stated register/write acceptance,
not relay movement or physical confirmation. Failure or uncertain application
does not roll back the originating logical state or replace its safe/requested
intent with a false historical value. Preserve partial application and each
result's reason. Missing feedback remains unknown.

If late arrivals fill the queue before an effect result can be admitted, preserve
the originating commit and separate result/admission-failure evidence without
inventing an accepted receipt sequence. The model halts on this record-path fault;
adoption must define a fail-closed policy and may not silently lose the result.

If the host's existing failure policy halts, record the result and halt; there is
no automatic restart or next scan. If continuation is explicitly permitted, an
effect result accepted after the origin latch can influence only a future
decision through a declared typed binding. It does not automatically become an
alarm, command completion or arbitrary source input. This ordering contract does
not queue an independent emergency stop/watchdog behind ordinary batches or
change an existing out-of-band safety path.

## Boundary cases and evidence

`tests/host-event-ordering-contract.test.mjs` is a test-local reference model,
not a host adapter. Its simple request reducer and effect-failure input binding
are fictional explicit fixtures, not universal product policy or source syntax.
Its receipt and boundary objects are model notation, not approved record formats.

| Vector | Conformance obligation |
| --- | --- |
| Normal | Accept/latch/evaluate/commit/dispatch/result order; effect sees committed state and immutable origin identity |
| Tie and old producer time | Equal receipt times preserve sequence; late source timestamps do not reorder membership |
| Arrival during evaluation or dispatch | Closed batch unchanged; new receipt enters exactly the next permitted batch |
| Evaluation fault | Previous state intact, no completed result/effect; explicit failed-batch disposition, unchanged successful scan counter |
| Effect failure with permitted continuation | Origin stays committed; result is later ingress, correlated to origin; next decision uses only an explicit fixture binding |
| Effect failure with halt policy | Result preserved, later evaluation refused; no automatic continuation |
| Bounds and reentrancy | Overflow rejects before sequence allocation; immutable capture and single-instance evaluation enforced; postcommit result admission failure retains origin/result evidence and halts the model |

The focused model tests establish these contract oracles only. Adoption still
requires each host to implement its latch, bounded storage, typed projection,
failure/retry policy and records, then demonstrate the same cases through its
actual adapter. Core ownership, current ABI and physical evidence remain intact.
