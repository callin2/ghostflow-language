# Effect and Process contract

[한국어](EFFECT-PROCESS-CONTRACT.ko.md)

Status: conceptual contract and executable test-local model for
[#116](https://github.com/callin2/ghostflow-language/issues/116), for future adoption.
There is no accepted five-kind GhostFlow source union. This document implements
no compiler, host effect engine, workflow scheduler, transport schema or ABI.
Any required syntax needs a separate proposal; classification emission and typed
request/result binding need separately versioned consumer adoption.

## Authority and ownership

[Reference 2.8](reference/02-types-expressions-state.en.md#28-tick-and-state-snapshot)
owns atomic logical decisions; [4.7](reference/04-sensors-constraints-control.en.md#47-requested-safe-applied-confirmed)
separates requested, safe, applied and confirmed output evidence;
[5.3](reference/05-settings-and-observation.en.md#53-renderer-independent-observation-model)
separates descriptors, snapshots, events and execution results.
The [interaction stream contract](INTERACTION-STREAM-CONTRACT.md) (#74) defines
the proposed command observation lifecycle. The [host ordering contract](HOST-EVENT-ORDERING-CONTRACT.md)
(#115) orders closed ingress batches, commit and subsequent effect results.
The [Driver ABI draft](DRIVER-ABI-V1-DRAFT.md) (#117) describes a possible physical
boundary; it remains a draft, not an implementation or prerequisite here.

Process domain stages, state, timers, cancellation predicates and constraints
remain authored GhostFlow rules evaluated by the same Rust core across ticks.
The host owns ingress, bindings, external dispatch and evidence export, not a
second JSON program that executes those stages. A lifecycle observation reports
declared domain evidence; it cannot drive a separate host state machine that
replaces the authored program. No command/alarm descriptor implementation or
frontend feature is required merely to state this contract.

## Classification and identity

The names below are conceptual categories, not source keywords or record enums.
Every identity includes exact source/module/artifact and binding revisions, run,
and its own occurrence/attempt position. Result records retain the original
identity; display names and primitive values cannot establish a join.

| Kind | Meaning and request identity | Result and observation boundary |
| --- | --- | --- |
| DesiredState | Requested target for a declared logical endpoint at a committed scan/revision; repeated equal targets are continuing intent | Requested/safe snapshots, per-write attempt results and separate feedback; each scan is not a new one-shot command |
| Command | One domain action with explicit request ID and canonical typed-request digest | Ordered received/start/terminal evidence when bound to #74; Driver ACK alone is not domain completion or physical confirmation |
| Process | One identified request spanning authored state/timer decisions across ticks; same request remains the correlation root | Started/progress/current-state observations and terminal domain evidence; progress is not a new request or a new lifecycle state |
| Message | Explicit send request and digest, channel/binding identity and distinct send-attempt identity | Queue/service acceptance, delivery or failure evidence retain their stated scope; acceptance does not prove delivery or reading |
| Render | Read-only projection identified by exact source/schema/run/completed scan or event position and projection revision | Rendered/unavailable/stale presentation outcome; no control authority, command completion, feedback or commit is manufactured |

An explicit binding selects evidence for each kind and any #74 lifecycle mapping.
No universal lifecycle graph is imposed on DesiredState writes or Render results.
Message completion means only the declared scope: a queue-acceptance contract
cannot be presented as a delivered-message contract. Repeated true Bool scans
do not implicitly dispatch Commands, Processes or Messages. No default edge
detector, retry, domain permission or delivery guarantee is inferred.

## Request acceptance, duplicates and bounds

For Command/Process and explicitly identified Message requests, preserve request
ID, typed-request digest, category and exact context before outcomes. The same
ID/digest/context returns retained current status or an explicit duplicate result;
it never starts or sends again. Same-run reconnect or a new collection stream
does not clear deduplication. Changing payload, kind or binding under an existing
identity is a conflicting new admission, rejected without changing the original
request's lifecycle or digest. This conflict is not a successor `rejected` event
for an already started or terminal original request.

Dedup entries, active processes, cancellation requests, result history, payloads
and effect attempts have finite profile budgets. Reserve capacity before start/
dispatch, including result evidence needed for external effects. Exhaustion
rejects new admission with a declared reason; it never silently evicts a live
or terminal dedup identity and permits the same action to start twice. If evidence
is lost after admission, preserve an explicit gap/fault and follow the host's
fail-closed policy rather than inventing a successful chain.

## Process lifecycle and cancellation

When mapped to #74, lifecycle observations use exactly:

```text
received -> rejected
received -> started -> completed | cancelled | failed
```

`received` precedes outcomes. Start and completion require the exact domain
evidence declared by the binding. Failure before start is `rejected`; it does
not fabricate `started`. Rejection/failure require declared reason code and
nonempty detail. `received`, `started` and `completed` forbid reasons;
`cancelled` may have a declared reason. A terminal state has no successor.
Current status is a projection of the last valid record, not another occurrence.

A cancellation request has its own request/digest and target identity. Receiving
it does not prove cancellation, immediate physical OFF or rollback. An internal
pending-cancellation fact can remain alongside `started`; it introduces no new
exported lifecycle enum. Before start, a cancellation honored by domain policy
produces `rejected` with its reason. After start, `cancelled` requires declared
domain cancellation evidence. A denied or ineffective cancellation does not
erase progress or manufacture a terminal state.

Completion, cancellation and failure receipts enter the #115 serialization
point. Only valid evidence for the exact request/context can qualify. In complete
history, the first valid terminal transition in that order wins; subsequent
terminal claims cannot rewrite it. Source/domain rules decide what evidence
qualifies and whether cancellation is honored. This ordering rule does not
invent a universal cancellation priority over completion or failure.
Competing stop/completion signals within one input snapshot require authored
rules or explicit binding arbitration. Receipt order does not select their
domain outcome; it applies after evidence qualifies. Missing bindings reject
admission rather than guessing an outcome.
With a history gap, preserve observed status as incomplete; never fabricate
missing start/terminal events or reject a chain based on assumed completeness.

## Effect failure and restart

Dispatch follows successful logical commit. External failure preserves that
commit and its requested/safe intent, plus each partial/uncertain effect outcome.
Its correlated result can affect only a future permitted decision through an
explicit typed binding. Host/Device halt policy remains authoritative; there is
no automatic continuation, retry or restart. Driver register/write acceptance
and sensor confirmation remain separate evidence. Cancellation completion does
not claim physical shutdown unless the declared evidence actually establishes it.

An actual restart uses a new run identity. Old terminal records remain terminal
history; an interrupted started process remains incomplete/unknown unless actual
terminal evidence exists. Restart alone is not evidence of `failed` or
`cancelled`. No effect, Message send or Process resurrects automatically from
old current status. Explicit follow-up requires a new full request identity and
the new run's admission rules. Late old-run/source/binding feedback is stale for
current execution; it may be retained with its original identity as history.
It must not fabricate a current commit, progress or terminal outcome.

## Conformance evidence and adoption

`tests/effect-process-contract.test.mjs` is a fictional bounded reference model,
not a producer, scheduler or substitute for Rust Process execution. Its identity,
evidence and internal cancellation objects are test notation, not approved
serialization. Explicit fixture evidence stands in for authored domain outcomes.

| Cases | Required oracle |
| --- | --- |
| Kind boundaries | Repeated DesiredState stays intent; Command/Process/Message require explicit requests; Message acceptance and Render success prove neither delivery nor physical action |
| Duplicate/conflict/bounds | One start/send per exact identity; conflict preserves original; capacity rejects admission without dedup eviction |
| Cancel before/after start | Before-start rejection has reason; after-start pending does not become terminal without domain evidence |
| Terminal races and failure | Serialized valid completion/cancel/failure produces one immutable terminal; invalid evidence and invalid reasons cannot manufacture transitions |
| Restart and stale evidence | No resurrection or invented terminal; explicit new identity required; old context cannot mutate new run |

Adoption must specify typed bindings, evidence scope, serialized receipt order,
bounded retention and each host's failure/restart policy, then exercise these
oracles through actual producers. These tests establish contract behavior only;
they do not establish deployment, delivery, Driver or physical conformance.
