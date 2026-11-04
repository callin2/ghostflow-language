# Production Rust Reader foundation (#590)

`ReaderFoundation.lean` is a byte-for-byte copy of Aeneas output from the production
`crates/ghostflow-core/src/lib.rs` at commit
`645b6899f325b0d1d24a1398f2f70af8d9f44787`. The selected functions are
`Reader::new` and `Reader::finished`; the Rust implementation was not copied or
rewritten for extraction. `translation.json` is the extractor's original mapping.
`provenance.json` records the source, generated Lean, LLBC and toolchain identities.
The separate [ValueType extraction diagnosis](ValueType-extraction-diagnosis.md)
records why the actual `Value::value_type` output cannot yet enter this kernel
proof unit with the pinned Aeneas library.

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
invalid Reader. Generated mutants and current run results remain under the
selected output directory (by default `build/rust-reader-foundation-proof/`).
The retained historical receipt is at
`build/evidence/rust-reader-validation/verification.json` (ignored build evidence).
Its SHA-256 is
`c4594a73839230601e7a05e98cbee0ac9dfe092c94e98da1056599423af578c6`.
It records the 2026-10-28 host proof run and its tool outputs; it is historical
evidence, not proof that a later rerun passed. Each new run replaces only the
current receipt in its selected output directory with an atomically published
`running` receipt before checks begin, then atomically publishes the final
result. The historical copy is not overwritten.
Only Lean's standard `propext`, `Classical.choice`, and `Quot.sound` are allowed in
the theorem dependency audit. No additional axiom, `sorry`, or `native_decide` is
accepted in the two input Lean files.

The kernel checks the resulting Lean propositions. Rust compiler, Charon/Aeneas
translation and the standard-library model remain trusted boundaries. This run
uses host extraction, not an ESP32 compilation or hardware acceptance result.

## Extraction attempts and remaining dependencies

The original extraction used Charon 0.1.299, Rust nightly-2026-09-17 and
`--preset=aeneas --start-from=crate::Reader::new,crate::Reader::finished`
on the real `ghostflow-core` library. Aeneas used `-backend lean`,
`-namespace GhostFlowReader` and `-emit-json`. No production Rust source was
rewritten or copied into a simplified crate. The frozen LLBC and generated output
are required inputs to the verification helper; they are retained as local build
evidence. Rechecking this committed Lean file alone would not establish that a
fresh Rust extraction produced it.

The installed backend is Lean 4.35.0 with Aeneas commit
`399081f237935f9aa805f2d4a51fd3784aea11a9`. Its locked Mathlib revision is
`56a005855ea17e0b0958f73ec801ae140b0a1679`. Charon is pinned to
`2ec7e964e1032c59220e726840a9ac7d7684be2f`; production firmware toolchain selection
was not changed. The isolated Rust installation did update the existing rustup
launcher from 1.29.1 to 1.29.2 before automatic update checking was disabled.
Lean 4.19.0 remains available for the earlier compiler certificate experiments.

| Attempt | Observed result | Consequence |
| --- | --- | --- |
| Actual `Reader::take` and `u16`, default standard-library extraction | Generated unknown-function axioms for Option helpers and String construction | Not admitted as a completed proof |
| Expand Option and String bodies with the default sysroot | Unsupported string-to-byte transmute and unit constant translation | Partial generated files are not proof inputs |
| Supply standard-library MIR from pinned `cargo miri setup` | Option helper bodies translated; String ownership remained opaque | The dependency was narrowed, not removed |
| Expand `alloc::str` ownership as well | String byte conversion, slice ownership and unchecked UTF-8 construction remained opaque | `take`/integer decoder refinement still requires standard-library modeling or extractor support |
| Actual `Value::value_type` | Generated `F64` type missing from pinned Lean backend | See [the failure report](ValueType-extraction-diagnosis.md); no substitute type was admitted |

The successful standard-library MIR attempt used
`CHARON_MIRI_SYSROOTS=/absolute/path/to/miri-sysroot` with Charon's `--sysroot=miri`.
Passing a raw custom sysroot did not consistently configure dependency builds;
that failed attempt is retained separately. Monomorphization also failed because
it conflicts with `--no-gen-tuple-structs` in the selected Aeneas preset.
These are concrete extraction dependencies, not evidence of a production Rust bug.

The normal host test command runs the three receipt regressions. It does not run
this Lean 4.35 proof or rebuild the extraction tools. The separate Lean 4.19 CI
job remains responsible for the earlier Bool, sensor and state experiments.
The current Rust foundation result is a local kernel run with independent review.
