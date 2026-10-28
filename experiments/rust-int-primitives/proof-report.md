# Actual Rust i32 primitive extraction diagnosis

Issue: [GhostFlow compiler correctness #590](https://github.com/callin2/ghostflow-language/issues/590).

No new kernel theorem was admitted. Charon can extract the actual standard-library
`i32::checked_add` and `i32::checked_neg` bodies directly from the real
`ghostflow-core` Cargo context. The pinned Aeneas pipeline does not retain these
external entry functions in its Lean output, and the retained negation dependency
contains an unknown `cold_path` declaration. No wrapper, simplified Rust copy,
production change, added accepted axiom, or substitute `F64` type was used.

## Frozen scope and provenance

The checked-out source is `8c4b407a46f596cffb950ea4a310adeb4accaf51`.
`crates/ghostflow-core/src/lib.rs` SHA-256 is
`9115f4a05d7e55be9674473796f6be214bada56fa1bb8177845ea495f1314bf4`.
The real VM calls `checked_neg` at line 3567 and `checked_add` at line 3581.
This experiment selects their actual external standard-library definitions; it
does not extract or prove the complete VM function, stack operations, error
conversion, compiler, or integer opcode behavior.

Charon: `2ec7e964e1032c59220e726840a9ac7d7684be2f` (0.1.299).
Aeneas: `399081f237935f9aa805f2d4a51fd3784aea11a9`.
Rust: isolated `nightly-2026-09-17`, Miri full-MIR sysroot.
Target: `x86_64-apple-darwin`, pointer size 8. No ESP32 or hardware claim.
Existing tool binaries were used; no toolchain or Lean backend build was run.

Pinned Rust `num/int_macros.rs` SHA-256:
`c6809ba25662238982cbd7572b43ac44d3137e106213bf1e2db7b1371ce53cb6`.
Pinned Rust `intrinsics/mod.rs` SHA-256:
`f86ef5c0af5501e29bf23645327e7d2808afb9ca8aeb786e2cef36d14b0036cb`.
The checked methods are at macro-source lines 594 and 1341; `overflowing_neg`
is at 2982. Both checked methods call `unlikely`, whose true branch calls
the intrinsic `cold_path` (intrinsics source lines 510 and 471).

## Three bounded attempts

All raw command arrays, exit codes, stdout, stderr, LLBC and generated translations
remain unchanged under ignored `build/rust-int-primitives-extraction/attempt-{1,2,3}/`.

| Attempt / UTC start | Configuration | Charon / Aeneas exit | Result |
| --- | --- | --- | --- |
| 1 / 2026-10-28T21:53:16.910045Z | Broad external bodies | 0 / 1 | LLBC has no extraction errors. Aeneas encounters unsupported outer-loop control in unrelated std code and unsupported overflowing-add binary operation; partial Lean contains unknown cold-path declaration. |
| 2 / 2026-10-28T21:53:54.880958Z | Opaque core/alloc/std, exact inherent-impl include patterns | 0 / 0 | Selected roots remain opaque; generated Lean is empty. Successful process exit does not satisfy body admission. |
| 3 / 2026-10-28T21:54:55.355747Z | Opaque core/alloc/std, wildcard impl includes for selected methods, actual `unlikely` | 0 / 0 | Both selected roots have transparent Structured LLBC bodies (IDs 11/12), but neither appears in non-opaque Lean metadata. Retained `overflowing_neg` and `unlikely` depend on unknown `cold_path : Result Unit`. Admission rejects the output. |

The exact external entry selectors are `i32::checked_add` and `i32::checked_neg`.
Charon's `resolve_path.rs` supports primitive roots. Its name matcher currently
returns false for inherent-impl patterns (`name_matcher/mod.rs`, lines 269–271),
so the more precise-looking `{i32}` includes in attempt 2 do not select bodies.
The wildcard includes in attempt 3 operate within a call graph rooted only at the
two i32 methods; they do not create Rust wrappers or change extracted source.

Aeneas `PrePasses.ml` lines 1867–1889 seed used-function IDs from local functions
and calls inside bodies; lines 1932–1952 retain only used function groups. These
external entry methods have no local caller and are not retained as roots. The
`started_from` extraction marker is not used by that pass. Separately,
`ExtractBuiltin.ml` lines 574–582 map checked addition to the existing scalar
model. Its correctness is a trusted model boundary, not a new actual-body proof.
Checked negation is absent from that builtin group.

## Admission and reproduction

`audit.py` requires both real roots to be transparent Structured LLBC bodies,
both roots to exist as non-opaque generated Lean functions, and no generated
unapproved axiom or proof escape. All three historical artifacts were inspected
and rejected. Attempt 3's admission command exits 1 for two concrete reasons:
missing selected Lean roots and the unknown cold-path declaration. No Lean kernel
proof was attempted against the rejected file. Historical extraction receipts
whose status is `translated` record process translation only, never proof admission.
The current extraction helper runs admission before reporting a usable artifact.

Run `python3 experiments/rust-int-primitives/audit.py DIRECTORY` on a fresh copy
of a retained attempt, preserving historical receipts. `extract.py --help` lists the existing-binary, isolated-target and
Miri-sysroot inputs. Its `--configuration broad`, `exact-pattern`, and `wildcard`
choices reproduce attempts 1, 2, and 3 respectively in a fresh output directory.
It never builds or installs extraction tools and never reuses prior output.
The environment must put the existing rustup launcher on PATH.

The helper now uses Cargo `--locked --offline`, records the actual Charon/Aeneas
binary and both helper SHA-256 values, and checks production/tool/helper hashes
before and after extraction. A changed input forces failure. These receipt
improvements do not retroactively modify the three historical command records.
The audit atomically publishes `running` before reading inputs and `failed` on
an inspection exception. Its artifact digest covers only LLBC, generated Lean,
translation metadata and the four named tool stdout/stderr logs. Extraction and
admission receipts, their temporary files and other files are excluded, avoiding
self-referential digests. It also rejects `constant`, `opaque` and `sorryAx`
alongside axiom and other proof escapes. Structural admission remains a candidate
input check, never a kernel proof or complete source-equivalence check.

Review regressions reproduced stale success using a corrupted LLBC with an old
admissible receipt. The pre-fix receipt/hash regressions fail against `ccca4a1`;
the corrected six-test suite passes with
`python3 -m unittest discover -s experiments/rust-int-primitives -p test_receipts.py`.
Synthetic test artifacts verify guards only. Fresh copies of all three actual
historical artifacts still reject; original artifact hashes remain unchanged.
No fourth extraction was run. The recheck and actual binary/helper/source hash
snapshot is `build/rust-int-primitives-review/recheck/verification.json`, observed
at `2026-10-28T22:05:15.274969Z`, SHA-256
`0d845c14aa8dd46486164cd662b766beb24af9e9f483984deae9996e72cb654d`.

Attempt 3 LLBC SHA-256:
`07022725faab0b8a6bd98dc05f89242024eb1566614215baf4c6cb3a61db3f03`.
Unchanged rejected generated Lean SHA-256:
`fe72b61d251996f484ef37fa5579fc726bf7d47062bbc74b6e92d9a61bd0cb80`.
Translation metadata SHA-256:
`81d1c99f4643544c4a96f04697e7ac384d66a34ac58b7c94f289d70528f78d2c`.
Admission receipt SHA-256:
`348a943b4344a4ed289948e5cd5a082879da4d38ae8b8c552012eca4a7db353f`.

Remaining dependency: retain supported external entry roots and provide verified
intrinsic translation/model support before claiming the desired actual-body
theorems. Expanding actual `overflowing_add` also requires its currently unsupported
overflowing operation. The Rust compiler, Charon/Aeneas translation, standard-library
models and host-to-target correspondence remain trusted boundaries. This diagnosis
reduces uncertainty about extraction feasibility; it closes no whole-compiler
semantic-preservation obligation.
