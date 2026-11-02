# Signed i32 codec validation

Issue: [GhostFlow language #590](https://github.com/callin2/ghostflow-language/issues/590).

This unit proves the mathematical four-byte little-endian signed i32 codec in
Lean 4.19.0. It extends the base-256 arithmetic technique used by
`bool-translation-validation/Serializer.lean` without changing the Bool model.
It does not prove the production compiler or Rust reader correct for all inputs.

For every mathematical integer `n` in `-2147483648 ≤ n < 2147483648`, Lean proves:

- `encoded_length`: encoding contains exactly four bytes.
- `encoded_bytes`: each byte is a natural number below 256.
- `roundtrip`: decoding the encoded bytes returns exactly `n`.
- `encode_injective`: equal encodings imply equal signed integers.
- `decode_range`: every successfully decoded byte list yields an i32 value.
- `decode_canonical`: every successful byte list is exactly that value's encoding.
- `decode_unique`: successful byte lists for the same integer are equal.
- `signed_boundary`: unsigned representatives below `2^31` decode nonnegative;
  representatives from `2^31` to `2^32-1` decode negative.

No added axioms, placeholders, native evaluation escape, opaque floating-point
model, Rust copying, or production code changes are used. The reported axiom
dependencies are Lean's standard `propext`, `Classical.choice`, and `Quot.sound`.

The bridge compiles a canonical `.ghost.md` document with `compileSourceSync`.
Its 27 values include MIN, MAX, -1, 0, 1, signed neighbors, and the 8/16/24-bit
boundaries. A narrow structural GFB2 reader locates 27 initial values and 27
opcode-23 literal payloads in the actual module. Generated Lean declarations
contain the full emitted byte list, bind each located slice to the expected
signed value, and recover its canonical encoding through `decode_canonical`.
This is finite compiler evidence: generated-source interpretation, transport,
and the bridge reader remain explicit trusted boundaries.

Three changed modules retain the same structural profile and length: reversed
literal byte order, cleared negative sign bit, and a zero-extended negative
initial value. They must fail the concrete signed-value equality with Lean's
`tactic 'decide' proved that the proposition` diagnostic. Parser/import failures
and timeouts do not count as expected rejection. The predicate requires an
integer nonzero exit status, no process error or signal, no infrastructure
diagnostic, exactly one Lean error, and the exact mutant-specific equality
including its byte offset and expected signed value. Focused regressions cover
signals, null status, timeout/import diagnostics, additional errors and wrong
offset/value diagnostics.

Optional runtime observation reuses exact WASM and native artifacts from a
passed receipt. The verifier checks every receipt-listed Rust/Cargo source and
both binary hashes, copies the binaries into this run's evidence directory, and
labels them reused, never newly built. Native, WASM and framed WASM each run two
ticks; all initial/retained states and literal/state outputs must equal the 27
expected integers. These observations do not prove Rust refinement, arbitrary
expressions, arithmetic, compiler lowering, the full module loader, or hardware.
The reused WASM runtime also loads and executes all three changed modules;
each altered output must differ from its original source integer. This records
real Rust loader acceptance independently of the bridge's structural admission.

Run from the repository root (runtime options are optional as a pair):

```sh
node --test tests/int32-codec-validation.test.mjs
node experiments/int32-codec-validation/verify.mjs --lean /absolute/path/to/lean --evidence-dir build/int32-codec-validation/RUN --runtime-root /absolute/path/to/verified-checkout --runtime-receipt /absolute/path/to/verification.json
```

The receipt starts as `running` before proof/observation work and is atomically
replaced by `passed` or `failed`. Default runs use timestamped directories, so
previous failed attempts are retained. Explicit evidence directories should be
unique for the same reason. Source hashes are compared before and after the
run. The receipt preserves Lean inputs/logs, source, compiled bytes, mutations,
offsets, diagnostics, runtime receipt, copied binaries, traces, and hashes.

During initial proof development, the first Lean attempt failed because a final
`simp only` left a conjunction of `True` unreduced, and `simp_all` had already
split the decoder condition before a second `split`. These proof-script errors
were corrected with ordinary simplification and conjunction elimination. The
first bridge probe expected one raw Bool input; canonical source compilation
emits three quality rails. The bridge now structurally accepts their actual
Bool/Bool/Number types. The first complete verifier run retained under
`build/int32-codec-validation/attempt-01` passed the universal model but hit
Lean's default recursion depth while reducing late slices of the full 2761-byte
module. Generated witnesses now request a finite depth of 10000 and 2000000
heartbeats; proof checking remains in the Lean kernel. These failed attempts
established no passed receipt.
