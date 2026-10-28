# Bool translation validation execution report

Issue [#590](https://github.com/callin2/ghostflow-language/issues/590).
Production base `0f9b541fa0014951860913f573d593f276ac2149`.
This report records a bounded universal proof and its compiler bridge. Whole-compiler correctness remains unproved.

## Generated production certificates on `dab5051`

The fixed generator in `generated-cases.mjs` uses seed `0x590b001` and emits exactly 16 canonical `.ghost.md` programs. Each has 1–4 Bool states and 1–3 Bool outputs. Across the family, initial states include both values; cases exercise old-state swaps, omitted next assignments retained by identity, forward declarations, candidate reads in outputs, `!`, `&&`, `||`, `if` and explicit grouping. The existing `wide-branch` fixture continues to cover a nonzero high byte in a branch offset. The generator builds phase-typed expression nodes: state transitions contain no candidate reads.

For every generated source, `compileEvidence` invokes the production `compileSource`. The existing `sourceTheoremInput` then binds the original UTF-8 source bytes, the complete raw GFB bytes, `SourceReader.readSource`, `ModuleLoader.load`, and the initialized trace theorem quantified over every tick count. This is a deterministic family of applications of the bounded Bool theorem, not a proof for arbitrary GhostFlow programs.

The focused Node suite passed 14/14. The verification runner exited 0 with 202/202 expected outcomes: 191 Lean 4.19.0 invocations (122 successful proofs and 69 intended rejections) and 11 separate JavaScript admission checks. The Lean invocations include 16/16 generated source certificates and two expected semantic rejections. Changing the source initial Bool value produces another successfully compiled program but fails `exactSourceRead` against the old source module. Changing the GFB initial Bool byte leaves a decodable module but fails `exactModuleLoaded` against the original source module. Both failures occurred at the named equality proof with `decide`; neither log contains an import or unknown-identifier failure. After this run, the runner's negative-outcome predicate was tightened to reject import, unknown identifier, missing-file, signal and timeout failures. A focused replay of the 191 retained Lean logs against that predicate passed 191/191; the JavaScript admission checks were not part of that replay.

Ignored evidence is under `build/bool-generated-certificates-590/`: `verification.json` SHA-256 `ac844511dbb0c28a6279dcfcc0e667b3597fd4eab32c4e5725a11acedec76f16` and `outcome-guard-replay.json` SHA-256 `f66e9b48e1dfb36ba62aee7d0e4ac74a55260d6168c1a497de911cda29c497fd`. The directory retains each source, GFB, bridge evidence, Lean input and log, plus per-source and per-artifact hashes. The 202-outcome run predates the predicate-only hardening; the retained logs were replayed under the hardened predicate. No production compiler or runtime semantics changed, and no native/WASM trace or device acceptance is claimed here.

The subsequent [serializer and raw-decoder report](serializer-report.md) records
the expanded theorem set, 57-outcome run and its additional standard Lean
`Classical.choice` dependency. Counts and axiom observations below describe this
initial experiment.

## Design decision

Two approaches were considered before implementation.

| Approach | Proof boundary | Decision |
| --- | --- | --- |
| Prove production lowering and refine the Rust byte-PC interpreter | Source semantics through every implementation transformation and concrete interpreter step | Retain as a larger obligation. Parser, numerical semantics, profiles and runtime refinement exceed this unit. |
| Prove a rejecting translation validator | A typed Bool expression, exact structured byte representation and a modeled simultaneous tick | Implement this bounded unit. The real compiler supplies bytes. The validator checks their structure and supplied source projection. |

The model does not compile expressions into bytes. Its `Wire` is a witness from decoding the actual artifact. `check` compares the typed expression with that witness and checks both encoded branch offsets. `bytes` reconstructs the witness's original bytes. Generated kernel lemmas require that reconstruction to equal the exact slice of a retained whole artifact.

The Model the Domain principle shaped `Expr allowNext`. The transition phase is `Expr false`. Constructing a next-state reference in that phase requires a proof of `false = true` and is impossible. The expression language has Bool literals, input/previous/next reads, negation and conditional branches. `conjunction_eval` and `disjunction_eval` prove the Boolean meaning of their conditional forms.

## Universal theorems

`BoolTranslation.lean` imports only bundled `Std`.

`check_run` proves that, for every expression, witness and environment, successful checking implies `run wire env = some (eval expression env)`. Environments are arbitrary functions from natural-number slots to Bool values. This is an all-valuation theorem, without truth-table enumeration.

`check_executes` proves the same accepted expression has a derivation in `Executes` for every initial Bool stack. The result pushes exactly the expression value and preserves the original stack. `Executes` is an explicitly modeled structured raw-byte relation. Its branch rules require the little-endian false offset to equal the true block's byte length plus the three-byte jump, and the jump offset to equal the false block's byte length. It models selecting only the chosen branch. It is not a theorem about the production Rust program-counter interpreter.

`simultaneous_tick` proves that checked transition and output lists preserve the pair of per-transition candidate values and requested output values for every environment. Every transition reads the original environment. Output evaluation retains that previous snapshot and adds a complete candidate map. `transition_ignores_candidate` separately proves that transition expressions cannot depend on the environment's candidate values.

The generic tick theorem uses a supplied target list on both sides. It does not prove module-header decoding. Its `updated` function uses first-match lookup. Bridge admission therefore requires unique, in-range targets covering the complete state declaration order. Sparse transitions, duplicate destinations and reordered destinations are rejected. The source projection materializes omitted next-state assignments as identity reads, following Reference §2.8. It normalizes authored assignment order into declaration order before validating the compiler's complete transition table.

The kernel reports only `propext` and, where needed, `Quot.sound`. There are no custom axioms, `sorry` or `native_decide` in the accepted proof. Axiom output is retained in execution logs. Expected-failure mutations can print `sorryAx` after a failed elaboration; those files must fail and are never accepted proof artifacts.

## Real compiler bridge

`bridge.mjs` invokes the public `compileSource` on retained canonical `.ghost.md` fixtures. It separately projects the production `parseControl` AST to typed Bool expressions. It does not reuse the emitter's expression IR as the expected result.

The admitted source subset contains Bool state declarations with Bool literal initial values, Bool output declarations without initial values, next-state assignments and complete output connections in declaration order. Expressions may use state reads, output-phase candidate reads, Bool literals, `!`, `&&`, `||` and `if`. Functions, `let`, external inputs and their Result rails, numeric values, constraints, imports, adaptation and temporal declarations are unsupported.

The byte decoder admits GFB formats 1 and 3 only, zero inputs, Bool state/output slots, exactly one `control` strategy of priority zero, the exact declared-output actuator capability query, and zero constraints. The theorem assumes this strategy has been selected and its capabilities satisfied. Selection itself is outside the theorem. Other formats, profiles, opcodes, malformed offsets, noncanonical Bool bytes, out-of-range reads, trailing bytes, incomplete stacks and phase-invalid references fail closed.

Before generating a theorem input, admission checks the module name/version, state names/order/types/initial values, complete transition destination order and output names/order against the source projection. Each emitted expression is reconstructed from its decoded witness without leftover bytes. Each generated theorem contains the actual whole GFB byte list, a kernel-computed slice equality, a kernel-computed checker-acceptance lemma, an all-environment/all-stack raw-byte execution theorem and an all-environment tick theorem.

The fixtures cover a state swap, old and candidate output reads, an undefined next-state retained by identity, nested `if`/`&&`/`||`/`!`, and a branch-free literal program. No firmware or hardware was used. Production code is unchanged.

## Executed verification and rerun

From the repository root, run the focused bridge regressions and the actual Lean checker.

```sh
node --test tests/bool-translation-validation.test.mjs
node experiments/bool-translation-validation/verify.mjs --lean /absolute/path/to/lean-4.19.0/bin/lean
```

The executed Lean binary was 4.19.0 for Darwin. The runner requires that version and records its executable SHA-256. It checks installed top-level dependency versions with `npm ls --depth=0 --json`, records the lockfile hash, and hashes compiler `.mjs` files, the Rust core, proof, bridge, runner and fixtures before and after verification. The dependency listing verifies installed versions, not every installed dependency file's content.

The default output is ignored `build/bool-translation-validation/`. `verification.json` records process exit codes, timestamps, expected diagnostics, source and artifact hashes, proof input hashes and log hashes. It also stores exact source/projection/decoded evidence, generated Lean theorem inputs and GFB files. Passing records are written only after every gate passes and tracked source identity remains stable. A new run first replaces the old record with `running`; exceptions and missing tools replace it with `failed`. The stale-success regression checks that behavior.

The initial unit's focused suite had six passing tests and its Lean/admission runner had 27 expected outcomes. Accepted outcomes were the universal model and both actual compiler artifacts. Rejected outcomes covered false/jump offsets, old-to-next substitution, next reads in transition bytes and types, wrong state indexes, literal changes, stale source projection, expression length/trailing bytes, omitted expressions, reversed modeled branch selection, overwritten old-state outputs and sequential transition updates. Outer admission also rejected unsupported formats, unknown opcodes, truncated/trailing modules, changed module names, initial values, state types, swapped/duplicate targets and corrupt expression lengths. A nonzero process exit alone does not count as a passed negative check; the expected Lean diagnostic must occur. The [PC refinement follow-up](pc-refinement-report.md) adds instruction-stepping theorems and checks to the current runner.

## Trusted gaps and remaining work

The following links remain unproved.

- Literate extraction, production parsing and the JavaScript projection must correspond to the intended source semantics. They are reviewed, hash-bound code, not kernel-proved transformations.
- The JavaScript outer GFB decoder must correctly identify declaration tables and expression slices. Kernel slice lemmas bind the supplied witnesses to actual retained whole-byte lists, but they do not prove header parsing.
- JavaScript literal serialization and filesystem/hash/tool invocation must supply the bytes and expressions claimed by the evidence. SHA-256 binds identities; it is not semantic proof.
- The structured raw-byte relation and `run` model must refine the Rust interpreter, including resource limits, bounds, error/trace behavior and execution scheduling. This unit does not establish that refinement.
- The tick theorem covers candidate and requested Bool values for a selected admitted strategy. It does not cover safety constraints, fault provenance, witness traces, physical outputs or transactional failure paths of unsupported operations.

The fixtures are finite bridge applications of universal theorems. Their compilation and mutation results do not prove every source program is accepted by the validator or every compiler pass is correct. Broader source profiles need explicit semantics, admission rules and proofs. A generic byte-PC refinement and a proved source-projection boundary remain useful next proof obligations.
