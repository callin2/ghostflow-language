# Derived window evidence proposal

Status: measured nested-window compiler/core/proof/package path implemented and
included in batch13. Full temporal/adapter replay acceptance remains open; see
execution evidence below. Nested windows are required language behavior.

## Ground truth and approved semantic decisions

[Reference §4.4](../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence)
requires original observation identities, no contribution for retransmission or
reevaluation, distinct aggregate-result provenance, preservation through transforms
and branches, and downstream windows that distinguish aggregate identities from
physical observations. It also fixes the open-left window, strict `max_age`, fault
retention and source-epoch invalidation. The existing
[evidence plan](window-evidence-design.md) supplies explicit physical density facts;
expected acquisition cadence supplies no bound.

The Reference does **not** determine whether an upstream expiry-only value change
is a new downstream observation, which timestamp identifies a derived observation,
or whether overlapping aggregate inputs receive one weight each. Those choices
change numerical results. Root approved the following non-operational language
decisions; no device cadence, density or installation default is introduced.

Approved interpretation:

1. A successful result of a **new upstream admission** creates a derived event.
   Mere evaluation, contributor expiry, selector changes, fault changes and state
   changes do not create a new observation. Keep the existing meaning of
   `admissionRevision`; do not quietly turn it into a scan counter.
2. A derived event's observation timestamp is the upstream result's newest
   contributor observation timestamp, recursively inherited from real evidence.
   Keep the committed evaluation time separately as `evaluatedAt`. Recomputing a
   delayed observation must not renew its measurement freshness. Neither time is
   a fabricated physical identity.
3. Each distinct derived event receives one weight in a downstream average.
   Deduplicate aggregate identities at that layer. Do not flatten nested averages
   or deduplicate shared physical leaves when doing their arithmetic. Shared leaves
   are provenance, not additional downstream input points.
4. Invalidating a physical source epoch invalidates any retained derived event
   whose proof depends on that old epoch. A mixed A+B aggregate cannot keep its
   old scalar value while silently removing A. Drop that dependent event; preserve
   independent B-only events. This is transitive dependency invalidation.

Using evaluation time as observation time is a real alternative: it measures
freshness of an aggregate publication rather than its latest measurement. It
would keep a late result fresh under a shorter downstream max_age. The Reference
names both evaluation time and original observations but does not settle this
downstream timestamp. Root selected the observation-time rule above.

Expiry-event emission is another alternative, but requires a new result-generation
counter, a bound for expiry-triggered events at every depth, and a definition of
their timestamp. Emission on every scan has no bound from physical density and
would overweight cached evidence. Flattening original leaves changes the meaning
of function composition. Neither is the proposed default.

## Executable admission and quality

Use two disjoint identity namespaces:

- Physical: `(sourceTag, sourceEpoch, sampleId)`, with original timestamp.
- Derived: `(site, admissionRevision)` scoped to the installed module, selected
  strategy and live execution session, with separate observation timestamp,
  evaluation time and a bounded proof of the inputs.

The live Runtime/arena supplies that scope. The fixed time epoch participates in
continuity validation but is not a globally unique session ID. Current core trace
module fingerprints are not cryptographic artifact identities. Persisted or foreign
records must be carried in the existing authoritative artifact/source envelope;
the consuming boundary verifies that identity before resolving local site/revision
keys. Do not invent a global ID or new hash infrastructure for nesting. Durable
restore of an independently acquired envelope remains separate unfinished work.
All expression-facing integers stay exactly representable, including revisions.
Slot indices are not physical source tags.

Evaluate the prelude in dependency order once per scan, against old authored
state. Evaluate a successful source payload eagerly even if its evidence is old;
selected arithmetic faults must still reject the scan. Evaluate fault/origin only
when the source is unsuccessful. Preserve the current atomic prelude transaction.

Every consumer records the highwater revision of **every declared upstream window**
on each committed scan, including unselected and unsuccessful sources. It admits
at most the selected fresh successful event. Switching back to a cached window
cannot reintroduce its prior result. Rollback restores these highwaters, so retrying
a failed scan does not lose the event. Physical inputs keep their existing all-root
highwater handling. A new admission that produces NotReady (for example the first
point of a rate) advances observation history but supplies no successful event.

At fresh activation, every upstream highwater starts at revision0. No revision0
window has admitted evidence, so it cannot provide a successful derived event.
An upstream candidate revision greater than its saved highwater is fresh. The
consumer stages the candidate revision even if unselected, or if either Result
is unsuccessful. Only a fully successful scan commits these highwaters. Any
source-expression, density, arithmetic or later-intent error discards them along
with all window candidates. Retry sees exactly the same freshness as the failed
attempt. Checkpoint replay restores the saved highwaters; it does not reinitialize
them to0 while retaining histories.

Revision ordering does not imply monotonic derived observation timestamps. For
example invalidating the previously newest root can expose older valid evidence.
Sort derived entries by observation time and identity; do not apply the physical
single-source backwards-timestamp guard to derived revision order.

The upstream current value may change on expiry without changing its admission
revision. Such a value is still readable by ordinary expressions, but creates no
new downstream point. The downstream's existing history may remain successful
through upstream NotReady; retain that upstream fault in its trace.

`quality: measured` accepts physical Measured evidence and a verified derived proof
whose leaves are admissible Measured evidence. Its result remains Derived (3), never
Measured (1). Held (2) and Constructed (0) cannot become admissible by passing through
a window, map, case, recover or constructor. Pure map/and_then preserve the incoming
evidence reference; Result branches select one reference. Recover followed by a new
constructor has no measurement proof. A transform can change an event's payload
without changing its identity, as in the existing physical-expression path.

## Existing GFB4 wire is sufficient with an explicit evidence marker

Keep the existing six source expressions: ok, payload, fault, origin, quality and
evidence reference. Generalize the sixth field's meaning using quality:

- quality 1: positive physical root tag, as today;
- quality 3: prior window site in a separate namespace;
- quality 0/2: no admissible evidence.

For each derived lineage leaf, the compiler emits `(window-read U quality)` in the
fifth blob and U's site in the sixth blob. Branches select these in parallel. A
constant pure map still retains the quality projection. The existing opcode57
field7 in the quality blob therefore serves as an explicit dependency marker.

The decoder collects those field7 references into a sorted unique internal
dependency list. They must be prior slots, already enforced by expression
verification. Ordinary window value/ok reads in a branch condition are not evidence
markers. Existing rootRefs become the complete transitive physical-root set;
verify that each evidence dependency's roots are included. On quality3, Runtime
requires the selected site to belong to that list and requires that upstream's
actual successful candidate proof. Constant quality3 alone cannot name an
undeclared upstream. Dynamic physical source tags continue to work unchanged.

Collecting all opcode57 reads indiscriminately would confuse control dependencies
with evidence. An added descriptor table could express the same declaration, but
would require a new layout/profile. The quality-projection marker supplies the
needed static bound with the existing six blobs. Root approved this GFB4 contract;
no new opcode or wire field. Manifest/source metadata record the corresponding
prior-window evidence bindings and canonical replay checks their exact selection.
The static state/window count, module, expression and stack ceilings stay unchanged.

## Finite capacity and owned proof storage

For each window W in topological order define a conservative accumulated horizon:

`H(W) = over(W) + max({0} ∪ {H(U): U is an evidence dependency of W})`.

Given explicit root bounds `(M_r, I_r)`, reserve logical input capacity:

`C(W) = sum over transitive roots r of M_r * ceil(H(W) / I_r)`.

Reason: every new retained derived point has a fresh physical ancestor, admitted
through its selected chain. That ancestor lies within the accumulated lookback
behind the point's newest observation timestamp. Each window emits at most one event per committed scan;
all-source highwaters prohibit emitting again for the same causal admission on a
later selector/clock-only scan. Proof retention therefore needs accumulated
lookback, not an assumed density bound on evaluation timestamps. Multiple root
updates in one scan only overestimate this capacity. Source-epoch replacement
removes old dependent proofs before admission. Retained events must not be silently
evicted if this proof or a checked bound fails: reject the whole scan/activation.

Several admissions can share the same newest timestamp. An anchor at timestamp100
can remain newest while delayed, distinct samples at90 and95 each advance the
upstream revision. Do not deduplicate those revisions by timestamp and do not apply
the physical density directly to derived timestamps. The distinct causal samples
are bounded over H(W), which includes the upstream lookback behind the anchor.

Retained payloads alone are insufficient. Each derived point must keep the complete
proof of the upstream aggregate at admission, even after upstream entries expire.
A simple first implementation stores that proof as a flat, owned tree in a
preallocated arena; copied overlapping subtrees are allowed and fully budgeted.
It does not require an unbounded Arc graph, hash identity, or interning subsystem.

Let `P(W)` bound the nodes in a complete W output proof, with a physical leaf cost1:

`P(W) = 1 + C(W) * max({1} ∪ {P(U): U is an evidence dependency of W})`.

Each tree node includes its kind, evidence identity, timestamp, payload and bounded
child range. Derived nodes retain declaration/operation/evaluation identity;
physical leaves retain original identity. Edge payloads must preserve transforms;
never reconstruct transformed numbers in JavaScript. This recurrence can grow
quickly in a branching graph, but is finite and checked. A DAG-sharing optimization
is optional later; target-budget rejection is preferable to unaccounted storage.

Activation checks every sum/product and allocation. `maxRetainedSamples` remains
the sum of logical C(W), while maxBytes includes proof copies, upstream highwaters,
two candidate/committed banks, J+1 checkpoints, J+1 independent trace trees, bounded
copy scratch and replay's live-plus-scratch peak. Larger sufficient budget ceilings
are compatible; topology, profile and allocation geometry are checkpoint identity.
There is no new physical density setting or scan-frequency default.

## Transaction, trace and replay

Add a Rust internal evidence enum rather than adapting derived data into
`Observation {source_tag, Identity}`. Physical source engines may keep their current
representation; generalized retained entries carry physical or derived identities
and proof ranges. Admission, epoch invalidation and source highwaters stage with
window payloads. All staged changes roll back on any later source/intent failure.

Checkpoint and rewind include proof arenas, derived highwaters, event observation
timestamps and evaluation times. Replay requires matching input/state layouts plus descriptor topology,
source bindings, fixed time epoch and density proof. Trace records own their proof
trees independently of Runtime lifetime. The source observer validates/maps those
facts without calculating an average. Preserve separate immediate contributors
and physical leaves; reporting the leaf count as the downstream sample count is
wrong. Session replacement and temporal hot-swap migration remain explicit work.

## Six discriminatory acceptance scenarios

1. **Composition and overlapping leaves.** Inner average over2ms, outer over10ms;
   physical `(t,value)=(0,0),(1,10),(2,20)`. Inner results are0,5,15; outer result
   is20/3 with3 derived contributors. Its unique physical leaf set has3 identities;
   averaging that flattened set would incorrectly produce10. Density must permit
   these actual samples. Replay yields the same identities and numbers.
2. **No scan/expiry manufacture.** Continue scenario1 at t3 with no new sample.
   Inner becomes20 by expiry, but emits no new event. Outer remains20/3, count3.
   Duplicate sample delivery and selected-expression reevaluation also leave its
   count/revision unchanged. This distinguishes the root's event-cadence decision.
3. **Observation time versus evaluation time.** An inner observation timestamp0
   is first admitted at evaluation9, inner over/maxAge10; outer over10/maxAge2.
   Proposed derived observation timestamp0 makes the outer NotReady immediately;
   the inner result is successful, evaluatedAt9. The alternative publication-time
   rule would keep the outer fresh until11. This distinguishes a freshness renewal
   from recording evaluation time without refreshing evidence.
4. **Repeated newest timestamp, selectors and quality.** Inner over20ms first
   admits A(ts100,value100) at now100, then B(ts90,value0) at101, then B(ts95,value20)
   at102. Its derived values100,50,40 all have observation timestamp100. Outer
   over/maxAge5ms retains all3, giving190/3. Profiles A=1/1000ms and B=1/5ms permit
   this sequence: direct outer-horizon capacity2 would fail, accumulated horizon25ms
   capacity6 suffices. Separately, two upstream windows produce A=2 and B=8
   in one scan; the outer selects A. Switching to cached B without a new observation
   must not add8. A subsequent genuinely new B admission may add its result once.
   Mapping a Held value or constructing ok never creates a measured leaf.
5. **Epoch invalidation and rate ties.** Keep one A+B-derived point and a separate
   B-only point. A epoch change drops only the dependent mixed point. A rate over
   distinct derived identities with the same observation timestamp is NotReady;
   with values5 at t1000 and9 at t3000 its canonical value is2/second.
6. **Proof budgets, rollback and rollover.** Activate at the calculated exact byte
   and logical-capacity bounds; one less rejects. After a new nested event, a later
   division fault leaves scalar/window/proof/highwater/journal state unchanged;
   identical retry admits once. With J2, replay after rollover restores the proof
   before the oldest retained scan, even when the inner's original leaves have
   already expired. The same test must execute native and both WASM adapters.

Root approved the semantic decisions, transitive mixed-proof invalidation and
quality-projection marker contract. No user-specific operating number is needed.

## Execution evidence and remaining acceptance

- Native Rust core: `tests/temporal_derived.rs`, eleven independent tests cover the
  six scenarios, marker/root verification, compacted endpoint indices and eager
  payload/lazy fault evaluation. The unit allocation test runs 200 transaction,
  checkpoint and restore cycles without allocations. Full core: 136 pass,
  `build/temporal-derived-core-final.log`; also passed batch13.
- Compiler/encoder: `tests/window-derived-control.test.mjs`; focused aggregate
  run 38 pass with the physical window and GFB suites, then passed batch13.
- Both actual WASM host paths: `tests/window-derived-host.test.mjs` initially
  six pass in batch13. These cover 20/3 composition, no expiry admission, original
  freshness and transformed aggregate proof values, including source observation.
  After the gate, two late-fault/same-ID-retry tests were added: host eight/eight
  pass in `build/window-derived-host-retry.log`; the committed public trace remains
  unchanged on failure and revision3 is admitted exactly once on retry.
- Source metadata/proof validation: `tests/window-derived-provenance.test.mjs`,
  five pass; malformed owned tree/identity and canonical dependency substitution
  cases supplement the actual WASM observations.
- Signed JS packages: eleven leaf cases (twelve including parent) pass in
  `tests/window-derived-package.test.mjs`. Native package verifier: 28 tests pass,
  including nested dependency omission/rebinding/type/index rejection before the
  target loader. The native verifier does not recompile JavaScript source.

Scenario 6's native checkpoint/rewind and J2 rollover tests pass. Batch14 adds
read-only checkpoint replay through both WASM adapters with their actual J1024
journals: exact original-record equality, nested 20/3, owned proof identity,
late-fault/retry, retained-prefix rollover and live state preservation. See
`tests/temporal-replay-wasm.test.mjs` and `temporal-adapter-replay-design.md`.
The actual WASM tests and temporal resource-plan suites now prove the exact
target-specific boundary oracle. See `build/temporal-resource-plan-wasm-green.log`,
`build/scan-frame-wasm-temporal-plan.log`, and the oracle values in
`tasks/temporal-resource-plan-design.md`. Do not generalize this evidence to
other temporal operators or durable restore.
Durable foreign checkpoint restore, temporal hot-swap and estimated evidence
remain outside this measured live-session increment and remain unfinished.
