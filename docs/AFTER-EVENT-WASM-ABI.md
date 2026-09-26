# Identified after_event execution ABI

`runtimes/wasm/after-event-runtime.mjs` exposes the existing Rust
`AfterEvent<32>` engine through WASM. JavaScript transports facts and reads native
results; it does not evaluate event windows. This is an independent execution
primitive. It does not activate a compiled control or choose a scalar projection
for overlapping results.

## Bind a site from canonical source

The browser-safe `instantiateSource` entry compiles one complete `.ghost.md`
document with the public toolchain and selects a named `after_event` declaration.
Its window and event/predicate source tags come from that declaration. The host
does not re-enter those values or extract a raw control string.

```js
const runtime = await AfterEventRuntime.instantiateSource(wasmBytes, document, {
  filename: 'pump.ghost.md', signal: 'opened',
});
const { eventSourceTag, predicateSourceTag } = runtime.binding;
runtime.stage({
  time: { epoch: 7, nowMs: 100 },
  starts: [{ sourceTag: eventSourceTag, sourceEpoch: 2, id: 1,
    timeEpoch: 7, atMs: 100 }],
  predicate: { sourceTag: predicateSourceTag, atMs: 100,
    value: true, quality: 'measured' },
  acknowledgements: [],
});
runtime.commit();
console.log(runtime.results); // Each item retains its complete event identity.
runtime.dispose();
```

`binding` is immutable. `source` retains the complete immutable source document,
filename, SHA-256, descriptor SHA-256, selected signal/site, and logical event and
predicate names. Selecting an absent name or another declaration kind fails
before WASM activation. Multiple sites require explicit selection; there is no
default first or latest site. This adapter evaluates only the selected evidence
site. It does not execute outputs, state expressions, or other sites in the
document, and it does not certify the document for device deployment.

Native results remain `pending`, `satisfied`, or `expired` by identity. A stage
and rollback preserves the previous results. The adapter has no scalar
`Result<Bool, SensorFault>` conversion: one event may expire while another is
satisfied in the same batch. Full `ControlRuntime` transaction integration still
requires the source projection contract below.

## Low-level binding

```js
const runtime = await AfterEventRuntime.instantiate(wasmBytes, {
  windowMs: 10_000, eventSourceTag: 11, predicateSourceTag: 22,
});
runtime.stage({
  time: { epoch: 7, nowMs: 100 },
  starts: [{ sourceTag: 11, sourceEpoch: 2, id: 1, timeEpoch: 7, atMs: 100 }],
  predicate: { sourceTag: 22, atMs: 100, value: true, quality: 'measured' },
  acknowledgements: [],
});
runtime.commit(); // Or rollback() before committing.
console.log(runtime.results); // [{ event: {...}, status: 'satisfied', satisfiedAtMs: 100 }]
runtime.dispose();
```

Each instance binds exactly one declared Event source and one Bool predicate
source. Tags must match the binding. A batch expires old windows, acknowledges
terminal results, adds starts, and applies the predicate atomically in Rust.
Before commit, `results` exposes only committed state. Failed decoding or native
staging does not consume identities, expiry, acknowledgements, or clock advance.
An already staged transaction stays available for commit or rollback after a
second stage fails.

The engine retains up to 32 identities, including completed results, until
explicit acknowledgement. Overflow rejects the entire batch. This is the WASM
adapter capacity; the Rust engine itself uses a caller-selected const capacity.
A pending result cannot be acknowledged before its terminal boundary. Output
statuses are `pending`, `satisfied`, and `expired`; only `satisfied` includes
`satisfiedAtMs`. Identity is `(sourceTag, sourceEpoch, id)`, never the output slot
index. New IDs increase within the bound source epoch. A clock epoch change
requires a new engine instance; no hidden reset discards results.

Predicate quality is `measured`, `held`, or `constructed`. Only measured true
observations satisfy windows. `null` means no observation. New starts and predicate
observations must carry the current batch time. Duplicate retained event delivery
keeps its original identity and time. Satisfaction excludes the exact end of
`[event.atMs, event.atMs + windowMs)`.

## GFAE version 1 packet

All multibyte integers are unsigned little-endian. All u64 values must be at most
`2^53 - 1`. The decoder accepts at most 2,048 bytes and rejects trailing bytes,
unknown version/flags, invalid Boolean bytes, and unknown qualities.

| Field | Encoding |
|---|---|
| Magic, version, reserved flags | `GFAE`, u16 = 1, u16 = 0 |
| Time epoch, now | u64, u64 |
| Start count, acknowledgement count | u16, u16; each at most 32 |
| Predicate present | u8 = 0 or 1 |
| Each start | source tag u32; source epoch, ID, time epoch, atMs u64 |
| Each acknowledgement | source tag u32; source epoch, ID u64 |
| Optional predicate | source tag u32; atMs u64; value u8; quality u8 |

Quality bytes are 0 = measured, 1 = held, 2 = constructed. Tags are nonzero u32.
The create/stage/commit/rollback/destroy exports use an opaque instance handle.
Results and errors are UTF-8 strings exposed through pointer/length getters.
Consumers copy those views before subsequent mutation or disposal.

## Remaining control integration

The Reference requires independent results for overlapping starts. It does not
specify which identity `opened |> recover(false)` selects. Choosing newest,
oldest, any, or all would add language semantics. Until a projection contract is
specified, the compiler's non-executable descriptor and `ControlRuntime` gate
remain. The WASM primitive does not claim transactional integration with a control
tick, checkpoint/replay, or deployment support.

## Natural provider blocker

`tide_is` and `moon_is` require a separate typed observation protocol and native
Result evaluator. Reference §3 supplies classifications and requires provider
classification criteria, location/timezone, revision, coverage, expiry, and
uncertainty. None is transported by the current temporal descriptor.

Before executable lowering, define and verify:

1. Binding of provider identity, location/timezone, classification criteria and
   revision to each observation and source query.
2. Civil-clock trust, coverage/expiry boundaries, and how uncertainty affects
   classification validity. In particular, no implicit uncertainty tolerance is
   selected by this ABI.
3. Fault mapping to `TemporalContextFault`, retaining unavailable/stale evidence
   through explicit `case` and Schedule Unknown/fallback paths.
4. Native validation and evaluation, generated Result projections, and atomic
   control tick/replay handling. A host Boolean alone cannot satisfy this contract.

These are remaining implementation/interface decisions; no runtime conformance
claim follows from successful descriptor compilation. Existing tests retain the
executable rejection until this boundary is implemented.
