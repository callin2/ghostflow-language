# Native/WASM scan tape parity (D9)

Status: implementation contract; acceptance is recorded by the host verifier.
Task: [language #16](https://github.com/callin2/ghostflow-language/issues/16),
integration TASK-76.9. Parent: [system #11](https://github.com/callin2/farm_studio_system/issues/11)
/ common Clock, DI and RO drivers. Coordination: [Project 6 Backlog](https://github.com/users/callin2/projects/6/views/3).

## Decision

GhostFlow evaluates one complete input snapshot at one logical time, independent
of the host clock and I/O implementation. Native and browser WASM must consume
the same compiled module, capabilities, initial state and ordered frame attempts
and produce identical accepted scan outcomes. The shared `ScanDriver` remains
the only owner of input validation, state transitions, timers and constraints.

This gate compares the framed native driver with the public framed WASM adapter;
the historical CSV/legacy tick example is not its native oracle. No runtime ABI,
product source syntax, timer semantics or Device pins change in this task.

## Implementation ownership

| File | Responsibility |
| --- | --- |
| `crates/ghostflow-core/examples/scan_tape.rs` | Test-only native transport into `ScanDriver::scan`; JSONL observations |
| `tests/scan-tape-parity.test.mjs` | Compile each scenario once, run both targets, assert expectations and exact outcome equality |
| `tools/verify-language.mjs` | Build the release native harness, require the parity suite and record artifact hashes |
| This document | Scope, format, failure contract and evidence interpretation |

There is no copied interpreter, simulated timer implementation, or new production
dependency. Each harness starts a fresh runtime with the same 1024-entry journal
capacity as the WASM adapter. Output capabilities are derived from the module's
declared output fields for these fixtures. Each replay uses a new runtime.

## Test tape transport

The canonical tape in the Node test is an ordered array of frame attempts with
`scanId`, `logicalTimeMs` and an ordered `inputs` array. Preserve duplicates and
order when passing the exact array to WASM or serializing it for the native CLI.

The native CLI takes a GFB1 file and a UTF-8 TSV tape file. A nonempty row is:

```text
scanId<TAB>logicalTimeMs[<TAB>name<TAB>b|n<TAB>value]...
```

IDs and times use unsigned decimal integers; `b` values are `true` or `false`,
and `n` values use finite decimal numeric notation. Empty input lists are valid
transport and are validated by the driver against the module. Names in this
test-only format cannot contain tabs or line breaks. Reject malformed transport
with a nonzero CLI exit; do not count it as a rejected GhostFlow frame. Bound
module/tape/row sizes and input counts before allocation or execution. This TSV
is a conformance fixture format, not a new public runtime ABI.

One JSON line is returned per well-formed frame attempt:

```json
{"accepted":true,"outcome":{"format":"GhostFlow/scan-outcome-v1","scanId":0,"logicalTimeMs":0,"trace":{}}}
```

`outcome` contains the complete canonical trace, not the abbreviated object shown
above. On rejection, `accepted` is false, `outcome` is the last accepted outcome
(null before the first commit), and `error` provides diagnostic text. Native uses
the core's existing trace JSON serialization. It must not recompute output/state.

## Comparison and failure contract

For each attempt assert accepted/rejected classification and exact deep equality
of the complete outcome, including time, scan ID, module identity, input/state,
requested output and constraint/safety trace. Assert scenario-specific expected
behavior independently of cross-target equality so two matching errors cannot
pass as correct behavior.

Error strings are diagnostic, not cross-host ABI: the JavaScript envelope and
Rust core can reject at different layers. Both must reject the semantic invalid
attempt, preserve their last accepted outcome, and accept a corrected retry with
the unconsumed scan ID. Check expected diagnostic patterns where useful. A raw
framed adapter permits retries; the higher-level control host fault latch is a
different contract and is not imposed on this harness.

Required vectors:

- Timer just before, at and after expiry, with explicit expected outputs.
- Self-hold start/release/stop/restart and old/next state transitions.
- Constraint/interlock suppression: requested ON and safe OFF with causal trace.
- Equal timestamps, progression across the 32-bit millisecond boundary, replay.
- Missing, extra, duplicate, reserved and wrongly typed inputs; bad scan order,
  time regression and values beyond the JavaScript-safe integer frame limit.
- Rejection before the first commit and after a successful commit; corrected
  same-ID retries show that state/timers/counters were not advanced by rejection.
- A runtime evaluation failure (for example division by zero), followed by
  recovery, exercises rollback beyond envelope validation.

Nonfinite/negative/malformed JavaScript envelopes remain covered by the existing
WASM adapter suite; malformed TSV is covered as transport, not cross-host parity.

## Gate and evidence

`npm test` builds the native release `scan_tape` example and WASM from this source
revision before running the explicit parity test list. `--node-only` requires
both artifacts to already exist and reports them as not built by that run. The
verification report keeps separate hashes for WASM, legacy native and framed
native artifacts and includes these new source files in its source hash set.

Independent review checks exact outcomes, rollback and harness independence from
the control logic. Full host verification must pass on the reviewed head before
this issue is closed. Firmware consumption/pinning (D7/D8), accelerated browser
scenarios (D10) and cross-module release qualification (D11) remain separate tasks.

## Prior implementation references

- `docs/SCAN-FRAME-WASM.md` and `crates/ghostflow-core/src/scan.rs`: accepted
  framed contract, input completeness and transactional runtime semantics.
- `runtimes/wasm/framed-runtime.mjs`: public framed wrapper and last-outcome rules.
- Read-only predecessor `esp32s3-new-project/rust/firmware/src/inputs.rs`,
  `rust/control-core/src/debounce.rs` and the DI scan section of
  `rust/firmware/src/main.rs`: physical raw-level normalization/debounce belongs
  to the device driver before the logical input frame. No predecessor ST path or
  old device evidence is imported as GhostFlow acceptance.
