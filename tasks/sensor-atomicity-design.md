# Sensor scan transaction

Reference §2.8/§4.15 requires a rejected tick to leave sensor, filter and VM
state uncommitted. Batch7 proved VM debounce rollback but exposed conditioner
mutations before VM acceptance. This work closes that host integration gap;
it does not certify physical acquisition, persistence across reboot, or future
controller/resource implementations.

## Contract

- Each Rust signal handle owns at most one complete checkpoint. It contains
  filter history, clocks, accepted sample identity, faults, recovery count,
  hysteresis, diagnostics, configuration and the ABI error buffer.
- `gf_signal_begin`, `gf_signal_commit`, `gf_signal_rollback` return 1 on
  success and 0 on invalid handle/lifecycle. Nested begin cannot replace the
  original checkpoint. Inactive commit/rollback reject. Disposal drops both
  current state and any checkpoint. Reset inside a transaction is reversible.
- JS `SignalConditioner` methods only call those exports. No copied JS sensor
  state, evaluator, or freshness cache is introduced.
- Capture/validate the complete scan first. Begin every sensor and hysteresis
  conditioner before mutating any. A failure to begin rolls back only the
  handles already begun.
- Conditioning, input preparation, or a known native VM rejection rolls back
  every begun conditioner. VM committed state/outcome, last accepted time and
  frame ID stay unchanged. A complete valid retry is allowed.
- A typed native-dispatch error carries `committed: false | true | null`.
  Status starts false before preparation, becomes null immediately before the
  native call, and becomes the Boolean native return value immediately after
  it returns. Error-buffer decoding and allocation cleanup cannot overwrite
  this fact. Error message text is never used to infer commit status.
- Positive native status commits conditioners and accepted host time/frame ID
  before decoding trace/outcome JSON. A later presentation error cannot undo
  accepted execution. A cleanup exception after positive native status must
  still commit conditioners and accepted host bookkeeping. Such errors
  terminate that host instance. Once committed, a later exception's class
  cannot reclassify the scan as rejected.
- An unexpected trap/adapter exception during native dispatch has unknown
  commit status. Terminate further steps without claiming rollback or allowing
  a speculative retry. Retain current state; release pending checkpoints on
  host disposal so the last committed VM outcome remains inspectable.
- The old framed blanket fault latch existed because conditioner rollback was
  unavailable. Remove it for known rejected scans. Keep terminal handling only
  for the concrete unknown/postcommit cases above.

## Acceptance and ownership

- Astra: bounded Rust snapshot, lifecycle and native tests, matching WASM build.
- Luna: thin JS methods and real WASM lifecycle/error tests. Missing ABI
  TypeErrors must not satisfy lifecycle rejection assertions.
- Sol: both ControlRuntime paths, explicit native commit boundary, actual
  median/EMA/hysteresis/recovery rollback and retry tests, superseded contracts.
- Root: source/API review, explicit test registration, full integration gate
  after all owners freeze, evidence index and remaining-scope accounting.

Distinguishing vectors preserve prior history rather than resetting it:
median(3) committed 10,20 + rejected 999 + committed 30 => 20; EMA(0.5)
committed 10 + rejected 20 + committed 30 => 20; hysteresis committed 20
(on) + rejected 40 (off) + committed 33 (between thresholds) => still on.
Recovery counters, identities, diagnostics and clocks must likewise roll back.

Memory is one additional bounded Rust snapshot per allocated conditioner.
The canonical compiler's 128 generated-input budget allows at most 42
three-input conditioners (other inputs can reduce that number). This is not
a global allocation limit on standalone ABI callers. Record measured per-handle
memory and actual acceptance results after implementation.

## Rust evidence

- Native: `Sensor` 664 bytes; checkpoint slot 688 bytes; full handle 1,376 bytes.
- WASM: `Sensor` 648 bytes; checkpoint slot 664 bytes; full handle 1,328 bytes.
- A checkpoint can additionally own up to 40 bytes of copied error text.
  Allocator overhead is excluded. The core Sensor has no heap-owned fields.
- Core signals 15/15, native ABI 2/2, allocation test 1/1 passed. The allocation
  test covers core update/read/clone/restore, not the ABI error string allocation.
- Evidence: `build/sensor-transaction-core-final.log`,
  `build/sensor-transaction-abi-final.log`,
  `build/sensor-transaction-allocations.log`,
  `build/sensor-transaction-wasm-memory.log`.
- These results alone do not prove REF-04-065 or overall compiler/runtime
  completion.

## Focused host evidence

- Real WASM lifecycle tests: 6/6. Native-dispatch status tests: 11/11
  (`build/native-dispatch-status-final.log`).
- Host atomicity tests: 9/9 (`build/control-runtime-atomicity-final.log`). They
  cover multiple filters, hysteresis, recovery, a later conditioner error,
  accepted identity/time, retry, and postcommit failures.
- Global REF-04-065 remains partial: controller/resource transactions and its
  other clauses require separate evidence. Durable restart/replay of the
  complete host state is separate from this ephemeral scan checkpoint.
- Batch8 full integration gate: Node 1,621 total, 1,426 pass, 31 fail, 164 TODO, 0 skip; Reference 172 pass / 31 fail; non-Reference 0; tutorial not run. Reports: `build/compiler-runtime-batch8-full.log`, `build/compiler-runtime-batch8-reference-results.json`, `build/compiler-runtime-batch8-verification.json`.
