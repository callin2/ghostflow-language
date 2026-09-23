# Behavior composition: research and architecture review

Date: 2026-09-20. Parent: [GF-COMPOSE #99](https://github.com/callin2/ghostflow-language/issues/99).
Inspected language revision: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
Status: research summary and proposed design direction. Composition is not implemented
by this document. The child issues produce bounded design evidence before implementation.

## Correction record (2026-09-20)

This record separates established language rules, an agreed design amendment,
and unresolved implementation choices. It is design evidence only. It does not
change normative language documents or claim implementation or verification.

- **Existing execution invariants:** `x` reads old state and `x'` defines a
  candidate next value. Every transition uses the same input/old-state snapshot.
  A next-state reference is allowed only in output expressions, not in another
  transition or a `let`. State and logical output results commit together.
  Combinational cycles and duplicate output definitions are invalid. Preserve
  these rules in any composition. They are not open questions. Each output
  channel has one authoritative direct definition; competing direct writers
  must fail compilation and must never be deployed. This does not remove the
  existing station single-writer resource manager: station requests are not
  competing direct writes. Physical endpoint alias checks remain a separate
  binding validation.
- **Existing Driver boundary:** GhostFlow defines typed Sources and Intents.
  Driver backing may be software, specialized hardware, or both. Precision
  measurement/protocol/raw-ISR versus scan handling belongs at that boundary;
  meaningful typed events or measurements enter core logic without farm policy
  hidden in the Driver. Capture time, receipt/evaluation time, and quality are
  distinct. A command acknowledgement is not proof of physical operation.
- **Agreed design amendment, not current implementation:** runtime-adjustable
  property changes are live events. One action changing several properties is
  one atomic event. Validate the complete event; if any value is invalid, reject
  all of it without mutation. On acceptance, active logic uses the new values
  when the event is processed, including during active operation; application
  is not deferred to another watering cycle, a new run, or stopped mode. Do not
  rewrite source, recompile, update firmware/bytecode, or stop/restart the whole
  controller for this event. Preserve program and run identity; advance settings
  revision/effective event position. Existing rules may consequently change an
  output. No implicit reset or automatic reinterpretation of stale program joins.
  Settings persist across a real ESP restart; that physical restart still starts
  a new run identity.
- **Current-spec conflict:** [`CONSTRAINTS.md`](CONSTRAINTS.md), lines 179–204;
  [`LANGUAGE-SURFACE.md`](LANGUAGE-SURFACE.md), lines 66–69; and
  [`LANGUAGE.md`](LANGUAGE.md), lines 460–461 currently require stopped
  Configure changes;
  #89 also contains the prior stopped/new-run proposal. Treat those as older
  documented behavior to reconcile with the agreed live-property amendment.
  Do not silently claim the amendment is already normative or implemented.
  The current source-edit helper is supported behavior: it edits source and
  recompiles. It is not implementation of the agreed live-property path. #89/#90
  remain workstream owners. Pending
  work concerns mechanism, ABI, verification, and spec alignment, not whether
  the user wants live settings.
- **Restart and inputs:** restart is a normal event whose reaction is authored
  by GhostFlow logic. Do not impose global resume/manual policy. Device/Driver
  retains pre-runtime electrical startup, disconnect, and failure obligations.
  Input delivery must preserve occurrences and value observations by default
  within supported capacity, independent of interrupt/scan capture. Latest
  pending-value replacement is allowed only by explicit per-input opt-in;
  overflow/loss must be rejected or reported, not silently accepted. This is
  not unlimited persistent event history or a new incident store. Ordering,
  event-to-tick mapping, source batching, bounds, and recovery mechanics remain
  open. No hard deadline or priority scheduler has been specified.
- **Operational boundary:** behaviors operate independently in normal use.
  An executable program or ESP firmware update uses a controller-wide
  maintenance stop for that ESP; property events do not. Shared electrical
  dependencies belong to installation context. This is not evidence that Device
  implements or verifies the boundary.

Static composition remains a preferred hypothesis, not a selected lowering or
ABI. Native/WASM conformance checks below are proposed, not newly run. No second
canonical JSON program, automatic solver, or storage framework is introduced.

## Product objective

Reduce effort. Increase explainability. Increase traceability.

A farmer should be able to apply a prepared behavior, add another behavior, and
understand an unexpected result with few technical decisions. Software and hardware
engineers should be able to investigate the same result without reconstructing its
history from unrelated logs. A feature must name the user problem and demonstrate
which effort it removes or which explanation/evidence becomes available.

| Participant | Question | Required outcome |
| --- | --- | --- |
| Farmer | Can I apply this behavior here? | Understandable requirements, blockers, and necessary farm-specific decisions. |
| Farmer | Why did watering not start? | A supported reason, its operational effect, and a useful next action. |
| Software engineer / behavior author | Which logic produced the result? | Exact definition/instance, source revision, settings, inputs, state, and constraint decision. |
| Hardware engineer / installer | What reached the equipment? | Exact installation binding, application result, and available physical observations. |

Measure setup steps, technical decisions, corrections, assistance requests, and
diagnostic effort. Measure whether users can explain a blocked action and whether
engineers can reach its supporting evidence. Baselines and numeric improvement
targets need a recorded walkthrough and subsequent participant validation; neither
has been measured in this research. A heuristic walkthrough is not a user study.

## Completed delegated research

The nine bounded research outputs are complete and independently reviewed by a
Luna reviewer. Every author used `gpt-5.6-luna` at low effort. This is research
evidence and a proposed design direction, not implemented composition or measured
user, Device, or physical acceptance.

- [R1 user outcomes](research/GF-COMPOSE-R1-USER-OUTCOMES.md)
- [R2 authority and identity](research/GF-COMPOSE-R2-AUTHORITY-IDENTITY.md)
- [R3 execution](research/GF-COMPOSE-R3-EXECUTION.md)
- [R4 ports and bindings](research/GF-COMPOSE-R4-PORTS-BINDINGS.md)
- [R5 contracts](research/GF-COMPOSE-R5-CONTRACTS.md)
- [R6 overrides](research/GF-COMPOSE-R6-OVERRIDES.md)
- [R7 packages](research/GF-COMPOSE-R7-PACKAGES.md)
- [R8 incident evidence](research/GF-COMPOSE-R8-INCIDENT-EVIDENCE.md)
- [R9 acceptance and handoff](research/GF-COMPOSE-R9-ACCEPTANCE.md)

R9 leaves architecture decisions open for compiler/runtime execution and ABI,
package/import closure and verification, installation-constraint authority,
instance and deployment identity, binding/applied-evidence contracts, and
incident/application/Device history evidence. These block their dependent slices.
Issue-result publication is handled by the coordinator; this record does not
claim GitHub issue closure.

## Research findings

The source and issue audit supports the following facts. Open issue descriptions
are requirements or proposals, not evidence that their features are implemented.

| Evidence | Current fact | Consequence for composition |
| --- | --- | --- |
| [Compiler entry](../tools/compile-source.mjs) | `compileSource` takes one canonical literate document and preserves its source identity. | Multiple imported sources need an explicit provenance design. |
| [Core tick](../crates/ghostflow-core/src/lib.rs), `Runtime::tick` | Transitions read prior state; intents use the defined state view; safety resolves requested outputs. | Preserve the established simultaneous snapshot/commit rules when composing instances; within-control cycle rejection is fixed. Only cross-instance/import reference encoding and validation are potential open decisions. |
| [Station core](../crates/ghostflow-core/src/station.rs), [constraint contract](CONSTRAINTS.md) | A bounded pump-station arbiter and a separate canonical constraint compilation path already exist. | Audit reuse; general behavior composition and arbitrary arbitration are not established by those mechanisms. |
| [Intent anchors](INTENT-ANCHOR-MAP.md) | Generated provenance is not an editable second program. Inferred assumptions are distinct from confirmed intent/premises. | Views and extracted claims cannot silently change execution. |
| [Integration contract](../contracts/integration-v1/README.md) | Bindings match typed logical names to endpoints. Endpoint aliasing is rejected in v1. Software inputs need not consume physical DI. | Shared outputs and resource accounting need explicit compatibility decisions. |
| [Portable package](PORTABLE-PACKAGE.md) | One source revision, GFB bytes, manifest, map, runtime identity, and binding revision are signed together. | A reusable behavior and an installed deployment have different binding lifecycles. |
| [Interaction contract](../contracts/interaction-v0/README.md) | Static descriptors and completed observations join through exact schema/source/module/run identities. | Extend the existing identity chain for composed instances. |
| [Settings #89](https://github.com/callin2/ghostflow-language/issues/89) | Older stopped/new-run proposal conflicts with the agreed live runtime-property amendment; source-edit/recompile helper is supported current behavior, but not the live path. | Reconcile normative text and define mechanism/ABI/verification. Import specialization remains distinct. |
| [Explanation #88](https://github.com/callin2/ghostflow-language/issues/88), [events #74](https://github.com/callin2/ghostflow-language/issues/74) | Explanation and event/command semantics already have owners. | Research composition-specific joins and gaps instead of duplicate systems. |
| [Installation #62](https://github.com/callin2/farm_studio_system/issues/62) | Proposes independently enforced, non-weakenable installation constraints. | Resolve representation and enforcement against this repository's canonical-source boundary. |

External precedents inform recommendations rather than define GhostFlow semantics:

- [Observable imports](https://old.observablehq.com/documentation/notebooks/imports)
  demonstrate version locking and dependency replacement. Imported evaluation can
  be lazy. GhostFlow execution must not depend on whether a display observes a value.
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) separates entities, activities, and
  responsible agents. This is a useful vocabulary check for source/artifact/event
  provenance, not a requirement to adopt RDF, a graph database, or the full ontology.

## Architecture recommendations

### A1. Explicit authority with linked identities

Canonical `.ghost.md` source and pinned imported sources own executable behavior.
API-owned records identify revisions, installation context, and deployment.
Device-owned profiles, drivers, and observations supply physical information.
The portable Rust core owns execution. Frontends consume semantic descriptors and
recorded results. A conversational or visual edit becomes a source-change candidate
when it changes executable rules.

System installation issue #62 introduces a real unresolved boundary: executable
installation constraints cannot become a second informal JSON program. Research
whether the installation contract can reference separately compiled canonical
constraint source, using the existing constraint path, or whether an explicit
cross-project boundary revision is required. Do not assume either is accepted.

### A2. Typed relationships and specific graph projections

Keep a shared semantic vocabulary and identity links. Do not require every farm,
source, and history relationship to fit one universal DAG. Identify the edge kinds
and cycle rules separately for imports, within-scan dependencies, explanation
graphs, equipment relations, and observations across time.

Definition identity, immutable definition revision, instance identity, logical port,
physical equipment, and runtime occurrence are different concepts. Display names
and document locations must not substitute for those identities.

### A3. Investigate static composition first

Compare compiler composition into one executable program with multiple coordinated
VMs. Static composition is the preferred hypothesis because it can reuse the
current execution core. It is not yet a proven lowering or ABI decision.

The comparison must show input sampling and logical time while preserving the
fixed old/next-state contract: all transitions read the same old-state/input
snapshot, next-state references occur only in output expressions, and logical
state/output commit is simultaneous. These semantics are not a composition
decision. The comparison must also show timer isolation, initialization/reset,
fault scope, and output resolution. Two
instances of one definition must have isolated state. Reordering declarations for
the same instance identities must not change behavior. Feedback across scans needs
explicit semantics; an instantaneous dependency cycle is not implicitly solved.

Retain existing resource limits in the analysis. DI/RO capacity alone says nothing
about whole-program state, bytecode, expression cost, memory, or target timing.

### A4. Preserve existing installation bindings

A proposal for unused channels must retain explicit existing bindings. Deterministic
allocation alone does not ensure that adding a behavior preserves old wiring.
Keep proposal, user-confirmed mapping, and observed installation distinct.

Count physical inputs only when the chosen input actually requires a physical DI.
The umbrella's DI 2 / RO 7 result assumes two wired digital inputs. A software
manual-start command is a separate resource case. Represent missing suitability
evidence as unknown, not compatible.

### A5. Bound the first contract profile

Start with explicit port compatibility, dependency presence, parameter bounds,
and single authoritative direct output definition per channel. A competing
direct writer is a compile error and cannot be deployed. This does not ban the
existing station manager's explicit resource arbitration of station requests;
the station manager remains the direct writer there. Physical endpoint alias
checks remain separate binding validation. Audit that manager before proposing
new machinery. The composition profile must not redefine existing station behavior.

Distinguish a declared assumption, a tested property, a statically established
property, and a runtime-enforced constraint. Every compatibility or verification
claim needs a scope. Separate outputs can still affect shared water, power, or
other physical resources; electrical channel independence does not prove physical
independence. General temporal/safety proof is outside the first profile.

### A6. Keep override lifecycles separate

Record separately: import-time parameters, runtime operator settings, dependency
selection, and physical bindings. For the agreed live-property path, preserve
program/run identity, advance settings revision/effective event position, and
persist values across ESP restart while assigning the restarted runtime a new
run identity. Reconcile the older stopped/new-run text with #89; use #90 for
parameterized schedules. This amendment is not yet normative or implemented.

### A7. Reuse package verification with an explicit extension decision

Pin exact transitive dependencies before compilation. Compare a source bundle
extension with a composition envelope around existing artifacts. Determine how
the complete source closure, compiler replay, contract descriptors, and maps are
bound to the composed artifact. Do not flatten away imported source provenance.

Preserve existing trust/revocation and consumer compatibility requirements. A
trusted package issuer does not establish deployment authorization or physical
acceptance. Reusable exports exclude site bindings, site secrets, and conversation
records. Signing machinery should not be reimplemented by composition.

### A8. One event, explanations for different participants

A farmer-facing statement and an engineer's detailed view must reference the same
incident and exact execution context. Keep requested output, resolved safe output,
host/driver application, and available physical feedback distinct.

For the low-water example, report that the low-water signal blocked watering.
Do not turn that signal into an unsupported claim that the tank is physically empty.
After a restart, a repeated scan number cannot identify the old event. Missing
feedback, a journal gap, or an unavailable artifact must remain visible.

Reuse #88, #74, the Interaction contract, and
[Device historian #28](https://github.com/callin2/farm-device/issues/28).
The language supplies bounded semantics and provenance; retention, transports,
screens, and physical observation remain with their existing owners.

## Decomposition of the umbrella

| #99 section | Treatment | Research task |
| --- | --- | --- |
| 1, 9, 11: vision and authoring experience | Convert to participant problems and measurable outcomes. | R1 |
| 2: one Semantic DAG | Refine into authority, identity, and explicit graph projections. | R2 |
| 3: reusable behavior | Retain; define instance execution and isolation. | R2, R3 |
| 4: irrigation plus ventilation | Retain as a fixture; add rejection and incident cases. | R4, R9 |
| 5: logical ports and physical IO | Retain; preserve existing bindings and unknown evidence. | R4 |
| 6: parameters, bindings, dependencies | Retain separation and make revision effects explicit. | R6 |
| 7: contracts | Bound the first profile and reuse arbitration ownership. | R5 |
| 8: composition/link pipeline | Separate pure compiler work from installation and deployment. | R2–R7 |
| 10: source/package sketch | Keep syntax illustrative; research provenance and package compatibility. | R7 |
| 12: open questions | Allocate to a named research deliverable. | R1–R8 |
| 13: non-goals | Retain; add no generic graph platform or new diagnostic storage engine. | All |
| 14: proposed deliverables | Reorder around user journeys and architecture dependencies. | R9 |
| Explanation/trace across sections | Make an initial requirement, including negative outcomes. | R8, R9 |

The original bare Device Query reference #27 is incorrect in this repository:
language #27 is DateTime work. The verified relevant source is
[system #74, Track D](https://github.com/callin2/farm_studio_system/issues/74), with
[installation #62](https://github.com/callin2/farm_studio_system/issues/62).

## Research sequence and issue index

P0 means a high-risk product or architecture question to resolve early. P1 means
required design detail for the first bounded composition slice. These are research
priorities, not a declaration that implementation or product validation is complete.

<!-- compose-issue-index:start -->
| Task | Priority | Bounded deliverable | Hard dependencies |
| --- | --- | --- | --- |
| [R1 #100](https://github.com/callin2/ghostflow-language/issues/100) | P0 | Participant journeys and measurement protocol | None |
| [R2 #101](https://github.com/callin2/ghostflow-language/issues/101) | P0 | Authority/identity matrix and graph boundaries | None |
| [R3 #102](https://github.com/callin2/ghostflow-language/issues/102) | P0 | Execution comparison and explicit scan tables | R2 |
| [R4 #103](https://github.com/callin2/ghostflow-language/issues/103) | P1 | Port/resource and stable binding decision tables | R2 |
| [R5 #104](https://github.com/callin2/ghostflow-language/issues/104) | P1 | First contract profile and rejection diagnostics | R3, R4 |
| [R6 #105](https://github.com/callin2/ghostflow-language/issues/105) | P1 | Override lifecycle and revision-change matrix | R2 |
| [R7 #106](https://github.com/callin2/ghostflow-language/issues/106) | P1 | Reusable package/import closure design comparison | R2, R3, R6 |
| [R8 #107](https://github.com/callin2/ghostflow-language/issues/107) | P0 | Farmer-to-engineer incident evidence walkthrough | R1, R2, R3 |
| [R9 #108](https://github.com/callin2/ghostflow-language/issues/108) | P1 | Acceptance matrix and implementation handoff order | R1–R8 |
<!-- compose-issue-index:end -->

Tasks are tracked in GitHub, not a duplicate local checkbox backlog.
[The plan index](../tasks/plan.md) points to this summary and the tracker.
R1 and R2 can start together. After R2, R3/R4/R6 can proceed independently.
After R3, explanation research R8 and package research R7 can proceed when their
other inputs exist. R9 can draft early but cannot finalize before R1–R8.

Related issues are interface references. Their entire completion is not a hard
dependency of these research documents. An implementation that needs an unfinished
capability must later declare that specific dependency. Keep existing parents and
ownership; do not move #89, #95, #88, or other existing work under #99.

## Representative acceptance scenarios

These are proposed test or walkthrough specifications, not executed results.

| Scenario | Expected evidence |
| --- | --- |
| Apply irrigation, then add four-fan ventilation | With two wired inputs: DI 2 / RO 7. Existing irrigation binding unchanged. |
| Use a software manual-start command | Explain why that input does not consume a physical DI; no hardcoded DI total. |
| Instantiate irrigation twice | Distinct instance/state/timer/provenance identities; identical definition revision allowed. |
| Reorder the same named instances | Same semantic outputs and stable bindings under the stated input/time trace. |
| Bind two exclusive owners to one pump | Reject with both instance/port identities and an understandable reason. |
| Define two competing direct writers for one output channel | Compile reject; no deployable artifact. This does not reject explicit station requests arbitrated by the existing single-writer manager. |
| Wrong port type, missing dependency, or unknown suitability | Specific error/unknown result; no successful deployment claim. |
| Low-water blocks watering | Farmer explanation links to exact input, rule, requested/safe output, and run. |
| Driver application fails or feedback is absent | Preserve the distinction between command and observed outcome. |
| Restart, crash, or journal gap | Preserve boot/run boundary and last available evidence; explicitly identify missing evidence. |
| Change parameter, settings, or binding | Apply the revision-change matrix; reject stale evidence joins. |
| Change several live properties in one action during active operation | One event; apply all on acceptance without changing program/run identity or stopping the controller. If any value is invalid, reject the whole event with no mutation. |
| Restart after accepted properties | Property values persist; restart reaction is authored by GhostFlow and starts a new run. Device startup electrical obligations remain separate. |
| Deliver occurrences and observed values under load | Preserve by default within capacity; latest-value replacement only for explicitly opted-in inputs. Overflow/loss is rejected or reported. No unlimited history is implied. |
| Upgrade an imported definition | Explicit pinned revision change and affected-instance/contract/provenance impact. No floating dependency update. |
| Native/WASM replay | Compare identical pinned artifacts, settings, input tape, logical time, outputs, and supported trace identities. |

The existing state rule is fixed in every scenario: each transition reads the
same old-state/input snapshot; `next` references are confined to output
expressions; state and logical output results commit together. It is not a
lowering or ABI question. The particular mechanism by which composition
preserves the rule remains open.

Proposed native/WASM conformance should cover active-operation property effect,
all-or-none rejection of an invalid multi-property event, unchanged source/program
hash and run identity, persistence across restart with a new run identity and
GhostFlow-authored restart reaction, explicit coalescing and overflow cases, and
preservation of existing prime and station single-writer conformance. These checks
are proposed, not executed. Host conformance, API integration, Device execution,
physical commissioning, and farmer/engineer usability are separate evidence classes. A passing host fixture
does not complete the other classes. Future executable tests must be explicitly
registered in `tools/verify-language.mjs` and follow `docs/VERIFICATION.md`.

## Handoff rules for smaller models

Each issue is self-contained: one documentation artifact, exact starting sources,
fixed constraints, numbered steps, examples, expected table columns, dependencies,
and three completion checks. It does not require chat history. The expected scope
is one focused research pass, ordinarily one output file of about 80–160 lines.

Use the inspected revision as the evidence baseline; record any relevant difference
in the actual revision examined. Read targeted definitions rather than whole large
modules. Distinguish current code, an open proposal, and a recommendation.

Do not silently select a new runtime, ABI, source authority, storage engine, or
cross-project owner. Present alternatives and concrete counterexamples in the
specified output. If evidence is missing, write `unresolved`, name the missing
evidence and owner, and finish the supported portion. Architectural acceptance
remains a review checkpoint, not a task delegated to a smaller model by implication.

## Review checkpoints and deferred scope

After R1–R3: review user outcomes, authority, and execution alternatives. After
R4–R8: review binding, contracts, lifecycle, package compatibility, and the evidence
chain together. R9 records resolved decisions and exact unresolved implementation
blockers. Child research completion does not authorize implementation automatically.

Defer arbitrary graph querying, a universal ontology, a marketplace, new UI
renderers, distributed orchestration, general temporal theorem proving, and shared
actuator policies beyond existing #95 work. They require a concrete user problem.
Natural-language extraction and conversational memory remain API/product work;
[system memory #68](https://github.com/callin2/farm_studio_system/issues/68) already
owns their broader provenance lifecycle.
