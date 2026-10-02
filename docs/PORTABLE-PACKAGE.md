# Portable GFB package v1

`GhostFlow/portable-package-v1` binds one authoritative literate source revision
to the exact GFB1 bytes that Browser and Device hosts load. It also carries the
generated manifest, source map, execution compatibility identity and Ed25519
signatures. The package does not change GFB1 bytes or VM semantics.

## Envelope

```text
package
├─ format: GhostFlow/portable-package-v1
├─ payload
│  ├─ format: GhostFlow/portable-payload-v1
│  ├─ source: exact UTF-8 .ghost.md bytes + SHA-256
│  ├─ bytecode: exact GFB profile 1/2/3/4 bytes + SHA-256
│  ├─ manifest: exact canonical JSON bytes + SHA-256
│  ├─ sourceMap: exact canonical JSON bytes + SHA-256
│  └─ identity
│     ├─ compilerRevision
│     ├─ runtimeSemantics
│     ├─ runtimeAbi
│     ├─ requiredCapabilities[]
│     └─ bindingRevision
├─ payloadSha256
└─ signatures[]: algorithm + keyId + signatureBase64
```

Binary fields use canonical padded base64. Manifest and source-map bytes use
recursive JSON key sorting, preserve array order and use ECMAScript finite-number
serialization. Sparse arrays and integers outside JavaScript's exact safe range
are rejected; `-0` serializes as `0`. The original Markdown is not normalized:
Unicode, comments, prose, CRLF and trailing newline remain part of its source
digest.

`buildPortablePackage` accepts only a `compileSource` result whose source is a
`.ghost.md` literate document and whose control manifest matches the GFB digest.
Signing also requires a fresh `verifyCompilation` replay. Its exact GFB,
manifest and source-map bytes must match the supplied result, preventing an
official builder from pairing readable source with another compiled program.
Required capabilities are sorted by `kind`, `name`, then `type`. Every manifest
input (`input`), non-optional sensor (`sensor`) and output (`actuator`) must match
the signed required-capability set in both directions. Optional sensors remain
outside that required set; explicit host bindings determine their presence.

## Signature bytes and trust

The signature input is the exact canonical UTF-8 encoding of `payload`.
`payloadSha256` hashes those same bytes. The outer package format is checked
before verification, while `signatures` and `payloadSha256` are excluded from
the signature input. All embedded bytes, their descriptors and execution
identities are inside the signed payload.

Version 1 permits only Ed25519. Each signature names a bounded `keyId`; duplicate
keys or algorithm negotiation are rejected. A verifier receives two explicit
trust inputs:

- `trustedKeys`: currently accepted key IDs and Ed25519 public keys.
- `revokedKeyIds`: keys that no longer authorize a package.

Both inputs are mandatory trust snapshots. Omitting revocation state is an error,
not an empty revocation list.

Rotation is a co-signed package. Hosts first trust the next public key, then
accept a package signed by current and next keys, and finally revoke the old key.
A revoked signature is ignored when another active trusted signature verifies;
a package with no remaining active trusted signature is rejected. Trust records
do not depend on the wall clock.

The RFC 8032 key material in `tests/portable-package.test.mjs` is public test data
and must never be configured as a product trust root.

## Verification order

### Native development authentication policy

The Rust `ghostflow-package` API `verify_portable_package` always enforces
publisher authentication. `SignaturePolicy::default()` is `Enforce`. An explicit
development host may call `verify_portable_package_with_signature_policy` with
`DevelopmentBypass`; it runs the same canonical verifier and target loader.
This owner interface does not select a Device build profile or enable a bypass
in Browser/JavaScript verification.

Development bypass accepts an empty `signatures` array or signatures from an
untrusted/revoked publisher without checking cryptographic authentication.
The array remains required and bounded by `max_signatures`. Present entries
must have the exact schema, Ed25519 algorithm, distinct bounded key IDs and
canonical base64 encoding of 64 bytes. Trust roots and revocation inputs are
unused in this mode; no fake trusted key is substituted. Canonical transport,
payload and artifact hashes, size bounds, compatibility identity, capabilities,
binding, source/bytecode cross-links and target loading remain mandatory.
Hashes establish byte consistency, not an authenticated publisher or intent.

The result exposes `signature_authentication` as `Authenticated` or
`DevelopmentBypass`. A bypassed result always has empty `accepted_key_ids`,
even if a supplied signature would otherwise verify. Hosts must expose that
unauthenticated status and apply one policy to upload, stored-program boot and
rollback. Production and trusted acceptance hosts must keep enforcement;
development opt-out does not grant output authority or authorize execution.

`verifyPortablePackage` returns `PortablePackageError` with a stable `code` and
does not expose bytecode until these checks pass:

1. exact package/payload schema and supported versions;
2. canonical payload digest and at least one active trusted signature;
3. compiler revision, runtime semantics, runtime ABI and binding revision;
4. manifest format and required capabilities against host inputs;
5. source, GFB, manifest and source-map content digests and cross-links;
6. compiler-owned source-trace metadata against the source and GFB identities;
7. the host's supplied `verifyBytecode` callback.

The callback is mandatory. It receives the exact GFB bytes plus deeply frozen
verified manifest, source map and identity values. Browser passes its WASM GFB1 loader; Device
passes the native `Module::load` boundary. A false result or exception becomes
`bytecode-rejected`; only an explicit `true` accepts the target loader result.
The verified result offers a detached `bytecode.copy()` on each access so a
caller cannot mutate retained verified bytes. The verifier never retries with a different ABI, strips an
unknown requirement, substitutes another binding or falls back to an older
program.

The returned source, manifest, map and GFB bytes all come from the verified
payload. A package digest proves identity and a signature proves an accepted
issuer; neither proves farmer intent, hardware compatibility, relay operation or
physical load movement.

`bindingRevision` identifies the installation binding selected by the API and
Device. This package validates exact revision equality and logical capability
shape; the owning API/Device layer must validate that revision's actual DI/RO
channel map before invoking the package verifier.

## Compatibility and migration

### Signed GFB11 Periodic with scalar settings

GFB11 with `GhostFlow/control-v10` and `GhostFlow/context-scan-abi-v5` may now
package scalar configs together with an executable Periodic schedule. The
current signed subset requires an instant anchor, `preserve_anchor`, a config
backed `Duration` interval, a constant `true` predicate, and the
`pulse`/`trusted_only`/`baseline`/`skip` policy. The manifest schedule site,
name, interval config ID and value, anchor, gap and policy must match the
decoded GFB11 descriptor. Generated config projections and the clock/epoch
inputs must match the bytecode. Other schedule kinds, objective/window/signal
preludes and unsigned or mismatched packages remain rejected. Scalar config
initial values and bounds retain their existing checks. This extends package
admission only; it does not change the language or Device deployment policy.

- Package v1 contains one supported GFB profile. The signed bytecode
  descriptor version is the decimal string of the actual little-endian header
  version. Both JavaScript and Rust verifiers require an exact match before
  invoking the target loader. Supported-but-mismatched versions report
  `bytecode-version-mismatch`; unknown versions report `unsupported-bytecode-version`.
  Int ports map to the distinct `int` capability type, including in profile 3.
  The 17 physical quantity types map to machine capability `number`; their
  input/output/sensor/config descriptors require the exact catalog `canonicalUnit`.
  Input/output quantity records contain exactly `name`, `type`, and `canonicalUnit`.
  Nonquantity records forbid that field. JavaScript and Rust reject missing,
  incorrect, or unexpected unit metadata before invoking a target loader.
  Compilation replay, signatures, artifact digests and target verification remain
  required. See [BYTECODE.md](BYTECODE.md) for the current profile semantics.
- Hosts that require signed deployment must not downgrade an invalid package to
  a raw `.gfb` path.
- Unknown package, payload, bytecode, manifest, runtime-semantics or ABI versions
  are rejected. Supporting a new version requires a new conformance corpus and
  an explicit consumer compatibility update.
- API storage, Device atomic stage/activate/recovery and production key custody
  belong to their respective modules; they consume this package contract.

`tests/portable-package.test.mjs` covers deterministic construction and compiler
replay, source and
artifact preservation, tamper rejection, key rotation/revocation, capability and
binding rejection, Buffer-less browser verification and byte-identical extraction
through release native Rust and WASM GFB1 loaders.

## Native verifier API

`crates/ghostflow-package` accepts only exact canonical
`GhostFlow/portable-package-v1` transport bytes (including its single trailing
newline). It verifies the signed payload digest, trusted non-revoked Ed25519
signature, compiler/runtime/binding identity, capability and manifest cross-links,
artifact digests, GFB profile/header agreement, canonical embedded manifest/source-map JSON,
and the source-map's authoritative source-document linkage.

The caller supplies a mandatory `TargetLoader`; the verifier does not return a
copy of GFB1 bytes until that loader returns `Ok(true)`. `VerifiedPackage`
returns detached source, manifest, source map and bytecode copies, together with
the accepted signing key IDs.

The native v1 slice intentionally does **not** duplicate the compiler-owned deep
semantic validation of `sourceMap.traceMetadata`. That validation remains in the
existing JS common verifier and is covered by the trusted package builder's
fresh deterministic compiler replay before signing. Native verification does not
accept raw GFB or a legacy fallback, and it never treats a caller-provided
attestation as a trust authority.

For GFB profile 4, the native verifier checks the signed window descriptors and
their machine bindings as part of the manifest and bytecode cross-links. Nested
descriptors bind each `upstreamWindows` name, site and prior slot to the dependency
list decoded from quality projections. Omitted, empty or rebound dependency lists
are rejected before the target loader. Temporal
activation is a separate runtime step: the caller supplies the explicit time
epoch, root-density limits and retention budget after signature verification.
Signature verification alone does not activate a temporal profile or prove window
trace semantics. The native package slice does not recompile canonical JavaScript
source or perform deep semantic trace replay. Descriptor verification alone does
not establish the runtime's nested-window arithmetic or proof retention.

The current native crate targets Rust `std`, including the ESP-IDF Rust runtime
used by Farm Device; a separate `no_std` package stack is not part of the
Waveshare target. `VerifierLimits` bounds transport, signed payload, artifacts,
signatures, capabilities and JSON depth. The Device consumer must select a
device-sized profile, stage transport bytes outside the active program slot and
invoke this verifier before atomic activation. Host verification alone is not
evidence of MCU activation, relay operation or physical load movement.


## Adaptive strategy descriptors

Compiler-produced `adaptPolicy` and `strategies` are paired signed manifest
metadata. JS verification compares them with canonical source recompilation and
exact bytecode. Native verification matches ordered strategy names, priorities,
output names and capability-query bytes against the decoded core module. Typed
matches must reference declared sensor/actuator capabilities. Selection remains
`highest-priority-unique`; unsupported or unpaired metadata rejects before loading.
The policy name is signed, bounded source metadata, not a new runtime selector.

Optional Bool observation does not automatically select or activate a new policy.
An explicit host capability snapshot determines whether its authored strategy is
eligible. Native and WASM tests preserve the absent baseline and present feedback
outputs and reject re-signed strategy/query/bytecode tampering. GFB and wire formats,
ABI and signature policy remain unchanged. Physical wiring and Device admission
remain consumer responsibilities.
