# Bounded Bool serialization and raw decoding — #590

This unit removes a premise from the earlier byte-PC proof: a representable typed
Bool expression now has a proven canonical encoding, and an independent raw-byte
decoder recovers that expression. The purpose is to preserve the authored control
meaning across the compiled-byte boundary. Passing these proofs does not establish
correctness of every GhostFlow compiler path.

## Universal results

`Serializer.lean` defines `serialize` as a total function returning bytes or an
explicit error. Its representable domain requires every slot index below 65536
and the encoded expression at most 4096 bytes. Runtime slot counts and candidate
availability remain separate premises of the byte-PC execution theorem.

| Theorem | Kernel-checked statement |
|---|---|
| `canonical_accepted` | The canonical encoding witness of a representable expression passes the existing checker. |
| `accepted_canonical` | Any checker-accepted witness for an expression is its canonical witness. |
| `accepted_serialized` | An accepted bounded witness has exactly the bytes returned by serialization. |
| `serialized_bytes` | Successfully serialized elements are actual byte values. |
| `branch_offsets_positive` | Canonical branch jump offsets are positive in the represented domain. |
| `serialize_recovery` | Decoding successfully serialized bytes returns the original typed expression. |
| `serialized_refinement` / `serialized_execute` | Successful serialization and scope premises connect to the existing structured and byte-PC execution results. |

The decoder reads raw opcodes and little-endian operands, slices branch arms by
their encoded offsets, and builds expressions through its own stack. It receives
no expression or wire witness to guide parsing. Both arms and the complete input
must produce singleton results; phase restrictions remain explicit. Its recursion
terminates by decreasing remaining byte-list length. The recovery theorem is
universal over the representable typed expressions, not an enumeration of fixtures.

`serializer-bridge.mjs` reuses the earlier kernel-checked equalities between the
complete actual GFB artifact and each expression slice. It proves serialization
equality and decoding recovery for those slices. It does not manufacture the
artifact byte list from the Lean witness. A third real compiler fixture,
`wide-branch.ghost.md`, exercises a nonzero high byte in a branch offset.

## Executed evidence

The isolated source commit `1df60808e372a91a4f0bf1bb11d04ec9636d8656`
passed all seven Node bridge tests and all 57 expected Lean/admission outcomes
using the actual Lean 4.19.0 kernel. The committed-source run finished at
`2026-10-28T15:01:46.298Z`. Its verification JSON SHA-256 is
`87593fc0fd6733bc5c2fca22db454c8f75ebff0ac2723d784100f7fbe2165fcb`.
The integrated checkout requires its own recorded verification identity.

Nine serializer/decoder mutations are expected to fail with specific proof
diagnostics. Retained logs distinguish a false theorem from missing imports,
timeouts or tool startup failures. Existing PC and admission negative checks
remain in the runner. Run the same `verify.mjs` command documented in the
[PC refinement report](pc-refinement-report.md).

The new serializer theorem logs include the standard Lean axioms `propext`,
`Classical.choice`, and `Quot.sound`. No custom axiom, `sorry`, `sorryAx`, or
`native_decide` is used. The earlier reports' two-axiom observations apply to
their earlier theorem sets, not to this extension.

## Remaining boundaries

The JavaScript source parser/projection and outer GFB header/slice extraction
remain trusted links in artifact validation. The theorem connects to the modeled
byte machine; it does not mechanically prove the production Rust implementation,
other value types or profiles, strategy selection, trace collection, or physical
effects. Recovery proves `decode(serialize(e)) = e`; the converse for arbitrary
decoder-accepted bytes is a separate obligation. Parent issue
[#590](https://github.com/callin2/ghostflow-language/issues/590) remains open.
