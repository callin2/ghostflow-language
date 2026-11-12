# REF-04-065 unproven constraint execution

The optional duplicate-constraint checker covers at most eight output names.
The REF-04-065 regression compiles two identical nine-output mutexes through
the canonical compiler. The artifact carries both constraints and no proof
certificate. The same bytecode runs in the native Rust runner and framed WASM.
Both block the conflicting pair and allow the first output on a subsequent
scan with a single request. Both traces contain two constraint observations.

This covers execution when the compiler cannot establish a proof within its
supported scope. Existing checker tests cover the timeout exception and
inconclusive return. Existing REF-04-065 tests cover invalid quantities,
implicit Result arithmetic, bounded horizons and scalar/PID rollback.
The original case remains specified. A controller update followed by a
resource-update failure in one tick still requires an executable profile
that defines the protected Percent binding and safe-output authority.

[Issue #259](https://github.com/callin2/ghostflow-language/issues/259)
