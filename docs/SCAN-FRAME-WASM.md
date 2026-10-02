# Scan frame WASM ABI v1

Main design,2026-09-11. D3 / issue15 / TASK76.3. Extends integration
SCAN-DRIVER-CONTRACT R1/R2; core dependency90ab335. Additive ABI, no GFB change.

## Lifecycle

A separate `FramedHandle` owns a configuring Runtime or an active ScanDriver.
`gf_frame_create`, `gf_frame_load`, `gf_frame_add_capability`,
`gf_frame_activate`, `gf_frame_destroy` mirror existing ownership conventions.
Load/capability configuration only before activation. Activation moves Runtime
into the owning ScanDriver once; failed activation preserves configurable state.
After activation, load/add/activate reject. A new program/run uses a new handle;
hot-swap/rewind support is not part of v1. Never reset frame IDs on failed calls.
Old gf_* handles/functions and their semantics remain unchanged. Handles are not
interchangeable; callers must use the matching allocator/lifecycle API.

Module buffers are at most 1 MiB. Capability names and kinds use the same
nonempty, well-formed UTF-8 / 1024-byte budget as input names. Check raw lengths
before constructing borrowed slices. The JS adapter accepts only byte buffers,
checks the module byte length before copying or allocating in WASM, and rejects
oversize text before encoding it. Validated input properties are captured once
so accessor-backed objects cannot change values between validation and encoding.
Buffer size checks use native intrinsic lengths, not shadowable user properties.
Input arrays are fixed-count indexed data: capture length once, do not invoke a
custom iterator, reject holes and a length change during capture before calling
WASM. Every accepted entry still passes the same name/type/duplicate validation.

## Single scan

`gf_frame_scan(handle, scan_id:u64, logical_time_ms:u64, bytes:*const u8, len:usize)`
returns1 success/0 failure. IDs/time have core safe-integer validation. The payload
is little-endian: u16 input count, then for each entry u16 UTF8 name byte length,
name bytes, u8 type (1 Bool, 2 Number, 3 Int), then u8 Bool (exactly 0/1),
f64 Number, or four-byte little-endian signed i32 Int.
No trailing bytes. Names must be nonempty valid UTF8 and at most1024 bytes; count
at most128; total packet at most65536 bytes. These ABI envelope limits are separate
from source syntax limits. Reject packet limits before slicing/allocating entries.
Checked cursor reads reject truncation, unknown type, malformed bool, nonfinite
numbers, duplicate names and reserved clock. Module completeness/types and frame
sequence are validated by the existing ScanDriver. No alternative VM evaluator.

Errors preserve previous committed outcome and VM state. Return a fresh error
message even for malformed input. Null handle/buffer inputs reject; raw pointer
ownership follows existing WASM embedding convention (valid allocated regions);
do not claim arbitrary forged pointers are a safe ABI. Host wrapper must own and
bound buffers, and free temporary allocations in finally blocks.

## Results

`gf_frame_outcome_ptr/len` exposes last committed JSON, initially null:
`{format:"GhostFlow/scan-outcome-v1",scanId,logicalTimeMs,trace:<TickRecord JSON>}`.
The buffer remains valid until next successful scan or destruction. Errors do
not replace it. `gf_frame_error_ptr/len` gives current diagnostic; a successful
operation clears it. Core TickRecord.tick remains its legacy namespace; do not
replace frame scanId with tick. Host session supplies run epoch identity.

## JavaScript adapter

`FramedGhostFlowRuntime` in `runtimes/wasm/framed-runtime.mjs` owns the matching
handle, has instantiate/load/addCapability/activate/scan/dispose and outcome.
`scan({scanId,logicalTimeMs,inputs:[{name,value}]})` explicitly carries IDs and
full inputs; no internal auto-increment on error, inferred false or old setters.
Validate exact fields, safe IDs, finite values, Unicode and budgets before
allocation. Copies data synchronously. Boolean/Number type follows JS value type;
Int uses declared `type: 'Int'` and a checked signed i32 value.
Outcome JSON contains only plain data. Methods after dispose throw; disposal is
idempotent. Check required exports and fail clearly on an old WASM artifact.
No change to ControlRuntime/frontend yet: D6 owns that integration and pins.

## Restart lifecycle extension

The compiler wraps a control with the exact reserved restart declarations in
GFB1 format 19. The wrapper identifies the reason input, ordered enum members,
and event input, and the loader validates them against the base module. The
manifest mirrors these values for host binding checks. The base control profile
and its version remain unchanged.

A validation-only host may call `gf_frame_validate(handle)` or
`FramedGhostFlowRuntime.validate()` after loading the module and registering its
capabilities. This checks capability compatibility and leaves the handle in its
configuring state. It does not initialize lifecycle inputs or permit scans.

Before activation, call
`gf_frame_initialize_restart(handle, reason_ordinal:u8, event_pending:u8)` or
`FramedGhostFlowRuntime.initializeRestart(reasonOrdinal, eventPending)`. The
reason ordinal follows the declared member order. The caller supplies `Unknown`
as ordinal 4 when it cannot confirm a cause. Initialization is required exactly
once for lifecycle modules. The host must preserve its boot-pending bit across
program replacement and pass false after a successful lifecycle event.

Lifecycle inputs are omitted from the complete scan frame and rejected if a
caller attempts to supply them. The runtime injects the fixed reason and event
value. A successful scan clears pending; a rejected scan retains it. Native and
WASM hosts can read `ScanDriver::restart_event_pending()` or the WASM
`gf_frame_restart_event_pending` / JavaScript `restartEventPending` property to
persist the resulting state. This extension does not restore VM or timer state.

## Acceptance

Actual built WASM tests cover configure/activate, same-scan requested/safe,
timer time injection, invalid complete inputs, duplicate/reserved names, unsafe
IDs/time, out-of-order/rollback, malformed binary/truncation/trailing/type/bool,
packet budget, error outcome preservation, continued valid scan after rejection,
dispose and missing-export behavior. Existing legacy suite still passes.
List new Node test explicitly in tools/verify-language.mjs. Do not claim native
framed/WASM parity (D9) or firmware adoption (D7) from this boundary test alone.
