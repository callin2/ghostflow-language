# Bounded live timeline and ghost rewind

`createGhostTimeline` in `runtimes/node/ghost-timeline.mjs` implements the
noninterference boundary of Reference §6.8 and REF-06-018. It is a desktop
reference host, with actual Rust decision, occurrence and accounting owners.
It does not operate hardware or establish Driver receipt authenticity.

The selected profile is a standalone canonical `.ghost.md` GFB10 control with
Periodic schedules, optional existing settings, and an applied/durable
`on_time` account in the same source. Sensors, external contexts, controllers,
objectives and after-event adapters are excluded. Accounting budget constraints
and event-count bindings reject before owners or storage are created: this
profile observes applied usage without connecting accounting to decision
enforcement. It does not extend the
plain-control profile of `prepareWhatIfReplay`. Range and other schedule
profiles, source replacement, installation authority, publishing identities,
physical restart and environmental prediction remain separate work.

The caller supplies compiled-source filename, WASM bytes, explicit timeline,
instance, run, source-revision and binding-revision identities, context
activation, the account name, stable resource ID, bounded accounting config,
an actual `FileLedger`, a named Bool output and a synchronous live sink.
Compilation happens inside the factory. Both decision and accounting owners
must match the same source and artifact hashes. The caller's output-to-resource
mapping is an explicit reference binding, not an installation identity issuer.

Missing storage rejects unless `initializeEmpty: true` explicitly authorizes
empty ledger initialization. Existing file bytes restore the actual accounting
owner. They do not restore the decision timeline, active timers or run identity.
FileLedger's documented desktop durability and single-writer limits still apply.

`append(frame)` accepts complete `nowMs`, `inputs` and `contextFacts`. It executes
the live framed core, records its full outcome/context checkpoint, then sends
the selected safe Bool intent through the connected live sink. Sink failure
retains the accepted decision record and prevents further live dispatch through
that owner; it does not undo the tick or create applied evidence. The sink must
be synchronous. Physical application and confirmation are separate observations.

`recordApplied(segment)` accepts explicitly caller-validated Driver intervals
through the source-bound AccountingRuntime and persists/acknowledges its real
snapshot. Requests, safe intent and UI time never manufacture these intervals.
`persistPending()` retries pending persistence; unacknowledged reads retain
the accounting owner's Unknown behavior. `usedRolling(nowMs, windowMs)` queries
the bound resource. `observe()` returns copied timeline receipts, current context
checkpoint, actual in-memory accounting bytes/revision, last acknowledged bytes
and persistence receipts. AccountingRuntime's new `snapshot()` captures bytes
and revision without persisting or acknowledging them.

`branch({branchId, runId, at})` captures an accepted prefix of the real timeline.
Both branch identities must differ from the origin. A separate framed core
reexecutes that immutable prefix and verifies every baseline receipt. The branch
receives neither the live sink nor the storage, accounting or live runtime handle.
Its `step(frame, {provenance})` requires complete explicit frames. `recorded`
must match the captured actual future at that offset; differing or new frames
must be labelled `synthetic`. No missing input is predicted or defaulted.

`rewind()` recreates only the branch core and verifies its original prefix,
then clears branch future frames. Full-prefix reconstruction preserves timer and
conditioning semantics instead of pretending that a durable context checkpoint
contains active timers. Failed step or rewind leaves the previously committed
branch unchanged. Returned copies and later caller mutation cannot alter records.
Owners reject concurrent operations and must be disposed after use. Each timeline
or branch has at most 256 frames and a 1 MiB canonical input-record budget.

`tests/ghost-timeline-noninterference.test.mjs` first proves actual live sink
dispatch, a real Periodic occurrence and acknowledged applied usage. Ghost
execution changes intent, while execution and repeated rewind preserve the
original full timeline, context checkpoint/occurrence identity, actual accounting
snapshot/revision, persistence receipts, file bytes and sink history. Original
live execution then continues with no duplicate admission and a new next occurrence.
Native `context-settings-periodic-v1` tape receipts match framed WASM in full;
the separate profile preserves existing settings tape restrictions. These are
software reference-host and portable-core results, not physical actuation proof.
