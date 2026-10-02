# Host–Driver C ABI v1 draft

[Korean translation](DRIVER-ABI-V1-DRAFT.ko.md)

## Status and authority

Issue #117: documentation-only proposal for review, pending actual consumer adoption.
No C ABI, native Driver loader, hardware integration or conformance suite is implemented by this document.
It is not a prerequisite for first-board bring-up and does not mandate a Device product contract.
The normative language remains [Reference §6.3](reference/06-composition-and-replay.en.md#63-parameters-settings-dependencies-and-bindings)
and [§4.7](reference/04-sensors-constraints-control.en.md#47-requested-safe-applied-confirmed).
The [physical boundary](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary) assigns physical I/O and failure policy to Device.
“Must” below means a proposed acceptance condition for a consumer choosing this draft.

The native boundary joins an execution host to a device-specific Driver. The host owns core evaluation,
installation bindings, scheduling and policy; the Driver owns endpoint communication and interpretation.
The existing Rust `ScanDriver` is a core scan adapter, not this physical ABI. Existing `Capability`
contains only kind/name/value type. Neither supplies the complete metadata or physical receipts proposed here.
The `gf_*`/`gf_frame_*` WASM ABI is a separate host–core interface; its handles and numeric errors are not reused.
ABI version is distinct from source revision/profile, GFB format, package, binding and firmware versions.

## Negotiation and function boundary

This illustrative C shape defines directions and ownership, not a published header or implemented symbol.
`gfdrv_bytes` is a caller-owned bounded byte view; `gfdrv_buffer` is caller-owned writable storage with capacity
and returned length. Named record types below require a reviewed schema before a header can be frozen.

```c
#include <stdint.h>
typedef int32_t gfdrv_status; /* 0 success; stable positive errors below */
typedef struct { const uint8_t *data; uint32_t len; } gfdrv_bytes;
typedef struct { uint8_t *data; uint32_t capacity, len; } gfdrv_buffer;
typedef struct gfdrv_session gfdrv_session; /* opaque Driver-owned instance */
typedef struct gfdrv_host_v1 {
  uint32_t size, major, minor;
  void *context; /* opaque host token; Driver must not dereference it */
  gfdrv_status (*clock)(void *, uint64_t *epoch, uint64_t *monotonic_ms);
  gfdrv_status (*report)(void *, gfdrv_bytes record);
} gfdrv_host_v1;
typedef struct gfdrv_api_v1 {
  uint32_t size, major, minor;
  gfdrv_status (*describe)(gfdrv_buffer *metadata);
  gfdrv_status (*open)(const gfdrv_host_v1 *, gfdrv_bytes binding_and_budget,
                      gfdrv_session **out);
  gfdrv_status (*poll)(gfdrv_session *, gfdrv_buffer *input_records);
  gfdrv_status (*apply)(gfdrv_session *, gfdrv_bytes safe_commands,
                       gfdrv_buffer *receipts);
  gfdrv_status (*cancel)(gfdrv_session *, uint64_t command_id,
                        gfdrv_buffer *receipt);
  gfdrv_status (*close)(gfdrv_session *);
} gfdrv_api_v1;
gfdrv_status gfdrv_negotiate(uint32_t major, uint32_t max_minor,
                            uint32_t out_capacity, gfdrv_api_v1 *out);
```

Proposed initial version is major 1, minor 0. Negotiation selects the highest mutually supported minor
within major 1, checks both table sizes and all required function pointers, and rejects an unsupported major.
Minor extensions append optional fields; omitted fields are absent, never read beyond `size`.
Breaking layouts or meanings require a new major. Unknown required features reject before `open` or I/O.
The consumer pins the Driver artifact digest, ABI/schema versions and platform calling convention.
Static linking or an explicit registration path suffices; dynamic loading is outside this proposal.

Calls are serialized per session; callbacks are synchronous, bounded and cannot reenter Driver operations.
Views are borrowed only for the call; neither side retains pointers. Tables/context remain valid through `close`.
No allocation ownership crosses the boundary. Null/nonzero-length, overflow, alignment and capacity checks
precede access; callers still supply valid accessible memory. Buffer shortage returns required length without I/O.
`apply` and `cancel` preflight receipt capacity before physical effects; `apply` reserves worst-case per-endpoint receipts, and a post-write failure preserves all outcomes.
No Rust struct layout, enum layout, trait object, panic or exception crosses the C boundary.
GhostFlow source contains logical ports/rules, never Driver handles, bus addresses or Rust internals.

## Metadata and binding admission

`describe` publishes immutable Driver revision/digest, supported schemas/features, endpoint IDs and limits.
For each endpoint it declares direction, payload type, semantic meaning, unit/range, sample/timing contract,
quality/error behavior, output/readback scope and supported operations. Unknown facts remain unknown.
Binding admission compares these against the Program's required logical contract and installation revision,
including polarity, fail-safe assumptions and authorized evidence source. Names or primitive types alone do not suffice.
Changed metadata invalidates prior admission; no active-session silent rebinding is allowed.
Compatible replacement retains source/artifact and changes Driver/binding revisions, as Reference §6.3 permits;
it does not promise uninterrupted runs, sensor continuity or automatic restart.

Input records retain endpoint/source identity, source epoch, sample ID, clock epoch, acquisition timestamp,
payload, explicit presence and quality/reason. ABI quality requires an explicit mapping to core signals
`NotReady=0`, `Good=1`, `Disconnected=2`, `Stale=3`, `Invalid=4`; unknown codes reject.
Measured/estimated/held provenance and certified interval evidence are separate fields/contracts, not aliases
for these quality codes. Missing samples cannot become fabricated good values or continuity certificates.
Source `sample`, `valid`, filters, `stale_after` and `recover_after` keep their Reference semantics.

## Lifecycle, ordering and failure

Successful `open` creates one bound session/epoch; failure returns no session and performs no output application.
The host admits ordered input records before core evaluation. Records carry monotonically ordered sequence IDs
within an epoch; identical duplicates are idempotent, changed duplicates/old IDs reject, and gaps are reported.
The host records an explicit total order for same-time inputs, commands and receipts; timestamps alone do not order them.
`poll` never evaluates source. `apply` receives only safe/effective intent after the core decision, with command ID,
run/scan ID, binding revision and deadline. Batch intent does not promise simultaneous physical switching.
Receipts distinguish accepted, applied, failed and unknown per endpoint and preserve partial outcomes.
Applied acknowledgement identifies the operation scope; readback identifies register/latch scope;
confirmed physical effect requires independent feedback with provenance/quality. None substitutes for another.
Core commit remains separate from I/O; this ABI introduces no rollback after an output failure.

`cancel` identifies a command and reports cancellation outcome. Cancellation receipt does not prove physical OFF,
undo an applied action or clear committed state. Late receipts retain original IDs and cannot affect a new epoch.
`close` ends access exactly once, bounded by the agreed deadline; teardown does not certify safe physical outputs.
Once `close` is invoked the host must not reuse or close the pointer, including on error; Driver owns eventual teardown.
No callback is permitted after `close` returns; eventual teardown retains no borrowed host pointers.
Restart creates a new session epoch, revalidates metadata/bindings and uses an explicit consumer checkpoint/recovery
policy. No implicit resume, stale receipt reuse or automatic replay of prior output commands is permitted.
The adopting consumer specifies watchdog, halt, retry, OFF request and redeployment policy; this draft does not
replace or certify the Device policy documented at its separately pinned revision in the physical-boundary guide.

Native errors use stable categories: `1 ABI_MISMATCH`, `2 INVALID_ARGUMENT`, `3 UNSUPPORTED`,
`4 BINDING_MISMATCH`, `5 BUFFER_TOO_SMALL`, `6 BUDGET_EXCEEDED`, `7 DEADLINE_EXCEEDED`,
`8 UNAVAILABLE`, `9 IO_FAILURE`, `10 CANCELLED`, `11 INVALID_STATE`, `12 INTERNAL`.
Bounded diagnostic records add operation/endpoint/command IDs, native cause, retryability and observed outcome;
message text is not an error identity. An operation error never erases earlier applied/unknown evidence.

`open` negotiates explicit maxima for endpoints, record bytes/counts, outstanding commands, retained diagnostics,
memory, per-call work and completion deadlines. The Driver rejects an unsatisfiable budget before activation.
Length/count limits are checked before allocation or I/O; exhaustion has a deterministic error and bounded trace.
No universal board limits are invented. A synchronous deadline bounds cooperative work only; enforcing a stuck
native call requires consumer-owned isolation/watchdog policy and evidence. Errors never imply physical safety.

## Representative virtual conformance plan

A future harness will pin host/Driver/schema revisions and replay a virtual DI input and relay output:

| Case | Acceptance evidence |
| --- | --- |
| Negotiation and tables | Major mismatch, short tables, absent required callback/features reject without I/O; optional minor extension is safe. |
| Binding and quality | Compatible replacement preserves Program artifact; wrong units/timing/quality reject; absence, faults, duplicates and epoch changes remain observable. |
| Ordered scans | Same-time events have stable order; old/changed duplicate IDs reject; core decision and physical receipts stay separate. |
| Outputs and cancel | Delayed/partial failures, latch mismatch, late receipts and cancel-after-apply preserve requested/safe/applied/confirmed distinctions. |
| Budgets and restart | Boundary/overflow tests, full buffers, exhausted work/deadlines and close/reopen produce bounded errors without stale commands or hidden resume. |

Virtual success establishes interface behavior only, not physical proof, deadline certification, firmware adoption
or support for a dynamic loader. No test results are claimed here.
Reuse [scan-frame tests](../tests/scan-frame-wasm.test.mjs), [scan-tape parity](../tests/scan-tape-parity.test.mjs)
and [core signal contracts](../crates/ghostflow-core/src/signals.rs) as host/core regression baselines, not C ABI proof.
[Driver interval tests](../tests/true-for-driver-contract.test.mjs) also remain distinct from a future C adapter's
transport and authorized continuous-observation evidence; point DI samples do not certify an interval.
Before adoption, host and Driver owners must agree on concrete record encoding/type/unit registries, platform ABI,
trust binding, enforced budgets/deadlines, failure/restart/checkpoint policy and target evidence.
These are unresolved adoption decisions; this draft intentionally does not choose a product's policy for it.
