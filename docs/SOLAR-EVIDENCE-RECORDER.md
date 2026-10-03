# Accepted Solar scan evidence

`SolarEvidenceRuntime` in `runtimes/wasm/solar-evidence-runtime.mjs` is a bounded
reference host recorder for REF-03-028. It instantiates the existing shared
Solar/config framed Rust WASM runtime and validates canonical source, bytecode,
manifest and trace metadata before creating that owner. It neither changes
admission semantics nor operates hardware.

The caller supplies a compiled canonical artifact, WASM bytes, context activation
and an explicit `runId`. Source-document SHA256 is the definition revision;
artifact SHA256 identifies the executable bytes. The recorder does not issue
installation, source or run identities. The supported profile is the existing
GFB16 shared Solar pulse/config profile, with caller-supplied finite provider
facts and explicit clock evidence. No astronomical authenticity is asserted.

Each accepted `step(frame)` retains the full committed outcome and actual context
checkpoint, source and artifact hashes, run/scan/logical-time identity and clock
revision. Original core trace rows retain their decisions. A real accepted
`Due` receipt establishes admission for its public occurrence identity; a later
provider row with that identity additionally records `AlreadyAdmitted`, the
source day, current planned instant, provider/context revisions, availability
and coverage, and a copy of the original admission receipt. Original admission
metadata and revised prediction metadata are separate. A boot-missed terminal
key is never presented as admission.

`booleanProjection` describes the schedule's current accepted scan. A retained
old occurrence has `occurrenceDue: false` even if a different new occurrence
makes that scan's schedule Bool true. The raw `coreDecision` remains visible:
the current portable terminal-key checkpoint alone does not distinguish an
admitted occurrence from a missed one. The host recorder supplies that
classification from actual accepted receipts, rather than relabeling the core.

Rejected frames append no evidence and retain the actual context checkpoint.
`observe()` returns independent copies. The owner permits at most 256 receipts
and a 1 MiB JSON frame budget. Dispose it after use. There is no physical sink,
durable writer or context-checkpoint restore API. Fresh activation can reproduce
the evidence by replaying recorded frames; restoring a checkpoint alone does not
restore this host's admission history. Durable storage and crash recovery remain
external host responsibilities.

The focused tests compare complete native Rust and WASM outcomes/checkpoints,
execute genuine admission and due-false reobservation, retain revised facts under
the same occurrence identity, replay a fresh activation, check simultaneous old
and new occurrence records, reject forged source metadata before activation,
and distinguish missing/invalid/stale evidence from admitted history. These
are software reference-host results, not Device or physical actuation proof.
