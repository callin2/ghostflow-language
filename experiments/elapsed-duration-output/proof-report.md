# Source-bound elapsed Duration output

This unit covers [compiler correctness #590](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6483394125).
It adds the actual `age_ms <- age` expression to the existing epoch fixture. The
canonical fixture SHA-256 is `564f1aeb1a85f4b29a4cd1d302e695e9d88c728ff337c9201ed86e450823f820`.

`DurationMachine.step` adds only opcode20 with Nat subtraction. Every other opcode
delegates to unchanged `EpochMachine.step`, with a conservativity theorem for
non20 instructions. No existing numeric interface, epoch model or clock theorem
is changed. Existing `EpochMachine.rawTrace` still executes all state transitions
and the Bool candidate output.

The output-only `runValue` adapter has `code.length + 1` fuel. It requires the exact
terminal PC, one final Value, and at most 128 stack entries after every step. It
returns `none` on exhausted fuel, wrong final stack or a failed instruction. These
are adapter semantics, not a proof of the actual Rust VM's execution or scan commit.

`duration_execution` proves that the actual seventeen-byte output code returns
`ElapsedClockBounds.expressionAge before input` and preserves its incoming event
trace. The candidate list is arbitrary because this expression reads the old
timer slots. `output_trace` consumes the existing epoch observation list and proves
the output projection. It introduces no new reset state machine. The source-trace
output-existence theorem ensures the complete admitted history has observations.

`DurationSource` reuses the existing lexer, envelope, state/recovery/connection
parsers and timer declaration parser. Its additional suffix accepts exactly one
Duration output and a connection to the declared timer. It checks unique authored
names and the independent node IDs. `DurationModule` reuses the existing header,
state and transition readers, consumes the complete two-output capability query,
both typed outputs, constraints count, and all remaining bytes.

The certificate independently binds the inherited sensor/result/timer metadata,
both logical output types, both connection bindings, and their requested dependency
reads. This is an exact projection of those fields. It does not certify every
source-map location or unrelated metadata field. Full-module admission does not
mean the real Rust loader has been formally proved.

`original_duration_trace` combines source admission, actual complete GFB code
binding, metadata binding, the existing all-histories epoch theorem and existing
clock bounds. `AcceptedFrom 0 inputs` supplies nonnegative integer, nondecreasing
clocks at most `2^53 - 1`. This is a modeled admission premise, not a theorem about
the public JS/Rust validators. The returned old and new epochs retain the existing
range theorem. The actual Duration output is the mathematical old-epoch difference,
including on the state-change scan.

The Nat opcode20 model uses saturating subtraction outside the admitted domain.
On the claimed histories, the existing `since <= now` invariant excludes that
underflow case. No correspondence to production `f64` subtraction, floating literal
representation, hardware, scheduling or the physical three-second relay sequence
is claimed. Exactly representable clock values do not themselves prove that bridge.
An operand-reversal mutant can leave the canonical operand domain even when its
clock history is admitted. Its concrete Nat result is a model counterexample,
not a numeric-refinement claim about the modified Rust execution.

## Verification

```sh
node experiments/elapsed-duration-output/verify.mjs --lean /absolute/path/to/lean --evidence-dir build/elapsed-duration-output/proof
node --test tests/elapsed-duration-output.test.mjs
```

The verifier compiles all dependency models in a fresh directory with Lean 4.19.0.
It saves the exact generated input, full output log, exit status, signal, input/log
hashes and compiled-model hashes. A single process has a 180-second limit. Timeout,
import errors, proof escapes and other infrastructure failures cannot count as
expected proposition rejection. The common outcome classifier is reused.

Mutation controls first parse the complete mutated module and prove its concrete
wrong output in the Nat model. Only then does the unchanged source-output equality
have to fail at its exact target line. These are model-semantic counterexamples.
Their structural and Nat execution proofs do not establish actual Rust loader
or typed-control-flow admission. No jump-into-operand mutation is presented as a
runtime semantic counterexample. Separate source, capability, metadata and trailing
byte changes test certificate rejection.

The receipt changes atomically to `running` before the first external probe or
provenance read. Failures replace stale success with `failed`. Source identity
covers all imported models and bridges, compiler files, the original fixture,
the shared classifier, tests, clock owner files and lock file, and is compared
again before success. Runtime observations belong to the separate integration
worker and are not counted as kernel proof here.

`check-models.mjs` is a development-only alternative when recompiling the imported
models is unnecessary. It validates all 116 unchanged base source hashes, the
pinned Lean executable hash, and each reused dependency's source, log and object
hash before fresh compilation of the three new models. Its receipt explicitly
says `dependencyReuse: true`. The final verifier uses fresh dependency compilation.

Development failures are retained. The first fresh run rejected an ambiguous
`Parser` name. Namespace qualification and a local binding rename resolved the
parser elaboration errors. Two manual development commands used the wrong input
root or copy working directory; neither counted as a proof result. The repeatable
model-check command now copies sources into its exact Lean root and validates
dependencies first. The initial Markdown provenance link was outside the inherited
bounded envelope. Its original-source certificate failed; the fixture now uses
the already-supported `Source: URL` prose form. The executable code did not change.

## Recorded execution

The final fresh run passed 52 invocations, with 40 successes and 12 expected
proposition rejections. It freshly compiled 18 unchanged imported modules and
three new modules. The remaining checks cover four actual source/module
certificates, eight concrete histories, six successful concrete mutant model
runs followed by six semantic rejections, and seven certificate controls.
The new models add five general theorems. Invocation counts are not counts of
new independent compiler theorems.

The receipt is `build/elapsed-duration-output/attempt-2/verification.json`, SHA-256
`079abf6d5556ec49db889e09e0aa480729ee96797cafef78d311d6981598a06b`.
It completed at `2026-10-28T23:53:49.716Z`. Its source identity is
`118aff3ecf351735799c5b0ab0d25573b5ea08b2700ca2813a03b4f10f4f04f7`.
This final run reused no dependency objects. The four focused Node tests passed
after the fixture correction. `evidence-summary.json` records hashes of the
preserved failures and separately labels the earlier dependency-reuse development
checks. Debug-only `#eval` output is not counted as a kernel theorem or a passed
admission result. Runtime replay remains separate evidence owned by integration.
