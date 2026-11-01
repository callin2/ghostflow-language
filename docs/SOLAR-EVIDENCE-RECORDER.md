# Accepted Solar scan evidence

`SolarEvidenceRuntime` in `runtimes/wasm/solar-evidence-runtime.mjs` is a
bounded reference host recorder for REF-03-028. It records evidence about scans
that the runtime accepted.

- It instantiates the existing shared Solar/config framed Rust WASM runtime.
- Before creating that owner, it validates the canonical source, bytecode,
  manifest and trace metadata.
- It does not change admission semantics, and it does not operate hardware.

**Inputs and identities.** The caller supplies:

- a compiled canonical artifact;
- the WASM bytes;
- the context activation;
- an explicit `runId`.

The source-document SHA256 is the definition revision. The artifact SHA256
identifies the executable bytes. The recorder does not issue installation,
source or run identities.

The supported profile is the existing GFB16 shared Solar pulse/config profile.
The caller supplies finite provider facts and explicit clock evidence. The
recorder asserts no astronomical authenticity.

**What each accepted step keeps.** Each accepted `step(frame)` retains:

- the full committed outcome and the actual context checkpoint;
- the source and artifact hashes;
- the run, scan and logical-time identity;
- the clock revision.

Original core trace rows keep their decisions.

**Admission receipts.**

- A real accepted `Due` receipt establishes admission for its public occurrence
  identity.
- A later provider row with the same identity additionally records
  `AlreadyAdmitted`, the source day, the current planned instant, the
  provider/context revisions, availability and coverage, and a copy of the
  original admission receipt.
- Original admission metadata and revised prediction metadata are kept separate.
- A boot-missed terminal key is never presented as admission.

**`booleanProjection`.** This describes the schedule's current accepted scan.

- A retained old occurrence has `occurrenceDue: false`, even if a different, new
  occurrence makes that scan's schedule Bool true.
- The raw `coreDecision` stays visible. The current portable terminal-key
  checkpoint alone cannot tell an admitted occurrence from a missed one. The
  host recorder supplies that classification from actual accepted receipts; it
  does not relabel the core's decision.

**Rejections, limits and lifetime.**

- Rejected frames append no evidence and keep the actual context checkpoint.
- `observe()` returns independent copies.
- The owner permits at most 256 receipts and a 1 MiB JSON frame budget.
- Dispose it after use.
- There is no physical sink, durable writer or context-checkpoint restore API.
- A fresh activation can reproduce the evidence by replaying the recorded
  frames. Restoring a checkpoint alone does **not** restore this host's
  admission history.
- Durable storage and crash recovery remain external host responsibilities.

**Tests.** The focused tests:

- compare complete native Rust and WASM outcomes and checkpoints;
- execute genuine admission and a due-false reobservation;
- retain revised facts under the same occurrence identity;
- replay a fresh activation;
- check simultaneous old and new occurrence records;
- reject forged source metadata before activation;
- distinguish missing, invalid and stale evidence from admitted history.

These are software reference-host results, not proof of Device behavior or
physical actuation.
