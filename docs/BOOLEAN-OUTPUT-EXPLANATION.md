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
and owns its immutable artifact. This program-provenance replay also accepts an
already admitted compact-profile source without its external hardware profiles.
It reconstructs the sidecar and source metadata from exact bytes. It does not
admit a hardware installation. Public compilation still requires the pinned
profiles. Public `evaluations` identify both semantic
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

## Composed controls and the settings owner

`TemporarySettingsHost.instantiate(wasm, compilation, { runId, grants, context,
outputExplanations: true })` enables capture before framed activation. The default
keeps capture disabled. A legacy host, missing Interaction Schema, unsupported
WASM witness ABI, or capture budget overflow rejects the opt-in before a run.
`ControlRuntime.instantiateFramed` also accepts `instructionWitnesses: true` for
hosts that own their own proof projection.

The settings owner projects its actual accepted `outcome.vm` and `outcome.frame`
after committing the scan and settings event. Each returned `result.explanation`
contains `proofs` and `error`. Pass that same result to `joinOutputExplanation`.
No wrapper around a retained outcome is needed. `explanationSnapshot()` returns
an owned copy of the latest projection, and `explanationDescriptor` returns an
owned copy of its verified compiler descriptor. Queries do not tick the runtime.

Composed Bool state expressions retain the existing evaluated-path rules. State
labels use authored instance paths such as `east.running` and `west.running`.
The compiler resolves these paths through the source map's `instance` and
`definitionNodeId`, then the canonical closure's declaration. It never decodes
generated storage names. The state source includes its instance, expanded node
ID, original definition node ID, imported filename, revision, SHA-256, and
declaration span. Identical imported definitions have distinct instance evidence.
Compound expressions and literals retain an explicit `output-connection` source
role when their exact imported expression span is unavailable. That role points
to the root output connection and does not claim an imported expression span.
Each composed occurrence and evaluation retains its own source record. Identical
literals can share a semantic node without borrowing another output's provenance.

Proofs carry the snapshot's exact composition and committed `settingsRevision`.
The producer verifies the host's run, completion, retained committed outcome,
and Rust settings-revision observations. Consumers reject a different closure,
run, completed scan, settings revision, or instruction path. An attempted scan
clears the latest explanation before admission. A failed attempt leaves no new
proof, even when the runtime retains its prior completed outcome. Projection
failure after commit returns `completed-scan-explanation-failed` with an empty
proof list while the control result remains accepted. The committed settings
event cannot be retried. The next successful scan can publish a new explanation.

`tests/composed-explanation.test.mjs` exercises the actual WASM settings owner,
including east/west states with different values, short-circuit omission,
settings edits, rejected identities, caller mutation, and post-commit failure.

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
safety, Result/recovery and transition proof kinds remain explicit
unsupported scope. In particular quality-bearing public inputs do not acquire
fabricated Result proofs. Issue88 remains open for those integrations, richer
provenance and full public package/host lifecycle handling. Composed config and
timer expressions that depend on generated rails remain explicitly unavailable.
[Issue290](https://github.com/callin2/ghostflow-language/issues/290) and
[issue302](https://github.com/callin2/ghostflow-language/issues/302) retain
installation/binding identity and the broader composed expression profile.

The exact native/WASM acceptance selector is registered in the feature catalog:
`REF-05-023 native/WASM requested OFF explanation keeps the false left support and the skipped faulting right unevaluated`
in `tests/explanation-path.test.mjs`. The canonical fixture is
`tests/fixtures/explanation-short-circuit.ghost.md`; its zero divisor is state,
so the compiler accepts it and the real VM determines whether it is evaluated.
