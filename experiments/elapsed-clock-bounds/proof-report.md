# Accepted clock bounds for the source-bound elapsed epoch history

This unit belongs to [compiler correctness #590](https://github.com/callin2/ghostflow-language/issues/590#issuecomment-6482980280).
It proves clock and mathematical difference bounds over the existing elapsed epoch
execution relation. It imports `EpochMachine` and `EpochModule` unchanged. It does
not introduce a second reset machine or a numeric bytecode interpreter.

`AcceptedFrom previous inputs` states that each `Input Nat` clock is at least the
preceding accepted clock and at most `9007199254740991`, or `2^53 - 1`. Equal clock
values are allowed. Nonnegativity and integrality come from `Nat`. This predicate
models the clock admission contract. No theorem here proves that the public
JavaScript or Rust admission code refines this predicate.

`ScanBounds` describes the same before epoch, input and observation used by
`EpochMachine.sourceScan`. It includes the source-step equality, the old and
candidate `since <= now` bounds, and both mathematical differences' upper bounds.
When the old epoch is initialized, the old expression age plus the old `since`
equals `now`. Resetting makes the candidate observation age zero. Retaining an
initialized epoch makes the two age projections equal.

`source_history_bounds` proves these properties by induction over the unchanged
`sourceTrace`, including empty histories, either initial Bool, all reading faults
and arbitrary stale payloads. `original_module_bounds` transfers the result through
`EpochModule.original_observed_trace`. The premises include independent original
UTF-8 source admission, complete raw-module admission with the expected actual
transition code, and exact metadata binding. The bridge reuses the existing epoch
certificate to discharge these premises on the production compiler's complete GFB.

`expressionAge` and `committedAge` are mathematical projections over those existing
epochs. On the first scan both are zero. On a later healthy true scan, the toggle
changes state. If time has advanced, the old expression age is positive while the
committed age is zero. The theorem does not replace the old epoch with the candidate
epoch when describing a source expression.

The actual fixture declares an elapsed timer but requests a Bool candidate output.
Its generated timer states and transitions remain in the complete module. This
certificate proves bounds on those states. It does not prove execution of a
Duration output expression, production `f64` subtraction, Rust/model correspondence,
production scan commit, scheduling liveness, or physical relay timing. In particular,
the difference's mathematical bound does not establish IEEE arithmetic correspondence.

## Verification

Run the scoped checker with the existing Lean 4.19.0 executable.

```sh
node experiments/elapsed-clock-bounds/verify.mjs --lean /absolute/path/to/lean --evidence-dir build/elapsed-clock-bounds/proof
node --test tests/elapsed-clock-bounds.test.mjs
```

The verifier compiles the unchanged dependency models and the new model in a fresh
directory. It rejects proof escape declarations and checks real Lean process exit,
signal, diagnostics, and the precise target line for negative propositions. A
timeout or a source/import error cannot satisfy a negative control. Negative files
end at the rejected theorem so later uses of its failed declaration cannot produce
misleading proof-escape output.

The boundary certificates cover repeated clocks, the maximum clock, the maximum
mathematical difference, changed versus retained snapshots, and a three-second
change scan. Strong negative propositions omit monotonicity or the maximum bound,
substitute candidate age for old age, substitute old age for committed age, treat
the first expression as initialized, or reset a retained epoch. Each control first
proves that the actual complete module produces the named sample observations.
Separate admission mutations change original recovery text, an actual clock slot,
or the timer's clock metadata.

Before the first external Lean probe or provenance read, the verifier atomically
replaces any previous receipt with `running`. Every later failure produces `failed`.
Source identity covers the new proof and bridge, all imported Lean models, the
original fixture and bridge, compiler tools, the shared result classifier, the lock
file, the receipt tests, and the clock owner files. It is checked again before a
successful terminal receipt. Each invocation retains its exact generated input,
complete log, result, and hashes. Dependency and compile evidence are separate
from any production build identity.

## Recorded execution

The actual Lean run completed 43 invocations with 34 successful proofs or module
compilations and nine expected proposition rejections. These include 17 unchanged
dependency modules, the new model, three original-source/full-module certificates,
seven accepted boundary cases, and six valid connection prefixes for negative
cases. `ClockBounds.lean` adds five general theorems. The invocation count is not
a count of new independent compiler theorems.

The receipt is `build/elapsed-clock-bounds/attempt-2/verification.json`, SHA-256
`a61fe0743e3072cfc1bef5d8f7f2a893266b0a92c877174951f9ff241f495b22`.
Its source identity is `5a64c724ca7d86e69eab0d7bbbaaaca543a5fa4023106a1bff0b670920b32b1b`.
The first attempt retains a failed receipt and complete logs. Lean checked the
theorem bodies but rejected unsupported automatic `Decidable` deriving. The final
model uses constructive decidability instances.

After that kernel run finished, the root owner's two shared classifier corrections
were applied. The original receipt and its historical classifier hash remain
unchanged. All 43 saved inputs, logs and compiled model hashes were checked again,
and the corrected classifier admitted all 43 saved outcomes. This reclassification
is not a new kernel execution. Its receipt is
`build/elapsed-clock-bounds/current-helper-readmission.json`, SHA-256
`f6cb40f9682bdf44c34dc63f043cc96f39e1ddf64fe15ead6302cf1c5740003c`.
The focused shared-classifier and clock-receipt tests passed eight of eight after
the correction. The earlier failing receipt-test output is preserved separately.
`evidence-summary.json` records these identities and limits.
