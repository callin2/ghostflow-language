# Deferred temporal artifacts

The canonical `.ghost.md` compiler preserves checked `after_event`, `tide_is`,
and `moon_is` programs as `GhostFlow/temporal-descriptor-artifact-v1` when their
public runtime contracts are unavailable. This JSON artifact is **not GFB
bytecode**. Both its payload and companion manifest declare `executable: false`.

The artifact retains the complete extracted control source and typed descriptors.
The normal source document envelope retains the exact literate text, its SHA-256,
and source positions. Verification recompiles that canonical source and rejects
altered bytes, descriptor manifests, or source identities.

`requiredRuntimeContracts` identifies the missing execution boundary:

- `identified-event-delivery` and `per-identity-result-projection`: preserve every
  start event identity and its independent `[event, event + window)` result.
  The Reference does not yet select how a scalar expression reads overlapping
  event results. Neither latest-result nor any-result selection is inferred.
- `natural-provider-observations`: bind the declared provider to classification,
  coverage, expiry, uncertainty, location/timezone, and revision evidence before
  evaluating a `Result<Bool, TemporalContextFault>`.

`ControlRuntime` rejects this manifest. Direct executable lowering also keeps its
existing rejection. No placeholder false value or host-supplied `due` value is
emitted as executable control. Passing Reference compiler acceptance for these
sources proves syntax/type checking and artifact persistence only. It does not
prove runtime conformance or device deployment.

The independent [after_event WASM ABI](AFTER-EVENT-WASM-ABI.md) now executes
identified delivery and native per-identity results. Integrating it into a
compiled control still requires a scalar projection contract and atomic control
tick binding. The descriptor remains non-executable until those are supplied.
