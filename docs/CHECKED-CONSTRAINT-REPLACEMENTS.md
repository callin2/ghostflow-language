# Checked constraint replacements

[한국어](CHECKED-CONSTRAINT-REPLACEMENTS.ko.md)

Status: **bounded implementation contract** for issue #31's remaining acceptance,
under [OPT-42](OPTIMIZER-PASS-CONTRACT.md). Focused implementation checks passed;
this is not a claim of full CI completion or deployment. This document specifies
the implemented bounded executable optimization and independent acceptance checks.
The [intent anchor contract](INTENT-ANCHOR-MAP.md) remains authoritative.

## Eligible replacement

Operate on semantically resolved, lowered Bool output constraints before final
emission. Remove only adjacent exact duplicates with the same constraint kind and
the same ordered output-name sequence. Retain the first occurrence as replacement.
Names are compared exactly: no normalization, sorting, reordering or regrouping.
The entire original constraint list must contain at most 128 entries. Each
duplicate group must mention at most eight unique output names and at most 32
name occurrences. A list over 128 entries retains the original and v1 metadata.
Existing mandatory GFB/resource errors still apply; fallback does not guarantee
artifact emission. An oversized group stays unchanged while other eligible groups may merge. A list
with no admitted duplicate likewise remains unchanged; no diagnostic is required.

This slice adds no user grammar, source format, general SMT solver or BDD engine.
It does not simplify expressions, combine different kinds, deduplicate separated
constraints or certify a raw source Boolean AST. The proof concerns the current
executable constraint effect, including current require lowering.

## Independent finite obligation

Candidate generation supplies a replacement claim, not its acceptance. A separate
finite semantic checker reconstructs each admitted group's Bool domain and checks
all snapshots of its at most eight unique outputs. For every snapshot, original
and candidate must produce identical blocked-output sets and identical fault
strings. It also checks that repeating the effect is idempotent. A successful
comparison of returned Boolean values alone is insufficient.

The justification uses Rust `apply_safety`: every constraint in a round reads the
same snapshot, while blocked outputs and faults accumulate through `BTreeSet`
union. An identical repeated effect adds no new blocked output or fault. Keeping
the first duplicate therefore preserves each round's unions and the following
snapshot. Induction preserves fixed-point safe outputs, fault strings and round
count. Constraint removal changes no expression evaluation, requested intent,
state transition, timer, schedule, clock or accounting computation.

The checker must validate these assumptions against the supported effect model;
unsupported effects or a checker failure retain the original. This argument does
not extend to ordered side effects, different fault strings, arbitrary expression
rewrites or physical application. Native/WASM differential execution supplements
the proof and cannot replace its exhaustive semantic check.

## Revision-bound proof and mapping

A checked transformation retains the exact canonical `.ghost.md` bytes, including
prose and comments, source revision and hashes, every source node and every anchor
and link. Removed nodes remain available at original Markdown and extracted
locations. Anchor classifications are retained without inferring or confirming
intent. Every original source constraint maps to its retained compiled constraint
index, including each removed duplicate; coverage is complete and ordered.

`constraintProof` records `checker`, `rule`, `scope`, `status`, `original`,
`compiled`, `sourceToCompiled`, `originalSha256`, `compiledSha256` and
`certificateSha256`. The checker is
`GhostFlow/adjacent-constraint-effect-checker-v1`; status is
`independently-verified`. Canonical JSON hashes bind both lists and the certificate.
Outer `sourceDocumentSha256` and `bytecodeSha256`, complete canonical source-map
replay, and existing signed-package coverage bind exact source/artifact identity
and original nodes/anchors. The proof does not add compiler Git/profile revision
fields or a separate obligation digest; those belong to the broader OPT-42 design.
A generator's asserted status or a digest alone cannot establish acceptance.

Existing require derivations remain `compiler-derived` with
`semanticVerification: not-proven`. In particular, `require !(a && b && c)`
currently lowers to `mutex(a,b,c)`; when exactly two outputs are true, not-all and
at-most-one differ. Duplicate-effect proof neither upgrades that derivation nor
repairs or defines three-output source semantics. It proves only replacement of
identical current executable effects.

## Evidence and compatibility

Only an actually transformed, independently checked artifact uses host
`GhostFlow/source-trace-v2` and `GhostFlow/source-observation-v2`.
Untransformed artifacts retain v1, including budget skips. These are host companion
versions; GFB format, native ABI, `safety-trace-v1` and strict control manifest stay
unchanged. An older host metadata consumer that cannot validate v2 rejects it fail
closed. Native signed-package transport does not interpret these host proof fields.

The first actually executed constraint record carries observed execution evidence.
A removed duplicate carries `evidence: derived`,
`relation: checked-adjacent-duplicate`, `replacementCompiledIndex`, `checker` and
`certificateSha256`; the retained entry carries `evidence: executed`,
`compiledIndex` and `observed`. Never copy execution events, evaluation or satisfaction onto the removed
source check. Derived replacement, actual observation, final blocking, applied
commands and confirmed physical feedback remain distinct facts. Each original
source identity and its anchors remains navigable through its compiled index.

Observers join previously authenticated or recovered metadata to runtime evidence;
they do not authenticate an arbitrary raw source map.
Strict canonical replay independently reconstructs the candidate and complete
mapping; the independent proof checker validates the finite obligation and
certificate. Both are mandatory at JS builder, recovery and JS package-verification
boundaries. The native verifier retains its existing trust boundary: it checks the
trusted builder's signature, integrity, profiles and loader requirements, rather
than independently proving the host theorem. Reject missing, extra or tampered relations, origins,
observations or certificates; mixed revisions; unsupported versions; and any
unverified optimized artifact. Replay consistency does not become semantic proof.

## Acceptance evidence

Cover every admitted constraint kind, all bounded Bool snapshots, adjacent groups,
multiple groups and original-to-compiled index shifts. Compare original and
candidate fixed-point safe outputs, faults and rounds in native and WASM runs.
Check no-op identity, exact ordered names, separated duplicates, 128/129 list and
eight/nine unique-name boundaries, unchanged state/time/expressions, and complete
prose/comment revision and anchor retention. Negative vectors must reject forged
proof status, missing/extra origins, altered hashes, copied execution evidence,
mixed revisions and unverified optimized packages. A checker/budget fallback must
retain original execution and v1 companions when mandatory checks allow emission.
Focused proof and native/WASM parity checks support this bounded slice; they do
not establish full CI, deployment or physical behavior.
