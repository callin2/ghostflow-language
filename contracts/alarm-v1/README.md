# Alarm observation v1

[한국어](README.ko.md)

This is the bounded alarm producer adopted for [#287](https://github.com/callin2/ghostflow-language/issues/287),
REF-05-027. It implements software observations of authored Bool states through
Rust `ScanDriver`. It does not implement the future command lifecycle or the full
[interaction stream design](../../docs/INTERACTION-STREAM-CONTRACT.md).

## Source and descriptor

[The canonical example](examples/temperature.ghost.md) computes a Bool state from
a quality-aware input. Its explicit fault branch retains the previous condition.
The external descriptor maps `state.hot` to an alarm and supplies raised/cleared
meaning and a severity code with its definition. Neither a state name nor its
Bool value implicitly makes it an alarm. There is no new language keyword or
executable descriptor expression. This profile accepts one standalone scalar
GFB module (versions 1–4), interaction schema 0.3, and 1–16 unique authored Bool
state conditions with `activeWhen: true`. Other profiles fail explicitly.

The closed [descriptor schema](descriptor.schema.json) is
`GhostFlow/alarm-descriptor-v1`, numeric `version: 1`. Use
`prepareAlarmObservation(compilation, descriptor)` from
`tools/alarm-observation.mjs` after canonical compilation with
`interactionSourceIdentity`. It replays the canonical source and uses the
existing interaction schema/provenance validator. Schema, source and module
must match exactly; node IDs and ordered intent anchors must match the selected
state. Meanings contain 1–512 UTF-8 bytes. Each state has 1–32 anchors.
`parseAlarmDescriptor` accepts strict canonical JSON only, rejecting duplicate
keys and unknown/noncanonical representations. Programmatic input is checked
with the same canonical JSON rules and exact field sets. Preparation owns an
immutable copy, including all nested provenance.

`bind({runId, streamId})` produces GFAL version 1 bytes and their SHA-256.
The compiler-validated packet and expected digest cross the trusted activation
boundary together. Rust checks the digest, exact SHA-256/FNV/module name of the
loaded original GFB bytes, and the existence and Bool type of every state slot.
Rust does not parse Markdown or prove source anchors from executable bytes.
A caller replacing both packet and expected digest bypasses the compiler trust
boundary; the digest is integrity binding, not an authentication signature.
No wrapper or new GFB version changes the executed module identity.

## Runtime and records

Two core placement options were considered: `Runtime::tick_at` can see accepted
state but has no framed scan/run identity; `ScanDriver` already owns complete
frames, scan order and rejection. The latter owns this observer so its events
and current snapshot share the exact completed-scan boundary.

`AlarmObservationRuntime.instantiate(wasmBytes, compilation, descriptor, identity)`
loads the original program and activates the observer once before any scan.
The native equivalents are `ScanDriver::activate_alarms(packet, expected_sha256)`
and `query_alarms(packet)`. Invalid observer activation leaves the runtime
unchanged and permits ordinary control scans. The framed ABI adds
`gf_frame_alarm_activate`, `gf_frame_alarm_query` and report pointer/length
exports. GFAQ version 1 queries carry binding, run and stream identities plus an
optional exclusive sequence cursor; queries cannot inject events or advance a
scan. Existing framed APIs and v0 snapshots retain their format.

Rust records the condition after each successful scalar scan, before returning
the outcome to any consumer. Failed evaluation, stale scan IDs and reverse
logical time leave current state, sequence and history unchanged. Before the
first successful scan, every condition is `unobserved` with null scan/time.
First committed true raises one episode; repeated true adds nothing; false
clears that same episode. A later true creates a new episode. Equal timestamps
still have distinct sequence numbers. An episode's identity is the binding,
run, stream, alarm ID and its `episodeSequence` (the raise sequence).

The closed [report schema](report.schema.json) is
`GhostFlow/alarm-report-v1`, numeric `version: 1`. It contains exact source,
module, schema and descriptor digests, current state at the last completed scan,
ordered events, a binding/run/stream cursor, and retention coverage. Current
state is separate from event history. Returned JS records are copies. A consumer
which queries only after false→true→false receives inactive current state and
both raised/cleared events. The report's descriptor digest joins the explicit
severity and meaning metadata; record values never infer those meanings.

Retention holds 1–1024 events plus fixed state for all declared alarms. Overflow
evicts oldest events, never blocks a scan and never renumbers events. A query
missing retained history returns an exact inclusive `retention-overflow` gap;
current state and the latest sequence remain available. Cursor reads return only
events after that sequence. Wrong binding/run/stream and ahead cursors fail.
The sequence safe-integer limit is checked before evaluation; exhaustion requires
a fresh run. No reset, reload or persisted recovery API is provided by this
facade. Hosts must issue fresh run/stream identities when recreating an owner or
process; uniqueness across independent processes is a host responsibility.
Reconnect to the same live owner preserves state and history.

These records prove software condition transitions. They do not prove physical
actuation. Requested, safe, applied and feedback-confirmed output evidence remain
separate. Command acceptance, start, completion, cancellation and physical
acknowledgement are outside this alarm-only format.

## Focused verification

Build the actual native and WASM owners from this checkout, then run:

```sh
cargo build --offline --release -p ghostflow-core --example alarm_tape
cargo build --offline --release -p ghostflow-wasm --target wasm32-unknown-unknown
node --test tests/alarm-observation.test.mjs
```

Selectors are `GF-TEST-alarm-provenance`, `GF-TEST-alarm-short-episode`,
`GF-TEST-alarm-history`, `GF-TEST-alarm-atomicity`,
`GF-TEST-alarm-initial-condition`, `GF-TEST-alarm-activation`,
`GF-TEST-alarm-consumer` and `GF-TEST-alarm-schema`. Tests compare complete native
and WASM outcomes and reports from the same source, descriptor and frames. They
cover short episodes, repeated true, new episodes, same timestamps, failed first
and later scans, retention gaps, cursor identity, immutable results, tampered
provenance, wrong module/type, and control execution after rejected activation.
