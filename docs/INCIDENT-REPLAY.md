# Incident capture and replay

English source; [한국어 번역](INCIDENT-REPLAY.ko.md).

The reference host CLI `tools/ghostsim-incident.mjs` supports
[#133](https://github.com/callin2/ghostflow-language/issues/133) by reusing
`ghostsim.runScenario`, its artifact/source-map checks, and the existing native
or WASM core. It adds no VM, physical device model, or raw event-to-tick reducer.
The [host event ordering contract](HOST-EVENT-ORDERING-CONTRACT.md) remains the
owner of ingress ordering. This adapter consumes only explicit scenario actions
and completed scans; it does not infer missing events or arrival order.

## Commands and scope

```sh
node tools/ghostsim-incident.mjs capture program.gfb scenario.toon new-bundle
node tools/ghostsim-incident.mjs replay new-bundle
node tools/ghostsim-incident.mjs replay new-bundle --candidate changed.gfb
```

`capture` starts a new virtual run from program initializers. It seals the exact
GFB bytes, manifest, source map, explicit scenario and completed result in an
exclusive new directory. Generated virtual run/boot IDs identify that capture,
not a reconstructed historical device run. Settings and bindings come only from
the artifact defaults and explicit scenario activation. Arbitrary mid-run state
restore, unknown settings revisions and replay across boot boundaries are not
supported. Original files are never overwritten.

`replay` verifies the manifest seal and every inventory hash/size, then stages
the verified byte buffers in a private temporary directory. The simulator reads
those copies; replacing the supplied bundle after verification cannot change
the execution inputs. Temporary execution copies are removed after use. Artifact
leaves and the supplied directory cannot be symlinks. Files are limited to 4 MiB,
inventories to 32 entries, and completed records to 256 scans; ghostsim's existing
scenario bounds still apply. Failed publication may leave an incomplete new
destination; it never overwrites an existing destination or removes user inputs.

The runtime revision includes the actual selected native/WASM binary digest,
all top-level tool and WASM adapter `.mjs` source digests, dependency lock digest,
and Node version. Exact equality is required; unrelated tool changes can therefore
invalidate an old capture conservatively. The selected revision is checked before
and after execution. Restore the exact host/runtime to replay an old capsule;
never relabel a new binary with an old identity. These are content revisions,
not official build numbers. Dependency installation integrity and trusted host
execution remain prerequisites; hashes are consistency checks, not authenticated
provenance or protection from another process with the same user's authority.

## Results and evidence meaning

Each command prints one `GhostFlow/incident-replay-result-v1` JSON object. Exit
status is 0 for captured/completed/compared, 2 for partial evidence, and 1 for
rejection. Repeated replay of unchanged inputs returns identical result objects.
Missing initial state/artifacts are partial. Corruption, runtime revision mismatch,
scan sequence gaps, backward logical time, boot mismatch and changed recorded
decisions are rejected explicitly. No interpolation repairs those conditions.

Candidate comparison starts a fresh instance with the same sealed scenario. It
reports source identities and safe virtual output differences by scan ID, logical
time and channel, including channel presence. `matched` refers to reproduction of
the original record; `candidate.equivalent` refers only to compared safe outputs.
It does not claim equivalence of internal state, timing on hardware or all future
behavior. Candidate execution failure rejects the comparison.

Historical `FarmStudio/incident-bundle-v1` envelopes from System229 are accepted
only for bounded inventory integrity checking and explicit gap reporting. They
remain partial even if `replay.available` says true: this format supplies no
completed-scan capsule. Producer semantic validation remains with System; a
recomputed seal does not authenticate a historical statement. Private device
records are not repository fixtures. No fallback reconstructs their missing run,
settings, state, clock or scan positions.

All results describe recorded **virtual decisions**, not applied/confirmed
physical outputs, contacts, closed-loop plant behavior or HIL acceptance. A
synthetic native/WASM parity regression compares existing engines; it is not an
independent physical oracle. No service, network, model or hardware is invoked.

## Verification and remaining integration

`node --test tests/ghostsim-incident.test.mjs` covers repeatability, candidate
differences, corruption/missing inputs, runtime/helper revision drift, verified
snapshot execution, initial-state/scan/clock/boot boundaries, historical partial
envelopes, CLI exit codes and synthetic native/WASM parity. The suite is explicitly
registered in the full verifier. It preserves historical evidence and language,
GFB, ABI and scenario-result semantics.

This is the cold-start virtual capture/replay consumer. Complete historical
incident replay still needs the producer to supply an exact executable artifact,
effective settings/binding revisions, sufficient initial execution state and
ordered completed scans. Host event ingress capture and arbitrary state restore
remain separate capabilities; this tool does not mark them implemented.
