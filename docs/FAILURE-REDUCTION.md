# Bounded failure reduction

[한국어](FAILURE-REDUCTION.ko.md) · [Intent responsibility contract](INTENT-CONSISTENCY-CONTRACT.en.md) · [#561](https://github.com/callin2/ghostflow-language/issues/561)

`reduceFailure(request)` in `tools/failure-reduction.mjs` shrinks a failing `GhostFlow/scenario-v1` for one canonical `.ghost.md` program. The caller supplies the expected value and its requirement revision. The tool does not derive an oracle from the program, infer intent, identify a root cause, or operate a physical device. Each candidate runs through the existing `ghostsim` Rust native or WASM scenario path from the program's canonical initial state.

## Request

| Field | Contract |
|---|---|
| `format` | `GhostFlow/failure-reduction-request-v1` |
| `program` | `{ filename, source }`, optionally `sourceClosure` and the exact #565 `intentEvidence` record. `filename` must end in `.ghost.md`. |
| `scenario` | A complete `GhostFlow/scenario-v1` with initial inputs, environment profiles and ordered actions. A closed-loop `plant` is excluded because removing an action can alter later effective inputs. |
| `predicate` | `{ kind: 'equals', observation, expected, at, when? }`. `observation` is `{ field, name }` for `requested`, `safe`, `stateBefore` or `stateAfter`, or `{ field: 'faults' }` for the whole fault list. `at` is `{ actionIndex, logicalTimeMs }` and must identify one original scan action with that exact time. The failure is the actual value **not equaling** `expected` at that scan. Optional `when` is a nonempty array of at most eight `{ observation, expected }` equality guards evaluated at that same scan. |
| `requirement` | External `{ id, revision, sha256, reference }`. This identifies the caller's expectation revision. The compiler retains it without fetching or authenticating it. |
| `condition` | Optional `{ id, revision, sha256 }` of an exact #565 condition in `program.intentEvidence`. Its confirmation scope is retained; authority stays `not-authenticated`. |
| `maxAttempts` | Integer 1..128. Counts every considered single-action deletion, including candidates rejected by scenario validation. The original confirming run is separate and does not consume this budget. |

Unknown fields and invalid source, scenario, field, condition identity, budget or action/time identity are rejected. The request is captured as canonical JSON before the first asynchronous compile, with a 3 MiB limit. Scenario bytes are capped at 256 KiB. The CLI accepts the same request as JSON or TOON; it does not accept callbacks or instructions to execute external code.

## Search and result

The metric is **action count**. The target scan action remains; no other action is protected. The reducer tries deleting one action in original order. A deletion is accepted only when the candidate validates, a fresh scenario run completes, every supplied `when` guard equals its expected value, and the target observation still violates the same fixed expected value. All observations use the preserved target scan, even if its scan ID changes. On acceptance it restarts scanning the shorter sequence from the beginning. It never rewrites action times, values, order, environment or initial inputs. The target's new scan ID is recalculated after each deletion and the report maps each retained original scan action index to its new scan ID.

The caller must state any condition needed to identify the same failure. For example, to reduce “pump stays ON during a Disconnected sensor fault,” the source can expose a Boolean that is true specifically for `Disconnected`, and `when` can require that Boolean to be true while the main predicate expects the pump to be OFF. A guard for *any* sensor fault would also match `NotReady` and would express a different scope. The tool does not infer or authenticate these guards. The full fixed predicate, including guards, is retained and hashed in the result. With no `when`, only the main equality violation is required.

`outcome: 'reproduced'` includes a runnable `reducedScenario`, original and reduced scenario hashes, source/GFB/manifest/optional closure hashes, selected runtime and host hashes, Node version for WASM, the fixed predicate and its digest, requirement identity, condition binding, original and reduced observations, attempts and deletion history. `sourceBinding` gives the compiler node and source location associated with a named observation. It is an observed violation location, not a cause or repair location. `physicalEffects` is always `false`.

`reductionStatus: 'single-deletion-minimal'` means an exhaustive final pass found no one-action deletion that validated, completed and kept the same violation. It does **not** claim a globally shortest scenario. The observed value may change as long as it still violates the same fixed predicate. `budget-exhausted` means the candidate limit stopped the search; `unresolved-candidates` means a final-pass candidate had missing observation or execution failure, so minimality is not claimed. Invalid candidates are recorded but cannot reproduce the failure.

If a guard does not hold in the original run, the result is `original-not-applicable`; no reduction starts. If the guards hold but the original run completes with the expected main value, the result is `original-not-failing`. If the original run or any selected observation is unavailable, the result is `incomplete`, never a reproduced failure. A candidate with a false guard is rejected; a missing guard observation or runtime/host failure is an `unknown` attempt and cannot be accepted or prove minimality. A changed runtime or host hash ends the reduction as incomplete. Result output is capped at 1 MiB; overflow is explicitly incomplete.

## Runnable example

Run from the repository root with the existing scenario runner artifacts installed:

```js
import { createHash } from 'node:crypto';
import { reduceFailure } from './tools/failure-reduction.mjs';

const source = `\`\`\`ghost
control Timer {
  state active: Bool = true;
  timer age = elapsed(active);
  output expired: Bool;
  output drive: Percent;
  expired <- age >= 10s;
  drive <- 0%;
}
\`\`\`\n`;
const request = {
  format: 'GhostFlow/failure-reduction-request-v1',
  program: { filename: 'timer.ghost.md', source },
  scenario: {
    format: 'GhostFlow/scenario-v1', id: 'timer-failure', initialInputs: [], keyBindings: [],
    actuatorBindings: [{ actuator: 'drive', output: 'drive', type: 'Percent', min: 0, max: 100 }],
    actions: [0, 1000, 5000, 10000, 15000].map(atMs => ({ kind: 'scan', atMs })),
  },
  predicate: { kind: 'equals', observation: { field: 'safe', name: 'expired' },
    expected: false, at: { actionIndex: 4, logicalTimeMs: 15000 } },
  requirement: { id: 'REQ-LIMIT', revision: 'r1',
    sha256: createHash('sha256').update('external requirement revision r1').digest('hex'),
    reference: 'example:requirements/REQ-LIMIT/r1' },
  maxAttempts: 32,
};
const result = await reduceFailure(request);
console.log(result.outcome, result.reductionStatus, result.reducedScenario?.actions);
```

The `drive` virtual actuator binding selects the existing WASM scenario host for this example. The requirement reference is fictional. A reported predicate violation only means this supplied expectation disagreed with this executed virtual observation; it does not certify the expectation or diagnose the source of the discrepancy.

Save the same request as JSON or TOON and run `node tools/ghostshrink.mjs --request reduction.json --format json`. Default output is TOON. A reproduced result exits 0; invalid, original-not-applicable, original-not-failing and incomplete results exit 1. The returned `reducedScenario` can be serialized as TOON and replayed with the existing scenario runner and the same compiled program.
