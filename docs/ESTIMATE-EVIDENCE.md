# Bounded estimate evidence admission

This API implements [#398](https://github.com/callin2/ghostflow-language/issues/398),
the evidence foundation of [#385](https://github.com/callin2/ghostflow-language/issues/385).
[Reference §4.4](reference/04-sensors-constraints-control.en.md#estimated-value-provenance-and-continuity)
owns the semantics. The portable core admits a declared basis; it produces no
numerical estimate, movement model, measurement, output command or temporal permission.
No GhostFlow declaration, Result status, sensor Quality or GFB encoding changes.
Compiler-visible estimate declaration and calibrated-duration examples remain #385.

## Public contract

`ghostflow_core::estimate_evidence::Session::new(reference, basis, capacity)`
explicitly establishes one session. Capacity is required, 1–64 records. Retention
never evicts; unsupported capacity or malformed uncertainty rejects creation.
`reference: None` represents a missing reference, not zero position.

`Reference` retains establishment monotonic time, initial sequence watermark and
uncertainty. `bound: None` explicitly means unknown; a known bound must be finite
and nonnegative. The uncertainty `meaning` digest binds the declared model/unit
meaning; the API neither chooses units nor manufactures a default bound.

`Context.identities` contains seven exact opaque 32-byte host identities, ordered:

1. Host boot identity.
2. Model and model revision record.
3. Calibration parameter/revision record.
4. Runtime reference identity record.
5. Reference assertion record, including who established it and its source.
6. Canonical authored program/source revision record.
7. Canonical installation binding/revision record.

Run, monotonic time epoch and source epoch are exact `u64`s. The host supplies the
owning canonical identities; digests do not authenticate assertions. No new
canonical hash algorithm is defined here. Missing/unverified records must not be
represented as a valid reference. Calibration persistence does not restore one.

`Basis::Requested` requires request records. `AcknowledgedWrites` requires actual
write-result records: Acknowledged, WriteFailed or Unknown. An ACK means only
Driver acceptance. `target` is an opaque byte/digital-mask value, not an arbitrary-unit
actuator quantity. Each record retains original execution origin: boot/program/
binding identities plus run/time/source epochs. Model, calibration and runtime
reference do not create write receipts. An earlier receipt can seed an explicitly
re-established reference only within that same execution origin and with complete
declared coverage. A cross-run/boot receipt is unavailable, never relabeled.

## Evaluation, completeness and transaction boundary

`evaluate(context, now_ms, history, source_fault)` returns a `Verdict` or a malformed
input `Rejection`. An ordered history declares initial/current sequence watermarks,
observed-from/through monotonic times, and whether coverage is complete. It includes
the original seed request/receipt at or before the reference instant; observed-from
equals that seed's original time. The seed's sequence follows the initial watermark.
Every later sequence is contiguous and the final sequence equals current watermark.
Observed-through must reach evaluation time. The host declares completeness,
including the tail after the last write; retained Device snapshots cannot infer it.

The entire prefix is retained under the explicit capacity. A repeated exact cached
receipt supports later evaluation only with declared continuous coverage. Its
identity, original time, target and result remain unchanged. Rewritten identities,
duplicate identities, decreasing sequence/time, future timestamps, wrong basis,
malformed packets and overflow reject without changing committed state.

Well-formed gaps, incomplete coverage, absent history, missing reference, changed
context, failed or uncertain writes return unavailable with a cause and invalidate
continuity. The original typed `SensorFault` remains a fault. An explicit supplied
fault takes priority. Changed context precedes clock comparison; backward monotonic
time within the same context yields ClockBackward. A subsequent valid-looking
history does not reset invalid continuity. Create a new session/reference explicitly.

Failed/uncertain records remain retained. An omitted later failure cannot be hidden
behind an old cached ACK. A shorter history does not erase the retained prefix.
Reference and last reported execution context are exposed separately. Unknown
uncertainty remains metadata; even admitted bases expose `temporalAdmission: false`.
Existing measured-only `hold_last`, windows and `true_for` are unchanged.

## Native/WASM transport and verification

`runtimes/wasm/estimate-evidence.mjs` only encodes/decodes. Its
`EstimateEvidenceRuntime` creates, evaluates and disposes a Rust-owned session.
The GFEE v1 binary packet adapter is shared verbatim with the native
`estimate_evidence` conformance example. Creation packets use kind 0 and evaluation
kind 1. Unsupported headers, flags/enums and trailing bytes reject. The maximum
evaluation packet is `298 + 64 * 146 = 9642` bytes, derived from exact layout.
Core retains at most capacity records; transport scratch and serialized snapshots
are also bounded by that supported ceiling. This is no MCU task-stack acceptance.

Host fields accept exact decimal strings or BigInt for full `u64` range. Safe integer
Numbers are allowed; unsafe Numbers reject. JSON snapshots emit `u64`s as decimal
strings. Native/WASM conformance compares complete snapshots and explicit expected
verdicts, causes, coverage and receipt provenance, including full capacity and +1.
Rust regressions live in `crates/ghostflow-core/tests/estimate_evidence.rs`.
`tests/estimate-evidence.test.mjs` runs in `tools/verify-language.mjs` and the existing
coverage gate. These are software declaration/admission tests, not physical position
or complete Device-history certification. No sensor-ingestion fallback exists.
