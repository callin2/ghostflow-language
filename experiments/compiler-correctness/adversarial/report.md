# Independent compiler and runtime counterexample evidence

Task coverage is [#590](https://github.com/callin2/ghostflow-language/issues/590). The confirmed defect is tracked in [#591](https://github.com/callin2/ghostflow-language/issues/591).

The inspected source is `4861a78a72f0f1078cafe99bf26b93d541e1b82c`. No production source or runtime was changed. The rerun after the coordinator's fresh WASM build used SHA-256 `f3347d44a8087033d293c167ca07b0a618475b7b5cc5c8d3ab806565b302eaca`. The observation time was `2026-10-27T13:31:40.822Z`.

## Finding

Accepted canonical source can commit a `Percent` state and produce a requested and safe `Percent` output outside the documented 0..100 domain.

The normative reference identifies `Percent` as 0..100 in `docs/reference/02-types-expressions-state.en.md:21` and repeats the restriction at line 349. Constant arithmetic enforces this in `tools/control.mjs:1418`. Dynamic arithmetic emits only the underlying Number operation in `tools/control.mjs:3613-3620`. Duration and DateTime receive guards there; Percent does not.

The smallest output example is retained in `evidence/percent-runtime-domain.ghost.md`. Its executable code is:

```ghost
control PercentDomain {
  state a: Percent = 90%;
  output above, below: Percent;
  above <- a + 20%;
  below <- a - 100%;
}
```

The public canonical `compileSource` accepts it. The actual WASM `ControlRuntime` accepts tick 1 with `requested = safe = { above: 110, below: -10 }` and `faults = []`. The manifest still declares both outputs as Percent. See the adjacent `.gfb`, `.manifest.json`, and `.traces.json` files.

`evidence/percent-state-domain.ghost.md` also commits `amount` from 90 to 110 on tick 1, then from 110 to 130 on tick 2. Its Percent output carries the same committed values. This confirms that the problem is not confined to a screen or output renderer.

`evidence/percent-boundaries-branch-and-ratio.traces.json` supplies a selected-branch function example with valid Percent sensor observations. A function `raise(value: Percent) -> Percent { value + 20% }` produces 110 and 120 when selected. The same artifact preserves valid outputs 20, 99.5, and 100, and returns 0.5 from the unselected branch when the unsafe arithmetic is unreachable. Its separate `Percent / Percent -> Number` output legitimately produces 180 and 200 and must remain a Number ratio.

The constant counterpart `90% + 20%` is rejected with `Percent constant must be between 0% and 100%`. That diagnostic is independently checked and its source is retained in `evidence/percent-constant-domain.ghost.md`.

These observations establish a domain inconsistency. They do not establish the intended recovery policy for invalid dynamic Percent arithmetic. The harness asserts the documented domain and does not require a new fault name, implicit clamp, implicit OFF output, or a particular tick policy.

## Finite checks and negative control

The complete original harness run is frozen in `baseline/results.json`. It contains nine passing checks and one failing Percent-domain check. The later focused rerun is in `evidence/results.json`; it contains one passing constant diagnostic check and three failures exposing the same Percent defect through outputs, state, and a selected function branch.

The passing checks exercise:

- 312 exact integer input pairs across addition, multiplication, division, and remainder. Expected values come from independent JavaScript BigInt arithmetic and an explicit i32 range. Faulting rows are interleaved with successful rows, and committed counters verify atomicity.
- Binary64 precision with `(16777216.0 + 1.0) - 16777216.0` both as a literal expression and via state. Both produce 1. The current language specifies binary64, so imposing an f32 oracle would be incorrect.
- Constant-folded and runtime integer conversions at the i32 maximum, including truncation of `2147483647.75`.
- Left-to-right selection between distinguishable arithmetic and integer-conversion faults.
- Unselected faults through `if`, `&&`, `||`, pure-function inlining, and a fault-valued Result transformed with `map` and `recover`.
- Continuous timer reset, a 999/1000 ms threshold, repeated logical time, and restart after false.
- Separate state in two imported instances, with reversed instance and connection declarations.

The negative control mutates the emitted addition opcode in a uniquely located `8.0 + 3.0` expression into subtraction. The actual WASM returns 11 for the original artifact and 5 for the mutant. The independent expected-value assertion rejects the mutant. Both bytecode files and `mutation-results.json` are retained. This is a sensitivity check for one opcode mutation, not a compiler-wide mutation score.

The checks drive the production canonical compiler and emitted GFB through the real WASM runtime. The BigInt oracle is independent of compiler arithmetic. Native/WASM agreement, by itself, is not independent language correctness evidence because both targets share the Rust core. This subtask did not make a hardware, Device, API, or farmer-UX claim.

## Rerun

From the repository root after the normal identified WASM build:

```sh
node experiments/compiler-correctness/adversarial/check.mjs
node experiments/compiler-correctness/adversarial/check.mjs --only=percent-runtime-domain,percent-state-domain,percent-boundaries-branch-and-ratio,percent-constant-domain
```

The process intentionally exits 1 while it detects the Percent inconsistency. A focused invocation overwrites `evidence/results.json` with that invocation's selected results. The frozen `baseline/` directory remains the original complete run.

## Correction recommendation and compatibility gap

First specify the language's invalid dynamic Percent arithmetic outcome in #591. Do not introduce clamping or output defaults as an incidental compiler fix. Preserve fractional percentages, valid boundaries, branch reachability, prior-state/intent atomicity if tick rejection is selected, and the unrestricted finite Number result of Percent ratios.

The current shared runtime has a Duration guard and a DateTime guard. Both require integer values and their ranges differ from Percent, so neither is a correct reusable Percent primitive. A generic bounded-number or dedicated Percent guard would require changes to semantic IR, GFB emission, Rust verification/evaluation, and explanation projection. An unused opcode such as 60 is available, but allocating it is a wire compatibility decision. Existing older loaders would reject an unknown opcode; reusing GFB3 without a documented loader-capability contract could obscure which artifacts are supported. Decide version/capability admission explicitly and verify old/new loader behavior before implementation. Replacing the check with a fabricated division-by-zero branch would hide the reason and is not recommended.

## Limits

This finite matrix does not prove correctness for every accepted source, every arithmetic value, every scheduling or accounting profile, every import graph, every optimization, or every malformed byte sequence. The confirmed counterexample is sufficient to reject a universal current-compiler-correctness claim. Passing unrelated repository tests cannot erase that disagreement with the documented Percent domain.

Test Behavior, Not Implementation shaped the BigInt and domain oracles. Prove It Works shaped the canonical-source-to-real-WASM execution and retained artifacts. Model the Domain shaped the finite input-pair and observation matrices. No production correction is included.
