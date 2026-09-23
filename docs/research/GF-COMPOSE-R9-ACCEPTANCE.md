# GF-COMPOSE R9: acceptance and implementation handoff

Parent: [#99](https://github.com/callin2/ghostflow-language/issues/99)
Issue: [#108](https://github.com/callin2/ghostflow-language/issues/108)
Status: bounded research/design. No composition execution, device commissioning,
or participant study is claimed.
Research completion does not authorize implementation. The recommendations and
milestone handoffs require architecture-owner review before dependent work begins.

## User problem

The first composition slice must reduce the decisions needed to apply a prepared
behavior, explain a blocked or failed result, and connect that explanation to
engineer evidence. The farmer journey is apply, add, and investigate. The
engineer journey is the same incident viewed through exact source, instance,
binding, run, and available device evidence. These are acceptance specifications,
not measured outcomes.

## Evidence at examined revision

The examined language revision is `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
R1–R8 were read as the dependency set. Current evidence includes one canonical
`.ghost.md` compiler input, explicit host test registration in
[`tools/verify-language.mjs`](../../tools/verify-language.mjs), the native/WASM
scan-tape contract in [`SCAN-TAPE-PARITY.md`](../SCAN-TAPE-PARITY.md), and
independent host, hardware, and physical evidence rules in
[`integration-v1`](../../contracts/integration-v1/README.md). Existing checks
are host/conformance evidence only. No test or user-study result below is
presented as executed.

R1 supplies the effort and explanation measures. R2 separates canonical source,
definition revision, instance, logical port, physical binding, settings, and
run/scan identities. R3 prefers static composition for review but leaves the
lowering/ABI decision open and requires ordering-independent snapshots while
preserving established old/next-state semantics. The semantic rule is fixed;
the mechanism by which a composition lowering preserves it remains open. R4 keeps
existing bindings and distinguishes physical DI from explicit software inputs.
R5 bounds the first profile to type, dependency, parameter, and exclusive-owner
checks. R6 separates import parameters, operator settings, dependency changes,
and binding changes. R7 recommends a pinned source closure, while its package
verification choice remains open. R8 requires one incident context and keeps
requested, safe, application, and physical stages separate.

## Tables and examples

### Acceptance matrix

Expected results and measures are proposed specifications, not executed results
or approved implementation scope. Prerequisites identify research inputs; the
decision gates below apply to dependent implementation slices. “Hand-worked”
means reasoning from the reviewed contracts, not execution evidence.

| Scenario | Input assumptions | Expected result/rejection | Evidence chain | Effort / explainability / traceability measure | Verification layer | Responsible owner | Prerequisite |
|---|---|---|---|---|---|---|---|
| Wired irrigation + four-fan ventilation | Irrigation inputs are wired DI; seven compatible ROs exist | Accept capacity proposal; preserve irrigation binding; add four distinct fan bindings | logical roles → profile/binding revisions → proposal | setup steps; unchanged binding is explainable; roles/endpoints traceable | host fixture, then API/Device/physical separately | language/API; Device confirms applied mapping | R2, R4, R5 |
| Software manual-start composition | Manual start is explicit software input; low-water is wired DI | Accept with DI count 1; do not count software input as physical DI | input kind → capability/profile identity | fewer false configuration decisions; input kind visible; binding revision linked | host + integration contract | language/API; Device owns adapter | R4, R5 |
| Duplicate irrigation instances | Same pinned definition; distinct instance IDs | Accept only with isolated state, timers, settings, bindings, and provenance | definition revision → instance → run/scan | no duplicate setup ambiguity; each result names instance; no merged traces | host composition conformance | compiler/runtime + API | R2, R3 |
| Declaration reordering | Same instance IDs and same input/time tape | Same outputs, bindings, and trace identities | instance IDs + ordered frame → outcomes | no reorder correction; explanation stable; replay deterministic | native/WASM parity extension | compiler/runtime | R3, R4 |
| Competing direct output writers | Two definitions target one output channel | Compile rejects and no artifact is deployable. Explicit station requests arbitrated by the existing single-writer manager remain valid. | output channel → definitions → diagnostic | reject before deployment; identify both definitions | compiler conformance proposal | compiler/runtime | Existing output uniqueness and station contract |
| Exclusive pump ownership | Two logical owners target one exclusive endpoint | Reject before activation; name both instance/port claims and reason | claims → endpoint/binding revision → diagnostic | early correction; farmer sees one blocker; conflict is auditable | host contract validation | language/compiler + API/Device | R4, R5 |
| Invalid or unknown requirement | Wrong type, missing dependency, or unknown suitability | Reject concrete mismatch; otherwise report unknown, never compatible/pass | manifest/dependency/profile evidence → result | fewer late corrections; unsupported fact is explicit; source of uncertainty named | host + integration contract | compiler/API; profile/Device for suitability | R2, R4, R5 |
| Low-water explanation | `low_water=true`; pump requested ON | Safe output OFF; farmer sees signal and next action, not “tank empty” | input → source/constraint → requested/safe output → run | paraphrase correctness; engineer reaches input/constraint; exact run join | host trace; usability later | language/runtime + #88/#74 | R1, R3, R8 |
| Application/feedback failure | Command issued; application failure or no feedback | Show failed application or explicit unknown; do not claim physical success | requested/safe → host/driver → available observation | diagnostic navigation; stage distinction; missing evidence visible | host record; Device/physical separate | #74/#88 + Device | R8 |
| Crash, restart, or journal gap | Runtime restarts or history has missing interval | New `runId`; preserve last evidence and gap; no fabricated scan/result | module/instance/binding → run/scan → boot/event evidence | fewer reconstruction steps; restart boundary clear; gap traceable | host semantics + Device history | runtime/API + Device #28 | R2, R3, R8 |
| Override identity | Change import parameter, operator setting, dependency, or binding | Apply R6 matrix; reject stale joins; preserve distinct revisions | source/artifact/settings/binding/package/run identities | correction effort; reason for changed identity explainable; lineage complete | host/package/integration gates | API/deployment + compiler/Device | R6 |
| Live property event during active operation | One valid action changes multiple declared runtime-adjustable properties | Validate as one event; apply all values when processed, so existing logic may change output during the active operation without waiting for another cycle. Source revision/hash, program bytes/hash, and run identity remain unchanged. Advance settings revision and effective event position. | event → validated complete property set → settings revision/effective position → same source/program/run → resulting logic/output | prove active-operation effect and explain which settings revision governed the occurrence | proposed native/WASM conformance; not run | runtime/API contract | User-agreed amendment; R6/#89 mechanism and ABI |
| Invalid multi-property event | One action contains several valid values and one invalid type/range/step value | Reject the entire event. No property mutates; prior settings revision/effective position and active behavior remain unchanged. | rejected event + validation reason; old settings remain joined to same program/run | prove all-or-none rejection and identify invalid member | proposed native/WASM conformance; not run | runtime/API contract | User-agreed amendment; R6/#89 validation record |
| Live-property identity and evidence join | Accept valid event while a run is active | Subsequent affected execution evidence joins the new settings revision/effective event position and same program/run. Do not reinterpret stale records or imply source/bytecode change. | source/program hashes + `runId` unchanged; settings revision/effective position advances and joins later outcomes | replay/explanation identifies exactly which settings applied at each event position | proposed native/WASM/adapter conformance; not run | runtime/API contract | R6; settings join mechanism open |
| Real restart after accepted settings | Accepted properties persisted; physical ESP restart occurs; GhostFlow restart event is delivered | Properties persist. Restart starts a new `runId`. Restart response is determined by authored GhostFlow logic; do not impose global resume/manual behavior. Keep pre-runtime electrical startup/failure obligations with Device/Driver. | prior settings revision → persisted settings after restart; old run → new run; restart event → authored transition/output | show persistence, run boundary, and actual authored restart response without claiming physical actuation | proposed host conformance; Device separately; not run | runtime/API; Device/Driver startup boundary | User-agreed amendment; persistence/recovery ordering remains open |
| Input occurrence and value delivery | Multiple occurrences and changing value observations arrive between evaluations | Preserve each occurrence and observation by default within supported capacity. Latest-pending-value replacement is permitted only by explicit per-input opt-in. Reject/report overflow or loss; never report silent success. No unbounded durable history is implied. | input identity + capture time + receipt/evaluation time + quality + delivery/loss outcome | show occurrence preservation, opt-in coalescing, and visible overflow/loss | proposed native/WASM conformance; ordering/mapping/bounds remain open; not run | runtime/Driver contract | User-agreed input-delivery amendment |
| Imported-definition upgrade | Exact pinned import changes revision | Explicitly select affected instances; revalidate closure and joins; no floating update | import edge → closure/artifact → instance/deployment | upgrade scope visible; provenance retained; old deployment remains explainable | package/replay validation | language/API/package owners | R2, R6, R7 |
| Native/WASM parity | Same pinned artifact, settings, initial state, input tape, logical time | Equal accepted outcomes and supported trace identities; invalid frames agree semantically | artifact/module → frame → complete outcome | one replay path; identical explanation evidence; hashes and identities recorded | explicit scan-tape host gate | language/runtime | R3 and existing parity contract |

The DI 2 / RO 7 case is one capacity result under the wired-input assumption.
It does not prove physical commissioning or that a farmer can apply the behavior.
The low-water negative case belongs in the same first milestone.

### Three proposed milestone handoffs

The following order and minimum scope are proposals subject to architecture-owner
review. Each dependent slice requires the relevant decisions listed below.

1. **Apply a prepared behavior.** Minimum language change: expose the bounded
   contract descriptors needed for typed requirements, explicit input kind,
   exclusive ownership, stable logical-port identity, and a traceable accepted
   or rejected result. Consumer handoff: API presents a proposal and confirmed
   installation/binding revision; Device supplies profile/applied evidence;
   frontend presents the farmer blocker and the low-water negative explanation.
   Physical acceptance remains separate.

2. **Add another behavior while preserving existing behavior/bindings.** Minimum
   language change: instance-qualified composition with isolated state/timers,
   deterministic input snapshots, stable identity ordering, and the first-profile
   rejection of shared exclusive outputs. Consumer handoff: API records instance
   and binding joins; Device confirms unchanged and new mappings; host replay
   checks the wired/software resource cases. The proposed composition slice
   rejects competing direct writers. It does not implement a runtime-settings
   overlay as part of M2; this scope limit does not reject the separately
   approved live-property event behavior or require those events to stop the
   controller or start a new run. If a slice uses live property events, retain
   the unchanged source/program hashes and run identity, settings/effective-
   position joins, active-operation consequence, atomic rejection, and restart
   persistence behavior specified in the acceptance matrix.

3. **Investigate an unexpected result from farmer explanation to engineer
   evidence.** Minimum language change: join instance-qualified source/constraint
   trace to the existing run/scan context while retaining requested versus safe
   output. Consumer handoff: #88/#74 define wording/application-result events;
   API joins settings and binding revisions; Device #28 defines boot/history and
   gap evidence. A missing physical observation stays unknown.

## Recommendation

Propose the three handoffs above for architecture-owner review. The preferred
research direction is static composition with a pinned source bundle, explicit
instance IDs, stable authored ports, preserved bindings, and exclusive-owner
rejection. The execution and package alternatives remain undecided until their
owners resolve the gates below. Proposed results carry R8's identity chain.
Host, API, Device, physical, and usability acceptance remain separate. Capacity,
matching replay, and a valid integration record establish only their stated scope.
Accepting this research document approves neither an architecture nor implementation.

## Unresolved questions and owners

These are implementation blockers for the specified slices, not universal
dependencies on completion of entire external issues. M1–M3 refer to the proposed
handoffs above. The cited R1–R8 findings are the evidence for these open decisions.

| Decision and research input | Required owner decision before dependent work | Dependent slice |
|---|---|---|
| Compiler/runtime and diagnostic contract (R2, R3, R5) | Compiler/runtime owners define descriptor/diagnostic identity for M1; choose static lowering versus coordinated VMs, input/time, GFB1/ABI compatibility, fault fan-out, and the mechanism that preserves established old/next-state semantics in composed execution. The within-control old/next snapshot and cycle rejection rules are fixed. Only import/cross-instance reference encoding and its validation remain open if such references are selected. | M1 descriptor changes require the descriptor decision. M2 execution/replay requires the composed-execution decisions; these also apply to M1 if it instantiates composed code |
| Package/import contract (R2, R6, R7) | Language/API/package owners choose source bundle versus envelope, closure/lock schema, ordering, multi-source map identity, replay and signature verification rules | Any M1 reusable-import package extension; M2 imported composition/upgrade. Existing single-source package use does not require a new package format |
| Installation-constraint authority (R2, R4, R5) | System #62 with language/API owners select canonical constraint representation, enforcement boundary, and compatibility evidence | Any M1/M2 slice claiming installation-constraint compatibility/enforcement; M3 explanation of such a constraint. Absent a decision, suitability stays unknown; no successful deployment claim |
| Instance and deployment identity (R2, R6, R8) | API/deployment and language contract owners define instance lifecycle, binding/settings joins, upgrade continuity, and stale-join rejection. A live property event preserves source/program hashes and run identity while advancing settings revision/effective event position; later outcomes join the effective settings. Restart persists accepted settings and creates a new run. | M1 binding/result joins; M2 instance creation and upgrade; M3 exact incident context. #89 mechanism/ABI/spec-alignment work gates only slices that use live settings; unrelated slices do not depend on it. |
| Binding evidence (R4, R8) | API/Device/profile owners define proposal/confirmation records, stable endpoint ordering, and observed applied-binding identity; physical owner defines commissioning evidence | M1 installation application; M2 allocation/preservation; M3 equipment-target claims. Host capacity checks remain separately scoped |
| Incident evidence contract (R1, R3, R8) | Language/runtime and #74/#88 owners define instance-qualified trace joins, farmer explanation, application-result fields, and absence semantics; Device #28 owner defines boot/event-to-run/binding joins, available feedback, and gap representation | M1 low-water/blocker projection; M3 corresponding logical, application, or restart/history slice. Device journal fields are needed only for the device-history slice |

#95 is a dependency only if arbitration beyond the existing station manager is
selected. The first profile rejects competing direct writers while preserving
explicit station-request arbitration through the existing single-writer manager.
#89/#90 own live-property mechanism/ABI/verification and reconciliation of older
stopped-Configure text; the user decision for live properties is settled. #89
gates only slices that use live settings, not unrelated R1–R8 implementation
work. Import-time specialization remains distinct. Memory and
retention stay with their existing API/system and Device owners; this handoff adds
no storage or retention work. Missing evidence remains explicit.

## Verification

- [x] Acceptance criterion 1: all summary scenarios retain assumptions,
  expected result, evidence, measure, layer, owner, and prerequisite. The matrix
  remains proposed specifications; no execution or participant result is claimed.
- [x] Acceptance criterion 2: three proposed handoffs describe complete user
  journeys and minimum scope. Each dependent slice has named owner decisions;
  #89, #95, and Device history dependencies apply only when their capabilities are used.
- [x] Acceptance criterion 3: authority, identity, scan, binding, package, and
  evidence-contract decisions remain explicit blockers. Host, API, Device,
  physical, and usability acceptance remain separate. Future executable tests
  require explicit registration in `tools/verify-language.mjs`; existing checks
  must not be weakened. Research completion grants no implementation authority.
- [x] Examined revision is recorded; targeted `VERIFICATION.md`, parity,
  integration, and explicit-test-registration sections were inspected.
- [ ] Coordinator verification pending: reread corrected R1–R8 and this matrix,
  verify relative links, and accept the corrected research publication. Local
  `git diff --check` passed; no runtime tests or physical checks were run.
