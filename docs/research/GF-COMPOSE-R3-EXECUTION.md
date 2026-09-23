# GF-COMPOSE R3: execution composition

## User problem

Adding a behavior must not alter an existing behavior through hidden ordering,
shared state, clocks, or fault handling. The design must preserve the goals of
lower effort, explainability, and traceability. This document compares only
two options: compiler composition into one executable module, and multiple VM
instances with explicit coordination.

## Evidence at examined revision

The examined language revision is `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
The working tree was not changed before this document. `compileSource` accepts
one canonical `.ghost.md`, lowers it through `compileControl`, emits one GFB1
byte sequence, and records source/bytecode digests and trace metadata
([`tools/compile-source.mjs`](../../tools/compile-source.mjs)). `compileControl`
lowers one control to one GFB1 `module`; state transitions are evaluated from
current state, then intents may read `next.*` ([`tools/control.mjs`](../../tools/control.mjs)).

`Runtime::tick` requires every declared input, validates an optional explicit
`__gf_now_ms`, computes all next state before intents, applies safety, commits
state and safe intents atomically, clears inputs, and appends a bounded journal
record. `tick_at` supplies the explicit clock; the VM reads no wall clock
([`crates/ghostflow-core/src/lib.rs`](../../crates/ghostflow-core/src/lib.rs)).
`install` resets inputs, safe intents, active strategy, and the clock; it may
preserve same-named, same-typed state. `hot_swap` preserves compatible named
state but clears safe intents and rejects module-name or state-type changes.

These facts describe the core tick and framed complete-frame adapter. They do
not specify asynchronous CEP ingress or occurrence delivery. Occurrences must
remain individually meaningful; value observations are independent of
interrupt/scan capture. By default observations are preserved within supported
capacity. Latest-pending-value replacement is allowed only when explicitly
opted in per input. Loss/overflow must be rejected or reported, never silently
accepted. This agreed delivery requirement does not imply unlimited persistent
history. Ingress ordering, event-to-tick mapping, declared-source batching,
bounds, and recovery are unresolved. No hard deadline or priority scheduler
has been supplied. See [`LANGUAGE-SURFACE.md`](../LANGUAGE-SURFACE.md) and
[`IMPLEMENTATION.md`](../IMPLEMENTATION.md).

The framed host captures one complete input frame, dispatches once, publishes
the last accepted outcome, and latches a fault after conditioning or dispatch
failure. Further steps require a new host instance; a rejected pre-conditioning
validation can still be retried ([`docs/FRAMED-CONTROL-HOST.md`](../FRAMED-CONTROL-HOST.md)).
Thus “last completed result” and “new run” are existing host contract facts.

The station module is host-driven and bounded. `prepare_start_batch` chooses
one request from a same-tick snapshot, while `authorize_output` checks a
durable reservation, owner/session, valve limits, and safe output
([`crates/ghostflow-core/src/station.rs`](../../crates/ghostflow-core/src/station.rs)).
This is a physical pump-station arbiter, not evidence of universal behavior
composition. GFB1 limits include 128 inputs, 128 states, 32 strategies, 128
constraints, expression depth/nodes of 128/4096, and bounded expression and
query sizes ([`tools/gfb1.mjs`](../../tools/gfb1.mjs)).

R2 fixes the source/instance distinction: canonical source remains authoritative
and an instance needs an opaque identity with isolated state and provenance.
The updated R2 also fixes that conversational memory is provenance and
authoring context, not automatic execution-rule or physical-binding authority.
Memory-to-decision-to-source linkage, retention, and tombstone behavior remain
R2/API-system questions. Its installation-constraint boundary remains
unresolved. This document does not select a constraint artifact, overlay, or
enforcement owner.

## Tables and examples

### Option comparison

| Option | Input sampling | Clock | Old/next state visibility | Reset/fault scope | Output resolution | Provenance | Existing limits | New machinery |
|---|---|---|---|---|---|---|---|---|
| Compiler composition into one executable module *(proposal)* | Complete-frame tick behavior exists; asynchronous occurrence/value ingress remains unspecified; shared names must be qualified | One supplied logical clock per tick | All transitions read the same input/old-state snapshot; next refs only in output expressions, not other next transitions or lets | One module/runtime boundary; failure affects the composed scan | One safety pass over one requested-intent bank; duplicate authoritative output definitions are compile errors, never last-writer policy | One module fingerprint/source closure, with instance-qualified trace proposed by R2 | One combined input/state/strategy/constraint budget | Import/qualification lowering, dependency validation, ingress mapping, and ABI trace representation |
| Multiple VM instances with explicit coordination *(proposal)* | Each instance's ingress must preserve occurrences/value observations by stated delivery rule; complete-frame snapshot adapter does not settle batching or order | Coordinator supplies each clock; shared-clock policy must be explicit | Each instance retains old/next isolation; cross-instance wiring cannot redefine next refs; unsupported sharing is a compile error | Per-instance VM faults plus coordinator/fan-out policy; framed failure boundary must be defined | Duplicate direct writers remain compile errors; only explicitly modeled station requests may use existing station arbitration | Per-instance module fingerprint plus instance/run/scan join | Limits apply per module, but coordinator and total-resource bounds are unspecified | Coordinator, ingress-to-tick mapping, ordering-independent join, and station integration where applicable |

### Isolated instances: east and west

The following is a hand-worked example, not execution evidence. Both instances
use the same definition. Each has independent `running` state and output
`pump`; `start` is true only for east in scan 1. `t` is supplied equally.

| Scan/read timing | Instance | Inputs | State before | State after | Requested / safe output | Read timing |
|---|---|---|---|---|---|---|
| 1, same complete frame | east | `start=true`, `t=1000` | `running=false` | `running=true` | `pump=true` / `pump=true` | Reads east inputs and east old state |
| 1, same complete frame | west | `start=false`, `t=1000` | `running=false` | `running=false` | `pump=false` / `pump=false` | Reads west inputs and west old state |
| 2, same complete frame | east | `start=false`, `t=2000` | `running=true` | `running=true` | `pump=true` / `pump=true` | Reads east prior committed state |
| 2, same complete frame | west | `start=false`, `t=2000` | `running=false` | `running=false` | `pump=false` / `pump=false` | Reads west prior committed state |

Invariant: east start does not start west. This is a proposal for a composed
execution contract, not a current multi-instance ABI fact.

### Reversed declaration order, unchanged identities

Hand-worked proposal. The same east and west instance IDs, inputs, and frames
are used; only declaration order changes. “Trace” means the sequence keyed by
identity, not an array position.

| Declaration order | Instance | Inputs | State before → after | Requested / safe | Read timing |
|---|---|---|---|---|---|
| east, west | east | `start=true` | `false → true` | `true / true` | frame 1, old east state |
| east, west | west | `start=false` | `false → false` | `false / false` | frame 1, old west state |
| west, east | east | `start=true` | `false → true` | `true / true` | frame 1, old east state |
| west, east | west | `start=false` | `false → false` | `false / false` | frame 1, old west state |

The identity-keyed traces are equal. Reordering declarations must not become
an implicit scheduler. This does not imply that swapping wired dependencies is
equivalent.

### One behavior consuming another result

Hand-worked hypothetical semantics for a separately coordinated pair (not an
atomic composed-module tick). `producer.ok` is an east result. `consumer`
requests `valve=producer.ok` and has initial state `running=false`. The table
makes the read phase explicit because the current compiler has no cross-module
result reference or lowering rule. “Step” labels are scenario order, not
native per-instance scan IDs. Row 1's hypothetical producer progress alongside
consumer rejection does not adopt a partial-progress policy; there is no
complete composed result for that step.

| Scenario step | Inputs | State before → after | Requested / safe output | Read timing |
|---|---|---|---|---|
| 1 | producer input `sensor=1`; consumer input otherwise complete | producer `false→true`; consumer has no valid evaluation because required producer value is unavailable | producer `ok=true`; consumer has no requested/safe result | Consumer reads no same-scan producer result; missing dependency is not defaulted to false |
| 2 | producer input `sensor=0`; consumer frame complete | producer `true→false`; consumer `false→true` | producer `ok=false`; consumer `valve=true / true` | Consumer reads producer’s last completed scan-1 result |

This hypothetical comparison does not describe executable current behavior:
the compiler/runtime has no cross-module value reference. A missing required
value yields no valid evaluation, not an invented fallback. Same-scan
cross-instance wiring cannot make another instance's `next` value available
or redefine next-reference rules. Unsupported cross-instance sharing is a
compile error. The examples contrast values at supported
completed-scan boundaries; they do not adopt FIFO ingress, same-scan lowering,
or a scheduler.

### Rejected cycle and reset/failure

Rejected cycle *(hand-worked invalid dependency; dependency notation, not
source syntax)*:
`east.pump[n] <- west.pump[n]` and `west.pump[n] <- east.pump[n]`, where `n`
identifies the same scan. East's result requires west's result, and west's
result requires east's result. These two edges close the cycle; neither result
can be evaluated first by dependency order. Reject this instantaneous cycle
before execution. Instantaneous expression cycles and duplicate output
definitions are invalid compiler inputs, not open policy questions.

A read from committed prior-scan state instead uses a value fixed before scan
`n`. Replacing one of these dependencies with such a read breaks this same-scan
cycle. The current VM evaluates transitions from prior state before committing
next state. This distinction defines no new cross-instance read or initial-value
semantics.

Reset/failure *(contract constrained)*: after a successful frame, the framed
host exposes its last completed result. If conditioning or VM dispatch fails,
that committed result remains available, the host latches a fault, and another
step requires a new host instance. A new run must use a new `runId`; `scanId=0`
in the new run is not the prior occurrence. Composition must preserve this
boundary. It must not partially reset one instance while presenting a composed
result as complete. Exact multi-instance fault fan-out is unresolved.

## Recommendation

Static compiler composition remains the preferred hypothesis, not a selected
lowering or ABI. It must preserve existing tick invariants: every transition
reads the same input/old-state snapshot; next references are legal only in
output expressions, not other next transitions or lets; logical state and
output commit is simultaneous; cycles and duplicate output definitions are
rejected. Each output channel has one authoritative definition. Competing
direct writers fail compilation and cannot be deployed. This does not remove
explicit station single-writer resource arbitration: station requests are not
competing direct writes. Composition does not authorize same-scan
cross-instance wiring that changes next-reference semantics. Complete-frame
scheduling does not settle event ingress, ordering, batching, or overflow.

Do not generalize station reuse. Its same-tick selection and durable output
authorization can arbitrate a shared pump after behavior results exist, but its
pump/valve policy is not a universal composition resolver. Broader arbitration
and fallback semantics remain with #95.

## Unresolved questions and owners

- Language compiler owner: define whether composition lowers imported controls
  into one GFB1 module, and how names, state, inputs, outputs, and source maps
  are qualified. Preserve the old/next and cycle rules above; do not frame them
  as open semantic choices.
- Language/runtime ABI owner: define the composed manifest, instance-qualified
  trace fields, result visibility, and whether one TickRecord remains canonical.
  No current ABI field defines cross-instance results.
- Language/runtime owners: define ingress ordering, event-to-tick mapping,
  declared-source batching, capacity, and clock mapping. The core tick and
  framed host do not settle asynchronous ingress. No deadline or priority
  scheduler is assumed.
- Language/runtime owners: define composed safety application while retaining
  the invariant that duplicate direct output definitions are compile errors;
  station resource arbitration remains a distinct supported concept.
- API/deployment owner with R2 owners: preserve the unresolved installation-
  constraint boundary. Do not infer that composition settles separate
  constraint compilation versus an explicit cross-project boundary revision.
- API/system operational-memory owner: keep memory retrieval and LLM
  interpretation outside runtime inputs. R2 owns lineage, retention/tombstones,
  and decision linkage; this execution document does not define those lifecycles.
- #95/station owner: decide how shared physical resources interact with
  behavior results. Existing station policy must not be treated as universal.
- Framed-host owner: define composed fault fan-out, last-completed-result
  publication, and new-run behavior. Current framed text specifies one host
  instance, not a composed graph.

## Verification

- [x] Examined revision recorded as `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] Exactly two options are compared across all requested columns, with
  current facts separated from proposals.
- [x] Three hand-worked scan tables include inputs, state-before, state-after,
  requested/safe outputs, and read timing; isolation and declaration-order
  invariants are explicit.
- [x] Same-scan cycle and reset/failure cases are included. Framed last-result
  and new-run boundaries are preserved.
- [x] Current limits, station reuse boundaries, and exact unanswered lowering/
  ABI questions are named. No scheduler or ABI is introduced.
- [x] Examples are labeled hand-worked and no runtime execution is claimed.
- [x] Runtime test suites were not run, as required for this documentation-only
  task. Coordinator should run `git diff --check` and inspect relative links.
