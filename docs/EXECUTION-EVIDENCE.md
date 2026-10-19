# Explain one completed execution

`tools/execution-evidence.mjs` exports `explainExecution(request)`, a pure projection of one caller-supplied accepted scan. `node tools/ghostwhy.mjs --request request.json --format json` exposes the same result from JSON or TOON; TOON output is the default. This contract implements [#563](https://github.com/callin2/ghostflow-language/issues/563) on the shared [#565](https://github.com/callin2/ghostflow-language/issues/565) contract. The [Korean version](EXECUTION-EVIDENCE.ko.md) has the same content.

The API recompiles the canonical `.ghost.md` source with its explicit document and revision IDs. It reuses the compiler's output explanation, completed-scan snapshot, and exact proof/snapshot join. It never runs a new evaluator or contacts a device. The accepted scan result is still supplied by the caller: the runtime outcome has no native run ID, so `runId` is a caller assertion checked consistently across the generated proof and snapshot. This does not authenticate the runtime producer. Existing explanation supports limited Boolean requested-output paths. Unsupported kinds and disabled instruction witnesses remain `unavailable`; skipped nodes remain `not-evaluated`. A composed source may be supplied through `sourceClosure`, but the existing explanation producer rejects composed artifacts because it has no output strategies to project. The API never reads imports from disk.

## Request

The top-level object has exact `schema: "GhostFlow/execution-evidence-request-v1"`, `source`, `runId`, `outputId`, and `result`. Optional fields are `sourceClosure`, `intentEvidence`, `expectedDevice`, and `deviceEvidence`.

| Field | Contract |
| --- | --- |
| `source` | `{ text, filename, documentId, revisionId }` for the complete canonical literate source. `text` is at most 262,144 characters. |
| `sourceClosure` | Optional bounded array of `{ filename, revision, text }` objects passed to the compiler; no file lookup. |
| `runId` | Public execution epoch, subject to the existing snapshot validator. |
| `outputId` | Exact requested output ID, for example `output.pump`. |
| `result` | One caller-supplied `{ accepted: true, outcome }` from a completed scan, including its trace and instruction witnesses when available. The existing explanation/snapshot validators check module, source, completion, output and witness path. |
| `intentEvidence` | Optional complete `GhostFlow/intent-evidence-v1` record validated and bound by the compiler. Its original interpretations, conditions, decisions and external checks remain supplied records. |
| `expectedDevice` | Required with `deviceEvidence`: `{ deviceId, bootId, installationRef, clockRef, requestId }`. These expected identifiers come from the caller separately from the evidence bundle. |
| `deviceEvidence` | Optional `{ identity, records }` as below. |

`deviceEvidence.identity` requires `sourceDocumentId`, `sourceRevisionId`, `sourceSha256`, `bytecodeSha256`, `runId`, `scanId`, `logicalTimeMs`, `outputId`, `deviceId`, `bootId`, `installationRef`, `clockRef`, and `requestId`. The first eight are checked against the compiled source and accepted scan; the last five against `expectedDevice`. Every stage in the bundle shares this envelope identity **as asserted by its producer**. A mismatch leaves the complete bundle `unlinked` with identity diagnostics; no stage contributes a device conclusion.

`records` is an array of at most 128 records. Every record requires `kind`, `id`, `requestId`, canonical UTC millisecond `at`, and opaque `ref`:

| Kind | Additional fields | Meaning |
| --- | --- | --- |
| `driver-request` | `stage: "requested" | "safe"`, Boolean or finite numeric `value` | Must use the envelope request ID for `id` and `requestId`. Its value must equal the selected stage's actual output value. |
| `ack` | `outcome: "accepted" | "rejected" | "fault" | "unknown"` | An ACK refers to the exact driver request ID. Acceptance is a reported command outcome, never physical confirmation. |
| `register-readback` | `quality: "ok" | "fault" | "unknown"`, and `value` only for `ok` | A supplied register observation. |
| `physical-feedback` | The same quality/value rule | A supplied physical observation, not independently verified here. |

One record of each kind is allowed for one request. Missing stages are listed independently. Distinct IDs at one stage, duplicate records, orphan references, wrong request ID, a stage value different from the accepted scan, a reported value differing from the request, and a report timestamp before the driver request are diagnostics. Records are retained for review; there is no latest-wins selection and no join by timestamp proximity. Timestamps are checked only for canonical format and impossible sequence within the supplied clock reference. The API does not verify clock accuracy, device authority, signatures, transport or physical effect.

## Result

Success has `schema: "GhostFlow/execution-evidence-result-v1"` and `outcome: "completed"`. It includes exact source document/revision/bytecode identity, scan completion, `requestSha256`, and:

- `requested.value`, `requested.proof`, and `requested.descriptor`: the actual requested value, bounded evaluated/skipped proof, and canonical node/source/anchor mappings. An evaluated node's `supportsResult` describes only the requested Boolean proof path.
- `safe.value`: the same accepted scan's safe output, checked against the declared output type and kept separate from requested intent. It does not assert renderer application.
- `authored`: compiler-validated original interpretations and conditions, confirmation scope, external checks, and each condition's authored-node relation to this requested proof. `supports-requested-result` means a linked authored node supports the runtime expression result; it does **not** prove that the interpretation or requirement is correct. `not-evaluated` remains explicit. Intent-fit, compliance and device judgments remain `not-evaluated`.
- `device`: original caller-supplied envelope and records, `not-authenticated` trust, and diagnostics. Its status is `not-supplied`, `unlinked`, `linked-external-report`, or `conflicted`. Even a complete linked bundle stays an external report, not a physical success or compliance verdict.

Malformed input or invalid compiler/proof joins raise an error; the CLI emits `outcome: "rejected"` and exits 1. A complete request is capped at 524,288 serialized UTF-8 bytes, depth 24, and 128 device records. Output is capped at 524,288 bytes. If expansion exceeds that bound, the API returns `outcome: "incomplete"` with an `output-limit` diagnostic and no partial evidence; the CLI exits 1. Inputs are copied before compilation and results do not alias caller objects.

Run the executable fictional regression, including a real local WASM scan and JSON/TOON parity, with:

```sh
node --test tests/execution-evidence.test.mjs
```

The test device IDs and reports are invented. The local WASM scan checks host behavior only; it is not a Device installation, hardware observation, or farmer acceptance result.
