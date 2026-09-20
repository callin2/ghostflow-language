# GF-COMPOSE R5: composition contracts and diagnostics

## User problem

A farmer needs a clear reason when behaviors cannot coexist. Engineers need the
conflicting requirement, affected identities, and evidence without an
unsupported blanket “safe” result. This document defines a proposed first
contract profile for composition. It is research/design, not implementation.

The profile covers type, dependency, parameter bounds, exclusive output
ownership, and installation-constraint compatibility. Broader shared-actuator
resource arbitration remains #95. Canonical `.ghost.md` source owns executable rules;
the Rust core owns execution; installation context and deployment remain
external authority boundaries.

## Evidence at examined revision

Evidence was examined at `ffdbc96461eca67908252507fb851fa4dabd9a2c`. No runtime
test suite was run. The R3 and R4 dependency documents were read as proposals
and evidence summaries; their unresolved choices remain unresolved here.

Current evidence establishes the following:

- `compileConstraints` accepts `exclusive`, bounded `require` forms,
  `allow(enter/apply)`, `limit on_time`, `once`, and non-blocking `check
  pump_capacity`; unsupported expressions fail compilation
  ([`tools/constraints.mjs`](../../tools/constraints.mjs)).
- Constraint phase is significant. Output relations apply to final output
  candidates; enter/apply rules apply at request entry; capacity checks apply
  to a new-work authorization path ([`docs/CONSTRAINTS.md`](../CONSTRAINTS.md)).
- `prepare_start_batch` selects the lowest request ID from one same-tick
  snapshot. It does not establish universal composition arbitration
  ([`station.rs`](../../crates/ghostflow-core/src/station.rs)).
- `authorize_output` requires the active session and validates valve ownership,
  valve count, and pump-with-valve safety. A station owns one physical pump;
  this is a bounded station policy, not a general behavior-composition proof.
- Integration v1 requires exact logical-name bindings with matching direction
  and semantic type. Its independent host, hardware, and physical gates use
  `unknown` when evidence cannot establish a result; a validator pass is not
  physical acceptance ([`contracts/integration-v1/README.md`](../../contracts/integration-v1/README.md)).
- Source trace joins source identity, bindings, constraint indexes, and runtime
  observations. Missing fields remain unobserved; the trace does not infer
  electrical or mechanical operation
  ([`docs/SOURCE-SAFETY-TRACE.md`](../SOURCE-SAFETY-TRACE.md)).
- R2 system-memory #68 is a fixed boundary for this document: conversational
  memory is provenance/authoring context, not execution-rule or binding
  authority. Installation-constraint authority under system #62 remains open.

### Evidence classes

| Class | Meaning in this profile | Example |
|---|---|---|
| Declared assumption | Input supplied for planning, not independently established | A proposed binding names `MainPump` |
| Tested property | A test or recorded gate established the stated scoped result | An integration host gate is `pass` with a reference |
| Statically established property | Compiler or validator proves a bounded structural fact | A required output has matching direction and semantic type |
| Runtime-enforced constraint | The execution path rejects or blocks the invalid request/output | `authorize_output` rejects a pump-on/no-valve output |

The profile may report all four classes. It must not promote an assumption or
structural match into physical safety. A missing installation gate is
`unknown`, not `pass`. Source trace identity improves traceability but does not
prove that a device applied the command.

## Tables and examples

### Proposed first contract profile

| Property | Required inputs | Check phase | Supported claim | Unsupported or unknown case |
|---|---|---|---|---|
| Type | Canonical manifest role/type; profile endpoint direction/type; explicit binding | Static binding validation | The logical role is structurally compatible with the supplied endpoint | Coercion, analog semantics, or undocumented driver behavior is not proved |
| Dependency | Declared dependency names and source trace nodes; complete composed input map | Compile/lowering and pre-activation validation | Existing invariant rejects instantaneous expression cycles; missing targets are rejected | Cross-module same-scan lowering remains unresolved; existing phase/next-reference restrictions remain fixed |
| Parameter bounds | Declared integer/duration values; profile and station limits | Compile validation, then request/start authorization | Values fit declared compiler/station bounds; finite quota/budget checks can reject requests | Physical capacity, pressure, flow, or unmodeled parameter semantics remain unknown |
| Exclusive owner | Logical output IDs, explicit endpoint bindings, owner/claim IDs | Compile-time logical authority check; separate binding validation; station authorization where applicable | One authoritative definition per output channel; duplicate direct writers fail compilation and cannot be deployed | No automatic resolver; existing declared station resource arbitration remains separate |
| Installation-constraint compatibility | Pinned board/profile and installation revisions; independent gate evidence; constraint artifact or authority decision | Pre-activation compatibility gate; runtime only for constraints actually lowered/enforced | Matching identities and explicit compatible constraints can be reported | #62 has not selected artifact/overlay/enforcement authority; absent evidence is unknown |

“Compatible” is deliberately scoped. It means the checked requirement is
supported by the named input and phase. It does not mean the whole installation
is safe. Constraint/source identity should use the existing source trace
fields, including source and bytecode digests, rather than an invented identity.
Instantaneous expression cycles are rejected; this is an existing invariant,
not an open policy choice. State feedback crosses the prior-state/next-state
boundary. All transitions use one input/old-state snapshot; next references are
allowed only in output expressions, never other next transitions or lets.
Logical commit is simultaneous. Composition must preserve these rules.

### Exactly four diagnostic examples

1. **Two exclusive pump owners.**

   - Reason code: `GF-COMPOSE-EXCLUSIVE-OUTPUT`.
   - Farmer message: “These two behaviors both require the same pump. Choose
     one behavior, or install a separate pump before applying both.”
   - Affected IDs: `irrigation.pump`, `fertigation.pump`, endpoint
     `MainPump`.
   - Evidence: declared exclusive-owner requirement; binding revision and
     endpoint identity; source-trace nodes for both output intents.
   - Required outcome: fail compilation for duplicate authoritative output
     definitions, naming both definitions and the affected output. The
     candidate cannot be deployed. Resolve the source definitions; a distinct
     endpoint alone does not legalize two writers to one logical channel.
     Station resource requests remain separately arbitrated.

2. **Incompatible port.**

   - Reason code: `GF-COMPOSE-PORT-INCOMPATIBLE`.
   - Farmer message: “The requested pump is connected to a port that does not
     match the behavior’s required output type. Select a compatible port or
     correct the installation record.”
   - Affected IDs: logical role `irrigation.pump`; endpoint `DI-2`; expected
     `output/Bool`, supplied `input/Bool`.
   - Evidence: pinned board-profile revision, installation `bindingRevision`,
     and the validator’s direction/type mismatch.
   - Corrective option: bind the role to an unused matching output, or have the
     profile/installation owner correct the mapping. No coercion is implied.

3. **Missing dependency.**

   - Reason code: `GF-COMPOSE-DEPENDENCY-MISSING`.
   - Farmer message: “This behavior needs `water_ok`, but no supplied behavior
     or input provides it. Add that input or remove the dependency.”
   - Affected IDs: consumer `irrigation.start`; required dependency
     `water_ok`; cite the canonical source span/node only if present in the
     compiled source map. A composed dependency-map node is proposed, not
     established by current contracts.
   - Evidence: canonical source declaration/span when available and the
     composed input map; mark any unavailable source-map or trace target
     explicitly absent/unresolved. Do not invent a node or provenance record.
   - Corrective option: provide an explicitly bound `water_ok` input/result,
     or revise the source. Same-scan result timing is not inferred.

4. **Unknown required installation evidence.**

   - Reason code: `GF-COMPOSE-INSTALL-EVIDENCE-UNKNOWN`.
   - Farmer message: “The behavior requirements match the recorded profile, but
     the installation evidence needed to confirm this setup is missing. Ask
     the installer to verify it before starting.”
   - Affected IDs: constraint `SharedPump`; installation `site-a/rev-7`;
     endpoint set `MainPump`, `ValveA`.
   - Evidence: pinned profile and binding identities exist; required hardware
     or physical gate is `unknown` or `not_run` with no qualifying reference.
   - Corrective option: obtain the owner’s current hardware/physical evidence,
     or leave the result unknown and do not claim confirmed installation.

### Valve-switch counterexample and station boundary

Counterexample (hand-worked, not execution evidence): behavior A owns a pump
session and turns the pump OFF briefly while changing from `ValveA` to
`ValveB`. Behavior B sees `pump=false` and requests the same physical pump. A
local rule such as “pump is off, therefore B may start” would break the session
ownership invariant. The existing station policy explicitly retains the
session across valve cleanup and says an inactive control cannot stop the
owner. `prepare_start_batch` and `authorize_output` therefore support this
bounded station claim, when the host supplies the station request and session
state. They do not prove that arbitrary composed behaviors share resources
correctly.

Issue #95 may define additional shared-actuator arbitration and fallback. This
does not reopen the single-authoritative-definition rule for an output
channel. This document does not add an arbiter or a temporal/theorem-proving
engine. R2/#62 must decide where installation
constraints are authoritative and how their evidence is supplied. Until both
decisions are reviewed, the profile reports compatibility only for supported
inputs and phases.

## Recommendation

Adopt this as a review hypothesis: reject composition before activation when a
supported type, dependency, bound, or exclusive-owner check fails; preserve
the exact requirement and evidence references in the diagnostic. Use
`unknown` for absent installation evidence. Reuse existing source-trace
identity and station enforcement where their scope matches. Do not claim a
global safe result, physical acceptance, priority, or arbitration from local
checks.

## Unresolved questions and owners

- **Language/compiler owner:** define the composed dependency representation
  that preserves the existing cycle rule, and define the stable reason-code registry.
  Preserve old/next and
  single-writer rules; cross-module same-scan lowering remains unresolved.
- **Language/runtime ABI owner:** define the diagnostic envelope and how
  instance IDs, endpoint IDs, source nodes, constraint indexes, and evidence
  references join without changing the current ABI implicitly.
- **System #62 with API/language owners:** decide installation-constraint
  authority, artifact form, and enforcement phase. This document intentionally
  does not select one.
- **#95/station owner:** define any additional shared-resource arbitration and
  fallback. Existing station policy remains bounded to one physical pump
  station and must be audited, not generalized. This does not authorize
  multiple direct writers to one output channel.
- **API/integration owner:** define how missing or stale profile, binding, and
  gate evidence is refreshed and approved. Memory #68 cannot authorize it.
- **Device/installation owners:** supply physical acceptance and applied-binding
  evidence. Host validation cannot establish those facts.

## Verification

- [x] Examined revision recorded as `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] Targeted sections of `docs/CONSTRAINTS.md`, `station.rs`,
  `tools/constraints.mjs`, `docs/SOURCE-SAFETY-TRACE.md`, and
  `contracts/integration-v1/README.md` were checked.
- [x] R3 and R4 dependency findings were read; their unresolved decisions are
  preserved rather than treated as architecture approval.
- [x] The table separates check phase from evidence strength and keeps unknown
  evidence unsupported.
- [x] Exactly four diagnostics are included. Each has a stable proposed code,
  farmer message, affected IDs, evidence references, and corrective option.
- [x] The valve-switch counterexample identifies the limit of local guarantees
  and assigns the follow-up to #95 and R2/#62 without adding a policy engine.
- [x] Examples are labeled hand-worked where applicable. No runtime or
  physical execution is claimed; runtime suites were not run.
