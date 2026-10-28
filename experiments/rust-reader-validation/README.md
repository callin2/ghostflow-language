# Production Rust Reader foundation (#590)

`ReaderFoundation.lean` is a byte-for-byte copy of Aeneas output from the production
`crates/ghostflow-core/src/lib.rs` at commit
`645b6899f325b0d1d24a1398f2f70af8d9f44787`. The selected functions are
`Reader::new` and `Reader::finished`; the Rust implementation was not copied or
rewritten for extraction. `translation.json` is the extractor's original mapping.
`provenance.json` records the source, generated Lean, LLBC and toolchain identities.

`ReaderFoundationProof.lean` establishes:

- `new` returns through the outer `Result.ok`, preserves bytes, sets cursor zero,
  establishes the in-bounds cursor invariant and preserves the full remainder.
- `finished` returns through `Result.ok` for every Reader.
- With an in-bounds cursor, its Boolean equals emptiness of the remaining list of
  natural bytes, the representation used by `ModuleLoader`.
- An empty input with cursor one is a counterexample if that invariant is omitted.

The proof does not turn panic, undefined execution or divergence into ordinary
parser rejection. `take`, integer decoding, the complete loader and ESP32 behavior
are outside this foundation unit. The list representation is connected
mathematically; this file does not import the older Lean-version ModuleLoader.

## Reproduce

Use Lean 4.35.0 and an already-built Aeneas checkout at the commit recorded in
`provenance.json`. The helper never installs or builds those dependencies.
The extraction directory must contain the original `ReaderFoundation.llbc` and
`lean-foundation/{ReaderFoundation.lean,translation.json}`.

```sh
python3 experiments/rust-reader-validation/verify.py \
  --lean /absolute/path/to/lean-4.35.0/bin/lean \
  --aeneas /absolute/path/to/aeneas \
  --extraction-dir /absolute/path/to/build/rust-reader-extraction
```

The helper checks artifact identity before running Lean, audits the seven theorem
axiom lists, and requires failure when the initial cursor becomes one, the
finished condition is inverted, or the invariant is omitted on the concrete
invalid Reader. Generated mutants and complete command results remain under
`build/rust-reader-foundation-proof/`; `verification.json` records the outcome.
Only Lean's standard `propext`, `Classical.choice`, and `Quot.sound` are allowed in
the theorem dependency audit. No additional axiom, `sorry`, or `native_decide` is
accepted in the two input Lean files.

The kernel checks the resulting Lean propositions. Rust compiler, Charon/Aeneas
translation and the standard-library model remain trusted boundaries. This run
uses host extraction, not an ESP32 compilation or hardware acceptance result.
