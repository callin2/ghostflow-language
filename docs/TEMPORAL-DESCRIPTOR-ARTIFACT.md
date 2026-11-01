# Deferred temporal artifacts

This page explains what the compiler produces for temporal (time- and
nature-dependent) declarations, and when the output is **not** executable.

**Executable natural conditions.** For natural conditions such as `tide_is`
and `moon_is`, the canonical `.ghost.md` compiler emits executable GFB11. The
companion `GhostFlow/control-v10` manifest keeps their typed provider
descriptors. Compiling is not enough to run them:

- Runtime activation requires an explicit context profile that contains the
  declared provider bindings.
- Provider observations must carry classification, coverage, expiry,
  uncertainty, location/timezone, and revision evidence.
- Callers cannot supply protected Result projections directly.

**Deferred `after_event` declarations.** An `after_event` declaration that is
unused and has no explicit projection stays a checked
`GhostFlow/temporal-descriptor-artifact-v1` when its execution contract is
unavailable. This JSON artifact is **not GFB bytecode**. Both its payload and
its companion manifest declare `executable: false`.

**What the artifact keeps.** The artifact keeps the complete extracted control
source and the typed descriptors. The normal source document envelope keeps the
exact literate text, its SHA-256, and source positions. Verification recompiles
that canonical source. It rejects altered bytes, altered descriptor manifests,
and altered source identities.

For a deferred descriptor, `requiredRuntimeContracts` names the missing
execution boundary:

- `identified-event-delivery` and `per-identity-result-projection`: identify an
  unused `after_event` declaration that has no executable projection.

`ControlRuntime` rejects the deferred descriptor manifest. It also rejects an
executable natural-condition artifact that lacks the required context
activation or provider bindings. Compilation alone does not prove runtime
conformance or device deployment.

**Executable `after_event` projections.** The
[after_event WASM ABI](AFTER-EVENT-WASM-ABI.md) executes identified delivery,
native per-identity results, and the explicit `after_event_any` and
`after_event_all` projections in one control transaction. Sources that use
either projection compile to executable GFB. The compiler never infers a
projection for a bare or unused signal.
