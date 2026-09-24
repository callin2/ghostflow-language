# Deferred temporal artifacts

The canonical `.ghost.md` compiler preserves checked temporal programs as
`GhostFlow/temporal-descriptor-artifact-v1` when their public runtime contracts
are unavailable. This includes `tide_is`, `moon_is`, and an unused `after_event`
declaration with no explicit projection. This JSON artifact is **not GFB
bytecode**. Both its payload and companion manifest declare `executable: false`.

The artifact retains the complete extracted control source and typed descriptors.
The normal source document envelope retains the exact literate text, its SHA-256,
and source positions. Verification recompiles that canonical source and rejects
altered bytes, descriptor manifests, or source identities.

`requiredRuntimeContracts` identifies the missing execution boundary:

- `identified-event-delivery` and `per-identity-result-projection`: identify an
  unused `after_event` declaration that has no executable projection.
- `natural-provider-observations`: bind the declared provider to classification,
  coverage, expiry, uncertainty, location/timezone, and revision evidence before
  evaluating a `Result<Bool, TemporalContextFault>`.

`ControlRuntime` rejects this manifest. No placeholder false value or
host-supplied `due` value is emitted as executable control. Passing Reference
compiler acceptance for these sources proves syntax/type checking and artifact
persistence only. It does not prove runtime conformance or device deployment.

The [after_event WASM ABI](AFTER-EVENT-WASM-ABI.md) executes identified delivery,
native per-identity results, and the explicit `after_event_any` and
`after_event_all` projections in one control transaction. Sources using either
projection compile to executable GFB. The compiler does not infer a projection
for a bare or unused signal.
