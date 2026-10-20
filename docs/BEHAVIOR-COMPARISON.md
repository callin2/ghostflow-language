# Bounded behavior comparison

[한국어](BEHAVIOR-COMPARISON.ko.md) · [Intent responsibility contract](INTENT-CONSISTENCY-CONTRACT.en.md) · [#560](https://github.com/callin2/ghostflow-language/issues/560)

`compareBehavior(request)` in `tools/behavior-comparison.mjs` compiles two canonical `.ghost.md` sources and runs the same frozen `GhostFlow/scenario-v1` once from each source's canonical initial state. It uses the existing `ghostsim` Rust native or WASM runner. The caller chooses the observations, exact scan/time scope, and optional expected changes. The result reports actual virtual requested/safe intents, state and faults for that scope. It does not infer farmer intent, operate a live device, or establish physical effects.

## Request and API

The public request is a JSON-compatible object:

| Field | Contract |
|---|---|
| `format` | `GhostFlow/behavior-comparison-request-v1` |
| `baseline`, `candidate` | `{ filename, source }` where `filename` ends in `.ghost.md`, with optional compiler `sourceClosure` and `intentEvidence` from [intent evidence](INTENT-EVIDENCE.md). Both sources are captured before any asynchronous work. |
| `scenario` | One complete `GhostFlow/scenario-v1` object, including initial inputs and ordered actions. The identical captured scenario is validated against both manifests and executed independently. `plant` is rejected because output-dependent feedback can produce different next inputs. Sensor conditioning changes under identical supplied samples remain observable behavior. |
| `observations` | Nonempty list (at most 32) of `{ field, name }` for `requested`, `safe`, `stateBefore`, or `stateAfter`; `{ field: 'faults' }` selects the complete fault list. Named fields must exist in both compiled programs' output manifests or state trace bindings. Only listed observations appear in the comparison. |
| `scope` | `{ from: { scanId, logicalTimeMs }, to: { scanId, logicalTimeMs } }`. Both endpoints must match executed scans exactly. Observations include both endpoints. |
| `assertions` | Optional list (at most 64) of caller-supplied predicates below. Omitting it returns an observed comparison without an expected-change judgment. |

Use `const report = await compareBehavior(request)`. The API throws on invalid source, metadata, scenario, observation or request shape. A run that starts but cannot complete returns `outcome: 'incomplete'`, side-specific errors and available partial observations; **every assertion is `unknown`**. A completed comparison reports per-scan values and `equal`, plus changed/unchanged counts only inside the selected scope. No output is treated as an installation command. The result's `physicalEffects` is always `false`.

The result binds the full request, scenario, canonical source documents, GFB bytes, manifests, optional source closures and optional intent evidence by SHA-256. It also records the selected runtime/host paths and hashes, and the Node version when using the WASM host. These are execution identities, not signatures. The initial state is the state declared in each canonical source; a change to initial state is part of the program difference.

### Optional predicates

Every assertion has a unique `id`, `kind` and an `observation` already listed in `observations`:

| Kind | Additional fields | Evaluation |
|---|---|---|
| `unchanged` | none | The selected value equals across programs at every scan inside `scope`. |
| `equals` | `side: 'baseline'\|'candidate'`, exact `at: { scanId, logicalTimeMs }`, `expected` JSON value | The named side's actual value at that scan equals the supplied value. |
| `bool-on-duration-delta` | `expectedDeltaMs` safe integer | `candidateMs - baselineMs` equals the supplied delta. Counts only true Bool segments `[scan_i, scan_(i+1))` between the exact scope endpoints. The final scan is an endpoint, never extrapolated. |

An assertion may add `evidence: { side, condition: { id, revision, sha256 } }`. The reference must match that side's supplied `intentEvidence` condition, including `intentConditionDigest(condition)`. The report retains the condition's confirmation scope and `authority: 'not-authenticated'`. Without this link it says `evidenceBinding: 'unlinked'`. `satisfied` means only that the supplied predicate held for the observed scan scope; it does not mean the interpretation was confirmed, the condition was an independent oracle, or the change fits the user's intent. The complete assertion specification and its digest remain in the report so the expected value cannot disappear from a success claim.

## Runnable example

Run this from the repository root after the existing scenario runner artifacts are available:

```js
import { compareBehavior } from './tools/behavior-comparison.mjs';

const program = seconds => `\`\`\`ghost
control Timer {
  state active: Bool = true;
  timer age = elapsed(active);
  output expired: Bool;
  output drive: Percent;
  expired <- age >= ${seconds}s;
  drive <- 0%;
}
\`\`\`\n`;
const at = (scanId, logicalTimeMs) => ({ scanId, logicalTimeMs });
const request = {
  format: 'GhostFlow/behavior-comparison-request-v1',
  baseline: { filename: 'timer-10.ghost.md', source: program(10) },
  candidate: { filename: 'timer-15.ghost.md', source: program(15) },
  scenario: {
    format: 'GhostFlow/scenario-v1', id: 'timer', initialInputs: [], keyBindings: [],
    actuatorBindings: [{ actuator: 'drive', output: 'drive', type: 'Percent', min: 0, max: 100 }],
    actions: [0, 10000, 15000, 20000].map(atMs => ({ kind: 'scan', atMs })),
  },
  observations: [{ field: 'safe', name: 'expired' }],
  scope: { from: at(0, 0), to: at(3, 20000) },
  assertions: [
    { id: 'delay', kind: 'bool-on-duration-delta',
      observation: { field: 'safe', name: 'expired' }, expectedDeltaMs: -5000 },
  ],
};
const report = await compareBehavior(request);
console.log(report.outcome, report.assertions);
```

The example's `drive` binding selects the existing WASM scenario host. Its values are virtual and carry no physical actuator claim. The expected delta is supplied independently by this example, not generated from either program.

For a structured CLI call, serialize the same request as JSON or TOON, then run `node tools/ghostcompare.mjs --request comparison.json --format json`. Default output is TOON; `--format toon` is also accepted. A completed comparison exits 0, while rejected or incomplete results exit 1. The CLI reads at most 3 MiB of request bytes, and the captured scenario is limited to 256 KiB. The result is capped at 1 MiB; exceeding it yields an incomplete result with unknown assertions. The API and CLI do not accept JavaScript callbacks in the request.
