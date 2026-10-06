# Boolean requested-output explanation

This is the bounded [issue283](https://github.com/callin2/ghostflow-language/issues/283)
acceptance slice of [issue88](https://github.com/callin2/ghostflow-language/issues/88),
implementing Reference 5.3's evaluated-path support contract. It explains a
requested Boolean result from one completed scan. It does not claim that the
safe, applied or physically confirmed output has the same value.

## Compiler artifact and execution

Canonical compilation emits `explanationArtifact` beside unchanged GFB bytes.
The sidecar binds source and bytecode SHA-256, opaque semantic node IDs,
existing source nodes/spans and intent links, and instruction completion exits
from the same typed IR and byte writer used by the compiler. Branch-local exits
are relocated when embedded. An AND/OR node has exits for its actual paths;
implicit short-circuit literals are not source children. Shared semantic nodes
have one descriptor, with distinct execution occurrences for each parent/output.

`Runtime::enable_instruction_witnesses()` enables optional capture before a new
run. The framed WASM adapter exposes `enableInstructionWitnesses()` between
`load()` and `activate()`. The native test runner accepts a final
`--instruction-witnesses` argument. The VM captures the instruction's actual
start, sequential end, next PC and stack result after execution. Merely landing
at a skipped expression's end is not evidence. No new expression opcode or
second evaluator is introduced. Ordinary execution keeps capture disabled.

Evidence is attached to the TickRecord only after the scan completes. Partial
steps die with a failed evaluation; rejected framed attempts retain the previous
outcome as history, with `accepted=false`, and cannot produce a new proof.
Install clears capture configuration. Observation neither ticks nor reads live
state and never evaluates skipped branches.

## Public projection and joins

```js
import { prepareOutputExplanation, joinOutputExplanation } from '../tools/toolchain.mjs';
const producer = prepareOutputExplanation({ compilation, runId });
const proof = producer.emit({ runId, result: { accepted: true, outcome }, outputId: 'output.pump' });
const join = joinOutputExplanation(compilation.interactionSchema, proof, snapshot, producer.expected, producer.descriptor, { accepted: true, outcome });
```

Preparation recompiles the canonical source to verify every mapping and bound,
and owns its immutable artifact. Public `evaluations` identify both semantic
node and execution occurrence. `evaluated`, actual `value`, `status`, and
output-path `supportsResult` are distinct. A skipped occurrence is unavailable,
has no actual value and never supports the result, even when another output
evaluated the same semantic node. `edges` carry parent-relative support.

AND supports evaluated children with the parent's Boolean value. OR does the
same. NOT supports its evaluated operand. Predicates and numeric operations
retain their evaluated operands, including zero. Conditional nodes retain the
evaluated condition and selected arm. Output-path support follows only
supporting edges from the root; this is structural proof, not counterfactual
causality. A runtime fault rejects the scan rather than becoming Boolean false
or a completed error proof. Disabled capture and unsupported kinds are explicit
unavailable results, independent of the actual requested output's false value.

The proof reuses Interaction schema/module/source/run identity and completed
scan/time fields. Consumers join those fields against the output snapshot and
their expected run. An old run's scan zero is stale. The join also requires a
fresh accepted output sample at the consumer boundary too; the Language library
checks the entire proof payload against that sample's actual instruction witnesses.
Producers accept only a
fresh framed run (`trace.tick = scanId + 1`) and an accepted outcome. The trusted
host adapter supplies the run epoch and scan logical time; this does not
authenticate arbitrary caller-created JSON or permit relabeling historical
outcomes. The caller must discard the producer when its run restarts.

## Bounds and remaining scope

The sidecar allows at most 512 semantic/occurrence nodes, 1024 edges and depth
64. Unsupported or oversized outputs explicitly report unavailable. Runtime
capture requires the sum of each strategy's intent expression byte lengths to
fit 8192, which conservatively bounds instructions, and rejects before execution
if enabling cannot fit. It reserves at most that many instruction records per
scan; the existing configured journal capacity bounds retention. This optional
diagnostic mode is not an MCU deployment profile. Disabled mode allocates no
instruction records. Hosts must provision journal memory for enabled capture.

Supported expressions include Bool literals/state snapshots, NOT, AND, OR,
predicates, arithmetic/conversions, and conditionals. Candidate state is an
observed scalar, not an explanation of its transition. Timer, schedule,
composition, safety, Result/recovery and transition proof kinds remain explicit
unsupported scope. In particular quality-bearing public inputs do not acquire
fabricated Result proofs. Issue88 remains open for those integrations, richer
provenance and full public package/host lifecycle handling.

The exact native/WASM acceptance selector is registered in the feature catalog:
`REF-05-023 native/WASM requested OFF explanation keeps the false left support and the skipped faulting right unevaluated`
in `tests/explanation-path.test.mjs`. The canonical fixture is
`tests/fixtures/explanation-short-circuit.ghost.md`; its zero divisor is state,
so the compiler accepts it and the real VM determines whether it is evaluated.
