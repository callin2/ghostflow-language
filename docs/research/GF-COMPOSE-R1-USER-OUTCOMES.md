# GF-COMPOSE R1: user outcomes and measurement protocol

Parent: [#99](https://github.com/callin2/ghostflow-language/issues/99)
Issue: [#100](https://github.com/callin2/ghostflow-language/issues/100)
Evidence revision examined: `ffdbc96461eca67908252507fb851fa4dabd9a2c`
Status: research/design. No participant sessions or numeric baseline have been completed.

## User problem

Farmers need to apply a prepared behavior with few technical decisions. They
need to know what is required at their farm and what to do when an action is
blocked. Software engineers and behavior authors need the exact definition,
revision, instance, inputs, state, and constraint decision behind a result.
Hardware engineers and installers need the installation binding, application
result, and available physical feedback. The product outcomes are reduced
effort, increased explainability, and increased traceability.

The first journey is: select a prepared behavior; review plain-language
requirements; confirm farm/installation facts; apply; receive either a
specific accepted result or a specific blocker; open the same incident to see
technical evidence. No farmer step requires imports or a graph.

## Evidence at examined revision

- `compileSource` accepts one canonical `.ghost.md` literate document and
  preserves source identity. Product composition and imported-source
  provenance are therefore proposals, not current compiler behavior. See
  [`tools/compile-source.mjs`](../../tools/compile-source.mjs).
- The interaction contract defines static descriptors and completed runtime
  observations. It requires exact schema, module, source, and run joins;
  `stale` is derived by the validating consumer. It currently permits only
  read-only `state` and `timer` descriptors. See
  [`contracts/interaction-v0/README.md`](../../contracts/interaction-v0/README.md).
- The integration contract keeps source/module/device/profile/installation
  identities distinct. A host pass does not establish hardware or physical
  success, and missing evidence remains unknown. See
  [`contracts/integration-v1/README.md`](../../contracts/integration-v1/README.md).
- The local composition summary proposes one event with participant-specific
  views. That is a design recommendation, not implemented behavior. The
  frontend, API, and Device remain the owners stated in [`AGENTS.md`](../../AGENTS.md).

## Tables and examples

The “current effort” cells are explicitly hypothetical workflows. The
walkthrough is hand-worked; it is not execution or participant evidence.

| Scenario | Participant | Trigger | Current effort / hypothesis | Necessary user decisions | Proposed visible answer | Supporting evidence | Success measure |
|---|---|---|---|---|---|---|---|
| Apply irrigation | Farmer | Wants to apply a prepared watering behavior | Hypothesis: reads technical requirements and asks an engineer when suitability or binding is unclear | Confirm site, water source, and any required installation facts | “Irrigation can be applied here”; show required facts, confirmed binding, and revision | Source/module identity; typed logical bindings; installation identity | Setup steps, technical decisions, corrections, and assistance requests are recorded; farmer can state what was confirmed |
| Add ventilation | Farmer, installer | Adds a four-fan ventilation behavior after irrigation | Hypothesis: manually checks whether existing irrigation wiring will change | Confirm fan count, available outputs, and physical installation facts | “Ventilation is compatible” or a named unknown/blocker; show that existing irrigation bindings remain unchanged | Integration bindings; exact profile and installation revisions; proposed composition compatibility result | No unexplained rebinding; user identifies each required decision and any unknown |
| Reject a pump ownership conflict | Farmer, software engineer | Two behavior instances claim exclusive ownership of one pump | Hypothesis: conflict is discovered late or explained only in an engineering log | Choose one owner or remove/change the conflicting behavior | “Cannot apply: pump X is claimed by behavior A and behavior B”; show both logical port identities | Declared output/port identities; proposed first-profile exclusive ownership rule | Conflict is rejected before deployment; both users can identify the conflicting claims |
| Explain low-water blocking | Farmer, software engineer | `low_water=true` while pump ON is requested | Hypothesis: farmer sees only “watering did not start”; engineer reconstructs input and rule separately | Farmer checks the tank or low-water installation; engineer verifies the exact run and rule | Farmer: “Watering was blocked by the low-water signal; check the tank.” Engineer: same incident links to `low_water`, the constraint, requested output, safe output, and run | Completed scan identity; input/constraint provenance; requested versus resolved safe output | Farmer names the signal and next action without claiming the tank is empty; engineer reaches the supporting input and constraint |
| Investigate command failure or missing feedback | Farmer, software engineer, installer | Command is issued but driver application fails or feedback is absent | Hypothesis: command, device failure, and physical result are conflated | Engineer/installer identifies which evidence is available and requests the missing observation | “Command requested; application failed” or “command outcome unknown: feedback absent”; show last known identities and gap | Integration run gates; device observation when available; physical evidence remains separate | Diagnostic effort and evidence-navigation effort decrease; no unsupported physical-success claim |

### Measurement sheet

Collection uses a scripted walkthrough of the five scenarios with the same
fixture, then later moderated sessions with farmers, behavior authors, and
installers. Record timestamps, actor, scenario, source revision, installation
revision, and whether each answer came from a heuristic walkthrough or a real
participant. Do not pool those evidence classes.

| Measure | Collection method | Baseline status | Desired interpretation |
|---|---|---|---|
| Setup steps | Count ordered actions from behavior selection to applied/rejected result | Unmeasured; count in first heuristic walkthrough | Fewer steps without hiding a necessary farm decision |
| Technical decisions | Count decisions requiring type, port, dependency, ownership, or revision knowledge | Unmeasured; heuristic count first | Farmers see only necessary choices; engineers retain precise choices |
| Corrections | Count wrong/changed bindings, settings, or selections before a valid result | Unmeasured | Specific early feedback reduces rework |
| Assistance requests | Count requests for engineer/installer help and reason | Unmeasured | Requests become narrower and evidence-linked |
| Explanation correctness | Ask participant to paraphrase blocker, effect, and next action; score against the supported evidence | No participant evidence; heuristic answer key only | No inference beyond the signal; low-water answer must not say tank is empty |
| Evidence-navigation effort | Count screens/records and elapsed time to reach source, input, constraint, run, binding, and available feedback | Unmeasured; hand-worked path only | Same incident serves farmer and engineer views |
| Unresolved cases | Count unknown/missing/stale evidence cases and whether owner is named | Unmeasured | Unknown stays visible rather than becoming pass or success |

### Paper walkthrough and automation boundary

1. **Apply irrigation:** automate descriptor and binding checks. Farm/site
   suitability and water-source confirmation require farm knowledge.
2. **Add ventilation:** automate type/capacity and preservation checks once a
   composition contract exists. Fan placement and physical capacity require
   installer knowledge. The current four-fan outcome is a proposed fixture,
   not a tested result.
3. **Ownership conflict:** automate detection and rejection of two exclusive
   logical owners. Choosing the desired owner is a human decision.
4. **Low water:** automate joining the completed scan to the input, constraint,
   requested output, safe output, and run. Checking the tank and deciding the
   operational response require farm knowledge. The invariant answer is:
   **“Watering was blocked by the low-water signal; check the tank.”** The
   signal does not prove that the tank is empty.
5. **Command failure/missing feedback:** automate identity joins and the
   distinction between requested, applied, and observed states when evidence
   exists. Deciding whether to inspect wiring, retry, or call an installer is
   human/installation knowledge. Missing feedback remains unknown.

Unanswered questions for later participant validation (not interviews):

1. Which minimum requirement wording lets farmers decide suitability without
   understanding compiler terms? Owner: frontend/product, with farmer sessions.
2. What evidence-navigation sequence is fastest and still understandable to
   software engineers and installers? Owner: frontend/API, with usability and
   diagnostic sessions.
3. Which command-application and physical-feedback states are available in a
   real installation, and who records each one? Owner: API/Device, with a
   commissioning evidence review.

## Recommendation

Adopt the five-scenario journey and measurement sheet as the acceptance
protocol for composition research. Prioritize a small result record that joins
participant wording to the exact source/module/instance/run and installation
identities already represented by the contracts. Reuse the interaction and
integration identity rules. Add no graph editor, telemetry pipeline, or new
storage system in this issue.

The first implementation-facing requirement should be a farmer-readable
result with a specific blocker or accepted result, plus an engineer view of
the same event. Explanation and event semantics remain with #88/#74; physical
observation remains Device-owned. The missing command/explanation descriptors
are unresolved contract work, not evidence that they exist today.

## Unresolved questions and owners

- #70 / interaction owner: whether and how command, input, event, and
  explanation descriptors extend interaction-v0 while retaining exact joins.
- #88 / explanation owner and #74 / event owner: canonical incident fields for
  requested output, safe output, application result, and missing feedback.
- API/Device owners: retention and transport of installation/application/
  physical evidence. The language repository must not silently choose them.

## Verification

- Checked the five rows against the acceptance criteria: each has a participant,
  burden, visible result, and evidence source; none requires imports or graphs.
- Checked the measurement sheet: every baseline is explicitly unmeasured or
  heuristic; no success percentage, interview result, or runtime/physical test
  is claimed.
- Checked the paper walkthrough: automation and farm/installation knowledge are
  separated; exactly three later validation questions are listed; every
  capability maps to effort, explanation, or traceability.
- Inspected commit `ffdbc96461eca67908252507fb851fa4dabd9a2c`. No runtime tests
  were run. This document is a recommendation and hand-worked analysis, not
  execution evidence.
- `git diff --check` and relative-link inspection are required coordinator
  handoff checks after this file is visible in the shared worktree.
