# Semantic Kernel 0.1 review plan

Parent: [#166 Semantic Kernel 0.1](https://github.com/callin2/ghostflow-language/issues/166)

This plan sequences the frozen semantic-kernel review milestone. The milestone permits no new language features. Record a real gap as a gap; do not make it disappear by relabeling it.

## Dependency order

1. **#167 — exact dev push verification** is independent of compiler work. It adds `dev` to the existing Verified WASM push trigger and regression-checks source binding and full-gate order. Acceptance still requires a successful full CI run on the exact current `dev` commit.
2. **#168 — tick contract correction** resolves the active catalog conflict against Reference §2.8 and preserves the already tested runtime behavior. This is documentation/catalog work, with no compiler, GFB, VM, or physical output change.
3. **#169 — evidence-backed feature status** follows #168 for the disputed row. It inventories principal Reference families and separates owner from maturity. It must not demote an implemented but under-tested core feature to `DESIGN` to force a green result.
4. **#170 — finite core and evidence matrix** depends on #168 and #169. Freeze constructs and their positive, negative, boundary, target-parity, and replay evidence. Keep TODOs outside the explicitly frozen core honestly identified.
5. **#171 — expression Core IR** may execute after #168 and the declared frozen construct scope in #170, before #170's evidence matrix is fully implemented. Integration still respects the #170 evidence gate. Introduce an internal typed expression lowering stage before GFB instruction emission. Keep the public source compiler APIs and existing output bytes.
6. **#172 — module Core IR** depends on #171 and the declared frozen construct scope in #170. The #170 evidence matrix can consume its proof before final acceptance. Replace the generated S-expression text round trip with normalized typed module records and one GFB emitter. Preserve distinct extension descriptors.
7. **#173 — canonical irrigation proof** depends on the declared #170 scope and evidence schema. The #170 matrix can consume its proof before final acceptance. Use PC-02 as the wholly-core irrigation program. Keep PC-09 timer/sequential replay as an extension regression, not as the core proof. Reuse existing source/trace and #88 explanation work.

8. **#178 — retained-core replay** owns the open REF-06-017 proof. Do not count a replay regression or host-local replay as retained-checkpoint core evidence unless it satisfies that case's exact oracle.
9. **#179 — stale coverage gate** repairs seven stale coverage test oracles and the build precondition/threshold debt. Frozen-core case accounting belongs to #170; specified case text and status remain preserved.

For integration, reuse the existing dev-to-main PR #175 after dev review and exact-head verification. Do not substitute the separate main-only MIT backport.

The frozen constructs in #170 are canonical literate source and intent identity; Bool, Int, Number, Percent, and Duration source values with literal, unit, and range semantics; typed input and bounded config; pure expressions; state and simultaneous `next`; explicit nondecreasing logical scan time; requested intents; Boolean constraints; atomic tick behavior; source-linked trace; and retained-checkpoint deterministic core replay. Document source type separately from runtime representation. A checked source type lowered to Number does not waive unit, range, or exactness rules.

The current MVP wording conflict in `LANGUAGE-MVP-0.1.md` is precise: it says every intent reads committed next state. Current Reference §2.8, `docs/LANGUAGE.md` §7, GFB execution, and `GF-TEST-snapshot-commit` instead establish unprimed reads from old state and explicit primed reads from candidate state. Candidate state and requested/safe results commit atomically when evaluation and validation succeed. Boolean constraints may validly inhibit requested outputs and produce a safe output; a constraint changing requested intent to safe intent is not itself a failed scan. Only evaluation or validation failure rolls back. The MVP document remains cited by active requirements; supersede only the conflicting claim, keep its old statement and content-derived ID as evidence, and link the replacement requirement. Do not change runtime behavior.

## Execution rule and representation boundary

For each accepted scan, evaluate transitions simultaneously from one immutable input and old-state snapshot to candidate state. An unprimed state reference in output intent reads old state; an explicit primed reference reads the candidate value. Evaluate requested intents and apply Boolean constraints to derive safe intents. A valid constraint may force an output safe without failing the scan. Commit candidate state and the resulting requested/safe scan record atomically after evaluation and validation complete. If evaluation or validation fails, retain prior committed state and do not expose a partial candidate.

The compiler should expose an internal semantic boundary without promising a new public AST or API:

- **Typed expression IR (#171):** semantic nodes and resolved identities/types, including old-state and candidate-next reads, conditional and logical behavior, arithmetic/conversion, time guards, context projection, and trace markers. It contains no opcodes, bytes, GFB format choice, or encoded offsets. The emitter alone lowers it to VM instructions.
- **Typed module IR (#172):** resolved inputs, state defaults, strategy/query, transitions, requested intents, Boolean constraints, and expression IR. Temporal windows, schedules, `true_for`, configuration streams, natural/accounting results, and PID objectives remain explicit typed extension descriptors with their own validation, provenance, quality, time, and resource rules. They are not silently treated as pure core expressions.
- **GFB boundary:** the existing source AST and compiler entry points remain. One emitter alone selects the existing GFB format and writes the established envelope, instruction stream, and extension records. Preserve exact bytes, manifest/source-map/trace identities, diagnostics, limits, browser-safe imports, native/WASM behavior, and historical expected hashes. No new wire version, parallel compiler, fallback, extension semantics, or Rust runtime change is in scope.

## Ten acceptance criteria

1. Core semantic constructs are fixed for this milestone.
2. Surface-to-typed lowering, CoreIR, and GFB boundaries are documented honestly.
3. Every core construct has executable positive, negative, and boundary tests.
4. Native and WASM produce identical results for the core conformance vectors.
5. There are zero TODO cases inside the frozen Reference core scope.
6. There are zero known core semantic mismatches.
7. The exact current `dev` HEAD has a green full Verified WASM CI run.
8. One real irrigation program runs wholly within the declared core.
9. Deterministic replay reproduces an identical result.
10. Source-to-trace-to-decision cause traceability is established.

The full causal explanation DAG remains separate. Source-to-trace-to-decision provenance for accepted core paths does not prove #88's full evaluated-path explanation graph complete. #70/#74/#88/#115 continue to define or track the wider Interaction IR, stream, explanation, and event-order contracts. Do not claim those features done from this milestone's core proof.

## Verification and limits

For each implementation slice, run its focused commands from the issue, then the repository's `npm test` integration gate when sources or tests change. The full gate uses explicitly listed tests and the verifier's Rust formatting/workspace, native/debug/release, WASM, replay/tutorial, and artifact provenance checks. Verify that artifacts identify the exact tested source SHA. After merge, the exact resulting `dev` commit must have both `Verify WASM (current)` and `Verify WASM (frontend-pin)` successful. A PR check, a frontend-pin pass, a source hash match, or a Rust-only suite is insufficient.

No Device flash, physical output, farmer acceptance, or complete explanation-DAG verification is claimed by this plan.

Once reviewed `dev` work is integrated into `main`, verify that exact integrated revision and its gates before public MIT publication. Do not merge the separate main-only MIT backport as a substitute for dev-to-main integration.
