# Deferred temporal artifacts

The canonical `.ghost.md` compiler emits executable GFB11 for natural conditions
such as `tide_is` and `moon_is`. The companion `GhostFlow/control-v10` manifest
retains their typed provider descriptors. Runtime activation requires an explicit
context profile with the declared provider bindings. Provider observations must
carry classification, coverage, expiry, uncertainty, location/timezone, and
revision evidence; callers cannot supply protected Result projections directly.

An unused `after_event` declaration without an explicit projection remains a
checked `GhostFlow/temporal-descriptor-artifact-v1` when its execution contract
is unavailable. This JSON artifact is **not GFB bytecode**. Both its payload and
companion manifest declare `executable: false`.

The artifact retains the complete extracted control source and typed descriptors.
The normal source document envelope retains the exact literate text, its SHA-256,
and source positions. Verification recompiles that canonical source and rejects
altered bytes, descriptor manifests, or source identities.

For a deferred descriptor, `requiredRuntimeContracts` identifies the missing
execution boundary:

- `identified-event-delivery` and `per-identity-result-projection`: identify an
  unused `after_event` declaration that has no executable projection.
`ControlRuntime` rejects the deferred descriptor manifest. It also rejects an
executable natural-condition artifact without the required context activation or
provider bindings. Compilation alone does not prove runtime conformance or
device deployment.

The [after_event WASM ABI](AFTER-EVENT-WASM-ABI.md) executes identified delivery,
native per-identity results, and the explicit `after_event_any` and
`after_event_all` projections in one control transaction. Sources using either
projection compile to executable GFB. The compiler does not infer a projection
for a bare or unused signal.
