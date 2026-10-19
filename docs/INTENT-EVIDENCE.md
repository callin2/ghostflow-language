# Intent evidence authoring API

[한국어](INTENT-EVIDENCE.ko.md)

Implementation of the shared [intent responsibility contract](INTENT-CONSISTENCY-CONTRACT.en.md), tracked in [#565](https://github.com/callin2/ghostflow-language/issues/565).
The compiler can validate and retain an external interpretation/decision/condition record. It checks structure, exact source identity, authored links and internal revision consistency. It does not interpret natural language, authenticate decision authority, run conditions, or observe a device.

## Public entry points

Both `tools/toolchain.mjs` (Node) and `tools/browser-toolchain.mjs` (browser/Worker) accept `compileSource(source, { filename, intentEvidence })`. The optional record adds `compilation.intentEvidence`, a `GhostFlow/intent-evidence-report-v1` report. Without the option, existing compilation output is unchanged. GFB bytes and the control manifest are unchanged with or without valid evidence.

Both entries export `intentInterpretationDigest`, `intentConditionDigest` and `INTENT_EVIDENCE_LIMITS`. Digests use canonical JSON with sorted object keys and preserved array order. An interpretation digest includes `id`, `revision`, `original`, `text`, and `anchorIds`, excluding its decision. A condition digest includes its entire record.

Invalid supplied metadata throws `GF_INTENT_EVIDENCE` with a structured diagnostic and `evidencePath`. A valid assumption, undecided item, missing external check, or partially confirmed interpretation does not cause a compilation error. This validates the optional authoring request; it adds no runtime or deployment gate.

## Record schema

All fields listed below are required unless explicitly optional. Unknown fields, duplicate identifiers, invalid enum values and mismatched references are rejected. This is a provenance record, not an executable conditions DSL.

| Record | Fields |
|---|---|
| Root | `format: GhostFlow/intent-evidence-v1`, `sourceDocumentSha256`, `interpretations[]`, `conditions[]`, `checks[]` |
| Interpretation | `id`, `revision`, `original: { id, revision, reference }`, `text`, `anchorIds[]`, `decision` |
| Condition | `id`, `revision`, `interpretation: { id, revision }`, `statement`, `scope`, `nodeIds[]` |
| Condition reference | `id`, `revision`, `sha256` from `intentConditionDigest` |
| External check | `id`, `judgment`, `conditions[]` of condition references, `result`, `producer`, `evidenceRef`, `scope`, `at`, `context` |

IDs and revision names match `[A-Za-z][A-Za-z0-9._:-]{0,127}`. Compiler node IDs are the numeric IDs returned in `sourceMap`/`intentLinks`; copy them from the compilation, never generate them from a source line or name. Every condition node must have an existing authored link to one of its interpretation's anchors. Empty node lists are allowed and reported as unlinked. Only anchors present in the compilation's intent metadata may be selected; this does not infer links for imported documents or unannotated code.

The original reference is an external immutable-record locator supplied by the caller. The compiler retains it without fetching or authenticating it. `statement` and `scope` remain uninterpreted text, including the externally chosen units, timing, assumptions and observation range. Array order participates in the record hash. The record can cover part of a program; unrepresented active anchors remain visible in coverage.

Limits: 262,144 canonical UTF-8 bytes, 128 entries in each array, 8,192 characters per general text field, and canonical JSON nesting depth 16. Sparse arrays, non-finite numbers, unsafe integers, malformed Unicode and non-JSON objects are rejected. The CLI additionally bounds the raw file size. Timestamps are valid UTC ISO strings with `Z` and either whole seconds or three millisecond digits. Time validity is syntactic; no wall clock or policy age is inferred.

### Decision variants

| `decision.kind` | Additional fields | Meaning |
|---|---|---|
| `confirmed` | `actor`, `authorityRef`, `recordRef`, `at`, `interpretationSha256`, `conditions[]` of exact condition references | A supplied confirmation record for the hashed interpretation and listed conditions. Its authority remains unauthenticated. |
| `policy-derived` | All confirmed fields plus `policy: { id, revision, reference }`, `applicationRef`, `validity: current/expired/unknown` | Retains policy/application evidence. `current` is the provider's assertion; the compiler does not establish it. Expired/unknown applicability is surfaced as `policy-not-current`. |
| `assumption` | `actor`, `reason` | LLM proposal; linked anchors must be `kind=assumption status=unconfirmed origin=ai`. |
| `undecided` | `question`, `owner` (nonempty text or `null`) | Unresolved external decision; linked anchors, if any, must be unconfirmed. No new anchor enum is introduced. |

Confirmed/policy-derived records require existing confirmed intent/premise anchors, if anchors are supplied. They cannot silently confirm an authored assumption. Superseded anchors are rejected. One active anchor cannot have multiple current interpretations in this record. Conditions outside a confirmation's explicit list remain `outside-confirmed-scope`; an empty list confirms no code condition. Changing interpretation text or a listed condition while retaining old confirmation digests fails. Hashes detect inconsistent reuse, not a forged confirmation that has been consistently rewritten.

### External check context

`judgment` is `requirements-consistency`, `code-compliance`, or `device-compliance`. `result` is `satisfied`, `violated`, or `unknown`. Every check references at least one exact condition revision/digest and supplies:

| Context field | Rule |
|---|---|
| `sourceDocumentSha256`, `bytecodeSha256` | Must equal this canonical compilation. |
| `method` | `static`, `scenario`, or `physical`. |
| `setupRef` | External record of checker/runtime/target revisions, inputs, initial state, settings and verification scope. Retained without dereferencing. |
| `run` | Required for scenario/physical, forbidden for static: `{ id, scanId, logicalTimeMs }`. Scan/time are nonnegative safe integers. |
| `device` | Required only for physical and `device-compliance`: `{ id, installationRef, commandRef, observationRef, clockRef, stage, quality }`. |

Device `stage` is `requested`, `safe`, `applied`, `readback`, or `confirmed`; `quality` is `ok`, `unknown`, or `fault`. These are reported evidence stages. An ACK or a caller's `satisfied` result does not become physical proof. A check's run/time/device fields are retained and shape-checked; this compiler has no trusted current runtime sample to join against. Consumers must validate those identities and evidence at their observation boundary. Contradictory external claims remain visible as reported claims, not newly certified judgments.

## Reading the result

`validation` reports successful structure/source/link consistency. `decisions` preserves each decision classification and confirmation scope, with `authority: not-authenticated`. `conditions` lists node/check IDs and `recorded`, `outside-confirmed-scope`, `policy-not-current`, `unconfirmed`, or `undecided` confirmation state. `coverage` lists unrepresented anchors and unlinked conditions.

`externalChecks` exposes `reportedResult` with `trust: external-report`. All four `judgments` remain `not-evaluated`: the metadata checker does not itself perform intent, requirement, program or device judgment. It makes the necessary records available to their actual owners. No overall intent-compliant Boolean is produced. The report includes the detached validated `record`, its `recordSha256`, source digest and bytecode digest.

## Runnable authoring example

Run the following JavaScript from the repository root with Node's module input mode. It uses the existing fictional pump fixture; the confirmation below is example data, not an actual operating approval. The second condition deliberately remains outside confirmation scope.

```js
import fs from 'node:fs';
import { compileSource, intentInterpretationDigest, intentConditionDigest } from './tools/toolchain.mjs';
const filename = 'examples/authoring/pump-rev-2.ghost.md';
const source = fs.readFileSync(filename, 'utf8');
const base = await compileSource(source, { filename });
const interpretation = {
  id: 'I-PERMIT', revision: 'r1',
  original: { id: 'U-PERMIT', revision: 'r1', reference: 'example:fictional-request' },
  text: 'Block the pump when permission is absent.',
  anchorIds: ['GF-INT-PUMP-PERMIT'],
};
const condition = {
  id: 'C-PERMIT', revision: 'r1', interpretation: { id: 'I-PERMIT', revision: 'r1' },
  statement: 'Safe pump intent is OFF when permission is false.',
  scope: 'Logical accepted scans only; no physical stopping deadline.',
  nodeIds: base.traceMetadata.intentLinks.filter(x => x.anchorId === 'GF-INT-PUMP-PERMIT' && x.relation === 'constrains').map(x => x.nodeId),
};
interpretation.decision = {
  kind: 'confirmed', actor: 'fictional-operator', authorityRef: 'example:authority',
  recordRef: 'example:confirmation', at: '2026-10-19T00:00:00Z',
  interpretationSha256: intentInterpretationDigest(interpretation),
  conditions: [{ id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) }],
};
const evidence = {
  format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: base.sourceDocument.sha256,
  interpretations: [interpretation],
  conditions: [condition, { ...condition, id: 'C-RESTART', statement: 'Restart behavior is not confirmed.', nodeIds: [] }],
  checks: [],
};
const result = await compileSource(source, { filename, intentEvidence: evidence });
console.log(result.intentEvidence.conditions);
fs.mkdirSync('build/intent-evidence', { recursive: true });
fs.writeFileSync('build/intent-evidence/record.json', JSON.stringify(evidence, null, 2));
```

Expected states are `C-PERMIT: recorded` and `C-RESTART: outside-confirmed-scope`. No scenario has been run; `checks` is empty. In a structured CLI request, add the optional file path:

```toon
format: GhostFlow/cli-request-v1
operation: check
source:
  path: examples/authoring/pump-rev-2.ghost.md
  documentId: GF-EXAMPLE-PUMP
  revisionId: rev-2-input-v1
intentEvidencePath: build/intent-evidence/record.json
```

Save that request as `build/intent-evidence/request.toon` and run `node tools/ghostc.mjs --request build/intent-evidence/request.toon --format json`. The CLI returns the report in `intentEvidence`; the default output format is TOON. For `operation: compile`, also supply `artifactPath`. Missing/malformed/oversized evidence files and inconsistent records produce nonzero exit with `GF_INTENT_EVIDENCE`; existing artifact files are not replaced.

## Persistence and supported boundary

`writeArtifact` stores the validated record in the optional `intentEvidence` field of the standalone `.map.json` companion. `restoreArtifactSourceMap` recompiles the canonical source, validates the record and returns a freshly derived report. It does not trust a saved verdict. Callers requiring a specific record pass `expectedIntentEvidenceSha256: report.recordSha256` alongside `expectedSourceSha256`; a missing or altered record is then rejected. Without an expected digest, absence remains compatible with ordinary artifacts that carry no record. An unsigned map and hashes do not authenticate authorship or prevent coordinated replacement.

`portable-package-v1` has a separate strict, signed source-map profile. It does not transport this external authoring record. Its builder explicitly rejects evidence-bearing compilations with `unsupported-intent-evidence`, preventing silent loss. Keep the external record and deliberately compile without the option when using that package profile. This implementation does not change the signed package format, firmware, runtime, approval service or deployment policy. Future transport through a signed package must retain the same evidence boundaries and define consumer compatibility explicitly.

The executable regression suite is `tests/intent-evidence.test.mjs`, registered in full verification and coverage. It covers partial decisions, revision mismatch with unchanged GFB, invalid links, external/physical claim limits, browser operation, persistence and CLI artifact preservation. Existing anchor/CLI and package tests continue to cover the surrounding contracts.
