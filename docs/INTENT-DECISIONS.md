# Inspect authored intent decisions

`inspectIntentDecisions(request)` in `tools/intent-decisions.mjs` is a pure query over canonical GhostFlow source and compiler-validated `intent-evidence-v1`. `node tools/ghostdecisions.mjs --request request.json --format json` is the JSON/TOON CLI; TOON output is the default. This implements [#564](https://github.com/callin2/ghostflow-language/issues/564) using [#565](https://github.com/callin2/ghostflow-language/issues/565). The [Korean version](INTENT-DECISIONS.ko.md) describes the same contract.

This API does not infer intent from natural language, generate a question, approve a decision, authenticate an actor, enforce a requirement, change a runtime gate, or synthesize a control default. It recompiles each supplied canonical source and uses the existing compiler's authored anchor and intent evidence validation. Original external records stay visible beside the compiler's limited structural conclusions. All four decision kinds remain separate: `confirmed`, `policy-derived`, `assumption`, and `undecided`.

## Request

The top-level object requires `schema: "GhostFlow/intent-decisions-request-v1"` and `current`. It may supply `requirementContract`, `previous`, and `transitions`. `transitions` requires `previous`.

`current` and optional `previous` each require:

- `source: { text, filename, documentId, revisionId }`, where `text` is the complete canonical `.ghost.md` program and the IDs explicitly name its authored revision.
- `intentEvidence`, a complete `GhostFlow/intent-evidence-v1` record. It is independently compiled and bound to that source; an old evidence source digest, interpretation confirmation digest, condition digest or authored node link is rejected.
- Optional `sourceClosure`, a bounded array of `{ filename, revision, text }` passed directly to the compiler for explicit imports. The query never reads imported files from disk.

When imports are compiled, `source.sourceClosureSha256` in the result hashes the compiler's canonical closure, including imported document revisions and exact text. A changed closure under the same root document/revision IDs also qualifies for `source-revision-reused`, even when the root source SHA is unchanged. Import SHA pins remain enforced by the compiler.

`requirementContract` is optional and external. Its shape is `{ id, revision, reference, requirements }`. An explicit empty `requirements: []` is `supplied` with no unmet requirements; omission is `not-supplied`. Every requirement has exactly:

```json
{
  "id": "R-PUMP",
  "interpretation": { "id": "I-PUMP", "revision": "r1", "sha256": "<optional exact content SHA-256>" },
  "level": "confirmed",
  "conditionRefs": [{ "id": "C-PUMP", "revision": "r1", "sha256": "<exact condition SHA-256>" }],
  "actionRefs": ["action:deploy"],
  "claimRefs": ["claim:ready"],
  "onUnmet": "hold"
}
```

`interpretation.id` is required; `revision` and `sha256` are optional exact pins. The digest is the existing `intentInterpretationDigest`, which covers interpreted content but excludes claimed confirmation. `conditionRefs` is optional and, when provided, contains exact id/revision/digest references to conditions owned by that interpretation. `level` is `represented` or `confirmed`. `represented` requires only a matching interpretation and any supplied condition references; it can include an assumption or undecided state without changing that state. `confirmed` additionally requires the interpretation's compiler-reported `recorded` confirmation (including a current policy-derived decision) and `recorded` status for **each supplied condition reference**. If no condition references are supplied, `confirmed` checks the interpretation decision only; it never implies that all conditions are confirmed. `onUnmet` is `report`, `hold`, or `block`; `actionRefs` and `claimRefs` are distinct unique string arrays. These are returned as metadata for an external consumer. This query does not perform the hold or block.

Unmet codes distinguish missing interpretation, interpretation revision/content mismatch, missing or changed condition, a condition outside confirmed scope, and decision states such as `undecided`, `unconfirmed`, or `policy-not-current`. Only the explicitly supplied requirements are tested. An absent contract produces no inferred missing requirement.

## Previous revision and transitions

When `previous` is supplied, it is compiled and validated independently. Each interpretation row includes:

- `contentSha256`: the compiler's existing digest of interpreted content, excluding the decision.
- `recordSha256`: SHA-256 of canonical JSON `{ interpretation, conditions }`, including the complete decision and **all conditions owned by this interpretation**. A condition-only change therefore changes this comparison identity even if interpreted text and bytecode do not change.

The comparison returns `added`, `removed`, `unchanged`, or `changed` rows with both complete records. Same-ID rows pair by ID. A cross-ID rename pairs only through an explicit unambiguous transition. A transition is `{ from: { id, revision, sha256 }, to: { id, revision, sha256 }, actor, recordRef, at }`; its digests are the full `recordSha256` values. One-to-one pins are required, and duplicate, ambiguous, stale or mismatched pins are rejected. A changed row without a transition carries `transition-link-missing`. Changed interpreted content under the same ID and revision carries `interpretation-revision-reused`; a changed condition with the same condition ID and revision carries `condition-revision-reused:<id>`. The root comparison carries `source-revision-reused` if source bytes change under the same document and revision IDs. These are diagnostics, not runtime blockers. Changing only the decision or conditions can keep the same interpreted-content revision while still requiring a transition link for the changed full record. A rename does not trigger the same-ID interpretation revision warning. No prior confirmation is transferred to the current source automatically.

## Result and limits

Success returns `GhostFlow/intent-decisions-result-v1` with `outcome: "completed"`, exact request/source/evidence digests, `current.decisions`, `current.judgments`, `requirements`, `comparison`, and `trust`. Each decision retains the original interpretation, original source reference, decision and all owned conditions with their confirmation scope and external check IDs. The existing judgments stay `not-evaluated`; actor authority stays `not-authenticated`. Policy `current`, `expired`, and `unknown` remain distinct in the original record, while expired/unknown cannot meet a `confirmed` requirement. Source and bytecode hashes are reported separately, so prose changes with identical bytecode remain identifiable.

Input is acyclic JSON data capped at 524,288 serialized UTF-8 bytes and depth 24. Source text is at most 262,144 characters; source closure has at most 32 entries; requirements, transition records, and other bounded lists have at most 128 entries. Sparse arrays, duplicate IDs/references, malformed fields and bad timestamps are rejected. The API copies inputs before compilation; results do not alias caller objects. Complete output is capped at 524,288 UTF-8 bytes. If expansion exceeds this bound, the API returns only `outcome: "incomplete"`, the exact request SHA-256 and an `output-limit` diagnostic, with no partial met or confirmed answer; the CLI exits 1. Malformed input emits `rejected` in the CLI and exits 1.

Run the executable fictional regression from the repository root:

```sh
node --test tests/intent-decisions.test.mjs
```

It covers four decision states, partial confirmation, explicit requirement policies, source drift, exact transitions, bounds, and JSON/TOON parity. Fixture actors and references are invented; the test does not establish external authority or device behavior.
