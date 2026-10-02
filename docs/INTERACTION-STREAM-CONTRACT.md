# Interaction stream contract design

[한국어](INTERACTION-STREAM-CONTRACT.ko.md)

Design for [#74](https://github.com/callin2/ghostflow-language/issues/74).
This document specifies a normative host/core observation contract for future
adoption. It does not implement producers, transport, retention, rendering, or
new source grammar. Reference [§5.3](reference/05-settings-and-observation.en.md#53-renderer-independent-observation-model)
remains the language boundary; its lifecycle notation is not an existing record enum.
Settings from #70 are implemented; command and alarm descriptors are not.
The existing [v0 contract](../contracts/interaction-v0/README.md) stays unchanged.

## Meaning and ownership

| Record | Question answered | Identity |
| --- | --- | --- |
| Completed snapshot | What is observable now? | Exact schema/module/source, run and completed scan |
| Ordered event | What occurred in this execution? | Exact contract/module/source, run, stream and sequence |
| Command result | How was this request handled? | Event identity plus command ID and request digest |
| Alarm event | Which declared condition arose or cleared? | Event identity plus descriptor and episode ID |

The Rust core owns common lifecycle and execution identity and records facts
before invoking observation hooks. Authored programs own domain meaning.
Hosts export records and own long history; renderers consume evidence.
This follows accepted frontend [ADR-002 at revision `8f95786`](https://github.com/callin2/farm_studio_frontend/blob/8f95786/docs/adr-002-runtime-command-lifecycle-and-host-hooks.md);
its implementation is a separate adoption task.
Command completion is an execution outcome, not physical acknowledgement.
[§4.7](reference/04-sensors-constraints-control.en.md#47-requested-safe-applied-confirmed)
keeps requested, safe, applied and feedback-confirmed evidence separate.

An explicit, separately versioned external descriptor contract must bind typed
request inputs, request shape/permission, domain start and completion evidence,
and alarm condition/raise/clear meaning to this exact source and module.
Each command/alarm definition has a public `id`, `kind`, source-node provenance
and intent anchors. Alarm severity is declared metadata in that contract, with
its vocabulary and meaning declared there; no universal product severity is imposed.
Names, Bool values, callback names and output intent never infer these meanings.
There is no new `command`, `alarm` or severity source keyword.
The descriptor contract is metadata, not another executable control program.

## Separate future formats

Proposed labels are `GhostFlow/interaction-descriptor-contract-v1` and
`GhostFlow/interaction-stream-v1`, each with `version: 1`.
These are design labels, not currently accepted formats.
`descriptorContract` binds the exact external definitions; `schema` separately
binds the existing static snapshot schema. Neither digest substitutes for the other.
Digests use the exact strict canonical JSON UTF-8 rules in the v0 README,
including ordered arrays, sorted object keys, malformed Unicode rejection,
safe integers, finite numbers, no sparse arrays and maximum depth 64.
The descriptor digest covers the entire descriptor document, without a
self-digest field. Request digests cover the entire typed request object.

Illustrative JSON below is fictional: zero digests and source nodes are placeholders,
not a compiled artifact or verified source proof.

```json
{
  "format": "GhostFlow/interaction-stream-v1", "version": 1,
  "context": {
    "schema": {"format":"GhostFlow/interaction-schema-v0","version":"0.1","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "descriptorContract": {"format":"GhostFlow/interaction-descriptor-contract-v1","version":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "module": {"id":"example.control","moduleFingerprint":"0000000000000000","bytecodeSha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "source": {"documentId":"example.document","revisionId":"example.revision","format":"GhostFlow/source-document-v1","kind":"literate","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "runId":"example.run", "streamId":"example.stream"
  },
  "sequence": 21, "logicalTimeMs": 1000,
  "position": {"kind":"completed-scan","scanId":10},
  "descriptorId":"alarm.example",
  "provenance": {"sourceNodeId":7,"intentAnchorIds":["example.intent"]},
  "payload": {"kind":"alarm","transition":"raised","episodeId":"episode.1"}
}
```

Adoption must use the exact source format supplied by the compiled canonical
source identity. Each referenced format retains its own version type.
All objects have closed field sets. Reject unknown fields, duplicate JSON keys,
unsupported formats/versions, and missing or wrongly typed required fields.
No extension is silently ignored. Publication requires a machine-readable schema
and conformance tests before any producer claims this format.

## Canonical field contracts

| Field | Required meaning and validation |
| --- | --- |
| `context.schema` | Existing schema format/version/SHA-256; verify against the supplied static schema. |
| `context.descriptorContract` | Supported format/version/SHA-256; verify against supplied definitions and their exact module/source binding. |
| `context.module` | Exact public ID, 16 lowercase hex fingerprint, 64 lowercase hex bytecode digest, with v0 meaning. |
| `context.source` | Exact document/revision/format/kind/SHA-256, with canonical literate source and v0 meaning. |
| `runId`, `streamId` | Nonempty opaque public identities; together identify one ordered execution stream. |
| `sequence` | Nonnegative safe integer, starting at zero and increasing by one per originally produced occurrence regardless of retention. Retention never renumbers; never wrap or reuse. |
| `logicalTimeMs` | Nonnegative safe integer, nondecreasing within the stream; equal times do not imply equal occurrences. |
| `position` | Exactly `{"kind":"completed-scan","scanId":N}` or `{"kind":"execution-boundary","boundaryId":"opaque.id"}`. Scan IDs are nonnegative safe integers; boundary IDs are nonempty and run-local. |
| `descriptorId` | Public ID found in the exact descriptor contract with matching payload kind. |
| `provenance` | Exactly positive safe-integer `sourceNodeId` and nonempty distinct public `intentAnchorIds`; verify both against this exact source revision and descriptor. |
| `payload` | Exactly one of the closed command/alarm variants below. |

An execution-boundary occurrence may happen before a scan completes, including
request rejection. It must not fabricate a completed scan or use a pending scan
as completion evidence. A completed-scan occurrence references an actually committed
scan; its logical time matches that completion. Public IDs reject reserved `__gf_` names.
Consumer expected-identity mismatch is stale; an internal identity/provenance
contradiction is a validation error. No cross-revision join by display name is allowed.

## Command lifecycle

A fictional received record uses the same full envelope:

```json
{"format":"GhostFlow/interaction-stream-v1","version":1,
 "context":{
  "schema":{"format":"GhostFlow/interaction-schema-v0","version":"0.1","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "descriptorContract":{"format":"GhostFlow/interaction-descriptor-contract-v1","version":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "module":{"id":"example.control","moduleFingerprint":"0000000000000000","bytecodeSha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "source":{"documentId":"example.document","revisionId":"example.revision","format":"GhostFlow/source-document-v1","kind":"literate","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "runId":"example.run","streamId":"example.stream"},
 "sequence":23,"logicalTimeMs":1100,
 "position":{"kind":"execution-boundary","boundaryId":"request.1"},
 "descriptorId":"command.example","provenance":{"sourceNodeId":8,"intentAnchorIds":["example.intent"]},
 "payload":{"kind":"command","commandId":"command.1","requestSha256":"0000000000000000000000000000000000000000000000000000000000000000","state":"received"}}
```

Command payloads have exactly `kind: "command"`, `commandId`, `requestSha256`,
`state`, and, where allowed, `reason`. The ID is nonempty and run-local;
the digest is lowercase SHA-256 of the canonical typed request bound by the descriptor.
`reason` is exactly `{"code":"public.code","message":"human-readable detail"}`,
with both strings nonempty. Reason codes are declared by the descriptor contract.

```text
received -> rejected
received -> started -> completed | cancelled | failed
```

These transitions are normative for this proposed observation record contract,
not an accepted source-language change. `received` precedes every outcome.
`rejected` means execution never started; `started` records domain-start evidence
declared by the descriptor. `completed` records its declared completion evidence.
`cancelled` and `failed` are distinct terminal outcomes after starting.
Rejection and failure require `reason`; cancellation may carry an explicit reason.
An execution-boundary failure before starting is recorded as `rejected` under
this graph, with its explicit reason; it must not fabricate `started`.
Received, started and completed forbid `reason`. A terminal state has no successor.
One command ID cannot be reused for a different request or descriptor; a retry
with the same ID/digest identifies the same execution and must not start it again.
Current command state retains the last valid lifecycle state, with its original
sequence/provenance; it is not a new lifecycle occurrence.
The producer must record the full chain beginning with received. After an
explicit gap, a consumer preserves an observed started or terminal result as
incomplete history and does not fabricate missing steps. Transition rejection
requires validated coverage proving that the relevant history is complete.
Command deduplication and current state are run-scoped: they must survive
same-run reconnect or collection-stream recreation. If they cannot be recovered,
the host must start a fresh run ID under its new-run policy, not merely a new stream ID.

## Alarm episodes and missed refreshes

Alarm payloads have exactly `kind: "alarm"`, `transition: "raised" | "cleared"`,
and nonempty run-local `episodeId`. One descriptor's new inactive-to-active
transition creates a fresh episode ID. Its clear uses that same ID; it cannot
clear another episode. Repeated active observations do not create new raises.
Declared alarm current state and ordered transitions are separate observations.

| Observation | Alarm state or record |
| --- | --- |
| Snapshot, completed scan 9 | Inactive |
| Event, sequence 21, completed scan 10 | `raised`, descriptor `alarm.example`, episode `episode.1` |
| Event, sequence 22, completed scan 11 | `cleared`, same descriptor and episode |
| Snapshot, completed scan 12 | Inactive |

The scan-9/12 snapshots cannot reveal that episode. Retained events must reveal
both transitions; if lost, export an explicit gap. No timestamp or inactive
snapshot can reconstruct the missing history. This table illustrates a future
alarm-capable observation; it does not inject alarm descriptors into v0.

## Ordering, retention and reconnect

A cursor is exactly `(runId, streamId, sequence)`. Order uses sequence, never
arrival order or timestamps. A repeated sequence with identical canonical record
bytes is an idempotent delivery; different bytes at that sequence are an error.
A consumer may buffer reordered delivery, but cannot declare a missing sequence
complete until it receives the occurrence or explicit loss evidence.

Future core retention uses a bounded ring, current command state and latest
result per command class (class identified by the external descriptor contract).
Current-state slots and request deduplication storage also have declared finite
budgets; no unbounded per-request map is permitted. Admission must fail explicitly
when safe identity deduplication or protected state cannot fit that budget.
The host exports records before reclaiming them. A declared finite policy states
record/byte budgets, protected critical-fault and latest-failed-result priority,
eviction ordering and admission behavior. Protection does not promise unlimited
history: reject admission when a promised guarantee cannot be honored, or report
explicit loss under the declared policy. Exported long history belongs to the host.
Protected current/latest-failed state per class must remain within its separate
budget; inability to preserve it requires admission failure, not silent eviction.
History eviction always reports a gap, including prioritized critical history.
Latest/current records help answer current status; they never replace occurrence history.

Loss reports are separate transport metadata, not sequenced domain occurrences.
Retention coverage uses the closed report `kind: "coverage"`, `runId`,
`streamId`, `latestSequence` and `availableRanges`. `latestSequence` is null
if no occurrence has been produced, otherwise a nonnegative safe integer.
Each range is exactly `{fromSequence,toSequence}`, inclusive, with nonnegative
safe bounds `from <= to <= latestSequence`. Ranges are sorted and disjoint;
null requires an empty array. Produced history is `0..latestSequence`; every
unavailable hole requires an exact gap report, even if the stream is now quiet.
This is exporter coverage, including retained interior critical records, not
a claim that all produced history remains available.
Their closed fields are `kind: "gap"`, `runId`, `streamId`, `fromSequence`,
`toSequence`, `reason`; bounds are nonnegative safe integers with `from <= to`.
The interval is inclusive and exact; every sequence in it is unavailable from
this exporter. Adjacent known intervals may merge, never across known retained
records. Discard before export requires this report. A policy's retained range
must expose interior holes as intervals, not imply continuous coverage.

If the lost range is unknown, use the separate closed report
`{"kind":"discontinuity","previousRunId":"old.run","previousStreamId":"old.stream","runId":"new.run","streamId":"new.stream","reason":"history-unavailable"}`.
All identities/reason are nonempty strings. Do not invent numeric bounds.
Reconnect with the same run/stream resumes from the last accepted cursor and
exports exact known gaps. Reset/restart changes run ID; recreation without
recoverable ordering changes stream ID. Either change starts a new cursor and
requires explicit discontinuity; sequence/scan zero in the new epoch is not
continuation. No command or alarm episode is silently joined across that boundary.

## Rejection and adoption gates

| Case | Required result |
| --- | --- |
| Unknown field/version, unsafe integer, malformed digest | Reject record. |
| New command/alarm kind inserted into v0 schema/snapshot | Existing v0 validator rejects; no compatibility relaxation. |
| Descriptor/module/source mismatch or invalid anchor | Validation error; no name-based fallback. |
| Expected run/source differs from valid record | Stale identity result; start explicit new cursor when appropriate. |
| Changed duplicate sequence or reused command ID with changed request | Reject as identity conflict. |
| `received -> completed` or terminal successor with proven complete coverage; failure without reason | Reject lifecycle violation. |
| Started or terminal command observed after explicit history gap | Preserve observed result as incomplete history; never fabricate missing steps. |
| Clear without known raise after an explicit gap | Preserve clear as evidence; mark episode history incomplete, never fabricate raise. |
| Clear without raise in a complete validated history | Reject episode transition. |
| Reconnect/restart loses unknown history | Explicit discontinuity; no fabricated exact gap. |

Future adoption must specify external descriptor serialization and validation,
core recording and bounded retention, host export/recovery, and conformance cases
for every gate above, all terminal command paths, brief alarm episodes and restart.
Existing completed-snapshot/browser evidence establishes only that existing path.
frontend [#161 acceptance](https://github.com/callin2/farm_studio_frontend/issues/161#issuecomment-5679111790)
is evidence for the existing Worker/WASM path only.
It does not establish these new producers or physical behavior. No runtime
stream producer or retention implementation is delivered by this design.
