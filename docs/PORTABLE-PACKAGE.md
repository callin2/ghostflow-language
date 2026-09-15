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
│  ├─ bytecode: exact GFB1 v1 bytes + SHA-256
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
outside that required set until a later strategy/adaptation contract names them.

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

- Package v1 contains GFB1 format version 1. Existing raw GFB1 compilation and
  loaders remain unchanged.
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
artifact digests, GFB1 v1 header, canonical embedded manifest/source-map JSON,
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

The current native crate targets Rust `std`, including the ESP-IDF Rust runtime
used by Farm Device; a separate `no_std` package stack is not part of the
Waveshare target. `VerifierLimits` bounds transport, signed payload, artifacts,
signatures, capabilities and JSON depth. The Device consumer must select a
device-sized profile, stage transport bytes outside the active program slot and
invoke this verifier before atomic activation. Host verification alone is not
evidence of MCU activation, relay operation or physical load movement.
